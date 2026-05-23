"""RAG pipeline — ChromaDB + Ollama nomic-embed-text."""

import logging
from pathlib import Path
from typing import Optional

import httpx
import chromadb
from chromadb.config import Settings

log = logging.getLogger("localchat.rag")

CHROMA_PATH  = Path(__file__).parent.parent / "chroma_db"
EMBED_MODEL  = "nomic-embed-text"
CHUNK_WORDS  = 350
CHUNK_OVERLAP = 50

# Module-level singleton — reused across all requests
_collection = None


def _get_col():
    global _collection
    if _collection is None:
        CHROMA_PATH.mkdir(parents=True, exist_ok=True)
        client = chromadb.PersistentClient(
            path=str(CHROMA_PATH),
            settings=Settings(anonymized_telemetry=False),
        )
        _collection = client.get_or_create_collection(
            name="localchat",
            metadata={"hnsw:space": "cosine"},
        )
        log.info("ChromaDB collection opened at %s (%d items)", CHROMA_PATH, _collection.count())
    return _collection


def _chunk(text: str) -> list[str]:
    words = text.split()
    chunks, i = [], 0
    while i < len(words):
        chunk = " ".join(words[i : i + CHUNK_WORDS])
        if chunk.strip():
            chunks.append(chunk)
        i += CHUNK_WORDS - CHUNK_OVERLAP
        if i >= len(words):
            break
    return chunks


async def _embed(texts: list[str], ollama_url: str) -> list[list[float]]:
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{ollama_url}/api/embed",
            json={"model": EMBED_MODEL, "input": texts},
        )
        r.raise_for_status()
        data = r.json()
        if "embeddings" not in data:
            raise ValueError(f"Unexpected embed response: {data}")
        return data["embeddings"]


async def ingest(doc_id: str, filename: str, text: str, ollama_url: str) -> int:
    col    = _get_col()
    chunks = _chunk(text)
    if not chunks:
        log.warning("No chunks produced for %s", filename)
        return 0

    log.info("Ingesting %s → %d chunks", filename, len(chunks))

    # Remove previous version
    try:
        existing = col.get(where={"doc_id": doc_id})
        if existing["ids"]:
            col.delete(ids=existing["ids"])
    except Exception as e:
        log.warning("Could not remove old chunks: %s", e)

    # Embed in batches of 32
    embeddings: list[list[float]] = []
    for i in range(0, len(chunks), 32):
        batch = chunks[i : i + 32]
        embeddings.extend(await _embed(batch, ollama_url))

    col.add(
        ids       = [f"{doc_id}__c{i}" for i in range(len(chunks))],
        documents = chunks,
        embeddings = embeddings,
        metadatas = [{"doc_id": doc_id, "filename": filename, "chunk_index": i} for i in range(len(chunks))],
    )
    log.info("Ingested %d chunks for %s (total in DB: %d)", len(chunks), filename, col.count())
    return len(chunks)


async def retrieve(
    query: str,
    ollama_url: str,
    n_results: int = 5,
    doc_ids: Optional[list[str]] = None,
) -> list[dict]:
    col = _get_col()
    total = col.count()
    if total == 0:
        log.warning("KB is empty — no chunks to retrieve")
        return []

    log.info("Retrieving top-%d chunks for query: %r (DB has %d)", n_results, query[:60], total)
    q_emb = (await _embed([query], ollama_url))[0]

    where = {"doc_id": {"$in": doc_ids}} if doc_ids else None
    results = col.query(
        query_embeddings = [q_emb],
        n_results        = min(n_results, total),
        where            = where,
        include          = ["documents", "metadatas", "distances"],
    )

    out = []
    for text, meta, dist in zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0],
    ):
        out.append({
            "text":        text,
            "filename":    meta["filename"],
            "doc_id":      meta["doc_id"],
            "chunk_index": meta["chunk_index"],
            "score":       round(1 - float(dist), 4),
        })

    log.info("Retrieved %d chunks, top score: %s", len(out), out[0]["score"] if out else "—")
    return out


def list_docs() -> list[dict]:
    col    = _get_col()
    result = col.get(include=["metadatas"])
    seen: dict[str, dict] = {}
    for meta in result["metadatas"]:
        did = meta["doc_id"]
        if did not in seen:
            seen[did] = {"doc_id": did, "filename": meta["filename"], "chunks": 0}
        seen[did]["chunks"] += 1
    return list(seen.values())


def delete_doc(doc_id: str):
    col = _get_col()
    existing = col.get(where={"doc_id": doc_id})
    if existing["ids"]:
        col.delete(ids=existing["ids"])
        log.info("Deleted %d chunks for doc_id=%s", len(existing["ids"]), doc_id)


def get_full_doc(doc_id: str) -> dict:
    """Return all chunks for a document concatenated in order."""
    col = _get_col()
    result = col.get(where={"doc_id": doc_id}, include=["documents", "metadatas"])
    if not result["ids"]:
        return {"doc_id": doc_id, "filename": "", "text": "", "chunks": 0}
    pairs = sorted(
        zip(result["metadatas"], result["documents"]),
        key=lambda x: x[0]["chunk_index"],
    )
    filename = pairs[0][0]["filename"]
    text = "\n\n".join(doc for _, doc in pairs)
    return {"doc_id": doc_id, "filename": filename, "text": text, "chunks": len(pairs)}

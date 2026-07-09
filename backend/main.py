import base64
import json
import logging
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from .parsers import extract_text, is_image, is_document
from . import rag as rag_module

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s: %(message)s")
log = logging.getLogger("localchat")

CONFIG_PATH = Path(__file__).parent.parent / "config.json"


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except Exception:
            pass
    return {}

def save_config(data: dict):
    CONFIG_PATH.write_text(json.dumps(data, indent=2))

def get_ollama_host() -> str:
    """
    Priority: OLLAMA_HOST env var → config.json → default localhost.
    Called fresh on every request so config changes apply without restart.
    """
    raw = os.environ.get("OLLAMA_HOST") or load_config().get("ollama_host", "127.0.0.1:11434")
    if not raw.startswith("http"):
        raw = f"http://{raw}"
    if raw.count(":") == 1 and not raw.endswith(":11434"):
        raw = f"{raw}:11434"
    return raw.rstrip("/")

app = FastAPI(title="LocalChat")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/api/config")
def api_get_config():
    cfg = load_config()
    host = os.environ.get("OLLAMA_HOST") or cfg.get("ollama_host", "127.0.0.1:11434")
    return {"ollama_host": host, "env_override": "OLLAMA_HOST" in os.environ}

@app.post("/api/config")
def api_save_config(body: dict):
    cfg = load_config()
    if "ollama_host" in body:
        cfg["ollama_host"] = body["ollama_host"].strip()
    save_config(cfg)
    log.info("Config saved: %s", cfg)
    return {"ok": True, "config": cfg}

@app.get("/api/models")
async def get_models():
    ollama = get_ollama_host()
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(f"{ollama}/api/tags")
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            raise HTTPException(502, f"Cannot reach Ollama at {ollama}: {exc}")

@app.post("/api/chat")
async def chat(request: Request):
    body   = await request.json()
    ollama = get_ollama_host()

    async def _stream():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", f"{ollama}/api/chat", json=body) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk

    return StreamingResponse(_stream(), media_type="application/x-ndjson")

ACCEPTED = (
    ".pdf .docx .doc .epub .odt .ods .odp "
    ".txt .md .rst .csv .json .xml .html .htm .rtf "
    ".jpg .jpeg .png .gif .webp .bmp .tiff .tif"
).split()

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    filename = file.filename or "upload"
    suffix   = Path(filename).suffix.lower()
    if suffix not in ACCEPTED:
        raise HTTPException(415, f"Unsupported file type: {suffix}")
    content = await file.read()
    if is_image(filename):
        return {"filename": filename, "type": "image",
                "base64": base64.b64encode(content).decode(), "mime_type": file.content_type}
    if is_document(filename):
        try:
            text = extract_text(content, filename)
        except Exception as exc:
            raise HTTPException(422, str(exc))
        return {"filename": filename, "type": "document", "text": text}
    raise HTTPException(415, f"Cannot handle: {suffix}")

@app.post("/api/rag/ingest")
async def rag_ingest(body: dict):
    doc_id, filename, text = body.get("doc_id",""), body.get("filename",""), body.get("text","")
    if not doc_id or not text:
        raise HTTPException(400, "doc_id and text are required")
    try:
        n = await rag_module.ingest(doc_id, filename, text, get_ollama_host())
    except Exception as exc:
        log.exception("Ingest failed for %s", filename)
        raise HTTPException(500, f"Ingest failed: {exc}")
    return {"doc_id": doc_id, "chunks": n, "filename": filename}

@app.get("/api/rag/documents")
def rag_documents():
    return rag_module.list_docs()

@app.delete("/api/rag/documents/{doc_id}")
def rag_delete(doc_id: str):
    rag_module.delete_doc(doc_id)
    return {"ok": True}

@app.post("/api/rag/retrieve")
async def rag_retrieve(body: dict):
    query, n, doc_ids = body.get("query",""), body.get("n_results",5), body.get("doc_ids")
    if not query:
        raise HTTPException(400, "query is required")
    try:
        chunks = await rag_module.retrieve(query, get_ollama_host(), n, doc_ids)
    except Exception as exc:
        log.exception("Retrieval failed")
        raise HTTPException(500, f"Retrieval failed: {exc}")
    return {"chunks": chunks}

@app.get("/api/rag/document/{doc_id}")
def rag_full_document(doc_id: str):
    result = rag_module.get_full_doc(doc_id)
    if not result["text"]:
        raise HTTPException(404, f"Document {doc_id} not found in KB")
    return result

_dist = Path(__file__).parent.parent / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="static")

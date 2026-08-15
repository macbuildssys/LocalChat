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
from starlette.concurrency import run_in_threadpool

from .parsers import extract_text, is_image, is_document
from . import rag as rag_module
from . import voice as voice_module
from . import paths as paths_module

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s: %(message)s")
log = logging.getLogger("localchat")

CONFIG_PATH = paths_module.config_dir() / "config.json"


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        legacy = Path(__file__).parent.parent / "config.json"
        if legacy.exists():
            try:
                CONFIG_PATH.write_text(legacy.read_text())
                log.info("Migrated config.json from %s to %s", legacy, CONFIG_PATH)
            except Exception:
                pass
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
    return {
        "ollama_host": host,
        "env_override": "OLLAMA_HOST" in os.environ,
        "whisper_model": cfg.get("whisper_model", "base"),
        "force_gpu": cfg.get("force_gpu", False),
        "gpu_offload_percent": cfg.get("gpu_offload_percent", DEFAULT_GPU_OFFLOAD_PERCENT),
    }

    """
    Default share of a model's layers to target on GPU when "force GPU" is on.
    Deliberately short of 100%: pushing every layer onto GPU has been observed to produce 
    garbage output on some Apple Metal / quant combinations, and can also OOM if Ollama's 
    own estimate turns out to be right after all. Landing at ~75-80% still beats Ollama's 
    typically-conservative auto-estimate while leaving a safety margin that works across
    NVIDIA, AMD, and Apple unified memory alike.
    """

DEFAULT_GPU_OFFLOAD_PERCENT = 78

# model name -> total transformer layer count, once looked up via /api/show
# Architecture doesn't change for a given tag, so this is safe to cache for the life of the process
_layer_count_cache: dict[str, int] = {}

async def get_model_layer_count(model: str, ollama: str) -> int | None:
    """
    Looks up how many transformer layers a model has, via Ollama's /api/show.
    Returns None if it can't be determined (e.g. Ollama unreachable, or the
    architecture's layer-count field isn't one we recognize) — callers should
    treat that as "don't force anything" rather than guessing.
    """
    if model in _layer_count_cache:
        return _layer_count_cache[model]

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.post(f"{ollama}/api/show", json={"model": model, "name": model})
            r.raise_for_status()
            data = r.json()
        except Exception:
            log.warning("Could not fetch /api/show for %s; skipping forced GPU offload", model)
            return None

    model_info = data.get("model_info", {}) or {}
    # Ollama exposes this per-architecture, e.g. "llama.block_count", "qwen3.block_count", "gemma3.block_count", search rather than hardcode one architecture's key name.
    for key, value in model_info.items():
        if key.endswith(".block_count") and isinstance(value, int):
            _layer_count_cache[model] = value
            return value

    log.warning("No block_count field found for %s; skipping forced GPU offload", model)
    return None

async def unload_loaded_models(ollama: str) -> list[str]:
    """
    Forces Ollama to drop every currently-loaded model from memory by re-requesting each with
    keep_alive=0. Ollama only applies num_gpu at LOAD time — a model already resident in memory
    keeps whatever CPU/GPU split it was given on its last load, so changing force_gpu or gpu_offload_percent
    has no visible effect until the model is unloaded and reloaded. 
    Called after every config save so "Save" actually takes effect on the next message, instead of silently
    doing nothing until the model happens to idle out on its own.
    """
    unloaded: list[str] = []
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(f"{ollama}/api/ps")
            r.raise_for_status()
            loaded = r.json().get("models", [])
        except Exception as exc:
            log.warning("Could not query %s/api/ps to unload models: %s", ollama, exc)
            return unloaded

        for m in loaded:
            name = m.get("name")
            if not name:
                continue
            try:
                # keep_alive=0 tells Ollama to evict the model immediately
                # after this (empty, prompt-less) request completes.
                await client.post(f"{ollama}/api/generate", json={"model": name, "keep_alive": 0})
                unloaded.append(name)
            except Exception as exc:
                log.warning("Failed to unload %s: %s", name, exc)
    if unloaded:
        log.info("Unloaded for reload with new GPU settings: %s", unloaded)
    return unloaded

@app.post("/api/config")
async def api_save_config(body: dict):
    cfg = load_config()
    prev_force_gpu = cfg.get("force_gpu", False)
    prev_percent = cfg.get("gpu_offload_percent", DEFAULT_GPU_OFFLOAD_PERCENT)

    if "ollama_host" in body:
        cfg["ollama_host"] = body["ollama_host"].strip()
    if "whisper_model" in body:
        cfg["whisper_model"] = body["whisper_model"].strip()
    if "force_gpu" in body:
        cfg["force_gpu"] = bool(body["force_gpu"])
    if "gpu_offload_percent" in body:
        try:
            pct = int(body["gpu_offload_percent"])
        except (TypeError, ValueError):
            raise HTTPException(400, "gpu_offload_percent must be an integer")
        cfg["gpu_offload_percent"] = max(10, min(100, pct))
    save_config(cfg)
    log.info("Config saved: %s", cfg)

    gpu_settings_changed = (
        cfg.get("force_gpu", False) != prev_force_gpu
        or cfg.get("gpu_offload_percent", DEFAULT_GPU_OFFLOAD_PERCENT) != prev_percent
    )
    reloaded: list[str] = []
    if gpu_settings_changed:
        # Reach out to whatever host is actually running Ollama, same resolution logic /api/chat uses, 
        # so this works identically whether Ollama is local or, as in a VM setup, a remote host.
        reloaded = await unload_loaded_models(get_ollama_host())

    return {"ok": True, "config": cfg, "reloaded_models": reloaded}

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

@app.get("/api/models/status")
async def models_status():
    """
    Reports, per currently-loaded model, whether it's fully resident on GPU
    or partially/fully spilled onto CPU. Proxies Ollama's /api/ps, which
    exposes size_vram (bytes actually placed on GPU) vs size (total).
    """
    ollama = get_ollama_host()
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(f"{ollama}/api/ps")
            r.raise_for_status()
            data = r.json()
        except Exception as exc:
            raise HTTPException(502, f"Cannot reach Ollama at {ollama}: {exc}")

    models = []
    for m in data.get("models", []):
        size = m.get("size", 0) or 0
        size_vram = m.get("size_vram", 0) or 0
        gpu_pct = round((size_vram / size) * 100) if size else 0
        models.append({
            "name": m.get("name"),
            "size": size,
            "size_vram": size_vram,
            "gpu_percent": gpu_pct,
            "fully_on_gpu": size > 0 and size_vram >= size,
        })
    cfg = load_config()
    return {
        "models": models,
        "force_gpu": cfg.get("force_gpu", False),
        "gpu_offload_percent": cfg.get("gpu_offload_percent", DEFAULT_GPU_OFFLOAD_PERCENT),
    }

@app.post("/api/chat")
async def chat(request: Request):
    body   = await request.json()
    ollama = get_ollama_host()
    cfg    = load_config()

    if cfg.get("force_gpu", False):
        model = body.get("model", "")
        total_layers = await get_model_layer_count(model, ollama) if model else None
        if total_layers:
            pct = cfg.get("gpu_offload_percent", DEFAULT_GPU_OFFLOAD_PERCENT) / 100
            target_layers = max(1, round(total_layers * pct))
            # Don't stomp on options the frontend/caller already set explicitly.
            options = body.get("options") or {}
            options.setdefault("num_gpu", target_layers)
            body["options"] = options
            log.info("force_gpu: %s -> %d/%d layers on GPU (%.0f%%)",
                      model, target_layers, total_layers, pct * 100)
        # If we couldn't determine the layer count, we deliberately leave `options` untouched and fall back
        # to Ollama's own estimate rather than guessing a raw layer number that might overshoot VRAM.

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

@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """Speech-to-text for the mic button. Fully offline via faster-whisper."""
    content = await file.read()
    if not content:
        raise HTTPException(400, "No audio received")
    try:
        text = await run_in_threadpool(voice_module.transcribe, content, file.filename or "audio.webm")
    except Exception as exc:
        log.exception("Transcription failed")
        raise HTTPException(500, f"Transcription failed: {exc}")
    return {"text": text}

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


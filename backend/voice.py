"""
Offline speech-to-text using faster-whisper (CTranslate2 build of Whisper).

Runs on CPU by design — the RTX 500 Ada's 4GB VRAM budget is already spoken
for by the Ollama models, so we don't want to fight it for GPU memory just
to transcribe a few seconds of mic audio at a time.

The model is loaded lazily on first request and kept warm in memory for the
lifetime of the process. Size is configurable via config.json / env var so
users on slower hardware can drop to "tiny" or "base".
"""
import io
import logging
import os
import threading
from pathlib import Path

log = logging.getLogger("localchat")

_model = None
_model_lock = threading.Lock()
_model_size = None

CONFIG_PATH = Path(__file__).parent.parent / "config.json"


def _configured_model_size() -> str:
    if os.environ.get("WHISPER_MODEL"):
        return os.environ["WHISPER_MODEL"]
    try:
        import json
        if CONFIG_PATH.exists():
            cfg = json.loads(CONFIG_PATH.read_text())
            return cfg.get("whisper_model", "base")
    except Exception:
        pass
    return "base"


def get_model():
    """Lazily load (or reload, if the configured size changed) the Whisper model."""
    global _model, _model_size
    wanted = _configured_model_size()
    with _model_lock:
        if _model is None or _model_size != wanted:
            from faster_whisper import WhisperModel
            log.info("Loading Whisper model '%s' (CPU, int8)...", wanted)
            _model = WhisperModel(wanted, device="cpu", compute_type="int8")
            _model_size = wanted
            log.info("Whisper model '%s' ready.", wanted)
    return _model


def transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """
    Transcribe raw audio bytes (webm/opus from MediaRecorder, wav, mp3, etc.)
    to text. Decoding is handled internally by PyAV (a faster-whisper
    dependency), which ships its own bundled ffmpeg libs — no system
    ffmpeg install required.
    """
    model = get_model()
    buf = io.BytesIO(audio_bytes)
    buf.name = filename  # faster-whisper/av uses this to guess the container format
    segments, _info = model.transcribe(buf, beam_size=1, vad_filter=True)
    text = "".join(seg.text for seg in segments).strip()
    return text

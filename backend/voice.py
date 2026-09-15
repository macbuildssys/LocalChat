"""
Offline speech-to-text using faster-whisper (CTranslate2 build of Whisper).

Runs on CPU by design 

The model is loaded lazily on first request and kept warm in memory for the
lifetime of the process. Size is configurable via config.json / env var so
users on slower hardware can drop to "tiny" or "base".
"""
import io
import logging
import os
import threading

from . import paths as paths_module

log = logging.getLogger("localchat")

_model = None
_model_lock = threading.Lock()
_model_size = None

def _configured_model_size() -> str:
    if os.environ.get("WHISPER_MODEL"):
        return os.environ["WHISPER_MODEL"]
    try:
        import json
        config_path = paths_module.config_dir() / "config.json"
        if config_path.exists():
            cfg = json.loads(config_path.read_text())
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

def _peak_amplitude(audio_bytes: bytes, filename: str) -> float:
    """
    Decode the clip with PyAV directly (bypassing Whisper/VAD entirely) and
    return the peak absolute sample value, roughly 0 to 1. This answers the
    "is there any real signal at all" question independently of Whisper's
    own VAD heuristic and its tendency to hallucinate filler words like
    "you" on near-silent input, which otherwise makes it hard to tell a
    genuinely silent recording apart from a real but very quiet one.
    """
    try:
        import av
        import numpy as np

        buf = io.BytesIO(audio_bytes)
        buf.name = filename
        container = av.open(buf)
        stream = next(s for s in container.streams if s.type == "audio")
        peak = 0.0
        for frame in container.decode(stream):
            arr = frame.to_ndarray()
            if arr.size == 0:
                continue
            sample = float(np.abs(arr).max())
            if arr.dtype.kind in ("i", "u"):
                sample = sample / float(np.iinfo(arr.dtype).max)
            peak = max(peak, sample)
        return peak
    except Exception as exc:
        log.warning("Could not measure peak amplitude for diagnostics: %s", exc)
        return -1.0

def transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """
    Transcribe raw audio bytes (webm/opus from MediaRecorder, wav, mp3, etc.)
    to text. Decoding is handled internally by PyAV (a faster-whisper
    dependency), which ships its own bundled ffmpeg libs — no system
    ffmpeg install required.
    """
    model = get_model()

    peak = _peak_amplitude(audio_bytes, filename)
    if peak >= 0:
        log.info("Recording peak amplitude: %.4f (0 = silence, 1 = full scale)", peak)

    def run(vad: bool) -> str:
        buf = io.BytesIO(audio_bytes)
        buf.name = filename  # faster-whisper/av uses this to guess the container format
        kwargs = {"beam_size": 1, "vad_filter": vad}
        if vad:
            """
                Silero VAD's default threshold (0.5) is tuned for typical
                hardware-mic loudness. The recordings we're seeing here peak
                around 0.04 to 0.05, real speech, just quiet, and the default
                threshold rejects it as silence outright. Lowering it makes
                VAD noticeably more permissive about quiet-but-real speech.
            """

            kwargs["vad_parameters"] = dict(threshold=0.3)
        segments, _info = model.transcribe(buf, **kwargs)
        return "".join(seg.text for seg in segments).strip()

    text = run(vad=True)
    if text:
        return text
    """
        The VAD filter decided there was no speech anywhere in the clip and
        discarded all of it. That's sometimes a genuinely silent recording
        (a microphone capture problem, not a code problem), but it can also
        be borderline-quiet speech that an aggressive VAD threshold strips
        entirely. Retrying without VAD tells the two apart.
    """
    log.warning("VAD filter removed all audio; retrying without it")
    fallback = run(vad=False)
    if fallback:
        log.info("Transcript recovered without VAD: %r", fallback[:80])
    else:
        log.warning("Still empty without VAD. The input audio itself appears to be silent.")
    return fallback


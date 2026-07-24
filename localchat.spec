# localchat.spec
# Build with: pyinstaller localchat.spec

import sys
from pathlib import Path

block_cipher = None

# Collect all data files
datas = [
    ("dist",    "dist"),       # React build
    ("backend", "backend"),    # Python package
]

# faster-whisper ships non-Python assets (notably the Silero VAD ONNX model
# used by vad_filter=True) as package data. collect_all("faster_whisper")
# below does NOT reliably pull these into the bundle when combined with the
# rest of this spec's collect_all list — verified by direct inspection of
# Analysis.datas, which came back empty for this package despite
# PyInstaller.utils.hooks.collect_all() finding the file fine in isolation.
# Rather than depend on that, add it explicitly so a silent regression here
# fails loudly (missing import) instead of failing at runtime deep inside
# an AppImage mount.
try:
    import faster_whisper
    _fw_assets = Path(faster_whisper.__file__).parent / "assets"
    if _fw_assets.is_dir():
        datas.append((str(_fw_assets), "faster_whisper/assets"))
except ImportError:
    raise SystemExit(
        "faster-whisper is not installed in this environment — "
        "run `pip install -r requirements.txt` before building."
    )

# All hidden imports that PyInstaller misses due to dynamic loading
hidden = [
    # uvicorn
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    # fastapi / starlette
    "fastapi",
    "fastapi.middleware",
    "fastapi.middleware.cors",
    "starlette",
    "starlette.middleware",
    "starlette.staticfiles",
    "starlette.responses",
    # anyio
    "anyio",
    "anyio._backends._asyncio",
    # httpx
    "httpx",
    # multipart
    "multipart",
    "python_multipart",
    # file parsers
    "fitz",
    "docx",
    "docx.oxml",
    "docx.oxml.ns",
    "ebooklib",
    "ebooklib.epub",
    "bs4",
    "odf",
    "odf.opendocument",
    "odf.teletype",
    "PIL",
    "PIL.Image",
    # chromadb — needs many submodules
    "chromadb",
    "chromadb.api",
    "chromadb.api.client",
    "chromadb.api.models",
    "chromadb.config",
    "chromadb.db",
    "chromadb.db.base",
    "chromadb.segment",
    "chromadb.segment.impl",
    "chromadb.segment.impl.vector",
    "chromadb.segment.impl.vector.local_persistent_hnsw",
    "chromadb.segment.impl.metadata",
    "chromadb.segment.impl.metadata.sqlite",
    "chromadb.types",
    "chromadb.utils",
    "hnswlib",
    "pysqlite3",
    # backend package
    "backend",
    "backend.main",
    "backend.parsers",
    "backend.rag",
    "backend.voice",
    "backend.paths",
    # faster-whisper / ctranslate2
    "faster_whisper",
    "ctranslate2",
    "av",
    "tokenizers",
]

a = Analysis(
    ["run.py"],
    pathex=[str(Path.cwd())],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter", "PyQt5", "PyQt6", "PySide6", "wx",
        # Pulled in transitively by chromadb's collect_all sweep but never
        # actually used at runtime — cuts well over 100MB of dead weight.
        "matplotlib", "pandas", "scipy", "sympy",
        "IPython", "notebook", "jupyter", "jupyter_client", "jupyter_core",
        "ipykernel", "sklearn", "seaborn",
    ],
    cipher=block_cipher,
    noarchive=False,
    collect_all=[
        "chromadb",
        "uvicorn",
        "fastapi",
        "starlette",
        "anyio",
        "faster_whisper",
        "ctranslate2",
        "av",
    ],
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="localchat",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,           # keep console so user sees startup messages
    disable_windowed_traceback=False,
    argv_emulation=False,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="localchat",
)

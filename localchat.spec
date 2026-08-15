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
    # chromadb.telemetry — like faster_whisper's assets above, collect_all
    # does NOT reliably pull this in despite being listed there too.
    # Missing it causes a ModuleNotFoundError deep inside
    # chromadb.config.Settings.instance() the first time any RAG endpoint
    # runs, since chroma_product_telemetry_impl defaults to a dotted path
    # under this package that gets imported dynamically via importlib.
    # (anonymized_telemetry=False, already set in rag.py, only suppresses
    # the actual telemetry *calls* — the class still needs to import
    # successfully regardless, which is what fails here.)
    "chromadb.telemetry",
    "chromadb.telemetry.product",
    "chromadb.telemetry.product.events",
    "chromadb.telemetry.product.posthog",
    # chromadb.api.rust — chromadb's default local API backend, selected
    # dynamically via chroma_api_impl (same importlib-string pattern as
    # the telemetry class above), so PyInstaller's static analysis never
    # traces into rust.py and never discovers ITS import of
    # chromadb_rust_bindings below. Both must be listed explicitly.
    "chromadb.api.rust",
    # chromadb_rust_bindings — a separate top-level package (not nested
    # under chromadb, so collect_all=["chromadb"] never reaches it)
    # containing a compiled Rust extension (.abi3.so). Listed here so
    # PyInstaller traces the import; also added to collect_all below so
    # the compiled binary itself gets copied into the bundle, not just
    # discovered.
    "chromadb_rust_bindings",
    # The rest of chromadb's dynamically-loaded local-mode components —
    # same importlib-string pattern as api.rust and telemetry above.
    # (Distributed-mode-only ones like segment_directory/memberlist_provider
    # are deliberately omitted — PersistentClient never touches those.)
    "chromadb.db.impl",
    "chromadb.db.impl.sqlite",
    "chromadb.segment.impl.manager",
    "chromadb.segment.impl.manager.local",
    "chromadb.execution",
    "chromadb.execution.executor",
    "chromadb.execution.executor.local",
    "chromadb.quota",
    "chromadb.quota.simple_quota_enforcer",
    "chromadb.rate_limit",
    "chromadb.rate_limit.simple_rate_limit",
    "chromadb.ingest",
    "chromadb.ingest.impl",
    "chromadb.ingest.impl.simple_policy",
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
        "chromadb_rust_bindings",
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

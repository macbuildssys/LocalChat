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
    excludes=["tkinter", "PyQt5", "PyQt6", "PySide6", "wx"],
    cipher=block_cipher,
    noarchive=False,
    collect_all=[
        "chromadb",
        "uvicorn",
        "fastapi",
        "starlette",
        "anyio",
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

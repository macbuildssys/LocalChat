"""
Writable-location resolver for user data (config.json, ChromaDB store).

Why this exists: when running from source, `Path(__file__).parent.parent`
is a fine place to keep config.json/chroma_db/ next to the code. But once
the app is packaged as an AppImage, the code lives inside a read-only
squashfs mount — nothing under that path can be written to. Same problem
would hit any "install to /opt/localchat and run as a normal user" .deb
layout too.

So regardless of how LocalChat is launched (source, PyInstaller onedir,
or AppImage), persistent data goes to the standard XDG locations:
  - config.json  -> $XDG_CONFIG_HOME/localchat/config.json   (~/.config/localchat/)
  - chroma_db/   -> $XDG_DATA_HOME/localchat/chroma_db/      (~/.local/share/localchat/)
"""
import os
from pathlib import Path


def _xdg(env_var: str, fallback: str) -> Path:
    base = os.environ.get(env_var, "").strip()
    return Path(base) if base else Path.home() / fallback


def config_dir() -> Path:
    d = _xdg("XDG_CONFIG_HOME", ".config") / "localchat"
    d.mkdir(parents=True, exist_ok=True)
    return d


def data_dir() -> Path:
    d = _xdg("XDG_DATA_HOME", ".local/share") / "localchat"
    d.mkdir(parents=True, exist_ok=True)
    return d

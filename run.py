#!/usr/bin/env python3
"""
LocalChat launcher works both as a normal script and as a PyInstaller bundle.
"""
import os
import sys
import subprocess
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

"""
When running from a PyInstaller bundle, sys._MEIPASS is set to the
temporary directory where bundled files are extracted
"""
def _base_dir() -> Path:
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS)          # type: ignore[attr-defined]
    return Path(__file__).parent


#HOST = "127.0.0.1"
HOST = "0.0.0.0"   # bind wide so other devices on the LAN can reach it via the Ollama Host setting
PORT = 8765
"""
Open the browser at 127.0.0.1, NOT 0.0.0.0. Browsers only treat localhost as a "secure context", 
which navigator.clipboard.writeText() requires. Loading the literal address 0.0.0.0 (or a LAN IP)
disables the Clipboard API, which was the root cause of the Copy button silently failing 
while still showing a "Copied" confirmation
"""

URL = f"http://127.0.0.1:{PORT}"

def _build_frontend_if_needed():
    """Only relevant when running from source, not from a bundle."""
    if getattr(sys, 'frozen', False):
        return
    dist = Path(__file__).parent / "dist"
    if dist.exists():
        return
    print("Building frontend (first run)...")
    r = subprocess.run(["npm", "run", "build"], cwd=Path(__file__).parent)
    if r.returncode != 0:
        sys.exit("Frontend build failed. Run: npm install && npm run build")

def _serve():
    import uvicorn
    # Direct import so PyInstaller can discover all dependencies
    from backend.main import app
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning", access_log=False)

def _wait(timeout=15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"{URL}/api/models", timeout=1)
            return True
        except Exception:
            time.sleep(0.25)
    return False

if __name__ == "__main__":
    _build_frontend_if_needed()

    t = threading.Thread(target=_serve, daemon=True)
    t.start()

    print(f"Starting LocalChat at {URL} ...")
    if not _wait():
        print("Warning: server slow to start — opening browser anyway.")

    # --no-browser: used by the build script's automated smoke test, so packaging a headless CI/VM run doesn't try to launch a real browser.
    if "--no-browser" not in sys.argv:
        webbrowser.open(URL)
    print("Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopped.")
        
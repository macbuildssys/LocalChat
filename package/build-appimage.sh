#!/usr/bin/env bash
# Builds LocalChat-x86_64.AppImage from the existing PyInstaller spec.
#
# Usage: ./package/build-appimage.sh
# Run from anywhere — the script locates the project root itself.
#
# Requires (on the build machine, not the end user's):
#   - node + npm            (frontend build)
#   - python3 + pip          (backend build)
#   - pyinstaller            (pip install pyinstaller)
#   - appimagetool           (auto-downloaded below if missing)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUILD_DIR="$ROOT/build"
APPDIR="$BUILD_DIR/AppDir"
PYI_DIST="$BUILD_DIR/pyinstaller-dist"
PYI_WORK="$BUILD_DIR/pyinstaller-work"
APPIMAGETOOL="$BUILD_DIR/appimagetool-x86_64.AppImage"

echo "==> 1/5  Building frontend (npm run build)"
if [ ! -d "$ROOT/node_modules" ]; then
  npm install --legacy-peer-deps
fi
rm -rf "$ROOT/dist"
npm run build

echo "==> 2/5  Building backend with PyInstaller"
if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "pyinstaller not found — installing into current Python environment"
  pip install pyinstaller --break-system-packages
fi
rm -rf "$PYI_DIST" "$PYI_WORK"
pyinstaller localchat.spec --noconfirm --distpath "$PYI_DIST" --workpath "$PYI_WORK"

echo "==> 3/5  Assembling AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin"
cp -r "$PYI_DIST/localchat" "$APPDIR/usr/bin/localchat"

cp "$ROOT/package/AppRun" "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"

cp "$ROOT/package/localchat.desktop" "$APPDIR/localchat.desktop"
cp "$ROOT/package/icons/localchat_256.png" "$APPDIR/localchat.png"   # root-level icon, required by appimagetool

for size in 256 128 48; do
  icon_dir="$APPDIR/usr/share/icons/hicolor/${size}x${size}/apps"
  mkdir -p "$icon_dir"
  cp "$ROOT/package/icons/localchat_${size}.png" "$icon_dir/localchat.png"
done

echo "==> 4/5  Fetching appimagetool (cached in build/ after first run)"
if [ ! -x "$APPIMAGETOOL" ]; then
  curl -L -o "$APPIMAGETOOL" \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x "$APPIMAGETOOL"
fi

echo "==> 5/5  Building AppImage"
ARCH=x86_64 "$APPIMAGETOOL" "$APPDIR" "$ROOT/LocalChat-x86_64.AppImage"

echo "==> 6/6  Smoke-testing the built AppImage"
# Source-mode testing (`python3 run.py`) runs against the VM's real
# site-packages and can't catch PyInstaller packaging gaps — a module can
# exist on disk and still fail to get bundled into the frozen binary (this
# is exactly how the chromadb.telemetry ModuleNotFoundError shipped
# unnoticed). Launch the actual .AppImage headlessly and hit the endpoints
# that exercise the trickiest bundled dependencies (chromadb/RAG, in
# particular) before calling the build done.
SMOKE_PORT=8765
export OLLAMA_HOST="127.0.0.1:11434"   # harmless if unreachable; endpoints below don't require a live model
"$ROOT/LocalChat-x86_64.AppImage" --no-browser >"$BUILD_DIR/smoke-test.log" 2>&1 &
SMOKE_PID=$!

cleanup_smoke() { kill "$SMOKE_PID" >/dev/null 2>&1 || true; }
trap cleanup_smoke EXIT

READY=0
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${SMOKE_PORT}/api/config" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -ne 1 ]; then
  echo "FAILED: server never came up — see $BUILD_DIR/smoke-test.log"
  cat "$BUILD_DIR/smoke-test.log"
  exit 1
fi

SMOKE_FAILED=0
for endpoint in "/api/config" "/api/rag/documents"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${SMOKE_PORT}${endpoint}")
  if [ "$status" != "200" ]; then
    echo "FAILED: GET ${endpoint} returned HTTP ${status} (expected 200)"
    SMOKE_FAILED=1
  fi
done

if grep -qi "Traceback (most recent call last)" "$BUILD_DIR/smoke-test.log"; then
  echo "FAILED: backend logged a traceback during smoke test — full log below"
  echo "(also saved at $BUILD_DIR/smoke-test.log)"
  echo "----"
  cat "$BUILD_DIR/smoke-test.log"
  echo "----"
  SMOKE_FAILED=1
fi

cleanup_smoke
trap - EXIT

if [ "$SMOKE_FAILED" -ne 0 ]; then
  echo
  echo "Smoke test FAILED — not shipping this build. Fix the above and rerun."
  exit 1
fi

echo "Smoke test passed — /api/config and /api/rag/documents both responded cleanly."
echo
echo "Done: $ROOT/LocalChat-x86_64.AppImage"
echo "Run it directly (chmod +x already applied by appimagetool):"
echo "  ./LocalChat-x86_64.AppImage"


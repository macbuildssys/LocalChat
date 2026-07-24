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

echo
echo "Done: $ROOT/LocalChat-x86_64.AppImage"
echo "Run it directly (chmod +x already applied by appimagetool):"
echo "  ./LocalChat-x86_64.AppImage"

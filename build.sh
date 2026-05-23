#!/usr/bin/env bash
# Usage:
#   ./build.sh              → builds as version 1.0.0
#   ./build.sh 1.2.0        → builds as version 1.2.0
#   VERSION=2.0.0 ./build.sh

set -euo pipefail

APP="LocalChat"
VERSION="${1:-${VERSION:-1.0.0}}"
ARCH="x86_64"
BUNDLE="dist/localchat"
OUT="dist/${APP}-${VERSION}-${ARCH}.AppImage"

echo "╔══════════════════════════════════════╗"
echo "║  Building ${APP} v${VERSION}"
echo "╚══════════════════════════════════════╝"

echo ""
echo "▶ Building React frontend..."
npm run build
echo "  ✓ dist/ ready"

echo ""
echo "▶ Running PyInstaller..."
pip install pyinstaller --break-system-packages -q
pyinstaller localchat.spec --noconfirm --clean
echo "  ✓ Bundle → ${BUNDLE}/"

echo ""
echo "▶ Creating AppImage..."

APPIMAGETOOL="./appimagetool-x86_64.AppImage"
if [ ! -f "$APPIMAGETOOL" ]; then
    echo "  Downloading appimagetool..."
    wget -q "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" \
         -O "$APPIMAGETOOL"
    chmod +x "$APPIMAGETOOL"
fi

APPDIR="build/AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/icons/hicolor/256x256/apps"

cp -r "${BUNDLE}/." "$APPDIR/usr/bin/"

cat > "$APPDIR/AppRun" << 'APPRUN'
#!/bin/bash
HERE=$(dirname "$(readlink -f "$0")")
exec "$HERE/usr/bin/localchat" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"

cat > "$APPDIR/localchat.desktop" << DESKTOP
[Desktop Entry]
Name=${APP}
Version=${VERSION}
Exec=localchat
Icon=localchat
Type=Application
Categories=Utility;
Comment=Offline LLM chat with Ollama
DESKTOP

cat > "$APPDIR/localchat.svg" << 'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#7c3aed"/>
  <text x="32" y="44" text-anchor="middle" font-size="36"
    font-weight="700" font-family="sans-serif" fill="white">L</text>
</svg>
SVG
cp "$APPDIR/localchat.svg" "$APPDIR/usr/share/icons/hicolor/256x256/apps/localchat.svg"

ARCH=x86_64 "$APPIMAGETOOL" "$APPDIR" "$OUT" 2>/dev/null
chmod +x "$OUT"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  Done!                               ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "  AppImage: ${OUT}"
echo "  Size:     $(du -sh "$OUT" | cut -f1)"
echo ""
echo "  Run:  OLLAMA_HOST=192.168.80.80 ./${OUT}"
echo ""
echo "  To install system-wide:"
echo "    sudo cp ./${OUT} /usr/local/bin/localchat"
echo "    sudo chmod +x /usr/local/bin/localchat"

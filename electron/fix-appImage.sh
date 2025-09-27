#!/bin/bash

set -e

APPIMAGE="$1"

if [ -z "$APPIMAGE" ] || [ ! -f "$APPIMAGE" ]; then
  echo "❌ Usage: ./fix-appimage.sh path/to/YourApp.AppImage"
  exit 1
fi

# Extract filename without extension
BASENAME=$(basename "$APPIMAGE" .AppImage)
WORKDIR="squashfs-root"

echo "📦 Extracting $APPIMAGE..."
"./$APPIMAGE" --appimage-extract > /dev/null

# Check if extraction worked
if [ ! -f "$WORKDIR/chrome-sandbox" ]; then
  echo "❌ chrome-sandbox not found in extracted AppImage. Exiting."
  exit 1
fi

echo "🔧 Fixing chrome-sandbox permissions..."
chmod 4755 "$WORKDIR/chrome-sandbox"
# sudo chown root:root "$WORKDIR/chrome-sandbox"

# Determine architecture
ARCH=$(uname -m)
echo "💻 Detected architecture: $ARCH"

if [[ "$ARCH" == "x86_64" ]]; then
  APPIMAGETOOL_URL="https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
elif [[ "$ARCH" == "aarch64" ]]; then
  APPIMAGETOOL_URL="https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-aarch64.AppImage"
else
  echo "❌ Unsupported architecture: $ARCH"
  exit 1
fi

# Download appimagetool if not already present
if [ ! -f "appimagetool.AppImage" ]; then
  echo "⬇️  Downloading appimagetool for $ARCH..."
  wget -q "$APPIMAGETOOL_URL" -O appimagetool.AppImage
  chmod +x appimagetool.AppImage
fi

# Rebuild AppImage
FIXED_APPIMAGE="${BASENAME}-fixed.AppImage"
echo "🛠️ Repacking AppImage as $FIXED_APPIMAGE..."
./appimagetool.AppImage "$WORKDIR" "$FIXED_APPIMAGE"

echo "✅ Done! Secure AppImage created: $FIXED_APPIMAGE"

# Optional: Clean up
# rm -rf "$WORKDIR"

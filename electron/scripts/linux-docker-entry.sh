#!/usr/bin/env bash
# Run inside the linux-build container (mounted repo at /workspace).
set -euo pipefail

cd /workspace

npm ci

cd electron
npm ci

npm run build
npm run bundle:reticulum

# Snap/rpm are painful inside Docker; AppImage + deb cover most sharing.
# Use one -c file only: electron-builder merges multiple -c paths incorrectly
# (only the last path wins as extends), which dropped files/build/** and broke packaging.
npx electron-builder build \
  -c ./electron-builder.config.lin.docker.json \
  --publish=never \
  -l

echo "Artifacts: electron/dist/ (installers + latest-linux.yml + *.blockmap for auto-update)"

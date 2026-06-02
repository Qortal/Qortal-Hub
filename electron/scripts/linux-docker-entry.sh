#!/usr/bin/env bash
# Run inside the linux-build container (mounted repo at /workspace).
set -euo pipefail

BUILD_ARCH="${QORTAL_LINUX_DOCKER_ARCH:-x64}"
BUILD_PROFILE="${QORTAL_LINUX_DOCKER_PROFILE:-full}"

case "${BUILD_ARCH}:${BUILD_PROFILE}" in
  x64:full)
    BUILDER_CONFIG="./electron-builder.config.lin.docker.json"
    ARTIFACT_LABEL="Linux x64 AppImage + deb"
    BUILDER_TARGETS=(--linux AppImage deb)
    ;;
  x64:appimage)
    BUILDER_CONFIG="./electron-builder.config.lin.docker.appimage.json"
    ARTIFACT_LABEL="Linux x64 AppImage only"
    BUILDER_TARGETS=(--linux AppImage)
    ;;
  arm64:full)
    BUILDER_CONFIG="./electron-builder.config.arm.json"
    ARTIFACT_LABEL="Linux arm64 AppImage + deb"
    BUILDER_TARGETS=(--linux AppImage deb --arm64)
    ;;
  arm64:appimage)
    BUILDER_CONFIG="./electron-builder.config.arm.docker.appimage.json"
    ARTIFACT_LABEL="Linux arm64 AppImage only"
    BUILDER_TARGETS=(--linux AppImage --arm64)
    ;;
  *)
    echo "Unknown Docker build target: QORTAL_LINUX_DOCKER_ARCH=${BUILD_ARCH} QORTAL_LINUX_DOCKER_PROFILE=${BUILD_PROFILE}" >&2
    exit 64
    ;;
esac

cd /workspace

npm ci

cd electron
npm ci

npm run build
npm run bundle:reticulum

# Snap/rpm are painful inside Docker; AppImage + deb cover most sharing.
# Use one -c file only: electron-builder merges multiple -c paths incorrectly
# (only the last path wins as extends), which dropped files/build/** and broke packaging.
# Pass explicit Linux targets as well so the appimage profile cannot inherit/build deb.
echo "Packaging profile: ${ARTIFACT_LABEL}"
npx electron-builder build \
  -c "${BUILDER_CONFIG}" \
  --publish=never \
  "${BUILDER_TARGETS[@]}"

echo "Artifacts: electron/dist/ (installers + latest-linux.yml + *.blockmap for auto-update)"

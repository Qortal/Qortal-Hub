#!/usr/bin/env bash
# Build Linux packages inside Debian 11 bullseye (~glibc 2.31) so frozen
# Reticulum binaries are more broadly compatible than CI (ubuntu-22.04).
#
# Usage (from anywhere):
#   ./electron/scripts/run-linux-build-in-docker.sh
#   ./electron/scripts/run-linux-build-in-docker.sh appimage
#   ./electron/scripts/run-linux-build-in-docker.sh arm64
#   ./electron/scripts/run-linux-build-in-docker.sh arm64 appimage
#
# Requires Docker or Podman. Defaults to linux/amd64; arm64 builds use linux/arm64.
set -euo pipefail

BUILD_ARCH="x64"
BUILD_PROFILE="full"

case "${1:-}" in
  "")
    ;;
  appimage|full)
    BUILD_PROFILE="$1"
    ;;
  arm|arm64|aarch64)
    BUILD_ARCH="arm64"
    BUILD_PROFILE="${2:-full}"
    ;;
  x64|amd64)
    BUILD_ARCH="x64"
    BUILD_PROFILE="${2:-full}"
    ;;
  *)
    echo "Unknown build arch/profile: ${1}" >&2
    echo "Usage: $0 [full|appimage] | [x64|arm64] [full|appimage]" >&2
    exit 64
    ;;
esac

case "${BUILD_PROFILE}" in
  full)
    PROFILE_LABEL="AppImage + deb"
    ;;
  appimage)
    PROFILE_LABEL="AppImage only"
    ;;
  *)
    echo "Unknown build profile: ${BUILD_PROFILE}" >&2
    echo "Usage: $0 [full|appimage] | [x64|arm64] [full|appimage]" >&2
    exit 64
    ;;
esac

case "${BUILD_ARCH}" in
  x64)
    CONTAINER_PLATFORM="linux/amd64"
    IMAGE_ARCH_TAG="amd64"
    ;;
  arm64)
    CONTAINER_PLATFORM="linux/arm64"
    IMAGE_ARCH_TAG="arm64"
    ;;
  *)
    echo "Unknown build arch: ${BUILD_ARCH}" >&2
    exit 64
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ELECTRON_DIR}/.." && pwd)"

HOST_MACHINE="$(uname -m)"
if [[ "${BUILD_ARCH}" == "arm64" && "${HOST_MACHINE}" != "aarch64" && "${HOST_MACHINE}" != "arm64" ]]; then
  if [[ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]]; then
    cat <<'EOF' >&2
Linux arm64 Docker builds from a non-arm64 host require QEMU/binfmt support.

Without it, the container engine can pull a linux/arm64 image but cannot run
commands inside it, usually failing with:
  exec container process `/bin/sh`: Exec format error

Ubuntu / Debian host setup:
  sudo apt update
  sudo apt install -y qemu-user-static binfmt-support

Then re-run:
  npm run electron:make-arm-docker-appimage

Alternatively, run the ARM Docker build on a native Linux arm64 machine.
EOF
    exit 69
  fi
fi

if [[ -n "${CONTAINER_CMD:-}" ]]; then
  if ! command -v "${CONTAINER_CMD}" >/dev/null 2>&1; then
    echo "CONTAINER_CMD=${CONTAINER_CMD} not found in PATH" >&2
    exit 127
  fi
  CTR=("${CONTAINER_CMD}")
elif command -v docker >/dev/null 2>&1; then
  CTR=(docker)
elif command -v podman >/dev/null 2>&1; then
  CTR=(podman)
else
  cat <<'EOF' >&2
Neither 'docker' nor 'podman' was found on PATH.

Install one of them, then re-run:
  npm run electron:make-lin-docker
  npm run electron:make-lin-docker-appimage
  npm run electron:make-arm-docker
  npm run electron:make-arm-docker-appimage

Ubuntu / Debian (simpler, distro packages):
  sudo apt update && sudo apt install -y docker.io
  sudo usermod -aG docker "$USER"
  # log out and back in, then: newgrp docker   # or reboot

Or install Podman (no daemon; rootless works for this script):
  sudo apt update && sudo apt install -y podman

Optional — Docker’s official packages: https://docs.docker.com/engine/install/ubuntu/

Override the engine: CONTAINER_CMD=docker or CONTAINER_CMD=podman
EOF
  exit 127
fi

IMAGE_NAME="${LINUX_BUILD_IMAGE:-qortal-hub-linux-build:bullseye-${IMAGE_ARCH_TAG}}"
ROOT_NODE_MODULES_VOLUME="${LINUX_BUILD_ROOT_NODE_MODULES_VOLUME:-qortal-hub-linux-build-root-node-modules-${IMAGE_ARCH_TAG}}"
ELECTRON_NODE_MODULES_VOLUME="${LINUX_BUILD_ELECTRON_NODE_MODULES_VOLUME:-qortal-hub-linux-build-electron-node-modules-${IMAGE_ARCH_TAG}}"

DOCKERFILE="${SCRIPT_DIR}/linux-build.Dockerfile"

echo "Using container engine: ${CTR[*]}"
echo "Building image ${IMAGE_NAME} (${CONTAINER_PLATFORM}, Debian 11 bullseye)…"
"${CTR[@]}" build --platform "${CONTAINER_PLATFORM}" -f "${DOCKERFILE}" -t "${IMAGE_NAME}" "${SCRIPT_DIR}"

echo "Running ${BUILD_ARCH} ${PROFILE_LABEL} build in container…"
"${CTR[@]}" run --rm \
  --platform "${CONTAINER_PLATFORM}" \
  -e "QORTAL_LINUX_DOCKER_ARCH=${BUILD_ARCH}" \
  -e "QORTAL_LINUX_DOCKER_PROFILE=${BUILD_PROFILE}" \
  -v "${REPO_ROOT}:/workspace" \
  -v "${ROOT_NODE_MODULES_VOLUME}:/workspace/node_modules" \
  -v "${ELECTRON_NODE_MODULES_VOLUME}:/workspace/electron/node_modules" \
  -w /workspace \
  "${IMAGE_NAME}" \
  bash /workspace/electron/scripts/linux-docker-entry.sh

echo "Done. Outputs are under ${REPO_ROOT}/electron/dist/"
echo "Updater metadata (if generated): ${REPO_ROOT}/electron/dist/latest-linux.yml"

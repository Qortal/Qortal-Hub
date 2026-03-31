#!/usr/bin/env bash
# Build Linux x64 packages (AppImage + deb) inside Debian 11 bullseye (~glibc 2.31) so
# frozen Reticulum binaries are more broadly compatible than CI (ubuntu-22.04).
#
# Usage (from anywhere):
#   ./electron/scripts/run-linux-build-in-docker.sh
#
# Requires Docker or Podman. On Apple Silicon, forces linux/amd64 so output matches desktop Linux x64.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ELECTRON_DIR}/.." && pwd)"

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

IMAGE_NAME="${LINUX_BUILD_IMAGE:-qortal-hub-linux-build:bullseye}"

DOCKERFILE="${SCRIPT_DIR}/linux-build.Dockerfile"

echo "Using container engine: ${CTR[*]}"
echo "Building image ${IMAGE_NAME} (Debian 11 bullseye)…"
"${CTR[@]}" build --platform linux/amd64 -f "${DOCKERFILE}" -t "${IMAGE_NAME}" "${SCRIPT_DIR}"

echo "Running npm ci + electron:make-lin equivalent in container…"
"${CTR[@]}" run --rm \
  --platform linux/amd64 \
  -v "${REPO_ROOT}:/workspace" \
  -w /workspace \
  "${IMAGE_NAME}" \
  bash /workspace/electron/scripts/linux-docker-entry.sh

echo "Done. Outputs are under ${REPO_ROOT}/electron/dist/"
echo "Updater metadata (if generated): ${REPO_ROOT}/electron/dist/latest-linux.yml"

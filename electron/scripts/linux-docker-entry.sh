#!/usr/bin/env bash
# Run inside the linux-build container (mounted repo at /workspace).
set -euo pipefail

BUILD_ARCH="${QORTAL_LINUX_DOCKER_ARCH:-x64}"
BUILD_PROFILE="${QORTAL_LINUX_DOCKER_PROFILE:-full}"
WORKSPACE_OWNER_UID="$(stat -c %u /workspace)"
WORKSPACE_OWNER_GID="$(stat -c %g /workspace)"

restore_host_ownership() {
  if [[ ! "${WORKSPACE_OWNER_UID}" =~ ^[0-9]+$ || ! "${WORKSPACE_OWNER_GID}" =~ ^[0-9]+$ ]]; then
    echo "Skipping ownership restoration: workspace owner is invalid." >&2
    return
  fi

  local generated_paths=(
    /workspace/dist
    /workspace/electron/build
    /workspace/electron/dist
    /workspace/electron/resources/__pycache__
    /workspace/electron/resources/private-transport
    /workspace/electron/resources/reticulum
  )
  local existing_paths=()
  local generated_path
  for generated_path in "${generated_paths[@]}"; do
    [[ -e "${generated_path}" ]] && existing_paths+=("${generated_path}")
  done
  if (( ${#existing_paths[@]} > 0 )); then
    chown -R "${WORKSPACE_OWNER_UID}:${WORKSPACE_OWNER_GID}" "${existing_paths[@]}"
  fi
}

# The repository is a host bind mount while this container runs as root.
# Always return generated files to the invoking user, including after failures.
trap restore_host_ownership EXIT

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

# better-sqlite3 13 ships platform prebuilds and loads them before its normal
# build/Release output. Those upstream Linux binaries may be linked against a
# newer glibc than this Debian 11 compatibility container. Force a real source
# build for Electron, then replace the preferred platform prebuild with it.
echo "Rebuilding better-sqlite3 from source for Linux ${BUILD_ARCH}…"
npm_config_force_build=1 npx electron-rebuild \
  --force \
  --build-from-source \
  --which-module better-sqlite3 \
  --arch "${BUILD_ARCH}"

BETTER_SQLITE3_BUILD="node_modules/better-sqlite3/build/Release/better_sqlite3.node"
BETTER_SQLITE3_PREBUILD="node_modules/better-sqlite3/prebuilds/linux-${BUILD_ARCH}.node"

if [[ ! -f "${BETTER_SQLITE3_BUILD}" ]]; then
  echo "Forced better-sqlite3 build did not produce ${BETTER_SQLITE3_BUILD}" >&2
  exit 1
fi

install -m 0644 "${BETTER_SQLITE3_BUILD}" "${BETTER_SQLITE3_PREBUILD}"

verify_glibc_baseline() {
  local binary_path="$1"
  local artifact_label="$2"

  python3 - "${binary_path}" "${artifact_label}" <<'PY'
import re
import subprocess
import sys

binary_path, artifact_label = sys.argv[1:]
output = subprocess.check_output(
    ["readelf", "--version-info", binary_path],
    text=True,
    stderr=subprocess.STDOUT,
)
versions = sorted(
    {(int(major), int(minor)) for major, minor in re.findall(r"GLIBC_(\d+)\.(\d+)", output)}
)
newer = [version for version in versions if version > (2, 31)]
display = ", ".join(f"GLIBC_{major}.{minor}" for major, minor in versions) or "none"
print(f"{artifact_label} glibc symbols: {display}")
if newer:
    required = ", ".join(f"GLIBC_{major}.{minor}" for major, minor in newer)
    raise SystemExit(
        f"{artifact_label} exceeds the Debian 11 glibc 2.31 baseline: {required}"
    )
PY
}

verify_glibc_baseline "${BETTER_SQLITE3_PREBUILD}" "Rebuilt better-sqlite3"

# Exercise the same prebuild path that better-sqlite3 selects at runtime.
node - <<'NODE'
const Database = require('better-sqlite3');
const database = new Database(':memory:');
const result = database.prepare('SELECT 1 AS ok').get();
database.close();
if (result?.ok !== 1) throw new Error('better-sqlite3 smoke test failed');
NODE

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

case "${BUILD_ARCH}" in
  x64)
    UNPACKED_DIR="dist/linux-unpacked"
    ;;
  arm64)
    UNPACKED_DIR="dist/linux-arm64-unpacked"
    ;;
esac

PACKAGED_BETTER_SQLITE3="${UNPACKED_DIR}/resources/app.asar.unpacked/${BETTER_SQLITE3_PREBUILD}"
if [[ ! -f "${PACKAGED_BETTER_SQLITE3}" ]]; then
  echo "Packaged better-sqlite3 binary was not found at ${PACKAGED_BETTER_SQLITE3}" >&2
  exit 1
fi
verify_glibc_baseline "${PACKAGED_BETTER_SQLITE3}" "Packaged better-sqlite3"

echo "Artifacts: electron/dist/ (installers + latest-linux.yml + *.blockmap for auto-update)"

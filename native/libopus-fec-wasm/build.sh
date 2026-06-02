#!/usr/bin/env bash
# Build libopus (static) + opus_fec_wrapper.c → ../../src/wasm-libopus-fec/libopus-fec.js (SINGLE_FILE ES6).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
OPUS_VERSION="1.4"
OPUS_ARCHIVE="opus-${OPUS_VERSION}.tar.gz"
BUILD_DIR="$ROOT/build"
OUT_DIR="$REPO_ROOT/src/wasm-libopus-fec"
OUT_JS="$OUT_DIR/libopus-fec.js"

EMS_ENV="$REPO_ROOT/.emsdk/emsdk_env.sh"
if [[ ! -f "$EMS_ENV" ]]; then
  echo "Missing emsdk. Clone and install once:"
  echo "  git clone https://github.com/emscripten-core/emsdk.git $REPO_ROOT/.emsdk"
  echo "  cd $REPO_ROOT/.emsdk && ./emsdk install 3.1.74 && ./emsdk activate 3.1.74"
  exit 1
fi
# shellcheck source=/dev/null
source "$EMS_ENV"

mkdir -p "$BUILD_DIR" "$OUT_DIR"
cd "$BUILD_DIR"
if [[ ! -d "opus-${OPUS_VERSION}" ]]; then
  curl -fsSL -o "$OPUS_ARCHIVE" "https://downloads.xiph.org/releases/opus/$OPUS_ARCHIVE"
  tar xzf "$OPUS_ARCHIVE"
fi
cd "opus-${OPUS_VERSION}"
if [[ ! -f Makefile ]]; then
  # Cross-compile for WASM (config.sub accepts wasm32-* OS like "none", not "emscripten").
  emconfigure ./configure \
    --host=wasm32-unknown-none \
    --disable-shared \
    --enable-static \
    --disable-doc \
    --disable-extra-programs \
    --disable-intrinsics
fi
emmake make -j"$(nproc 2>/dev/null || echo 4)"

emcc -O3 \
  "$ROOT/opus_fec_wrapper.c" \
  "$BUILD_DIR/opus-${OPUS_VERSION}/.libs/libopus.a" \
  -I"$BUILD_DIR/opus-${OPUS_VERSION}/include" \
  -o "$OUT_JS" \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createLibopusFecModule \
  -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web,worker \
  -sSINGLE_FILE=1 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_gcall_opus_decoder_create,_gcall_opus_decode_float,_gcall_opus_decoder_destroy \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPF32,HEAPU8

echo "Built $OUT_JS ($(wc -c < "$OUT_JS") bytes)"

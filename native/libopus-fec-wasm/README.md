# libopus FEC WASM (group call receive path)

Thin Emscripten build exposing `gcall_opus_decoder_create`, `gcall_opus_decode_float` (including `decode_fec`), and `gcall_opus_decoder_destroy` for mono Opus at 48 kHz (20 ms = 960 samples/frame).

## Prerequisites

- [Emscripten emsdk](https://emscripten.org/docs/getting_started/downloads.html) at the repo root: `.emsdk/` (install with `./emsdk install 3.1.74 && ./emsdk activate 3.1.74`).

## Build

```bash
chmod +x native/libopus-fec-wasm/build.sh
./native/libopus-fec-wasm/build.sh
```

Output: `src/wasm-libopus-fec/libopus-fec.js` (single-file ES module, wasm embedded).

Opus 1.4 is downloaded into `native/libopus-fec-wasm/build/` on first run. Configure uses `--host=wasm32-unknown-none` (cross-compile so autoconf does not try to run WASM test binaries) and `--disable-intrinsics` for wasm.

## Regenerating after C changes

Edit `opus_fec_wrapper.c`, then run `build.sh` again.

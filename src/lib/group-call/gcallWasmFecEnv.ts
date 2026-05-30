/**
 * libopus WASM FEC decode path is **always desired** (dev and prod). If the worker fails to
 * load, the hook falls back to WebCodecs. Emergency disable only: `VITE_GCALL_WASM_FEC=0` or
 * `localStorage gcallWasmFec=0` (reload app after changing localStorage).
 */

export const GCALL_WASM_FEC_ENV_OFF =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.VITE_GCALL_WASM_FEC === '0';

/** Extra jitter frames when WASM FEC is active (group inbound). */
export const GCALL_WASM_FEC_EXTRA_HOLD_FRAMES = 1;
/** Cap PCM batches posted from WASM FEC worker to playout per jitter tick. */
export const GCALL_WASM_FEC_MAX_PCM_PER_TICK = 10;

export function readGcallWasmFecDesired(): boolean {
  if (GCALL_WASM_FEC_ENV_OFF) return false;
  try {
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('gcallWasmFec') === '0'
    ) {
      return false;
    }
  } catch {
    /* private mode */
  }
  return true;
}

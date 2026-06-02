/**
 * libsodium-backed {@link SecretBoxProvider} for the audio-decrypt / encrypt worker hot path.
 *
 * The WASM XSalsa20-Poly1305 implementation is roughly 3-5× faster than tweetnacl-js on
 * modern desktop hardware and stays wire-compatible with NaCl secretbox, so peers running
 * either impl interoperate transparently.
 *
 * Usage contract:
 *   1. Call `initLibsodiumSecretBoxProvider()` and `await` its promise before using the
 *      returned provider. Calling `open`/`seal`/`randomNonce` before init resolves throws.
 *   2. `initLibsodiumSecretBoxProvider()` is idempotent and memoised; subsequent calls
 *      return the same cached provider/promise.
 *   3. Intended to run inside a Web Worker. The main-thread sync fallback keeps
 *      {@link defaultSecretBoxProvider} (tweetnacl-js) so first paint is unaffected by the
 *      ~180 KB WASM payload.
 */

import type { SecretBoxProvider } from './audioPacketCodec';
import sodiumImport from 'libsodium-wrappers-sumo';

type LibsodiumModule = typeof import('libsodium-wrappers-sumo');

let cachedProvider: SecretBoxProvider | null = null;
let initPromise: Promise<SecretBoxProvider> | null = null;

function buildProvider(sodium: LibsodiumModule): SecretBoxProvider {
  return {
    open(ciphertext, nonce, key) {
      try {
        // `crypto_secretbox_open_easy` is wire-compatible with `nacl.secretbox.open`.
        // Returns plaintext as Uint8Array on success; throws on auth failure — normalise
        // to `null` so callers can keep the `if (!plain) return null` flow.
        return sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
      } catch {
        return null;
      }
    },
    seal(plaintext, nonce, key) {
      return sodium.crypto_secretbox_easy(plaintext, nonce, key);
    },
    randomNonce() {
      return sodium.randombytes_buf(
        sodium.crypto_secretbox_NONCEBYTES
      ) as Uint8Array;
    },
  };
}

/**
 * Resolve once libsodium's WASM runtime is ready. Main thread keeps tweetnacl-js as the
 * sync fallback; this is the worker-side entrypoint.
 */
export function initLibsodiumSecretBoxProvider(): Promise<SecretBoxProvider> {
  if (cachedProvider) return Promise.resolve(cachedProvider);
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const sodium = (sodiumImport as unknown as { default?: LibsodiumModule }).default ??
      (sodiumImport as unknown as LibsodiumModule);
    await sodium.ready;
    cachedProvider = buildProvider(sodium);
    return cachedProvider;
  })();
  return initPromise;
}

/**
 * Synchronous accessor for the libsodium provider. Returns `null` until
 * {@link initLibsodiumSecretBoxProvider} has resolved at least once.
 */
export function getLibsodiumSecretBoxProviderIfReady(): SecretBoxProvider | null {
  return cachedProvider;
}

/**
 * Test-only reset. Leaves the cached WASM module alone (libsodium has no teardown hook)
 * but forces the next `initLibsodiumSecretBoxProvider()` call to re-resolve.
 */
export function __resetLibsodiumSecretBoxProviderForTests(): void {
  cachedProvider = null;
  initPromise = null;
}

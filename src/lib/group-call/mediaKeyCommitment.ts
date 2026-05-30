/**
 * Media session key commitment: SHA-256 hex over
 *   K (32 bytes) || utf8(callSessionId) || mediaSessionGeneration (uint32 BE)
 * Matches electron/src/group-call.ts verification fields (wire-compatible).
 */
export async function buildMediaKeyCommitmentHex(
  k: Uint8Array,
  callSessionId: string,
  mediaSessionGeneration: number
): Promise<string> {
  if (k.length !== 32) {
    throw new Error('media key must be 32 bytes');
  }
  const te = new TextEncoder();
  const sid = te.encode(callSessionId);
  const gen = new Uint8Array(4);
  new DataView(gen.buffer).setUint32(0, mediaSessionGeneration >>> 0, false);
  const total = k.length + sid.length + 4;
  const buf = new Uint8Array(total);
  buf.set(k, 0);
  buf.set(sid, k.length);
  buf.set(gen, k.length + sid.length);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

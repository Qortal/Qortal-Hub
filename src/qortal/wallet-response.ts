/** Bound untrusted node responses even when Content-Length is absent. */
export async function readBoundedWalletResponse(
  response: Response,
  maximumBytes: number
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Invalid wallet response');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new Error('Wallet response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

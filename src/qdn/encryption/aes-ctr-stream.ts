import aesjs from 'aes-js';
import i18n from '../../i18n/i18n';

/** Decrypt a network chunk at its byte offset, regardless of read boundaries. */
export async function decryptAesCtrChunk(
  key: Uint8Array,
  iv: Uint8Array,
  byteOffset: number,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const failure = () =>
    new Error(i18n.t('question:message.error.decryption_failed'));
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    iv.length !== 16 ||
    ![16, 24, 32].includes(key.length)
  )
    throw failure();

  const counter = new Uint8Array(iv);
  let carry = BigInt(byteOffset) / 16n;
  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(counter[i]) + (carry & 255n);
    counter[i] = Number(sum & 255n);
    carry = (carry >> 8n) + (sum >> 8n);
  }

  // A ReadableStream chunk need not begin on an AES block boundary. Consume
  // the unused keystream prefix, then discard it. Only this chunk is buffered.
  const skip = byteOffset % 16;
  const input = skip
    ? new Uint8Array(skip + ciphertext.byteLength)
    : ciphertext;
  if (skip) input.set(ciphertext, skip);
  if (globalThis.crypto?.subtle) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key as Uint8Array<ArrayBuffer>,
        'AES-CTR',
        false,
        ['decrypt']
      );
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-CTR', counter, length: 128 },
        cryptoKey,
        input as Uint8Array<ArrayBuffer>
      );
      return new Uint8Array(plaintext).subarray(skip);
    } catch {
      // Keep the existing aes-js fallback for web environments without AES-CTR.
    }
  }
  try {
    const aesCtr = new aesjs.ModeOfOperation.ctr(
      key,
      new aesjs.Counter(counter)
    );
    return new Uint8Array(aesCtr.decrypt(input)).subarray(skip);
  } catch {
    throw failure();
  }
}

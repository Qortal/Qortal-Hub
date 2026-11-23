/**
 * Text and JSON as the base64 QDN publishes expect: UTF-8 bytes, standard
 * base64, no `data:` prefix (what Q-Tube's and qapp-core's objectToBase64
 * produce through a Blob and FileReader).
 */

const BINARY_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += BINARY_CHUNK) {
    binary += String.fromCharCode(
      ...bytes.subarray(start, start + BINARY_CHUNK)
    );
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export const utf8Bytes = (text: string): Uint8Array =>
  new TextEncoder().encode(text);

export const textToBase64 = (text: string): string =>
  bytesToBase64(utf8Bytes(text));

export const jsonToBase64 = (value: unknown): string =>
  textToBase64(JSON.stringify(value));

/** Bytes the node stores for a base64 payload. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** The base64 part of a `data:` URL, or null when it isn't a base64 one. */
export function dataUrlBase64(dataUrl: string): string | null {
  const match = /^data:[^;,]*(?:;[^;,]*)*;base64,(.*)$/s.exec(dataUrl);
  return match ? match[1] : null;
}

export function dataUrlMimeType(dataUrl: string): string | null {
  const match = /^data:([^;,]*)/.exec(dataUrl);
  return match ? match[1] || null : null;
}

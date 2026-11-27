export const PDF_MIME_TYPE = 'application/pdf';

// Declared types that are routinely reported for a PDF by operating systems,
// `fetch` of a QDN resource with a missing or stale Content-Type, and native
// file pickers. None of them may block the viewer.
const PDF_LIKE_MIME_TYPES = new Set([
  PDF_MIME_TYPE,
  'application/x-pdf',
  'application/acrobat',
  'application/vnd.pdf',
  'text/pdf',
  'text/x-pdf',
]);

// A generic binary type carries no information about the content, so it cannot
// be used to reject the request either.
const UNKNOWN_MIME_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/unknown',
]);

// MIME types are case-insensitive and may carry parameters such as
// `application/pdf;charset=utf-8`.
export function normalizeDeclaredType(value: unknown): string {
  return typeof value === 'string'
    ? value.split(';')[0].trim().toLowerCase()
    : '';
}

function hasPdfFileName(value: unknown): boolean {
  return typeof value === 'string' && /\.pdf$/i.test(value.trim());
}

/**
 * Decide whether a `SHOW_PDF_READER` payload is plausibly a PDF.
 *
 * Q-Apps hand over Blobs whose declared MIME type is frequently empty or
 * decorated, and the transport metadata is not always identical to the type of
 * the resolved Blob. A false rejection here blocks a PDF that PDF.js could
 * display, so only a declaration that positively rules out PDF is rejected,
 * and only when the file name does not identify it as one. PDF.js still
 * validates the actual bytes before rendering.
 */
export function isPdfReaderPayload(types: unknown[], fileName?: unknown) {
  const declared = types.map(normalizeDeclaredType).filter(Boolean);
  if (declared.some((type) => PDF_LIKE_MIME_TYPES.has(type))) return true;
  const contradicts = declared.some((type) => !UNKNOWN_MIME_TYPES.has(type));
  if (contradicts) return hasPdfFileName(fileName);
  return true;
}

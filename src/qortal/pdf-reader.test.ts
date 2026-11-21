import { describe, expect, it } from 'vitest';
import { isPdfReaderPayload, normalizeDeclaredType } from './pdf-reader';

describe('SHOW_PDF_READER payload validation', () => {
  it.each([
    'application/pdf',
    'APPLICATION/PDF',
    ' application/pdf ',
    'application/pdf;charset=utf-8',
    'application/pdf; version=1.7',
    'application/x-pdf',
    'application/acrobat',
    'application/vnd.pdf',
    'text/pdf',
    'text/x-pdf',
  ])('accepts the declared PDF type %j', (type) => {
    expect(isPdfReaderPayload([type])).toBe(true);
  });

  // This is the regression: a Q-App builds the Blob without a type, or the
  // type is lost by the transport, and the viewer used to refuse to open it.
  it.each([
    ['no declared type', ['']],
    ['undefined type', [undefined]],
    ['null type', [null]],
    ['generic binary', ['application/octet-stream']],
    ['unknown application type', ['application/unknown']],
    ['decorated generic binary', ['application/octet-stream;charset=utf-8']],
  ])('accepts a %s so PDF.js can validate the bytes', (_label, types) => {
    expect(isPdfReaderPayload(types as unknown[])).toBe(true);
  });

  it('accepts a PDF identified by its file name', () => {
    expect(isPdfReaderPayload(['text/plain'], 'report.PDF')).toBe(true);
    expect(isPdfReaderPayload([''], 'report.pdf')).toBe(true);
  });

  it('accepts when the transport metadata or the Blob carries a PDF type', () => {
    expect(isPdfReaderPayload(['', 'application/pdf'])).toBe(true);
    expect(isPdfReaderPayload(['application/pdf', ''])).toBe(true);
  });

  it.each([
    ['image/png'],
    ['text/html'],
    ['text/plain'],
    ['video/mp4'],
    ['application/zip'],
  ])('rejects the contradicting type %j', (type) => {
    expect(isPdfReaderPayload([type])).toBe(false);
  });

  it('rejects a contradicting type even when another declaration is generic', () => {
    expect(
      isPdfReaderPayload(['application/octet-stream', 'image/png'], 'image.png')
    ).toBe(false);
  });

  it('normalizes case, parameters and surrounding whitespace', () => {
    expect(normalizeDeclaredType('  Application/PDF ; q=1 ')).toBe(
      'application/pdf'
    );
    expect(normalizeDeclaredType(undefined)).toBe('');
    expect(normalizeDeclaredType(7)).toBe('');
  });
});

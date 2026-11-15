import { describe, expect, it, vi } from 'vitest';

// Output shrinks with quality and the size box, like a real encoder. It
// starts with a GIF signature so the publish-time metadata check (which lets
// GIFs through as they are) accepts it without a real encoder.
vi.mock('../../../utils/imageCompression', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/imageCompression')>()),
  compressImageFile: vi.fn(
    async (
      file: File,
      options: { first: { quality: number; maxWidth: number } }
    ) => {
      const box = Math.min(1, options.first.maxWidth / 1920);
      const bytes = new Uint8Array(
        Math.floor(file.size * options.first.quality * box)
      );
      bytes.set(Buffer.from('GIF89a', 'latin1'));
      return new File([bytes], 'x.webp', { type: 'image/webp' });
    }
  ),
}));

import {
  assertPostFitsQuitter,
  POST_IMAGE_BUDGET,
  QUITTER_MAX_POST_BYTES,
  shrinkPostImagesToBudget,
} from './quitterPublish';

const photo = (bytes: number) =>
  new File([new Uint8Array(bytes)], 'shot.png', { type: 'image/png' });
const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;

describe('shrinkPostImagesToBudget', () => {
  it('leaves photos alone when they already fit', async () => {
    const encoded = ['a'.repeat(100), 'b'.repeat(100)];
    expect(
      await shrinkPostImagesToBudget([photo(75), photo(75)], encoded, 1000)
    ).toEqual(encoded);
  });

  it('re-compresses the largest photos until the set fits', async () => {
    const files = [photo(3000), photo(300)];
    const encoded = [
      'x'.repeat(base64Length(3000)),
      'y'.repeat(base64Length(300)),
    ];
    const fitted = await shrinkPostImagesToBudget(files, encoded, 3000);
    const total = fitted.reduce((sum, src) => sum + src.length, 0);
    expect(total).toBeLessThanOrEqual(3000);
    // The small photo was under its share and kept its original encoding.
    expect(fitted[1]).toBe(encoded[1]);
  });

  it('gives up with an error when even the strongest step is too big', async () => {
    const files = [photo(90_000)];
    const encoded = ['x'.repeat(base64Length(90_000))];
    await expect(
      shrinkPostImagesToBudget(files, encoded, 1000)
    ).rejects.toThrow(
      'These images are too large to post together. Remove an image and try again.'
    );
  });
});

describe('assertPostFitsQuitter', () => {
  it('refuses a post Torq and Quitter lists would skip (5 MiB or more)', () => {
    expect(POST_IMAGE_BUDGET).toBeLessThan(QUITTER_MAX_POST_BYTES);
    const justUnder = 'A'.repeat(
      Math.floor(((QUITTER_MAX_POST_BYTES - 1) * 4) / 3)
    );
    expect(() => assertPostFitsQuitter(justUnder)).not.toThrow();
    const over = 'A'.repeat(Math.ceil((QUITTER_MAX_POST_BYTES * 4) / 3));
    expect(() => assertPostFitsQuitter(over)).toThrow(
      'This post is over 5 MB, so Torq would not show it. Shorten it or remove an image.'
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  centerCrop,
  dataUrlToBlob,
  fitWithin,
  type ImageBackend,
  makeCover,
  makeExtracts,
  makeQshareThumbnail,
  QSHARE_THUMBNAIL_MAX_BYTES,
  toWebp,
} from './images';

/** A backend that records what it was asked to draw. */
function fakeBackend(
  size = { width: 1920, height: 1080 },
  bytesFor: (width: number, quality: number) => number = () => 1000
) {
  const calls: { crop: unknown; size: unknown; quality: number }[] = [];
  const close = vi.fn();
  const backend: ImageBackend = {
    decode: vi.fn(async () => ({
      ...size,
      async encode(crop, out, quality) {
        calls.push({ crop, size: out, quality });
        return new Blob([new Uint8Array(bytesFor(out.width, quality))], {
          type: 'image/webp',
        });
      },
      close,
    })),
  };
  return { backend, calls, close };
}

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('sizes', () => {
  it('fits a box without enlarging', () => {
    expect(fitWithin({ width: 1920, height: 1080 }, 1200)).toEqual({
      width: 1200,
      height: 675,
    });
    expect(fitWithin({ width: 640, height: 360 }, 1200)).toEqual({
      width: 640,
      height: 360,
    });
    expect(fitWithin({ width: 1080, height: 1920 }, 750, 750)).toEqual({
      width: 422,
      height: 750,
    });
  });

  it('crops the centre to a ratio', () => {
    expect(centerCrop({ width: 1920, height: 1080 }, 2 / 3)).toEqual({
      sx: 600,
      sy: 0,
      sw: 720,
      sh: 1080,
    });
    expect(centerCrop({ width: 600, height: 1200 }, 2 / 3)).toEqual({
      sx: 0,
      sy: 150,
      sw: 600,
      sh: 900,
    });
  });
});

describe('WebP images', () => {
  it('makes the Q-Tube cover at 0.6, 1200 px wide at most', async () => {
    const { backend, calls, close } = fakeBackend();
    const cover = await makeCover(JPEG, {}, backend);
    expect(cover).toMatch(/^data:image\/webp;base64,/);
    expect(calls).toEqual([
      {
        crop: { sx: 0, sy: 0, sw: 1920, sh: 1080 },
        size: { width: 1200, height: 675 },
        quality: 0.6,
      },
    ]);
    expect(close).toHaveBeenCalled();
  });

  it('crops a Subscreen poster to 2:3', async () => {
    const { backend, calls } = fakeBackend();
    await makeCover(JPEG, { poster: true }, backend);
    expect(calls[0].size).toEqual({ width: 720, height: 1080 });
  });

  it('makes four hover frames at 0.8, 750 px wide at most', async () => {
    const { backend, calls } = fakeBackend();
    const frames = await makeExtracts([JPEG, JPEG, JPEG, JPEG, JPEG], backend);
    expect(frames).toHaveLength(4);
    expect(calls.map((c) => [c.size, c.quality])).toEqual(
      Array(4).fill([{ width: 750, height: 422 }, 0.8])
    );
  });

  it('steps a Q-Share thumbnail down until it fits 200 KB', async () => {
    const { backend, calls } = fakeBackend(undefined, (width, quality) =>
      width <= 480 ? 150_000 : quality < 0.6 ? 210_000 : 400_000
    );
    const thumbnail = await makeQshareThumbnail(JPEG, backend);
    expect(thumbnail).toMatch(/^data:image\/webp;base64,/);
    expect(
      calls.map((c) => [(c.size as { width: number }).width, c.quality])
    ).toEqual([
      [640, 0.8],
      [640, 0.7],
      [640, 0.6],
      [640, 0.5],
      [480, 0.5],
    ]);
  });

  it('gives up on a thumbnail that never fits', async () => {
    const { backend, close } = fakeBackend(
      undefined,
      () => QSHARE_THUMBNAIL_MAX_BYTES + 1
    );
    await expect(makeQshareThumbnail(JPEG, backend)).rejects.toMatchObject({
      code: 'image-too-large',
    });
    expect(close).toHaveBeenCalled();
  });

  it('refuses something that is not a data URL or has no size', async () => {
    expect(() => dataUrlToBlob('https://x/y.jpg')).toThrow(
      expect.objectContaining({ code: 'image-unreadable' })
    );
    const { backend } = fakeBackend({ width: 0, height: 0 });
    await expect(
      toWebp(JPEG, { maxWidth: 10, quality: 1 }, backend)
    ).rejects.toMatchObject({ code: 'image-unreadable' });
  });

  it('turns a data URL into a typed Blob', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,AAEC');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });
});

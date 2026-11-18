import { describe, expect, it, vi } from 'vitest';
import * as screenshot from './qapp-screenshot';
import {
  encodeCapturedShot,
  fitShotSize,
  parseShotRequest,
} from './qapp-screenshot';

describe('parseShotRequest', () => {
  it('accepts a capture only', () => {
    expect(parseShotRequest({ action: 'capture' })).toEqual({
      action: 'capture',
    });
    expect(parseShotRequest({ action: 'capture', index: 3 })).toEqual({
      action: 'capture',
    });
  });

  it('refuses anything that would act inside the app', () => {
    for (const request of [
      { action: 'targets' },
      { action: 'click', index: 0 },
      { action: 'scroll' },
      { action: 'eval', code: 'x' },
      { action: 'CAPTURE' },
      {},
      'capture',
      null,
      undefined,
    ]) {
      expect(parseShotRequest(request)).toBeNull();
    }
  });

  it('has no scripts to run in the guest', () => {
    expect(Object.keys(screenshot).sort()).toEqual([
      'SHOT_MAX_SIDE',
      'encodeCapturedShot',
      'fitShotSize',
      'parseShotRequest',
    ]);
  });
});

describe('encoding a capture', () => {
  const fakeImage = (width: number, height: number) => {
    const image = {
      isEmpty: () => width === 0,
      getSize: () => ({ width, height }),
      resize: vi.fn((size: { width: number; height: number }) =>
        fakeImage(size.width, size.height)
      ),
      toPNG: () => new Uint8Array([width % 256]),
    };
    return image;
  };

  it('shrinks big captures', () => {
    const image = fakeImage(3200, 2000);
    const shot = encodeCapturedShot(image);
    expect(shot).toEqual({
      png: new Uint8Array([1600 % 256]),
      width: 1600,
      height: 1000,
    });
    expect(image.resize).toHaveBeenCalledTimes(1);
  });

  it('keeps small captures as they are', () => {
    const image = fakeImage(1200, 750);
    const shot = encodeCapturedShot(image);
    expect(shot).toEqual({
      png: new Uint8Array([1200 % 256]),
      width: 1200,
      height: 750,
    });
    expect(image.resize).not.toHaveBeenCalled();
  });

  it('refuses an empty capture', () => {
    expect(() => encodeCapturedShot(fakeImage(0, 0))).toThrow('SHOT_EMPTY');
  });

  it('fits sizes, keeping the aspect', () => {
    expect(fitShotSize(1000, 4000)).toEqual({ width: 400, height: 1600 });
    expect(fitShotSize(800, 500)).toEqual({ width: 800, height: 500 });
    expect(fitShotSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

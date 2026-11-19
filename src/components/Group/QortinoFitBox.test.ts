import { describe, expect, it } from 'vitest';
import { fitScale } from './QortinoFitBox';

const PLAYER = { height: 280, width: 240 };

describe('fitScale', () => {
  it('fits the content both ways', () => {
    // The default Workspace: short, so its height decides.
    expect(fitScale({ height: 220, width: 323 }, PLAYER)).toBe(0.79);
    // A narrow one: its width decides.
    expect(fitScale({ height: 400, width: 180 }, PLAYER)).toBe(0.75);
  });

  it('grows in a big window only as far as it may', () => {
    expect(fitScale({ height: 560, width: 600 }, PLAYER)).toBe(1);
    expect(fitScale({ height: 560, width: 600 }, PLAYER, { max: 1.5 })).toBe(
      1.5
    );
    expect(fitScale({ height: 420, width: 600 }, PLAYER, { max: 1.5 })).toBe(
      1.5
    );
    expect(fitScale({ height: 350, width: 600 }, PLAYER, { max: 1.5 })).toBe(
      1.25
    );
  });

  it('keeps a small window from making it too small to use', () => {
    expect(fitScale({ height: 60, width: 60 }, PLAYER)).toBe(0.4);
    expect(fitScale({ height: 60, width: 60 }, PLAYER, { min: 0.5 })).toBe(0.5);
  });

  it('leaves a box that is not laid out alone', () => {
    expect(fitScale({ height: 0, width: 0 }, PLAYER)).toBe(1);
  });
});

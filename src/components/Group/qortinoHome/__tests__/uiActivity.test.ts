import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UI_IDLE_AFTER_MS, UI_IDLE_ATTR, watchUiActivity } from '../uiActivity';

const idle = () => document.documentElement.getAttribute(UI_IDLE_ATTR) === 'on';

describe('Whether someone is using Hub', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.removeAttribute(UI_IDLE_ATTR);
  });

  it('goes idle without input, and back on the next move', () => {
    const stop = watchUiActivity();
    expect(idle()).toBe(false);
    vi.advanceTimersByTime(UI_IDLE_AFTER_MS + 1);
    expect(idle()).toBe(true);
    window.dispatchEvent(new Event('pointermove'));
    expect(idle()).toBe(false);
    stop();
  });

  it('is idle while the window is in the background', () => {
    const stop = watchUiActivity();
    window.dispatchEvent(new Event('blur'));
    expect(idle()).toBe(true);
    window.dispatchEvent(new Event('focus'));
    expect(idle()).toBe(false);
    stop();
  });

  it('stops watching once the last watcher stops, and clears the mark', () => {
    const first = watchUiActivity();
    const second = watchUiActivity();
    window.dispatchEvent(new Event('blur'));
    first();
    expect(idle()).toBe(true);
    second();
    expect(idle()).toBe(false);
    window.dispatchEvent(new Event('blur'));
    expect(idle()).toBe(false);
  });
});

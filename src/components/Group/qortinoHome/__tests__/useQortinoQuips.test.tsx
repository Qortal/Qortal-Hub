import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NEXT_QUIP_DELAY_MS,
  QUIPS_PER_SESSION,
  resetQortinoQuipsForTests,
  useQortinoQuips,
} from '../useQortinoQuips';

// The tests set Hub's idle mark themselves.
vi.mock('../uiActivity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../uiActivity')>()),
  watchUiActivity: () => () => undefined,
}));

let intersecting = true;
const observers: Array<(entries: { isIntersecting: boolean }[]) => void> = [];

class FakeIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    observers.push(callback);
  }
  observe() {
    observers[observers.length - 1]([{ isIntersecting: intersecting }]);
  }
  disconnect() {}
}

function useHarness(props: { enabled?: boolean; blocked?: boolean }) {
  const ref = useRef<HTMLElement | null>(document.createElement('div'));
  return useQortinoQuips({
    aiReady: false,
    blocked: props.blocked ?? false,
    enabled: props.enabled ?? true,
    resolveText: (quip) => `words for ${quip.key}`,
    targetRef: ref,
  });
}

const setIdle = (idle: boolean) => {
  if (idle) document.documentElement.setAttribute('data-hub-ui-idle', 'on');
  else document.documentElement.removeAttribute('data-hub-ui-idle');
};

describe('When Qortino speaks on Home', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    intersecting = true;
    observers.length = 0;
    resetQortinoQuipsForTests();
    setIdle(false);
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    // Every visit gets its early line.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setIdle(false);
  });

  it('says his first line a few seconds into a visit, then stops', async () => {
    const { result } = renderHook(() => useHarness({}));
    expect(result.current.quip).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_500);
    });
    expect(result.current.quip?.key).toBe('quips.promo.intro');
    expect(result.current.quip?.text).toBe('words for quips.promo.intro');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(result.current.quip).toBeNull();
  });

  it('counts no time while Hub sits untouched', async () => {
    setIdle(true);
    const { result } = renderHook(() => useHarness({}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.quip).toBeNull();
    setIdle(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_500);
    });
    expect(result.current.quip).not.toBeNull();
  });

  it('stays quiet while off screen or not signed up', async () => {
    intersecting = false;
    const offScreen = renderHook(() => useHarness({}));
    const disabled = renderHook(() => useHarness({ enabled: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(offScreen.result.current.quip).toBeNull();
    expect(disabled.result.current.quip).toBeNull();
  });

  it('stops talking when something else needs his bubble', async () => {
    const { result, rerender } = renderHook(
      (props: { blocked: boolean }) => useHarness(props),
      { initialProps: { blocked: false } }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_500);
    });
    expect(result.current.quip).not.toBeNull();
    rerender({ blocked: true });
    expect(result.current.quip).toBeNull();
  });

  it(`says at most ${QUIPS_PER_SESSION} lines per run of Hub`, async () => {
    const { result } = renderHook(() => useHarness({}));
    let said = 0;
    let lastId = 0;
    for (let i = 0; i < 400; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      const id = result.current.quip?.id ?? 0;
      if (id && id !== lastId) {
        said += 1;
        lastId = id;
      }
    }
    expect(said).toBe(QUIPS_PER_SESSION);
  });

  it('leaves a gap of over a minute between two lines', async () => {
    const { result } = renderHook(() => useHarness({}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_500);
    });
    const first = result.current.quip?.id;
    expect(first).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NEXT_QUIP_DELAY_MS[0] - 2_000);
    });
    expect(result.current.quip?.id ?? first).toBe(first);
  });
});

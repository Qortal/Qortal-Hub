import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACTIVITY_SETTINGS } from '../../lib/explorer/activitySettings';
import {
  createExplorerCache,
  type ExplorerCache,
} from '../../lib/explorer/cache';
import type { ReadSpec } from '../../lib/explorer/reads';
import { ExplorerContext, type ExplorerContextValue } from './ExplorerContext';
import { useKeptRead, type KeptRead } from './useKeptRead';

// What a part shows while a read again fails: the last answer for the same
// key, never another key's.

function contextWith(
  cache: ExplorerCache,
  version: number
): ExplorerContextValue {
  return {
    cache,
    version,
    viewer: null,
    access: 'basic',
    openAccount: vi.fn(),
    openTransaction: vi.fn(),
    openName: vi.fn(),
    openChain: vi.fn(),
    refresh: vi.fn(),
    close: vi.fn(),
    activity: DEFAULT_ACTIVITY_SETTINGS,
    openActivitySettings: vi.fn(),
  };
}

let latest: KeptRead<string> | null = null;

function Reader({ spec }: { spec: ReadSpec<string> }) {
  latest = useKeptRead(spec);
  return null;
}

const spec = (key: string, load: () => Promise<string>): ReadSpec<string> => ({
  key,
  ttlMs: 60_000,
  load,
});

const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const failing = () => Promise.reject(new Error('busy'));

describe('useKeptRead', () => {
  it('keeps the last answer for its key while it is read again, and when that read fails', async () => {
    const cache = createExplorerCache();
    let load: () => Promise<string> = async () => 'first';
    const reader = (version: number) => (
      <ExplorerContext.Provider value={contextWith(cache, version)}>
        <Reader spec={spec('holdings:Q1', () => load())} />
      </ExplorerContext.Provider>
    );
    const view = render(reader(0));
    await settle();
    expect(latest).toMatchObject({
      data: 'first',
      status: 'ready',
      stale: false,
    });
    // A Refresh: its key is forgotten and read again, and that read fails.
    load = failing;
    cache.forget((key) => key.endsWith(':Q1'));
    view.rerender(reader(1));
    await settle();
    expect(latest).toMatchObject({
      data: 'first',
      status: 'error',
      stale: true,
    });
    // Read again and answered: the new answer, no longer kept.
    load = async () => 'second';
    act(() => latest?.retry());
    await settle();
    expect(latest).toMatchObject({
      data: 'second',
      status: 'ready',
      stale: false,
    });
  });

  it('another key starts empty: what was read for one account never shows for the next', async () => {
    const cache = createExplorerCache();
    const reader = (key: string, load: () => Promise<string>) => (
      <ExplorerContext.Provider value={contextWith(cache, 0)}>
        <Reader spec={spec(key, load)} />
      </ExplorerContext.Provider>
    );
    const view = render(reader('holdings:Q1', async () => 'first'));
    await settle();
    expect(latest?.data).toBe('first');
    view.rerender(reader('holdings:Q2', failing));
    expect(latest).toMatchObject({ data: undefined, stale: false });
    await settle();
    expect(latest).toMatchObject({
      data: undefined,
      status: 'error',
      stale: false,
    });
  });
});

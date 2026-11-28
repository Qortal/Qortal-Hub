import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createExplorerCache } from '../../lib/explorer/cache';
import type { ReadSpec } from '../../lib/explorer/reads';
import {
  ExplorerContext,
  useExplorer,
  useExplorerRead,
  type ExplorerContextValue,
  type ReadState,
} from './ExplorerContext';

const later = () => {
  let resolve: (value: string) => void = () => undefined;
  const promise = new Promise<string>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

function contextWith(): ExplorerContextValue {
  return {
    cache: createExplorerCache(),
    version: 0,
    viewer: null,
    access: 'basic',
    openAccount: vi.fn(),
    openTransaction: vi.fn(),
    openName: vi.fn(),
    refresh: vi.fn(),
    close: vi.fn(),
  };
}

let latest: ReadState<string> | null = null;

function Reader({ spec }: { spec: ReadSpec<string> }) {
  latest = useExplorerRead(spec);
  return <span>{latest.data ?? latest.status}</span>;
}

describe('useExplorerRead', () => {
  it('shows the newest read when an older one comes back after it', async () => {
    const first = later();
    const second = later();
    const load = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const spec: ReadSpec<string> = { key: 'account:Q1', ttlMs: 60_000, load };
    render(
      <ExplorerContext.Provider value={contextWith()}>
        <Reader spec={spec} />
      </ExplorerContext.Provider>
    );
    // Retry while the first read is still on its way.
    act(() => latest?.retry());
    await act(async () => {
      second.resolve('newer');
      await second.promise;
    });
    await act(async () => {
      first.resolve('older');
      await first.promise;
    });
    expect(screen.getByText('newer')).toBeInTheDocument();
    expect(screen.queryByText('older')).not.toBeInTheDocument();
  });

  it('reports a failure as a state of its own, with no answer', async () => {
    const spec: ReadSpec<string> = {
      key: 'account:Q2',
      ttlMs: 60_000,
      load: () => Promise.reject(new Error('busy')),
    };
    render(
      <ExplorerContext.Provider value={contextWith()}>
        <Reader spec={spec} />
      </ExplorerContext.Provider>
    );
    expect(await screen.findByText('error')).toBeInTheDocument();
    expect(latest?.data).toBeUndefined();
  });

  it('refuses to work outside the Explorer window', () => {
    const Outside = () => {
      useExplorer();
      return null;
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Outside />)).toThrow(/ExplorerWindow/);
  });
});

import { useState } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import {
  ACCOUNT_HISTORY_MAX,
  accountTxKey,
  type AccountTxList,
} from '../../../lib/explorer/accountTx';
import { DEFAULT_ACTIVITY_SETTINGS } from '../../../lib/explorer/activitySettings';
import { createExplorerCache } from '../../../lib/explorer/cache';
import type { TxRow } from '../../../lib/explorer/reads';
import {
  ExplorerContext,
  ExplorerStepContext,
  type ExplorerContextValue,
  type StepState,
} from '../ExplorerContext';
import { useAccountHistory, type AccountHistory } from './useAccountHistory';

// The Overview's whole-history read at the Explorer's most: one row says
// whether there are more, so a history of exactly 20,000 isn't called longer.

const ADDRESS = `Q${'P'.repeat(33)}`;

const row = (n: number): TxRow => ({
  type: 'PAYMENT',
  timestamp: 1_800_000_000_000 - n,
  signature: `sig${n}`,
});

let paths: string[] = [];
let beyond: TxRow[] = [];
/** Holds the node's answer back until let go. */
let answered: Promise<void> = Promise.resolve();

beforeEach(() => {
  paths = [];
  answered = Promise.resolve();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).slice('http://node.test'.length);
      paths.push(path);
      await answered;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(beyond),
      } as Response;
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

let latest: AccountHistory | null = null;

function Holder() {
  latest = useAccountHistory(ADDRESS, {
    enabled: true,
    deep: true,
    firstRead: 1000,
  });
  return null;
}

function renderAtTheMost() {
  const cache = createExplorerCache();
  const held: AccountTxList = {
    rows: Array.from({ length: ACCOUNT_HISTORY_MAX }, (_, i) => row(i)),
    nextOffset: ACCOUNT_HISTORY_MAX,
    done: false,
    epoch: 0,
    max: ACCOUNT_HISTORY_MAX,
  };
  cache.put(accountTxKey(ADDRESS, []), held);
  const context: ExplorerContextValue = {
    cache,
    version: 0,
    viewer: null,
    access: 'full',
    openAccount: vi.fn(),
    openTransaction: vi.fn(),
    openName: vi.fn(),
    openChain: vi.fn(),
    refresh: vi.fn(),
    close: vi.fn(),
    activity: DEFAULT_ACTIVITY_SETTINGS,
    openActivitySettings: vi.fn(),
  };
  function Step() {
    const [state, setStepState] = useState<StepState>({});
    return (
      <ExplorerStepContext.Provider
        value={{
          stepId: 0,
          state,
          setState: (_id, key, value) =>
            setStepState((was) => ({ ...was, [key]: value })),
        }}
      >
        <Holder />
      </ExplorerStepContext.Provider>
    );
  }
  render(
    <ExplorerContext.Provider value={context}>
      <Step />
    </ExplorerContext.Provider>
  );
}

const checks = () =>
  paths.filter((path) => {
    const query = new URLSearchParams(path.split('?')[1] ?? '');
    return query.get('limit') === '1';
  });

describe('a whole history read at the Explorer’s most', () => {
  it('reads one row past it: none, and it is its whole history', async () => {
    beyond = [];
    await act(async () => renderAtTheMost());
    await waitFor(() => expect(latest?.whole).toBe(true));
    expect(latest?.atCeiling).toBe(false);
    expect(latest?.reading).toBe(false);
    expect(checks()).toHaveLength(1);
    const query = new URLSearchParams(checks()[0].split('?')[1]);
    expect(query.get('offset')).toBe(String(ACCOUNT_HISTORY_MAX));
    expect(query.get('reverse')).toBe('true');
    // Nothing else was read.
    expect(paths).toHaveLength(1);
  });

  it('reads one row past it: one more, and it is longer than the Explorer reads', async () => {
    beyond = [row(ACCOUNT_HISTORY_MAX)];
    let release: () => void = () => undefined;
    answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    await act(async () => renderAtTheMost());
    // While the row is on its way: reading, and never yet called longer.
    await waitFor(() => expect(checks()).toHaveLength(1));
    expect(latest?.reading).toBe(true);
    expect(latest?.atCeiling).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(latest?.atCeiling).toBe(true));
    expect(latest?.whole).toBe(false);
    expect(latest?.reading).toBe(false);
    expect(checks()).toHaveLength(1);
    expect(paths).toHaveLength(1);
  });
});

import { useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { act, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { darkTheme } from '../../styles/theme-dark';
import { executeEvent } from '../../utils/events';
import { ExplorerWindow } from './ExplorerWindow';

// A name no one has: the page offers names that start with it. What it says
// when the node couldn't answer that search.

const READER = `Q${'R'.repeat(33)}`;

type Answer = { status?: number; body: unknown };
let answer: (path: string) => Answer | undefined;
let searched = 0;

beforeEach(() => {
  searched = 0;
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).slice('http://node.test'.length);
      if (path.startsWith('/names/search?')) searched += 1;
      const found = answer(path) ?? {
        status: 404,
        body: { error: 999, message: 'no route' },
      };
      const status = found.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(found.body),
        json: async () => found.body,
      } as Response;
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <ExplorerWindow isOpenDrawerLookup={open} setIsOpenDrawerLookup={setOpen} />
  );
}

function renderSignedIn() {
  const store = createStore();
  store.set(userInfoAtom, { address: READER, name: 'Reader' } as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        <Harness />
      </ThemeProvider>
    </Provider>
  );
}

const dialog = () => screen.getByRole('dialog');

describe('a name no one has', () => {
  it("doesn't say that no name starts with it when the node's name search failed", async () => {
    answer = (path) => {
      if (path === '/names/Nobody')
        return { status: 404, body: { error: 401, message: 'name unknown' } };
      // The node is busy: the search for names that start with it fails.
      if (path.startsWith('/names/search?'))
        return { status: 503, body: { error: 1, message: 'busy' } };
      if (path.startsWith('/names/primary/'))
        return { body: { owner: READER } };
      return undefined;
    };
    renderSignedIn();
    act(() => {
      executeEvent('openUserLookupDrawer', { addressOrName: 'Nobody' });
    });
    await within(dialog()).findByText(/no one has the name/i);
    // Wait until the search for similar names has been asked and answered.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(searched).toBeGreaterThan(0);
    expect(
      within(dialog()).queryByText(/no registered name starts with it/i)
    ).not.toBeInTheDocument();
    // It says the search failed, and offers to search again.
    expect(
      within(dialog()).getByText(/couldn't look for names that start with it/i)
    ).toBeInTheDocument();
    expect(
      within(dialog()).getByRole('button', { name: /retry/i })
    ).toBeInTheDocument();
  });
});

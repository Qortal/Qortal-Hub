import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../App', () => ({ handleSetGlobalApikey: vi.fn() }));
vi.mock('../background/background-cases', () => ({
  getLocalApiKeyNotElectronCase: vi.fn(),
  setLocalApiKeyNotElectronCase: vi.fn(),
}));

import '../i18n/i18n';
import {
  isOpenDialogCustomApikey,
  isOpenUrlInvalidAtom,
  selectedNodeInfoAtom,
} from '../atoms/global';
import { darkTheme } from '../styles/theme-dark';
import { CustomNodeApikeyDialog } from './CustomNodeApikeyDialog';

type Answer = () => {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

const answer =
  (body: string, status = 200): Answer =>
  () => ({ ok: status >= 200 && status < 300, status, text: async () => body });

const CUSTOM_NODE = 'https://node.example.org:12391';

const refused = answer('{"error":4,"message":"API key invalid"}', 403);
const busy = answer('<html><body><h1>503</h1></body></html>', 503);
const noAnswer: Answer = () => {
  throw new TypeError('Failed to fetch');
};

/** The node's answers to its status and to the key test; no key bypass. */
let statusAnswer: Answer;
let keyTestAnswer: Answer;

// The dialog's title says "Invalid apikey" too, so the message under the
// field is the second one.
const invalidKeyTexts = () => screen.queryAllByText('Invalid apikey').length;

const pressContinue = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText('Continue'));
  });
};

describe('CustomNodeApikeyDialog', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.sendMessage = vi.fn(async () => []);
    statusAnswer = answer('{}');
    keyTestAnswer = refused;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const path = new URL(input).pathname;
        if (path === '/admin/status') return statusAnswer();
        if (path === '/admin/settings/localAuthBypassEnabled') {
          return answer('false')();
        }
        if (path === '/admin/apikey/test') return keyTestAnswer();
        throw new Error(`unexpected request ${path}`);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const openDialog = () => {
    const store = createStore();
    store.set(selectedNodeInfoAtom, { url: CUSTOM_NODE, apikey: 'a-key' });
    store.set(isOpenDialogCustomApikey, true);
    render(
      <ThemeProvider theme={darkTheme}>
        <Provider store={store}>
          <CustomNodeApikeyDialog />
        </Provider>
      </ThemeProvider>
    );
    return store;
  };

  it('doesn’t call the key invalid when the node didn’t answer the retry', async () => {
    const store = openDialog();

    // The node refuses the key: the dialog says so.
    await pressContinue();
    expect(invalidKeyTexts()).toBe(2);
    expect(store.get(isOpenUrlInvalidAtom)).toBe(false);

    // The node is busy when the user tries again: that says nothing about
    // the key.
    keyTestAnswer = busy;
    await pressContinue();
    expect(store.get(isOpenUrlInvalidAtom)).toBe(true);
    expect(invalidKeyTexts()).toBe(1);

    // The node answers again and still refuses: Continue works, and the
    // dialog says so again.
    keyTestAnswer = refused;
    await pressContinue();
    expect(invalidKeyTexts()).toBe(2);
  });

  it('doesn’t call the key invalid when the node was gone at the retry', async () => {
    const store = openDialog();

    await pressContinue();
    expect(invalidKeyTexts()).toBe(2);
    expect(store.get(isOpenUrlInvalidAtom)).toBe(false);

    // Not even the node's status answers now.
    statusAnswer = noAnswer;
    await pressContinue();
    expect(store.get(isOpenUrlInvalidAtom)).toBe(true);
    expect(invalidKeyTexts()).toBe(1);
  });
});

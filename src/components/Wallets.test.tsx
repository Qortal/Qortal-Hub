import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../i18n/i18n';
import { darkTheme } from '../styles/theme-dark';

const getWallets = vi.fn();
const storeWallets = vi.fn(async () => undefined);

vi.mock('../background/background.ts', () => ({
  getWallets: (...args: unknown[]) => getWallets(...args),
  performPowTask: vi.fn(),
  storeWallets: (...args: unknown[]) => storeWallets(...args),
  walletVersion: 2,
}));

vi.mock('../App', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../App')>()),
  getBaseApiReact: () => 'http://127.0.0.1:12391',
  getBaseApiReactForAvatar: () => 'http://127.0.0.1:12391',
  getBaseApiReactForPrimaryName: () => 'http://127.0.0.1:12391',
}));

import { Wallets } from './Wallets';

type StoredWallet = {
  address0: string;
  name?: string;
  note?: string;
  filename?: string;
};

const wallet = (index: number, name?: string): StoredWallet => ({
  address0: `QAddr${String(index).padStart(4, '0')}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
  name: name ?? `Account ${index}`,
  note: '',
});

const NINE_ACCOUNTS: StoredWallet[] = [
  wallet(1, 'Alice'),
  wallet(2, 'Bob'),
  wallet(3, 'Carol'),
  wallet(4, 'Dave'),
  wallet(5, 'Erin'),
  wallet(6, 'Frank'),
  wallet(7, 'Grace'),
  wallet(8, 'Heidi'),
  wallet(9, 'Ivan'),
];

const renderWallets = (props: { autoFocusFilter?: boolean } = {}) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <Wallets
        mode="entry"
        setExtState={vi.fn()}
        setRawWallet={vi.fn()}
        {...props}
      />
    </ThemeProvider>
  );

const filterField = () =>
  screen.findByRole('textbox', {
    name: 'Filter accounts by address, primary name or note',
  });

beforeEach(() => {
  getWallets.mockResolvedValue(NINE_ACCOUNTS);
  storeWallets.mockClear();
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => [],
      ok: true,
      status: 200,
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Wallets entry filter', () => {
  it('shows the field without a control that reveals it', async () => {
    const { container } = renderWallets();

    await filterField();
    expect(container.querySelectorAll('[aria-expanded]')).toHaveLength(0);
  });

  it('hides the field when there are only eight accounts', async () => {
    getWallets.mockResolvedValue(NINE_ACCOUNTS.slice(0, 8));
    renderWallets();

    await screen.findByText('Heidi');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('hides the filter while an account is being edited', async () => {
    const user = userEvent.setup();
    renderWallets();

    await filterField();
    const editButtons = screen.getAllByLabelText('Edit account label and note');
    await user.click(editButtons[0]);

    // The inline editor adds its own inputs; only the filter must go.
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', {
          name: 'Filter accounts by address, primary name or note',
        })
      ).toBeNull()
    );
    expect(screen.getByPlaceholderText('Account name')).toBeVisible();
  });

  it('holds focus on load when autoFocusFilter is set', async () => {
    renderWallets({ autoFocusFilter: true });

    const field = await filterField();
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('leaves focus alone without autoFocusFilter', async () => {
    renderWallets();

    const field = await filterField();
    expect(field).not.toHaveFocus();
  });

  it('narrows the list by account name', async () => {
    const user = userEvent.setup();
    renderWallets();

    const field = await filterField();
    await user.click(field);
    await user.keyboard('alice');

    expect(screen.getByText('Alice')).toBeVisible();
    expect(screen.queryByText('Bob')).toBeNull();
    expect(screen.queryByText('Ivan')).toBeNull();
  });

  it('narrows the list by address', async () => {
    const user = userEvent.setup();
    renderWallets();

    const field = await filterField();
    await user.click(field);
    await user.keyboard('QAddr0003');

    expect(screen.getByText('Carol')).toBeVisible();
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    renderWallets();

    const field = await filterField();
    await user.click(field);
    await user.keyboard('zzzz');

    expect(await screen.findByText('No accounts match.')).toBeVisible();
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('keeps focus in the field when the query is cleared', async () => {
    const user = userEvent.setup();
    renderWallets();

    const field = await filterField();
    await user.click(field);
    await user.keyboard('alice');
    await user.click(screen.getByLabelText('Clear search'));

    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
  });

  it('clears the query on Escape without leaving the field', async () => {
    const user = userEvent.setup();
    renderWallets();

    const field = await filterField();
    await user.click(field);
    await user.keyboard('alice');
    await user.keyboard('{Escape}');

    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
    expect(screen.getByText('Bob')).toBeVisible();
  });
});

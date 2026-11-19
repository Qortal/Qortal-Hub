import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// "Start minting" makes the self reward share and the minting key from the
// public key in the node's record of the signed-in address. That key must
// belong to the address: another account's key is refused before anything is
// made or sent.

// src/test/setup.ts stubs asmcrypto out; deriving addresses needs SHA-256.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
}));
vi.mock('../../background/background.ts', () => ({
  getFee: vi.fn(async () => ({ fee: '0.01' })),
}));

import '../../i18n/i18n';
import { memberGroupsAtom } from '../../atoms/global';
import { darkTheme } from '../../styles/theme-dark';
import Base58Untyped from '../../encryption/Base58';
import naclUntyped from '../../encryption/nacl-fast';
import publicKeyToAddressUntyped from '../../utils/generateWallet/publicKeyToAddress';
import { Minting } from './Minting';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Base58 = Base58Untyped as any;
const nacl = naclUntyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function account(fill: number) {
  const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(fill));
  return {
    publicKey: Base58.encode(pair.publicKey) as string,
    address: String(publicKeyToAddress(pair.publicKey)),
  };
}

const self = account(41);
const other = account(42);

function stubNode(accountRecordKey: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.slice('http://127.0.0.1:12391'.length);
      let body: unknown = {};
      if (path === '/admin/mintingaccounts') body = [];
      else if (path.startsWith('/addresses/rewardshares')) body = [];
      else if (path === '/addresses/online/levels') body = [];
      else if (path === '/admin/status')
        body = { isSynchronizing: false, syncPercent: 100, height: 10 };
      else if (path === `/addresses/${self.address}`)
        body = { address: self.address, publicKey: accountRecordKey, level: 1 };
      return { ok: true, json: async () => body, text: async () => '' };
    })
  );
}

const sendMessage = vi.fn(async (_action: string, _payload: unknown) => ({
  error: 'stop here',
}));

beforeEach(() => {
  (window as any).sendMessage = sendMessage;
  sendMessage.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).sendMessage;
});

const renderMinting = () => {
  const store = createStore();
  store.set(memberGroupsAtom, [{ groupId: 694 }] as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        <Minting
          setIsOpenMinting={vi.fn()}
          myAddress={self.address}
          show={vi.fn(async () => true)}
        />
      </ThemeProvider>
    </Provider>
  );
};

const pressStartMinting = async () => {
  const start = await screen.findByRole('button', { name: /start minting/i });
  await waitFor(() => expect(start).not.toBeDisabled());
  // Let the account record load.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  fireEvent.click(start);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
};

const rewardShareKeys = () =>
  sendMessage.mock.calls
    .filter(([action]) => action === 'createRewardShare')
    .map(([, payload]) => (payload as any).recipientPublicKey);

describe('Start minting', () => {
  it("makes the self reward share with the account's own key", async () => {
    stubNode(self.publicKey);
    renderMinting();
    await pressStartMinting();
    expect(rewardShareKeys()).toEqual([self.publicKey]);
  });

  it("makes no reward share with another account's key from the node", async () => {
    stubNode(other.publicKey);
    renderMinting();
    await pressStartMinting();
    expect(rewardShareKeys()).toEqual([]);
  });
});

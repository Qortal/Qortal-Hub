import { afterEach, describe, expect, it, vi } from 'vitest';

// The 'sendCoin' message from Hub's own pages (the Send QORT dialog) hands its
// confirmed payment to background.sendCoin, including the fee the dialog
// showed, so a higher fee from the node is refused before signing.

vi.mock('../background/background.ts', () => ({ sendCoin: vi.fn() }));
vi.mock('../qortal/get.ts', () => ({}));
vi.mock('../encryption/encryption.ts', () => ({}));
vi.mock('../qdn/encryption/group-encryption', () => ({}));
vi.mock('../utils/chromeStorage', () => ({}));
// src/test/setup.ts stubs asmcrypto out; the address needs the real SHA-256.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);

import { sendCoinCase } from './background-cases';
import { sendCoin } from '../background/background.ts';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';

const publicKeyToAddress = publicKeyToAddressUntyped as any;

// Account-A: a made-up key and the address it derives.
const ACCOUNT_A = String(publicKeyToAddress(new Uint8Array(32).fill(41)));

function messageEvent() {
  return { source: { postMessage: vi.fn() }, origin: 'app://hub' };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('sendCoinCase', () => {
  it('passes the fee the dialog showed on to sendCoin', async () => {
    vi.mocked(sendCoin).mockResolvedValue({
      res: { success: true, data: {} },
      validApi: null,
    });
    const event = messageEvent();

    await sendCoinCase(
      {
        requestId: 'request-1',
        payload: {
          amount: 1.5,
          receiver: ACCOUNT_A,
          password: 'pw',
          approvedFee: '0.01000000',
        },
      },
      event
    );

    expect(sendCoin).toHaveBeenCalledWith(
      {
        amount: 1.5,
        receiver: ACCOUNT_A,
        password: 'pw',
        approvedFee: '0.01000000',
      },
      false
    );
    expect(event.source.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'request-1', payload: true }),
      'app://hub'
    );
  });

  it('answers with the refusal when sendCoin refuses', async () => {
    vi.mocked(sendCoin).mockRejectedValue(new Error('fee above approved'));
    const event = messageEvent();

    await sendCoinCase(
      {
        requestId: 'request-2',
        payload: { amount: 1, receiver: ACCOUNT_A, approvedFee: '0.01' },
      },
      event
    );

    expect(event.source.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-2',
        error: 'fee above approved',
      }),
      'app://hub'
    );
  });
});

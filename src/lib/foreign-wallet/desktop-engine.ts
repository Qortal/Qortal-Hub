// Bundled for Electron main. This module is never imported by the renderer.
import { hex } from '@scure/base';
import {
  walletPublicKey,
  foreignCoins,
  type ForeignWalletCoin,
} from './foreign-wallets';
import {
  prepareForeignWalletPsbt,
  signForeignWalletPsbt,
  type ForeignWalletTransactionRequest,
} from './foreign-wallet-transaction';
import { assertForeignWalletPlanWithinPolicy } from './foreign-wallet-policy-bounds';
export { inspectSignedTransaction } from './foreign-wallet-transaction';
export type DesktopSignRequest = Omit<
  ForeignWalletTransactionRequest,
  'xprv' | 'cache' | 'crypto'
> & { psbtHex: string };
class SigningError extends Error {
  constructor(public code: 'invalid' | 'changed' | 'declined' | 'pending') {
    super(code);
  }
}
export function createDesktopWalletSigner() {
  let roots: Partial<Record<ForeignWalletCoin, string>> = {};
  let epoch = 0;
  let busy = false;
  const clear = () => {
    roots = {};
    epoch++;
  };
  return {
    clear,
    importKeys(payload: Record<string, unknown>) {
      clear();
      const next: Partial<Record<ForeignWalletCoin, string>> = {};
      const publicKeys: Partial<Record<ForeignWalletCoin, string>> = {};
      for (const coin of foreignCoins) {
        const key = payload[`${coin.toLowerCase()}PrivateKey`];
        if (typeof key !== 'string') throw new Error('Missing wallet key');
        publicKeys[coin] = walletPublicKey(key, coin);
        next[coin] = key;
      }
      roots = next;
      return publicKeys;
    },
    publicKey(coin: ForeignWalletCoin) {
      if (!foreignCoins.includes(coin) || !roots[coin])
        throw new Error('Wallet is locked');
      return walletPublicKey(roots[coin], coin);
    },
    async sign(
      rawRequest: DesktopSignRequest,
      approve: (details: {
        coin: ForeignWalletCoin;
        xpub: string;
        outputs: { address: string; value: bigint }[];
        fee: bigint;
      }) => Promise<boolean>
    ) {
      if (busy) throw new SigningError('pending');
      busy = true;
      const session = epoch;
      const started = Date.now();
      try {
        const request = structuredClone(rawRequest);
        const { coin } = request;
        if (
          !foreignCoins.includes(coin) ||
          !roots[coin] ||
          request.xpub !== walletPublicKey(roots[coin], coin)
        )
          throw new SigningError('changed');
        // Ignore all caller-supplied fields except the explicitly supported public contract.
        const input = {
          coin,
          xpub: request.xpub,
          inputs: request.inputs,
          outputs: request.outputs,
          transactionVersion: 1,
        };
        const expected = prepareForeignWalletPsbt(input);
        if (request.psbtHex !== hex.encode(expected))
          throw new SigningError('invalid');
        const inputAmount = input.inputs.reduce((n, u) => n + u.value, 0n);
        const outputAmount = input.outputs.reduce((n, u) => n + u.value, 0n);
        const fee = inputAmount - outputAmount;
        assertForeignWalletPlanWithinPolicy({
          coin,
          fee,
          amount: outputAmount,
          feePerByte: 1n,
          estimatedMaximumSize:
            10 + input.inputs.length * 149 + input.outputs.length * 43,
          sendMax: true,
        });
        if (
          !(await approve({
            coin,
            xpub: request.xpub,
            outputs: structuredClone([...input.outputs]),
            fee,
          }))
        )
          throw new SigningError('declined');
        if (session !== epoch || Date.now() - started > 300000 || !roots[coin])
          throw new SigningError('changed');
        return signForeignWalletPsbt({ ...input, xprv: roots[coin] }, expected);
      } finally {
        busy = false;
      }
    },
  };
}
export { desktopWalletTranslations } from './desktop-i18n';

import path from 'node:path';
import { createRequire } from 'node:module';

// The bundle is produced from the same implementation used by browser/Android,
// with its dependencies included; Electron never resolves renderer node_modules.
let engine: any;
let signer: any;
function getEngine() {
  return (engine ??= createRequire(__filename)(
    path.join(__dirname, '..', 'foreign-wallet-engine.cjs')
  ));
}
function getSigner() {
  return (signer ??= getEngine().createDesktopWalletSigner());
}
export const clearForeignWalletSigner = () => signer?.clear();
export const importForeignWalletKeys = (keys: Record<string, unknown>) =>
  getSigner().importKeys(keys);
export const foreignWalletPublicKey = (coin: string) =>
  getSigner().publicKey(coin);
export async function signForeignWalletPayment(request: unknown) {
  try {
    // Hub has already obtained permission and revalidated the approved payment.
    // Keep the signer's validation/session checks without a second desktop prompt.
    const signed = await getSigner().sign(request, async () => true);
    return { signed };
  } catch (error) {
    // Never forward native errors or key material to renderer error reporting.
    const code = (error as { code?: string })?.code;
    return {
      error: ['invalid', 'changed', 'declined', 'pending'].includes(code)
        ? code
        : 'invalid',
    };
  }
}

import i18n from 'i18next';
import { getKeyPair, getSaveWallet } from '../background/background';
import { getSigningContextRevision } from '../utils/chromeStorage';
import Base58 from '../encryption/Base58';
import publicKeyToAddress from '../utils/generateWallet/publicKeyToAddress';
import {
  moneroNetworkForNodeInfo,
  moneroPublicWallet,
} from '../lib/monero/account';

/** XMR must not enter the legacy eight-decimal/Core wallet-RPC paths. */
export function rejectUnimplementedMoneroOperation(coin: unknown): void {
  if (coin === 'XMR' || coin === 'MONERO') {
    throw new Error(
      i18n.t('question:message.error.token_not_supported', {
        token: 'XMR',
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
}

/** Called only after GET_USER_WALLET permission is granted by the host. */
export async function getMoneroPublicWallet(
  getNodeInfo: () => Promise<unknown>,
  revision: number | null = getSigningContextRevision()
) {
  if (revision === null || revision !== getSigningContextRevision()) changed();
  const wallet = await getSaveWallet();
  const keys = await getKeyPair();
  const node = await getNodeInfo();
  if (revision !== getSigningContextRevision()) changed();
  let accountAddress: string | undefined;
  try {
    if (typeof keys?.publicKey === 'string') {
      accountAddress = publicKeyToAddress(Base58.decode(keys.publicKey));
    }
  } catch {
    // Invalid key records cannot authenticate an account. Keep raw decoder
    // errors and key data out of the public response.
  }
  if (!accountAddress || accountAddress !== wallet?.address0) {
    throw new Error(
      i18n.t('auth:message.error.wallet_account_mismatch', {
        postProcess: 'capitalizeFirstChar',
      })
    );
  }
  return moneroPublicWallet(keys.xmrWallet, moneroNetworkForNodeInfo(node));
}

function changed(): never {
  throw new Error(i18n.t('question:local_send.changed'));
}

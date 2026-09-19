import { readBoundedWalletResponse } from './wallet-response';
import { validateLocalTradePlan } from '../lib/foreign-wallet/trade-plan';
import i18n from 'i18next';
import {
  createEndpoint,
  getKeyPair,
  getSaveWallet,
} from '../background/background';
import { atomicAmount, decimalAmount } from '../lib/foreign-wallet/send';
import {
  type ForeignWalletCoin,
  walletPublicKey,
} from '../lib/foreign-wallet/foreign-wallets';
import { getForeignWalletMainnetChainId } from '../lib/foreign-wallet/foreign-wallet-spend-context';
import { sendLocalForeignCoin, LocalWalletError } from './foreign-coin-send';

export const localTradeCoins: Record<string, ForeignWalletCoin> = {
  BITCOIN: 'BTC',
  LITECOIN: 'LTC',
  DOGECOIN: 'DOGE',
  DIGIBYTE: 'DGB',
  RAVENCOIN: 'RVN',
};
export async function fundLocalTrades(
  offers: any[],
  coin: ForeignWalletCoin,
  approve: (payload: any) => Promise<any>
) {
  try {
    if (!Array.isArray(offers) || !offers.length || offers.length > 20)
      throw new LocalWalletError('invalid');
    // Bind both approvals and validation to the original selection.
    offers = structuredClone(offers);
    const wallet = await getSaveWallet();
    const publicKey = async () =>
      window.foreignWalletSigner
        ? window.foreignWalletSigner.publicKey(coin)
        : walletPublicKey(
            (await getKeyPair())[`${coin.toLowerCase()}PrivateKey`],
            coin
          );
    const xpub = await publicKey();
    if (
      window.foreignWalletSigner &&
      (await getKeyPair())[`${coin.toLowerCase()}PublicKey`] !== xpub
    )
      throw new LocalWalletError('changed');
    const endpoint = await createEndpoint('/crosschain/tradebot/respond/local');
    const purchaseAmount = offers.reduce(
      (sum, offer) => sum + atomicAmount(offer.expectedForeignAmount),
      0n
    );
    const permission = await approve({
      text1: i18n.t('question:permission.buy_order', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:permission.buy_order_quantity', {
        count: offers.length,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: `${decimalAmount(purchaseAmount)} ${coin}`,
      confirmCheckbox: true,
    });
    if (!permission?.accepted) throw new LocalWalletError('declined');
    const assertSession = async () => {
      if (
        (await getSaveWallet()).address0 !== wallet.address0 ||
        (await publicKey()) !== xpub ||
        (await createEndpoint('/crosschain/tradebot/respond/local')) !==
          endpoint
      )
        throw new LocalWalletError('changed');
    };
    await assertSession();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        addresses: offers.map((o) => o.qortalAtAddress),
        xpub58: xpub,
        receivingAddress: wallet.address0,
        expectedChainId: getForeignWalletMainnetChainId(coin),
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (response.status === 404 || response.status === 405)
      throw new LocalWalletError('upgrade');
    if (!response.ok) throw new LocalWalletError('invalid');
    const plans = JSON.parse(
      await readBoundedWalletResponse(response, 1024 * 1024)
    );
    let payments;
    try {
      payments = validateLocalTradePlan(plans, offers, coin, wallet.address0);
    } catch {
      throw new LocalWalletError('invalid');
    }
    await assertSession();
    const total = payments.reduce((sum, p) => sum + p.value, 0n);
    const txId = await sendLocalForeignCoin(
      {
        coin,
        amount: decimalAmount(total),
        recipient: payments[0].address,
        broadcastBefore: Math.min(
          ...plans.map((p) => (p.lockTime - 300) * 1000)
        ),
      },
      async (payload) => {
        await assertSession();
        const permission = await approve({
          ...payload,
          text1: i18n.t('question:permission.buy_order', {
            postProcess: 'capitalizeFirstChar',
          }),
          text2: i18n.t('question:permission.buy_order_quantity', {
            count: offers.length,
            postProcess: 'capitalizeFirstChar',
          }),
          text3: payments
            .map((p) => `${decimalAmount(p.value)} ${coin} → ${p.address}`)
            .join('\n'),
        });
        await assertSession();
        // Locktime validation is repeated after approval before allowing a signature.
        validateLocalTradePlan(plans, offers, coin, wallet.address0);
        return permission;
      },
      payments,
      async () => {
        await assertSession();
        validateLocalTradePlan(plans, offers, coin, wallet.address0);
      },
      approve
    );
    return {
      callResponse: true,
      extra: {
        txId,
        atAddresses: offers.map((o) => o.qortalAtAddress),
        senderAddress: wallet.address0,
        node: endpoint.split('?')[0],
      },
    };
  } catch (error) {
    if (error instanceof LocalWalletError) throw error;
    throw new LocalWalletError('invalid');
  }
}

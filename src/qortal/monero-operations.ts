import i18n from 'i18next';
import { getMoneroWalletContext, getMoneroPublicWallet } from './monero-wallet';
import { getSigningContextRevision } from '../utils/chromeStorage';
import { moneroAtomicAmount, moneroDecimalAmount } from '../lib/monero/amount';

type Ask = (details: any) => Promise<{ accepted?: boolean }>;
function error(code: string): never {
  throw new Error(i18n.t(`question:xmr.${code}`));
}
async function result<T>(
  operation: Promise<{ result?: T; error?: string }>
): Promise<T> {
  const response = await operation;
  if (!response || response.error) error(response?.error || 'engine');
  return response.result;
}
async function context(
  getNodeInfo: () => Promise<unknown>,
  revision: number | null
) {
  if (!window.moneroWallet) error('desktop');
  const ctx = await getMoneroWalletContext(getNodeInfo, revision);
  if (ctx.publicWallet.network !== 'stagenet') error('stagenet');
  return ctx;
}
async function recheck(
  ctx: Awaited<ReturnType<typeof context>>,
  getNodeInfo: () => Promise<unknown>
) {
  if (ctx.revision !== getSigningContextRevision()) error('changed');
  const current = await getMoneroPublicWallet(getNodeInfo, ctx.revision);
  if (
    current.address !== ctx.publicWallet.address ||
    current.network !== 'stagenet'
  )
    error('changed');
}

/** Called after the existing host wallet-info permission. Initialization also
 * needs explicit consent even if that read permission was remembered. */
export async function getMoneroWalletInfo(
  data: any,
  getNodeInfo: () => Promise<unknown>,
  ask: Ask,
  revision: number | null
) {
  const ctx = await context(getNodeInfo, revision);
  let status = await result(
    window.moneroWallet.status(ctx.publicWallet.address)
  );
  if (data.initialize === true && !status.initialized) {
    const height = data.restoreHeight;
    if (
      !Number.isSafeInteger(height) ||
      height < 0 ||
      height > status.daemonHeight
    )
      error('invalid');
    const permission = await ask({
      text1: i18n.t('question:xmr.initialize'),
      text2: i18n.t('question:xmr.restore_height', { height }),
      highlightedText: 'XMR (stagenet)',
      confirmCheckbox: true,
    });
    if (!permission?.accepted) error('declined');
    await recheck(ctx, getNodeInfo);
    status = await result(
      window.moneroWallet.open({
        qortalAddress: ctx.qortalAddress,
        network: 'stagenet',
        address: ctx.publicWallet.address,
        privateSpendKey: ctx.privateSpendKey,
        restoreHeight: height,
      })
    );
  }
  await recheck(ctx, getNodeInfo);
  return status;
}

export async function readMoneroWallet(
  getNodeInfo: () => Promise<unknown>,
  revision: number | null
) {
  const ctx = await context(getNodeInfo, revision);
  const status = await result(
    window.moneroWallet.status(ctx.publicWallet.address)
  );
  await recheck(ctx, getNodeInfo);
  if (!status.initialized) error('not_ready');
  return status;
}

/** Approve a recipient, exact amount and explicit fee LIMIT before the native
 * engine constructs/signs. The engine enforces the approved limit. */
let sending = false;
export async function sendMoneroPayment(
  data: any,
  getNodeInfo: () => Promise<unknown>,
  ask: Ask
) {
  if (sending) error('busy');
  sending = true;
  try {
    return await sendPayment(data, getNodeInfo, ask);
  } finally {
    sending = false;
  }
}
async function sendPayment(
  data: any,
  getNodeInfo: () => Promise<unknown>,
  ask: Ask
) {
  const revision = getSigningContextRevision();
  const ctx = await context(getNodeInfo, revision);
  const address = ctx.publicWallet.address;
  let payment: {
    id: string;
    recipient: string;
    amountAtomic: string;
    feeAtomic: string;
  };
  if (data.retryPending === true)
    payment = await result(window.moneroWallet.retry(address));
  else {
    if (data.sendMax === true || data.memo || data.fee !== undefined)
      error('invalid');
    const recipient = data.destinationAddress || data.recipient;
    if (
      typeof recipient !== 'string' ||
      !/^[1-9A-HJ-NP-Za-km-z]{95}$/.test(recipient)
    )
      error('invalid');
    let amountAtomic: string;
    let limit: string;
    try {
      amountAtomic = moneroAtomicAmount(data.amount);
      limit = moneroAtomicAmount(data.maxFee ?? '0.001');
    } catch {
      error('invalid');
    }
    if (BigInt(limit) > 1000000000000n) error('invalid');
    const approved = await ask({
      text1: i18n.t('question:permission.send_coins', {
        postProcess: 'capitalizeFirstChar',
      }),
      text2: i18n.t('question:to_recipient', {
        recipient,
        postProcess: 'capitalizeFirstChar',
      }),
      highlightedText: `${moneroDecimalAmount(amountAtomic)} XMR (stagenet)`,
      foreignFee: `≤ ${moneroDecimalAmount(limit)} XMR (stagenet)`,
      confirmCheckbox: true,
    });
    if (!approved?.accepted) error('declined');
    await recheck(ctx, getNodeInfo);
    payment = await result(
      window.moneroWallet.prepare(address, {
        recipient,
        amountAtomic,
        maxFeeAtomic: limit,
      })
    );
  }
  try {
    if (data.retryPending === true) {
      const approved = await ask({
        text1: i18n.t('question:xmr.retry'),
        text2: i18n.t('question:to_recipient', {
          recipient: payment.recipient,
          postProcess: 'capitalizeFirstChar',
        }),
        highlightedText: `${moneroDecimalAmount(payment.amountAtomic)} XMR (stagenet)`,
        foreignFee: `${moneroDecimalAmount(payment.feeAtomic)} XMR (stagenet)`,
        confirmCheckbox: true,
      });
      if (!approved?.accepted) error('declined');
    }
    await recheck(ctx, getNodeInfo);
    return await result(window.moneroWallet.relay(address, payment.id));
  } finally {
    await window.moneroWallet.cancel(address).catch(() => undefined);
  }
}

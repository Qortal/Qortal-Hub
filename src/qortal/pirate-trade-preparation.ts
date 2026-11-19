import i18n from 'i18next';
import {
  createEndpoint,
  getForeignKey,
  getSaveWallet,
} from '../background/background';
import { getSigningContextRevision } from '../utils/chromeStorage';
import { atomicAmount, decimalAmount } from '../lib/foreign-wallet/send';
import { readBoundedWalletResponse } from './wallet-response';

class PiratePreparationError extends Error {}
const fail = (key: string, params = {}) =>
  new PiratePreparationError(
    i18n.t(`question:arrr_preparation.${key}`, params)
  );
const atomic = (value: unknown): bigint => {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw fail('invalid');
  return BigInt(value as number);
};

/** Runs entirely inside trusted Hub. No entropy is returned to the requesting Q-App. */
async function prepare(
  offers: any[],
  approve: (payload: any) => Promise<any>,
  revision: number | null
): Promise<() => Promise<void>> {
  if (offers.length !== 1) throw fail('single');
  if (revision === null || getSigningContextRevision() !== revision)
    throw fail('changed');
  const wallet = await getSaveWallet();
  const entropy58 = await getForeignKey('PIRATECHAIN');
  const endpoint = await createEndpoint('/crosschain/arrr/tradepreparation');
  const feeEndpoint = await createEndpoint('/crosschain/arrr/tradefees');
  const assertSession = async () => {
    if (
      getSigningContextRevision() !== revision ||
      (await getSaveWallet()).address0 !== wallet.address0 ||
      (await createEndpoint('/crosschain/arrr/tradepreparation')) !==
        endpoint ||
      (await getForeignKey('PIRATECHAIN')) !== entropy58 ||
      getSigningContextRevision() !== revision
    )
      throw fail('changed');
  };
  await assertSession();
  const feesResponse = await fetch(feeEndpoint, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!feesResponse.ok) throw fail('upgrade');
  const fees = JSON.parse(
    await readBoundedWalletResponse(feesResponse, 16_384)
  );
  const required =
    atomicAmount(offers[0].expectedForeignAmount) +
    atomic(fees.fundingFee) +
    atomic(fees.refundFee);
  if (required <= 0n || required > BigInt(Number.MAX_SAFE_INTEGER))
    throw fail('invalid');
  const query = async (approval?: {
    approvedQuote: string;
    maxFee: number;
  }) => {
    await assertSession();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entropy58,
        requiredAmount: Number(required),
        ...approval,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (response.status === 404 || response.status === 405)
      throw fail('upgrade');
    const state = JSON.parse(await readBoundedWalletResponse(response, 16_384));
    if (!response.ok) {
      const message = typeof state.message === 'string' ? state.message : '';
      const unsupported =
        message.includes(
          'Unsupported Qortal wallet command: tradepreparation'
        ) || message.includes('requires an updated native wallet library');
      throw fail(unsupported ? 'upgrade' : 'unavailable');
    }
    await assertSession();
    if (
      !['ready', 'needsPreparation', 'pending', 'insufficient'].includes(
        state.status
      )
    )
      throw fail('invalid');
    return state;
  };
  let state = await query();
  if (state.status === 'ready') return assertSession;
  if (state.status === 'insufficient') throw fail('insufficient');
  if (
    !/^[a-f0-9]{64}$/.test(state.quoteId) ||
    atomic(state.fee) !== 10_000n ||
    atomic(state.amount) < required ||
    typeof state.destination !== 'string' ||
    !state.destination.startsWith('zs1')
  )
    throw fail('invalid');
  const pending = state.status === 'pending';
  const permission = await approve({
    text1: i18n.t(`question:arrr_preparation.${pending ? 'resume' : 'title'}`),
    text2: i18n.t('question:arrr_preparation.explanation'),
    text3: i18n.t('question:arrr_preparation.amount', {
      amount: decimalAmount(atomic(state.amount)),
      address: state.destination,
    }),
    highlightedText: i18n.t('question:arrr_preparation.fee', {
      fee: decimalAmount(atomic(state.fee)),
    }),
    confirmCheckbox: true,
  });
  await assertSession();
  if (!permission?.accepted) throw fail('declined');
  const quote = state.quoteId;
  state = await query({ approvedQuote: quote, maxFee: state.fee });
  // Wait at most eight minutes. Timeout/error never starts a trade; the next
  // attempt resumes the same native journal rather than paying another fee.
  const deadline = Date.now() + 8 * 60_000;
  while (state.status === 'pending' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    state = await query();
  }
  if (state.status !== 'ready')
    throw fail('pending', { txid: state.txid || '' });
  await assertSession();
  return assertSession;
}

export async function preparePirateTrade(
  offers: any[],
  approve: (payload: any) => Promise<any>,
  revision: number | null
): Promise<() => Promise<void>> {
  try {
    return await prepare(offers, approve, revision);
  } catch (error) {
    if (error instanceof PiratePreparationError) throw error;
    throw fail('unavailable');
  }
}

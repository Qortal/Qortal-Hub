import i18n from '../i18n/i18n';
import {
  createEndpoint,
  getForeignKey,
  getSaveWallet,
} from '../background/background';
import { getSigningContextRevision } from '../utils/chromeStorage';
import { readBoundedWalletResponse } from './wallet-response';

const pending = new Map<string, Promise<void>>();
const initialized = new Set<string>();
class PirateInitializationError extends Error {}
const failure = (key: string) =>
  new PirateInitializationError(i18n.t(`question:arrr_initialization.${key}`));

/** Ask in trusted Hub before Core first creates this account's local ARRR wallet. */
export async function ensurePirateWalletInitialization(
  entropy58: string,
  approve: (payload: any) => Promise<any>,
  revision = getSigningContextRevision()
): Promise<void> {
  try {
    await initialize(entropy58, approve, revision);
  } catch (error) {
    if (error instanceof PirateInitializationError) throw error;
    throw failure('unavailable');
  }
}

async function initialize(
  entropy58: string,
  approve: (payload: any) => Promise<any>,
  revision: number | null
) {
  const wallet = await getSaveWallet();
  const endpoint = await createEndpoint(
    '/crosschain/arrr/walletinitialization'
  );
  const assertSession = async () => {
    if (
      revision === null ||
      getSigningContextRevision() !== revision ||
      (await getSaveWallet()).address0 !== wallet.address0 ||
      (await createEndpoint('/crosschain/arrr/walletinitialization')) !==
        endpoint ||
      (await getForeignKey('PIRATECHAIN')) !== entropy58 ||
      getSigningContextRevision() !== revision
    )
      throw failure('changed');
  };
  await assertSession();
  const identity = `${revision}:${wallet.address0}:${endpoint}`;
  if (initialized.has(identity)) return;
  const existing = pending.get(identity);
  if (existing) return existing;
  const operation = (async () => {
    const query = async (selection = {}) => {
      await assertSession();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entropy58, ...selection }),
        signal: AbortSignal.timeout(45_000),
      });
      if (response.status === 404 || response.status === 405)
        throw failure('upgrade');
      if (!response.ok) throw failure('unavailable');
      const state = JSON.parse(await readBoundedWalletResponse(response, 4096));
      await assertSession();
      if (
        typeof state.needsSelection !== 'boolean' ||
        !Number.isSafeInteger(state.defaultBirthday) ||
        state.defaultBirthday < 1
      )
        throw failure('unavailable');
      return state;
    };
    const state = await query();
    if (!state.needsSelection) return;
    const permission = await approve({
      text1: i18n.t('question:arrr_initialization.title'),
      text2: i18n.t('question:arrr_initialization.explanation', {
        height: state.defaultBirthday,
      }),
      checkbox1: {
        label: i18n.t('question:arrr_initialization.new_wallet'),
        value: false,
      },
    });
    await assertSession();
    if (!permission?.accepted) throw failure('declined');
    const selected = await query(
      permission.checkbox1 === true
        ? { useCurrentHeight: true }
        : { birthday: state.defaultBirthday }
    );
    if (selected.needsSelection) throw failure('unavailable');
  })();
  pending.set(identity, operation);
  try {
    await operation;
    initialized.add(identity);
    if (initialized.size > 64)
      initialized.delete(initialized.values().next().value);
  } finally {
    if (pending.get(identity) === operation) pending.delete(identity);
  }
}

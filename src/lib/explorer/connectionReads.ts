/**
 * The reads only the Connections tab and the Overview's Direct links make
 * (detailed parts: read only for a viewer who sees them, access.ts). The
 * account's own lists come from the Transactions tab's kinds
 * (accountTx.ts), so nothing here reads them again. All GET, all public;
 * a failed read throws, and "Core has nothing" is an answer of its own.
 */
import { CoreHttpError, getJson, isCoreError, queryString, seg } from './core';
import { fundingFrom, NO_REAL_REFERENCE, type Funding } from './connections';
import { exchangeFlow, KNOWN_EXCHANGES, type ExchangeFlow } from './exchanges';
import { isQortAddress } from './addresses';
import {
  toTxRows,
  txRead,
  type AccountInfo,
  type ReadSpec,
  type TxRow,
} from './reads';

const MINUTE = 60_000;

/**
 * Where its first QORT came from: the transaction that first gave it
 * something (as Q-Mintership+'s getFirstSeen finds it).
 *
 * - With no transaction of its own yet, its reference is that transaction.
 * - Otherwise its oldest own transaction's reference is, unless that was a
 *   PUBLICIZE or an ARBITRARY (they take any reference).
 * - The transaction must give the account something; else it is the
 *   first QORT payment it received (oldest first).
 *
 * Null when none is found: an account with no incoming transaction.
 */
export const fundingRead = (
  account: Pick<AccountInfo, 'address' | 'publicKey' | 'reference'>
): ReadSpec<Funding | null> => ({
  key: `funding:${account.address}`,
  ttlMs: 30 * MINUTE,
  load: async () => {
    const { address } = account;
    let reference: string | null = null;
    if (account.publicKey) {
      const [firstOwn] = toTxRows(
        await getJson<unknown>(
          `/transactions/creator/${seg(account.publicKey)}?${queryString({
            confirmationStatus: 'CONFIRMED',
            limit: 1,
            reverse: false,
          })}`
        )
      );
      if (
        firstOwn &&
        typeof firstOwn.blockHeight === 'number' &&
        !NO_REAL_REFERENCE.has(firstOwn.type) &&
        typeof firstOwn.reference === 'string'
      )
        reference = firstOwn.reference;
    } else reference = account.reference;
    let funding: Funding | null = null;
    if (reference) {
      // Null only when the node doesn't know it; any other failure throws.
      const tx = await txRead(reference).load();
      funding = tx ? fundingFrom(tx, address) : null;
    }
    if (!funding) {
      const [first] = toTxRows(
        await getJson<unknown>(
          `/transactions/payments/between?${queryString({
            recipientAddress: address,
            confirmationStatus: 'CONFIRMED',
            limit: 1,
            reverse: false,
          })}`
        )
      );
      funding = first ? fundingFrom(first, address) : null;
    }
    return funding;
  },
});

/** Payments read at most per exchange and way: 100 a read. */
export const EXCHANGE_PAGE = 100;
export const EXCHANGE_PAGES = 10;

/** QORT payments from one account to another, newest first, as far as they were read. */
export interface PaymentsBetween {
  rows: TxRow[];
  /** One more row past the most read says there are older ones. */
  more: boolean;
}

/**
 * The QORT payments `from` made to `to`, exactly: the node's payments
 * between two accounts (`/transactions/payments/between` with both the
 * sender and the recipient given, a few milliseconds a read), newest
 * first, 100 a read, at most 1,000 (then `more`, when one more row says
 * there are older ones). A failed read throws, and so does a node without
 * that read (a 404 with no Core error number).
 */
export async function readPaymentsBetween(
  from: string,
  to: string
): Promise<PaymentsBetween> {
  const rows: TxRow[] = [];
  for (let page = 0; page < EXCHANGE_PAGES; page++) {
    const chunk = toTxRows(
      await getJson<unknown>(
        `/transactions/payments/between?${queryString({
          senderAddress: from,
          recipientAddress: to,
          confirmationStatus: 'CONFIRMED',
          limit: EXCHANGE_PAGE,
          offset: page * EXCHANGE_PAGE,
          reverse: true,
        })}`
      )
    );
    rows.push(...chunk);
    if (chunk.length < EXCHANGE_PAGE) return { rows, more: false };
  }
  // Every read was full: one more row says whether there are older ones.
  const next = toTxRows(
    await getJson<unknown>(
      `/transactions/payments/between?${queryString({
        senderAddress: from,
        recipientAddress: to,
        confirmationStatus: 'CONFIRMED',
        limit: 1,
        offset: EXCHANGE_PAGES * EXCHANGE_PAGE,
        reverse: true,
      })}`
    )
  );
  return { rows, more: next.length > 0 };
}

/** The node has no such route (not one of Core's own error answers): it can't read payments between two accounts. */
export const noPaymentsBetween = (error: unknown): boolean =>
  error instanceof CoreHttpError && error.status === 404 && error.code === null;

/**
 * What an account paid each known exchange, and got from it, exactly
 * (readPaymentsBetween, each way). Null on a node that can't answer that
 * read: the Connections lists' payments say it then.
 */
export const exchangePaymentsRead = (
  address: string
): ReadSpec<ExchangeFlow[] | null> => ({
  key: `exchanges:${address}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    try {
      const flows: Array<ExchangeFlow | null> = [];
      for (const exchange of Object.keys(KNOWN_EXCHANGES)) {
        if (exchange === address) continue;
        const sent = await readPaymentsBetween(address, exchange);
        flows.push(
          exchangeFlow(exchange, 'sent', sent.rows, sent.more ? 'older' : false)
        );
        const received = await readPaymentsBetween(exchange, address);
        flows.push(
          exchangeFlow(
            exchange,
            'received',
            received.rows,
            received.more ? 'older' : false
          )
        );
      }
      return flows.filter((flow): flow is ExchangeFlow => flow !== null);
    } catch (error) {
      if (noPaymentsBetween(error)) return null;
      throw error;
    }
  },
});

/** Core's "account address unknown": no account sponsored it. */
const ADDRESS_UNKNOWN = 124;

/**
 * The account Core counts as `address`'s sponsor
 * (`/addresses/sponsorship/<address>/sponsor`, about a second), read only
 * when more than one account sponsored it; null when Core counts none.
 */
export const coreSponsorRead = (address: string): ReadSpec<string | null> => ({
  key: `coresponsor:${address}`,
  ttlMs: 30 * MINUTE,
  load: async () => {
    try {
      const body = await getJson<{ address?: unknown }>(
        `/addresses/sponsorship/${seg(address)}/sponsor`
      );
      return isQortAddress(body?.address) ? body.address : null;
    } catch (error) {
      if (isCoreError(error, 404, ADDRESS_UNKNOWN)) return null;
      throw error;
    }
  },
});

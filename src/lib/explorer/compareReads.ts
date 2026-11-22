/**
 * The reads only Compare and the sets (Sponsees, Funded) make, beyond the
 * account reads they share with the account pages (the Connections tab's
 * lists, where its first QORT came from, its groups). All GET, all public,
 * all detailed parts: read only for a viewer the level 5+ rule lets in.
 * A failed read throws; "Core has nothing" is an answer of its own, and so
 * is a node that can't read payments between two accounts (null).
 *
 * - The QORT payments between two compared accounts, one way: exactly, 100
 *   a read, up to 1,000 (connectionReads' readPaymentsBetween).
 * - How busy a payer is: whether it has sent 100, 500 or 1,000 QORT
 *   payments (one row at each of those offsets).
 * - An account's QORT payments sent, oldest first, 100 a read, a page per
 *   key: the oldest pages never change, so Funded reads on page by page.
 * - The earliest QORT payment an account received.
 *
 * An account's trade portal sales are qortReads' portalTradesRead (the
 * Overview's Trade Portal read: one read a side, without a limit).
 *
 * Every key ends with an address, so Refresh on that account forgets it.
 */
import { getJson, queryString } from './core';
import {
  noPaymentsBetween,
  readPaymentsBetween,
  type PaymentsBetween,
} from './connectionReads';
import { isAtAddress, isQortAddress } from './addresses';
import { toTxRows, type ReadSpec, type TxRow } from './reads';

const MINUTE = 60_000;

/**
 * The QORT payments `from` made to `to` (Compare, both ways for every
 * pair), or null on a node that can't read payments between two accounts.
 */
export const pairPaymentsRead = (
  from: string,
  to: string
): ReadSpec<PaymentsBetween | null> => ({
  key: `pairpay:${from}:${to}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    try {
      return await readPaymentsBetween(from, to);
    } catch (error) {
      if (noPaymentsBetween(error)) return null;
      throw error;
    }
  },
});

/** At least this many QORT payments sent: 0, 100, 500 or 1,000. */
export type PayerBand = 0 | 100 | 500 | 1000;

export const PAYER_BANDS: readonly PayerBand[] = [100, 500, 1000];

/**
 * How many QORT payments `address` has sent, in bands (PAYMENT only): one
 * row at offset 99, then 499 and 999 while each answers one. A few
 * milliseconds each; null on a node that can't read payments between
 * accounts.
 */
export const payerBandRead = (address: string): ReadSpec<PayerBand | null> => ({
  key: `payerband:${address}`,
  ttlMs: 30 * MINUTE,
  load: async () => {
    let band: PayerBand = 0;
    try {
      for (const step of PAYER_BANDS) {
        const rows = toTxRows(
          await getJson<unknown>(
            `/transactions/payments/between?${queryString({
              senderAddress: address,
              confirmationStatus: 'CONFIRMED',
              limit: 1,
              offset: step - 1,
              reverse: false,
            })}`
          )
        );
        if (!rows.length) break;
        band = step;
      }
    } catch (error) {
      if (noPaymentsBetween(error)) return null;
      throw error;
    }
    return band;
  },
});

/** Payments per page of Funded's read, and the most pages it reads. */
export const FUNDED_PAGE = 100;
export const FUNDED_PAGES = 10;

export interface FundedPage {
  /** Its confirmed QORT payments sent on this page, oldest first. */
  rows: TxRow[];
  /** The page came back full: it may have sent more. */
  full: boolean;
  /**
   * The last page the Explorer reads (FUNDED_PAGES): one more row past it
   * says whether it sent more than that.
   */
  beyond?: boolean;
}

/**
 * Page `page` of the QORT payments `address` sent, oldest first
 * (`/transactions/payments/between?senderAddress=…&reverse=false`, 100 a
 * page). New payments only ever come after the last one, so a full page
 * never changes. Null on a node that can't read payments between accounts.
 */
export const fundedPageRead = (
  address: string,
  page: number
): ReadSpec<FundedPage | null> => ({
  key: `fundedpay:${page}:${address}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    const last = page === FUNDED_PAGES - 1;
    try {
      const rows = toTxRows(
        await getJson<unknown>(
          `/transactions/payments/between?${queryString({
            senderAddress: address,
            confirmationStatus: 'CONFIRMED',
            // The last page reads one row more: whether it sent more than the Explorer reads.
            limit: last ? FUNDED_PAGE + 1 : FUNDED_PAGE,
            offset: page * FUNDED_PAGE,
            reverse: false,
          })}`
        )
      );
      const confirmed = rows
        .slice(0, FUNDED_PAGE)
        .filter((row) => typeof row.blockHeight === 'number');
      return {
        rows: confirmed,
        full: rows.length >= FUNDED_PAGE,
        ...(last ? { beyond: rows.length > FUNDED_PAGE } : {}),
      };
    } catch (error) {
      if (noPaymentsBetween(error)) return null;
      throw error;
    }
  },
});

/** One account's earliest QORT payment received. */
export interface FirstReceived {
  /** Who paid it; null when the transaction doesn't name a valid account. */
  from: string | null;
  height: number;
  timestamp: number;
  amount: string;
  signature: string;
}

/**
 * The earliest QORT payment `address` received (one row, oldest first), or
 * null when the node has none for it.
 */
export const firstReceivedRead = (
  address: string
): ReadSpec<FirstReceived | null> => ({
  key: `firstrecv:${address}`,
  ttlMs: 30 * MINUTE,
  load: async () => {
    const [row] = toTxRows(
      await getJson<unknown>(
        `/transactions/payments/between?${queryString({
          recipientAddress: address,
          confirmationStatus: 'CONFIRMED',
          limit: 1,
          reverse: false,
        })}`
      )
    );
    if (!row || typeof row.blockHeight !== 'number') return null;
    const from = row.creatorAddress;
    return {
      from: isQortAddress(from) || isAtAddress(from) ? from : null,
      height: row.blockHeight,
      timestamp: row.timestamp,
      amount: String(row.amount ?? '0'),
      signature: row.signature,
    };
  },
});

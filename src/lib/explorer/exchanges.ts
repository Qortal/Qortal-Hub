/**
 * Exchanges' QORT deposit accounts, and what an account paid them or
 * got from them (from Q-Mintership+'s
 * rules/explorer/exchanges.ts). Named as exchanges only for a viewer who
 * sees the detailed parts (access.ts). Pure; the payments are read by
 * connectionReads.ts (exchangePaymentsRead).
 */
import { LINK_SAY, type Finding } from './findings';
import { newestFirst, refOf, type TxRef } from './money';
import type { TxRow } from './reads';
import { fromAtomic, toAtomic, type TxSentenceSpec } from './txWords';

/** Deposit accounts of exchanges, by address. */
export const KNOWN_EXCHANGES: Readonly<Record<string, string>> = {
  QcZPChiGmwLu3Lrp2mfLSjZ3yHKmtrogRe: 'TradeOgre',
  QVbi8fvVDeF8jRxBWZvbGJPEtwnnNJFWQh: 'nonkyc.io',
};

/** "TradeOgre" for an exchange's account, else null. */
export function exchangeName(
  address: string | null | undefined
): string | null {
  return address &&
    Object.prototype.hasOwnProperty.call(KNOWN_EXCHANGES, address)
    ? KNOWN_EXCHANGES[address]
    : null;
}

/** What an account paid one exchange, or got from it, in QORT payments. */
export interface ExchangeFlow {
  exchange: string;
  address: string;
  direction: 'sent' | 'received';
  /** The payments, newest first. */
  rows: TxRow[];
  /** QORT, in atomic units. */
  qort: bigint;
  /**
   * Only the newest were read: 'older' when a read found an older one,
   * 'maybe' when the lists they came from stopped short.
   */
  more: false | 'older' | 'maybe';
  first: TxRef;
  last: TxRef;
}

/** One flow from its payment rows; null when there are none (or `address` is no exchange's). */
export function exchangeFlow(
  address: string,
  direction: ExchangeFlow['direction'],
  rows: readonly TxRow[],
  more: ExchangeFlow['more'] = false
): ExchangeFlow | null {
  const exchange = exchangeName(address);
  const sorted = rows.filter((row) => row.type === 'PAYMENT').sort(newestFirst);
  if (!exchange || !sorted.length) return null;
  const qort = sorted.reduce(
    (sum, row) => sum + (toAtomic(row.amount) ?? 0n),
    0n
  );
  return {
    exchange,
    address,
    direction,
    rows: sorted,
    qort,
    more,
    first: refOf(sorted[sorted.length - 1]),
    last: refOf(sorted[0]),
  };
}

/**
 * "Sent 9,999.99 QORT to TradeOgre, an exchange, in 10 payments (Mar 2025
 * – May 2026)."; when a read found older ones, "in its newest 1,000
 * payments (…); there are older ones."; from lists that stopped short,
 * "in 10 payments (…); there may be older ones."
 */
const MORE_SUFFIX = { none: '', older: '_more', maybe: '_maybe' } as const;

export function exchangeSentence(flow: ExchangeFlow): TxSentenceSpec {
  const count = flow.rows.length;
  return {
    base: LINK_SAY,
    key: `exchange.${flow.direction}${MORE_SUFFIX[flow.more || 'none']}`,
    slots: {
      amount: {
        kind: 'amount',
        amounts: [
          { amount: fromAtomic(flow.qort), asset: { id: 0, name: null } },
        ],
      },
      exchange: { kind: 'text', text: flow.exchange },
      payments: { kind: 'number', value: count },
      when: {
        kind: 'span',
        first: flow.first.timestamp,
        last: flow.last.timestamp,
      },
    },
    count,
  };
}

/**
 * The flows the Connections lists found, for a node that can't answer the
 * exact read: the QORT payments among the payments found with each
 * exchange. `more` when those lists stopped short.
 */
export function exchangeFlowsFrom(
  recorded: readonly Finding[],
  more: boolean
): ExchangeFlow[] {
  return recorded.flatMap((finding) => {
    if (
      (finding.kind !== 'paidTo' && finding.kind !== 'paidBy') ||
      !finding.other
    )
      return [];
    const flow = exchangeFlow(
      finding.other,
      finding.kind === 'paidTo' ? 'sent' : 'received',
      finding.evidence,
      more ? 'maybe' : false
    );
    return flow ? [flow] : [];
  });
}

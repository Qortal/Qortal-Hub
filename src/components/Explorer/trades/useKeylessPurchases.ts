/**
 * What an account without a public key bought on the Trade Portal: it
 * never made a transaction, so Core can't list its trades by a key it
 * doesn't have. Its purchases are the contracts that paid it, each by its
 * own record (tradeReads.ts `contractRead`, the newest CONTRACTS_MAX, four
 * at a time): a trade contract redeemed with the QORT going to it. A
 * contract that isn't a trade contract (a lottery, any other program) is
 * left out. The Overview's QORT purchased and the Trades tab both count
 * them this way, from the same reads, so the two never disagree.
 */
import { useMemo } from 'react';
import {
  purchaseFromContract,
  type PortalTrade,
} from '../../../lib/explorer/portalTrades';
import {
  CONTRACTS_MAX,
  contractRead,
  payingContracts,
  type Payout,
} from '../../../lib/explorer/tradeReads';
import { useExplorerReads } from '../ExplorerContext';

/** Contract records read at a time. */
const RECORDS_AT_ONCE = 4;

export type KeylessPurchases =
  /** Its payouts aren't known yet. */
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; retry: () => void }
  | {
      status: 'ready';
      /** Its purchases, in the order the payouts came (newest first). */
      trades: PortalTrade[];
      /** More contracts paid it than are read: these are from the newest CONTRACTS_MAX. */
      contractsCut: boolean;
      /** A record read again failed: what is shown is the last answer, with Retry. */
      failedAgain: (() => void) | null;
    };

export function useKeylessPurchases(
  address: string,
  payouts: readonly Payout[] | null
): KeylessPurchases {
  const paying = useMemo(
    () => (payouts ? payingContracts(payouts) : []),
    [payouts]
  );
  const read = useMemo(() => paying.slice(0, CONTRACTS_MAX), [paying]);
  const specs = useMemo(
    () => (read.length ? read.map((payout) => contractRead(payout.at)) : null),
    [read]
  );
  const records = useExplorerReads(specs, {
    concurrency: RECORDS_AT_ONCE,
    keep: true,
  });
  const { data, failed, retry } = records;
  return useMemo((): KeylessPurchases => {
    if (!payouts) return { status: 'idle' };
    const keys = read.map((payout) => contractRead(payout.at).key);
    const missing = keys.some((key) => !data.has(key));
    if (missing && failed.length) return { status: 'failed', retry };
    if (missing) return { status: 'loading' };
    const trades = read
      .map((payout, index) =>
        purchaseFromContract(
          data.get(keys[index]),
          payout.at,
          address,
          payout.timestamp
        )
      )
      .filter((trade): trade is PortalTrade => trade !== null);
    return {
      status: 'ready',
      trades,
      contractsCut: paying.length > read.length,
      failedAgain: failed.length ? retry : null,
    };
  }, [payouts, read, paying.length, data, failed, retry, address]);
}

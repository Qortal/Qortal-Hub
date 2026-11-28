/**
 * What "Recorded between them" is built from, for the Connections tab and
 * the Overview's Direct links (the same reads, so either one's serve the
 * other). Read only for a viewer who sees the detailed parts: the callers
 * are the tab and the preview, both shown only then.
 *
 * - Its payments, Q-Asset transfers and multi-payments, its minting
 *   transactions (reward shares, level moves) and its name transactions:
 *   the Transactions tab's Payments, Minting and Names kinds
 *   (accountTx.ts), the same lists in the window's cache, so the tabs
 *   never disagree and nothing is read twice. 100 at a time, up to 1,000
 *   each; `readOlder` reads 100 more of each list that stopped short.
 * - When its minting list stops short, its level moves on their own (the
 *   Minting kind's TRANSFER_PRIVS), so a level move is never left out.
 * - The recipient of each level move it sent (from the raw bytes, as the
 *   Transactions tab reads it), and the level now of each account it got
 *   its level from.
 * - Who is minting now: the online list, shared with the header.
 * - Its Q-Asset trades: its filled orders and who filled them
 *   (assetTrades.ts), the newest 100 filled orders at most. Only the
 *   Connections tab reads them (`withTrades`): the Overview's Direct links
 *   show them once the tab has read them, and say "+" until then.
 *
 * Nothing polls; Refresh reads the newest page of each list again.
 */
import { useMemo } from 'react';
import { atCeiling, canReadMore } from '../../../lib/explorer/accountTx';
import {
  assetTradesRead,
  type AccountTrades,
} from '../../../lib/explorer/assetTrades';
import {
  linksOf,
  mintingWithNow,
  type ActiveShare,
  type Links,
} from '../../../lib/explorer/connections';
import { recordedFindings, type Finding } from '../../../lib/explorer/findings';
import { flowsOf, type Flow } from '../../../lib/explorer/money';
import { NAME_TX_TYPES } from '../../../lib/explorer/names';
import {
  accountRead,
  onlineRead,
  privsRecipientRead,
  type ExploredAccount,
  type OnlineShare,
  type TxRow,
} from '../../../lib/explorer/reads';
import { typesFor } from '../../../lib/explorer/txFamilies';
import {
  useExplorerKept,
  useExplorerRead,
  useExplorerReads,
  type ReadState,
  type ReadsState,
} from '../ExplorerContext';
import {
  useAccountTxList,
  type AccountTxListState,
} from '../transactions/useAccountTxList';

export const PAYMENT_TYPES = typesFor('payments');
export const MINTING_TYPES = typesFor('minting');
export const LEVEL_MOVE_TYPES = ['TRANSFER_PRIVS'] as const;

/** The reads the findings come from, as the page names them when one fails (`explorer:connections.unread.<part>`). */
export type ConnectionsPart =
  | 'payments'
  | 'minting'
  | 'names'
  | 'level_moves'
  | 'trades'
  | 'online';

export interface ConnectionsData {
  payments: AccountTxListState;
  minting: AccountTxListState;
  names: AccountTxListState;
  /** Its level moves alone: read only while its minting list stops short. */
  levelMoveList: AccountTxListState;
  online: ReadState<OnlineShare[]>;
  /**
   * Its Q-Asset trades: read with `withTrades`; otherwise what the
   * Connections tab read, if it did (status 'idle' while it hasn't).
   */
  trades: ReadState<AccountTrades>;
  /** The recipients of the level moves it sent. */
  privs: ReadsState<string | null>;
  /** What its minting and name transactions say (null until either is read). */
  links: Links | null;
  /** Its active shares minting now (null until the shares and the online list are read). */
  mintingWith: ActiveShare[] | null;
  /** Payments and transfers it sent, by recipient (null until its payments are read). */
  flowsSent: Flow[] | null;
  /** Payments and transfers it received, by sender. */
  flowsReceived: Flow[] | null;
  /** What was recorded between it and others, in the page's order. */
  recorded: Finding[];
  /** Every part it reads has been read or failed. */
  settled: boolean;
  /** Everything it found is counted: every part read, none in part. */
  complete: boolean;
  /** The parts that failed with nothing read: what they would show isn't claimed as checked. */
  failed: ConnectionsPart[];
  /** Reads the failed parts again. */
  retryFailed: () => void;
  /** Lists on screen whose Refresh couldn't read them again. */
  refreshFailed: boolean;
  /** Reads those lists' newest page again. */
  retryRefresh: () => void;
  /** Its level moves were all read (its minting list in full, or its level moves on their own). */
  levelMovesComplete: boolean;
  /** Read 100 older rows of each list that stopped short. */
  readOlder: () => void;
  /** Some list can read older rows. */
  canReadOlder: boolean;
  /** Reading older rows now. */
  olderLoading: boolean;
  /** Reading older rows failed for some list. */
  olderFailed: boolean;
  /** Read again the older rows that failed (only those lists). */
  retryOlder: () => void;
}

/** A list read in part: it stopped short of the node's whole list. */
export const isShort = (state: AccountTxListState) =>
  Boolean(state.list && !state.list.done);

/** A list that failed before anything of it was read. */
const failedEmpty = (state: AccountTxListState) =>
  !state.list && Boolean(state.error);

export function useConnections(
  address: string,
  {
    enabled = true,
    withTrades = true,
  }: { enabled?: boolean; withTrades?: boolean } = {}
): ConnectionsData {
  const payments = useAccountTxList(address, PAYMENT_TYPES, { enabled });
  const minting = useAccountTxList(address, MINTING_TYPES, { enabled });
  const names = useAccountTxList(address, NAME_TX_TYPES, { enabled });
  const levelMoveList = useAccountTxList(address, LEVEL_MOVE_TYPES, {
    enabled: enabled && isShort(minting),
  });
  const online = useExplorerRead(enabled ? onlineRead() : null);
  const tradesSpec = assetTradesRead(address);
  const tradesRead = useExplorerRead(enabled && withTrades ? tradesSpec : null);
  // Without `withTrades`: only what the Connections tab already read.
  const tradesKept = useExplorerKept<AccountTrades>(
    enabled && !withTrades ? tradesSpec.key : null
  );
  const trades: ReadState<AccountTrades> = withTrades
    ? tradesRead
    : {
        data: tradesKept,
        error: undefined,
        status: tradesKept === undefined ? 'idle' : 'ready',
        retry: tradesRead.retry,
      };

  /** Its minting rows, its level moves read on their own, and its name purchases and sales. */
  const linkRows = useMemo(() => {
    if (!minting.list && !names.list) return null;
    return [
      ...(minting.list?.rows ?? []),
      ...(levelMoveList.list?.rows ?? []),
      ...(names.list?.rows ?? []).filter((row) => row.type === 'BUY_NAME'),
    ];
  }, [minting.list, levelMoveList.list, names.list]);

  // The level moves it sent: their recipients are in their raw bytes.
  const sentMoves = useMemo(
    () =>
      [
        ...new Set(
          (linkRows ?? [])
            .filter(
              (row) =>
                row.type === 'TRANSFER_PRIVS' && row.creatorAddress === address
            )
            .map((row) => row.signature)
        ),
      ].sort(),
    [linkRows, address]
  );
  const privSpecs = useMemo(
    () =>
      enabled && sentMoves.length ? sentMoves.map(privsRecipientRead) : null,
    [enabled, sentMoves]
  );
  const privs = useExplorerReads(privSpecs);

  const links = useMemo(() => {
    if (!linkRows) return null;
    // A move whose recipient is still being read waits; one that failed says so.
    const recipients: Record<string, string | null> = {};
    const waiting = new Set<string>();
    for (const signature of sentMoves) {
      const key = privsRecipientRead(signature).key;
      if (privs.data.has(key))
        recipients[signature] = privs.data.get(key) ?? null;
      else if (privs.failed.includes(key)) recipients[signature] = null;
      else waiting.add(signature);
    }
    const rows: TxRow[] = linkRows.filter((row) => !waiting.has(row.signature));
    return linksOf(rows, address, recipients);
  }, [linkRows, sentMoves, privs.data, privs.failed, address]);

  // The level now of each account it got its level from: "now level 0".
  const givers = useMemo(
    () =>
      [
        ...new Set(
          (links?.levelMoves ?? [])
            .filter((move) => move.direction === 'from' && move.other)
            .map((move) => move.other as string)
        ),
      ].sort(),
    [links]
  );
  const levelSpecs = useMemo(
    () => (enabled && givers.length ? givers.map(accountRead) : null),
    [enabled, givers]
  );
  const levelReads = useExplorerReads<ExploredAccount>(levelSpecs);
  const levels = useMemo(() => {
    const out: Record<string, number> = {};
    for (const giver of givers) {
      const read = levelReads.data.get(accountRead(giver).key);
      if (read?.kind === 'account') out[giver] = read.account.level;
    }
    return out;
  }, [givers, levelReads.data]);

  const mintingWith = useMemo(
    () =>
      links && minting.list && online.data
        ? mintingWithNow(links, address, online.data)
        : null,
    [links, minting.list, online.data, address]
  );
  const flowsSent = useMemo(
    () => (payments.list ? flowsOf(payments.list.rows, address, 'sent') : null),
    [payments.list, address]
  );
  const flowsReceived = useMemo(
    () =>
      payments.list ? flowsOf(payments.list.rows, address, 'received') : null,
    [payments.list, address]
  );
  const mintingShort = isShort(minting);
  const recorded = useMemo(
    () =>
      recordedFindings({
        address,
        links,
        mintingWith,
        sent: flowsSent,
        received: flowsReceived,
        levels,
        trades: trades.data?.trades ?? null,
        mintingShort,
      }),
    [
      address,
      links,
      mintingWith,
      flowsSent,
      flowsReceived,
      levels,
      trades.data,
      mintingShort,
    ]
  );

  const lists = { payments, minting, names } as const;
  const failed: ConnectionsPart[] = (
    Object.keys(lists) as Array<keyof typeof lists>
  ).filter((part) => failedEmpty(lists[part]));
  if (privs.failed.length || failedEmpty(levelMoveList))
    failed.push('level_moves');
  const tradesFailed = trades.status === 'error' && trades.data === undefined;
  if (tradesFailed) failed.push('trades');
  const onlineFailed = online.status === 'error' && online.data === undefined;
  if (onlineFailed) failed.push('online');
  const retryFailed = () => {
    for (const part of Object.keys(lists) as Array<keyof typeof lists>)
      if (failedEmpty(lists[part])) lists[part].retry();
    if (failedEmpty(levelMoveList)) levelMoveList.retry();
    if (privs.failed.length) privs.retry();
    if (tradesFailed) trades.retry();
    if (onlineFailed) online.retry();
  };
  // A Refresh that couldn't read a list again: its rows stay, and it says so.
  const refreshLists = [payments, minting, names, levelMoveList].filter(
    (state) => Boolean(state.list && state.error)
  );
  const retryRefresh = () => {
    for (const state of refreshLists) state.retry();
  };

  const settledList = (state: AccountTxListState) =>
    Boolean(state.list || state.error);
  const settled =
    settledList(payments) &&
    settledList(minting) &&
    settledList(names) &&
    (!isShort(minting) || settledList(levelMoveList)) &&
    !privs.loading &&
    (online.data !== undefined || online.status === 'error') &&
    (!withTrades || trades.data !== undefined || trades.status === 'error');
  const short =
    isShort(payments) ||
    isShort(minting) ||
    isShort(names) ||
    Boolean(trades.data?.truncated) ||
    Boolean(trades.data?.fillsCut);
  // Everything counted: settled, nothing failed or read in part, the online list and the trades in.
  const complete =
    settled &&
    !failed.length &&
    !short &&
    online.data !== undefined &&
    trades.data !== undefined;

  const shortLists = [payments, minting, names].filter(
    (state) => state.list && canReadMore(state.list)
  );
  const readOlder = () => {
    for (const state of shortLists) state.showMore();
  };
  const retryOlder = () => {
    for (const state of [payments, minting, names])
      if (state.more.error) state.showMore();
  };

  return {
    payments,
    minting,
    names,
    levelMoveList,
    online,
    trades,
    privs,
    links,
    mintingWith,
    flowsSent,
    flowsReceived,
    recorded,
    settled,
    complete,
    failed,
    retryFailed,
    refreshFailed: refreshLists.length > 0,
    retryRefresh,
    levelMovesComplete: Boolean(
      (minting.list && minting.list.done) ||
      (levelMoveList.list && levelMoveList.list.done)
    ),
    readOlder,
    canReadOlder: shortLists.length > 0,
    olderLoading: [payments, minting, names].some(
      (state) => state.more.loading
    ),
    olderFailed: [payments, minting, names].some((state) =>
      Boolean(state.more.error)
    ),
    retryOlder,
  };
}

/** A list stopped at the Explorer's most, while the node has more. */
export const stoppedAtCeiling = (state: AccountTxListState) =>
  Boolean(state.list && atCeiling(state.list));

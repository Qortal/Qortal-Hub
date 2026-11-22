/**
 * Every read Compare makes, per account and per pair, and what the rules
 * (lib/explorer/compare.ts) make of them. Wherever a read is the account
 * page's, it is the same read (the same key in the window's cache), so an
 * account already explored costs nothing more.
 *
 * - Per account, at once: the account itself; then its primary name, its
 *   groups, where its first QORT came from and when it was first seen; and
 *   the Connections tab's reads (useConnections: its Payments, Minting and
 *   Names lists, 100 at a time, its level moves' recipients, who is
 *   minting now, its Q-Asset trades) and its trade portal sales (the
 *   Overview's Trade Portal read, by its public key, all of them), two
 *   accounts at a time: the third and fourth start once each of the first
 *   two was read, or its read failed.
 * - Per pair, the QORT payments each way, exactly (100 a read, up to
 *   1,000 a way), two at a time.
 * - When the timeline or In common nears the screen: each primary name's
 *   record (when it was registered), the Minting list of a sponsor two of
 *   them share (how many accounts it sponsored), and how many payments each
 *   shared payer has sent (4 at a time).
 * - When Side by side nears the screen: its names, its balance and the
 *   last transaction it sent.
 *
 * An address the node doesn't know (never used, or not valid) gets no read
 * beyond the first. Nothing polls; Refresh reads each account again.
 */
import { useMemo } from 'react';
import { fundingRead } from '../../../lib/explorer/connectionReads';
import {
  checkState,
  foundFor,
  letterOf,
  PAIR_CHECKS,
  pairFindings,
  pairsOf,
  portalFindings,
  sameFirstPayers,
  sameSponsors,
  sharedCounterparties,
  sharedGroups,
  bandAddressesOf,
  timelineEvents,
  type CheckState,
  type CompareSide,
  type Letter,
  type PairCheck,
  type PairFinding,
  type PairRef,
  type PortalFinding,
  type ReadCoverage,
  type SameSponsor,
  type TimelineEvent,
} from '../../../lib/explorer/compare';
import {
  pairPaymentsRead,
  payerBandRead,
  type PayerBand,
} from '../../../lib/explorer/compareReads';
import type { PaymentsBetween } from '../../../lib/explorer/connectionReads';
import type { Funding } from '../../../lib/explorer/connections';
import {
  balanceRead,
  portalTradesRead,
  type Balance,
  type PortalSale,
  type PortalTrades,
} from '../../../lib/explorer/qortReads';
import {
  accountRead,
  firstSeenRead,
  groupsOfRead,
  lastSentRead,
  nameDataRead,
  namesOfRead,
  primaryNameRead,
  privsRecipientRead,
  type AccountInfo,
  type BlockAt,
  type ExploredAccount,
  type GroupOf,
  type LastSent,
  type NameData,
  type NamesOf,
  type OnlineShare,
  type TxRow,
} from '../../../lib/explorer/reads';
import {
  useExplorerRead,
  useExplorerReads,
  type ReadState,
  type ReadsState,
} from '../ExplorerContext';
import {
  useAccountTxList,
  type AccountTxListState,
} from '../transactions/useAccountTxList';
import {
  MINTING_TYPES,
  useConnections,
  type ConnectionsData,
} from '../connections/useConnections';

/** How far each of an account's reads got, for what Compare checks. */
export interface SideCoverage {
  payments: ReadCoverage;
  minting: ReadCoverage;
  names: ReadCoverage;
  levelMoves: ReadCoverage;
  trades: ReadCoverage;
  portal: ReadCoverage;
}

export interface CompareSideData {
  address: string;
  index: number;
  letter: Letter;
  explored: ReadState<ExploredAccount>;
  /** The account, once the node knows it (null: unused, not valid, or not read yet). */
  account: AccountInfo | null;
  conn: ConnectionsData;
  primary: ReadState<string | null>;
  groups: ReadState<GroupOf[]>;
  funding: ReadState<Funding | null>;
  firstSeen: ReadState<BlockAt | null>;
  /** Side by side only. */
  names: ReadState<NamesOf>;
  balance: ReadState<Balance>;
  lastSent: ReadState<LastSent | null>;
  /**
   * Its trades on the Trade Portal, the Overview's read (one read a side,
   * without a limit): idle without a public key, as it never sold one.
   */
  portal: ReadState<PortalTrades>;
  coverage: SideCoverage;
  /** What the rules read of it. */
  side: CompareSide;
}

const NO_SALES: readonly PortalSale[] = [];

const listCoverage = (state: AccountTxListState): ReadCoverage =>
  state.list
    ? state.list.done
      ? 'complete'
      : 'partial'
    : state.error
      ? 'failed'
      : 'reading';

const readCoverage = (read: ReadState<unknown>): ReadCoverage =>
  read.data !== undefined
    ? 'complete'
    : read.status === 'error'
      ? 'failed'
      : 'reading';

function levelMovesCoverage(conn: ConnectionsData): ReadCoverage {
  if (!conn.minting.list) return conn.minting.error ? 'failed' : 'reading';
  if (conn.privs.failed.length) return 'failed';
  if (conn.privs.loading) return 'reading';
  if (conn.levelMovesComplete) return 'complete';
  if (!conn.levelMoveList.list)
    return conn.levelMoveList.error ? 'failed' : 'reading';
  return 'partial';
}

function tradesCoverage(conn: ConnectionsData): ReadCoverage {
  const data = conn.trades.data;
  if (data) return data.truncated || data.fillsCut ? 'partial' : 'complete';
  return conn.trades.status === 'error' ? 'failed' : 'reading';
}

/**
 * Its reward shares, level moves and name purchases and sales, as the
 * Connections tab reads them: a level move it sent waits until its
 * recipient is read (one that couldn't be read has none).
 */
function sideLinks(
  conn: ConnectionsData,
  address: string
): { rows: TxRow[] | undefined; privs: Record<string, string | null> } {
  const { minting, levelMoveList, names, privs } = conn;
  if (!minting.list && !names.list) return { rows: undefined, privs: {} };
  const recipients: Record<string, string | null> = {};
  const rows: TxRow[] = [];
  for (const row of [
    ...(minting.list?.rows ?? []),
    ...(levelMoveList.list?.rows ?? []),
    ...(names.list?.rows ?? []).filter((tx) => tx.type === 'BUY_NAME'),
  ]) {
    if (row.type === 'TRANSFER_PRIVS' && row.creatorAddress === address) {
      const key = privsRecipientRead(row.signature).key;
      if (privs.data.has(key))
        recipients[row.signature] = privs.data.get(key) ?? null;
      else if (privs.failed.includes(key)) recipients[row.signature] = null;
      else continue;
    }
    rows.push(row);
  }
  return { rows, privs: recipients };
}

function useCompareSide(
  address: string | undefined,
  index: number,
  {
    start,
    side: sideNear,
  }: {
    /** Its Connections reads may start (two accounts at a time). */
    start: boolean;
    /** Side by side is near the screen. */
    side: boolean;
  }
): CompareSideData {
  const explored = useExplorerRead(address ? accountRead(address) : null);
  const account =
    explored.data?.kind === 'account' ? explored.data.account : null;
  const live = account !== null && address !== undefined;
  const conn = useConnections(address ?? '', { enabled: live && start });
  const primary = useExplorerRead(
    live ? primaryNameRead(address as string) : null
  );
  const groups = useExplorerRead(live ? groupsOfRead(address as string) : null);
  const funding = useExplorerRead(account ? fundingRead(account) : null);
  const firstSeen = useExplorerRead(
    live ? firstSeenRead(address as string) : null
  );
  const names = useExplorerRead(
    live && sideNear ? namesOfRead(address as string) : null
  );
  const balance = useExplorerRead(
    live && sideNear ? balanceRead(address as string) : null
  );
  const lastSent = useExplorerRead(
    live && sideNear && account?.publicKey
      ? lastSentRead(address as string, account.publicKey)
      : null
  );
  const portal = useExplorerRead(
    live && start && account?.publicKey
      ? portalTradesRead(address as string, account.publicKey)
      : null
  );
  // No public key: it never made an AT, so it never sold on the trade portal.
  const portalSales: readonly PortalSale[] | undefined = account
    ? account.publicKey
      ? portal.data?.sales
      : NO_SALES
    : undefined;
  const links = useMemo(
    () => sideLinks(conn, address ?? ''),
    // The parts of `conn` sideLinks reads.
    [
      conn.minting.list,
      conn.levelMoveList.list,
      conn.names.list,
      conn.privs.data,
      conn.privs.failed,
      address,
    ]
  );
  const coverage: SideCoverage = {
    payments: listCoverage(conn.payments),
    minting: listCoverage(conn.minting),
    names: listCoverage(conn.names),
    levelMoves: levelMovesCoverage(conn),
    trades: tradesCoverage(conn),
    // Read whole: never "in part".
    portal: portalSales
      ? 'complete'
      : portal.status === 'error'
        ? 'failed'
        : 'reading',
  };
  const letter = letterOf(index);
  const side = useMemo<CompareSide>(
    () => ({
      address: address ?? '',
      letter,
      level: account?.level,
      payments: conn.payments.list?.rows,
      linkRows: links.rows,
      privs: links.privs,
      trades: conn.trades.data?.trades,
      portal: portalSales,
      minting: coverage.minting,
      funding: funding.data,
      groups: groups.data,
    }),
    [
      address,
      letter,
      account?.level,
      conn.payments.list,
      links,
      conn.trades.data,
      portalSales,
      coverage.minting,
      funding.data,
      groups.data,
    ]
  );
  return {
    address: address ?? '',
    index,
    letter,
    explored,
    account,
    conn,
    primary,
    groups,
    funding,
    firstSeen,
    names,
    balance,
    lastSent,
    portal,
    coverage,
    side,
  };
}

export interface PairData {
  pair: PairRef;
  x: CompareSideData;
  y: CompareSideData;
  /** The QORT payments each way (null: the node can't read them; undefined: not yet, or failed). */
  xy: PaymentsBetween | null | undefined;
  yx: PaymentsBetween | null | undefined;
  /** A read of the payments between them failed. */
  pairFailed: boolean;
  findings: PairFinding[];
  /** What each sold the other on the trade portal. */
  portal: PortalFinding[];
  checks: Record<PairCheck, CheckState>;
}

export type CommonCheck =
  | 'sponsor'
  | 'first_payer'
  | 'counterparties'
  | 'groups';

export const COMMON_CHECKS: readonly CommonCheck[] = [
  'sponsor',
  'first_payer',
  'counterparties',
  'groups',
];

/** A sponsor two of them share, and how many accounts it sponsored (from its own Minting list). */
export interface SharedSponsor extends SameSponsor {
  list: AccountTxListState | null;
}

const pairCoverage = (
  data: PaymentsBetween | null | undefined,
  failed: boolean
): ReadCoverage =>
  data === undefined
    ? failed
      ? 'failed'
      : 'reading'
    : data === null || !data.more
      ? 'complete'
      : 'partial';

export function useCompareData(
  accounts: readonly string[],
  near: { below: boolean; side: boolean }
) {
  const flags = (index: number, before: CompareSideData | null) => ({
    // Two accounts at a time: the third and fourth wait for the first two,
    // each until it was read (and its lists), or its read failed, or the
    // node doesn't know it. Still being looked up is not "settled".
    start:
      index < 2 ||
      before === null ||
      (before.account === null
        ? before.explored.status === 'ready' ||
          before.explored.status === 'error'
        : before.conn.settled),
    side: near.side,
  });
  const a = useCompareSide(accounts[0], 0, flags(0, null));
  const b = useCompareSide(accounts[1], 1, flags(1, null));
  const c = useCompareSide(accounts[2], 2, flags(2, a));
  const d = useCompareSide(accounts[3], 3, flags(3, b));
  const sides = [a, b, c, d].slice(0, Math.min(accounts.length, 4));
  const live = sides.filter((side) => side.account !== null);
  const online: ReadState<OnlineShare[]> | null =
    live.find((side) => side.conn.online.status !== 'idle')?.conn.online ??
    null;

  // ---- Pairs --------------------------------------------------------------------------
  const pairs = pairsOf(sides.length).filter(
    (pair) => sides[pair.i].account && sides[pair.j].account
  );
  const pairKeys = pairs
    .map((pair) => `${sides[pair.i].address}>${sides[pair.j].address}`)
    .join(' ');
  const pairSpecs = useMemo(
    () =>
      pairKeys
        ? pairKeys.split(' ').flatMap((key) => {
            const [x, y] = key.split('>');
            return [pairPaymentsRead(x, y), pairPaymentsRead(y, x)];
          })
        : null,
    [pairKeys]
  );
  // A Refresh that couldn't read them again keeps the payments read, with Retry.
  const pairReads = useExplorerReads(pairSpecs, { concurrency: 2, keep: true });
  const pairData: PairData[] = pairs.map((pair) => {
    const x = sides[pair.i];
    const y = sides[pair.j];
    const xyKey = pairPaymentsRead(x.address, y.address).key;
    const yxKey = pairPaymentsRead(y.address, x.address).key;
    const xy = pairReads.data.get(xyKey);
    const yx = pairReads.data.get(yxKey);
    const xyFailed = pairReads.failed.includes(xyKey);
    const yxFailed = pairReads.failed.includes(yxKey);
    const findings = pairFindings({
      x: x.side,
      y: y.side,
      xy,
      yx,
      online: online?.data,
    });
    const portal = portalFindings(x.side, y.side);
    const coverages: Record<PairCheck, ReadCoverage[]> = {
      payments: [
        x.coverage.payments,
        y.coverage.payments,
        pairCoverage(xy, xyFailed),
        pairCoverage(yx, yxFailed),
      ],
      reward_shares: [x.coverage.minting, y.coverage.minting],
      level_moves: [x.coverage.levelMoves, y.coverage.levelMoves],
      name_sales: [x.coverage.names, y.coverage.names],
      asset_trades: [x.coverage.trades, y.coverage.trades],
      portal_trades: [x.coverage.portal, y.coverage.portal],
    };
    const checks = Object.fromEntries(
      PAIR_CHECKS.map((check) => [
        check,
        checkState(
          check === 'portal_trades'
            ? portal.length > 0
            : foundFor(findings, check),
          coverages[check]
        ),
      ])
    ) as Record<PairCheck, CheckState>;
    return {
      pair,
      x,
      y,
      xy,
      yx,
      pairFailed: xyFailed || yxFailed,
      findings,
      portal,
      checks,
    };
  });

  // ---- In common ------------------------------------------------------------------------
  const liveSides = live.map((side) => side.side);
  const sponsors = sameSponsors(liveSides);
  const firstPayers = sameFirstPayers(liveSides);
  const bandJoined = near.below ? bandAddressesOf(liveSides).join(' ') : '';
  const bandSpecs = useMemo(
    () => (bandJoined ? bandJoined.split(' ').map(payerBandRead) : null),
    [bandJoined]
  );
  const bandReads: ReadsState<PayerBand | null> = useExplorerReads(bandSpecs, {
    concurrency: 4,
  });
  const bands: Record<string, PayerBand | null | undefined> = {};
  for (const address of bandJoined ? bandJoined.split(' ') : [])
    bands[address] = bandReads.data.get(payerBandRead(address).key);
  const counterparties = sharedCounterparties(liveSides, bands);
  const groupsShared = sharedGroups(liveSides);
  const sponsorOne = useAccountTxList(
    sponsors[0]?.sponsor ?? '',
    MINTING_TYPES,
    {
      enabled: near.below && Boolean(sponsors[0]),
    }
  );
  const sponsorTwo = useAccountTxList(
    sponsors[1]?.sponsor ?? '',
    MINTING_TYPES,
    {
      enabled: near.below && Boolean(sponsors[1]),
    }
  );
  const sharedSponsors: SharedSponsor[] = sponsors.map((same, i) => ({
    ...same,
    list: i === 0 ? sponsorOne : i === 1 ? sponsorTwo : null,
  }));
  const commonChecks: Record<CommonCheck, CheckState> = {
    sponsor: checkState(
      sponsors.length > 0,
      live.map((side) => side.coverage.minting)
    ),
    first_payer: checkState(
      firstPayers.length > 0,
      live.map((side) => readCoverage(side.funding))
    ),
    counterparties: checkState(
      counterparties.rows.length > 0 ||
        counterparties.atLeftOut > 0 ||
        counterparties.busyLeftOut > 0,
      [
        ...live.map((side) => side.coverage.payments),
        // A busy payer is left out only once its band is read.
        ...(bandReads.loading ? (['reading'] as ReadCoverage[]) : []),
      ]
    ),
    groups: checkState(
      groupsShared.length > 0,
      live.map((side) => readCoverage(side.groups))
    ),
  };

  // ---- The timeline -------------------------------------------------------------------------
  const primaryJoined = near.below
    ? live
        .map((side) => side.primary.data)
        .filter((name): name is string => Boolean(name))
        .join('\n')
    : '';
  const recordSpecs = useMemo(
    () => (primaryJoined ? primaryJoined.split('\n').map(nameDataRead) : null),
    [primaryJoined]
  );
  const records: ReadsState<NameData | null> = useExplorerReads(recordSpecs, {
    concurrency: 2,
  });
  const timeline: TimelineEvent[] = timelineEvents(
    live.map((side) => {
      const name = side.primary.data;
      const record = name
        ? records.data.get(nameDataRead(name).key)
        : undefined;
      return {
        address: side.address,
        letter: side.letter,
        funding: side.funding.data,
        linkRows: side.side.linkRows,
        privs: side.side.privs,
        minting: side.coverage.minting,
        names: side.coverage.names,
        primary: name
          ? { name, registered: record?.registered }
          : name === null
            ? null
            : undefined,
        firstSeen:
          side.firstSeen.data === undefined
            ? undefined
            : (side.firstSeen.data?.timestamp ?? null),
      };
    })
  );
  const timelineReading =
    !near.below ||
    records.loading ||
    live.some(
      (side) =>
        side.funding.status === 'loading' ||
        side.primary.status === 'loading' ||
        side.firstSeen.status === 'loading' ||
        side.coverage.minting === 'reading' ||
        side.coverage.names === 'reading' ||
        side.coverage.levelMoves === 'reading'
    );

  return {
    accounts,
    sides,
    live,
    online,
    pairs: pairData,
    pairReads,
    sponsors: sharedSponsors,
    firstPayers,
    bands,
    bandReads,
    counterparties,
    groupsShared,
    commonChecks,
    timeline,
    timelineReading,
    records,
  };
}

export type CompareData = ReturnType<typeof useCompareData>;

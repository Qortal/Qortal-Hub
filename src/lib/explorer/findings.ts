/**
 * The Connections tab's findings, in the order the page lists them (from
 * Q-Mintership+'s rules/explorer/findings.ts): "Recorded between them" is
 * level moves, sponsors, minting with another account now, the accounts
 * it sponsored, names bought or sold, then payments by the other account
 * (most payments first, both ways). The Overview's Direct links shows the
 * first three.
 *
 * Each finding is a sentence (a key under `explorer:connections.say`, or a
 * transaction's own sentence, with its slots), when it happened, and the
 * transactions behind it. Evidence only: nothing here says what a link
 * means. Pure: no reads, no text.
 */
import { tradeSums, tradesByAccount, type AssetTrade } from './assetTrades';
import {
  groupLevelMoves,
  type ActiveShare,
  type Funding,
  type Links,
} from './connections';
import { flowAmounts, type AssetSum, type Flow } from './money';
import type { TxRow } from './reads';
import {
  describeTx,
  toAtomic,
  type TxSentenceSpec,
  type TxSlot,
} from './txWords';

/** Where the connection sentences' keys are. */
export const LINK_SAY = 'explorer:connections.say';

export type FindingKind =
  | 'levelMove'
  | 'sponsor'
  | 'mintingWith'
  | 'sponsees'
  | 'nameDeal'
  | 'traded'
  | 'paidTo'
  | 'paidBy';

/** What the transactions behind a finding are, for "4 payments", "2 transactions", "2 orders". */
export type EvidenceKind = 'payments' | 'transactions' | 'orders';

/** One way of a Q-Asset trade finding: what came in (`got`) or went out (`gave`), added up exactly. */
export interface TradeWay {
  /** The trades. */
  count: number;
  /** QORT, in atomic units. */
  qort: bigint;
  /** Q-Assets, in the order first seen. */
  assets: AssetSum[];
}

export interface Finding {
  /** Stable across loads, for React keys and what a row keeps open. */
  key: string;
  kind: FindingKind;
  /** The other account; null for the accounts it sponsored (several) and a move whose recipient couldn't be read. */
  other: string | null;
  sentence: TxSentenceSpec;
  /** The block it happened in (the newest one, for several transactions). */
  height: number;
  timestamp: number;
  /** The oldest block and time, for several transactions over more than one block. */
  firstHeight?: number;
  firstTimestamp?: number;
  /** Its transaction (the newest one, for several). */
  signature: string;
  /** The transactions behind it, newest first. */
  evidence: TxRow[];
  /** Or the signatures of the transactions behind it, read when it opens (a trade's two orders). */
  evidenceSignatures?: string[];
  evidenceKind: EvidenceKind;
  /** QORT moved, in atomic units: payments and transfers only. */
  qort?: bigint;
  /** Q-Assets moved: payments and transfers only. */
  assets?: AssetSum[];
  /** The other account's level now, said under its name ("now level 0"): a level it gave away. */
  otherLevel?: number;
  /** Q-Asset trades: what it got and what it gave (the Connections circle draws both ways). */
  trade?: { got: TradeWay; gave: TradeWay };
}

export interface RecordedInput {
  /** What its minting and name transactions say (null while they are read, or when they failed). */
  links?: Links | null;
  /** Its active shares minting now (null while the online list is read). */
  mintingWith?: readonly ActiveShare[] | null;
  /** Payments and transfers by the other account, each way (null while they are read). */
  sent?: readonly Flow[] | null;
  received?: readonly Flow[] | null;
  /** Each account's level now, where read: for the accounts it got its level from. */
  levels?: Readonly<Record<string, number | undefined>>;
  /** Its Q-Asset trades (null while they are read). */
  trades?: readonly AssetTrade[] | null;
  /** Its minting list was read only in part: counts from it may be more. */
  mintingShort?: boolean;
  /** The account the findings are about: the side the sentences are told from. */
  address: string;
}

const account = (address: string | null): TxSlot => ({
  kind: 'account',
  address,
});
const percent = (value: string): TxSlot => ({ kind: 'percent', value });
const count = (value: number): TxSlot => ({ kind: 'number', value });
const span = (first: number, last: number): TxSlot => ({
  kind: 'span',
  first,
  last,
});

const one = (tx: TxRow) => ({
  height: typeof tx.blockHeight === 'number' ? tx.blockHeight : 0,
  timestamp: tx.timestamp,
  signature: tx.signature,
});

/** "Paid Second 120 QORT in 4 payments (Mar – May 2025)" / "Received 10 QORT from Second in 1 payment (12 Mar 2025)". */
export function flowSentence(
  flow: Flow,
  direction: 'sent' | 'received'
): TxSentenceSpec {
  return {
    base: LINK_SAY,
    key: direction === 'sent' ? 'paid' : 'received',
    slots: {
      other: account(flow.address),
      amount: { kind: 'amount', amounts: flowAmounts(flow) },
      payments: count(flow.count),
      when: span(flow.first.timestamp, flow.last.timestamp),
    },
    count: flow.count,
  };
}

/**
 * The Q-Asset trades with one account, from the account's side: one trade
 * whole ("Bought 23 GBQ from Second for 529 QORT", "Sold …", "Traded …
 * for … with …"), several added up by what moved each way.
 */
export function tradesSentence(
  other: string,
  trades: readonly AssetTrade[]
): TxSentenceSpec {
  const who = account(other);
  if (trades.length === 1) {
    const [trade] = trades;
    const gave: TxSlot = { kind: 'amount', amounts: [trade.gave] };
    const got: TxSlot = { kind: 'amount', amounts: [trade.got] };
    const key =
      trade.gave.asset.id === 0
        ? 'trade.bought'
        : trade.got.asset.id === 0
          ? 'trade.sold'
          : 'trade.swapped';
    return { base: LINK_SAY, key, slots: { other: who, gave, got } };
  }
  return {
    base: LINK_SAY,
    key: 'trade.many',
    slots: {
      other: who,
      trades: count(trades.length),
      got: { kind: 'amount', amounts: tradeSums(trades, 'got') },
      gave: { kind: 'amount', amounts: tradeSums(trades, 'gave') },
    },
    count: trades.length,
  };
}

/** What moved one way over `trades`: QORT apart, each Q-Asset added up exactly, in the order first seen. */
function tradeWay(
  trades: readonly AssetTrade[],
  way: 'got' | 'gave'
): TradeWay {
  let qort = 0n;
  const assets: AssetSum[] = [];
  for (const trade of trades) {
    const { asset, amount } = trade[way];
    const atomic = toAtomic(amount) ?? 0n;
    if (asset.id === 0) {
      qort += atomic;
      continue;
    }
    const same = assets.find(
      (sum) =>
        sum.asset.id === asset.id &&
        (asset.id !== null || sum.asset.name === asset.name)
    );
    if (same) same.atomic += atomic;
    else assets.push({ asset, atomic });
  }
  return { count: trades.length, qort, assets };
}

/**
 * One Q-Asset trade from the account's side: bought, sold or traded for
 * another asset, with the other account (none when the node doesn't know
 * its order). The Trades tab's list and an asset order's row say it.
 */
export function tradeSentence(trade: AssetTrade): TxSentenceSpec {
  const key =
    trade.gave.asset.id === 0
      ? 'trade.bought'
      : trade.got.asset.id === 0
        ? 'trade.sold'
        : 'trade.swapped';
  return {
    base: LINK_SAY,
    key,
    slots: {
      other: { kind: 'account', address: trade.other },
      gave: { kind: 'amount', amounts: [trade.gave] },
      got: { kind: 'amount', amounts: [trade.got] },
    },
  };
}

/** What was recorded between `input.address` and other accounts, in the page's order. */
export function recordedFindings(input: RecordedInput): Finding[] {
  const out: Finding[] = [];
  const { links, address } = input;
  if (links) {
    // Several moves between the same two accounts the same way: one finding.
    for (const group of groupLevelMoves(links.levelMoves)) {
      const first = group[0];
      const last = group[group.length - 1];
      const sentence: TxSentenceSpec =
        first.direction === 'from'
          ? { key: 'transfer_privs.in', slots: { from: account(first.other) } }
          : first.other
            ? { key: 'transfer_privs.out', slots: { to: account(first.other) } }
            : { key: 'transfer_privs.out_unknown', slots: {} };
      out.push({
        key: `level:${first.ref.signature}`,
        kind: 'levelMove',
        other: first.other,
        sentence,
        ...one(last.tx),
        // Several over more than one block: from the first to the last.
        ...(first.ref.height !== last.ref.height
          ? {
              firstHeight: first.ref.height,
              firstTimestamp: first.ref.timestamp,
            }
          : {}),
        evidence: group.map((move) => move.tx).reverse(),
        evidenceKind: 'transactions',
        ...(first.direction === 'from' &&
        first.other &&
        input.levels?.[first.other] !== undefined
          ? { otherLevel: input.levels[first.other] }
          : {}),
      });
    }
    for (const sponsorship of links.sponsors)
      out.push({
        key: `sponsor:${sponsorship.sponsor}`,
        kind: 'sponsor',
        other: sponsorship.sponsor,
        sentence:
          sponsorship.blocks !== null
            ? {
                base: LINK_SAY,
                key: 'sponsor.for_blocks',
                slots: {
                  sponsor: account(sponsorship.sponsor),
                  percent: percent(sponsorship.percent),
                  blocks: count(sponsorship.blocks),
                },
                count: sponsorship.blocks,
              }
            : {
                base: LINK_SAY,
                key: 'sponsor.not_removed',
                slots: {
                  sponsor: account(sponsorship.sponsor),
                  percent: percent(sponsorship.percent),
                },
              },
        height: sponsorship.start.height,
        timestamp: sponsorship.start.timestamp,
        signature: sponsorship.start.signature,
        evidence: sponsorship.txs,
        evidenceKind: 'transactions',
      });
  }
  for (const share of input.mintingWith ?? [])
    out.push({
      key: `minting:${share.other}`,
      kind: 'mintingWith',
      other: share.other,
      sentence: {
        base: LINK_SAY,
        key:
          share.role === 'minter'
            ? 'minting_with.its_share'
            : 'minting_with.their_share',
        slots: { other: account(share.other), percent: percent(share.percent) },
      },
      ...one(share.tx),
      evidence: [share.tx],
      evidenceKind: 'transactions',
    });
  if (links?.sponsees.length) {
    const first = links.sponsees[0];
    const last = links.sponsees[links.sponsees.length - 1];
    const evidence = links.sponsees
      .flatMap((sponsee) => sponsee.txs)
      .sort(
        (a, b) =>
          (b.blockHeight ?? 0) - (a.blockHeight ?? 0) ||
          b.timestamp - a.timestamp
      );
    out.push({
      key: 'sponsees',
      kind: 'sponsees',
      other: null,
      sentence: {
        base: LINK_SAY,
        key: input.mintingShort ? 'sponsees_more' : 'sponsees',
        slots: {
          accounts: count(links.sponsees.length),
          when: span(first.start.timestamp, last.start.timestamp),
        },
        count: links.sponsees.length,
      },
      height: last.start.height,
      timestamp: last.start.timestamp,
      ...(first.start.height !== last.start.height
        ? {
            firstHeight: first.start.height,
            firstTimestamp: first.start.timestamp,
          }
        : {}),
      signature: last.start.signature,
      evidence,
      evidenceKind: 'transactions',
    });
  }
  for (const deal of links?.nameDeals ?? [])
    out.push({
      key: `name:${deal.ref.signature}`,
      kind: 'nameDeal',
      other: deal.other,
      // The transaction's own sentence, told from this account's side.
      sentence: describeTx(deal.tx, { viewpoint: address }).sentence,
      ...one(deal.tx),
      evidence: [deal.tx],
      evidenceKind: 'transactions',
    });
  for (const [other, trades] of tradesByAccount(input.trades ?? [], address)) {
    const newest = trades[0];
    const oldest = trades[trades.length - 1];
    // Its own order and the other's, for each trade, newest first, each once.
    const orders = [
      ...new Set(
        trades.flatMap((trade) => [trade.orderId, trade.otherOrderId])
      ),
    ];
    out.push({
      key: `traded:${other}`,
      kind: 'traded',
      other,
      sentence: tradesSentence(other, trades),
      // Core's trade says when, not in which block.
      height: 0,
      timestamp: newest.timestamp,
      ...(oldest.timestamp !== newest.timestamp
        ? { firstTimestamp: oldest.timestamp }
        : {}),
      signature: newest.orderId,
      evidence: [],
      evidenceSignatures: orders,
      evidenceKind: 'orders',
      trade: { got: tradeWay(trades, 'got'), gave: tradeWay(trades, 'gave') },
    });
  }
  const flows = [
    ...(input.sent ?? []).map((flow) => ({ flow, kind: 'paidTo' as const })),
    ...(input.received ?? []).map((flow) => ({
      flow,
      kind: 'paidBy' as const,
    })),
  ]
    .filter(({ flow }) => !flow.isAt)
    .sort(
      (a, b) =>
        b.flow.count - a.flow.count ||
        b.flow.last.height - a.flow.last.height ||
        a.flow.address.localeCompare(b.flow.address)
    );
  for (const { flow, kind } of flows)
    out.push({
      key: `${kind}:${flow.address}`,
      kind,
      other: flow.address,
      sentence: flowSentence(flow, kind === 'paidTo' ? 'sent' : 'received'),
      height: flow.last.height,
      timestamp: flow.last.timestamp,
      ...(flow.first.height !== flow.last.height
        ? {
            firstHeight: flow.first.height,
            firstTimestamp: flow.first.timestamp,
          }
        : {}),
      signature: flow.last.signature,
      evidence: flow.txs,
      evidenceKind: 'payments',
      qort: flow.qort,
      assets: flow.assets,
    });
  return out;
}

/**
 * Where its first QORT came from, worded by the kind of transaction: only
 * a payment is its first QORT; a reward share, a level move or an asset
 * transfer moved no QORT to it.
 */
export function fundingSentence(funding: Funding): TxSentenceSpec {
  const from = account(funding.from);
  const amount: TxSlot = {
    kind: 'amount',
    amounts: [
      {
        amount: funding.amount ?? '0',
        asset: {
          id: funding.assetId === undefined ? 0 : funding.assetId,
          name: funding.assetName ?? null,
        },
      },
    ],
  };
  const say = (key: string, slots: Record<string, TxSlot>): TxSentenceSpec => ({
    base: LINK_SAY,
    key,
    slots,
  });
  const known = funding.from !== null;
  switch (funding.kind) {
    case 'payment':
    case 'multiPayment':
      return known
        ? say('first.payment', { amount, from })
        : say('first.payment_unknown', { amount });
    case 'transferAsset':
      return known
        ? say('first.transfer', { amount, from })
        : say('first.transfer_unknown', { amount });
    case 'rewardShare':
      return known
        ? say('first.reward_share', {
            percent: percent(funding.sharePercent ?? '0'),
            from,
          })
        : say('first.reward_share_unknown', {
            percent: percent(funding.sharePercent ?? '0'),
          });
    case 'transferPrivs':
      return known
        ? say('first.level', { from })
        : say('first.level_unknown', {});
    case 'at':
      return known
        ? say('first.at', { amount, from })
        : say('first.at_unknown', { amount });
    case 'genesis':
      // Say QORT only when it was QORT: the genesis block gave out other assets too.
      return funding.assetId === 0 || funding.assetId === undefined
        ? say('first.genesis_qort', { amount })
        : say('first.genesis_asset', { amount });
  }
}

/** The tag on the row of the account its first incoming transaction came from, by what it was. */
export function fundingTagKey(funding: Pick<Funding, 'kind'>): string | null {
  switch (funding.kind) {
    case 'payment':
    case 'multiPayment':
      return 'explorer:connections.tag.first_qort';
    case 'transferPrivs':
      return 'explorer:connections.tag.first_level';
    case 'rewardShare':
    case 'transferAsset':
      return 'explorer:connections.tag.first_incoming';
    default:
      return null;
  }
}

/** "Also sponsored by A (47 others)", "(47+ others)" when its sponsor's list was read in part. */
export function siblingsSentence(
  sponsor: string,
  others: number,
  more: boolean
): TxSentenceSpec {
  return {
    base: LINK_SAY,
    key: more ? 'siblings_more' : 'siblings',
    slots: { sponsor: account(sponsor), others: count(others) },
    count: others,
  };
}

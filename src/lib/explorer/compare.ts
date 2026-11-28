/**
 * Compare: two to four accounts side by side, lettered A–D (from
 * Q-Mintership+'s rules/explorer/compare.ts, without what belongs to
 * Q-Mintership itself: its records and nominations). What the page lists,
 * worked out from the reads already made. Pure: no reads, no text.
 *
 * - Recorded between them, pair by pair: the Connections tab's own
 *   findings (findings.ts `recordedFindings`, the same sentences), each
 *   told by the account that did it, from both accounts' transactions
 *   together: what one of them read can show what the other's newest
 *   transactions no longer reach. Payments each way (with Q-Asset
 *   transfers and multi-payments, and the QORT payments between the two
 *   read exactly), Q-Asset trades, reward shares (a sponsor, minting with
 *   the other now), minting levels moved and names bought or sold.
 * - In common: the same first sponsor, the same first payer, accounts
 *   two or more of them paid or were paid by (the compared accounts, AT
 *   addresses and accounts that sent 1,000+ payments left out and
 *   counted), and groups two or more are in, smallest first (MINTER is
 *   shown on each account).
 * - Timeline together: where each one's first QORT came from, its primary
 *   name, its first self-share and its level moves, in one list, oldest
 *   first, with how far apart they were.
 *
 * Evidence only: numbers, blocks, dates and directions, never a verdict
 * and never a threshold. Nothing here says what a link means.
 */
import type { AssetTrade } from './assetTrades';
import type { PaymentsBetween } from './connectionReads';
import type { PayerBand } from './compareReads';
import type { PortalSale } from './qortReads';
import {
  isRemoval,
  linksOf,
  mintingWithNow,
  type Funding,
} from './connections';
import {
  fundingSentence,
  recordedFindings,
  type Finding,
  type FindingKind,
} from './findings';
import { flowsOf, type Flow } from './money';
import {
  MINTER_GROUP_ID,
  type GroupOf,
  type OnlineShare,
  type TxRow,
} from './reads';
import {
  describeTx,
  fromAtomic,
  toAtomic,
  type TxSentenceSpec,
} from './txWords';

/** Where Compare's own sentences are. */
export const COMPARE_SAY = 'explorer:compare.say';

/**
 * Whether where an account's first QORT came from is a first QORT payment:
 * a PAYMENT (the Funded page reads payments only), never a multi-payment.
 * In common, the check across a set and the Funded page all go by it.
 */
export const isFirstQortPayment = (funding: Pick<Funding, 'kind'>): boolean =>
  funding.kind === 'payment';

// ---- Letters and pairs ----------------------------------------------------------------

export const LETTERS = ['A', 'B', 'C', 'D'] as const;
export type Letter = (typeof LETTERS)[number];

export const letterOf = (index: number): Letter =>
  LETTERS[Math.min(Math.max(0, index), LETTERS.length - 1)];

export interface PairRef {
  /** The two accounts' places, i < j. */
  i: number;
  j: number;
  /** "a-b", for ids and keys. */
  id: string;
}

/** Every pair of `count` accounts, in letter order: A–B, A–C, …, C–D. */
export function pairsOf(count: number): PairRef[] {
  const pairs: PairRef[] = [];
  for (let i = 0; i < count; i++)
    for (let j = i + 1; j < count; j++)
      pairs.push({
        i,
        j,
        id: `${letterOf(i)}-${letterOf(j)}`.toLowerCase(),
      });
  return pairs;
}

// ---- What is known of each account --------------------------------------------------

/** How far a read got: all of it, only a part, still on its way, or failed with nothing read. */
export type ReadCoverage = 'complete' | 'partial' | 'reading' | 'failed';

/** One compared account and what has been read about it so far. */
export interface CompareSide {
  address: string;
  letter: Letter;
  /** Its level now. */
  level?: number;
  /** Its payments, Q-Asset transfers and multi-payments read so far (undefined: none yet). */
  payments?: readonly TxRow[];
  /**
   * Its reward shares, level moves and name purchases and sales read so
   * far (a level move it sent only once its recipient is read).
   */
  linkRows?: readonly TxRow[];
  /** The recipients of the level moves it sent, by signature (null: couldn't be read). */
  privs?: Readonly<Record<string, string | null>>;
  /** Its Q-Asset trades read (undefined: not yet). */
  trades?: readonly AssetTrade[];
  /** Its trade portal sales, all of them (undefined: not yet; none without a public key). */
  portal?: readonly PortalSale[];
  /** How far its minting transactions were read: its first sponsor is known only from all of them. */
  minting?: ReadCoverage;
  /** Where its first QORT came from (null: none found; undefined: not yet). */
  funding?: Funding | null;
  groups?: readonly GroupOf[];
}

// ---- Recorded between them ----------------------------------------------------------

/** What a pair is checked for, in the page's order. */
export type PairCheck =
  | 'payments'
  | 'reward_shares'
  | 'level_moves'
  | 'name_sales'
  | 'asset_trades'
  | 'portal_trades';

export const PAIR_CHECKS: readonly PairCheck[] = [
  'payments',
  'reward_shares',
  'level_moves',
  'name_sales',
  'asset_trades',
  'portal_trades',
];

/** The Connections tab's findings each check finds (trade portal sales are Compare's own). */
const CHECK_KINDS: Readonly<Record<PairCheck, readonly FindingKind[]>> = {
  payments: ['paidTo'],
  reward_shares: ['sponsor', 'mintingWith'],
  level_moves: ['levelMove'],
  name_sales: ['nameDeal'],
  asset_trades: ['traded'],
  portal_trades: [],
};

/** The order the findings are listed in. */
const KIND_ORDER: readonly FindingKind[] = [
  'levelMove',
  'sponsor',
  'mintingWith',
  'nameDeal',
  'traded',
  'paidTo',
];

export interface PairFinding {
  /** The account that did it: the finding is told from its side. */
  actor: string;
  /** The other account of the pair. */
  other: string;
  finding: Finding;
}

export interface PairInput {
  x: CompareSide;
  y: CompareSide;
  /** The QORT payments x made to y, and y to x (null: the node can't read them; undefined: not yet). */
  xy?: PaymentsBetween | null;
  yx?: PaymentsBetween | null;
  /** Who is minting now. */
  online?: readonly OnlineShare[] | null;
}

/**
 * The link rows `from` read that involve `address`, and the recipient of
 * each level move `address` sent among them: `from` itself, since its own
 * list holds a level move someone else sent only when it got it.
 */
function linkRowsAbout(
  from: CompareSide,
  address: string
): { rows: TxRow[]; recipients: Record<string, string> } {
  const rows: TxRow[] = [];
  const recipients: Record<string, string> = {};
  for (const row of from.linkRows ?? []) {
    if (row.type === 'TRANSFER_PRIVS') {
      if (row.creatorAddress === address) {
        rows.push(row);
        recipients[row.signature] = from.address;
      } else if (
        row.creatorAddress === from.address &&
        from.privs?.[row.signature] === address
      )
        rows.push(row);
    } else if (row.type === 'REWARD_SHARE') {
      if (row.creatorAddress === address || row.recipient === address)
        rows.push(row);
    } else if (row.type === 'BUY_NAME') {
      if (row.creatorAddress === address || row.seller === address)
        rows.push(row);
    }
  }
  return { rows, recipients };
}

/** One way of a trade, told from the other order's side. */
const mirrored = (trade: AssetTrade, owner: string): AssetTrade => ({
  orderId: trade.otherOrderId,
  otherOrderId: trade.orderId,
  other: owner,
  timestamp: trade.timestamp,
  initiated: !trade.initiated,
  gave: trade.got,
  got: trade.gave,
});

const tradeKey = (trade: AssetTrade) =>
  [
    trade.orderId,
    trade.otherOrderId,
    trade.timestamp,
    trade.gave.amount,
    trade.got.amount,
  ].join('|');

/**
 * The Q-Asset trades between x and y, told from x's side: x's own with
 * y, and y's with x turned round, each once (null while neither is read).
 */
export function pairTrades(
  x: Pick<CompareSide, 'address' | 'trades'>,
  y: Pick<CompareSide, 'address' | 'trades'>
): AssetTrade[] | null {
  if (!x.trades && !y.trades) return null;
  const trades = new Map<string, AssetTrade>();
  for (const trade of x.trades ?? [])
    if (trade.other === y.address) trades.set(tradeKey(trade), trade);
  for (const trade of y.trades ?? []) {
    if (trade.other !== x.address) continue;
    const turned = mirrored(trade, y.address);
    const key = tradeKey(turned);
    if (!trades.has(key)) trades.set(key, turned);
  }
  return [...trades.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/** The signatures of the transactions behind a finding. */
const signaturesOf = (finding: Finding) =>
  finding.evidence.map((tx) => tx.signature);

/**
 * What `side` did with `other`, as the Connections tab's findings say it:
 * from both accounts' rows, kept to the two of them, each told only by the
 * account that did it (a payment by its payer, a name sale by the buyer,
 * a reward share minting now by the account that made it).
 */
function sideFindings(
  side: CompareSide,
  other: CompareSide,
  payments: readonly TxRow[] | null,
  trades: readonly AssetTrade[] | null,
  online: readonly OnlineShare[] | null | undefined
): Finding[] {
  const about = linkRowsAbout(other, side.address);
  const links =
    side.linkRows || other.linkRows
      ? linksOf([...(side.linkRows ?? []), ...about.rows], side.address, {
          ...(side.privs ?? {}),
          ...about.recipients,
        })
      : null;
  const sent = payments
    ? flowsOf(payments, side.address, 'sent').filter(
        (flow: Flow) => flow.address === other.address
      )
    : null;
  return recordedFindings({
    address: side.address,
    links,
    mintingWith:
      links && online ? mintingWithNow(links, side.address, online) : null,
    sent,
    received: null,
    levels: other.level === undefined ? {} : { [other.address]: other.level },
    trades,
  }).filter((finding) => {
    if (finding.other !== other.address) return false;
    if (finding.kind === 'mintingWith')
      return finding.sentence.key === 'minting_with.its_share';
    if (finding.kind === 'nameDeal')
      return finding.evidence[0]?.creatorAddress === side.address;
    return true;
  });
}

/**
 * What was recorded between two accounts, each finding told by the one
 * that did it, in the page's order: level moves, reward shares, names,
 * Q-Asset trades, payments.
 */
export function pairFindings(input: PairInput): PairFinding[] {
  const { x, y } = input;
  const anyPayments =
    x.payments !== undefined ||
    y.payments !== undefined ||
    Boolean(input.xy) ||
    Boolean(input.yx);
  const payments = anyPayments
    ? [
        ...(x.payments ?? []),
        ...(y.payments ?? []),
        ...(input.xy?.rows ?? []),
        ...(input.yx?.rows ?? []),
      ]
    : null;
  const fromX = sideFindings(
    x,
    y,
    payments,
    pairTrades(x, y),
    input.online
  ).map((finding) => ({ actor: x.address, other: y.address, finding }));
  const fromY = sideFindings(y, x, payments, null, input.online).map(
    (finding) => ({ actor: y.address, other: x.address, finding })
  );
  // A level move both tell: its sender's ("moved its minting level to"),
  // unless its sender couldn't read where it went.
  const sentMoves = new Set(
    [...fromX, ...fromY]
      .filter(
        ({ finding }) =>
          finding.kind === 'levelMove' &&
          finding.sentence.key === 'transfer_privs.out'
      )
      .flatMap(({ finding }) => signaturesOf(finding))
  );
  const kept = [...fromX, ...fromY].filter(
    ({ finding }) =>
      finding.kind !== 'levelMove' ||
      finding.sentence.key !== 'transfer_privs.in' ||
      !signaturesOf(finding).every((signature) => sentMoves.has(signature))
  );
  return kept.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.finding.kind) - KIND_ORDER.indexOf(b.finding.kind) ||
      (a.finding.firstHeight ?? a.finding.height) -
        (b.finding.firstHeight ?? b.finding.height) ||
      a.finding.timestamp - b.finding.timestamp
  );
}

export interface PortalFinding {
  /** The seller: the sale is told from its side. */
  actor: string;
  /** The buyer, by the address it received the QORT at. */
  other: string;
  key: string;
  sentence: TxSentenceSpec;
  /** The sales, newest first (those Core gave no time last). */
  trades: PortalSale[];
  /** Its newest and its oldest sale with a time; 0 when none has one. */
  timestamp: number;
  firstTimestamp: number;
}

/**
 * Whether a sale's time is one: Core can answer a trade without its time
 * (a pruned node can), kept as 0, and that is no date to show.
 */
export const saleTimeKnown = (timestamp: number): boolean =>
  Number.isFinite(timestamp) && timestamp > 0;

/**
 * What each sold the other on the trade portal: the seller's own sales
 * (read by its public key) whose buyer received the QORT at the other's
 * address, so a buyer that never sent a transaction (no public key) is
 * found too. The QORT added up exactly; its dates only from the sales
 * with a time.
 */
export function portalFindings(
  x: Pick<CompareSide, 'address' | 'portal'>,
  y: Pick<CompareSide, 'address' | 'portal'>
): PortalFinding[] {
  const found: PortalFinding[] = [];
  for (const [seller, buyer] of [
    [x, y],
    [y, x],
  ] as const) {
    const sold = (seller.portal ?? [])
      .filter(
        (trade) =>
          trade.seller === seller.address && trade.buyer === buyer.address
      )
      .sort((a, b) => b.timestamp - a.timestamp);
    if (!sold.length) continue;
    const total = sold.reduce(
      (sum, trade) => sum + (toAtomic(trade.qortAmount) ?? 0n),
      0n
    );
    const times = sold.map((trade) => trade.timestamp).filter(saleTimeKnown);
    const newest = times.reduce((most, time) => Math.max(most, time), 0);
    const oldest = times.reduce((least, time) => Math.min(least, time), newest);
    found.push({
      actor: seller.address,
      other: buyer.address,
      key: `portal:${seller.address}>${buyer.address}`,
      sentence: {
        base: COMPARE_SAY,
        key: 'portal_sold',
        count: sold.length,
        slots: {
          other: { kind: 'account', address: buyer.address },
          amount: {
            kind: 'amount',
            amounts: [
              { amount: fromAtomic(total), asset: { id: 0, name: null } },
            ],
          },
          trades: { kind: 'number', value: sold.length },
        },
      },
      trades: sold,
      timestamp: newest,
      firstTimestamp: oldest,
    });
  }
  return found;
}

/** Whether `findings` hold something for `check`. */
export const foundFor = (
  findings: readonly PairFinding[],
  check: PairCheck
): boolean =>
  findings.some(({ finding }) => CHECK_KINDS[check].includes(finding.kind));

/**
 * What a check can say: what it found; nothing, in all that was read;
 * nothing so far, in what was read of lists that stopped short; still
 * reading; or a read it needs failed (never "nothing").
 */
export type CheckState =
  | 'found'
  | 'none'
  | 'none_so_far'
  | 'reading'
  | 'failed';

export function checkState(
  found: boolean,
  coverages: readonly ReadCoverage[]
): CheckState {
  if (found) return 'found';
  if (coverages.includes('failed')) return 'failed';
  if (coverages.includes('reading')) return 'reading';
  if (coverages.includes('partial')) return 'none_so_far';
  return 'none';
}

// ---- In common ---------------------------------------------------------------------------

/**
 * Its first sponsor (the first account that made it a reward share), or
 * null for none: only from all of its minting transactions (undefined
 * otherwise, as the first one may be among those not read).
 */
export function firstSponsorOf(
  side: Pick<CompareSide, 'address' | 'linkRows' | 'privs' | 'minting'>
): string | null | undefined {
  if (side.minting !== 'complete' || !side.linkRows) return undefined;
  return (
    linksOf(side.linkRows, side.address, side.privs ?? {}).sponsors[0]
      ?.sponsor ?? null
  );
}

export interface SameSponsor {
  sponsor: string;
  /** The compared accounts it sponsored first, by letter. */
  letters: Letter[];
}

/** First sponsors two or more of the accounts share, in the order first met. */
export function sameSponsors(sides: readonly CompareSide[]): SameSponsor[] {
  const by = new Map<string, Letter[]>();
  for (const side of sides) {
    const sponsor = firstSponsorOf(side);
    if (!sponsor) continue;
    by.set(sponsor, [...(by.get(sponsor) ?? []), side.letter]);
  }
  return [...by]
    .filter(([, letters]) => letters.length >= 2)
    .map(([sponsor, letters]) => ({ sponsor, letters }));
}

export interface SameFirstPayer {
  from: string;
  accounts: Array<{
    letter: Letter;
    address: string;
    height: number;
    signature: string;
  }>;
}

/**
 * The accounts whose first QORT payment came from the same account. A
 * first QORT payment is a PAYMENT, as on the Funded page and in the check
 * across a set (isFirstQortPayment): a multi-payment is another first
 * transaction, so the link to the payer's Funded page goes by the same
 * definition.
 */
export function sameFirstPayers(
  sides: readonly CompareSide[]
): SameFirstPayer[] {
  const by = new Map<string, SameFirstPayer['accounts']>();
  for (const side of sides) {
    const funding = side.funding;
    if (!funding?.from || !isFirstQortPayment(funding)) continue;
    by.set(funding.from, [
      ...(by.get(funding.from) ?? []),
      {
        letter: side.letter,
        address: side.address,
        height: funding.height,
        signature: funding.signature,
      },
    ]);
  }
  return [...by]
    .filter(([, accounts]) => accounts.length >= 2)
    .map(([from, accounts]) => ({ from, accounts }));
}

export interface CounterpartyCount {
  letter: Letter;
  address: string;
  /** Payments and transfers it sent the counterparty. */
  sent: number;
  /** Payments and transfers the counterparty sent it. */
  received: number;
}

export type CounterpartyRelation =
  /** One paid the counterparty, which paid another: A → K → B. */
  | { kind: 'through'; from: Letter; to: Letter }
  /** Two or more paid it. */
  | { kind: 'bothPaid'; letters: Letter[] }
  /** It paid two or more. */
  | { kind: 'paidBoth'; letters: Letter[] };

export interface SharedCounterparty {
  address: string;
  /** The compared accounts that paid it or were paid by it, in letter order. */
  counts: CounterpartyCount[];
  relation: CounterpartyRelation;
  /** Ranked by the second-highest count, so a pair's smaller side decides. */
  rank: number;
}

export interface SharedCounterparties {
  rows: SharedCounterparty[];
  /** Shared AT addresses (programs on the chain), left out. */
  atLeftOut: number;
  /** Shared accounts that have sent 1,000+ QORT payments, left out. */
  busyLeftOut: number;
}

function relationOf(
  counts: readonly CounterpartyCount[]
): CounterpartyRelation {
  const payers = counts.filter((count) => count.sent > 0);
  const payees = counts.filter((count) => count.received > 0);
  let best: { from: Letter; to: Letter; size: number } | null = null;
  for (const from of payers)
    for (const to of payees) {
      if (from.address === to.address) continue;
      const size = Math.min(from.sent, to.received);
      if (!best || size > best.size)
        best = { from: from.letter, to: to.letter, size };
    }
  if (best) return { kind: 'through', from: best.from, to: best.to };
  if (payers.length >= 2)
    return { kind: 'bothPaid', letters: payers.map((count) => count.letter) };
  return { kind: 'paidBoth', letters: payees.map((count) => count.letter) };
}

/**
 * Accounts that two or more of the compared accounts paid or were paid by,
 * in the payments each one read: the compared accounts themselves are left
 * out, and so are AT addresses and accounts that have sent 1,000+
 * payments (counted, not listed). Most shared first.
 */
export function sharedCounterparties(
  sides: readonly CompareSide[],
  bands: Readonly<Record<string, PayerBand | null | undefined>> = {}
): SharedCounterparties {
  const compared = new Set(sides.map((side) => side.address));
  const by = new Map<string, Map<string, CounterpartyCount>>();
  const ats = new Map<string, Set<string>>();
  for (const side of sides) {
    if (!side.payments) continue;
    const add = (flow: Flow, way: 'sent' | 'received') => {
      if (compared.has(flow.address)) return;
      if (flow.isAt) {
        ats.set(
          flow.address,
          new Set([...(ats.get(flow.address) ?? []), side.address])
        );
        return;
      }
      const per = by.get(flow.address) ?? new Map<string, CounterpartyCount>();
      const count = per.get(side.address) ?? {
        letter: side.letter,
        address: side.address,
        sent: 0,
        received: 0,
      };
      count[way] += flow.count;
      per.set(side.address, count);
      by.set(flow.address, per);
    };
    for (const flow of flowsOf(side.payments, side.address, 'sent'))
      add(flow, 'sent');
    for (const flow of flowsOf(side.payments, side.address, 'received'))
      add(flow, 'received');
  }
  const rows: SharedCounterparty[] = [];
  let busyLeftOut = 0;
  for (const [address, per] of by) {
    if (per.size < 2) continue;
    if (bands[address] === 1000) {
      busyLeftOut += 1;
      continue;
    }
    const counts = [...per.values()].sort((a, b) =>
      a.letter.localeCompare(b.letter)
    );
    const totals = counts
      .map((count) => count.sent + count.received)
      .sort((a, b) => b - a);
    rows.push({
      address,
      counts,
      relation: relationOf(counts),
      rank: totals[1] ?? 0,
    });
  }
  const total = (row: SharedCounterparty) =>
    row.counts.reduce((sum, count) => sum + count.sent + count.received, 0);
  rows.sort(
    (a, b) =>
      b.rank - a.rank ||
      total(b) - total(a) ||
      a.address.localeCompare(b.address)
  );
  return {
    rows,
    atLeftOut: [...ats.values()].filter((linked) => linked.size >= 2).length,
    busyLeftOut,
  };
}

/**
 * The accounts whose payer band In common reads: every shared first payer
 * and every shared counterparty (before any is left out), so a busy one
 * is left out wherever it ranks.
 */
export function bandAddressesOf(sides: readonly CompareSide[]): string[] {
  const firstPayers = sameFirstPayers(sides).map((same) => same.from);
  const shared = sharedCounterparties(sides).rows.map((row) => row.address);
  return [...new Set([...firstPayers, ...shared])];
}

export interface SharedGroup {
  groupId: number;
  groupName: string;
  memberCount: number | null;
  letters: Letter[];
}

/** Groups two or more of the accounts are in, smallest first (MINTER left out: each account shows it). */
export function sharedGroups(sides: readonly CompareSide[]): SharedGroup[] {
  const by = new Map<number, SharedGroup>();
  for (const side of sides)
    for (const group of side.groups ?? []) {
      if (group.groupId === MINTER_GROUP_ID) continue;
      const entry = by.get(group.groupId) ?? {
        groupId: group.groupId,
        groupName: group.groupName,
        memberCount: group.memberCount,
        letters: [],
      };
      if (entry.memberCount === null && group.memberCount !== null)
        entry.memberCount = group.memberCount;
      if (!entry.letters.includes(side.letter)) entry.letters.push(side.letter);
      by.set(group.groupId, entry);
    }
  const size = (group: SharedGroup) =>
    group.memberCount ?? Number.POSITIVE_INFINITY;
  return [...by.values()]
    .filter((group) => group.letters.length >= 2)
    .map((group) => ({ ...group, letters: [...group.letters].sort() }))
    .sort(
      (a, b) =>
        size(a) - size(b) ||
        a.groupName.localeCompare(b.groupName) ||
        a.groupId - b.groupId
    );
}

// ---- The timeline together ---------------------------------------------------------------

export type TimelineKind = 'funding' | 'name' | 'selfShare' | 'levelMove';

export interface TimelineEvent {
  key: string;
  kind: TimelineKind;
  address: string;
  letter: Letter;
  /** Its block, for a transaction. */
  height: number | null;
  timestamp: number;
  /** What happened, told from the account's side. */
  sentence: TxSentenceSpec;
  /** The transaction behind it, when there is one. */
  signature?: string;
}

export interface TimelineSide {
  address: string;
  letter: Letter;
  funding?: Funding | null;
  linkRows?: readonly TxRow[];
  privs?: Readonly<Record<string, string | null>>;
  /** How far its minting transactions were read: its first self-share only from all of them. */
  minting?: ReadCoverage;
  /** How far its name transactions were read: a name it registered only from all of them. */
  names?: ReadCoverage;
  /** Its primary name, and when that name was registered (its record keeps it through sales). */
  primary?: { name: string; registered?: number } | null;
  /** When it was first seen. */
  firstSeen?: number | null;
}

const heightOf = (tx: TxRow) =>
  typeof tx.blockHeight === 'number' ? tx.blockHeight : null;

/**
 * How it got its primary name, from its own transactions: the name it
 * bought (its newest purchase of it), else, once all of its name
 * transactions were read and none bought it, the name's registration. The
 * record keeps the first registration through every sale, so that date is
 * never credited to an account that may have bought the name, nor used
 * when it is older than the account.
 */
function nameEvent(
  side: TimelineSide
): Omit<TimelineEvent, 'address' | 'letter'> | null {
  const primary = side.primary;
  if (!primary) return null;
  const bought = (side.linkRows ?? [])
    .filter(
      (row) =>
        row.type === 'BUY_NAME' &&
        row.creatorAddress === side.address &&
        row.name === primary.name &&
        typeof row.blockHeight === 'number'
    )
    .sort((a, b) => (b.blockHeight ?? 0) - (a.blockHeight ?? 0))[0];
  if (bought)
    return {
      key: `${side.address}:name`,
      kind: 'name',
      height: heightOf(bought),
      timestamp: bought.timestamp,
      sentence: describeTx(bought, { viewpoint: side.address }).sentence,
      signature: bought.signature,
    };
  const { registered } = primary;
  if (
    side.names !== 'complete' ||
    typeof registered !== 'number' ||
    side.firstSeen === undefined ||
    (side.firstSeen !== null && registered < side.firstSeen)
  )
    return null;
  return {
    key: `${side.address}:name`,
    kind: 'name',
    height: null,
    timestamp: registered,
    sentence: {
      base: COMPARE_SAY,
      key: 'registered_name',
      slots: { name: { kind: 'name', name: primary.name } },
    },
  };
}

/** Its first self-share (a reward share to itself), from all of its minting transactions. */
export function firstSelfShare(side: TimelineSide): TxRow | null {
  if (side.minting !== 'complete') return null;
  return (
    (side.linkRows ?? [])
      .filter(
        (row) =>
          row.type === 'REWARD_SHARE' &&
          row.creatorAddress === side.address &&
          row.recipient === side.address &&
          !isRemoval(row) &&
          typeof row.blockHeight === 'number'
      )
      .sort(
        (a, b) =>
          (a.blockHeight ?? 0) - (b.blockHeight ?? 0) ||
          a.timestamp - b.timestamp
      )[0] ?? null
  );
}

/** Every first the accounts' reads show, oldest first; each transaction once. */
export function timelineEvents(
  sides: readonly TimelineSide[]
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const side of sides) {
    const base = { address: side.address, letter: side.letter };
    const seen = new Set<string>();
    const funding = side.funding;
    if (funding) {
      seen.add(funding.signature);
      events.push({
        ...base,
        key: `${side.address}:funding`,
        kind: 'funding',
        height: funding.height,
        timestamp: funding.timestamp,
        sentence: fundingSentence(funding),
        signature: funding.signature,
      });
    }
    // Its name (bought or registered) and its self-share are never where its
    // first QORT came from (that is something it received); a level move it
    // got can be: then it is told once, as that.
    const name = nameEvent(side);
    if (name) events.push({ ...base, ...name });
    const self = firstSelfShare(side);
    if (self)
      events.push({
        ...base,
        key: `${side.address}:self`,
        kind: 'selfShare',
        height: heightOf(self),
        timestamp: self.timestamp,
        sentence: describeTx(self, { viewpoint: side.address }).sentence,
        signature: self.signature,
      });
    if (side.linkRows)
      for (const move of linksOf(side.linkRows, side.address, side.privs ?? {})
        .levelMoves) {
        if (seen.has(move.tx.signature)) continue;
        seen.add(move.tx.signature);
        events.push({
          ...base,
          key: `${side.address}:level:${move.tx.signature}`,
          kind: 'levelMove',
          height: move.ref.height,
          timestamp: move.ref.timestamp,
          sentence: describeTx(move.tx, {
            viewpoint: side.address,
            privsRecipient: move.direction === 'to' ? move.other : undefined,
          }).sentence,
          signature: move.tx.signature,
        });
      }
  }
  return events.sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      (a.height ?? 0) - (b.height ?? 0) ||
      a.letter.localeCompare(b.letter)
  );
}

/**
 * How far apart two lines of the timeline are: in the same block, a number
 * of blocks, or a time. The list is in the order the transactions were
 * signed, and one signed later can be in an earlier block: then the gap is
 * a time, never a negative count of blocks.
 */
export type TimelineGap =
  | { kind: 'same_block' }
  | { kind: 'blocks'; blocks: number }
  | { kind: 'moments' }
  | { kind: 'time'; ms: number };

export function timelineGap(
  previous: Pick<TimelineEvent, 'height' | 'timestamp'>,
  next: Pick<TimelineEvent, 'height' | 'timestamp'>
): TimelineGap {
  if (previous.height !== null && next.height !== null) {
    const blocks = next.height - previous.height;
    if (blocks === 0) return { kind: 'same_block' };
    if (blocks > 0) return { kind: 'blocks', blocks };
  }
  const ms = next.timestamp - previous.timestamp;
  return ms < 60_000 ? { kind: 'moments' } : { kind: 'time', ms };
}

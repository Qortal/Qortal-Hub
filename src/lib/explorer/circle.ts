/**
 * The Connections circle (from Q-Mintership+'s rules/explorer/circle.ts):
 * what Connections recorded between an account and others, drawn around
 * it. Pure: no reads, no text (ConnectionsCircle draws it and puts it into
 * words).
 *
 * - The account in the middle; the accounts that sent it payments and
 *   transfers on the left, those it sent them to on the right. An account
 *   paid both ways is one node at the bottom, between the two sides, its
 *   ring green and red in proportion to what came in and went out. A Q-Asset
 *   trade moves both ways: its partner is drawn as paid both ways.
 * - A node counts the transactions behind it once each, as its dialog
 *   lists them: a transaction behind two of its links (a reward share that
 *   is both its sponsor's and the one it mints with now) is one, and a
 *   trade counts its orders, not one each way.
 * - Its other links (reward shares, minting level, names) aren't transfers:
 *   they are a row of their own under the circle (`other`). A link with no
 *   one other account (the accounts it sponsored, a level move whose
 *   recipient couldn't be read) can't be a node: it is listed apart
 *   (`unplaced`), never dropped.
 * - Each side is one arc of an ellipse, from the top down, the most
 *   transactions (or the most QORT) first, every node at its own angle: a
 *   line runs straight from the middle to each node, so no two lines cross
 *   and none passes under another node. The nodes of a side are evenly
 *   spaced in height. At most 10 a side (8 when narrow, 6 on a phone), the
 *   rest counted.
 * - A window bigger than an ordinary Explorer window (full screen) gets a
 *   bigger drawing (`fitCircle`) with every account it may draw (up to
 *   BIG_SIDE_MAX a side and BIG_BOTH_MAX at the bottom), more room for the
 *   names, and as wide as the window: all of it in the height the window
 *   shows where it fits there, else taller, the window scrolling.
 * - A node's size grows with the square root of its count (its area with
 *   the count), or of its QORT, within limits that shrink as a side fills.
 * - The order is stable: the same data gives the same order and places,
 *   ties broken by the address.
 * - How tall the drawing must be (`circleHeight`) is worked out from its
 *   width, so that no two avatars, no two names beside them, no name and
 *   another node, and nothing and the middle overlap (`circleOverlaps`
 *   checks it). In a narrow drawing the names aren't beside the avatars:
 *   each node's button says it.
 */
import type { Finding } from './findings';
import { newestFirst, type AssetSum } from './money';
import type { TxRow } from './reads';

export type CircleSide = 'in' | 'out' | 'both' | 'other';

/** What puts an account first and draws it biggest: its transactions, or the QORT that moved. */
export type CircleOrder = 'count' | 'qort';

export const CIRCLE_ORDERS = ['count', 'qort'] as const;

export const isCircleOrder = (value: unknown): value is CircleOrder =>
  CIRCLE_ORDERS.includes(value as CircleOrder);

/** What moved one way: QORT and Q-Assets, atomic. */
export interface Moved {
  qort: bigint;
  assets: AssetSum[];
}

/** One way's payments and transfers, of a node paid both ways: its transactions, once each, and what they moved. */
export interface WayPart extends Moved {
  count: number;
}

/**
 * A node's Q-Asset trades: their orders, once each, as its dialog lists
 * them, and what it got and what it gave in them. A trade moves both ways,
 * so its partner is always drawn as paid both ways.
 */
export interface TradePart {
  orders: number;
  got: Moved;
  gave: Moved;
}

export interface CircleNode {
  /** `in:Q…`, `out:Q…`, `both:Q…`, `other:Q…`: one per account and side. */
  key: string;
  address: string;
  side: CircleSide;
  /**
   * The transactions behind it, once each, as its dialog lists them: its
   * payments and transfers (or its other links' transactions) and its
   * trades' orders. A transaction behind two of its links counts once; a
   * link with none listed counts 1.
   */
  count: number;
  /** The findings behind it, in the page's order. */
  findings: Finding[];
  /** QORT moved, in atomic units: payments, transfers and trades, both ways. */
  qort: bigint;
  /** Q-Assets moved, atomic, in the order first seen. */
  assets: AssetSum[];
  /** Paid both ways: each way's payments and transfers. */
  split?: { in: WayPart; out: WayPart };
  /** Its Q-Asset trades (a node paid both ways). */
  trade?: TradePart;
}

export interface CircleGroups {
  in: CircleNode[];
  out: CircleNode[];
  /** Accounts paid both ways: one node each, at the bottom. */
  both: CircleNode[];
  other: CircleNode[];
  /** Links with no one other account: listed apart. */
  unplaced: Finding[];
}

export interface PlacedNode extends CircleNode {
  /** Where its centre is, in % of the drawing's box from its top left. */
  x: number;
  y: number;
  /** Its avatar's size, px. */
  size: number;
}

export interface CircleLayout {
  placed: PlacedNode[];
  /** How many more there are on each side than are drawn. */
  rest: { in: number; out: number; both: number };
}

export interface LayoutOptions {
  /** The ellipse's half width and half height, in % of the box's width and height. */
  rx: number;
  ry: number;
  /** Nodes on a side at most. */
  sideMax: number;
  /** Nodes paid both ways at the bottom at most. */
  bothMax: number;
  /** Avatar sizes: the smallest, and the biggest when a side holds few. */
  minSize: number;
  maxSize: number;
  /** Steps between the bottom avatars' centres: more where their names sit under them. */
  bothSpacing: number;
  /** The avatar in the middle (px), and the widest its name under it is. */
  centerSize: number;
  centerLabel: number;
  /** Names beside the avatars (and under the bottom ones). */
  named: boolean;
  /** The widest a name under a bottom avatar is (px). */
  bottomNameMax: number;
}

/** The widest a name under a bottom avatar is in an ordinary drawing (px). */
export const BOTTOM_NAME_MAX = 124;

/** A wide drawing: room beside each side for the names. */
export const WIDE_LAYOUT: LayoutOptions = {
  rx: 30,
  ry: 41,
  sideMax: 10,
  bothMax: 4,
  minSize: 28,
  maxSize: 56,
  bothSpacing: 2.5,
  centerSize: 68,
  centerLabel: 150,
  named: true,
  bottomNameMax: BOTTOM_NAME_MAX,
};
/**
 * A drawing in a window bigger than an ordinary Explorer window: the wide
 * one, its middle's name and the names under the bottom avatars given more
 * room (a bottom avatar's amounts on one line where they fit). How many
 * avatars a side and at the bottom is worked out for the room (fitCircle).
 */
export const BIG_LAYOUT: LayoutOptions = {
  ...WIDE_LAYOUT,
  centerLabel: 240,
  bottomNameMax: 220,
};
/** The most avatars a side and at the bottom of a big drawing, however much room it has. */
export const BIG_SIDE_MAX = 16;
export const BIG_BOTH_MAX = 8;
/** A narrow drawing: no names beside the avatars. */
export const NARROW_LAYOUT: LayoutOptions = {
  rx: 40,
  ry: 41,
  sideMax: 8,
  bothMax: 3,
  minSize: 24,
  maxSize: 44,
  bothSpacing: 2,
  centerSize: 52,
  centerLabel: 110,
  named: false,
  bottomNameMax: BOTTOM_NAME_MAX,
};
/** A very narrow drawing (a phone): fewer and smaller avatars, one at the bottom. */
export const TINY_LAYOUT: LayoutOptions = {
  rx: 42,
  ry: 42,
  sideMax: 6,
  bothMax: 1,
  minSize: 24,
  maxSize: 34,
  bothSpacing: 2,
  centerSize: 44,
  centerLabel: 96,
  named: false,
  bottomNameMax: BOTTOM_NAME_MAX,
};

/** From this width (px) the names fit beside the avatars. */
export const WIDE_MIN = 600;
/** Below this width (px), the very narrow drawing. */
export const NARROW_MIN = 340;

export const layoutFor = (width: number): LayoutOptions =>
  width >= WIDE_MIN
    ? WIDE_LAYOUT
    : width >= NARROW_MIN
      ? NARROW_LAYOUT
      : TINY_LAYOUT;

/** The widest the bottom avatars spread, between centres, in degrees. */
const BOTH_STEP_MAX = 36;

const SIDE_OF: Readonly<Record<Finding['kind'], CircleSide>> = {
  paidBy: 'in',
  paidTo: 'out',
  levelMove: 'other',
  sponsor: 'other',
  mintingWith: 'other',
  sponsees: 'other',
  nameDeal: 'other',
  // A trade moves both ways: its partner is drawn as paid both ways (circleNodes).
  traded: 'both',
};

/** What a node weighs in `order`: its transactions, or its QORT (whole QORT). */
export function nodeWeight(
  node: Pick<CircleNode, 'count' | 'qort'>,
  order: CircleOrder
): number {
  return order === 'qort' ? Number(node.qort) / 1e8 : node.count;
}

/** The most first in `order`, then the most of the other; ties by address. */
function byOrder(order: CircleOrder) {
  const byQort = (a: CircleNode, b: CircleNode) =>
    a.qort === b.qort ? 0 : a.qort > b.qort ? -1 : 1;
  const byCount = (a: CircleNode, b: CircleNode) => b.count - a.count;
  const byAddress = (a: CircleNode, b: CircleNode) =>
    a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
  return (a: CircleNode, b: CircleNode) =>
    (order === 'qort'
      ? byQort(a, b) || byCount(a, b)
      : byCount(a, b) || byQort(a, b)) || byAddress(a, b);
}

const sameAsset = (a: AssetSum['asset'], b: AssetSum['asset']) =>
  a.id === b.id && (a.id !== null || a.name === b.name);

/** `a` and `b` added up, by asset, in the order first seen. */
export function addAssets(
  a: readonly AssetSum[],
  b: readonly AssetSum[]
): AssetSum[] {
  const out = a.map((sum) => ({ ...sum }));
  for (const sum of b) {
    const same = out.find((each) => sameAsset(each.asset, sum.asset));
    if (same) same.atomic += sum.atomic;
    else out.push({ ...sum });
  }
  return out;
}

/**
 * How many transactions are behind `findings`, as a dialog lists them: their
 * transactions and their trades' orders, once each by signature (a reward
 * share that is both its sponsor's and the one it mints with now is one
 * transaction); a link with none listed counts 1.
 */
function countOnce(findings: readonly Finding[]): number {
  const seen = new Set<string>();
  let bare = 0;
  for (const finding of findings) {
    const signatures = [
      ...finding.evidence.map((tx) => tx.signature),
      ...(finding.evidenceSignatures ?? []),
    ];
    if (!signatures.length) bare += 1;
    for (const signature of signatures) seen.add(signature);
  }
  return seen.size + bare;
}

const nothingMoved = (): Moved => ({ qort: 0n, assets: [] });

const addMoved = (a: Moved, b: Moved): Moved => ({
  qort: a.qort + b.qort,
  assets: addAssets(a.assets, b.assets),
});

/** What the payments and transfers among `findings` moved. */
const movedOf = (findings: readonly Finding[]): Moved =>
  findings.reduce<Moved>(
    (sum, finding) =>
      addMoved(sum, { qort: finding.qort ?? 0n, assets: finding.assets ?? [] }),
    nothingMoved()
  );

/** The trades among `findings`, together; undefined for none. */
function tradeOf(findings: readonly Finding[]): TradePart | undefined {
  const traded = findings.filter((finding) => finding.kind === 'traded');
  if (!traded.length) return undefined;
  return {
    orders: new Set(
      traded.flatMap((finding) => finding.evidenceSignatures ?? [])
    ).size,
    got: traded.reduce<Moved>(
      (sum, finding) => addMoved(sum, finding.trade?.got ?? nothingMoved()),
      nothingMoved()
    ),
    gave: traded.reduce<Moved>(
      (sum, finding) => addMoved(sum, finding.trade?.gave ?? nothingMoved()),
      nothingMoved()
    ),
  };
}

/** The other accounts on each side, the most transactions (or QORT) first. */
export function circleNodes(
  findings: readonly Finding[],
  order: CircleOrder = 'count'
): CircleGroups {
  const unplaced: Finding[] = [];
  // Each account's payments, transfers and trades, and its other links, in the page's order.
  const byAccount = new Map<string, { moved: Finding[]; other: Finding[] }>();
  for (const finding of findings) {
    if (!finding.other) {
      unplaced.push(finding);
      continue;
    }
    const entry = byAccount.get(finding.other) ?? { moved: [], other: [] };
    byAccount.set(finding.other, entry);
    if (SIDE_OF[finding.kind] === 'other') entry.other.push(finding);
    else entry.moved.push(finding);
  }
  const nodes: CircleNode[] = [];
  for (const [address, entry] of byAccount) {
    if (entry.other.length)
      nodes.push({
        key: `other:${address}`,
        address,
        side: 'other',
        count: countOnce(entry.other),
        findings: entry.other,
        ...movedOf(entry.other),
      });
    if (!entry.moved.length) continue;
    const way = (side: 'in' | 'out') =>
      entry.moved.filter((finding) => SIDE_OF[finding.kind] === side);
    const received = way('in');
    const sent = way('out');
    const trade = tradeOf(entry.moved);
    // A trade moves both ways: what it got came in, what it gave went out.
    const side: CircleSide =
      trade || (received.length && sent.length)
        ? 'both'
        : received.length
          ? 'in'
          : 'out';
    const total = [
      movedOf(entry.moved),
      trade?.got ?? nothingMoved(),
      trade?.gave ?? nothingMoved(),
    ].reduce(addMoved);
    nodes.push({
      key: `${side}:${address}`,
      address,
      side,
      count: countOnce(entry.moved),
      findings: entry.moved,
      ...total,
      ...(side === 'both'
        ? {
            split: {
              in: { count: countOnce(received), ...movedOf(received) },
              out: { count: countOnce(sent), ...movedOf(sent) },
            },
          }
        : {}),
      ...(trade ? { trade } : {}),
    });
  }
  const sorted = nodes.sort(byOrder(order));
  return {
    in: sorted.filter((node) => node.side === 'in'),
    out: sorted.filter((node) => node.side === 'out'),
    both: sorted.filter((node) => node.side === 'both'),
    other: sorted.filter((node) => node.side === 'other'),
    unplaced,
  };
}

/**
 * What came in and what went out, of a node paid both ways: its payments
 * and transfers each way, and what its trades got and gave.
 */
export function bothWays(
  node: Pick<CircleNode, 'split' | 'trade'>
): { in: Moved; out: Moved } | null {
  if (!node.split) return null;
  return {
    in: addMoved(node.split.in, node.trade?.got ?? nothingMoved()),
    out: addMoved(node.split.out, node.trade?.gave ?? nothingMoved()),
  };
}

/** The transactions behind a node, once each, the newest first. */
export function nodeTransactions(node: Pick<CircleNode, 'findings'>): TxRow[] {
  const seen = new Map<string, TxRow>();
  for (const finding of node.findings)
    for (const tx of finding.evidence)
      if (!seen.has(tx.signature)) seen.set(tx.signature, tx);
  return [...seen.values()].sort(newestFirst);
}

/** The orders behind a node's Q-Asset trades (read when its list opens), once each. */
export function nodeOrders(node: Pick<CircleNode, 'findings'>): string[] {
  return [...new Set(node.findings.flatMap((f) => f.evidenceSignatures ?? []))];
}

/** The biggest avatar a side of `n` nodes leaves room for. */
export function sideMaxSize(n: number, options: LayoutOptions): number {
  const room =
    options.maxSize -
    Math.max(0, n - 4) * ((options.maxSize - options.minSize) / 10);
  return Math.round(
    Math.max(options.minSize + 4, Math.min(options.maxSize, room))
  );
}

/** An avatar's size, from its count and the biggest count drawn. */
export function nodeSize(
  count: number,
  maxCount: number,
  min: number,
  max: number
): number {
  if (maxCount <= 1) return Math.round((min + max) / 2);
  const share = Math.sqrt((Math.max(1, count) - 1) / (maxCount - 1));
  return Math.round(min + share * (max - min));
}

/** An avatar's size by QORT, from the smallest for none: its area grows with the QORT. */
export function qortSize(
  qort: number,
  maxQort: number,
  min: number,
  max: number
): number {
  if (maxQort <= 0) return Math.round((min + max) / 2);
  const share = Math.sqrt(Math.max(0, qort) / maxQort);
  return Math.round(min + share * (max - min));
}

const format = (
  language: string,
  options: Intl.NumberFormatOptions,
  value: number
): string => {
  try {
    return new Intl.NumberFormat(language, options).format(value);
  } catch {
    return new Intl.NumberFormat('en', options).format(value);
  }
};

/**
 * What the number on an avatar's corner says, in `language`: its
 * transactions (from 2; "999+" past 999), or, by QORT, the QORT that moved,
 * short ("<1", "13", "1.5", "1.2K"). Null for no number.
 */
export function badgeText(
  node: Pick<CircleNode, 'count' | 'qort'>,
  order: CircleOrder,
  language: string
): string | null {
  if (order === 'count')
    return node.count > 1
      ? node.count > 999
        ? `${format(language, {}, 999)}+`
        : format(language, {}, node.count)
      : null;
  if (node.qort <= 0n) return null;
  const qort = Number(node.qort) / 1e8;
  return qort < 1
    ? `<${format(language, {}, 1)}`
    : format(language, { notation: 'compact' }, qort);
}

/**
 * An amount, short, for beside a name: whole from 100 up, two decimals
 * below, four under 1 ("1,235", "76.5", "0.25"), in `language`. Null for
 * none.
 */
export function shortAmount(atomic: bigint, language: string): string | null {
  if (atomic <= 0n) return null;
  const value = Number(atomic) / 1e8;
  const digits = value >= 100 ? 0 : value >= 1 ? 2 : 4;
  return format(language, { maximumFractionDigits: digits }, value);
}

/**
 * Every node on one ring, evenly spaced and mirrored: the sides share one
 * step, the right side from just under the top down, the left one its
 * mirror image, the fewer of the two centred on its side; the accounts paid
 * both ways centred at the bottom; two steps' gap at the top and between
 * the groups.
 */
export function circleLayout(
  groups: Pick<CircleGroups, 'in' | 'out' | 'both'>,
  options: LayoutOptions = WIDE_LAYOUT,
  /** As `groups` were ordered (circleNodes): what sizes the avatars. */
  order: CircleOrder = 'count'
): CircleLayout {
  const sides = {
    in: groups.in.slice(0, options.sideMax),
    out: groups.out.slice(0, options.sideMax),
    both: groups.both.slice(0, options.bothMax),
  };
  const weight = (node: CircleNode) => nodeWeight(node, order);
  const maxWeight = Math.max(
    order === 'qort' ? 0 : 1,
    ...sides.in.map(weight),
    ...sides.out.map(weight),
    ...sides.both.map(weight)
  );
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const at = (angle: number) => ({
    x: 50 + options.rx * Math.cos(angle),
    y: 50 + options.ry * Math.sin(angle),
  });
  const most = Math.max(sides.in.length, sides.out.length);
  const nBoth = sides.both.length;
  const k = options.bothSpacing;
  // One step for every gap: the sides' last slots two steps from the bottom group (or each other).
  const step = nBoth
    ? Math.PI / (most + 2 + (k * (nBoth - 1)) / 2)
    : Math.PI / (most + 1);
  // As big as half the ring holds.
  const max = sideMaxSize(most + Math.ceil((k * nBoth) / 2), options);
  const sizeOf = (node: CircleNode) =>
    order === 'qort'
      ? qortSize(weight(node), maxWeight, options.minSize, max)
      : nodeSize(node.count, maxWeight, options.minSize, max);
  const place = (
    list: readonly CircleNode[],
    side: 'in' | 'out'
  ): PlacedNode[] => {
    // The fewer side centred on the slots the fuller one fills.
    const offset = (most - list.length) / 2;
    // The fuller side's first and last slots, by angle; the slots between
    // them evenly spaced in height (sin of the angle), each on the ellipse.
    const top = Math.sin(-Math.PI / 2 + step);
    const last = Math.sin(-Math.PI / 2 + step * most);
    return list.map((node, i) => {
      // From the top down; one node alone sits level with the middle.
      const slot = i + offset;
      const sin = most === 1 ? top : top + ((last - top) * slot) / (most - 1);
      const point = at(Math.asin(Math.max(-1, Math.min(1, sin))));
      return {
        ...node,
        x: side === 'out' ? point.x : 100 - point.x,
        y: point.y,
        size: sizeOf(node),
      };
    });
  };
  // Paid both ways: centred at the bottom, the most transactions (or QORT) in the middle.
  const middleOut = [...sides.both].sort(
    (a, b) => weight(b) - weight(a) || (a.address < b.address ? -1 : 1)
  );
  const leftToRight: CircleNode[] = [];
  middleOut.forEach((node, i) =>
    i % 2 ? leftToRight.unshift(node) : leftToRight.push(node)
  );
  const bothStep = Math.min(k * step, rad(BOTH_STEP_MAX));
  const bottom = leftToRight.map((node, i) => ({
    ...node,
    // From the left (the larger angle) to the right.
    ...at(Math.PI / 2 + bothStep * ((nBoth - 1) / 2 - i)),
    size: sizeOf(node),
  }));
  return {
    placed: [...place(sides.in, 'in'), ...place(sides.out, 'out'), ...bottom],
    rest: {
      in: Math.max(0, groups.in.length - sides.in.length),
      out: Math.max(0, groups.out.length - sides.out.length),
      both: Math.max(0, groups.both.length - sides.both.length),
    },
  };
}

/**
 * What share of a node paid both ways came in (0 to 1): by QORT when QORT
 * went either way, else by transactions. 1 for received only, 0 for sent.
 */
export function receivedShare(
  node: Pick<CircleNode, 'side' | 'split' | 'trade'>
): number {
  if (node.side === 'in') return 1;
  const ways = node.side === 'both' ? bothWays(node) : null;
  if (!ways || !node.split) return 0;
  const qort = ways.in.qort + ways.out.qort;
  if (qort > 0n) return Number((ways.in.qort * 10_000n) / qort) / 10_000;
  const count = node.split.in.count + node.split.out.count;
  return count ? node.split.in.count / count : 0.5;
}

// ---- How big the drawing is, so nothing in it overlaps --------------------------------------

/** The ring and the gap inside it around an avatar (px each side). */
export const RING = 5;
/** Each avatar is a button at least this big (px). */
export const TARGET = 44;
/** The least room between two avatars' edges (px). */
export const AVATAR_GAP = 4;
/** A name beside an avatar, one line (px). */
export const LABEL_HEIGHT = 20;
/** Between an avatar and the name beside it (px). */
export const LABEL_MARGIN = 8;
/** Between the middle's avatar and its name, and that name's height (px). */
const CENTER_GAP = 4;

/** How far a node reaches from its centre (px): its button, or its ring when bigger. */
export const nodeRadius = (size: number): number =>
  Math.max(TARGET, size + 2 * RING) / 2;

/** The middle's avatar, with its padding and its 3 px ring. */
const centerRadius = (options: LayoutOptions) => options.centerSize / 2 + 7;

/** How many slots the fuller half of the ring holds. */
function fullness(layout: CircleLayout, options: LayoutOptions): number {
  const count = (side: CircleSide) =>
    layout.placed.filter((node) => node.side === side).length;
  return (
    Math.max(count('in'), count('out')) +
    Math.ceil((options.bothSpacing * count('both')) / 2)
  );
}

/** Width over height before anything is made room for: a few accounts leave no empty space. */
export function circleAspect(
  layout: CircleLayout,
  options: LayoutOptions
): number {
  const fullest = fullness(layout, options);
  if (options.named) return fullest <= 3 ? 2 : fullest <= 6 ? 16 / 10 : 4 / 3;
  return fullest <= 3 ? 1 : fullest <= 5 ? 5 / 6 : 3 / 4;
}

/**
 * Whether the name beside `a` (it runs outwards, to the edge) passes where
 * `b`'s avatar is, left to right: `b` reaches further out than `a`'s avatar.
 */
function reachesInto(a: PlacedNode, b: PlacedNode, width: number): boolean {
  const ax = (a.x / 100) * width;
  const bx = (b.x / 100) * width;
  const ra = nodeRadius(a.size);
  const rb = nodeRadius(b.size);
  return a.side === 'out'
    ? bx + rb > ax + ra + LABEL_MARGIN
    : bx - rb < ax - ra - LABEL_MARGIN;
}

const besideNames = (node: PlacedNode) =>
  node.side === 'in' || node.side === 'out';

/**
 * How tall (px) the drawing must be at `width` px wide: at least its
 * aspect's height, and enough that
 *
 * - no two avatars come closer than AVATAR_GAP, nor one and the middle;
 * - with names beside them, no name passes under another node of its side
 *   or a bottom one (two names of a side never share a line: their
 *   avatars keep them apart);
 * - nothing covers the middle's name.
 *
 * Every rule only asks for more height (the places are % of it), so the
 * tallest any of them asks for meets all of them.
 */
export function circleHeight(
  layout: CircleLayout,
  options: LayoutOptions,
  width: number
): number {
  const { placed } = layout;
  let height = width / circleAspect(layout, options);
  const raise = (needed: number) => {
    if (Number.isFinite(needed) && needed > height) height = needed;
  };
  const px = (x: number) => (x / 100) * width;
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i];
    const ra = nodeRadius(a.size);
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j];
      const rb = nodeRadius(b.size);
      const dy = Math.abs(a.y - b.y) / 100;
      if (dy <= 0) continue;
      const dx = Math.abs(px(a.x) - px(b.x));
      const apart = ra + rb + AVATAR_GAP;
      if (dx < apart) raise(Math.sqrt(apart * apart - dx * dx) / dy);
      // Two names of a side never share a line: the avatars beside them,
      // at least TARGET tall, keep them further apart than a line.
      if (options.named && a.side === b.side && besideNames(a)) {
        if (reachesInto(a, b, width)) raise((LABEL_HEIGHT / 2 + rb) / dy);
        if (reachesInto(b, a, width)) raise((LABEL_HEIGHT / 2 + ra) / dy);
      }
      // A side's name running outwards, and a bottom avatar in its way.
      if (options.named && besideNames(a) !== besideNames(b)) {
        const side = besideNames(a) ? a : b;
        const low = side === a ? b : a;
        const below = (low.y - side.y) / 100;
        if (below > 0 && reachesInto(side, low, width))
          raise((LABEL_HEIGHT / 2 + nodeRadius(low.size) + AVATAR_GAP) / below);
      }
    }
    // The middle's avatar, and its name under it.
    const dy = Math.abs(a.y - 50) / 100;
    if (dy <= 0) continue;
    const dx = Math.abs(px(a.x) - width / 2);
    const apart = centerRadius(options) + ra + AVATAR_GAP;
    if (dx < apart) raise(Math.sqrt(apart * apart - dx * dx) / dy);
    if (a.y > 50 && dx < options.centerLabel / 2 + ra)
      raise(
        (centerRadius(options) + CENTER_GAP + LABEL_HEIGHT + ra + AVATAR_GAP) /
          dy
      );
  }
  return Math.ceil(height);
}

/** How tall the name under a bottom avatar is, with its amounts taking `rows` rows (px). */
export const bottomNameHeight = (rows: number): number =>
  20 + 15 * Math.max(1, rows);

/**
 * A bottom avatar's amounts are counted in rows as if its name were this
 * much narrower than it is drawn (px): a line that only just fits is taken
 * as wrapping, so the room made under it is never short.
 */
export const BOTTOM_ROW_MARGIN = 1;

/** How many rows a bottom avatar's amounts take in a name `room` px wide. */
export type AmountRows = (node: PlacedNode, room: number) => number;

/**
 * How wide the name under the bottom avatar `node` may be (whole px), in a
 * drawing `width` by `height`: clear of every other bottom avatar and its
 * name at the height of this name (names hang down); `max` (the layout's
 * `bottomNameMax`) when nothing is in the way. `rowsOf` gives each node's
 * rows of amounts as they stand.
 */
export function bottomNameRoom(
  node: PlacedNode,
  bottom: readonly PlacedNode[],
  width: number,
  height: number,
  rowsOf: (node: PlacedNode) => number,
  max: number = BOTTOM_NAME_MAX
): number {
  const at = (p: PlacedNode) => ({
    x: (p.x / 100) * width,
    y: (p.y / 100) * height,
  });
  const me = at(node);
  const top = me.y + nodeRadius(node.size);
  const band = [top, top + bottomNameHeight(rowsOf(node))];
  let room = max;
  for (const other of bottom) {
    if (other === node) continue;
    const there = at(other);
    const reach = nodeRadius(other.size);
    const dx = Math.abs(there.x - me.x);
    const meets = (y0: number, y1: number) => y0 < band[1] && y1 > band[0];
    // Its name beside this one: they share the gap.
    if (
      meets(there.y + reach, there.y + reach + bottomNameHeight(rowsOf(other)))
    )
      room = Math.min(room, dx - 6);
    // Its avatar: this name reaches up to its edge.
    if (meets(there.y - reach, there.y + reach))
      room = Math.min(room, 2 * (dx - reach) - 6);
  }
  // In whole px, as it is drawn.
  return Math.max(48, Math.floor(room));
}

/**
 * Each bottom avatar's name, as drawn: how wide it may be (whole px, as the
 * page draws it) and how many rows its amounts take there (`rows`: a line
 * wider than its room wraps; counted BOTTOM_ROW_MARGIN px narrower). A
 * name that takes more rows reaches lower, which can narrow its
 * neighbours' room and wrap theirs: worked out until nothing changes.
 */
export function bottomNames(
  bottom: readonly PlacedNode[],
  width: number,
  height: number,
  rows: AmountRows,
  max: number = BOTTOM_NAME_MAX
): Map<string, { room: number; rows: number }> {
  const out = new Map<string, { room: number; rows: number }>();
  // Its rows where it is drawn `room` px wide, with a margin.
  const rowsAt = (node: PlacedNode, room: number) =>
    Math.max(1, rows(node, room - BOTTOM_ROW_MARGIN));
  for (const node of bottom)
    out.set(node.key, { room: max, rows: rowsAt(node, max) });
  for (let round = 0; round < 8; round++) {
    let changed = false;
    const rowsOf = (node: PlacedNode) => out.get(node.key)?.rows ?? 1;
    const next = bottom.map((node) => {
      const room = bottomNameRoom(node, bottom, width, height, rowsOf, max);
      // Rooms only shrink and rows only grow, so this settles.
      const was = out.get(node.key);
      const shown = Math.min(room, was?.room ?? room);
      return {
        node,
        room: shown,
        rows: Math.max(was?.rows ?? 1, rowsAt(node, shown)),
      };
    });
    for (const { node, room, rows: taken } of next) {
      const was = out.get(node.key);
      if (was?.room !== room || was?.rows !== taken) changed = true;
      out.set(node.key, { room, rows: taken });
    }
    if (!changed) break;
  }
  return out;
}

/**
 * What overlaps in a drawing `width` by `height` (px), as words for a
 * test's message; none when everything has its room. The names beside the
 * avatars are taken as long as their room (to the drawing's edge), and the
 * names under the bottom ones as wide and as tall as `bottomNames` makes
 * them (`rows`: their amounts' rows at that width).
 */
export function circleOverlaps(
  layout: CircleLayout,
  options: LayoutOptions,
  width: number,
  height: number,
  rows: AmountRows = () => 1
): string[] {
  const out: string[] = [];
  const { placed } = layout;
  const at = (p: { x: number; y: number }) => ({
    x: (p.x / 100) * width,
    y: (p.y / 100) * height,
  });
  const slack = 0.5;
  const center = { x: width / 2, y: height / 2 };
  const rc = centerRadius(options);
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i];
    const pa = at(a);
    const ra = nodeRadius(a.size);
    if (a.x <= 0 || a.x >= 100 || a.y <= 0 || a.y >= 100)
      out.push(`${a.key} outside the box`);
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j];
      const pb = at(b);
      const rb = nodeRadius(b.size);
      const distance = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (distance < ra + rb + AVATAR_GAP - slack)
        out.push(`${a.key} and ${b.key}: avatars`);
      if (options.named && a.side === b.side && besideNames(a)) {
        const dy = Math.abs(pa.y - pb.y);
        if (dy < LABEL_HEIGHT - slack) out.push(`${a.key} and ${b.key}: names`);
        if (reachesInto(a, b, width) && dy < LABEL_HEIGHT / 2 + rb - slack)
          out.push(`${a.key}'s name and ${b.key}`);
        if (reachesInto(b, a, width) && dy < LABEL_HEIGHT / 2 + ra - slack)
          out.push(`${b.key}'s name and ${a.key}`);
      }
    }
    if (
      Math.hypot(pa.x - center.x, pa.y - center.y) <
      rc + ra + AVATAR_GAP - slack
    )
      out.push(`${a.key} and the middle`);
    // The middle's name, under its avatar.
    const nameTop = center.y + rc + CENTER_GAP;
    const nameBottom = nameTop + LABEL_HEIGHT;
    if (
      Math.abs(pa.x - center.x) < options.centerLabel / 2 + ra &&
      pa.y + ra > nameTop - AVATAR_GAP + slack &&
      pa.y - ra < nameBottom + AVATAR_GAP - slack
    )
      out.push(`${a.key} and the middle's name`);
  }
  if (options.named) {
    const bottom = placed.filter((node) => node.side === 'both');
    const names = bottomNames(
      bottom,
      width,
      height,
      rows,
      options.bottomNameMax
    );
    const nameOf = (node: PlacedNode) =>
      names.get(node.key) ?? { room: options.bottomNameMax, rows: 1 };
    // A side's name runs from its avatar outwards to the edge: no bottom
    // avatar, nor the name under one, in its way.
    for (const side of placed.filter(besideNames)) {
      const p = at(side);
      const strip = [p.y - LABEL_HEIGHT / 2, p.y + LABEL_HEIGHT / 2];
      const from = p.x + (side.side === 'out' ? 1 : -1) * nodeRadius(side.size);
      const inPath = (x0: number, x1: number) =>
        side.side === 'out'
          ? x1 > from + LABEL_MARGIN
          : x0 < from - LABEL_MARGIN;
      for (const low of bottom) {
        const q = at(low);
        const r = nodeRadius(low.size);
        const { room, rows: taken } = nameOf(low);
        const nameTop = q.y + r;
        const shapes: Array<[number, number, number, number, string]> = [
          [q.x - r, q.x + r, q.y - r, q.y + r, low.key],
          [
            q.x - room / 2,
            q.x + room / 2,
            nameTop,
            nameTop + bottomNameHeight(taken),
            `${low.key}'s name`,
          ],
        ];
        for (const [x0, x1, y0, y1, what] of shapes)
          if (inPath(x0, x1) && y0 < strip[1] - slack && strip[0] < y1 - slack)
            out.push(`${side.key}'s name and ${what}`);
      }
    }
    const boxes = bottom.map((node) => {
      const p = at(node);
      const { room, rows: taken } = nameOf(node);
      const top = p.y + nodeRadius(node.size);
      return {
        node,
        x0: p.x - room / 2,
        x1: p.x + room / 2,
        y0: top,
        y1: top + bottomNameHeight(taken),
      };
    });
    for (const box of boxes)
      for (const other of boxes) {
        if (box === other) continue;
        if (
          box.x0 < other.x1 &&
          other.x0 < box.x1 &&
          box.y0 < other.y1 &&
          other.y0 < box.y1 &&
          box.node.key < other.node.key
        )
          out.push(`${box.node.key} and ${other.node.key}: names under them`);
        // A name under one and the other's avatar.
        const p = at(other.node);
        const r = nodeRadius(other.node.size);
        if (
          box.x0 < p.x + r &&
          p.x - r < box.x1 &&
          box.y0 < p.y + r &&
          p.y - r < box.y1
        )
          out.push(`${box.node.key}'s name and ${other.node.key}`);
      }
  }
  return out;
}

// ---- How big the drawing is in a big window ------------------------------------------------

/** The room a drawing has (px, inside its padding). */
export interface CircleRoom {
  /** Its width in an ordinary window: its column's, at most Q-Mintership+'s. */
  ordinary: number;
  /**
   * In a window bigger than an ordinary Explorer window: the widest it may
   * be (the window's), and the height the whole circle should fit in (the
   * window's visible height); null in an ordinary window.
   */
  big: { width: number; height: number } | null;
}

/** A drawing as it will be drawn. */
export interface CircleFit {
  options: LayoutOptions;
  layout: CircleLayout;
  /** Its size, inside its padding (px). */
  width: number;
  height: number;
  /** Bigger than an ordinary window's. */
  big: boolean;
}

/**
 * How `groups` are drawn in `room`. In an ordinary window, as always: the
 * column's width, at most Q-Mintership+'s, and the options for that width
 * (layoutFor). In a bigger window, every account it may draw: as many a
 * side and at the bottom as there are, up to BIG_SIDE_MAX and BIG_BOTH_MAX.
 *
 * - Where all of them fit in the height the window shows: as wide as the
 *   window and that height allow (its aspect at the height left after
 *   `around`: its headings, padding and the names under the bottom
 *   avatars), taken in until the height it needs at that width
 *   (circleHeight: nothing overlapping) and what is around it fit.
 * - Else all of them anyway, and the window scrolls: as wide as they can be
 *   without the drawing being taller than they need at the ordinary width
 *   (wider, its aspect would only make it taller), at most the window's
 *   width.
 * - Never narrower than the ordinary drawing, and that drawing itself where
 *   a bigger one would show no more and be no wider.
 */
export function fitCircle(
  groups: Pick<CircleGroups, 'in' | 'out' | 'both'>,
  order: CircleOrder,
  room: CircleRoom,
  /**
   * The height around the drawing (px) at a size: its headings, padding and
   * the names under the bottom avatars (taller where their amounts wrap).
   */
  around: (
    layout: CircleLayout,
    options: LayoutOptions,
    width: number,
    height: number
  ) => number
): CircleFit {
  const ordinary = (): CircleFit => {
    const options = layoutFor(room.ordinary);
    const layout = circleLayout(groups, options, order);
    return {
      options,
      layout,
      width: room.ordinary,
      height: circleHeight(layout, options, room.ordinary),
      big: false,
    };
  };
  const { big } = room;
  if (!big || big.width <= room.ordinary || room.ordinary < WIDE_MIN)
    return ordinary();
  const most = Math.max(groups.in.length, groups.out.length);
  const options: LayoutOptions = {
    ...BIG_LAYOUT,
    sideMax: Math.min(BIG_SIDE_MAX, Math.max(BIG_LAYOUT.sideMax, most)),
    bothMax: Math.min(
      BIG_BOTH_MAX,
      Math.max(BIG_LAYOUT.bothMax, groups.both.length)
    ),
  };
  const layout = circleLayout(groups, options, order);
  const aspect = circleAspect(layout, options);
  // As wide as the window and its height allow; what is around it is
  // worked out at that size (the names under the bottom avatars wrap where
  // it is narrower), and the width taken in again until it fits.
  let width = Math.floor(Math.min(big.width, big.height * aspect));
  for (let round = 0; round < 4 && width >= room.ordinary; round++) {
    const needed = circleHeight(layout, options, width);
    const total = needed + around(layout, options, width, needed);
    if (total <= big.height)
      return { options, layout, width, height: needed, big: true };
    const narrower = Math.floor(
      Math.min(width - 1, (big.height - (total - needed)) * aspect)
    );
    if (narrower >= width) break;
    width = narrower;
  }
  // More than fits in what the window shows: all of it anyway, the window
  // scrolling, as wide as it can be without being any taller than it must
  // be anyway (its names given that room).
  const scrolled = Math.max(
    room.ordinary,
    Math.floor(
      Math.min(big.width, circleHeight(layout, options, room.ordinary) * aspect)
    )
  );
  if (scrolled <= room.ordinary) {
    const plain = ordinary();
    if (layout.placed.length <= plain.layout.placed.length) return plain;
  }
  return {
    options,
    layout,
    width: scrolled,
    height: circleHeight(layout, options, scrolled),
    big: true,
  };
}

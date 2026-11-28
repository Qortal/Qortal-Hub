/**
 * What the Connections circle and its dialog share (from Q-Mintership+'s
 * circleParts): the side colours from Hub's palette, an avatar's ring, and
 * an account's links in words, in the viewer's language.
 */
import type { Theme } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import {
  addAssets,
  bothWays,
  receivedShare,
  shortAmount,
  type CircleNode,
  type Moved,
  type TradePart,
  type WayPart,
} from '../../../lib/explorer/circle';
import { formatCount, formatList } from '../../../lib/explorer/format';
import type { AssetSum } from '../../../lib/explorer/money';
import { fromAtomic } from '../../../lib/explorer/txWords';
import { amountText, assetText } from '../transactions/sentenceText';

/** The line and ring colours: received, sent, and every other link. */
export const sideColours = (theme: Theme) => ({
  in: theme.palette.other.positive,
  out: theme.palette.other.danger,
  other: theme.palette.primary.main,
});

export type SideColours = ReturnType<typeof sideColours>;

/**
 * An avatar's ring: green for what came in, red for what went out, in
 * proportion for an account paid both ways (from the top, clockwise).
 */
export function ringBackground(
  node: Pick<CircleNode, 'side' | 'split' | 'trade'>,
  colours: SideColours
): string {
  if (node.side === 'other') return colours.other;
  const share = receivedShare(node);
  return share >= 1
    ? colours.in
    : share <= 0
      ? colours.out
      : `conic-gradient(${colours.in} 0 ${share * 360}deg, ${colours.out} ${share * 360}deg 360deg)`;
}

/** QORT (when any moved) and each Q-Asset, exactly: "120 QORT and 2 Coin"; null for nothing. */
function exactAmounts(
  qort: bigint,
  assets: readonly AssetSum[],
  t: TFunction,
  language: string
): string | null {
  const amounts = [
    ...(qort > 0n
      ? [{ amount: fromAtomic(qort), asset: { id: 0, name: null } }]
      : []),
    ...assets
      .filter((sum) => sum.atomic > 0n)
      .map((sum) => ({ amount: fromAtomic(sum.atomic), asset: sum.asset })),
  ];
  return amounts.length
    ? formatList(
        amounts.map((amount) => amountText(amount, t, language)),
        language
      )
    : null;
}

function wayWords(
  way: 'received' | 'sent',
  part: WayPart,
  t: TFunction,
  language: string
): string {
  const amount = exactAmounts(part.qort, part.assets, t, language);
  const options = {
    count: part.count,
    shown: formatCount(part.count, language),
    ...(amount ? { amount } : {}),
  };
  return String(
    t(`explorer:circle.node.way_${way}${amount ? '_amount' : ''}`, options)
  );
}

/** "traded in 2 orders (got 23 GBQ for 529 QORT)". */
function tradeWords(trade: TradePart, t: TFunction, language: string): string {
  const amounts = (moved: Moved) =>
    exactAmounts(moved.qort, moved.assets, t, language) ??
    amountText({ amount: '0', asset: { id: 0, name: null } }, t, language);
  return String(
    t('explorer:circle.node.traded', {
      count: trade.orders,
      shown: formatCount(trade.orders, language),
      got: amounts(trade.got),
      gave: amounts(trade.gave),
    })
  );
}

/**
 * What an account stands for in the circle, its transactions counted once
 * each as its dialog lists them: "4 transactions received: 120 QORT", "2
 * transactions sent", "3 transactions"; both ways, "6 transactions: 1
 * received (7 QORT); 3 sent (13 QORT); traded in 2 orders (got 23 GBQ for
 * 529 QORT)".
 */
export function nodeWords(
  node: CircleNode,
  t: TFunction,
  language: string
): string {
  const shown = formatCount(node.count, language);
  if (node.side === 'both' && node.split) {
    const parts = [
      node.split.in.count
        ? wayWords('received', node.split.in, t, language)
        : null,
      node.split.out.count
        ? wayWords('sent', node.split.out, t, language)
        : null,
      node.trade ? tradeWords(node.trade, t, language) : null,
    ].filter((part): part is string => part !== null);
    return String(
      t('explorer:circle.node.both', {
        count: node.count,
        shown,
        parts: parts.join(String(t('explorer:circle.node.parts_join'))),
      })
    );
  }
  if (node.side === 'other')
    return String(
      t('explorer:circle.node.other', { count: node.count, shown })
    );
  const amount = exactAmounts(node.qort, node.assets, t, language);
  const key = `explorer:circle.node.${node.side}${amount ? '_amount' : ''}`;
  return String(
    t(key, { count: node.count, shown, ...(amount ? { amount } : {}) })
  );
}

/** What moved, short, for beside a name: the QORT, else the first Q-Asset ("500 QORT", "1 Coin"); null for nothing. */
export function shortMoved(
  node: Pick<CircleNode, 'qort' | 'assets'>,
  language: string
): string | null {
  const qort = shortAmount(node.qort, language);
  if (qort) return `${qort} QORT`;
  for (const sum of node.assets) {
    const amount = shortAmount(sum.atomic, language);
    if (amount) return `${amount} ${assetText(sum.asset)}`;
  }
  return null;
}

/**
 * Under an avatar paid both ways, a line for QORT and for each Q-Asset
 * that moved, its trades' too: "457 QORT in, 9.5 out", "983 Coin in", "1
 * Coin out".
 */
export function bothLines(
  node: Pick<CircleNode, 'split' | 'trade'>,
  t: TFunction,
  language: string
): string[] {
  const ways = bothWays(node);
  if (!ways) return [];
  const { in: received, out: sent } = ways;
  const assets = [
    { id: 0, name: null },
    ...addAssets(received.assets, sent.assets).map((sum) => sum.asset),
  ];
  const atomicOf = (way: Moved, asset: AssetSum['asset']) =>
    asset.id === 0
      ? way.qort
      : (way.assets.find(
          (sum) =>
            sum.asset.id === asset.id &&
            (asset.id !== null || sum.asset.name === asset.name)
        )?.atomic ?? 0n);
  return assets.flatMap((asset) => {
    const into = shortAmount(atomicOf(received, asset), language);
    const out = shortAmount(atomicOf(sent, asset), language);
    const options = {
      asset: assetText(asset),
      ...(into ? { received: into } : {}),
      ...(out ? { sent: out } : {}),
    };
    if (into && out)
      return [String(t('explorer:circle.both_line.in_out', options))];
    if (into) return [String(t('explorer:circle.both_line.in', options))];
    if (out) return [String(t('explorer:circle.both_line.out', options))];
    return [];
  });
}

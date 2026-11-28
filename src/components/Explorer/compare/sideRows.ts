/**
 * Compare → Side by side: one row per fact, one cell per account, in the
 * Overview's words (names, first seen, where its first QORT came from,
 * level, blocks minted, minting penalty, balance, MINTER, its first
 * sponsor, how many it sponsored, minting now, the last transaction it
 * sent, groups). A cell is undefined while its read is out and says
 * "couldn't read" when the read failed: never a value it doesn't have. A
 * row whose cells are all the same reads "Same for all" once.
 */
import { firstSponsorOf, COMPARE_SAY } from '../../../lib/explorer/compare';
import {
  formatCount,
  formatDay,
  formatQort,
} from '../../../lib/explorer/format';
import {
  countedBlocks,
  minterStandingOf,
  mintingNowOf,
} from '../../../lib/explorer/rules';
import type { TxSentenceSpec } from '../../../lib/explorer/txWords';
import type { CompareSideData } from './useCompareData';
import type { OnlineShare } from '../../../lib/explorer/reads';
import type { ReadState } from '../ExplorerContext';

export interface SideCell {
  /** Equal for equal values: a row of equal keys reads "Same for all". */
  key: string;
  /** Plain words: a key and its options. */
  words?: { key: string; options?: Record<string, unknown> };
  /** A sentence (an account or a name in it, as a link). */
  sentence?: TxSentenceSpec;
  /** Its read failed. */
  failed?: boolean;
}

export interface SideRow {
  key: string;
  /** Its label's key. */
  label: string;
  cells: Array<SideCell | undefined>;
}

const words = (
  key: string,
  options?: Record<string, unknown>,
  same = `${key}|${JSON.stringify(options ?? {})}`
): SideCell => ({ key: same, words: { key, options } });

const sentence = (key: string, spec: TxSentenceSpec): SideCell => ({
  key,
  sentence: spec,
});

/** A count with its sign, as the Overview writes a penalty: "−500" (a minus sign). */
function signedCount(value: number, language: string): string {
  const sign = value > 0 ? '+' : value < 0 ? '\u2212' : '';
  return `${sign}${formatCount(Math.abs(value), language)}`;
}

const say = (
  key: string,
  slots: TxSentenceSpec['slots'],
  count?: number
): TxSentenceSpec => ({
  base: COMPARE_SAY,
  key,
  slots,
  ...(count === undefined ? {} : { count }),
});

/** A cell's read failed: keyed to its account, so a row of them never reads "Same for all". */
const failed = (side: CompareSideData): SideCell => ({
  key: `failed:${side.address}`,
  words: { key: 'explorer:compare.side.failed' },
  failed: true,
});

/** undefined while it is read, "couldn't read" once failed. */
const unread = (
  side: CompareSideData,
  read: Pick<ReadState<unknown>, 'status' | 'data'>
): SideCell | undefined =>
  read.status === 'error' && read.data === undefined ? failed(side) : undefined;

function namesCell(
  side: CompareSideData,
  language: string
): SideCell | undefined {
  const names = side.names.data;
  if (!names) return unread(side, side.names);
  const count = names.names.length;
  if (!count && !names.truncated) return words('explorer:summary.no_names');
  const primary = side.primary.data;
  if (primary === undefined) return unread(side, side.primary);
  if (primary === null)
    return words(
      names.truncated
        ? 'explorer:compare.side.no_primary_more'
        : 'explorer:compare.side.no_primary',
      { count, shown: formatCount(count, language) }
    );
  const others = Math.max(0, count - 1);
  return sentence(
    `${primary}|${count}|${names.truncated}`,
    others || names.truncated
      ? say(
          names.truncated ? 'side_primary_more_plus' : 'side_primary_more',
          {
            name: { kind: 'name', name: primary },
            others: { kind: 'number', value: others },
          },
          others
        )
      : say('side_primary', { name: { kind: 'name', name: primary } })
  );
}

function firstQortCell(side: CompareSideData): SideCell | undefined {
  const read = side.funding;
  if (read.data === undefined) return unread(side, read);
  const funding = read.data;
  if (!funding) return words('explorer:compare.side.not_found');
  const from = funding.from;
  const account = (address: string) => ({
    kind: 'account' as const,
    address,
  });
  switch (funding.kind) {
    case 'payment':
    case 'multiPayment':
      return from
        ? sentence(
            `pay:${from}`,
            say('side_first_payment', { from: account(from) })
          )
        : words('explorer:compare.side.first.payment');
    case 'transferAsset':
      return from
        ? sentence(
            `asset:${from}`,
            say('side_first_transfer', { from: account(from) })
          )
        : words('explorer:compare.side.first.transfer');
    case 'rewardShare':
      return from
        ? sentence(
            `share:${from}`,
            say('side_first_share', { from: account(from) })
          )
        : words('explorer:compare.side.first.share');
    case 'transferPrivs':
      return from
        ? sentence(
            `level:${from}`,
            say('side_first_level', { from: account(from) })
          )
        : words('explorer:compare.side.first.level');
    case 'at':
      return words('explorer:compare.side.first.at');
    case 'genesis':
      return words('explorer:compare.side.first.genesis');
  }
}

function sponsorCell(side: CompareSideData): SideCell | undefined {
  const coverage = side.coverage.minting;
  if (coverage === 'failed') return failed(side);
  if (coverage === 'reading') return undefined;
  if (coverage === 'partial')
    return words('explorer:compare.side.sponsor_partial');
  const sponsor = firstSponsorOf(side.side);
  if (sponsor === undefined) return undefined;
  return sponsor
    ? sentence(
        sponsor,
        say('side_account', { account: { kind: 'account', address: sponsor } })
      )
    : words('explorer:compare.side.none_found');
}

function sponsoredCell(
  side: CompareSideData,
  language: string
): SideCell | undefined {
  const coverage = side.coverage.minting;
  if (coverage === 'failed') return failed(side);
  if (coverage === 'reading' || !side.conn.links) return undefined;
  const count = side.conn.links.sponsees.length;
  const short = coverage === 'partial';
  if (!count)
    return words(
      short ? 'explorer:compare.side.none_so_far' : 'explorer:compare.side.none'
    );
  return words(
    short
      ? 'explorer:compare.side.accounts_more'
      : 'explorer:compare.side.accounts',
    { count, shown: formatCount(count, language) }
  );
}

/** The rows for the accounts the node knows, in letter order. */
export function sideRows(
  sides: readonly CompareSideData[],
  online: ReadState<OnlineShare[]> | null,
  language: string
): SideRow[] {
  const row = (
    key: string,
    label: string,
    cell: (side: CompareSideData) => SideCell | undefined
  ): SideRow => ({ key, label, cells: sides.map(cell) });
  return [
    row('names', 'explorer:compare.side.label.names', (side) =>
      namesCell(side, language)
    ),
    row('first_seen', 'explorer:facts.first_seen', (side) => {
      const seen = side.firstSeen.data;
      if (seen === undefined) return unread(side, side.firstSeen);
      return seen
        ? words(
            'explorer:connections.when_one',
            {
              date: formatDay(seen.timestamp ?? 0, language),
              block: formatCount(seen.height, language),
            },
            `seen:${seen.height}`
          )
        : words('explorer:facts.first_seen_none');
    }),
    row('first_qort', 'explorer:compare.side.label.first_qort', firstQortCell),
    row('level', 'explorer:compare.side.label.level', (side) =>
      words(
        'core:account_lookup.chip_level',
        { level: side.account?.level ?? 0 },
        `level:${side.account?.level ?? 0}`
      )
    ),
    // As the Overview's Total blocks minted: with the adjustment Core records.
    row('blocks', 'explorer:compare.side.label.blocks', (side) => {
      const blocks = side.account ? countedBlocks(side.account) : 0;
      return words(
        'explorer:compare.side.number',
        { value: formatCount(blocks, language) },
        `blocks:${blocks}`
      );
    }),
    row('penalty', 'explorer:compare.side.label.penalty', (side) =>
      side.account?.blocksMintedPenalty
        ? words(
            'explorer:compare.side.blocks',
            {
              count: Math.abs(side.account.blocksMintedPenalty),
              shown: signedCount(side.account.blocksMintedPenalty, language),
            },
            `penalty:${side.account.blocksMintedPenalty}`
          )
        : words('explorer:compare.side.none')
    ),
    row('balance', 'explorer:facts.balance', (side) =>
      side.balance.data === undefined
        ? unread(side, side.balance)
        : words(
            'explorer:compare.side.qort',
            { amount: formatQort(side.balance.data.qort, language) },
            `balance:${side.balance.data.atomic}`
          )
    ),
    row('minter', 'explorer:minter.title', (side) => {
      const groups = side.groups.data;
      if (!groups) return unread(side, side.groups);
      const standing = minterStandingOf(groups);
      return words(
        standing === 'admin'
          ? 'explorer:summary.minter_admin'
          : standing === 'member'
            ? 'explorer:summary.minter_member'
            : 'explorer:summary.minter_outside'
      );
    }),
    row('sponsor', 'explorer:compare.side.label.sponsor', sponsorCell),
    row('sponsored', 'explorer:compare.side.label.sponsored', (side) =>
      sponsoredCell(side, language)
    ),
    row('minting_now', 'explorer:compare.side.label.minting_now', (side) => {
      if (!online?.data)
        return online && online.status === 'error' ? failed(side) : undefined;
      return words(
        mintingNowOf(online.data, side.address)
          ? 'explorer:compare.side.yes'
          : 'explorer:compare.side.no'
      );
    }),
    row('last_sent', 'explorer:compare.side.label.last_sent', (side) => {
      if (!side.account?.publicKey) return words('explorer:compare.side.never');
      const sent = side.lastSent.data;
      if (sent === undefined) return unread(side, side.lastSent);
      return sent
        ? words(
            'explorer:connections.when_one',
            {
              date: formatDay(sent.timestamp, language),
              block: formatCount(sent.height, language),
            },
            `sent:${sent.height}`
          )
        : words('explorer:compare.side.never');
    }),
    row('groups', 'explorer:facts.groups', (side) =>
      side.groups.data
        ? words(
            'explorer:compare.side.number',
            { value: formatCount(side.groups.data.length, language) },
            `groups:${side.groups.data.length}`
          )
        : unread(side, side.groups)
    ),
  ];
}

/** The one cell a row's cells all equal, or null (also while any is out or failed). */
export function sameForAll(
  cells: ReadonlyArray<SideCell | undefined>
): SideCell | null {
  if (cells.length < 2 || cells.some((cell) => !cell || cell.failed))
    return null;
  const [first] = cells as SideCell[];
  return cells.every((cell) => cell?.key === first.key) ? first : null;
}

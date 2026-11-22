/**
 * The Account report as Markdown, in the viewer's language (from
 * Q-Mintership+'s rules/explorer/accountReport.ts). The same headings
 * every time, so reports of different accounts read and compare alike:
 *
 * 1. a header table: the account, when the report was made (UTC), how much
 *    of its history was read, and what made it; then the neutral line;
 * 2. Account: its facts as Core gives them;
 * 3. QORT totals, and 4. Activity by type: only from its whole history
 *    (else each says why not, and how much was read: read only in part,
 *    still being read, its newest read again after a Refresh, longer than
 *    the Explorer reads, or couldn't be read; "Read the rest" only where
 *    it can give them);
 * 5. Connections: each kind as the Connections tab's sentences with block,
 *    date and signature, payments as tables, the exchanges, what it has in
 *    common, then what was checked and found nothing;
 * 6. What was read, what couldn't be read, and what was still being read;
 * 7. the transactions behind the connections, with full signatures.
 *
 * Facts only: the Explorer's own sentences, nothing that adds a verdict.
 * Every time in UTC; addresses, signatures and numbers as data; text from
 * the chain escaped (lib/explorer/accountReport.ts). Pure: AccountReport
 * gathers what it says from what the page read.
 */
import type { TFunction } from 'i18next';
import type { EmptyCheck, Funding } from '../../../lib/explorer/connections';
import {
  exchangeName,
  exchangeSentence,
  type ExchangeFlow,
} from '../../../lib/explorer/exchanges';
import {
  EVIDENCE_MAX,
  mdCode,
  mdTable,
  mdText,
  onceNewestFirst,
  typeCounts,
  utcDay,
  utcTime,
} from '../../../lib/explorer/accountReport';
import { isAtAddress } from '../../../lib/explorer/addresses';
import {
  fundingSentence,
  type Finding,
  type FindingKind,
} from '../../../lib/explorer/findings';
import {
  formatAmountExact,
  formatCount,
  formatList,
} from '../../../lib/explorer/format';
import type { Flow } from '../../../lib/explorer/money';
import { movedParts, type QortBook } from '../../../lib/explorer/qortBook';
import {
  ORDER_TRADES_MAX,
  type PortalTrades,
} from '../../../lib/explorer/qortReads';
import type {
  AccountInfo,
  FirstSeen,
  GroupOf,
  NamesOf,
  OnlineShare,
  TxRow,
} from '../../../lib/explorer/reads';
import {
  minterStandingOf,
  mintingNowOf,
  visibleName,
} from '../../../lib/explorer/rules';
import { CONTRACTS_MAX } from '../../../lib/explorer/tradeReads';
import { familyOf } from '../../../lib/explorer/txFamilies';
import { fromAtomic, type TxSentenceSpec } from '../../../lib/explorer/txWords';
import { ACCOUNT_HISTORY_MAX } from '../../../lib/explorer/accountTx';
import {
  ORDERS_MAX,
  type HistoryState,
  type Minted,
} from '../overview/QortFacts';
import { cap } from '../parts';
import {
  assetText,
  sentencePieces,
  slotText,
  typeTitle,
} from '../transactions/sentenceText';
import type { ConnectionsPart } from './useConnections';

/** What a part of the report holds: its answer, or that it couldn't be read, or is still being read. */
export type Known<T> =
  | { state: 'ready'; value: T }
  | { state: 'failed' }
  | { state: 'reading' };

/** How much of its history was read: PR 5's states, and its newest read again after a Refresh. */
export type ReportHistoryState = HistoryState | 'refreshing';

/** A read the report names when it couldn't be read, or was still being read. */
export type ReportPart =
  | ConnectionsPart
  | 'history'
  | 'funding'
  | 'sponsor_list'
  | 'core_sponsor'
  | 'exchanges'
  | 'balance'
  | 'owned_names'
  | 'groups'
  | 'primary'
  | 'first_seen'
  | 'portal'
  | 'first_share'
  | 'orders'
  | 'newest'
  | 'minted'
  | 'refresh';

export interface ReportData {
  address: string;
  /** When it was made (ms). */
  madeAt: number;
  account: AccountInfo;
  primary: Known<string | null>;
  names: Known<NamesOf>;
  groups: Known<GroupOf[]>;
  online: Known<OnlineShare[]>;
  firstSeen: Known<FirstSeen | null>;
  /** Its balance: the one QORT minted was worked out with, else the Balance fact's. */
  balance: Known<bigint>;
  /** How much of its history was read ('refreshing': its newest read again, after a Refresh). */
  history: { state: ReportHistoryState; held: number };
  /**
   * Its QORT totals, as PR 5 works them out (null while it can't); said
   * only once its whole history is read (`history`). `trades` is null for
   * an account without a public key: what it bought is `keyless`, what
   * other accounts' trade contracts paid it, each by its own record, as the
   * Overview and the Trades tab count it (null with a public key).
   */
  qort: {
    minted: Minted;
    book: QortBook;
    trades: Known<PortalTrades> | null;
    /** `atLeast`: more contracts paid it than are read (CONTRACTS_MAX). */
    keyless: Known<{ bought: bigint; atLeast: boolean }> | null;
  } | null;
  /** Its transactions read so far: counted by type only once they are its whole history. */
  rows: readonly TxRow[] | null;
  /** What Connections recorded between it and others. */
  findings: readonly Finding[];
  flowsSent: Known<Flow[]>;
  flowsReceived: Known<Flow[]>;
  funding: Known<Funding | null>;
  /** The others its sponsor sponsored ("Also sponsored by A (47 others)"); null without either. */
  siblings: Known<{
    sentence: TxSentenceSpec;
    first: number;
    last: number;
  } | null>;
  /** Its payments with exchanges: exactly, or from the lists; `own` on an exchange's own account. */
  exchanges:
    | { state: 'own'; exchange: string }
    | Known<{ flows: ExchangeFlow[]; exact: boolean }>;
  /** Its Q-Asset trades that aren't listed (with itself, or an order the node doesn't know). */
  tradesLeftOut: number;
  /** Checked and found nothing: in full, and in what was read so far. */
  empty: readonly EmptyCheck[];
  soFar: readonly EmptyCheck[];
  /** What was read of its lists, as Connections says it. */
  coverage: readonly string[];
  failed: readonly ReportPart[];
  pending: readonly ReportPart[];
  /** A row's tags, as Connections shows them. */
  tagsOf: (finding: Finding) => ReadonlyArray<string | null>;
  /** The names the Explorer had read, for the accounts it mentions. */
  nameOf: (address: string) => string | null | undefined;
}

const R = 'explorer:report.md';

/** The words for a part that couldn't be read, or was still being read. */
export function partText(part: ReportPart, t: TFunction): string {
  switch (part) {
    case 'payments':
    case 'minting':
    case 'names':
    case 'level_moves':
    case 'trades':
    case 'online':
      return String(t(`explorer:connections.unread.${part}`));
    case 'funding':
      return String(t('explorer:connections.empty.first_qort'));
    default:
      return String(t(`explorer:report.part.${part}`));
  }
}

/** How much of its history was read, in words. */
export function historyText(
  history: ReportData['history'],
  t: TFunction,
  language: string
): string {
  const { state, held } = history;
  const shown = formatCount(held, language);
  if (state === 'refreshing')
    return String(t(`${R}.history.refreshing`, { count: held, shown }));
  if (state === 'whole')
    return held === 0
      ? String(t(`${R}.history.whole_none`))
      : held === 1
        ? String(t(`${R}.history.whole_single`))
        : String(t(`${R}.history.whole`, { count: held, shown }));
  if (state === 'ceiling')
    return String(
      t(`${R}.history.ceiling`, {
        count: held,
        shown,
        max: formatCount(ACCOUNT_HISTORY_MAX, language),
      })
    );
  if (!held)
    return String(
      t(
        state === 'failed' ? `${R}.history.failed` : `${R}.history.reading_none`
      )
    );
  return held === 1
    ? String(t(`${R}.history.partial_single`))
    : String(t(`${R}.history.partial`, { count: held, shown }));
}

const exact = (atomic: bigint, language: string) =>
  formatAmountExact(fromAtomic(atomic), language);

/** An account in the report: its name when known, and its address always. */
function accountRef(address: string, nameOf: ReportData['nameOf']): string {
  const name = nameOf(address) ?? exchangeName(address);
  return name
    ? `${mdText(visibleName(name))} (${mdCode(address)})`
    : mdCode(address);
}

/** A sentence of the Explorer's in the report: accounts by name and address, times as UTC days, signatures whole. */
export function reportSentence(
  sentence: TxSentenceSpec,
  t: TFunction,
  language: string,
  nameOf: ReportData['nameOf']
): string {
  return sentencePieces(sentence, t)
    .map((piece) => {
      if (piece.kind === 'text') return piece.text;
      const { slot } = piece;
      switch (slot.kind) {
        case 'account':
          return slot.address
            ? accountRef(slot.address, nameOf)
            : String(t('explorer:tx.unknown_account'));
        case 'span':
          return spanText(slot.first, slot.last, t);
        case 'tx':
          return slot.signature ? mdCode(slot.signature) : '?';
        default:
          return mdText(slotText(slot, t, language));
      }
    })
    .join('');
}

function spanText(first: number, last: number, t: TFunction): string {
  const [from, to] = first <= last ? [first, last] : [last, first];
  const a = utcDay(from);
  const b = utcDay(to);
  return a === b ? a : String(t(`${R}.days`, { from: a, to: b }));
}

/** Where and when a finding happened: its block (or blocks), its day (or days) and its signature. */
function whereText(
  finding: Pick<
    Finding,
    'height' | 'firstHeight' | 'timestamp' | 'firstTimestamp' | 'signature'
  >,
  t: TFunction,
  language: string
): string {
  if (!finding.height)
    // A Q-Asset trade: Core says when, not in which block.
    return String(
      t(`${R}.where_trade`, {
        when: spanText(
          finding.firstTimestamp ?? finding.timestamp,
          finding.timestamp,
          t
        ),
        signature: mdCode(finding.signature),
      })
    );
  if (
    finding.firstHeight !== undefined &&
    finding.firstHeight !== finding.height
  )
    return String(
      t(`${R}.where_span`, {
        first: formatCount(finding.firstHeight, language),
        last: formatCount(finding.height, language),
        when: spanText(
          finding.firstTimestamp ?? finding.timestamp,
          finding.timestamp,
          t
        ),
        signature: mdCode(finding.signature),
      })
    );
  return String(
    t(`${R}.where_one`, {
      block: formatCount(finding.height, language),
      day: utcDay(finding.timestamp),
      signature: mdCode(finding.signature),
    })
  );
}

const readingOr = <T>(
  known: Known<T>,
  t: TFunction,
  ready: (value: T) => string
): string =>
  known.state === 'ready'
    ? ready(known.value)
    : String(
        t(known.state === 'failed' ? `${R}.couldnt_read` : `${R}.still_reading`)
      );

function headerLines(
  data: ReportData,
  t: TFunction,
  language: string
): string[] {
  const primary =
    data.primary.state === 'ready' && data.primary.value
      ? mdText(visibleName(data.primary.value))
      : null;
  return [
    `# ${t(`${R}.title`, { name: primary ?? data.address })}`,
    '',
    ...mdTable(
      ['', ''],
      [
        [String(t(`${R}.row.address`)), mdCode(data.address)],
        [
          String(t(`${R}.row.primary`)),
          readingOr(data.primary, t, (name) =>
            name
              ? mdText(visibleName(name))
              : String(t('explorer:header.no_primary_name', cap))
          ),
        ],
        [String(t(`${R}.row.made`)), utcTime(data.madeAt)],
        [String(t(`${R}.row.read`)), historyText(data.history, t, language)],
        [String(t(`${R}.row.made_with`)), String(t(`${R}.made_with_hub`))],
      ]
    ),
    '',
    `> ${t('explorer:report.neutral')}`,
  ];
}

function mintingText(
  online: OnlineShare[],
  address: string,
  t: TFunction,
  language: string,
  nameOf: ReportData['nameOf']
): string {
  const now = mintingNowOf(online, address);
  if (!now) return String(t('explorer:minting.not_now'));
  if (!now.others.length) return String(t('explorer:minting.own_key'));
  const accounts = formatList(
    now.others.map((other) => accountRef(other, nameOf)),
    language
  );
  return String(
    t(now.self ? `${R}.minting_own_and_with` : `${R}.minting_with`, {
      accounts,
    })
  );
}

function groupText(group: GroupOf, address: string, t: TFunction): string {
  const name = mdText(visibleName(group.groupName || `#${group.groupId}`));
  const role =
    group.owner === address
      ? String(t('explorer:groups.owner'))
      : group.isAdmin
        ? String(t('explorer:groups.admin'))
        : null;
  return String(
    t(role ? `${R}.group_role` : `${R}.group`, {
      name,
      id: group.groupId,
      ...(role ? { role } : {}),
    })
  );
}

function txAt(
  at: { height: number; timestamp: number; signature: string },
  t: TFunction,
  language: string
): string {
  return String(
    t(`${R}.tx_at`, {
      block: formatCount(at.height, language),
      time: utcTime(at.timestamp),
      signature: mdCode(at.signature),
    })
  );
}

function accountLines(
  data: ReportData,
  t: TFunction,
  language: string
): string[] {
  const a = data.account;
  const rows: Array<[string, string]> = [
    [
      String(t(`${R}.row.public_key`)),
      a.publicKey ? mdCode(a.publicKey) : String(t(`${R}.public_key_none`)),
    ],
    [String(t(`${R}.row.level`)), formatCount(a.level, language)],
    [
      String(t(`${R}.row.blocks`)),
      String(
        t(`${R}.blocks_value`, {
          blocks: formatCount(a.blocksMinted, language),
          adjustment: formatCount(a.blocksMintedAdjustment, language),
          penalty: formatCount(a.blocksMintedPenalty, language),
        })
      ),
    ],
    [
      String(t('explorer:facts.balance', cap)),
      readingOr(data.balance, t, (atomic) => `${exact(atomic, language)} QORT`),
    ],
    [
      String(t(`${R}.row.minter`)),
      readingOr(data.groups, t, (groups) => {
        const standing = minterStandingOf(groups);
        return String(
          t(
            standing === 'admin'
              ? 'explorer:minter.standing_admin'
              : standing === 'member'
                ? 'explorer:minter.standing_member'
                : 'explorer:minter.standing_outside'
          )
        );
      }),
    ],
    [
      String(t(`${R}.row.minting`)),
      readingOr(data.online, t, (online) =>
        mintingText(online, data.address, t, language, data.nameOf)
      ),
    ],
    [
      String(t(`${R}.row.names`)),
      readingOr(data.names, t, ({ names, truncated }) =>
        names.length
          ? `${formatCount(names.length, language)}${truncated ? '+' : ''}: ${names
              .map((name) => mdText(visibleName(name)))
              .join(', ')}`
          : String(t('explorer:summary.no_names', cap))
      ),
    ],
    [
      String(t('explorer:facts.groups', cap)),
      readingOr(data.groups, t, (groups) =>
        groups.length
          ? `${formatCount(groups.length, language)}: ${groups
              .map((group) => groupText(group, data.address, t))
              .join(', ')}`
          : String(t('explorer:groups.none'))
      ),
    ],
    [
      String(t('explorer:facts.first_seen', cap)),
      readingOr(data.firstSeen, t, (seen) =>
        seen && seen.timestamp !== null
          ? txAt(
              {
                height: seen.height,
                timestamp: seen.timestamp,
                signature: seen.signature,
              },
              t,
              language
            )
          : String(t('explorer:facts.first_seen_none', cap))
      ),
    ],
  ];
  return ['', `## ${t(`${R}.account`)}`, '', ...mdTable(['', ''], rows)];
}

/** "received 4,200, sent 3 and fees 0.01": what its transactions moved. */
function movedText(
  book: QortBook,
  orders: bigint,
  t: TFunction,
  language: string
): string {
  const parts = movedParts(book, orders).map(({ part, atomic }) =>
    String(
      t(`explorer:facts.moved.${part}`, { amount: exact(atomic, language) })
    )
  );
  return parts.length
    ? formatList(parts, language)
    : String(t('explorer:facts.moved.nothing'));
}

/**
 * Why its QORT totals or activity by type aren't given (`part`: `needs_whole`
 * or `activity_needs_whole`), by how its history stood: "Read the rest" only
 * where reading it on can give them.
 */
function needsWhole(
  part: 'needs_whole' | 'activity_needs_whole',
  history: ReportData['history'],
  t: TFunction,
  language: string
): string {
  const why =
    history.state === 'waiting'
      ? ''
      : history.state === 'ceiling'
        ? '_ceiling'
        : history.state === 'failed'
          ? '_failed'
          : '_reading';
  return String(
    t(`${R}.${part}${why}`, {
      history: historyText(history, t, language),
    })
  );
}

function qortLines(data: ReportData, t: TFunction, language: string): string[] {
  const out = ['', `## ${t(`${R}.qort_totals`)}`, ''];
  const q = data.qort;
  // Never from part of its history.
  if (!q || data.history.state !== 'whole') {
    out.push(needsWhole('needs_whole', data.history, t, language));
    return out;
  }
  const { minted, book } = q;
  const mintedCell = (() => {
    switch (minted.kind) {
      case 'value':
        return `${exact(minted.atomic, language)} QORT`;
      case 'never':
        return String(t('explorer:facts.never_minted', cap));
      case 'unknown':
      case 'orders_too_long':
      case 'orders_too_many':
        return String(t('explorer:facts.cant_work_out', cap));
      case 'changing':
        return String(t('explorer:facts.minted_changing'));
      case 'failed':
        return String(
          t(
            minted.what === 'share'
              ? 'explorer:facts.share_failed'
              : minted.what === 'balance'
                ? 'explorer:facts.balance_failed'
                : minted.what === 'newest'
                  ? 'explorer:facts.newest_failed'
                  : 'explorer:facts.orders_failed'
          )
        );
      default:
        return String(t(`${R}.still_reading`));
    }
  })();
  const noKey = q.trades === null;
  // Without a key: what trade contracts paid it, as the Overview counts it
  // (never all that contracts paid it: a lottery's payout isn't a purchase).
  const tradesCell = noKey
    ? readingOr(
        q.keyless ?? { state: 'reading' },
        t,
        ({ bought, atLeast }) =>
          `${atLeast ? `${t('explorer:facts.at_least')} ` : ''}${exact(bought, language)} / ${exact(0n, language)}`
      )
    : readingOr(
        q.trades as Known<PortalTrades>,
        t,
        (trades) =>
          `${exact(trades.bought, language)} / ${exact(trades.sold, language)}`
      );
  out.push(
    ...mdTable(
      ['', 'QORT'],
      [
        [String(t('explorer:facts.minted', cap)), mintedCell],
        [
          String(t('explorer:facts.received_sent', cap)),
          `${exact(book.received, language)} / ${exact(book.sent, language)}`,
        ],
        [String(t('explorer:facts.purchased_sold', cap)), tradesCell],
      ]
    ),
    ''
  );
  const notes: string[] = [];
  switch (minted.kind) {
    case 'value':
      notes.push(
        String(
          t('explorer:facts.minted_info', {
            exact: exact(minted.atomic, language),
            balance: exact(minted.balance, language),
            moved: movedText(minted.book, minted.orders, t, language),
          })
        )
      );
      break;
    case 'never':
      notes.push(String(t('explorer:facts.never_minted_info')));
      break;
    case 'unknown':
      notes.push(
        String(
          t('explorer:facts.minted_unknown_info', {
            balance: exact(minted.balance, language),
            moved: movedText(minted.book, minted.orders, t, language),
          })
        )
      );
      break;
    case 'orders_too_long':
      notes.push(
        String(
          t('explorer:facts.orders_too_long', {
            max: formatCount(ORDER_TRADES_MAX, language),
          })
        )
      );
      break;
    case 'orders_too_many':
      notes.push(
        String(
          t('explorer:facts.orders_too_many', {
            count: minted.count,
            shown: formatCount(minted.count, language),
            max: formatCount(ORDERS_MAX, language),
          })
        )
      );
      break;
    default:
      break;
  }
  notes.push(
    String(
      t('explorer:facts.flows_info', {
        received: exact(book.received, language),
        sent: exact(book.sent, language),
      })
    )
  );
  if (noKey) {
    if (q.keyless?.state === 'ready')
      notes.push(
        [
          String(
            t('explorer:facts.trades_no_key_info', {
              bought: exact(q.keyless.value.bought, language),
            })
          ),
          q.keyless.value.atLeast
            ? String(
                t('explorer:facts.trades_no_key_cut', {
                  max: formatCount(CONTRACTS_MAX, language),
                })
              )
            : '',
        ]
          .filter(Boolean)
          .join(' ')
      );
  } else if (q.trades?.state === 'ready')
    notes.push(
      String(
        t('explorer:facts.trades_info', {
          bought: exact(q.trades.value.bought, language),
          sold: exact(q.trades.value.sold, language),
        })
      )
    );
  for (const note of notes) out.push(`- ${note}`);
  return out;
}

function activityLines(
  data: ReportData,
  t: TFunction,
  language: string
): string[] {
  const out = ['', `## ${t(`${R}.activity`)}`, ''];
  if (data.history.state !== 'whole' || !data.rows) {
    out.push(needsWhole('activity_needs_whole', data.history, t, language));
    return out;
  }
  const counts = typeCounts(data.rows);
  out.push(
    String(
      t(`${R}.activity_from`, {
        history: historyText(data.history, t, language),
      })
    )
  );
  if (!counts.length) return out;
  out.push(
    '',
    ...mdTable(
      [
        String(t(`${R}.col.type`)),
        String(t(`${R}.col.kind`)),
        String(t(`${R}.col.transactions`)),
        String(t(`${R}.col.first`)),
        String(t(`${R}.col.last`)),
      ],
      counts.map((entry) => [
        mdText(typeTitle(entry.type, t, true)),
        String(t(`explorer:tx_family.${familyOf(entry.type)}`, cap)),
        formatCount(entry.count, language),
        utcDay(entry.first),
        utcDay(entry.last),
      ])
    )
  );
  return out;
}

const PARTS: ReadonlyArray<{ title: string; kinds: readonly FindingKind[] }> = [
  { title: 'explorer:connections.part.level', kinds: ['levelMove'] },
  {
    title: 'explorer:connections.part.shares',
    kinds: ['sponsor', 'mintingWith', 'sponsees'],
  },
  { title: 'explorer:connections.part.names', kinds: ['nameDeal'] },
  { title: 'explorer:connections.part.trades', kinds: ['traded'] },
];

function findingLine(
  finding: Finding,
  data: ReportData,
  t: TFunction,
  language: string
): string {
  const tags = data
    .tagsOf(finding)
    .filter((tag): tag is string => Boolean(tag));
  return `- ${reportSentence(finding.sentence, t, language, data.nameOf)} (${whereText(
    finding,
    t,
    language
  )})${tags.length ? ` · ${tags.join(' · ')}` : ''}`;
}

function flowTable(
  flows: Flow[],
  data: ReportData,
  t: TFunction,
  language: string
): string[] {
  return mdTable(
    [
      String(t(`${R}.col.account`)),
      String(t(`${R}.col.name`)),
      String(t(`${R}.col.payments`)),
      'QORT',
      String(t(`${R}.col.assets`)),
      String(t(`${R}.col.first`)),
      String(t(`${R}.col.last`)),
    ],
    flows.map((flow) => {
      const name = isAtAddress(flow.address)
        ? String(t('explorer:at.title', cap))
        : (data.nameOf(flow.address) ?? exchangeName(flow.address));
      return [
        mdCode(flow.address),
        name ? mdText(visibleName(name)) : '',
        formatCount(flow.count, language),
        exact(flow.qort, language),
        formatList(
          flow.assets.map(
            (sum) =>
              `${exact(sum.atomic, language)} ${mdText(assetText(sum.asset))}`
          ),
          language
        ),
        utcDay(flow.first.timestamp),
        utcDay(flow.last.timestamp),
      ];
    })
  );
}

function connectionLines(
  data: ReportData,
  t: TFunction,
  language: string
): string[] {
  const out = ['', `## ${t(`${R}.connections`)}`];
  // QORT to and from exchanges, at the top as on the tab.
  const { exchanges } = data;
  const exchangeLines: string[] = [];
  if (exchanges.state === 'own')
    exchangeLines.push(
      String(
        t('explorer:connections.exchange.own', {
          exchange: mdText(exchanges.exchange),
        })
      )
    );
  else if (exchanges.state === 'failed')
    exchangeLines.push(String(t('explorer:connections.failed.exchanges')));
  else if (exchanges.state === 'ready' && exchanges.value.flows.length) {
    for (const flow of exchanges.value.flows)
      exchangeLines.push(
        `- ${reportSentence(exchangeSentence(flow), t, language, data.nameOf)}`
      );
    exchangeLines.push(
      '',
      String(
        t(
          exchanges.value.exact
            ? 'explorer:connections.exchange.exact_note'
            : 'explorer:connections.exchange.from_lists'
        )
      )
    );
  }
  if (exchangeLines.length)
    out.push('', `### ${t(`${R}.exchanges`)}`, '', ...exchangeLines);

  for (const part of PARTS) {
    const found = data.findings.filter((finding) =>
      part.kinds.includes(finding.kind)
    );
    const leftOut =
      part.kinds.includes('traded') && data.tradesLeftOut
        ? [
            String(
              t('explorer:connections.trades_left_out', {
                count: data.tradesLeftOut,
                shown: formatCount(data.tradesLeftOut, language),
              })
            ),
          ]
        : [];
    if (!found.length && !leftOut.length) continue;
    out.push('', `### ${t(part.title, cap)}`, '');
    for (const finding of found)
      out.push(findingLine(finding, data, t, language));
    if (leftOut.length) out.push(...(found.length ? [''] : []), ...leftOut);
  }

  // Payments, each way, as tables.
  const payments: string[] = [];
  for (const [flows, title, none] of [
    [
      data.flowsReceived,
      'explorer:connections.payments.received_from',
      'explorer:connections.payments.none_received',
    ],
    [
      data.flowsSent,
      'explorer:connections.payments.sent_to',
      'explorer:connections.payments.none_sent',
    ],
  ] as const) {
    payments.push('', `#### ${t(title, cap)}`, '');
    if (flows.state === 'failed')
      payments.push(String(t('explorer:connections.failed.payments')));
    else if (flows.state === 'reading')
      payments.push(String(t(`${R}.still_reading`, cap)));
    else if (!flows.value.length) payments.push(String(t(none)));
    else payments.push(...flowTable(flows.value, data, t, language));
  }
  out.push(
    '',
    `### ${t('explorer:connections.part.payments', cap)}`,
    ...payments
  );

  // In common.
  const common: string[] = [];
  const { funding, siblings } = data;
  if (funding.state === 'failed')
    common.push(`- ${t('explorer:connections.failed.funding')}`);
  else if (funding.state === 'reading')
    common.push(
      `- ${t(`${R}.part_reading`, { part: partText('funding', t), ...cap })}`
    );
  else if (funding.value)
    common.push(
      `- ${reportSentence(fundingSentence(funding.value), t, language, data.nameOf)} (${whereText(
        {
          height: funding.value.height,
          timestamp: funding.value.timestamp,
          signature: funding.value.signature,
        },
        t,
        language
      )})`
    );
  if (siblings.state === 'failed')
    common.push(`- ${t('explorer:connections.failed.sponsor_list')}`);
  else if (siblings.state === 'reading')
    common.push(
      `- ${t(`${R}.part_reading`, { part: partText('sponsor_list', t), ...cap })}`
    );
  else if (siblings.value)
    common.push(
      `- ${reportSentence(siblings.value.sentence, t, language, data.nameOf)} (${spanText(
        siblings.value.first,
        siblings.value.last,
        t
      )})`
    );
  if (common.length)
    out.push(
      '',
      `### ${t('explorer:connections.common_title', cap)}`,
      '',
      ...common
    );

  const listOf = (checks: readonly EmptyCheck[]) =>
    formatList(
      checks.map((check) => String(t(`explorer:connections.empty.${check}`))),
      language
    );
  if (data.empty.length)
    out.push(
      '',
      String(
        t('explorer:connections.nothing_found', { list: listOf(data.empty) })
      )
    );
  if (data.soFar.length)
    out.push(
      '',
      String(
        t('explorer:connections.nothing_found_so_far', {
          list: listOf(data.soFar),
        })
      )
    );
  return out;
}

function readLines(data: ReportData, t: TFunction, language: string): string[] {
  const out = ['', `## ${t(`${R}.read`)}`, ''];
  out.push(
    `- ${t(`${R}.read_history`, { history: historyText(data.history, t, language) })}`
  );
  for (const line of data.coverage) out.push(`- ${line}`);
  const list = (parts: readonly ReportPart[]) =>
    formatList(
      parts.map((part) => partText(part, t)),
      language
    );
  if (data.failed.length)
    out.push(`- ${t(`${R}.failed`, { list: list(data.failed) })}`);
  if (data.pending.length)
    out.push(`- ${t(`${R}.pending`, { list: list(data.pending) })}`);
  out.push(`- ${t(`${R}.names_note`)}`, `- ${t(`${R}.source`)}`);
  return out;
}

function evidenceLines(
  data: ReportData,
  t: TFunction,
  language: string
): string[] {
  const rows = onceNewestFirst(
    data.findings.flatMap((finding) => finding.evidence)
  );
  const orders = [
    ...new Set(data.findings.flatMap((f) => f.evidenceSignatures ?? [])),
  ];
  const out = ['', `## ${t(`${R}.evidence`)}`, ''];
  if (!rows.length && !orders.length) {
    out.push(String(t(`${R}.evidence_none`)));
    return out;
  }
  const listed = rows.slice(0, EVIDENCE_MAX);
  if (listed.length)
    out.push(
      ...mdTable(
        [
          String(t(`${R}.col.block`)),
          String(t(`${R}.col.time`)),
          String(t(`${R}.col.type`)),
          String(t(`${R}.col.from`)),
          String(t(`${R}.col.signature`)),
        ],
        listed.map((tx) => [
          typeof tx.blockHeight === 'number'
            ? formatCount(tx.blockHeight, language)
            : '—',
          utcTime(tx.timestamp),
          mdText(typeTitle(String(tx.type), t, true)),
          typeof tx.creatorAddress === 'string'
            ? mdCode(tx.creatorAddress)
            : '',
          mdCode(tx.signature),
        ])
      )
    );
  if (rows.length > listed.length)
    out.push(
      '',
      String(
        t(`${R}.evidence_cut`, {
          shown: formatCount(listed.length, language),
          total: formatCount(rows.length, language),
        })
      )
    );
  if (orders.length)
    out.push(
      '',
      String(
        t(`${R}.orders`, {
          list: orders.map(mdCode).join(', '),
        })
      )
    );
  return out;
}

/** The whole report, as Markdown, in the viewer's language. */
export function accountReportMarkdown(
  data: ReportData,
  t: TFunction,
  language: string
): string {
  return [
    ...headerLines(data, t, language),
    ...accountLines(data, t, language),
    ...qortLines(data, t, language),
    ...activityLines(data, t, language),
    ...connectionLines(data, t, language),
    ...readLines(data, t, language),
    ...evidenceLines(data, t, language),
    '',
  ].join('\n');
}

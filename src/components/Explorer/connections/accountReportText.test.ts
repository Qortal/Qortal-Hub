import { describe, expect, it } from 'vitest';
import i18n from '../../../i18n/i18n';
import { EVIDENCE_MAX } from '../../../lib/explorer/accountReport';
import { ACCOUNT_HISTORY_MAX } from '../../../lib/explorer/accountTx';
import { linksOf } from '../../../lib/explorer/connections';
import {
  recordedFindings,
  siblingsSentence,
  type Finding,
} from '../../../lib/explorer/findings';
import { flowsOf } from '../../../lib/explorer/money';
import { qortBook } from '../../../lib/explorer/qortBook';
import type { TxRow } from '../../../lib/explorer/reads';
import { accountReportMarkdown, type ReportData } from './accountReportText';

// The Account report's text: the same headings every time, facts only,
// times in UTC, never a whole-history figure from part of it, and every
// part that couldn't be read (or was still being read) named.

const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const SPONSOR = `Q${'N'.repeat(33)}`;
const MADE = Date.UTC(2026, 10, 22, 14, 3);
const UNIT = 100_000_000n;
const t = i18n.getFixedT('en');

let n = 0;
/** A signature of its own for each transaction (88 characters). */
const sig = () => `s${String((n += 1)).padStart(8, '0')}`.padEnd(88, 'f');
function tx(
  type: string,
  height: number,
  extra: Record<string, unknown> = {}
): TxRow {
  return {
    type,
    timestamp: Date.UTC(2026, 0, 1) + height * 60_000,
    signature: sig(),
    fee: '0.01000000',
    txGroupId: 0,
    blockHeight: height,
    approvalStatus: 'NOT_REQUIRED',
    ...extra,
  } as TxRow;
}

const paid = tx('PAYMENT', 100, {
  creatorAddress: SECOND,
  recipient: PUBLISHER,
  amount: '5.00000000',
});
const sent = tx('PAYMENT', 200, {
  creatorAddress: PUBLISHER,
  recipient: SECOND,
  amount: '2.00000000',
});
const ROWS = [sent, paid];

function report(over: Partial<ReportData> = {}): ReportData {
  const flowsSent = flowsOf(ROWS, PUBLISHER, 'sent');
  const flowsReceived = flowsOf(ROWS, PUBLISHER, 'received');
  const book = qortBook(ROWS, PUBLISHER);
  return {
    address: PUBLISHER,
    madeAt: MADE,
    account: {
      address: PUBLISHER,
      reference: null,
      publicKey: 'k'.repeat(44),
      level: 5,
      blocksMinted: 1_000,
      blocksMintedAdjustment: 0,
      blocksMintedPenalty: 0,
    },
    primary: { state: 'ready', value: 'Publisher' },
    names: {
      state: 'ready',
      value: { names: ['Publisher', 'Spare'], truncated: false },
    },
    groups: {
      state: 'ready',
      value: [
        {
          groupId: 694,
          groupName: 'MINTER',
          owner: null,
          isOpen: false,
          memberCount: 600,
          isAdmin: true,
          created: null,
          description: null,
        },
      ],
    },
    online: { state: 'ready', value: [] },
    firstSeen: {
      state: 'ready',
      value: {
        height: 100,
        timestamp: paid.timestamp,
        signature: paid.signature,
      },
    },
    balance: { state: 'ready', value: 12_345_000_000n },
    history: { state: 'whole', held: 2 },
    qort: {
      minted: {
        kind: 'value',
        atomic: 50n * UNIT,
        balance: 12_345_000_000n,
        book,
        orders: 0n,
      },
      book,
      trades: { state: 'ready', value: { bought: 0n, sold: 0n, sales: [] } },
    },
    rows: ROWS,
    findings: recordedFindings({
      address: PUBLISHER,
      sent: flowsSent,
      received: flowsReceived,
    }),
    flowsSent: { state: 'ready', value: flowsSent },
    flowsReceived: { state: 'ready', value: flowsReceived },
    funding: { state: 'ready', value: null },
    siblings: { state: 'ready', value: null },
    exchanges: { state: 'ready', value: { flows: [], exact: true } },
    tradesLeftOut: 0,
    empty: ['level_moves'],
    soFar: [],
    coverage: ['Read: all 2 of its payments and asset transfers.'],
    failed: [],
    pending: [],
    tagsOf: () => [],
    nameOf: (address) => (address === SECOND ? 'Second' : null),
    ...over,
  };
}

const make = (over: Partial<ReportData> = {}) =>
  accountReportMarkdown(report(over), t, 'en');

/** The lines of one `## ` part of the report. */
function part(text: string, heading: string): string {
  const lines = text.split('\n');
  const at = lines.indexOf(heading);
  expect(at).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, i) => i > at && /^## /.test(line));
  return lines.slice(at, end < 0 ? undefined : end).join('\n');
}
const headings = (text: string) =>
  text.split('\n').filter((line) => /^#{1,2} /.test(line));

const HEADINGS = [
  '# Account report: Publisher',
  '## Account',
  '## QORT totals',
  '## Activity by type',
  '## Connections',
  '## What was read',
  '## Transactions behind the connections',
];

describe('the Account report', () => {
  it('has the same headings every time, in order: whole, partial, failed, still being read', () => {
    expect(headings(make())).toEqual(HEADINGS);
    expect(
      headings(
        make({
          history: { state: 'waiting', held: 300 },
          qort: null,
          rows: null,
        })
      )
    ).toEqual(HEADINGS);
    expect(
      headings(
        make({
          history: { state: 'failed', held: 0 },
          qort: null,
          rows: null,
          findings: [],
          flowsSent: { state: 'failed' },
          flowsReceived: { state: 'failed' },
          failed: ['history', 'payments'],
        })
      )
    ).toEqual(HEADINGS);
    expect(
      headings(
        make({
          primary: { state: 'reading' },
          history: { state: 'reading', held: 0 },
          qort: null,
          rows: null,
          pending: ['history', 'primary'],
        })
      ).slice(1)
    ).toEqual(HEADINGS.slice(1));
  });

  it('writes its facts as tables, times in UTC, addresses and signatures whole', () => {
    const text = make();
    expect(text).toContain(`| Address | \`${PUBLISHER}\` |`);
    expect(text).toContain('| Made | 2026-11-22 14:03 UTC |');
    expect(text).toContain('| Balance | 123.45 QORT |');
    expect(text).toContain(
      '| MINTER (group 694) | Minter Admin and MINTER member. |'
    );
    expect(text).toContain('| Minting now | Not minting right now. |');
    expect(text).toContain('| Names | 2: Publisher, Spare |');
    expect(text).toContain('| Groups | 1: MINTER (#694, admin) |');
    expect(text).toContain(
      `| First seen | block 100, ${'2026-01-01 01:40 UTC'}, \`${paid.signature}\` |`
    );
    expect(text).toContain('> Public chain facts, read from a Qortal node.');
  });

  it('adds up its QORT and its activity by type only from its whole history', () => {
    const text = make();
    expect(text).toContain('| QORT minted | 50 QORT |');
    expect(text).toContain('| QORT received / sent | 5 / 2 |');
    expect(text).toContain('| QORT purchased / sold | 0 / 0 |');
    expect(text).toContain('From its whole history: 2 transactions.');
    expect(text).toContain(
      '| Payment | Payments | 2 | 2026-01-01 | 2026-01-01 |'
    );
    // Its newest 300 of more: no figure, and it says how much was read.
    const partial = make({
      history: { state: 'waiting', held: 300 },
      qort: null,
      rows: null,
    });
    expect(partial).not.toMatch(/\| QORT (minted|received)/);
    expect(partial).not.toContain('| Payment | Payments |');
    expect(partial).toContain(
      "These add up its whole history, which wasn't read for this report: its newest 300 transactions; any older ones weren't read."
    );
    expect(partial).toContain(
      "This counts its whole history, which wasn't read for this report: its newest 300 transactions; any older ones weren't read."
    );
  });

  it('says no figure and counts nothing by type from part of its history, whatever it is given', () => {
    const text = make({ history: { state: 'waiting', held: 2 } });
    expect(text).not.toMatch(/\| QORT (minted|received)/);
    expect(text).not.toContain('| Payment | Payments |');
    expect(text).toContain(
      "its newest 2 transactions; any older ones weren't read"
    );
    expect(make({ history: { state: 'ceiling', held: 2 } })).not.toMatch(
      /\| QORT minted/
    );
  });

  it('reads right with exactly one: its only transaction, its newest transaction', () => {
    expect(make({ history: { state: 'whole', held: 1 } })).toContain(
      'its whole history: its only transaction'
    );
    const one = make({
      history: { state: 'waiting', held: 1 },
      qort: null,
      rows: null,
    });
    expect(one).toContain(
      "its newest transaction; any older ones weren't read"
    );
    expect(one).not.toMatch(/newest 1 transaction/);
  });

  it('takes QORT minted from the figures as they stand: never "never minted" from its blocks alone', () => {
    // Its level moved away: no blocks minted now, but the bookkeeping found what it minted.
    const text = make({
      account: {
        ...report().account,
        level: 0,
        blocksMinted: 0,
        blocksMintedAdjustment: 0,
      },
    });
    expect(text).toContain('| QORT minted | 50 QORT |');
    expect(text).not.toContain('never minted');
  });

  it('an account without a public key bought what trade contracts paid it, and sold nothing', () => {
    const contract = `A${'X'.repeat(33)}`;
    const bought = tx('AT', 300, {
      atAddress: contract,
      recipient: PUBLISHER,
      amount: '10.00000000',
    });
    const book = qortBook([bought], PUBLISHER);
    const text = make({
      account: { ...report().account, publicKey: null },
      qort: {
        minted: { kind: 'never' },
        book,
        trades: null,
      },
    });
    expect(text).toContain('| QORT purchased / sold | 10 / 0 |');
    expect(text).toContain('It has never made a transaction of its own');
    expect(text).toContain(
      '| Public key | none yet: it has never made a transaction of its own |'
    );
  });

  it('names what couldn’t be read and what was still being read, never as none', () => {
    const text = make({
      findings: [],
      flowsSent: { state: 'failed' },
      flowsReceived: { state: 'failed' },
      empty: [],
      failed: ['payments', 'exchanges'],
      pending: ['groups'],
      groups: { state: 'reading' },
      exchanges: { state: 'failed' },
    });
    expect(text).toContain("Couldn't read its payments and asset transfers.");
    expect(text).not.toContain('No payments');
    expect(text).toContain(
      "- Couldn't be read: its payments and asset transfers and its payments to and from exchanges."
    );
    expect(text).toContain(
      '- Still being read when the report was made: its groups.'
    );
    expect(text).toContain('| Groups | still being read |');
    expect(text).toContain("Couldn't read its payments to and from exchanges.");
  });

  it('lists each connection with its block, day and whole signature, payments as tables', () => {
    const level = tx('TRANSFER_PRIVS', 50, { creatorAddress: SECOND });
    const findings = [
      ...recordedFindings({
        address: PUBLISHER,
        links: {
          levelMoves: [
            {
              direction: 'from',
              other: SECOND,
              ref: {
                height: 50,
                timestamp: level.timestamp,
                signature: level.signature,
              },
              tx: level,
            },
          ],
          sponsors: [],
          sponsees: [],
          activeShares: [],
          nameDeals: [],
        },
        levels: { [SECOND]: 0 },
      }),
      ...report().findings,
    ];
    const text = make({
      findings,
      tagsOf: (finding) =>
        finding.kind === 'levelMove' ? ['now level 0'] : [],
    });
    expect(text).toContain(
      `- Got its minting level from Second (\`${SECOND}\`) (block 50, 2026-01-01, \`${level.signature}\`) · now level 0`
    );
    expect(text).toContain('#### Received from');
    expect(text).toContain(
      `| \`${SECOND}\` | Second | 1 | 5 |  | 2026-01-01 | 2026-01-01 |`
    );
    expect(text).toContain('Also checked, nothing found: level moves.');
    expect(text).toContain(`| \`${paid.signature}\` |`);
  });

  it('keeps a name from the chain as written: never a link or a table cell of its own', () => {
    const text = make({
      nameOf: (address) =>
        address === SECOND ? '[Second](https://example.test) | x' : null,
    });
    expect(text).toContain('\\[Second\\](https\\://example\\.test) \\| x');
    expect(text).not.toContain('](https://');
  });

  it('lists at most EVIDENCE_MAX transactions behind the connections, and says so', () => {
    const many = Array.from({ length: EVIDENCE_MAX + 5 }, (_, i) =>
      tx('PAYMENT', 1_000 + i, {
        creatorAddress: SECOND,
        recipient: PUBLISHER,
        amount: '1',
      })
    );
    const finding = {
      ...recordedFindings({
        address: PUBLISHER,
        received: flowsOf(many, PUBLISHER, 'received'),
      })[0],
    } as Finding;
    const text = make({ findings: [finding] });
    expect(text).toContain('The newest 2,000 of 2,005 are listed.');
  });

  it('with a history longer than the Explorer reads, never tells the reader to read the rest', () => {
    const text = make({
      history: { state: 'ceiling', held: ACCOUNT_HISTORY_MAX },
      qort: null,
      rows: null,
    });
    for (const heading of ['## QORT totals', '## Activity by type']) {
      const said = part(text, heading);
      // Why there are none: the Explorer reads no further.
      expect(said).toContain("the Explorer doesn't read in full");
      expect(said).toContain('past the 20,000 the Explorer reads');
      // So reading the rest can't give them.
      expect(said).not.toMatch(/read the rest/i);
    }
  });

  it('says why there are no totals by how its history stood: “Read the rest” only where it can give them', () => {
    const reason = (history: ReportData['history']) =>
      part(make({ history, qort: null, rows: null }), '## QORT totals');
    // Read in part: reading on gives them.
    expect(reason({ state: 'waiting', held: 300 })).toMatch(/Read the rest/);
    // Its transactions couldn't be read: said so, never "read the rest".
    const failed = reason({ state: 'failed', held: 0 });
    expect(failed).toContain(
      "These add up its whole history, which couldn't be read in full for this report: its transactions couldn't be read."
    );
    expect(failed).not.toMatch(/read the rest/i);
    expect(reason({ state: 'failed', held: 300 })).not.toMatch(
      /read the rest/i
    );
    // Still being read: it was, when the report was made.
    const reading = reason({ state: 'reading', held: 200 });
    expect(reading).toContain('which was still being read');
    expect(reading).not.toMatch(/read the rest/i);
  });

  it('with its newest transactions being read again, never says “its whole history” over them', () => {
    const text = make({
      history: { state: 'refreshing', held: 2 },
      pending: ['newest', 'minted'],
    });
    // Not from the list read before: it may have newer ones.
    expect(text).not.toMatch(/\| QORT (minted|received)/);
    expect(text).not.toContain('| Payment | Payments |');
    expect(text).not.toContain('its whole history: 2 transactions');
    expect(text).toContain(
      '| Its transactions read | 2 transactions read; its newest were being read again |'
    );
    expect(part(text, '## QORT totals')).toContain(
      'which was still being read when the report was made'
    );
    expect(text).toContain(
      'Still being read when the report was made: its newest transactions and QORT minted.'
    );
  });

  it('a name at the start of a list line stays text, never a heading or a list of its own, in every language', () => {
    // A name that would start a block, in the lines that can start with
    // one: "Also sponsored by …" (Spanish and others put the sponsor
    // first) and its sponsor's reward share (Japanese and others).
    const names = ['# Sponsor', '1. Sponsor', '+ Sponsor', '- Sponsor', '---'];
    const sponsorShare = tx('REWARD_SHARE', 100, {
      creatorAddress: SPONSOR,
      recipient: PUBLISHER,
      sharePercent: '0.00',
    });
    /** A line's start, after its own list marker, that would begin a block. */
    const BLOCK =
      /^(#{1,6}(\s|$)|[-+*](\s|$)|\d{1,9}[.)](\s|$)|>|`{3}|~{3}|=+\s*$|-{3,}\s*$|\s{4})/;
    for (const language of [
      'ar',
      'de',
      'en',
      'es',
      'et',
      'fi',
      'fr',
      'it',
      'ja',
      'pt',
      'ru',
      'zh',
    ])
      for (const name of names) {
        const text = accountReportMarkdown(
          report({
            siblings: {
              state: 'ready',
              value: {
                sentence: siblingsSentence(SPONSOR, 3, false),
                first: Date.UTC(2026, 0, 2),
                last: Date.UTC(2026, 0, 3),
              },
            },
            findings: recordedFindings({
              address: PUBLISHER,
              links: linksOf([sponsorShare], PUBLISHER),
            }),
            nameOf: (address) => (address === SPONSOR ? name : null),
          }),
          i18n.getFixedT(language),
          language
        );
        const lines = text.split('\n');
        // No heading of its own: the report's own headings only.
        expect(
          lines.filter((line) => /^#/.test(line) && line.includes('Sponsor')),
          `${language} ${name}`
        ).toEqual([]);
        for (const line of lines.filter((each) => each.startsWith('- ')))
          expect(line.slice(2), `${language} ${name}`).not.toMatch(BLOCK);
        // The name itself is there, escaped.
        expect(text, `${language} ${name}`).toContain(
          `${name.startsWith('#') ? '\\#' : name.startsWith('1.') ? '1\\.' : `\\${name[0]}`}${name.slice(name.startsWith('1.') ? 2 : 1)}`
        );
      }
  });

  it('keeps chain text plain in its title and lines: a closing #, an entity, an email', () => {
    const text = make({
      primary: { state: 'ready', value: 'Publisher #' },
      nameOf: (address) =>
        address === SECOND ? 'Tom &amp; second@example.com' : null,
    });
    expect(text.split('\n')[0]).toBe('# Account report: Publisher \\#');
    expect(text).toContain('Tom \\&amp; second@example\\.com');
    expect(text).not.toContain('second@example.com');
  });

  it('adds no verdict: only the Explorer’s own sentences', () => {
    expect(make()).not.toMatch(
      /suspicious|fraud|alt account|same person|likely/i
    );
  });
});

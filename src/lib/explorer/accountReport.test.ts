import { describe, expect, it } from 'vitest';
import {
  mdCell,
  mdCode,
  mdTable,
  mdText,
  onceNewestFirst,
  reportFileName,
  typeCounts,
  utcDay,
  utcTime,
} from './accountReport';
import type { TxRow } from './reads';

// The Account report's building blocks: UTC times, Markdown that text
// from the chain can't break, file names and the counts by type.

const row = (
  signature: string,
  type: string,
  timestamp: number,
  blockHeight = 1
): TxRow => ({ signature, type, timestamp, blockHeight }) as unknown as TxRow;

describe('the Account report’s building blocks', () => {
  it('writes every time in UTC, the same in every language and time zone', () => {
    const zone = process.env.TZ;
    // A time zone 14 hours ahead: 23:30 on the 21st in UTC is the 22nd there.
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      const at = Date.UTC(2026, 10, 21, 23, 30);
      expect(new Date(at).getDate()).toBe(22);
      expect(utcTime(at)).toBe('2026-11-21 23:30 UTC');
      expect(utcDay(at)).toBe('2026-11-21');
      expect(utcTime(Date.UTC(2026, 0, 2, 3, 4))).toBe('2026-01-02 03:04 UTC');
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it('keeps text from the chain from turning into Markdown: no links, no code, no table cells', () => {
    expect(mdText('[here](https://example.test)')).toBe(
      '\\[here\\](https\\://example\\.test)'
    );
    expect(mdText('www.example.test')).toBe('www\\.example\\.test');
    expect(mdText('a | b')).toBe('a \\| b');
    expect(mdText('`x` *y* _z_ <b>')).toBe('\\`x\\` \\*y\\* \\_z\\_ \\<b\\>');
    expect(mdText('two\nlines')).toBe('two lines');
    // Plain names read as written.
    expect(mdText('Second Account 2')).toBe('Second Account 2');
  });

  it('never lets text from the chain start a block, wherever a line puts it', () => {
    // A heading, a list, a quote, a break, a setext line, code by indent.
    expect(mdText('# Sponsor')).toBe('\\# Sponsor');
    expect(mdText('### Sponsor')).toBe('\\#\\#\\# Sponsor');
    expect(mdText('1. Sponsor')).toBe('1\\. Sponsor');
    expect(mdText('12) Sponsor')).toBe('12\\) Sponsor');
    expect(mdText('+ Sponsor')).toBe('\\+ Sponsor');
    expect(mdText('- Sponsor')).toBe('\\- Sponsor');
    expect(mdText('* Sponsor')).toBe('\\* Sponsor');
    expect(mdText('> Sponsor')).toBe('\\> Sponsor');
    expect(mdText('---')).toBe('\\---');
    expect(mdText('===')).toBe('\\===');
    expect(mdText('    Sponsor')).toBe('Sponsor');
    expect(mdText('```js')).toBe('\\`\\`\\`js');
    // A number is no list marker without its space: an amount reads as written.
    expect(mdText('1.5 QORT')).toBe('1.5 QORT');
    expect(mdText('2026-11-22')).toBe('2026-11-22');
  });

  it('keeps text from the chain plain where renderers would change it: autolinks, entities, a closing #', () => {
    // Email- and domain-shaped names: never a link.
    expect(mdText('alice@example.com')).toBe('alice@example\\.com');
    expect(mdText('shop.example.org')).toBe('shop\\.example\\.org');
    expect(mdText('http://example.com')).toBe('http\\://example\\.com');
    // An entity stays the characters it is written with.
    expect(mdText('Tom &amp; Jerry')).toBe('Tom \\&amp; Jerry');
    // A heading's closing " #" would drop off a title.
    expect(mdText('Name #')).toBe('Name \\#');
    // GitHub's math.
    expect(mdText('$x$')).toBe('\\$x\\$');
    // A name with a dot that isn't a domain's, and plain words, as written.
    expect(mdText('v1.2')).toBe('v1.2');
    expect(mdText('Ünïcode Ñame')).toBe('Ünïcode Ñame');
  });

  it('puts a value in a table cell on one line, its pipes escaped once', () => {
    expect(mdCell('a|b\nc')).toBe('a\\|b c');
    expect(mdCell(mdText('a|b'))).toBe('a\\|b');
    expect(mdTable(['A', 'B'], [['1', 'x|y']])).toEqual([
      '| A | B |',
      '| --- | --- |',
      '| 1 | x\\|y |',
    ]);
    expect(mdCode(`Q${'P'.repeat(33)}`)).toBe(`\`Q${'P'.repeat(33)}\``);
  });

  it('names its file after the account and the day: letters and digits of any script, - and _', () => {
    const at = Date.UTC(2026, 10, 22, 9);
    expect(reportFileName('account-report', 'Publisher', at)).toBe(
      'account-report-Publisher-2026-11-22.md'
    );
    expect(reportFileName('account-report', 'Ünïcode Ñame+1', at)).toBe(
      'account-report-Ünïcode-Ñame-1-2026-11-22.md'
    );
    expect(reportFileName('отчёт-о-счёте', 'Второй', at)).toBe(
      'отчёт-о-счёте-Второй-2026-11-22.md'
    );
    // No folders, no hidden files, nothing a file system reads otherwise.
    expect(reportFileName('account-report', '../../x/.y\u0000', at)).toBe(
      'account-report-x-y-2026-11-22.md'
    );
    expect(reportFileName('', '...', at)).toBe(
      'account-report-account-2026-11-22.md'
    );
    expect(
      reportFileName('account-report', 'n'.repeat(200), at).length
    ).toBeLessThan(90);
  });

  it('counts each type once per transaction, the most first, with its first and last', () => {
    const rows = [
      row('a', 'PAYMENT', 30, 3),
      row('b', 'PAYMENT', 10, 1),
      row('b', 'PAYMENT', 10, 1),
      row('c', 'REWARD_SHARE', 20, 2),
    ];
    expect(typeCounts(rows)).toEqual([
      { type: 'PAYMENT', count: 2, first: 10, last: 30 },
      { type: 'REWARD_SHARE', count: 1, first: 20, last: 20 },
    ]);
    expect(onceNewestFirst(rows).map((tx) => tx.signature)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });
});

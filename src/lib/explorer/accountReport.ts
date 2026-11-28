/**
 * The Account report's building blocks (from Q-Mintership+'s
 * rules/explorer/accountReport.ts), pure: no reads, no text. The report
 * itself, in the viewer's language, is
 * components/Explorer/connections/accountReportText.ts.
 *
 * - Every time in UTC, the same way in every language ("2026-11-22 14:03
 *   UTC"), so reports read and compare alike.
 * - Plain Markdown: a table cell has no line breaks and its pipes escaped,
 *   and any text that came from the chain (a name, a group's name, an
 *   asset's) has Markdown's own characters escaped, wherever it starts, so
 *   it reads as written and can't turn into a link, an entity, a heading, a
 *   list or a table of its own (mdText).
 * - The transactions behind the connections, once each, the newest first,
 *   at most EVIDENCE_MAX.
 */
import { newestFirst } from './money';
import type { TxRow } from './reads';

/** "2026-11-22 14:03 UTC". */
export function utcTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate()
  )} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "2026-11-22" (in UTC). */
export const utcDay = (ms: number): string => utcTime(ms).slice(0, 10);

/**
 * The characters that change what text means in Markdown wherever they
 * are: emphasis, code, links, HTML, tables, strikethrough, headings ("#",
 * and a title's closing " #"), entities ("&amp;"), math ("$", on GitHub),
 * and ":", which would let "https://…" become a link. Escaped with a
 * backslash, which CommonMark allows before any ASCII punctuation.
 */
const MARKDOWN = /[\\`*_[\]<>|~:#&$]/g;

/**
 * Text from the chain, as plain text in Markdown, wherever it is put (a
 * list item's start too): on one line, its Markdown escaped, never a link
 * or the start of a block.
 *
 * - White space runs as one space, none at its start (four would start a
 *   code block).
 * - What starts a block at a line's (or a list item's) start: a list
 *   marker ("- ", "+ ", "1. ", "1) ", not "1.5"), a thematic break ("---"),
 *   a setext underline ("="), and with the characters above, a heading, a
 *   quote, a fence, a table, HTML.
 * - What renderers turn into links: "www." and a domain's dots ("example.com",
 *   "name@example.com"); a number's ("1.5") stay.
 */
export function mdText(text: string): string {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/^ /, '')
    .replace(MARKDOWN, (char) => `\\${char}`)
    .replace(/^([-+=])/, '\\$1')
    .replace(/^(\d{1,9})([.)])(?= |$)/, '$1\\$2')
    .replace(/\b(www)\./gi, '$1\\.')
    .replace(/(?<=[\p{L}\p{N}_-])\.(?=\p{L})/gu, '\\.');
}

/** Inline code: an address, a signature, a key (base58, which has no backticks). */
export const mdCode = (text: string): string =>
  `\`${String(text).replace(/`/g, '')}\``;

/** A table cell: no line breaks, pipes escaped. */
export function mdCell(value: string | number): string {
  return String(value)
    .replace(/\r?\n/g, ' ')
    .replace(/(?<!\\)\|/g, '\\|');
}

export function mdTable(
  head: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>
): string[] {
  return [
    `| ${head.map(mdCell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`),
  ];
}

/**
 * A file name: the translated `prefix` ("account-report"), whose account
 * (its name, or its address) and the day, in UTC; letters and digits of
 * any script, "-" and "_" only, at most 60 of them for the account.
 */
export function reportFileName(
  prefix: string,
  who: string,
  madeAt: number
): string {
  const clean = (text: string, max: number) =>
    text
      .normalize('NFKC')
      .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '');
  const start = clean(prefix, 40) || 'account-report';
  const account = clean(who, 60) || 'account';
  return `${start}-${account}-${utcDay(madeAt)}.md`;
}

/** The transactions behind the connections, at most this many listed. */
export const EVIDENCE_MAX = 2000;

/** `rows`, once each by signature, the newest first. */
export function onceNewestFirst(rows: Iterable<TxRow>): TxRow[] {
  const seen = new Map<string, TxRow>();
  for (const tx of rows)
    if (!seen.has(tx.signature)) seen.set(tx.signature, tx);
  return [...seen.values()].sort(newestFirst);
}

export interface TypeCount {
  type: string;
  count: number;
  /** Its oldest and newest, by time. */
  first: number;
  last: number;
}

/** How many of `rows` there are of each type, the most first (ties by type); each signature once. */
export function typeCounts(rows: readonly TxRow[]): TypeCount[] {
  const by = new Map<string, TypeCount>();
  const seen = new Set<string>();
  for (const tx of rows) {
    if (seen.has(tx.signature)) continue;
    seen.add(tx.signature);
    const type = String(tx.type || 'UNKNOWN');
    const entry = by.get(type) ?? {
      type,
      count: 0,
      first: tx.timestamp,
      last: tx.timestamp,
    };
    entry.count += 1;
    entry.first = Math.min(entry.first, tx.timestamp);
    entry.last = Math.max(entry.last, tx.timestamp);
    by.set(type, entry);
  }
  return [...by.values()].sort(
    (a, b) => b.count - a.count || (a.type < b.type ? -1 : 1)
  );
}

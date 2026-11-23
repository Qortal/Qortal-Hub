import { sliceText } from './ids';

/**
 * A video's description as the apps store it: `htmlDescription` (what their
 * players show) and `fullDescription` (plain text for lists and search).
 */

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Line endings as `\n`, no trailing spaces, at most one blank line. */
export function normalizeDescription(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Subscreen's text-to-HTML (also valid Quill HTML for Q-Tube's editor):
 * paragraphs on blank lines as escaped `<p>…</p>`, single newlines
 * `<br />`. An empty description is `<p></p>`, as Subscreen stores it.
 */
export function htmlDescription(text: string): string {
  return normalizeDescription(text)
    .split(/\n{2,}/)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`
    )
    .join('');
}

/** Q-Tube's and Q-Share's `fullDescription` cut. */
export const FULL_DESCRIPTION_LENGTH = 150;

/**
 * Plain text of the description, whitespace collapsed, as Q-Tube's
 * extractTextFromHTML makes it from the HTML above (block ends become
 * spaces). `limit` null keeps it whole, as Subscreen does.
 */
export function fullDescription(
  text: string,
  limit: number | null = FULL_DESCRIPTION_LENGTH
): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  return limit == null ? plain : sliceText(plain, limit);
}

/**
 * QDN's description for a Q-Tube-format video (Q-Tube, Subscreen, Torq):
 * `**category:<c>;subcategory:<s>;code:<code>**` and 150 characters.
 */
export function qtubeQdnDescription(
  category: number,
  subcategory: number | '' | null | undefined,
  code: string,
  plainText: string
): string {
  return (
    `**category:${category};subcategory:${subcategory ?? ''};code:${code}**` +
    sliceText(plainText, FULL_DESCRIPTION_LENGTH)
  );
}

/**
 * QDN's description for a playlist: the first ten episode codes and 120
 * characters (Q-Tube's and Subscreen's).
 */
export function playlistQdnDescription(
  category: number,
  subcategory: number | '' | null | undefined,
  codes: readonly string[],
  plainText: string
): string {
  const codeList = codes
    .slice(0, 10)
    .map((code) => `c:${code};`)
    .join('');
  return (
    `**category:${category};subcategory:${subcategory ?? ''};${codeList}**` +
    sliceText(plainText, 120)
  );
}

/**
 * Searching rows by what they show (the Connections tab's search): a row
 * is found when every word typed is in its text, ignoring case and
 * accents, and a number typed without its separators ("1200") finds one
 * written with them ("1,200"). Pure.
 */

/** Text as the search compares it: lower case, without accents. */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/** The words of what was typed, folded; none for an empty search. */
export function queryWords(typed: string): string[] {
  return foldText(typed)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

/** Digit groups written together: "1,200" and "1 200" read as "1200". */
const ungrouped = (text: string) =>
  text.replace(/(\d)[,.\s\u00a0\u202f'\u2019](?=\d{3}(?:\D|$))/g, '$1');

/** Whether `text` holds every one of `words` (from queryWords). */
export function textMatches(text: string, words: readonly string[]): boolean {
  if (!words.length) return true;
  const folded = foldText(text);
  const plain = ungrouped(folded);
  return words.every(
    (word) => folded.includes(word) || plain.includes(ungrouped(word))
  );
}

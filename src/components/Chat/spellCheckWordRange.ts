/**
 * Word-range detection in ProseMirror document coordinates.
 *
 * The previous implementation derived offsets from `editor.getText()` and then
 * reused them as document positions. Those are different coordinate systems:
 * `getText()` concatenates text across block boundaries and replaces inline
 * atoms with their text, while document positions also count the boundary
 * tokens of every node. Word offsets computed from one and applied to the other
 * land in the wrong place, which is how replacing `helo` in a bullet item
 * produced `hehello` — and, next to a mention, deleted the mention and the word
 * together.
 *
 * Everything here works on document positions from the start, so there is no
 * conversion to get wrong.
 */

export interface SpellCheckWordRange {
  /** Document position of the first character, inclusive. */
  from: number;
  /** Document position just past the last character, exclusive. */
  to: number;
  word: string;
}

/**
 * One document position range per visible character.
 *
 * Built by walking the document rather than by slicing its text, because only
 * the walk knows where each character actually sits.
 */
export interface SpellCheckCharRun {
  from: number;
  to: number;
  char: string;
}

/** Placeholder for a non-text leaf node (a mention, an image). */
export const LEAF_PLACEHOLDER = '\uFFFC';

/**
 * True for a character that can be part of a word.
 *
 * Unicode-aware: `\w` is ASCII-only, so Cyrillic, Greek, accented Latin and
 * every other non-Latin script got no suggestions at all. Marks are included so
 * combining accents stay attached to their base letter.
 */
export function isWordCharacter(char: string | undefined): boolean {
  if (!char) return false;
  // A leaf placeholder is a mention or an image, never part of a word.
  if (char === LEAF_PLACEHOLDER) return false;
  return /[\p{L}\p{N}\p{M}]/u.test(char);
}

/**
 * Finds the word covering `position` in a run list, or null when there is none.
 *
 * A document position sits *before* the character it indexes, so a click on the
 * right half of a glyph reports the position after it. Both neighbours are
 * therefore considered: the character at the position first, then the one
 * before it. Without that, clicking just inside a word's last letter selected
 * the following word, and clicking just before a word's first letter selected
 * the previous one.
 */
export function findWordAtPosition(
  runs: readonly SpellCheckCharRun[],
  position: number
): SpellCheckWordRange | null {
  if (runs.length === 0) return null;

  const indexAt = runs.findIndex(
    (run) => position >= run.from && position < run.to
  );
  const indexBefore = runs.findIndex(
    (run) => position > run.from && position <= run.to
  );

  let index = -1;
  if (indexAt >= 0 && isWordCharacter(runs[indexAt].char)) {
    index = indexAt;
  } else if (indexBefore >= 0 && isWordCharacter(runs[indexBefore].char)) {
    index = indexBefore;
  }
  if (index < 0) return null;

  let start = index;
  while (start > 0 && isWordCharacter(runs[start - 1].char)) {
    start -= 1;
  }
  let end = index;
  while (end < runs.length - 1 && isWordCharacter(runs[end + 1].char)) {
    end += 1;
  }

  // Expansion stops at a leaf placeholder because isWordCharacter rejects it, so
  // the word on either side of a mention stays separate. Absorbing the mention
  // into the range is what deleted it on replacement.
  return {
    from: runs[start].from,
    to: runs[end].to,
    word: runs
      .slice(start, end + 1)
      .map((run) => run.char)
      .join(''),
  };
}

/**
 * Minimal shape of the editor pieces this module needs, so the walk can be
 * tested without constructing a real Tiptap instance.
 */
export interface SpellCheckDocLike {
  content: { size: number };
  nodesBetween: (
    from: number,
    to: number,
    f: (
      node: {
        isText: boolean;
        isLeaf: boolean;
        nodeSize: number;
        text?: string | null;
      },
      pos: number
    ) => boolean | void
  ) => void;
}

/**
 * Builds the character runs for the textblock containing `position`.
 *
 * Restricted to that textblock so a word never spans two paragraphs, which the
 * flattened `getText()` could not distinguish.
 */
export function buildCharRunsInTextblock(
  doc: SpellCheckDocLike,
  textblockStart: number,
  textblockEnd: number
): SpellCheckCharRun[] {
  const runs: SpellCheckCharRun[] = [];
  doc.nodesBetween(textblockStart, textblockEnd, (node, nodeStart) => {
    if (node.isText) {
      const text = node.text ?? '';
      for (let i = 0; i < text.length; i += 1) {
        runs.push({
          from: nodeStart + i,
          to: nodeStart + i + 1,
          char: text[i],
        });
      }
      // Text carries no children worth descending into.
      return false;
    }
    if (node.isLeaf) {
      runs.push({
        from: nodeStart,
        to: nodeStart + node.nodeSize,
        char: LEAF_PLACEHOLDER,
      });
      return false;
    }
    return undefined;
  });
  return runs;
}

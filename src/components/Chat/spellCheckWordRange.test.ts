import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import {
  buildCharRunsInTextblock,
  findWordAtPosition,
  isWordCharacter,
  type SpellCheckWordRange,
} from './spellCheckWordRange';

/**
 * Mirrors what the context menu does: resolve the word at a document position,
 * then replace exactly that range. Using the real editor keeps the document
 * positions honest — a fixture could encode the same wrong assumption as the
 * code under test.
 */
function editorWith(content: string): Editor {
  return new Editor({
    extensions: [StarterKit, Mention.configure({ suggestion: {} as never })],
    content,
  });
}

/** Position immediately after the first occurrence of `text`. */
function positionAfter(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text?.includes(text)) {
      found = pos + (node.text.indexOf(text) ?? 0) + text.length;
      return false;
    }
    return undefined;
  });
  return found;
}

function wordAt(editor: Editor, position: number): SpellCheckWordRange | null {
  const resolved = editor.state.doc.resolve(position);
  let depth = resolved.depth;
  while (depth > 0 && !resolved.node(depth).isTextblock) depth -= 1;
  const textblock = resolved.node(depth);
  const start = resolved.before(depth) + 1;
  const runs = buildCharRunsInTextblock(
    editor.state.doc,
    start,
    start + textblock.content.size
  );
  return findWordAtPosition(runs, position);
}

/** First document position whose enclosing textblock starts with `text`. */
function positionInParagraphStartingWith(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.forEach((node, offset) => {
    if (found >= 0) return;
    if (node.textContent.startsWith(text)) found = offset + 2;
  });
  return found;
}

/** The same chain the context menu's replaceWord uses. */
function replaceRange(
  editor: Editor,
  range: SpellCheckWordRange,
  word: string
) {
  editor
    .chain()
    .focus()
    .setTextSelection({ from: range.from, to: range.to })
    .deleteSelection()
    .insertContent(word)
    .run();
}

describe('isWordCharacter', () => {
  it('accepts non-Latin letters', () => {
    // `\w` is ASCII-only, so these got no suggestions at all before.
    expect(isWordCharacter('д')).toBe(true);
    expect(isWordCharacter('λ')).toBe(true);
    expect(isWordCharacter('é')).toBe(true);
    expect(isWordCharacter('日')).toBe(true);
  });

  it('rejects punctuation, whitespace and leaves', () => {
    expect(isWordCharacter(' ')).toBe(false);
    expect(isWordCharacter('.')).toBe(false);
    expect(isWordCharacter('\uFFFC')).toBe(false);
    expect(isWordCharacter(undefined)).toBe(false);
  });
});

describe('replacing a misspelled word', () => {
  it('replaces a word in a plain paragraph', () => {
    const editor = editorWith('<p>helo there</p>');
    try {
      const range = wordAt(editor, positionAfter(editor, 'helo'));
      expect(range?.word).toBe('helo');
      replaceRange(editor, range!, 'hello');
      expect(editor.getText()).toBe('hello there');
    } finally {
      editor.destroy();
    }
  });

  it('replaces a word in a bullet list item', () => {
    const editor = editorWith(
      '<ul><li><p>first item</p></li><li><p>helo world</p></li></ul>'
    );
    try {
      const range = wordAt(editor, positionAfter(editor, 'helo'));
      expect(range?.word).toBe('helo');
      replaceRange(editor, range!, 'hello');

      // This is the case that produced "hehello": the flattened-text offset was
      // applied as a document position, so the replacement started one
      // character too late.
      expect(editor.getText()).toContain('hello world');
      expect(editor.getText()).not.toContain('hehello');
    } finally {
      editor.destroy();
    }
  });

  it('replaces a word in a numbered list item', () => {
    const editor = editorWith(
      '<ol><li><p>helo first</p></li><li><p>second</p></li></ol>'
    );
    try {
      const range = wordAt(editor, positionAfter(editor, 'helo'));
      replaceRange(editor, range!, 'hello');
      expect(editor.getText()).toContain('hello first');
      expect(editor.getText()).not.toContain('hehello');
    } finally {
      editor.destroy();
    }
  });

  it('replaces a word in a second paragraph without touching the first', () => {
    const editor = editorWith('<p>alpha helo</p><p>helo beta</p>');
    try {
      // Resolve through the same path the context menu uses, inside the second
      // paragraph, so the confined textblock is the thing under test.
      const position = positionInParagraphStartingWith(editor, 'helo beta');
      const range = wordAt(editor, position);
      expect(range?.word).toBe('helo');
      replaceRange(editor, range!, 'hello');

      // Compare paragraph contents: getText() joins blocks with a blank line,
      // which is serialisation detail and not what this test is about.
      const paragraphs: string[] = [];
      editor.state.doc.forEach((node) => {
        paragraphs.push(node.textContent);
      });
      expect(paragraphs).toEqual(['alpha helo', 'hello beta']);
    } finally {
      editor.destroy();
    }
  });

  it('does not delete a mention that precedes the word', () => {
    const editor = editorWith(
      '<p><span data-type="mention" data-id="member" data-label="member"></span> helo now</p>'
    );
    try {
      const range = wordAt(editor, positionAfter(editor, 'helo'));
      expect(range?.word).toBe('helo');
      replaceRange(editor, range!, 'hello');

      // Before, the range reached back over the mention and both the mention
      // and the word were deleted.
      expect(editor.getText()).toContain('hello now');
      expect(editor.getText()).not.toContain('wrong');
      expect(
        editor
          .getJSON()
          .content?.[0]?.content?.some(
            (node: { type: string }) => node.type === 'mention'
          )
      ).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it('replaces a non-Latin word', () => {
    const editor = editorWith('<p>привет мир</p>');
    try {
      // The word must be detected at all; `\w` matched nothing here before.
      const range = wordAt(editor, positionAfter(editor, 'привет'));
      expect(range?.word).toBe('привет');
      replaceRange(editor, range!, 'пока');
      expect(editor.getText()).toBe('пока мир');
    } finally {
      editor.destroy();
    }
  });
});

describe('clicking near a word boundary', () => {
  it('selects the word when the click is just inside its last letter', () => {
    const editor = editorWith('<p>helo there</p>');
    try {
      // A position sits *before* the character it indexes, so clicking the
      // right half of the final "o" reports the position after it.
      const afterWord = positionAfter(editor, 'helo');
      const range = wordAt(editor, afterWord);
      expect(range?.word).toBe('helo');
    } finally {
      editor.destroy();
    }
  });

  it('selects the following word, not the previous one, at a word start', () => {
    const editor = editorWith('<p>alpha beta</p>');
    try {
      // Immediately before "beta", which is where a click just inside its
      // first letter reports. The old code shifted back two characters and
      // selected "alpha" instead.
      const startOfBeta = positionAfter(editor, 'alpha ');
      const range = wordAt(editor, startOfBeta);
      expect(range?.word).toBe('beta');
    } finally {
      editor.destroy();
    }
  });
});

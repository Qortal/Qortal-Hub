import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text kept for screen readers only sits in a clipped 1 px box. In MUI's sx a
// number from 0 to 1 is a share of the parent (1 = 100 %) and a margin number
// is theme spacing (-1 = -8 px), so these sizes are written in px: a box as
// big as its parent makes the page around it wider or taller than it looks.
const srcDir = resolve(__dirname, '../../..');

const sources = readdirSync(srcDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => resolve(entry.parentPath, entry.name))
  .filter(
    (file) =>
      /\.tsx?$/.test(file) &&
      !/\.test\.tsx?$/.test(file) &&
      !file.split(sep).includes('__tests__')
  );

/** The `{ ... }` around `at`, or null when the braces don't close. */
const objectAround = (text: string, at: number) => {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i -= 1) {
    if (text[i] === '}') depth += 1;
    else if (text[i] === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

const HIDDEN_BOX = /\bclip:\s*['"]rect\(0|\bclipPath:\s*['"]inset\(50%/g;
const SIZE_AS_NUMBER =
  /\b(width|height|minWidth|minHeight|margin|m)\s*:\s*-?(?:[1-9]|0?\.\d)/g;

describe('text kept for screen readers only', () => {
  it('sits in a box sized in px, not in sx numbers', () => {
    let hiddenBoxes = 0;
    const sizedInNumbers = sources.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [...text.matchAll(HIDDEN_BOX)].flatMap((match) => {
        hiddenBoxes += 1;
        const style = objectAround(text, match.index ?? 0) ?? '';
        const line = text.slice(0, match.index).split('\n').length;
        return [...style.matchAll(SIZE_AS_NUMBER)].map(
          (size) => `${relative(srcDir, file)}:${line} ${size[0]}`
        );
      });
    });

    expect(sources.length).toBeGreaterThan(500);
    expect(hiddenBoxes).toBeGreaterThan(0);
    expect(sizedInNumbers).toEqual([]);
  });
});

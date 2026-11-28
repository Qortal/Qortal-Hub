/**
 * JSON laid out as lines of coloured parts, for showing a raw answer:
 * JSON.stringify's two-space layout, each line split into its indent (in
 * steps of two spaces), a key, punctuation and a value, the value marked by
 * its kind (string, number, true/false, null). Pure: the view picks the
 * colours.
 */

export type JsonPartKind =
  | 'key'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'punct';

export interface JsonPart {
  kind: JsonPartKind;
  text: string;
}

export interface JsonLine {
  /** Indent depth (two spaces each). */
  depth: number;
  parts: JsonPart[];
}

// A line of JSON.stringify(…, null, 2): indent, an optional "key": , then
// the rest (a value, a bracket, or both), with a trailing comma.
const LINE = /^( *)(?:("(?:[^"\\]|\\.)*")(: ))?(.*?)(,?)$/;
const STRING = /^"(?:[^"\\]|\\.)*"$/;
const NUMBER = /^-?\d/;

function valueParts(text: string): JsonPart[] {
  if (!text) return [];
  if (STRING.test(text)) return [{ kind: 'string', text }];
  if (text === 'true' || text === 'false') return [{ kind: 'boolean', text }];
  if (text === 'null') return [{ kind: 'null', text }];
  if (NUMBER.test(text)) return [{ kind: 'number', text }];
  // Brackets: "{", "[", "}", "]", or an empty "{}" / "[]".
  return [{ kind: 'punct', text }];
}

/** `value` as JSON lines (two-space indents). */
export function jsonLines(value: unknown): JsonLine[] {
  const text = JSON.stringify(value, null, 2) ?? 'null';
  return text.split('\n').map((line) => {
    const match = LINE.exec(line);
    if (!match) return { depth: 0, parts: [{ kind: 'punct', text: line }] };
    const [, indent, key, colon, rest, comma] = match;
    const parts: JsonPart[] = [];
    if (key)
      parts.push({ kind: 'key', text: key }, { kind: 'punct', text: colon });
    parts.push(...valueParts(rest));
    if (comma) parts.push({ kind: 'punct', text: comma });
    return { depth: indent.length / 2, parts };
  });
}

/** The lines back as text (what Copy copies): JSON.stringify's own layout. */
export function jsonText(lines: readonly JsonLine[]): string {
  return lines
    .map(
      (line) =>
        '  '.repeat(line.depth) + line.parts.map((part) => part.text).join('')
    )
    .join('\n');
}

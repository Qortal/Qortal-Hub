// Intentionally matches invisible and combining security-risk characters:
// the combining marks and format characters it lists are exactly what makes
// a spoofed name look identical to a real one. The rule exists to catch this
// by accident; here it is the whole purpose of the expression.
const INVISIBLE_CHARACTERS_REGEX = new RegExp(
  // eslint-disable-next-line no-misleading-character-class
  String.raw`[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u2000-\u200F\u2028-\u202F\u205F-\u206F\u2800\u3164\uFEFF\uFFA0]`,
  'u'
);

export function hasInvisibleCharacters(str: string) {
  const normalized = str.normalize('NFKC');

  return INVISIBLE_CHARACTERS_REGEX.test(normalized);
}

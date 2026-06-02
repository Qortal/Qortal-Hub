// Intentionally matches invisible and combining security-risk characters.
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE_CHARACTERS_REGEX = new RegExp(
  String.raw`[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u2000-\u200F\u2028-\u202F\u205F-\u206F\u2800\u3164\uFEFF\uFFA0]`,
  'u'
);

export function hasInvisibleCharacters(str: string) {
  const normalized = str.normalize('NFKC');

  return INVISIBLE_CHARACTERS_REGEX.test(normalized);
}

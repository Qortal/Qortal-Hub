export const capitalizeAll = {
  type: 'postProcessor',
  name: 'capitalizeAll',
  process: (value: string) => value.toUpperCase(),
};

export const capitalizeEachFirstChar = {
  type: 'postProcessor',
  name: 'capitalizeEachFirstChar',
  process: (value: string) => {
    if (!value?.trim()) return value;

    const leadingSpaces = value.match(/^\s*/)?.[0] || '';
    const trailingSpaces = value.match(/\s*$/)?.[0] || '';

    const core = value
      .trim()
      .split(/\s+/)
      .map(
        (word) =>
          word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase()
      )
      .join(' ');

    return leadingSpaces + core + trailingSpaces;
  },
};

export const capitalizeFirstChar = {
  type: 'postProcessor',
  name: 'capitalizeFirstChar',
  process: (value: string) => value.charAt(0).toUpperCase() + value.slice(1),
};

export const capitalizeFirstWord = {
  type: 'postProcessor',
  name: 'capitalizeFirstWord',
  process: (value: string) => {
    if (!value?.trim()) return value;

    const trimmed = value.trimStart();
    const firstSpaceIndex = trimmed.indexOf(' ');

    if (firstSpaceIndex === -1) {
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }

    const firstWord = trimmed.slice(0, firstSpaceIndex);
    const restOfString = trimmed.slice(firstSpaceIndex);
    const trailingSpaces = value.slice(trimmed.length);

    return firstWord.toUpperCase() + restOfString + trailingSpaces;
  },
};

/**
 * Uppercases the first Unicode letter of the string, then the first letter after
 * each sentence break: . / ! / ? (possibly repeated, e.g. ?!) followed by whitespace,
 * and the first letter after one or more newlines (for paragraph breaks without prior punctuation).
 * Does not lowercase the rest of the string (unlike capitalizeEachFirstChar).
 *
 * Note: Abbreviations like "e.g. " can still trigger capitalization of the following word.
 */
export const capitalizeSentenceStarts = {
  type: 'postProcessor',
  name: 'capitalizeSentenceStarts',
  process: (value: string) => {
    if (value == null || value === '') return value;

    // First letter of the whole string (skip leading whitespace).
    let result = value.replace(
      /^(\s*)(\p{L})/u,
      (_, leading: string, letter: string) =>
        leading + letter.toLocaleUpperCase()
    );

    // After sentence punctuation + whitespace (includes \n, so ".\nWord" works).
    result = result.replace(
      /([.!?]+)(\s+)(\p{L})/gu,
      (_, punct: string, space: string, letter: string) =>
        punct + space + letter.toLocaleUpperCase()
    );

    // Line/paragraph break without ending .!? on the same fragment (e.g. "one\ntwo").
    result = result.replace(
      /(\n+)(\p{L})/gu,
      (_: string, nl: string, letter: string) =>
        nl + letter.toLocaleUpperCase()
    );

    return result;
  },
};

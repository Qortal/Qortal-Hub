/**
 * The limits Qortal Core applies to a QDN resource's metadata
 * (ArbitraryDataTransactionMetadata): the title and description are cut to
 * 80 and 240 UTF-8 **bytes**, and a tag longer than 20 UTF-16 units (a
 * JavaScript string's `length`) is dropped whole. Applying them while the user
 * types shows what Core will keep: an 80-character Cyrillic title keeps only
 * about 40 characters, and a CJK one about 26.
 */

export const QDN_TITLE_MAX_BYTES = 80;
export const QDN_DESCRIPTION_MAX_BYTES = 240;
export const QDN_TAG_MAX_LENGTH = 20;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** UTF-8 bytes of one code point; a lone surrogate is sent as U+FFFD (3). */
const codePointBytes = (codePoint: number): number => {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
};

export const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (const char of value) bytes += codePointBytes(char.codePointAt(0));
  return bytes;
};

/**
 * `value` cut to at most `maxBytes` UTF-8 bytes, between whole characters
 * (code points), so no character is ever broken in half.
 */
export const truncateUtf8Bytes = (value: string, maxBytes: number): string => {
  let bytes = 0;
  let end = 0;
  for (const char of value) {
    bytes += codePointBytes(char.codePointAt(0));
    if (bytes > maxBytes) break;
    end += char.length;
  }
  return value.slice(0, end);
};

/**
 * `value` cut to at most `maxLength` UTF-16 units without splitting a
 * surrogate pair, and without a trailing half pair left by an earlier cut.
 */
export const truncateUtf16Length = (
  value: string,
  maxLength: number
): string => {
  let result = value.length > maxLength ? value.slice(0, maxLength) : value;
  if (result && isHighSurrogate(result.charCodeAt(result.length - 1))) {
    result = result.slice(0, -1);
  }
  return result;
};

export const limitQdnTitle = (value: string) =>
  truncateUtf8Bytes(value, QDN_TITLE_MAX_BYTES);

export const limitQdnDescription = (value: string) =>
  truncateUtf8Bytes(value, QDN_DESCRIPTION_MAX_BYTES);

export const limitQdnTag = (value: string) =>
  truncateUtf16Length(value, QDN_TAG_MAX_LENGTH);

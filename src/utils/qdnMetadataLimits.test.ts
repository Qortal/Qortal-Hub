import { describe, expect, it } from 'vitest';
import {
  QDN_DESCRIPTION_MAX_BYTES,
  QDN_TITLE_MAX_BYTES,
  limitQdnDescription,
  limitQdnTag,
  limitQdnTitle,
  truncateUtf16Length,
  truncateUtf8Bytes,
  utf8ByteLength,
} from './qdnMetadataLimits';

const bytes = (value: string) => new TextEncoder().encode(value).length;

describe('utf8ByteLength', () => {
  it('counts like TextEncoder', () => {
    for (const value of ['', 'Qortal', 'Привет', '日本語', 'ü', 'a😀b', '🇵🇱']) {
      expect(utf8ByteLength(value)).toBe(bytes(value));
    }
  });
});

describe('truncateUtf8Bytes', () => {
  it('leaves text that fits alone', () => {
    expect(truncateUtf8Bytes('Q-Minter Guide', 80)).toBe('Q-Minter Guide');
    expect(truncateUtf8Bytes('', 80)).toBe('');
  });

  it('cuts by bytes, not characters', () => {
    const cyrillic = 'Ж'.repeat(80);
    expect(truncateUtf8Bytes(cyrillic, 80)).toBe('Ж'.repeat(40));

    const cjk = '漢'.repeat(80);
    expect(truncateUtf8Bytes(cjk, 80)).toBe('漢'.repeat(26));
  });

  it('never breaks a character in half', () => {
    // 79 ASCII bytes + a 2-byte letter: the letter doesn't fit and goes.
    expect(truncateUtf8Bytes(`${'a'.repeat(79)}Ж`, 80)).toBe('a'.repeat(79));
    // An emoji is 4 bytes and 2 UTF-16 units: kept whole or not at all.
    expect(truncateUtf8Bytes(`${'a'.repeat(77)}😀`, 80)).toBe('a'.repeat(77));
    expect(truncateUtf8Bytes(`${'a'.repeat(76)}😀`, 80)).toBe(
      `${'a'.repeat(76)}😀`
    );
  });

  it('always fits the limit', () => {
    for (const value of [
      'Ж'.repeat(200),
      '日本'.repeat(99),
      '😀x'.repeat(60),
    ]) {
      expect(bytes(truncateUtf8Bytes(value, 240))).toBeLessThanOrEqual(240);
    }
  });
});

describe('truncateUtf16Length', () => {
  it('keeps tags of up to 20 units as they are', () => {
    expect(truncateUtf16Length('Node Management', 20)).toBe('Node Management');
    expect(truncateUtf16Length('x'.repeat(20), 20)).toBe('x'.repeat(20));
  });

  it('cuts longer ones without splitting an emoji', () => {
    expect(truncateUtf16Length('x'.repeat(25), 20)).toBe('x'.repeat(20));
    expect(truncateUtf16Length(`${'x'.repeat(19)}😀`, 20)).toBe('x'.repeat(19));
  });

  it('drops a half emoji left by an earlier cut', () => {
    expect(truncateUtf16Length('ab\ud83d', 20)).toBe('ab');
  });
});

describe('the QDN limits', () => {
  it('match what Core keeps', () => {
    expect(bytes(limitQdnTitle('Ж'.repeat(100)))).toBe(QDN_TITLE_MAX_BYTES);
    expect(bytes(limitQdnDescription('Ж'.repeat(200)))).toBe(
      QDN_DESCRIPTION_MAX_BYTES
    );
    expect(limitQdnTag('a'.repeat(30))).toHaveLength(20);
  });
});

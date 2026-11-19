import { describe, expect, it } from 'vitest';
import { isQortPriceQuery } from '../queryIntent';
import { matchGoldenAnswer } from '../goldenMatch';

describe('QORT price honesty', () => {
  it('detects market price asks and their paraphrases', () => {
    for (const q of [
      'what is the price of QORT',
      'how much is QORT',
      'QORT to USD',
      'QORT to LTC',
      'LTC per QORT',
    ]) {
      expect(isQortPriceQuery(q), q).toBe(true);
    }
  });

  it('does not treat definitions or values talk as a price ask', () => {
    expect(isQortPriceQuery('what is QORT')).toBe(false);
    expect(isQortPriceQuery('is QORT priceless')).toBe(false);
  });

  it('answers with the curated FAQ: no invented figures, live offers in Q-Apps', () => {
    const m = matchGoldenAnswer('what is the price of QORT');
    expect(m?.entry.id).toBe('qortal-210');
    const a = m!.entry.a;
    expect(a).toMatch(/LTC/);
    expect(a).toMatch(/Trade Portal|Q-Trade/);
    expect(a).not.toMatch(/QDN (chat|mode)/i);
    expect(a).not.toMatch(/\$\d|usd\s*\d/i);
  });
});

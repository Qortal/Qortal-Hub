import { describe, expect, it } from 'vitest';
import { normalizeQortCoinLanguage } from '../qortCoinLanguage';
import { matchGoldenAnswer } from '../goldenMatch';

describe('normalizeQortCoinLanguage', () => {
  it('rewrites QORT token wording to coin', () => {
    expect(normalizeQortCoinLanguage('QORT is a token on the network.')).toBe(
      'QORT is a coin on the network.'
    );
    expect(normalizeQortCoinLanguage('Hold the QORT token securely.')).toBe(
      'Hold the QORT coin securely.'
    );
    expect(
      normalizeQortCoinLanguage('Mint the native token QORT by contributing.')
    ).toMatch(/native coin QORT/i);
  });
});

describe('golden follow-up isolation', () => {
  it('matches q-apps on the follow-up line, not the prior activity question', () => {
    const folded = 'what can i do on qortal\nFollow-up: what are q-apps';
    const m = matchGoldenAnswer(folded, { minScore: 0.58 });
    expect(m?.entry.id).toBe('qortal-014');
  });

  it('keeps distinct answers for activity vs q-apps', () => {
    expect(matchGoldenAnswer('what can i do on qortal')?.entry.id).toBe(
      'qortal-205'
    );
    expect(matchGoldenAnswer('what are q-apps')?.entry.id).toBe('qortal-014');
  });
});

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

describe('A pack in an answer', () => {
  it('stays a backpack', () => {
    const answer =
      'Keep a whistle, a headlamp and a space blanket in your pack, and check my pack list before you leave.';
    expect(normalizeQortCoinLanguage(answer)).toBe(answer);
  });

  it('stays a backpack in a hiking answer', () => {
    const answer =
      'Keep a headlamp, a water filter and a first-aid kit in your pack.';
    expect(normalizeQortCoinLanguage(answer)).toBe(answer);
  });

  it('stays a backpack when the model talks about its own pack', () => {
    const answer = 'I always carry a spare tarp in my pack when I camp.';
    expect(normalizeQortCoinLanguage(answer)).toBe(answer);
  });

  it("still names a knowledge pack as Qortino's knowledge", () => {
    expect(
      normalizeQortCoinLanguage('This comes from my knowledge pack.')
    ).toBe("This comes from Qortino's on-device knowledge.");
  });
});

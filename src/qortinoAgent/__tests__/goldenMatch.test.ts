import { describe, expect, it } from 'vitest';
import {
  goldenEntryCount,
  lookupGoldenAnswer,
  matchGoldenAnswer,
  rankGoldenAnswers,
} from '../goldenMatch';

describe('matchGoldenAnswer', () => {
  it('loads a full golden set', () => {
    expect(goldenEntryCount()).toBeGreaterThanOrEqual(4500);
    expect(goldenEntryCount()).toBeLessThanOrEqual(6000);
  });

  it('matches core Qortal definition questions', () => {
    const m = matchGoldenAnswer('What is Qortal?');
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThan(0.9);
    expect(m!.entry.a.toLowerCase()).toContain('decentralized');
    // Explaining Qortal should not mention "game" at all.
    expect(m!.entry.a.toLowerCase()).not.toMatch(/\bgame\b/);
  });

  it('matches survival water purification', () => {
    const m = matchGoldenAnswer('How do I purify water by boiling?');
    expect(m).not.toBeNull();
    expect(m!.entry.a.toLowerCase()).toMatch(/boil/);
  });

  it('rejects unrelated small talk', () => {
    expect(matchGoldenAnswer('lol thanks')).toBeNull();
  });

  it('does not confuse herb mint with Qortal minting', () => {
    const m = matchGoldenAnswer('how do I grow mint', { minScore: 0.5 });
    expect(m).not.toBeNull();
    expect(m!.entry.category).toBe('gardening');
    expect(m!.entry.a.toLowerCase()).toMatch(/herb|pot|soil/);
    expect(m!.entry.a.toLowerCase()).not.toMatch(/minting rights/);
  });

  it('answers what is a node as Qortal Core, not book metaphor', () => {
    const m = matchGoldenAnswer('what is a node', { minScore: 0.55 });
    expect(m?.entry.id).toBe('qortal-206');
  });
});

describe('lookupGoldenAnswer', () => {
  it('answers a question worded like a phrasing at once', () => {
    expect(lookupGoldenAnswer('What is Qortal?').instant?.entry.id).toBe(
      'qortal-001'
    );
    expect(lookupGoldenAnswer('what is minting').instant?.entry.id).toBe(
      'qortal-005'
    );
    // Same keywords, different question: "what can I do" is not "what is".
    expect(
      lookupGoldenAnswer('What can I do on Qortal?').instant?.entry.id
    ).toBe('qortal-205');
  });

  it("ignores articles and expands what's", () => {
    expect(lookupGoldenAnswer("what's minting").instant?.entry.id).toBe(
      'qortal-005'
    );
    expect(lookupGoldenAnswer('what is the minting').instant?.entry.id).toBe(
      'qortal-005'
    );
  });

  it('folds plurals but keeps app names and words like "does"', () => {
    expect(lookupGoldenAnswer('what are nodes').instant?.entry.id).toBe(
      'qortal-206'
    );
    expect(lookupGoldenAnswer('how does one mint').instant?.entry.id).toBe(
      'qortal-006'
    );
    const shop = lookupGoldenAnswer('what is q-shop').instant?.entry.id;
    const shops = lookupGoldenAnswer('what is q-shops').instant?.entry.id;
    expect(shop).toBeTruthy();
    expect(shops).toBeTruthy();
    expect(shops).not.toBe(shop);
  });

  it('hands the model hints when no entry clearly wins', () => {
    const look = lookupGoldenAnswer('qortal');
    expect(look.instant).toBeNull();
    expect(look.hints.length).toBeGreaterThan(0);
    expect(look.hints.length).toBeLessThanOrEqual(2);
  });

  it('gives small talk no instant answer', () => {
    for (const q of [
      'lol thanks',
      'hello there',
      'tell me a joke',
      'how are you today',
    ]) {
      expect(lookupGoldenAnswer(q).instant, q).toBeNull();
    }
  });

  it('keeps a + app apart from the original', () => {
    const [top] = rankGoldenAnswers('what is q-mail+', 1);
    expect(top?.entry.q + (top?.entry.aliases || []).join(' ')).toMatch(
      /q-mail\+/i
    );
  });

  it('leaves out entries the caller does not allow', () => {
    const look = lookupGoldenAnswer('What is #QQQ in Playing Qortal?', {
      allow: (entry) => entry.category !== 'philosophy',
    });
    expect(
      [look.instant, ...look.hints].every(
        (m) => m === null || m.entry.category !== 'philosophy'
      )
    ).toBe(true);
  });
});

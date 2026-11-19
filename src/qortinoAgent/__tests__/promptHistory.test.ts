import { describe, expect, it } from 'vitest';
import {
  buildPromptHistory,
  composeUserTurn,
  estimateTokens,
  type PromptTurn,
} from '../promptHistory';

function chat(pairs: number, words = 40): PromptTurn[] {
  const turns: PromptTurn[] = [];
  for (let i = 0; i < pairs; i += 1) {
    turns.push({
      role: 'user',
      content: `question ${i} ${'word '.repeat(words)}`,
    });
    turns.push({
      role: 'assistant',
      content: `answer ${i} ${'word '.repeat(words)}`,
    });
  }
  return turns;
}

describe('buildPromptHistory', () => {
  it('sends the whole conversation while it fits', () => {
    const prior = chat(3);
    const { turns, start } = buildPromptHistory({
      prior,
      next: 'and then?',
      systemTokens: 500,
    });
    expect(start).toBe(0);
    expect(turns).toHaveLength(prior.length + 1);
    expect(turns[turns.length - 1]).toEqual({
      role: 'user',
      content: 'and then?',
    });
  });

  it('keeps the same opening turn between questions so the cache is reused', () => {
    const prior = chat(4);
    const first = buildPromptHistory({ prior, next: 'q', systemTokens: 500 });
    const second = buildPromptHistory({
      prior: [
        ...prior,
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ],
      next: 'q2',
      systemTokens: 500,
      start: first.start,
    });
    expect(second.start).toBe(first.start);
    expect(second.turns[0]).toEqual(first.turns[0]);
  });

  it('drops old turns in one jump that leaves room to grow', () => {
    const prior = chat(30, 60);
    const { turns, start } = buildPromptHistory({
      prior,
      next: 'latest question',
      systemTokens: 500,
      contextTokens: 4096,
      replyTokens: 1024,
    });
    const budget = 4096 - 1024 - 128 - 500;
    const used = turns.reduce(
      (sum, t) => sum + estimateTokens(t.content) + 6,
      0
    );
    expect(start).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(Math.floor(budget * 0.6));
    expect(turns[0].role).toBe('user');

    // One more exchange still fits: the start does not move again.
    const later = buildPromptHistory({
      prior: [
        ...prior,
        { role: 'user', content: 'latest question' },
        { role: 'assistant', content: 'short answer' },
      ],
      next: 'follow-up',
      systemTokens: 500,
      start,
    });
    expect(later.start).toBe(start);
  });

  it('always sends the new question, even alone', () => {
    const { turns } = buildPromptHistory({
      prior: chat(2),
      next: 'x '.repeat(8000),
      systemTokens: 500,
    });
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('user');
  });
});

describe('composeUserTurn', () => {
  it('passes a plain question through', () => {
    expect(composeUserTurn('How do I boil water safely?', [])).toBe(
      'How do I boil water safely?'
    );
  });

  it('puts notes before the question and caps their length', () => {
    const turn = composeUserTurn('Treat a burn?', ['A'.repeat(5000)]);
    expect(turn.startsWith("Notes from Qortino's on-device knowledge")).toBe(
      true
    );
    expect(turn.endsWith('Question: Treat a burn?')).toBe(true);
    expect(turn.length).toBeLessThan(1500);
  });
});

describe('estimateTokens', () => {
  it('counts non-Latin characters as a token each', () => {
    expect(estimateTokens('abcdefgh')).toBe(3);
    expect(estimateTokens('日本語')).toBe(3);
  });
});

describe('buildPromptHistory after a reload', () => {
  it('keeps only about the last exchange when the cache is cold', () => {
    const prior = chat(6, 60);
    const warm = buildPromptHistory({
      prior,
      next: 'and now?',
      systemTokens: 500,
    });
    const cold = buildPromptHistory({
      prior,
      next: 'and now?',
      systemTokens: 500,
      coldPriorTokens: 250,
    });
    expect(warm.start).toBe(0);
    expect(cold.start).toBe(prior.length - 2);
    expect(cold.turns.map((t) => t.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
  });
});

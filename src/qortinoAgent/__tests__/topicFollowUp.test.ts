import { describe, expect, it } from 'vitest';
import {
  extractPriorTopicSubject,
  isTopicFollowUpQuery,
  resolveTopicFollowUpQuery,
} from '../topicFollowUp';

describe('topicFollowUp', () => {
  it('detects pronoun / depth continuations', () => {
    expect(isTopicFollowUpQuery('what is it in depth')).toBe(true);
    expect(isTopicFollowUpQuery('tell me more')).toBe(true);
    expect(isTopicFollowUpQuery('go deeper')).toBe(true);
    expect(isTopicFollowUpQuery('in more depth')).toBe(true);
    expect(isTopicFollowUpQuery('what are q-apps')).toBe(false);
    expect(isTopicFollowUpQuery('what is qortal')).toBe(false);
  });

  it('rewrites "what is it in depth" onto the prior Qortal ask', () => {
    const r = resolveTopicFollowUpQuery('what is it in depth', [
      { role: 'user', content: 'what is qortal' },
      {
        role: 'assistant',
        content: 'Qortal is a decentralized network…',
      },
    ]);
    expect(r.expanded).toBe(true);
    expect(r.text.toLowerCase()).toContain('qortal');
    expect(r.text.toLowerCase()).toContain('depth');
    expect(r.text.toLowerCase()).not.toContain('water');
  });

  it('extracts subjects from prior questions', () => {
    expect(extractPriorTopicSubject('What is Qortal?')).toBe('Qortal');
    expect(extractPriorTopicSubject('how does minting work')).toBe('minting');
  });
});

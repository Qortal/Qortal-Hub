import { describe, expect, it } from 'vitest';
import {
  looksIncompleteAnswer,
  shouldOfferContinueAssemble,
} from '../answerComplete';

describe('answerComplete', () => {
  it('detects mid-cut Max endings', () => {
    expect(looksIncompleteAnswer('Here are tips.\n\nPractical Tips')).toBe(
      true
    );
    expect(looksIncompleteAnswer('For longer trips, bring a filter and')).toBe(
      true
    );
    expect(looksIncompleteAnswer('- Pack a sturdy water bottle')).toBe(true);
  });

  it('does not offer Continue on finished answers', () => {
    const complete =
      'On Qortal you can run a node, mint QORT, register a name, publish Q-Apps, chat, and trade. Minting is optional — non-minters can still use the network fully.';
    expect(
      shouldOfferContinueAssemble(complete, { mode: 'max', maxTokens: 256 })
    ).toBe(false);

    const finishedList = [
      'You can do several things on Qortal:',
      '',
      '- Run a full node.',
      '- Mint QORT with minting rights.',
      '- Publish websites and Q-Apps on QDN.',
      '- Chat, follow names, and explore community apps.',
    ].join('\n');
    expect(
      shouldOfferContinueAssemble(finishedList, { mode: 'max', maxTokens: 256 })
    ).toBe(false);
  });

  it('offers Continue on clearly truncated answers', () => {
    const cut = [
      'Prep checklist:',
      '',
      '- Water filter',
      '- First aid kit',
      '- Food for three days',
      '',
      'Practical Tips',
    ].join('\n');
    expect(
      shouldOfferContinueAssemble(cut, { mode: 'max', maxTokens: 256 })
    ).toBe(true);
  });
});

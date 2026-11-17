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

describe('Continue answer under a finished answer in Chinese or Japanese', () => {
  /** Each a finished answer, in a language Hub's interface is offered in. */
  const FINISHED = {
    zh: [
      '烧伤后，请立即用凉的流动水冲洗伤处二十分钟，不要用冰块、黄油或药膏。',
      '如果出现水泡，不要弄破它们，用干净的纱布轻轻盖住伤口。',
    ].join('\n'),
    ja: [
      'やけどをしたら、すぐに流水で二十分間冷やしてください。氷やバターは使わないでください。',
      '水ぶくれができても、つぶさずに清潔なガーゼでそっと覆ってください。',
    ].join('\n'),
  };

  // As the chat decides it for a model's answer (QortinoAgentChat).
  const offersContinue = (answer: string) =>
    (looksIncompleteAnswer(answer) ||
      shouldOfferContinueAssemble(answer, { maxTokens: 1024 })) &&
    shouldOfferContinueAssemble(answer, { maxTokens: 1024 });

  it('is not offered under a finished answer in Chinese', () => {
    expect(looksIncompleteAnswer(FINISHED.zh)).toBe(false);
    expect(shouldOfferContinueAssemble(FINISHED.zh, { maxTokens: 1024 })).toBe(
      false
    );
  });

  it('is not offered under a finished answer in Japanese', () => {
    expect(looksIncompleteAnswer(FINISHED.ja)).toBe(false);
    expect(shouldOfferContinueAssemble(FINISHED.ja, { maxTokens: 1024 })).toBe(
      false
    );
  });

  it('is not offered under a one-paragraph answer in Chinese', () => {
    const answer =
      '把水静置后用布过滤，然后烧开至少一分钟，冷却后就可以安全饮用。如果在海拔两千米以上，请烧开三分钟。';
    expect(offersContinue(answer)).toBe(false);
  });

  it('is not offered under a one-paragraph answer in Japanese', () => {
    const answer =
      '水をしばらく置いてから布でこし、少なくとも1分間沸騰させてください。冷ませば安全に飲めます。標高2000メートル以上では3分間沸騰させます。';
    expect(offersContinue(answer)).toBe(false);
  });
});

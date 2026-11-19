/**
 * Offline answer/routing audit for representative user questions.
 * Asserts golden FAQ hits and app-catalog collisions.
 */
import { describe, expect, it } from 'vitest';
import { matchQAppCatalog } from '../qAppCatalog';
import { matchGoldenAnswer } from '../goldenMatch';
import { isQortalNetworkDefinitionQuery } from '../queryIntent';
import {
  isTopicFollowUpQuery,
  resolveTopicFollowUpQuery,
} from '../topicFollowUp';

type Expectation = {
  q: string;
  /** Expected golden id */
  goldenId?: string;
  /** Substrings that MUST appear in golden answer */
  answerIncludes?: string[];
  /** Substrings that must NOT appear */
  answerExcludes?: RegExp[];
  /** Must be treated as network definition (not an app) */
  networkDef?: boolean;
  /** Must NOT match an app catalog entry */
  noApp?: boolean;
  /** Must match this app catalog id */
  appId?: string;
};

const CASES: Expectation[] = [
  // —— Qortal network ——
  {
    q: 'What is Qortal?',
    goldenId: 'qortal-001',
    networkDef: true,
    noApp: true,
    answerIncludes: ['decentralized'],
    answerExcludes: [/\bgame\b/i],
  },
  {
    q: 'how does qortal work',
    goldenId: 'qortal-001',
    networkDef: true,
    noApp: true,
  },
  {
    q: 'what are q-apps',
    noApp: true,
    goldenId: 'qortal-014',
    answerIncludes: ['app'],
  },
  {
    q: 'what is minting',
    noApp: true,
    goldenId: 'qortal-005',
  },
  {
    q: 'what is QORT',
    noApp: true,
    answerIncludes: ['coin'],
    answerExcludes: [/\btoken\b/i],
  },
  {
    q: 'is qortal a video game',
    noApp: true,
    answerExcludes: [/yes[,.]?\s*(it\s+is|qortal\s+is)\s+a\s+(video\s+)?game/i],
  },

  // —— Named apps (should open catalog) ——
  {
    q: 'what is Q-Assets',
    appId: 'q-assets',
  },
  {
    q: 'what is Welcome to Qortal',
    appId: 'welcome',
  },
  {
    q: 'explain Ear-Bump',
    appId: 'ear-bump',
  },

  // —— People ——
  {
    q: 'who is Simon James',
    noApp: true,
    answerIncludes: ['qortal'],
  },

  // —— Survival / health ——
  {
    q: 'How do I purify water by boiling?',
    noApp: true,
    answerIncludes: ['boil'],
  },
  {
    q: 'how do I stop severe bleeding',
    noApp: true,
    answerIncludes: ['pressure'],
  },
  {
    q: 'what should be in a home first-aid kit',
    noApp: true,
  },
  {
    q: 'how do I treat dehydration',
    noApp: true,
    goldenId: 'survival-089',
    answerIncludes: ['water', 'salt'],
  },
  {
    q: 'what do I do if someone is choking',
    noApp: true,
    goldenId: 'survival-201',
    answerIncludes: ['back blows'],
  },
  {
    q: 'how do I stay warm without power',
    noApp: true,
    goldenId: 'survival-057',
    answerIncludes: ['warm'],
  },
  {
    q: 'first aid for burns',
    noApp: true,
    goldenId: 'survival-068',
    answerIncludes: ['cool'],
  },
  {
    q: 'how do I join qortal',
    noApp: true,
    goldenId: 'qortal-059',
  },
  {
    q: 'how do I get a minting nomination',
    noApp: true,
    goldenId: 'qortal-006',
  },
  {
    q: 'what can I do on qortal',
    noApp: true,
    goldenId: 'qortal-205',
  },
  {
    q: 'who is Crowetic',
    noApp: true,
    goldenId: 'qortal-032',
    answerIncludes: ['jason', 'founder'],
  },

  // —— High-impact paraphrase / collision fixes ——
  {
    q: 'how do I grow mint',
    noApp: true,
    goldenId: 'gardening-201',
    answerIncludes: ['herb'],
    answerExcludes: [/minting rights|proof of contribution/i],
  },
  {
    q: 'what is a node',
    noApp: true,
    goldenId: 'qortal-206',
    answerIncludes: ['blockchain'],
  },
  {
    q: 'who founded qortal',
    noApp: true,
    goldenId: 'qortal-204',
  },
  {
    q: 'how do levels work',
    noApp: true,
    goldenId: 'qortal-007',
  },
  {
    q: 'Hub vs Qortal GO',
    noApp: true,
    goldenId: 'qortal-141',
  },
  {
    q: 'how do I start a fire without matches',
    noApp: true,
    goldenId: 'survival-028',
  },
  {
    q: 'how do I do cpr',
    noApp: true,
    goldenId: 'survival-202',
    answerIncludes: ['compress'],
  },
  {
    q: 'can I mint without a nomination',
    noApp: true,
    goldenId: 'qortal-207',
  },
  {
    q: 'what is a reward share',
    noApp: true,
    goldenId: 'mint-123',
  },
  {
    q: 'how do I send qort to someone',
    noApp: true,
    goldenId: 'qortal-208',
  },
  {
    q: 'is my seed phrase public',
    noApp: true,
    goldenId: 'qortal-009',
    answerIncludes: ['never share'],
  },
  {
    q: 'how do I purify air in a smoke emergency',
    noApp: true,
    goldenId: 'survival-205',
  },
  {
    q: 'how do I lower blood pressure naturally',
    noApp: true,
    goldenId: 'health-202',
  },
  {
    q: 'what is the price of QORT',
    noApp: true,
    goldenId: 'qortal-210',
    answerIncludes: ['ltc', 'trade'],
    answerExcludes: [/\$\d|usd\s*\d/i],
  },
];

describe('answer audit — offline routing', () => {
  for (const c of CASES) {
    it(c.q, () => {
      if (c.networkDef) {
        expect(isQortalNetworkDefinitionQuery(c.q), 'networkDef').toBe(true);
      }
      if (c.noApp) {
        expect(matchQAppCatalog(c.q), 'noApp').toBeNull();
      }
      if (c.appId) {
        expect(matchQAppCatalog(c.q)?.entry.id, 'appId').toBe(c.appId);
      }

      // Golden FAQ checks (Fast threshold ~0.58)
      if (c.goldenId || c.answerIncludes || c.answerExcludes) {
        const m = matchGoldenAnswer(c.q, { minScore: 0.55 });
        if (c.goldenId) {
          expect(m, `golden for: ${c.q}`).not.toBeNull();
          expect(m!.entry.id).toBe(c.goldenId);
        }
        if (c.answerIncludes?.length) {
          expect(m, `answerIncludes needs golden: ${c.q}`).not.toBeNull();
          const a = m!.entry.a.toLowerCase();
          for (const needle of c.answerIncludes) {
            expect(a, `missing “${needle}”`).toContain(needle.toLowerCase());
          }
        }
        if (c.answerExcludes?.length && m) {
          for (const re of c.answerExcludes) {
            expect(m.entry.a, `excluded ${re}`).not.toMatch(re);
          }
        }
      }
    });
  }

  it('topic follow-up keeps Qortal after what is qortal', () => {
    expect(isTopicFollowUpQuery('what is it in depth')).toBe(true);
    const r = resolveTopicFollowUpQuery('what is it in depth', [
      { role: 'user', content: 'what is qortal' },
      { role: 'assistant', content: 'Qortal is a decentralized…' },
    ]);
    expect(r.expanded).toBe(true);
    expect(r.text.toLowerCase()).toContain('qortal');
  });
});

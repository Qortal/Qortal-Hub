import { describe, expect, it } from 'vitest';
import i18n from '../../i18n/i18n';
import goldenAnswers from '../goldenAnswers.json';
import { lookupGoldenAnswer, type GoldenEntry } from '../goldenMatch';
import { qortinoInstallErrorText } from '../installJobStore';
import { buildSystemPrompt } from '../persona';

const instantAnswer = (question: string) =>
  lookupGoldenAnswer(question).instant?.entry;

describe("Qortino's system prompt in Hub", () => {
  // "who are you" and "where do you run" go to the model with this prompt.
  it('does not tell the model it runs in GO on a phone, at any answer length', () => {
    for (const length of ['short', 'normal', 'detailed'] as const) {
      const prompt = buildSystemPrompt(length);
      expect(prompt).not.toMatch(/\bin Qortal GO\b/);
      expect(prompt).not.toMatch(/\bthis phone\b/);
      expect(prompt).toMatch(
        /helper in Qortal Hub\. You run entirely on this computer/
      );
    }
  });
});

describe('Curated answers about where Qortino runs', () => {
  const QUESTIONS = [
    'Does Qortino run in Qortal Hub on desktop?',
    'qortino in hub',
    'qortino on desktop',
    'qortino on pc',
    'use qortino on computer',
    'Is Qortino part of Qortal?',
    'what is Qortino',
    'What are the main parts of the Qortal ecosystem?',
    'what is the difference between hub and go',
    "What is the QORTINO card on Hub's Home?",
    'what is qortino on hub home',
  ];

  it.each(QUESTIONS)('"%s" does not say Qortino is only in GO', (question) => {
    const entry = instantAnswer(question);
    expect(entry, 'an instant answer').toBeTruthy();
    expect(entry.a).not.toMatch(
      /only in (the )?Qortal GO|not in desktop Hub|inside Qortal GO|GO's offline AI helper|such as Qortino|not the offline AI helper/
    );
  });

  it('answers yes when asked whether Qortino runs in Hub', () => {
    expect(
      instantAnswer('Does Qortino run in Qortal Hub on desktop?').a
    ).toMatch(/^Yes\. Qortino runs in Qortal Hub/);
  });
});

describe('Curated answers about Qortino, for questions that do not name GO', () => {
  const namesGo = (text: string) => /\bGO\b|\bAndroid\b/.test(text);
  const entries = (goldenAnswers as { entries: GoldenEntry[] }).entries.filter(
    (entry) => /qortino/i.test(`${entry.q} ${entry.a}`) && !namesGo(entry.q)
  );
  const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n/);

  /** What in an answer is true only of Qortino in GO on a phone. */
  function goOnly(answer: string): string[] {
    const found: string[] = [];
    const onlyInGo =
      /\bonly in (the )?(Qortal )?GO\b|\bnot in (desktop )?Hub\b|\bGO's (offline )?(AI )?helper\b|\bGO's offline helper\b|\bQortino in GO\b/.exec(
        answer
      );
    if (onlyInGo) found.push(`says "${onlyInGo[0]}"`);
    for (const sentence of sentences(answer)) {
      // A phone, Android or a tap belongs to GO, and must say so.
      if (
        /\b(on|to|into|in|from) (your|the|this) phone\b|\bphone's\b|\bAndroid\b|\btap\b/i.test(
          sentence
        ) &&
        !/\bGO\b/.test(sentence)
      ) {
        found.push(`phone step without GO: "${sentence}"`);
      }
    }
    // Where GO does something its own way, Hub's way is given too.
    if (/\bGO\b/.test(answer) && !/\bHub\b/.test(answer)) {
      found.push('names GO without Hub');
    }
    return found;
  }

  it('checks the answers about Qortino', () => {
    expect(entries.length).toBeGreaterThan(60);
  });

  it('describe Qortino as it is in both Hub and GO', () => {
    const offenders = entries
      .map((entry) => ({ id: entry.id, q: entry.q, found: goOnly(entry.a) }))
      .filter((entry) => entry.found.length);
    expect(offenders).toEqual([]);
  });

  it('still describe GO on a phone where the question names GO', () => {
    const go = (goldenAnswers as { entries: GoldenEntry[] }).entries.find(
      (entry) => entry.id === 'hw-044'
    );
    expect(go.q).toMatch(/\bGO\b/);
    expect(go.a).toMatch(/on the phone's shared storage/);
  });
});

describe("Qortino's low storage message", () => {
  it('speaks of this computer, as the rest of Qortino does', () => {
    const text = qortinoInstallErrorText(
      { code: 'low_storage', neededBytes: 3e9, freeBytes: 1e9 },
      i18n.getFixedT('en')
    );
    expect(text).toMatch(
      /^Not enough free space: Qortino needs .+, and this computer has .+ free\.$/
    );
  });
});

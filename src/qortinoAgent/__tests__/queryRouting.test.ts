import { describe, expect, it } from 'vitest';
import { matchQAppCatalog } from '../qAppCatalog';
import { matchGoldenAnswer } from '../goldenMatch';
import goldenAnswers from '../goldenAnswers.json';
import {
  isQortalNetworkDefinitionQuery,
  isGenericConceptNeedle,
  isQortPriceQuery,
} from '../queryIntent';

describe('query routing — network vs apps', () => {
  it('recognizes network definition asks', () => {
    for (const q of [
      'what is qortal',
      'What is Qortal?',
      'whats qortal',
      "what's qortal",
      'what is the qortal network',
      'how does qortal work',
      'explain qortal',
      'define qortal',
    ]) {
      expect(isQortalNetworkDefinitionQuery(q), q).toBe(true);
      expect(matchQAppCatalog(q), q).toBeNull();
    }
  });

  it('routes definition asks to golden qortal-001', () => {
    expect(matchGoldenAnswer('what is qortal')?.entry.id).toBe('qortal-001');
    expect(matchGoldenAnswer('how does qortal work')?.entry.id).toBe(
      'qortal-001'
    );
    expect(matchGoldenAnswer("what's qortal")?.entry.id).toBe('qortal-001');
  });

  it('does not steal concept FAQs into apps', () => {
    expect(matchQAppCatalog('what is minting')).toBeNull();
    expect(matchGoldenAnswer('what is minting')?.entry.id).toBe('qortal-005');

    expect(matchQAppCatalog('what are qortal names')).toBeNull();
    expect(matchQAppCatalog('tell me about names')).toBeNull();
    expect(matchQAppCatalog('what is trade')).toBeNull();
    expect(matchQAppCatalog('what is search')).toBeNull();
    expect(matchQAppCatalog('what is onboarding')).toBeNull();
    expect(matchQAppCatalog('what is support')).toBeNull();
  });

  it('still matches real apps when named', () => {
    expect(matchQAppCatalog('what is Q-Assets')?.entry.id).toBe('q-assets');
    expect(matchQAppCatalog('what is Welcome to Qortal')?.entry.id).toBe(
      'welcome'
    );
    expect(matchQAppCatalog('open Welcome to Qortal')?.entry.id).toBe(
      'welcome'
    );
    expect(matchQAppCatalog('what is Q-Node')?.entry.id).toBe('q-node');
    expect(matchQAppCatalog('what is the Names app')?.entry.id).toBe('names');
    expect(matchQAppCatalog('explain Ear-Bump')?.entry.name).toBe('Ear-Bump');
    expect(matchQAppCatalog('what is Torq')?.entry.id).toBe('torq');
    expect(matchQAppCatalog('open torq app')?.entry.id).toBe('torq');
    expect(matchQAppCatalog('what is Quitter')?.entry.summary).toMatch(/Torq/);
    expect(matchQAppCatalog('what is q-drive')?.entry.name).toBe('Q-Drive');
    expect(matchQAppCatalog('open singularity')?.entry.name).toBe(
      'Singularity'
    );
    expect(matchQAppCatalog('open gifs')?.entry.name).toBe('GIFs');
  });

  it('leaves pre-release + versions to the FAQ, not the stable app card', () => {
    expect(matchQAppCatalog('what is q-mail+')).toBeNull();
    expect(matchQAppCatalog('open q-share+')).toBeNull();
    expect(matchQAppCatalog('what is q-mail')?.entry.name).toBe('Q-Mail');
    // POS+ is its own app, not a + version.
    expect(matchQAppCatalog('what is pos+')?.entry.name).toBe('POS+');
  });

  it('keeps everyday words that are also app names as questions', () => {
    for (const q of [
      'what is weather',
      'what is the singularity',
      'explain singularity',
      'what is a gif',
      'what are notes',
      'what is an encrypted drive',
    ]) {
      expect(matchQAppCatalog(q), q).toBeNull();
    }
  });

  it('treats generic concepts as concepts, not names', () => {
    expect(isGenericConceptNeedle('minting')).toBe(true);
  });

  it('matches inflections via stemming (mint vs minting)', () => {
    const m = matchGoldenAnswer('i want to start minting', { minScore: 0.5 });
    expect(m).not.toBeNull();
    expect(m!.entry.category).toBe('qortal');
    expect(`${m!.entry.q} ${m!.entry.a}`.toLowerCase()).toMatch(/mint/);
  });

  it('never puts a level floor on Minter Admins', () => {
    // Any existing minter can be proposed (Q-Mintership's admin board);
    // level 5+ is the rule for nominating new minters, not for admins.
    for (const q of [
      'who are minter admins',
      'Who are the Minter Admins?',
      'how do I become a minter admin',
      'what does level 5 unlock',
    ]) {
      const m = matchGoldenAnswer(q);
      expect(m, q).not.toBeNull();
      expect(m!.entry.a, q).not.toMatch(
        /only level 5\+? minters|eligible to become|admins come from level/i
      );
    }
    const floors = goldenAnswers.entries.filter((e) =>
      /only level 5\+? minters can become|admins come from level 5|eligible to become (a )?minter admin/i.test(
        e.a
      )
    );
    expect(floors.map((e) => e.id)).toEqual([]);
  });

  it('never says Qortino needs a private node to download', () => {
    // The public node fetches the model too; a private node is recommended,
    // never said to be required.
    const claims = goldenAnswers.entries.filter((e) =>
      e.a
        .split(/(?<=[.!?])\s+/)
        .some(
          (sentence) =>
            /qortino|model/i.test(sentence) &&
            /public (gateway )?nodes? cannot|only be assembled from a private node|(needs|requires) (your own|a private) node/i.test(
              sentence
            )
        )
    );
    expect(claims.map((e) => e.id)).toEqual([]);
    expect(
      matchGoldenAnswer("How do I download Qortino's model?")?.entry.a
    ).toMatch(/public node/);
  });

  it('describes Simon James as a community member and GO contributor', () => {
    for (const q of [
      'who is simon james',
      'Who is Simon James?',
      'simon james',
    ]) {
      const m = matchGoldenAnswer(q);
      expect(m?.entry.a, q).toMatch(/long-time Qortal community member/);
      expect(m?.entry.a, q).toMatch(/Qortal GO/);
    }
  });

  it('routes QORT price asks to the honesty FAQ', () => {
    expect(isQortPriceQuery('what is the price of QORT')).toBe(true);
    expect(matchGoldenAnswer('what is the price of QORT')?.entry.id).toBe(
      'qortal-210'
    );
    expect(matchQAppCatalog('what is the price of QORT')).toBeNull();
  });
});

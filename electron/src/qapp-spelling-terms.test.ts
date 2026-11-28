import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  addQortalSpellingTerms,
  keepsSpellingWordsInHub,
  QORTAL_SPELLING_TERMS,
  qortalSpellingWords,
} from './qapp-spelling-terms';

/** A session's spelling dictionary, as Electron keeps it. */
function fakeSession(
  options: {
    persistent?: boolean;
    words?: string[];
    listFails?: boolean;
    refuse?: string[];
    throwOn?: string[];
  } = {}
) {
  const words = new Set(options.words ?? []);
  const added: string[] = [];
  return {
    added,
    isPersistent: vi.fn(() => options.persistent ?? true),
    listWordsInSpellCheckerDictionary: vi.fn(async () => {
      if (options.listFails) throw new Error('not loaded');
      return [...words];
    }),
    addWordToSpellCheckerDictionary: vi.fn((word: string) => {
      if (options.throwOn?.includes(word)) throw new Error('refused');
      if (options.refuse?.includes(word)) return false;
      added.push(word);
      words.add(word);
      return true;
    }),
  };
}

describe('the Qortal words', () => {
  it('are words a spelling dictionary takes', () => {
    for (const term of QORTAL_SPELLING_TERMS) {
      expect(term).toMatch(/^\S+$/);
      expect(Buffer.byteLength(term, 'utf8')).toBeLessThanOrEqual(99);
    }
    expect(new Set(QORTAL_SPELLING_TERMS).size).toBe(
      QORTAL_SPELLING_TERMS.length
    );
  });

  it('cover Qortal, QORT and QDN', () => {
    expect(QORTAL_SPELLING_TERMS).toEqual(
      expect.arrayContaining(['Qortal', 'QORT', 'QDN'])
    );
  });

  it('are each accepted as written and in lower case', () => {
    expect(qortalSpellingWords(['Qortal', 'QDN', 'minter'])).toEqual([
      'Qortal',
      'qortal',
      'QDN',
      'qdn',
      'minter',
    ]);
  });
});

describe('addQortalSpellingTerms', () => {
  it('adds every word to an empty dictionary', async () => {
    const target = fakeSession();
    const all = qortalSpellingWords();
    await expect(addQortalSpellingTerms(target, 'linux')).resolves.toBe(
      all.length
    );
    expect(target.added).toEqual(all);
  });

  it('adds only the words the dictionary lacks', async () => {
    const target = fakeSession({ words: ['Qortal', 'qdn', 'other'] });
    await addQortalSpellingTerms(target, 'linux');
    expect(target.added).not.toContain('Qortal');
    expect(target.added).not.toContain('qdn');
    expect(target.added).toContain('qortal');
    expect(target.added).toContain('QDN');
  });

  it('adds nothing the second time', async () => {
    const target = fakeSession();
    await addQortalSpellingTerms(target, 'linux');
    target.addWordToSpellCheckerDictionary.mockClear();
    await expect(addQortalSpellingTerms(target, 'linux')).resolves.toBe(0);
    expect(target.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
  });

  it('leaves an in-memory session alone', async () => {
    const target = fakeSession({ persistent: false });
    await expect(addQortalSpellingTerms(target, 'linux')).resolves.toBe(0);
    expect(target.listWordsInSpellCheckerDictionary).not.toHaveBeenCalled();
    expect(target.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
  });

  it("adds nothing when the dictionary can't be read", async () => {
    const target = fakeSession({ listFails: true });
    await expect(addQortalSpellingTerms(target, 'linux')).resolves.toBe(0);
    expect(target.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
  });

  it('goes on past a word the dictionary refuses', async () => {
    const target = fakeSession({ throwOn: ['Qortal'], refuse: ['QORT'] });
    const all = qortalSpellingWords();
    await expect(addQortalSpellingTerms(target, 'linux')).resolves.toBe(
      all.length - 2
    );
    expect(target.added).toContain('qortal');
    expect(target.added).toContain('rvn');
  });

  it('never rejects, even for a session that is gone', async () => {
    const target = fakeSession();
    target.isPersistent.mockImplementation(() => {
      throw new Error('destroyed');
    });
    await expect(addQortalSpellingTerms(target, 'linux')).resolves.toBe(0);
  });
});

describe('where the Qortal words stay inside Hub', () => {
  it('is only where Electron keeps added words out of the system dictionary', () => {
    expect(keepsSpellingWordsInHub('linux')).toBe(true);
    expect(keepsSpellingWordsInHub('win32')).toBe(false);
    expect(keepsSpellingWordsInHub('darwin')).toBe(false);
  });

  it('adds the words on Linux', async () => {
    const target = fakeSession();
    await expect(addQortalSpellingTerms(target, 'linux')).resolves.toBe(
      qortalSpellingWords().length
    );
  });

  it.each(['win32', 'darwin'] as const)(
    "adds none on %s, where they would reach the system's dictionary",
    async (platform) => {
      const target = fakeSession();
      await expect(addQortalSpellingTerms(target, platform)).resolves.toBe(0);
      expect(target.listWordsInSpellCheckerDictionary).not.toHaveBeenCalled();
      expect(target.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
    }
  );

  it('follows the platform Hub runs on', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const target = fakeSession();
      await expect(addQortalSpellingTerms(target)).resolves.toBe(0);
      expect(target.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });
});

describe('Q-App sessions', () => {
  it('get the Qortal words when Hub sets them up', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'electron/src/setup.ts'),
      'utf8'
    );
    const start = source.indexOf('function configureQAppGuestSession(');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n}\n', start));
    expect(body).toContain('addQortalSpellingTerms(guestSession)');
  });
});

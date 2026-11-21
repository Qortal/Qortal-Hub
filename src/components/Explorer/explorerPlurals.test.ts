import { afterAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n/i18n';

// The Explorer's counted sentences say their number in every form of every
// language: a language's "one" form can cover 21 or 101 too (Russian), so
// the case of exactly one has a sentence of its own.

const LANGUAGES = [
  'ar',
  'de',
  'en',
  'es',
  'et',
  'fi',
  'fr',
  'it',
  'ja',
  'pt',
  'ru',
  'zh',
];
const COUNTS = [2, 3, 5, 11, 21, 22, 25, 101, 111, 500];

/** Plural keys and the option that holds the number shown. */
const COUNTED: Array<[string, string]> = [
  ['explorer:facts.blocks_to_level', 'blocks'],
  ['explorer:facts.days_to_level', 'count'],
  ['explorer:facts.in_groups', 'groups'],
  ['explorer:facts.payments_all', 'payments'],
  ['explorer:facts.payments_newest', 'payments'],
  ['explorer:groups.members', 'members'],
  ['explorer:minting.show_all', 'count'],
  ['explorer:notes.name_invisible', 'count'],
  ['explorer:summary.owns_names', 'shown'],
  ['explorer:summary.owns_names_more', 'shown'],
  ['explorer:transactions.all', 'shown'],
  ['explorer:transactions.all_kind', 'shown'],
  ['explorer:transactions.newest', 'shown'],
  ['explorer:transactions.newest_kind', 'shown'],
  ['explorer:tx.say.multi.in', 'accounts'],
  ['explorer:tx.say.multi.none', 'accounts'],
  ['explorer:tx.say.multi.out', 'accounts'],
  ['explorer:tx.show_all', 'count'],
];

const original = i18n.language;
afterAll(() => i18n.changeLanguage(original));

describe('explorer plurals', () => {
  it.each(LANGUAGES)(
    '%s: every counted sentence shows its number',
    async (language) => {
      await i18n.changeLanguage(language);
      for (const [key, shown] of COUNTED) {
        for (const count of COUNTS) {
          // `count` picks the form; a separate option, when there is one, is what shows.
          const marker = shown === 'count' ? String(count) : `#${count}#`;
          const text = i18n.t(key, {
            count,
            ...(shown === 'count' ? {} : { [shown]: marker }),
            level: 8,
            name: 'Publisher',
          });
          expect(text, `${language} ${key} ${count}`).toContain(marker);
        }
      }
    }
  );
});

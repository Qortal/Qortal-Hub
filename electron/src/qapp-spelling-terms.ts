import type { Session } from 'electron';

/**
 * Common Qortal words, added to each Q-App session's spelling dictionary so
 * the spellcheck in Q-Apps and websites doesn't underline them, where they
 * stay inside Hub (keepsSpellingWordsInHub).
 */
export const QORTAL_SPELLING_TERMS: readonly string[] = [
  // Qortal itself
  'Qortal',
  'QORT',
  'QDN',
  'Qortino',
  'Reticulum',
  'LXMF',
  // Q-Apps
  'Q-App',
  'Q-Apps',
  'Qapp',
  'Qapps',
  // Official Q-Apps and websites
  'Q-Assets',
  'Q-Blog',
  'Q-Chat',
  'Q-Drive',
  'Q-Follow',
  'Q-Fund',
  'Q-Mail',
  'Q-Manager',
  'Q-Mintership',
  'Q-Node',
  'Q-Search',
  'Q-Share',
  'Q-Shop',
  'Q-Support',
  'Q-Trade',
  'Q-Tube',
  'Q-Wallets',
  'EarBump',
  'Subscreen',
  'SubWire',
  'Torq',
  // Minting
  'minter',
  'minters',
  'Mintership',
  'sponsee',
  'sponsees',
  // Coins traded on Qortal
  'ARRR',
  'BTC',
  'DGB',
  'DOGE',
  'LTC',
  'RVN',
];

/** Each term as written and in lower case, so either is accepted. */
export function qortalSpellingWords(
  terms: readonly string[] = QORTAL_SPELLING_TERMS
): string[] {
  const words = new Set<string>();
  for (const term of terms) {
    words.add(term);
    words.add(term.toLowerCase());
  }
  return [...words];
}

type SpellingSession = Pick<
  Session,
  | 'isPersistent'
  | 'listWordsInSpellCheckerDictionary'
  | 'addWordToSpellCheckerDictionary'
>;

/**
 * Whether the Qortal words stay inside Hub on this platform. On Windows and
 * macOS, Electron also writes a word added to a session's dictionary into
 * the system's own spelling dictionary, which other programs use: Hub adds
 * none there.
 */
export function keepsSpellingWordsInHub(platform: NodeJS.Platform): boolean {
  return platform !== 'win32' && platform !== 'darwin';
}

/**
 * Adds the Qortal words a session's dictionary doesn't have yet, and
 * resolves to how many it added. Electron keeps the dictionary on disk, so
 * each word is added once; an in-memory session can't keep words, and on
 * Windows and macOS none are added (keepsSpellingWordsInHub). It never
 * rejects: a dictionary that can't be read or written gets nothing.
 */
export async function addQortalSpellingTerms(
  target: SpellingSession,
  platform: NodeJS.Platform = process.platform
): Promise<number> {
  if (!keepsSpellingWordsInHub(platform)) return 0;
  let known: Set<string>;
  try {
    if (!target.isPersistent()) return 0;
    known = new Set(await target.listWordsInSpellCheckerDictionary());
  } catch {
    return 0;
  }
  let added = 0;
  for (const word of qortalSpellingWords()) {
    if (known.has(word)) continue;
    try {
      if (target.addWordToSpellCheckerDictionary(word)) added += 1;
    } catch {
      // One word the dictionary refuses doesn't stop the rest.
    }
  }
  return added;
}

/**
 * Quitter identifiers, which Torq shares: they must match qapp-core with
 * appName 'quitter' and Quitter's public salt (qappCoreHash in torqFeed.ts).
 *
 * Public post ids look like:
 *   MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-<uid15>-v1
 */

import ShortUniqueId from 'short-unique-id';
import { qappCoreHash } from './torqFeed';

const QUITTER_APP_NAME = 'quitter';
const QUITTER_ENTITY_POST = 'POST';
const QUITTER_ENTITY_ROOT = 'ROOT';

const uid15 = new ShortUniqueId({ length: 15 });

/** HIGH collision strength, as Quitter hashes @mentions for descriptions. */
export const quitterHashString = (word: string): Promise<string> =>
  qappCoreHash(word, 14);

/**
 * A Quitter public post identifier:
 *   {appHash14}-{entityHash6}-{parentHash14}-{uid15}-v1
 */
export async function buildQuitterPostIdentifier(): Promise<string> {
  const [appHash, entityHash, parentHash] = await Promise.all([
    qappCoreHash(QUITTER_APP_NAME, 14),
    qappCoreHash(QUITTER_ENTITY_POST, 6),
    qappCoreHash(QUITTER_ENTITY_ROOT, 14),
  ]);
  return `${appHash}-${entityHash}-${parentHash}-${uid15.rnd()}-v1`;
}

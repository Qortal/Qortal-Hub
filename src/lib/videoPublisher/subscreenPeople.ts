/**
 * Finding a person Subscreen already knows, as its publish form does before
 * it publishes a new one (`Rg`): QDN DOCUMENTs whose identifier has
 * `subscreen_person_` (never a `subscreen_person_profile_` page) and that
 * match the name (`query`, Subscreen's own search parameters), each read,
 * and the one whose `displayName` is the same name, case and spaces aside.
 * Of several, the newest, as Subscreen's people lists merge them. Any
 * publisher's: a person is shared by every title that names them.
 *
 * Hits whose QDN title and description name someone else aren't read
 * (Subscreen writes the name into both); a hit without them is.
 */
import { getBaseApi } from '../../background/background';
import {
  cleanCreditName,
  normalizePersonName,
  SUBSCREEN_CREDIT_TEXT_MAX_LENGTH,
  SUBSCREEN_PERSON_BASE,
  SUBSCREEN_PERSON_PROFILE_BASE,
  type SubscreenPersonRef,
} from './subscreenCredits';

/** Subscreen's person search asks for this many. */
export const SUBSCREEN_PERSON_SEARCH_LIMIT = 80;
const READ_CONCURRENCY = 5;
const SEARCH_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 15_000;
/** Subscreen counts a non-video resource this small as deleted (`B`). */
const DELETED_MAX_BYTES = 32;

type SearchHit = {
  name?: unknown;
  identifier?: unknown;
  size?: unknown;
  created?: unknown;
  metadata?: { title?: unknown; description?: unknown } | null;
};

type PersonHit = {
  name: string;
  identifier: string;
  created: number;
  title?: string;
  description?: string;
};

export type FindSubscreenPersonOptions = {
  signal?: AbortSignal;
  /** The node's address; Hub's own by default. */
  baseUrl?: string;
  /** Tests pass their own. */
  fetch?: typeof fetch;
};

/** The search, with Subscreen's parameters (and the hits' QDN metadata). */
export function subscreenPersonSearchUrl(
  baseUrl: string,
  displayName: string,
  limit = SUBSCREEN_PERSON_SEARCH_LIMIT
): string {
  const params = new URLSearchParams({
    mode: 'ALL',
    service: 'DOCUMENT',
    limit: String(limit),
    offset: '0',
    reverse: 'true',
    includemetadata: 'true',
    excludeblocked: 'true',
    exactmatchnames: 'true',
    identifier: SUBSCREEN_PERSON_BASE,
    query: displayName,
  });
  return `${baseUrl}/arbitrary/resources/search?${params.toString()}`;
}

/**
 * A person DOCUMENT's name, as Subscreen reads it (`Bi`): null for one
 * that was deleted ("D", `RA==`, `{ deleted: true }`) or has no name.
 */
export function readSubscreenPersonName(text: string): string | null {
  const trimmed = (text || '').trim();
  if (!trimmed || trimmed === 'D' || trimmed === 'RA==') return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const person = value as {
    displayName?: unknown;
    deleted?: unknown;
    cleared?: unknown;
    error?: unknown;
  };
  if (person.deleted === true || person.cleared === true || person.error) {
    return null;
  }
  const name =
    typeof person.displayName === 'string'
      ? person.displayName.trim().slice(0, SUBSCREEN_CREDIT_TEXT_MAX_LENGTH)
      : '';
  return name || null;
}

function personHit(value: unknown): PersonHit | null {
  const hit = value as SearchHit;
  if (!hit || typeof hit !== 'object') return null;
  const { name, identifier } = hit;
  if (typeof name !== 'string' || !name) return null;
  if (
    typeof identifier !== 'string' ||
    !identifier.startsWith(SUBSCREEN_PERSON_BASE) ||
    identifier.startsWith(SUBSCREEN_PERSON_PROFILE_BASE)
  ) {
    return null;
  }
  const size = Number(hit.size) || 0;
  if (size > 0 && size <= DELETED_MAX_BYTES) return null;
  const text = (field: unknown) =>
    typeof field === 'string' ? field : undefined;
  return {
    name,
    identifier,
    created: Number(hit.created) > 0 ? Number(hit.created) : 0,
    title: text(hit.metadata?.title),
    description: text(hit.metadata?.description),
  };
}

/** Whether a hit may be the person: its QDN title or description says so. */
function mayBe(hit: PersonHit, wanted: string, wantedTitle: string): boolean {
  if (hit.title === undefined && hit.description === undefined) return true;
  return (
    normalizePersonName(hit.description) === wanted ||
    normalizePersonName(hit.title) === wanted ||
    normalizePersonName(hit.title) === wantedTitle
  );
}

/** `signal`, or `ms` running out: whichever comes first. */
function timed(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}

/**
 * The person Subscreen shows for this name, or null: none yet, or the node
 * couldn't say (then a new person is published, as Subscreen does).
 */
export async function findSubscreenPerson(
  displayName: string,
  options: FindSubscreenPersonOptions = {}
): Promise<SubscreenPersonRef | null> {
  const query = cleanCreditName(displayName);
  const wanted = normalizePersonName(query);
  if (!wanted) return null;
  const wantedTitle = normalizePersonName(query.slice(0, 50));
  const fetchImpl = options.fetch ?? fetch;
  const { signal } = options;
  try {
    const base = options.baseUrl ?? (await getBaseApi());
    const search = timed(signal, SEARCH_TIMEOUT_MS);
    let hits: unknown;
    try {
      const response = await fetchImpl(subscreenPersonSearchUrl(base, query), {
        signal: search.signal,
      });
      if (!response.ok) return null;
      hits = await response.json();
    } finally {
      search.done();
    }
    if (!Array.isArray(hits)) return null;
    const candidates = hits
      .map(personHit)
      .filter((hit): hit is PersonHit => Boolean(hit))
      .filter((hit) => mayBe(hit, wanted, wantedTitle));

    // By their place among the hits (newest first), however reads finish.
    const matches: { hit: PersonHit; index: number }[] = [];
    let next = 0;
    const read = async () => {
      while (next < candidates.length && !signal?.aborted) {
        const index = next;
        const hit = candidates[index];
        next += 1;
        const request = timed(signal, READ_TIMEOUT_MS);
        try {
          const response = await fetchImpl(
            `${base}/arbitrary/DOCUMENT/${encodeURIComponent(
              hit.name
            )}/${encodeURIComponent(hit.identifier)}`,
            { signal: request.signal }
          );
          if (!response.ok) continue;
          const name = readSubscreenPersonName(await response.text());
          if (name && normalizePersonName(name) === wanted) {
            matches.push({ hit, index });
          }
        } catch {
          // Not readable now: not counted, as in Subscreen.
        } finally {
          request.done();
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(READ_CONCURRENCY, candidates.length) },
        read
      )
    );
    if (signal?.aborted || !matches.length) return null;
    const [{ hit: newest }] = matches.sort(
      (a, b) => b.hit.created - a.hit.created || a.index - b.index
    );
    return {
      name: newest.name,
      identifier: newest.identifier,
      service: 'DOCUMENT',
    };
  } catch {
    return null;
  }
}

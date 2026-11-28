/**
 * A title's cast & crew ("credits") the way Subscreen (1.1.3) writes them,
 * so a film or series published from Hub shows its directors, actors and
 * the rest in Subscreen like one published from Subscreen's own form
 * (its bundle's PublishPage and UserAvatar chunks; checked against real
 * records on QDN, 2026-11-17, see __fixtures__/subscreen-credits.json).
 *
 * People aren't keys in a title's metadata or playlist (Subscreen's readers
 * drop keys they don't know). They live in:
 * - one credits DOCUMENT per title, `subscreen_credits_<hash of the title>`,
 *   `{ titleRef, people: [{ personRef, role, displayName, character?, at }],
 *   version: 2 }`, its QDN description the people's names (Subscreen's
 *   person pages find a person's titles by searching it);
 * - one person DOCUMENT per person, `subscreen_person_<slug>_<id5>`,
 *   `{ displayName }`, shared by every title that names them, whoever
 *   published it: a name Subscreen already knows is pointed at, never
 *   published again (subscreenPeople.ts finds it).
 *
 * The order is Subscreen's: the title's own resources, then each new
 * person, then the credits. Both wait for the title's listing (a film's
 * metadata, a series' playlist), so a failed upload leaves no people or
 * credits of a title that isn't there.
 */
import { base64ByteLength, jsonToBase64, utf8Bytes } from './encoding';
import { VideoPublishError } from './errors';
import { randomAlphanumeric, sliceText } from './ids';
import type { PublishedResource, PublishStep } from './types';

/** Subscreen's roles, in the order its title page shows them. */
export const SUBSCREEN_CREDIT_ROLES = [
  'director',
  'actor',
  'writer',
  'producer',
  'composer',
  'cinematographer',
  'editor',
] as const;

export type SubscreenCreditRole = (typeof SUBSCREEN_CREDIT_ROLES)[number];

export const isSubscreenCreditRole = (
  value: unknown
): value is SubscreenCreditRole =>
  typeof value === 'string' &&
  (SUBSCREEN_CREDIT_ROLES as readonly string[]).includes(value);

/** One person in one role, as the user typed it. */
export type SubscreenCredit = {
  role: SubscreenCreditRole;
  displayName: string;
  /** Who an actor plays (actors only). */
  character?: string;
};

/** The title credits belong to: a film's metadata, a series' playlist. */
export type SubscreenTitleRef = {
  name: string;
  identifier: string;
  service: 'DOCUMENT' | 'PLAYLIST';
};

export type SubscreenPersonRef = {
  name: string;
  identifier: string;
  service: 'DOCUMENT';
};

/** One entry of the credits DOCUMENT, keys in Subscreen's order. */
export type SubscreenCreditEntry = {
  personRef: SubscreenPersonRef;
  role: SubscreenCreditRole;
  displayName: string;
  character?: string;
  /** When it was added (ms). */
  at: number;
};

export type SubscreenCreditsDocument = {
  titleRef: SubscreenTitleRef;
  people: SubscreenCreditEntry[];
  version: 2;
};

export const SUBSCREEN_CREDITS_BASE = 'subscreen_credits_';
export const SUBSCREEN_PERSON_BASE = 'subscreen_person_';
/** A person's profile, which a person search finds too: never a person. */
export const SUBSCREEN_PERSON_PROFILE_BASE = 'subscreen_person_profile_';
export const SUBSCREEN_CREDITS_FILENAME = 'credits.json';
export const SUBSCREEN_PERSON_FILENAME = 'person.json';
/** A name or a character: Subscreen's form and readers keep 80. */
export const SUBSCREEN_CREDIT_TEXT_MAX_LENGTH = 80;
/** People in one title's credits: Subscreen keeps (and reads) 200. */
export const SUBSCREEN_CREDITS_MAX = 200;
/** The credits' QDN description, its names: 240 bytes at most. */
export const SUBSCREEN_CREDITS_DESCRIPTION_MAX_BYTES = 240;
const CREDITS_TITLE_MAX_LENGTH = 50;
const PERSON_TITLE_MAX_LENGTH = 50;
const PERSON_ID_LENGTH = 5;
const PERSON_SLUG_MAX_LENGTH = 20;

/**
 * Subscreen's `pn`: two 32-bit FNV-1a-style hashes over the text's UTF-16
 * code units (the second mixes in each unit's position), 16 hex digits.
 */
export function subscreenHash(text: string): string {
  let first = 2166136261;
  let second = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    first ^= unit;
    first = Math.imul(first, 16777619);
    second ^= unit + index * 13;
    second = Math.imul(second, 16777619);
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, '0');
  return hex(first) + hex(second);
}

/** The credits DOCUMENT's identifier: one per title (Subscreen's `qi`). */
export const subscreenCreditsIdentifier = (
  titleRef: Pick<SubscreenTitleRef, 'service' | 'name' | 'identifier'>
): string =>
  `${SUBSCREEN_CREDITS_BASE}${subscreenHash(
    `${titleRef.service}:${titleRef.name}:${titleRef.identifier}`
  )}`;

/** Its QDN title (Subscreen's `ca`). */
export const subscreenCreditsTitle = (
  titleRef: Pick<SubscreenTitleRef, 'identifier'>
): string =>
  sliceText(`Credits ${titleRef.identifier}`, CREDITS_TITLE_MAX_LENGTH);

/**
 * How Subscreen compares names (`D`): case, outer and repeated spaces
 * aside. Two credits of one role are one person when this matches.
 */
export const normalizePersonName = (name: string | undefined): string =>
  (name || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** A name as Subscreen's form keeps it (`Lg`): single spaces, 80 at most. */
export const cleanCreditName = (name: string | undefined): string =>
  sliceText(
    (name || '').trim().replace(/\s+/g, ' '),
    SUBSCREEN_CREDIT_TEXT_MAX_LENGTH
  ).trim();

/** An actor's character as Subscreen keeps it: trimmed, 80 at most. */
export const cleanCreditCharacter = (
  character: string | undefined
): string | undefined =>
  sliceText(
    (character || '').trim(),
    SUBSCREEN_CREDIT_TEXT_MAX_LENGTH
  ).trim() || undefined;

/** Two credits are the same when the role and the person are (`Yi`). */
const sameCredit = (
  a: Pick<SubscreenCreditEntry, 'role' | 'displayName'> & {
    personRef?: { identifier?: string };
  },
  b: Pick<SubscreenCreditEntry, 'role' | 'displayName'> & {
    personRef?: { identifier?: string };
  }
): boolean => {
  if (a.role !== b.role) return false;
  if (
    a.personRef?.identifier &&
    a.personRef.identifier === b.personRef?.identifier
  ) {
    return true;
  }
  const name = normalizePersonName(a.displayName);
  return Boolean(name) && name === normalizePersonName(b.displayName);
};

/**
 * The credits as they go up: names cleaned (empty ones and unknown roles
 * left out), a character only for actors, each person once per role (a
 * later one replacing an earlier, as Subscreen adds them), the last 200.
 */
export function subscreenCreditList(
  credits: readonly SubscreenCredit[] | null | undefined
): SubscreenCredit[] {
  let list: SubscreenCredit[] = [];
  for (const credit of credits || []) {
    if (!credit || !isSubscreenCreditRole(credit.role)) continue;
    const displayName = cleanCreditName(credit.displayName);
    if (!displayName) continue;
    const character =
      credit.role === 'actor'
        ? cleanCreditCharacter(credit.character)
        : undefined;
    const next: SubscreenCredit = {
      role: credit.role,
      displayName,
      ...(character ? { character } : {}),
    };
    list = list.filter((other) => !sameCredit(other, next));
    list.push(next);
  }
  return list.slice(-SUBSCREEN_CREDITS_MAX);
}

/** The people (each name once) these credits name: new ones each cost a fee. */
export const subscreenCreditNames = (
  credits: readonly SubscreenCredit[] | null | undefined
): string[] => [
  ...new Set(
    subscreenCreditList(credits).map((credit) =>
      normalizePersonName(credit.displayName)
    )
  ),
];

/** Subscreen's person slug (`hn`), `p-` before one reading "profile…". */
export function subscreenPersonSlug(displayName: string): string {
  const slug =
    (displayName || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, PERSON_SLUG_MAX_LENGTH)
      .replace(/-$/, '') || 'person';
  return slug.startsWith('profile')
    ? `p-${slug}`.slice(0, PERSON_SLUG_MAX_LENGTH)
    : slug;
}

export type SubscreenPersonPlan = {
  ref: SubscreenPersonRef;
  document: { displayName: string };
  step: PublishStep;
};

/** A person Subscreen doesn't know yet, as its form publishes one (`zg`). */
export function buildSubscreenPerson({
  key,
  name,
  displayName,
  dependsOn = [],
  id = randomAlphanumeric(PERSON_ID_LENGTH),
}: {
  key: string;
  /** The publishing name. */
  name: string;
  displayName: string;
  dependsOn?: readonly string[];
  id?: string;
}): SubscreenPersonPlan {
  const publisher = (name || '').trim();
  if (!publisher) throw new VideoPublishError('name-required');
  const clean = cleanCreditName(displayName);
  if (!clean) throw new Error('A person needs a name');
  const identifier = `${SUBSCREEN_PERSON_BASE}${subscreenPersonSlug(clean)}_${id}`;
  const document = { displayName: clean };
  const base64 = jsonToBase64(document);
  return {
    ref: { name: publisher, identifier, service: 'DOCUMENT' },
    document,
    step: {
      key,
      kind: 'person',
      service: 'DOCUMENT',
      identifier,
      title: sliceText(clean, PERSON_TITLE_MAX_LENGTH),
      description: clean,
      filename: SUBSCREEN_PERSON_FILENAME,
      data: { base64 },
      ...(dependsOn.length ? { dependsOn: [...dependsOn] } : {}),
      bytes: base64ByteLength(base64),
    },
  };
}

/**
 * The credits' QDN description (Subscreen's `sa`): the names in lower case,
 * newest first, each once, as many as fit in 240 bytes.
 */
export function subscreenCreditsDescription(
  people: readonly Pick<SubscreenCreditEntry, 'displayName' | 'at'>[],
  maxBytes = SUBSCREEN_CREDITS_DESCRIPTION_MAX_BYTES
): string {
  const newestFirst = [...people].sort((a, b) => (b.at || 0) - (a.at || 0));
  const seen = new Set<string>();
  let description = '';
  for (const person of newestFirst) {
    const name = normalizePersonName(person.displayName);
    if (!name || seen.has(name)) continue;
    const next = description ? `${description} ${name}` : name;
    if (utf8Bytes(next).length > maxBytes) continue;
    seen.add(name);
    description = next;
  }
  return description;
}

/**
 * A title's first credits DOCUMENT, as Subscreen's `oa` writes one: every
 * entry stamped `at`, each person once per role.
 */
export function buildSubscreenCreditsDocument(
  titleRef: SubscreenTitleRef,
  entries: readonly (SubscreenCredit & { personRef: SubscreenPersonRef })[],
  at: number
): SubscreenCreditsDocument {
  let people: SubscreenCreditEntry[] = [];
  for (const entry of entries) {
    const displayName = cleanCreditName(entry.displayName);
    if (!displayName || !isSubscreenCreditRole(entry.role)) continue;
    const character =
      entry.role === 'actor'
        ? cleanCreditCharacter(entry.character)
        : undefined;
    const next: SubscreenCreditEntry = {
      personRef: {
        name: entry.personRef.name,
        identifier: entry.personRef.identifier,
        service: 'DOCUMENT',
      },
      role: entry.role,
      displayName,
      ...(character ? { character } : {}),
      at,
    };
    people = people.filter((other) => !sameCredit(other, next));
    people.push(next);
  }
  return {
    titleRef: {
      name: titleRef.name,
      identifier: titleRef.identifier,
      service: titleRef.service,
    },
    people: people.slice(-SUBSCREEN_CREDITS_MAX),
    version: 2,
  };
}

/** The credits DOCUMENT's publish: no tag, `credits.json`. */
export function buildSubscreenCreditsStep({
  key,
  document,
  dependsOn = [],
}: {
  key: string;
  document: SubscreenCreditsDocument;
  dependsOn?: readonly string[];
}): PublishStep {
  const base64 = jsonToBase64(document);
  return {
    key,
    kind: 'credits',
    service: 'DOCUMENT',
    identifier: subscreenCreditsIdentifier(document.titleRef),
    title: subscreenCreditsTitle(document.titleRef),
    description: subscreenCreditsDescription(document.people),
    filename: SUBSCREEN_CREDITS_FILENAME,
    data: { base64 },
    ...(dependsOn.length ? { dependsOn: [...dependsOn] } : {}),
    bytes: base64ByteLength(base64),
  };
}

/** A person Subscreen already knows, by name (subscreenPeople.ts), or null. */
export type FindSubscreenPerson = (
  displayName: string,
  signal?: AbortSignal
) => Promise<SubscreenPersonRef | null>;

export type SubscreenCreditsPlan = {
  /** New people first, then the credits. */
  steps: PublishStep[];
  /** The people Subscreen didn't know: published with the title. */
  people: SubscreenPersonPlan[];
  identifier: string;
  creditsStepKey: string;
  document: SubscreenCreditsDocument;
  /**
   * The credits DOCUMENT, for the title's record: Remove replaces it, never
   * a person (other titles may name them).
   */
  resource: PublishedResource;
};

/** Names looked up at once. */
const LOOKUP_CONCURRENCY = 4;

/**
 * The credits of a title and the people they need: each name Subscreen
 * already knows (`findPerson`, any publisher's) is pointed at, the others
 * are published first as new people. Null without a name: no credits
 * DOCUMENT then (never an empty one). Both wait for `dependsOn` (the
 * title's listing). Looking up never fails the plan: a name that can't be
 * looked up becomes a new person, as in Subscreen.
 */
export async function planSubscreenCredits({
  key = 'title',
  name,
  titleRef,
  credits,
  dependsOn = [],
  findPerson,
  signal,
  now = Date.now(),
}: {
  /** Prefix of the step keys. */
  key?: string;
  /** The publishing name. */
  name: string;
  titleRef: SubscreenTitleRef;
  credits: readonly SubscreenCredit[] | null | undefined;
  dependsOn?: readonly string[];
  findPerson: FindSubscreenPerson;
  /** A cancel stops the lookups (VideoPublishError 'cancelled'). */
  signal?: AbortSignal;
  now?: number;
}): Promise<SubscreenCreditsPlan | null> {
  const list = subscreenCreditList(credits);
  if (!list.length) return null;
  const publisher = (name || '').trim();
  if (!publisher) throw new VideoPublishError('name-required');

  // Each person once, in the order they're named.
  const names = new Map<string, string>();
  for (const credit of list) {
    const normalized = normalizePersonName(credit.displayName);
    if (!names.has(normalized)) names.set(normalized, credit.displayName);
  }
  const wanted = [...names.entries()];
  const found = new Map<string, SubscreenPersonRef | null>();
  let next = 0;
  const lookUp = async () => {
    while (next < wanted.length) {
      const [normalized, displayName] = wanted[next];
      next += 1;
      let ref: SubscreenPersonRef | null = null;
      try {
        ref = signal?.aborted ? null : await findPerson(displayName, signal);
      } catch {
        ref = null;
      }
      found.set(normalized, ref);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(LOOKUP_CONCURRENCY, wanted.length) }, lookUp)
  );
  if (signal?.aborted) throw new VideoPublishError('cancelled');

  const people: SubscreenPersonPlan[] = [];
  const refs = new Map<string, SubscreenPersonRef>();
  for (const [normalized, displayName] of wanted) {
    let ref = found.get(normalized) ?? null;
    if (!ref) {
      const person = buildSubscreenPerson({
        key: `${key}:person-${people.length}`,
        name: publisher,
        displayName,
        dependsOn,
      });
      people.push(person);
      ref = person.ref;
    }
    refs.set(normalized, ref);
  }

  const document = buildSubscreenCreditsDocument(
    titleRef,
    list.map((credit) => ({
      ...credit,
      personRef: refs.get(normalizePersonName(credit.displayName)),
    })),
    now
  );
  const creditsStepKey = `${key}:credits`;
  const step = buildSubscreenCreditsStep({
    key: creditsStepKey,
    document,
    dependsOn: [...dependsOn, ...people.map((person) => person.step.key)],
  });
  return {
    steps: [...people.map((person) => person.step), step],
    people,
    identifier: step.identifier,
    creditsStepKey,
    document,
    resource: {
      service: 'DOCUMENT',
      name: publisher,
      identifier: step.identifier,
      kind: 'credits',
      filename: SUBSCREEN_CREDITS_FILENAME,
    },
  };
}

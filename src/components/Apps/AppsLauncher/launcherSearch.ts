import { QORTAL_PROTOCOL } from '../../../constants/constants';
import { parseQortalUseGroupLink } from '../../../utils/qortalGroupLinks';
import {
  compareByWeightedRating,
  type RatingSummary,
} from '../../../utils/appRatingScore';
import { extractComponents } from '../../Chat/MessageDisplay';
import { isOfficialApp } from '../config/officialApps';

/** A Q-App or website as the node lists it (`/arbitrary/resources/search`). */
export type LauncherApp = {
  name?: string;
  service?: string;
  metadata?: {
    title?: string;
    description?: string;
    tags?: string[] | string;
    categoryName?: string;
  };
  [key: string]: unknown;
};

/** What the search box holds when it is an address, not search words. */
export type LauncherLink =
  | {
      kind: 'app';
      link: string;
      service: string;
      name: string;
      identifier?: string;
      path?: string;
    }
  | { kind: 'group'; link: string };

const PROTOCOL_PATTERN = /^qortal:\/\//i;
/** `APP/Q-Tube` or `WEBSITE/name/page`, the short way to write an address. */
const SHORT_LINK_PATTERN = /^(app|website)\/[^/\s]/i;

/**
 * Reads the search box as a qortal:// address. Search words are never taken
 * for one: only text that starts with `qortal://`, or with a service and a
 * slash, is.
 */
export function parseLauncherLink(input: string): LauncherLink | null {
  const text = (input ?? '').trim();
  if (!text) return null;

  let link: string;
  if (PROTOCOL_PATTERN.test(text)) {
    link = QORTAL_PROTOCOL + text.replace(PROTOCOL_PATTERN, '');
  } else if (SHORT_LINK_PATTERN.test(text)) {
    link = QORTAL_PROTOCOL + text;
  } else {
    return null;
  }

  if (parseQortalUseGroupLink(link)) return { kind: 'group', link };

  const parts = extractComponents(link);
  if (!parts?.service || !parts?.name) return null;
  return {
    kind: 'app',
    link,
    service: parts.service,
    name: parts.name,
    identifier: parts.identifier,
    path: parts.path,
  };
}

const lower = (value: unknown): string =>
  typeof value === 'string' ? value.toLowerCase().trim() : '';

/** Letters and digits only, so "qtube" finds "Q-Tube". */
const squash = (value: string): string => value.replace(/[^\p{L}\p{N}]+/gu, '');

const wordsOf = (value: string): string[] =>
  value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const tagsOf = (app: LauncherApp): string => {
  const tags = app?.metadata?.tags;
  if (Array.isArray(tags)) return tags.join(' ');
  return typeof tags === 'string' ? tags : '';
};

/** The worst rank that is still a match on the name or the title. */
const LAST_NAME_RANK = 4;

/**
 * How well an app matches, lower is better, or null for no match:
 * 0 the name or title is the query, 1 it has the query's words as whole
 * words, 2 it starts with the query, 3 its words start with the query's
 * words, 4 it contains the query, 5 only the description, tags or category
 * mention it.
 */
export function launcherMatchRank(
  app: LauncherApp,
  query: string
): number | null {
  const needle = lower(query);
  if (!needle) return null;

  const names = [lower(app?.metadata?.title), lower(app?.name)].filter(Boolean);
  if (names.length === 0) return null;

  if (names.some((name) => name === needle)) return 0;

  const tokens = wordsOf(needle);
  if (tokens.length === 0) return null;

  const wordsMatch = (
    name: string,
    matches: (word: string, token: string) => boolean
  ) => {
    const words = wordsOf(name);
    return tokens.every((token) => words.some((word) => matches(word, token)));
  };
  if (names.some((name) => wordsMatch(name, (word, token) => word === token))) {
    return 1;
  }
  if (names.some((name) => name.startsWith(needle))) return 2;
  if (
    names.some((name) =>
      wordsMatch(name, (word, token) => word.startsWith(token))
    )
  ) {
    return 3;
  }

  const squashedNeedle = squash(needle);
  const contains = (name: string) =>
    name.includes(needle) ||
    tokens.every((token) => name.includes(token)) ||
    (squashedNeedle.length >= 2 && squash(name).includes(squashedNeedle));
  if (names.some(contains)) return LAST_NAME_RANK;

  const everything = [
    ...names,
    lower(app?.metadata?.description),
    lower(tagsOf(app)),
    lower(app?.metadata?.categoryName),
  ].join(' ');
  if (tokens.every((token) => everything.includes(token))) {
    return LAST_NAME_RANK + 1;
  }

  return null;
}

const titleOf = (app: LauncherApp): string =>
  app?.metadata?.title || app?.name || '';

type LauncherSearchOptions<T> = {
  getRating?: (app: T) => RatingSummary | null | undefined;
  /** True for an app the account has pinned. */
  isPinned?: (app: T) => boolean;
};

/**
 * The apps that match the query, best first, so that Enter can open the first
 * one. Among the apps matching by name, the pinned ones come first and the
 * official ones next: a look-alike name must not get ahead of the app someone
 * is most likely typing. Then the better match, the better rated, and
 * alphabetical order.
 */
export function searchLauncherApps<T extends LauncherApp>(
  apps: T[],
  query: string,
  { getRating, isPinned }: LauncherSearchOptions<T> = {}
): T[] {
  if (!lower(query)) return [];

  const matches: { app: T; rank: number; trust: number }[] = [];
  for (const app of apps ?? []) {
    const rank = launcherMatchRank(app, query);
    if (rank === null) continue;
    let trust = 3;
    if (rank <= LAST_NAME_RANK) {
      if (isPinned?.(app)) trust = 0;
      else if (isOfficialApp(app?.name ?? '')) trust = 1;
      else trust = 2;
    }
    matches.push({ app, rank, trust });
  }

  matches.sort((a, b) => {
    if (a.trust !== b.trust) return a.trust - b.trust;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (getRating) {
      const byRating = compareByWeightedRating(
        getRating(a.app),
        getRating(b.app)
      );
      if (byRating !== 0) return byRating;
    }
    return titleOf(a.app).localeCompare(titleOf(b.app));
  });

  return matches.map((match) => match.app);
}

/** True when the label matches the query the way an app name would. */
export function launcherLabelMatches(label: string, query: string): boolean {
  const rank = launcherMatchRank({ name: label }, query);
  return rank !== null && rank <= LAST_NAME_RANK;
}

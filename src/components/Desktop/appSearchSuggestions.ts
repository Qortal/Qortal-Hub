import { appOpenCountKey, type AppOpenCounts } from './appOpenCounts';

/**
 * What the top bar suggests while the user types: the Q-Apps and websites the
 * Q-Apps library has already loaded, best match first, then a row that
 * searches the library. No extra calls to Core.
 */

/** A default APP or WEBSITE resource, as the Q-Apps library loads it. */
export type SearchableApp = {
  metadata?: {
    description?: unknown;
    tags?: unknown;
    title?: unknown;
  } | null;
  name: string;
  service: string;
};

export type AppSearchOption =
  | { app: SearchableApp; kind: 'app' }
  | { kind: 'library'; query: string };

/** App rows shown at most; the library row comes after them. */
export const MAX_APP_SUGGESTIONS = 7;

const SUGGESTED_SERVICES = new Set(['APP', 'WEBSITE']);

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const lowerTags = (app: SearchableApp): string[] => {
  const tags = app.metadata?.tags;
  return Array.isArray(tags)
    ? tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.toLowerCase())
    : [];
};

export const appTitle = (app: SearchableApp): string =>
  asText(app.metadata?.title).trim() || app.name;

/** Initials of the title's words: "Qortal Web Builder" gives "qwb". */
export const titleAcronym = (title: string): string =>
  title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('');

/**
 * How well `app` matches `query`: higher is better, 0 is no match. The exact
 * name comes first, so "QWB" finds the QWB app before looser matches.
 */
export const scoreAppSearchMatch = (
  app: SearchableApp,
  query: string
): number => {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const name = asText(app.name).toLowerCase();
  const title = asText(app.metadata?.title).toLowerCase();
  const description = asText(app.metadata?.description).toLowerCase();
  const tags = lowerTags(app);
  const acronym = titleAcronym(title);

  if (name === q) return 1000;
  if (title === q) return 900;
  if (tags.includes(q)) return 850;
  if (acronym === q) return 800;
  if (name.startsWith(q)) return 700;
  if (title.startsWith(q)) return 650;
  if (name.includes(q)) return 500;
  if (title.includes(q)) return 450;
  if (tags.some((tag) => tag.includes(q))) return 400;
  if (q.length >= 2 && acronym.includes(q)) return 350;
  if (description.includes(q)) return 200;
  return 0;
};

/**
 * The Q-Apps and websites matching `query`. Best match first, then the most
 * opened, then Q-Apps before websites, then by title.
 */
export const rankAppSearchMatches = (
  query: string,
  apps: readonly SearchableApp[],
  openCounts: AppOpenCounts = {}
): SearchableApp[] => {
  const seen = new Set<string>();
  const matches: {
    app: SearchableApp;
    count: number;
    score: number;
    service: string;
  }[] = [];

  for (const app of apps) {
    if (!app || typeof app.name !== 'string' || !app.name.trim()) continue;
    const service = asText(app.service).toUpperCase();
    if (!SUGGESTED_SERVICES.has(service)) continue;
    const key = appOpenCountKey(service, app.name);
    if (!key || seen.has(key)) continue;
    const score = scoreAppSearchMatch(app, query);
    if (score <= 0) continue;
    seen.add(key);
    matches.push({ app, count: openCounts[key] ?? 0, score, service });
  }

  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.count - left.count ||
        (left.service === right.service
          ? 0
          : left.service === 'APP'
            ? -1
            : 1) ||
        appTitle(left.app).localeCompare(appTitle(right.app))
    )
    .map(({ app }) => app);
};

/**
 * The rows for what the user typed: matching Q-Apps and websites, then one
 * that searches the library. None for an empty input or a qortal:// link,
 * which Enter opens as before.
 */
export const buildAppSearchOptions = (
  input: string,
  apps: readonly SearchableApp[],
  openCounts: AppOpenCounts = {}
): AppSearchOption[] => {
  const query = input.trim();
  if (!query || /^qortal:\/\//i.test(query)) return [];
  return [
    ...rankAppSearchMatches(query, apps, openCounts)
      .slice(0, MAX_APP_SUGGESTIONS)
      .map((app) => ({ app, kind: 'app' as const })),
    { kind: 'library', query },
  ];
};

/** The Q-App or website named exactly `input`: Enter opens it directly. */
export const exactAppNameMatch = (
  input: string,
  apps: readonly SearchableApp[],
  openCounts: AppOpenCounts = {}
): SearchableApp | null => {
  const query = input.trim().toLowerCase();
  if (!query || query.startsWith('qortal://')) return null;
  return (
    rankAppSearchMatches(query, apps, openCounts).find(
      (app) => app.name.trim().toLowerCase() === query
    ) ?? null
  );
};

/**
 * `text` split around the first place `query` appears in it, in any case, to
 * draw the matched letters differently. Without a match, all of it is `before`.
 */
export const splitFirstMatch = (
  text: string,
  query: string
): { after: string; before: string; match: string } => {
  const needle = query.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return { after: '', before: text, match: '' };
  return {
    after: text.slice(at + needle.length),
    before: text.slice(0, at),
    match: text.slice(at, at + needle.length),
  };
};

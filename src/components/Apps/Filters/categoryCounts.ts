import type { StatusFilterOption } from './StatusFilter';

export type LibraryCategory = { id: string; name: string };

export type CategoryCounts = {
  /** Every app counted, also the ones without a category. */
  total: number;
  byId: Map<string, number>;
};

/** Lower case, without accents, for matching what someone types. */
export const normalizeForSearch = (value = '') =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * How many apps each category holds. The status filter works as the library's
 * does: installed means the node has the app ready.
 */
export const countCategories = (
  apps: readonly any[],
  status: StatusFilterOption = 'all'
): CategoryCounts => {
  const byId = new Map<string, number>();
  let total = 0;
  (apps ?? []).forEach((app) => {
    if (status !== 'all') {
      const isInstalled = app?.status?.status === 'READY';
      if (status === 'installed' ? !isInstalled : isInstalled) return;
    }
    total += 1;
    const id = app?.metadata?.category;
    if (id) byId.set(id, (byId.get(id) ?? 0) + 1);
  });
  return { total, byId };
};

/** Categories in alphabetical order, in the reader's language. */
export const sortCategoriesByName = <T extends LibraryCategory>(
  categories: readonly T[],
  locale?: string
): T[] =>
  [...(categories ?? [])].sort((a, b) => {
    try {
      return (a?.name ?? '').localeCompare(b?.name ?? '', locale, {
        sensitivity: 'base',
      });
    } catch {
      return (a?.name ?? '').localeCompare(b?.name ?? '');
    }
  });

/**
 * Whether a category matches what was typed: its name, or its id with
 * underscores read as spaces ("self suff" finds SELF_SUFFICIENCY).
 */
export const categoryMatches = (
  category: LibraryCategory,
  query: string
): boolean => {
  const wanted = normalizeForSearch(query.trim());
  if (!wanted) return true;
  return (
    normalizeForSearch(category?.name ?? '').includes(wanted) ||
    normalizeForSearch((category?.id ?? '').replace(/_/g, ' ')).includes(wanted)
  );
};

import { atom } from 'jotai';
import { atomWithReset } from 'jotai/utils';

// Types
export type SortOption = 'alphabetical' | 'newest' | 'oldest';

export type StatusFilterOption = 'all' | 'installed' | 'not_installed';

export type PageSize = 10 | 25 | 50;

// Filter atoms
export const appSortAtom = atomWithReset<SortOption>('newest');
export const appCategoryFilterAtom = atomWithReset<string>('all');
export const appStatusFilterAtom = atomWithReset<StatusFilterOption>('all');
export const appSearchQueryAtom = atomWithReset<string>('');

// Pagination atoms
export const communityPageSizeAtom = atomWithReset<PageSize>(10);

// Current tab atom
export type AppsLibraryTab =
  | 'categories'
  | 'community'
  | 'my-apps'
  | 'official';
export const currentAppsTabAtom = atomWithReset<AppsLibraryTab>('official');

// Helper function to filter and sort apps
export const filterAndSortApps = (
  apps: any[],
  options: {
    sort: SortOption;
    category: string;
    status: StatusFilterOption;
    search: string;
    installedApps?: Set<string>;
  }
) => {
  const { sort, category, status, search, installedApps = new Set() } = options;

  let filtered = [...apps];

  // Filter by search
  if (search) {
    const lowerSearch = search.toLowerCase();
    filtered = filtered.filter(
      (app) =>
        app.name.toLowerCase().includes(lowerSearch) ||
        app?.metadata?.title?.toLowerCase().includes(lowerSearch) ||
        app?.metadata?.description?.toLowerCase().includes(lowerSearch)
    );
  }

  // Filter by category
  if (category && category !== 'all') {
    filtered = filtered.filter((app) => app?.metadata?.category === category);
  }

  // Filter by status
  if (status !== 'all') {
    filtered = filtered.filter((app) => {
      const isInstalled = app?.status?.status === 'READY';
      return status === 'installed' ? isInstalled : !isInstalled;
    });
  }

  // Sort
  switch (sort) {
    case 'newest':
      filtered.sort((a, b) => (b.created || 0) - (a.created || 0));
      break;
    case 'oldest':
      filtered.sort((a, b) => (a.created || 0) - (b.created || 0));
      break;
    case 'alphabetical':
      filtered.sort((a, b) => {
        const nameA = a?.metadata?.title || a.name || '';
        const nameB = b?.metadata?.title || b.name || '';
        return nameA.localeCompare(nameB);
      });
      break;
    default:
      break;
  }

  return filtered;
};

// Derived atom for filtered apps count
export const filteredAppsCountAtom = atom((get) => {
  // This is a placeholder - actual filtering happens in components
  // with access to the full app list
  return 0;
});

import { atom } from 'jotai';
import { LIBRARY_VIEW_STORAGE_KEY } from './libraryLayout';

export type LibraryView = 'grid' | 'list';

/** The stored choice; grid when nothing (or something else) is stored. */
export const readLibraryView = (): LibraryView => {
  try {
    return localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY) === 'list'
      ? 'list'
      : 'grid';
  } catch {
    return 'grid';
  }
};

// 'unset' rather than null: without strict null checks, `atom(null)` would
// read as a read-only atom.
const chosenViewAtom = atom<LibraryView | 'unset'>('unset');

/**
 * Grid or list: one choice per device for every library tab, the search
 * results and the category page. Every mounted launcher shares it.
 */
export const libraryViewAtom = atom(
  (get) => {
    const chosen = get(chosenViewAtom);
    return chosen === 'unset' ? readLibraryView() : chosen;
  },
  (_get, set, next: LibraryView) => {
    set(chosenViewAtom, next);
    try {
      localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, next);
    } catch {
      // Without storage the choice lasts this session.
    }
  }
);

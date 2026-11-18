import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { LIBRARY_VIEW_STORAGE_KEY } from './libraryLayout';
import { libraryViewAtom, readLibraryView } from './libraryView';

describe('libraryViewAtom', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts as a grid', () => {
    expect(createStore().get(libraryViewAtom)).toBe('grid');
  });

  it('reads a stored list', () => {
    localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, 'list');
    expect(createStore().get(libraryViewAtom)).toBe('list');
  });

  it('takes anything else that is stored as a grid', () => {
    localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, 'tiles');
    expect(readLibraryView()).toBe('grid');
  });

  it('stores the choice', () => {
    const store = createStore();
    store.set(libraryViewAtom, 'list');
    expect(store.get(libraryViewAtom)).toBe('list');
    expect(localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY)).toBe('list');
  });

  it('falls back to a grid when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(createStore().get(libraryViewAtom)).toBe('grid');
  });

  it('keeps the choice for the session when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const store = createStore();
    store.set(libraryViewAtom, 'list');
    expect(store.get(libraryViewAtom)).toBe('list');
  });

  it('gives every reader of one store the same view', () => {
    const store = createStore();
    const first = vi.fn();
    const second = vi.fn();
    store.sub(libraryViewAtom, () => first(store.get(libraryViewAtom)));
    store.sub(libraryViewAtom, () => second(store.get(libraryViewAtom)));

    store.set(libraryViewAtom, 'list');

    expect(first).toHaveBeenLastCalledWith('list');
    expect(second).toHaveBeenLastCalledWith('list');
  });
});

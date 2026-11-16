import { describe, expect, it } from 'vitest';
import {
  isPinnedTab,
  moveTabWithinGroup,
  pinnedFirst,
  setTabPinned,
} from './tabPinning';

type Tab = { tabId: string; pinned?: boolean; name?: string };

const tab = (tabId: string): Tab => ({ tabId });
const pinned = (tabId: string): Tab => ({ tabId, pinned: true });
const ids = (tabs: Tab[]) =>
  tabs.map((t) => (isPinnedTab(t) ? `${t.tabId}*` : t.tabId)).join(' ');

describe('pinnedFirst', () => {
  it('puts pinned tabs first and keeps each group in its order', () => {
    const tabs = [tab('a'), pinned('p'), tab('b'), pinned('q')];
    expect(ids(pinnedFirst(tabs))).toBe('p* q* a b');
  });

  it('gives back the same list when the order is already right', () => {
    const tabs = [pinned('p'), tab('a')];
    expect(pinnedFirst(tabs)).toBe(tabs);
    const none = [tab('a'), tab('b')];
    expect(pinnedFirst(none)).toBe(none);
  });
});

describe('setTabPinned', () => {
  it('pins a tab at the end of the pinned tabs', () => {
    const tabs = [pinned('p'), tab('a'), tab('b'), tab('c')];
    const next = setTabPinned(tabs, 'c', true);
    expect(ids(next)).toBe('p* c* a b');
    expect(next[1]).toEqual({ tabId: 'c', pinned: true });
  });

  it('unpins a tab to the start of the other tabs, without the key', () => {
    const tabs = [pinned('p'), pinned('q'), tab('a')];
    const next = setTabPinned(tabs, 'p', false);
    expect(ids(next)).toBe('q* p a');
    expect(next[1]).toEqual({ tabId: 'p' });
    expect('pinned' in next[1]).toBe(false);
  });

  it('keeps the rest of the tab as it was', () => {
    const tabs: Tab[] = [{ name: 'Q-Tube', tabId: 'a' }];
    expect(setTabPinned(tabs, 'a', true)).toEqual([
      { name: 'Q-Tube', pinned: true, tabId: 'a' },
    ]);
  });

  it('changes nothing for an unknown tab or one already that way', () => {
    const tabs = [pinned('p'), tab('a')];
    expect(setTabPinned(tabs, 'x', true)).toBe(tabs);
    expect(setTabPinned(tabs, 'p', true)).toBe(tabs);
    expect(setTabPinned(tabs, 'a', false)).toBe(tabs);
  });
});

describe('moveTabWithinGroup', () => {
  const tabs = [pinned('p'), pinned('q'), tab('a'), tab('b'), tab('c')];

  it('reorders tabs that are not pinned among themselves', () => {
    expect(ids(moveTabWithinGroup(tabs, 'c', 'a'))).toBe('p* q* c a b');
    expect(ids(moveTabWithinGroup(tabs, 'a', 'c'))).toBe('p* q* b c a');
  });

  it('reorders pinned tabs among themselves', () => {
    expect(ids(moveTabWithinGroup(tabs, 'q', 'p'))).toBe('q* p* a b c');
  });

  it('keeps a tab out of the other group, both ways', () => {
    expect(moveTabWithinGroup(tabs, 'a', 'p')).toBe(tabs);
    expect(moveTabWithinGroup(tabs, 'q', 'b')).toBe(tabs);
  });

  it('keeps pinned tabs first even if the list came in mixed', () => {
    const mixed = [tab('a'), pinned('p'), tab('b')];
    expect(ids(moveTabWithinGroup(mixed, 'b', 'a'))).toBe('p* b a');
  });

  it('changes nothing for unknown tabs or a drop on itself', () => {
    expect(moveTabWithinGroup(tabs, 'x', 'a')).toBe(tabs);
    expect(moveTabWithinGroup(tabs, 'a', 'x')).toBe(tabs);
    expect(moveTabWithinGroup(tabs, 'a', 'a')).toBe(tabs);
  });
});

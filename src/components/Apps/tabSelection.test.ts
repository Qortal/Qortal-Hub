import { describe, expect, it } from 'vitest';
import {
  closeAllKeptNoteKey,
  pickNextTabFromMru,
  tabsLeftByCloseAll,
} from './tabSelection';

const tab = (tabId: string, lock = false) => ({ tabId, lock });
const pinnedTab = (tabId: string, lock = false) => ({
  tabId,
  lock,
  pinned: true,
});

describe('tabsLeftByCloseAll', () => {
  it('closes everything when no tab is locked', () => {
    expect(tabsLeftByCloseAll([tab('a'), tab('b')], 'a', ['a', 'b'])).toEqual({
      kept: [],
      nextTab: null,
    });
  });

  it('keeps locked tabs open, in their order', () => {
    const tabs = [tab('a'), tab('b', true), tab('c'), tab('d', true)];
    expect(tabsLeftByCloseAll(tabs, 'a', []).kept).toEqual([
      tab('b', true),
      tab('d', true),
    ]);
  });

  it('stays on the selected tab when it is locked', () => {
    const tabs = [tab('a', true), tab('b', true)];
    expect(tabsLeftByCloseAll(tabs, 'b', ['b', 'a']).nextTab).toEqual(
      tab('b', true)
    );
  });

  it('otherwise shows the most recently visited locked tab', () => {
    const tabs = [tab('a', true), tab('b'), tab('c', true)];
    expect(tabsLeftByCloseAll(tabs, 'b', ['c', 'a', 'b']).nextTab).toEqual(
      tab('a', true)
    );
  });

  it('falls back to the first locked tab', () => {
    const tabs = [tab('a'), tab('b', true), tab('c', true)];
    expect(tabsLeftByCloseAll(tabs, 'a', []).nextTab).toEqual(tab('b', true));
  });

  it('keeps pinned tabs open too, with the locked ones, in their order', () => {
    const tabs = [pinnedTab('p'), tab('a'), tab('b', true), tab('c')];
    expect(tabsLeftByCloseAll(tabs, 'a', []).kept).toEqual([
      pinnedTab('p'),
      tab('b', true),
    ]);
  });

  it('stays on a selected pinned tab, or shows the latest pinned one', () => {
    const tabs = [pinnedTab('p'), pinnedTab('q'), tab('a')];
    expect(tabsLeftByCloseAll(tabs, 'q', []).nextTab).toEqual(pinnedTab('q'));
    expect(tabsLeftByCloseAll(tabs, 'a', ['q', 'p', 'a']).nextTab).toEqual(
      pinnedTab('p')
    );
  });
});

describe('closeAllKeptNoteKey', () => {
  it('has no note when nothing stayed open', () => {
    expect(closeAllKeptNoteKey([])).toBeNull();
  });

  it('names the kind of tab that stayed open', () => {
    expect(closeAllKeptNoteKey([tab('a', true)])).toBe(
      'core:app_tab.locked_kept_open'
    );
    expect(closeAllKeptNoteKey([pinnedTab('p')])).toBe(
      'core:app_tab.pinned_kept_open'
    );
  });

  it('has one note when both kinds stayed open', () => {
    expect(closeAllKeptNoteKey([pinnedTab('p'), tab('a', true)])).toBe(
      'core:app_tab.pinned_and_locked_kept_open'
    );
    expect(closeAllKeptNoteKey([pinnedTab('p', true)])).toBe(
      'core:app_tab.pinned_and_locked_kept_open'
    );
  });
});

describe('pickNextTabFromMru', () => {
  it('picks the most recent remaining tab', () => {
    expect(pickNextTabFromMru([tab('a'), tab('b')], ['b', 'x', 'a'])).toEqual(
      tab('a')
    );
  });

  it('gives null when nothing remains or nothing was visited', () => {
    expect(pickNextTabFromMru([], ['a'])).toBeNull();
    expect(pickNextTabFromMru([tab('a')], ['x'])).toBeNull();
  });
});

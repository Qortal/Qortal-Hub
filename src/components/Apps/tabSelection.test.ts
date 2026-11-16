import { describe, expect, it } from 'vitest';
import {
  keptOpenNoteKey,
  otherTabIds,
  pickNextTabFromMru,
  staysOpenWithOthers,
  tabIdsToTheRight,
  tabToShowAfterClose,
} from './tabSelection';

const tab = (tabId: string, lock = false) => ({ tabId, lock });
const pinnedTab = (tabId: string, lock = false) => ({
  tabId,
  lock,
  pinned: true,
});
const ids = (tabs: { tabId: string }[]) => tabs.map((item) => item.tabId);

describe('staysOpenWithOthers', () => {
  it('keeps locked and pinned tabs open, and closes the rest', () => {
    const tabs = [pinnedTab('p'), tab('a'), tab('b', true), tab('c')];
    expect(ids(tabs.filter(staysOpenWithOthers))).toEqual(['p', 'b']);
    expect(ids(tabs.filter((item) => !staysOpenWithOthers(item)))).toEqual([
      'a',
      'c',
    ]);
  });
});

describe('otherTabIds', () => {
  const tabs = [pinnedTab('p'), pinnedTab('q'), tab('a'), tab('b'), tab('c')];

  it('names every other tab but the pinned ones, in their order', () => {
    expect(otherTabIds(tabs, 'b')).toEqual(['a', 'c']);
  });

  it('leaves the other pinned tabs open from a pinned tab too', () => {
    expect(otherTabIds(tabs, 'p')).toEqual(['a', 'b', 'c']);
  });

  it('names nothing when there is no other tab to close', () => {
    expect(otherTabIds([tab('a')], 'a')).toEqual([]);
    expect(otherTabIds([pinnedTab('p'), tab('a')], 'a')).toEqual([]);
  });
});

describe('tabIdsToTheRight', () => {
  const tabs = [pinnedTab('p'), pinnedTab('q'), tab('a'), tab('b'), tab('c')];

  it('names the tabs after the given one', () => {
    expect(tabIdsToTheRight(tabs, 'a')).toEqual(['b', 'c']);
  });

  it('leaves pinned tabs open, the ones after a pinned tab too', () => {
    expect(tabIdsToTheRight(tabs, 'p')).toEqual(['a', 'b', 'c']);
  });

  it('names nothing for the last tab or a tab that is gone', () => {
    expect(tabIdsToTheRight(tabs, 'c')).toEqual([]);
    expect(tabIdsToTheRight(tabs, 'x')).toEqual([]);
  });
});

describe('tabToShowAfterClose', () => {
  const before = [tab('a'), tab('b'), tab('c'), tab('d')];
  const without = (...closed: string[]) =>
    before.filter((item) => !closed.includes(item.tabId));

  it('stays on the selected tab while it is open', () => {
    expect(tabToShowAfterClose(before, without('a', 'c'), 'b', [])).toEqual(
      tab('b')
    );
  });

  it('shows the most recently visited open tab when the selected one closed', () => {
    expect(
      tabToShowAfterClose(before, without('b'), 'b', ['d', 'a', 'b'])
    ).toEqual(tab('a'));
  });

  it('otherwise shows the open tab on its right, else the one on its left', () => {
    expect(tabToShowAfterClose(before, without('b', 'c'), 'b', [])).toEqual(
      tab('d')
    );
    expect(tabToShowAfterClose(before, without('c', 'd'), 'd', [])).toEqual(
      tab('b')
    );
  });

  it('shows a tab that stayed open, a locked or pinned one', () => {
    const tabs = [pinnedTab('p'), pinnedTab('q'), tab('a'), tab('b', true)];
    const left = tabs.filter(staysOpenWithOthers);
    expect(tabToShowAfterClose(tabs, left, 'q', [])).toEqual(pinnedTab('q'));
    expect(tabToShowAfterClose(tabs, left, 'a', ['q', 'p', 'a'])).toEqual(
      pinnedTab('p')
    );
    expect(tabToShowAfterClose(tabs, left, 'a', [])).toEqual(tab('b', true));
  });

  it('shows nothing when no tab was selected or none is left', () => {
    expect(tabToShowAfterClose(before, without('a'), null, ['b'])).toBeNull();
    expect(tabToShowAfterClose(before, [], 'a', ['a'])).toBeNull();
  });
});

describe('keptOpenNoteKey', () => {
  it('has no note when nothing stayed open', () => {
    expect(keptOpenNoteKey([])).toBeNull();
  });

  it('names the kind of tab that stayed open', () => {
    expect(keptOpenNoteKey([tab('a', true)])).toBe(
      'core:app_tab.locked_kept_open'
    );
    expect(keptOpenNoteKey([pinnedTab('p')])).toBe(
      'core:app_tab.pinned_kept_open'
    );
  });

  it('has one note when both kinds stayed open', () => {
    expect(keptOpenNoteKey([pinnedTab('p'), tab('a', true)])).toBe(
      'core:app_tab.pinned_and_locked_kept_open'
    );
    expect(keptOpenNoteKey([pinnedTab('p', true)])).toBe(
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

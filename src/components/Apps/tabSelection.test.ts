import { describe, expect, it } from 'vitest';
import { pickNextTabFromMru, tabsLeftByCloseAll } from './tabSelection';

const tab = (tabId: string, lock = false) => ({ tabId, lock });

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

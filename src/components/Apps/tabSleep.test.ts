import { describe, expect, it, vi } from 'vitest';
import { buildQortalResourceLink } from '../../utils/qortalLink';
import { newLauncherTab } from './launcherTabs';
import {
  holdsAnApp,
  MAX_AWAKE_APP_TABS,
  MAX_OPEN_APP_TABS,
  neverSleeps,
  tabAtItsPage,
  tabsToPutToSleep,
} from './tabSleep';

const app = (n: number, extra: Record<string, unknown> = {}) => ({
  tabId: `t${n}`,
  service: 'APP',
  name: `App ${n}`,
  ...extra,
});

/** Apps 1..count, all loaded, viewed in that order. */
const loaded = (count: number) => {
  const tabs = Array.from({ length: count }, (_, i) => app(i + 1));
  return {
    awakeTabIds: new Set(tabs.map((tab) => tab.tabId)),
    recentTabIds: tabs.map((tab) => tab.tabId),
    tabs,
  };
};

describe('tab limits', () => {
  it('opens up to 50 tabs, with up to 10 apps loaded', () => {
    expect(MAX_OPEN_APP_TABS).toBe(50);
    expect(MAX_AWAKE_APP_TABS).toBe(10);
  });
});

describe('tabsToPutToSleep', () => {
  it('puts none to sleep while ten apps or fewer are loaded', () => {
    const state = loaded(10);
    expect(
      tabsToPutToSleep({ ...state, isBusy: () => false, shownTabId: 't10' })
    ).toEqual([]);
  });

  it('puts the app viewed least recently to sleep when an eleventh loads', () => {
    const state = loaded(11);
    // App 1 was viewed again after the others.
    state.recentTabIds = [
      't2',
      't3',
      't4',
      't5',
      't6',
      't7',
      't8',
      't9',
      't10',
      't1',
      't11',
    ];

    expect(
      tabsToPutToSleep({ ...state, isBusy: () => false, shownTabId: 't11' })
    ).toEqual(['t2']);
  });

  it('counts a tab never viewed as viewed longest ago', () => {
    const state = loaded(11);
    state.recentTabIds = state.recentTabIds.filter((id) => id !== 't7');

    expect(
      tabsToPutToSleep({ ...state, isBusy: () => false, shownTabId: 't11' })
    ).toEqual(['t7']);
  });

  it('puts as many to sleep as are loaded over the limit', () => {
    const state = loaded(13);
    expect(
      tabsToPutToSleep({ ...state, isBusy: () => false, shownTabId: 't13' })
    ).toEqual(['t1', 't2', 't3']);
  });

  it('never puts the tab on screen to sleep', () => {
    const state = loaded(11);
    expect(
      tabsToPutToSleep({ ...state, isBusy: () => false, shownTabId: 't1' })
    ).toEqual(['t2']);
  });

  it.each([
    ['its app asked to confirm closing it', { lock: true }],
    ['it is a private app', { isPrivate: true, isPreview: true, url: 'x' }],
    ['it is a copy the node built for this run', { isPreview: true }],
    ['it is a Dev Mode tab', { service: undefined, url: 'http://dev' }],
  ])('never puts a tab to sleep when %s', (_case, extra) => {
    const state = loaded(11);
    state.tabs[0] = { ...state.tabs[0], ...extra };

    expect(
      tabsToPutToSleep({ ...state, isBusy: () => false, shownTabId: 't11' })
    ).toEqual(['t2']);
  });

  it('skips a busy tab, asking only until enough are found', () => {
    const state = loaded(11);
    const isBusy = vi.fn((tab) => tab.tabId === 't1');

    expect(tabsToPutToSleep({ ...state, isBusy, shownTabId: 't11' })).toEqual([
      't2',
    ]);
    expect(isBusy.mock.calls.map(([tab]) => tab.tabId)).toEqual(['t1', 't2']);
  });

  it('leaves more loaded when too few can sleep', () => {
    const state = loaded(12);
    const isBusy = (tab) => tab.tabId !== 't5';

    expect(tabsToPutToSleep({ ...state, isBusy, shownTabId: 't12' })).toEqual([
      't5',
    ]);
  });

  it("doesn't count Hub's own tabs or apps that aren't loaded", () => {
    const state = loaded(10);
    const tabs = [
      ...state.tabs,
      newLauncherTab('l1'),
      { tabId: 'chat', internal: 'qchat', service: 'INTERNAL', name: 'Q-Chat' },
      app(11),
    ];
    const awakeTabIds = new Set([...state.awakeTabIds, 'l1', 'chat']);

    expect(
      tabsToPutToSleep({
        awakeTabIds,
        isBusy: () => false,
        recentTabIds: [...state.recentTabIds, 'l1', 'chat'],
        shownTabId: 'chat',
        tabs,
      })
    ).toEqual([]);
  });
});

describe('which tabs hold an app', () => {
  it('counts apps and Dev Mode tabs, not launcher or Q-Chat tabs', () => {
    expect(holdsAnApp(app(1))).toBe(true);
    expect(holdsAnApp({ tabId: 'd', url: 'http://dev' })).toBe(true);
    expect(holdsAnApp(newLauncherTab('l1'))).toBe(false);
    expect(holdsAnApp({ tabId: 'c', internal: 'qchat' })).toBe(false);
    expect(holdsAnApp(null)).toBe(false);
  });

  it('lets only a published app or website sleep', () => {
    expect(neverSleeps(app(1))).toBe(false);
    expect(neverSleeps({ ...app(1), isPrivate: true })).toBe(true);
    expect(neverSleeps({ ...app(1), isPreview: true })).toBe(true);
    expect(neverSleeps({ tabId: 'd', url: 'http://dev' })).toBe(true);
  });
});

describe('tabAtItsPage', () => {
  const tube = {
    tabId: 't1',
    service: 'APP',
    name: 'Q-Tube',
    identifier: 'v1',
    path: 'start',
  };
  const link = (path: string) =>
    buildQortalResourceLink({
      service: 'APP',
      name: 'Q-Tube',
      path,
      identifier: 'v1',
    });

  it('keeps the page the app showed last, without Hub’s own parameters', () => {
    expect(tabAtItsPage(tube, link('/video/abc?t=5'))).toEqual({
      ...tube,
      path: 'video/abc?t=5',
    });
  });

  it('goes back to the start page the app showed last', () => {
    const { path: _path, ...withoutPath } = tube;
    expect(tabAtItsPage(tube, link('/'))).toEqual(withoutPath);
  });

  it('keeps where the tab was opened while its app has said nothing', () => {
    expect(tabAtItsPage(tube, link(''))).toBe(tube);
    expect(tabAtItsPage(tube, undefined)).toBe(tube);
  });

  it("ignores another app's link", () => {
    const other = buildQortalResourceLink({
      service: 'APP',
      name: 'Q-Mail',
      path: '/inbox',
    });
    expect(tabAtItsPage(tube, other)).toBe(tube);
  });

  it('gives the same tab back when its page is already the one kept', () => {
    expect(tabAtItsPage(tube, link('/start'))).toBe(tube);
  });

  it('keeps a fragment or a hash route as the app showed it', () => {
    expect(tabAtItsPage(tube, link('/guide#install')).path).toBe(
      'guide#install'
    );
    expect(tabAtItsPage(tube, link('/#/search?q=a')).path).toBe('#/search?q=a');
  });

  it('drops a page that would leave the app', () => {
    const { path: _path, ...withoutPath } = tube;
    expect(tabAtItsPage(tube, link('/../other'))).toEqual(withoutPath);
  });
});

import { describe, expect, it } from 'vitest';
import {
  canGoBackInLauncher,
  inLauncherTab,
  isLauncherTab,
  keepOpenLauncherStates,
  launcherPageBack,
  launcherTabToShow,
  newLauncherTab,
  newLauncherTabState,
  restartLauncher,
  showAppInfo,
  showCategory,
  showPublishPage,
} from './launcherTabs';

const tube = { tabId: 'tube', service: 'APP', name: 'Q-Tube' };
const chat = { tabId: 'chat', internal: 'q-chat', service: 'INTERNAL' };
const app = { name: 'Q-Mail', service: 'APP' };
const games = { id: 'games', name: 'Games' };

describe('launcher tabs', () => {
  it('are internal tabs of their own, unlike Q-Chat', () => {
    const tab = newLauncherTab('l1');
    expect(tab).toEqual({
      tabId: 'l1',
      internal: 'launcher',
      service: 'INTERNAL',
    });
    expect(isLauncherTab(tab)).toBe(true);
    expect(isLauncherTab(chat)).toBe(false);
    expect(isLauncherTab(tube)).toBe(false);
    expect(isLauncherTab(null)).toBe(false);
  });

  it('start at the launcher, with the search they were opened with', () => {
    expect(newLauncherTabState()).toEqual({
      page: 'launcher',
      appInfo: null,
      category: null,
      publishEditTarget: null,
      request: { nonce: 0, query: '' },
    });
    expect(newLauncherTabState('mail').request.query).toBe('mail');
  });
});

describe('the pages of a launcher tab', () => {
  it("open an app's details, from the launcher or from a category", () => {
    const fromLauncher = showAppInfo(newLauncherTabState(), app);
    expect(fromLauncher).toMatchObject({ page: 'appInfo', appInfo: app });

    const inCategory = showCategory(newLauncherTabState(), games);
    expect(inCategory).toMatchObject({ page: 'category', category: games });
    expect(showAppInfo(inCategory, app, true)).toMatchObject({
      page: 'appInfo-from-category',
      appInfo: app,
      category: games,
    });
  });

  it('open the publish pages, with what an update is for', () => {
    const target = { name: 'alice', service: 'WEBSITE' as const };
    expect(
      showPublishPage(newLauncherTabState(), 'publish', target)
    ).toMatchObject({ page: 'publish', publishEditTarget: target });
    expect(showPublishPage(newLauncherTabState(), 'publish-app')).toMatchObject(
      { page: 'publish-app', publishEditTarget: null }
    );

    // Only publish pages open this way.
    const state = newLauncherTabState();
    expect(showPublishPage(state, 'viewer')).toBe(state);
  });

  it('go back the way they came', () => {
    const inCategory = showCategory(newLauncherTabState(), games);
    const details = showAppInfo(inCategory, app, true);
    expect(canGoBackInLauncher(details)).toBe(true);

    const backInCategory = launcherPageBack(details);
    expect(backInCategory).toMatchObject({
      page: 'category',
      category: games,
    });
    expect(launcherPageBack(backInCategory)).toMatchObject({
      page: 'launcher',
      category: null,
    });

    const target = { name: 'alice', service: 'APP' as const };
    const publishing = showPublishPage(
      newLauncherTabState(),
      'publish',
      target
    );
    expect(launcherPageBack(publishing)).toMatchObject({
      page: 'launcher',
      publishEditTarget: null,
    });
    expect(launcherPageBack(showAppInfo(newLauncherTabState(), app)).page).toBe(
      'launcher'
    );
  });

  it('have nothing to go back to at the launcher', () => {
    const state = newLauncherTabState();
    expect(canGoBackInLauncher(state)).toBe(false);
    expect(canGoBackInLauncher(undefined)).toBe(false);
    expect(launcherPageBack(state)).toBe(state);
  });

  it('start over at the launcher for a search, with a new request', () => {
    const target = { name: 'alice', service: 'APP' as const };
    const publishing = showPublishPage(
      newLauncherTabState(),
      'publish',
      target
    );
    const searched = restartLauncher(publishing, 'tube');
    expect(searched).toEqual({
      page: 'launcher',
      appInfo: null,
      category: null,
      publishEditTarget: null,
      request: { nonce: 1, query: 'tube' },
    });
    expect(restartLauncher(searched, '').request).toEqual({
      nonce: 2,
      query: '',
    });
  });
});

describe('launcherTabToShow', () => {
  const first = newLauncherTab('l1');
  const second = newLauncherTab('l2');
  const tabs = [first, tube, second, chat];

  it('is the launcher tab on screen', () => {
    expect(launcherTabToShow(tabs, 'l1', ['l2', 'l1'])).toBe(first);
  });

  it('else the launcher tab viewed last', () => {
    expect(launcherTabToShow(tabs, 'tube', ['l2', 'l1', 'tube'])).toBe(first);
    expect(launcherTabToShow(tabs, 'tube', ['l1', 'l2', 'tube'])).toBe(second);
  });

  it('else the last one in the strip, or none', () => {
    expect(launcherTabToShow(tabs, null, [])).toBe(second);
    expect(launcherTabToShow([tube, chat], 'tube', ['tube'])).toBeNull();
  });
});

describe('keepOpenLauncherStates', () => {
  it('drops the states of launcher tabs that are gone', () => {
    const states = {
      l1: newLauncherTabState('a'),
      l2: newLauncherTabState('b'),
    };
    expect(keepOpenLauncherStates(states, [newLauncherTab('l1')])).toEqual({
      l1: states.l1,
    });
    // A launcher tab an app took the place of keeps its id, not its page.
    expect(keepOpenLauncherStates(states, [{ ...tube, tabId: 'l2' }])).toEqual(
      {}
    );
  });

  it('gives the same object back when every launcher tab is open', () => {
    const states = { l1: newLauncherTabState() };
    expect(keepOpenLauncherStates(states, [newLauncherTab('l1'), tube])).toBe(
      states
    );
  });
});

describe('inLauncherTab', () => {
  it('marks what opens from inside a launcher tab', () => {
    expect(inLauncherTab(app, 'l1')).toEqual({
      ...app,
      fromLauncherTabId: 'l1',
    });
  });

  it('leaves it as it is anywhere else', () => {
    expect(inLauncherTab(app, null)).toBe(app);
    expect(inLauncherTab(app, undefined)).toBe(app);
  });
});

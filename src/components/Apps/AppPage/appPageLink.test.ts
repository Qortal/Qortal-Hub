import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/events', () => ({ executeEvent: vi.fn() }));

import { executeEvent } from '../../../utils/events';
import { openTextLink } from '../../../utils/qortalLink/openQortalLink';
import {
  buildAppOpenLink,
  buildAppPageLink,
  launcherTabLinkOptions,
  openAppPageLink,
  parseAppPageLink,
  splitTextLinks,
} from './appPageLink';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('page links', () => {
  it('build and read back, names with spaces included', () => {
    const link = buildAppPageLink('app', 'Minter Helper');
    expect(link).toBe('qortal://use-app-page/APP/Minter%20Helper');
    expect(parseAppPageLink(link)).toEqual({
      service: 'APP',
      name: 'Minter Helper',
    });
    expect(parseAppPageLink('QORTAL://USE-APP-PAGE/app/Q-Blog')).toEqual({
      service: 'APP',
      name: 'Q-Blog',
    });
    expect(parseAppPageLink('qortal://use-app-page/APP/Q-Blog,')).toEqual({
      service: 'APP',
      name: 'Q-Blog',
    });
    expect(parseAppPageLink('qortal://use-app-page/website/Site/')).toEqual({
      service: 'WEBSITE',
      name: 'Site',
    });
    expect(buildAppOpenLink('WEBSITE', 'My Site')).toBe(
      'qortal://WEBSITE/My%20Site'
    );
  });

  it("aren't other links", () => {
    expect(parseAppPageLink('qortal://APP/Q-Blog')).toBeNull();
    expect(parseAppPageLink('qortal://use-app-page/VIDEO/x')).toBeNull();
    expect(parseAppPageLink('qortal://use-app-page/APP/a/b')).toBeNull();
    expect(parseAppPageLink('qortal://use-app-page/APP/%E0%A4%A')).toBeNull();
    expect(parseAppPageLink(null)).toBeNull();
  });

  it("open the app's page in the apps view", async () => {
    vi.useFakeTimers();
    expect(openAppPageLink('qortal://use-app-page/APP/Q-Tube')).toBe(true);
    expect(executeEvent).toHaveBeenCalledWith('open-apps-mode', {});
    vi.runAllTimers();
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfo', {
      data: { name: 'Q-Tube', service: 'APP' },
    });
    expect(openAppPageLink('qortal://APP/Q-Tube')).toBe(false);
  });
});

describe('links in page text', () => {
  it('are found, without trailing punctuation', () => {
    expect(
      splitTextLinks('See https://qortal.dev, or qortal://APP/Q-Mail.')
    ).toEqual([
      { kind: 'text', value: 'See ' },
      { kind: 'link', value: 'https://qortal.dev' },
      { kind: 'text', value: ', or ' },
      { kind: 'link', value: 'qortal://APP/Q-Mail' },
      { kind: 'text', value: '.' },
    ]);
    expect(splitTextLinks('no links')).toEqual([
      { kind: 'text', value: 'no links' },
    ]);
  });

  it("from a page's text in a launcher tab, name that tab", async () => {
    vi.useFakeTimers();
    await openTextLink(
      'qortal://use-app-page/WEBSITE/Q-Blog',
      launcherTabLinkOptions('launcher-tab-1')
    );
    vi.runAllTimers();
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfo', {
      data: {
        name: 'Q-Blog',
        service: 'WEBSITE',
        fromLauncherTabId: 'launcher-tab-1',
      },
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/events', () => ({ executeEvent: vi.fn() }));

import { executeEvent } from '../../../utils/events';
import { openTextLink } from '../../../utils/qortalLink/openQortalLink';
import { parseQortalLink } from '../../../utils/qortalLink/parseQortalLink';
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
    // A slash after the name keeps all of it, punctuation included.
    expect(parseAppPageLink('qortal://use-app-page/APP/Publisher!/')).toEqual({
      service: 'APP',
      name: 'Publisher!',
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

describe('links to names that end in punctuation', () => {
  // Names ending in what a sentence leaves after a link, or holding a quote,
  // where a page's text ends a link.
  const names = [
    'Publisher!',
    'Publisher v2.',
    'Publisher (QORT)',
    '....',
    "Publisher's Apps",
  ];

  it.each(names)('read back as the whole name: %s', (name) => {
    const page = buildAppPageLink('APP', name);
    const app = buildAppOpenLink('WEBSITE', name);
    for (const after of ['', '.', ',', '!', ')', '?']) {
      expect(parseAppPageLink(page + after)).toEqual({ service: 'APP', name });
      expect(parseQortalLink(page + after)).toMatchObject({
        kind: 'page',
        name,
        service: 'APP',
      });
    }
    expect(parseQortalLink(app)).toMatchObject({
      kind: 'resource',
      name,
      service: 'WEBSITE',
    });
    // In a page's text, after a sentence's punctuation too.
    const links = splitTextLinks(`See ${page}. Or ${app}!`)
      .filter((part) => part.kind === 'link')
      .map((part) => parseQortalLink(part.value));
    expect(links).toEqual([
      expect.objectContaining({ kind: 'page', name, service: 'APP' }),
      expect.objectContaining({ kind: 'resource', name, service: 'WEBSITE' }),
    ]);
  });

  it("escape !'()* and a dot at the end of the name", () => {
    expect(buildAppPageLink('app', 'Publisher (QORT)')).toBe(
      'qortal://use-app-page/APP/Publisher%20%28QORT%29'
    );
    expect(buildAppPageLink('APP', 'Publisher!')).toBe(
      'qortal://use-app-page/APP/Publisher%21'
    );
    expect(buildAppPageLink('APP', "Publisher's*")).toBe(
      'qortal://use-app-page/APP/Publisher%27s%2A'
    );
    // A dot inside a name stays; one at its end is escaped.
    expect(buildAppOpenLink('WEBSITE', 'Notes v2.0')).toBe(
      'qortal://WEBSITE/Notes%20v2.0'
    );
    expect(buildAppOpenLink('WEBSITE', 'Publisher v2.')).toBe(
      'qortal://WEBSITE/Publisher%20v2%2E'
    );
  });

  it("open from a page's text with a sentence's punctuation after them", async () => {
    vi.useFakeTimers();
    const [link] = splitTextLinks(
      `Its page: ${buildAppPageLink('APP', 'Publisher!')}!`
    ).filter((part) => part.kind === 'link');
    await openTextLink(link.value);
    vi.runAllTimers();
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfo', {
      data: { name: 'Publisher!', service: 'APP' },
    });
  });

  it('read a long run of punctuation in one pass', () => {
    // With a pattern anchored at the end, a run that doesn't reach it took
    // time growing with the square of its length (seconds at 60,000).
    const run = '!'.repeat(60_000);
    const started = performance.now();
    expect(parseAppPageLink(`qortal://use-app-page/APP/${run}x`)).toBeNull();
    expect(splitTextLinks(`qortal://APP/${run}x`)).toEqual([
      { kind: 'link', value: `qortal://APP/${run}x` },
    ]);
    expect(performance.now() - started).toBeLessThan(500);
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

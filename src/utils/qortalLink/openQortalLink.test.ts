import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../events', () => ({ executeEvent: vi.fn() }));
vi.mock('../openExternalHttp', () => ({ openHttpUrlExternally: vi.fn() }));
vi.mock('../openQortalUseGroupLink', () => ({
  openQortalUseGroupLink: vi.fn(async (link: string) =>
    link.startsWith('qortal://use-group/')
  ),
}));

import { executeEvent } from '../events';
import { openHttpUrlExternally } from '../openExternalHttp';
import { openQortalUseGroupLink } from '../openQortalUseGroupLink';
import { parseQortalLink } from './parseQortalLink';
import { openQortalLink, openTextLink } from './openQortalLink';

const events = () => vi.mocked(executeEvent).mock.calls;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseQortalLink', () => {
  it('reads a Q-App or website with its path and identifier', () => {
    expect(
      parseQortalLink('  qortal://APP/Q-Tube/video/abc?identifier=clip1&t=3 ')
    ).toEqual({
      kind: 'resource',
      link: 'qortal://APP/Q-Tube/video/abc?identifier=clip1&t=3',
      service: 'APP',
      name: 'Q-Tube',
      identifier: 'clip1',
      path: 'video/abc?t=3',
    });
    // A bare name is a website; the protocol may be in any case.
    expect(parseQortalLink('QORTAL://Simon')).toMatchObject({
      kind: 'resource',
      service: 'WEBSITE',
      name: 'Simon',
    });
  });

  it("reads an app's page", () => {
    expect(parseQortalLink('qortal://use-app-page/website/My%20Site')).toEqual({
      kind: 'page',
      link: 'qortal://use-app-page/website/My%20Site',
      service: 'WEBSITE',
      name: 'My Site',
    });
  });

  it("reads a group's join and calendar links whole", () => {
    expect(
      parseQortalLink('qortal://use-group/action-join/groupid-694')
    ).toEqual({
      kind: 'group',
      link: 'qortal://use-group/action-join/groupid-694',
    });
    expect(
      parseQortalLink(
        'qortal://use-group/action-calendar/groupid-5/eventid-123e4567-e89b-42d3-a456-426614174000'
      )
    ).toMatchObject({ kind: 'group' });
  });

  it('takes nothing else for a link', () => {
    expect(parseQortalLink('qortal://use-embed/POLL?name=x')).toBeNull();
    expect(parseQortalLink('qortal://use-group/x')).toBeNull();
    expect(parseQortalLink('https://qortal.dev')).toBeNull();
    expect(parseQortalLink('q-tube videos')).toBeNull();
    expect(parseQortalLink('qortal://')).toBeNull();
    expect(parseQortalLink(null)).toBeNull();
  });
});

describe('openQortalLink', () => {
  it('opens a Q-App or website in a tab', async () => {
    expect(await openQortalLink('qortal://APP/Q-Mail/inbox')).toBe(true);
    expect(events()).toEqual([
      [
        'addTab',
        {
          data: {
            service: 'APP',
            name: 'Q-Mail',
            identifier: undefined,
            path: 'inbox',
          },
        },
      ],
      ['open-apps-mode', {}],
    ]);
  });

  it('lets an app that is open show the page, when asked to', async () => {
    await openQortalLink('qortal://APP/Q-Mail', {
      navigateIfAlreadyOpen: true,
    });
    expect(events()[0][1]).toEqual({
      data: expect.objectContaining({
        name: 'Q-Mail',
        navigateIfAlreadyOpen: true,
      }),
    });
  });

  it('hands a Q-App or website to the place that opens it its own way', async () => {
    const openResource = vi.fn();
    await openQortalLink('qortal://WEBSITE/Simon/blog', { openResource });
    expect(openResource).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'WEBSITE', name: 'Simon' })
    );
    expect(events()).toEqual([]);
  });

  it("opens an app's page, not the app", async () => {
    expect(await openQortalLink('qortal://use-app-page/APP/Q-Shop')).toBe(true);
    vi.runAllTimers();
    expect(events()).toEqual([
      ['open-apps-mode', {}],
      ['selectedAppInfo', { data: { name: 'Q-Shop', service: 'APP' } }],
    ]);
  });

  it("opens a group's link through Hub's group handlers", async () => {
    const link = 'qortal://use-group/action-join/groupid-5';
    expect(await openQortalLink(link)).toBe(true);
    expect(openQortalUseGroupLink).toHaveBeenCalledWith(link);
    expect(events()).toEqual([]);
  });

  it("says a group's link came from a Q-App or a widget, when it did", async () => {
    const link = 'qortal://use-group/action-join/groupid-5';
    expect(await openQortalLink(link, { fromApp: true })).toBe(true);
    expect(openQortalUseGroupLink).toHaveBeenCalledWith(link, {
      fromApp: true,
    });
  });

  it("says so when a group's link couldn't open", async () => {
    vi.mocked(openQortalUseGroupLink).mockRejectedValueOnce(new Error('no'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(
      await openQortalLink('qortal://use-group/action-join/groupid-5')
    ).toBe(false);
  });

  it('opens nothing for what is no qortal:// link', async () => {
    expect(await openQortalLink('just words')).toBe(false);
    expect(await openQortalLink('qortal://use-embed/POLL?name=x')).toBe(false);
    expect(events()).toEqual([]);
  });
});

// A notification's link comes from the node, and a Q-App's from its request:
// either can be something other than text.
describe('openQortalLink, given a link that is not text', () => {
  it('opens a link Hub has read, as it was read', async () => {
    const link = parseQortalLink('qortal://APP/Q-Mail/inbox?identifier=box');
    expect(await openQortalLink(link)).toBe(true);
    expect(events()[0]).toEqual([
      'addTab',
      {
        data: {
          service: 'APP',
          name: 'Q-Mail',
          identifier: 'box',
          path: 'inbox',
        },
      },
    ]);
  });

  // The top bar and the launcher hand over the link they read.
  it("opens an app's page and a group's link Hub has read", async () => {
    const openPage = vi.fn();
    const page = parseQortalLink('qortal://use-app-page/website/My%20Site');
    expect(await openQortalLink(page, { openPage })).toBe(true);
    expect(openPage).toHaveBeenCalledWith({
      service: 'WEBSITE',
      name: 'My Site',
    });

    const group = parseQortalLink('QORTAL://use-group/action-join/groupid-5');
    expect(await openQortalLink(group)).toBe(true);
    expect(openQortalUseGroupLink).toHaveBeenCalledWith(
      'qortal://use-group/action-join/groupid-5'
    );
    expect(events()).toEqual([]);
  });

  it.each([
    ['an empty object', {}],
    ['a number', 5],
    ['a Q-App or website with no link text', { kind: 'resource' }],
    [
      'a Q-App or website made up field by field',
      { kind: 'resource', service: 'app', name: 7, path: '../x' },
    ],
    ["an app's page made up field by field", { kind: 'page', name: 'Q-Shop' }],
    ["a group's link that is no group link", { kind: 'group', link: 'x' }],
    [
      'a link whose text is a list',
      { kind: 'resource', link: ['qortal://APP/Q-Tube'] },
    ],
    [
      'a link whose text cannot be read as text',
      { kind: 'resource', link: { toString: 0 } },
    ],
  ])('opens nothing for %s', async (_what, input) => {
    expect(await openQortalLink(input as never)).toBe(false);
    expect(events()).toEqual([]);
    expect(openQortalUseGroupLink).not.toHaveBeenCalled();
  });

  it('opens what the link text says, whatever the other fields say', async () => {
    const forged = {
      kind: 'resource',
      link: 'qortal://APP/Q-Tube',
      service: 'WEBSITE',
      name: 'Another',
      path: 'elsewhere',
    };
    expect(await openQortalLink(forged as never)).toBe(true);
    expect(events()[0]).toEqual([
      'addTab',
      {
        data: {
          service: 'APP',
          name: 'Q-Tube',
          identifier: undefined,
          path: '',
        },
      },
    ]);
  });
});

describe('openTextLink', () => {
  it('opens qortal:// links in Hub and web links in the browser', async () => {
    await openTextLink('https://example.com');
    expect(openHttpUrlExternally).toHaveBeenCalledWith('https://example.com');

    await openTextLink('qortal://APP/Q-Tube/channel/1?identifier=abc&x=1');
    expect(executeEvent).toHaveBeenCalledWith('addTab', {
      data: {
        service: 'APP',
        name: 'Q-Tube',
        identifier: 'abc',
        path: 'channel/1?x=1',
      },
    });

    vi.mocked(executeEvent).mockClear();
    await openTextLink('qortal://use-group/action-join/groupid-5');
    expect(executeEvent).not.toHaveBeenCalledWith('addTab', expect.anything());
    expect(openHttpUrlExternally).toHaveBeenCalledTimes(1);
  });
});

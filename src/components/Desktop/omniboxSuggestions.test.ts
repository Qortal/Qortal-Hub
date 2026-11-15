import { describe, expect, it } from 'vitest';
import type { AppBookmark } from '../Apps/AppBookmarks/bookmarkTypes';
import {
  MAX_APP_SUGGESTIONS,
  type SearchableApp,
} from './appSearchSuggestions';
import {
  buildOmniboxOptions,
  findPrivateAppTab,
  MAX_NAME_SUGGESTIONS,
  MAX_SAVED_SUGGESTIONS,
  MAX_TAB_SUGGESTIONS,
  omniboxGroupOf,
  omniboxOptionKey,
  type OmniboxOption,
  type OmniboxSources,
  type OmniboxTab,
  omniboxTabTitle,
  parseOmniboxLink,
  canOpenInNewTab,
  omniboxOptionOpenTab,
  omniboxTabPage,
} from './omniboxSuggestions';

const app = (name: string, service = 'APP', title?: string): SearchableApp => ({
  metadata: title ? { title } : {},
  name,
  service,
});

const tab = (
  tabId: string,
  name: string,
  extra: Partial<OmniboxTab> = {}
): OmniboxTab => ({ name, service: 'APP', tabId, ...extra });

const bookmark = (
  id: string,
  name: string,
  appName: string,
  path = '',
  extra: Partial<AppBookmark> = {}
): AppBookmark => ({
  appName,
  createdAt: 1,
  folderId: null,
  id,
  link: `qortal://APP/${appName}${path ? `/${path}` : ''}`,
  name,
  path,
  service: 'APP',
  updatedAt: 1,
  ...extra,
});

// Private apps are published as DOCUMENT resources.
const privateApp = {
  appName: 'Secret Notes',
  identifier: 'notes-1',
  name: 'Alice',
  service: 'DOCUMENT',
};

/** Each row as `group:what it is`, to compare all of them at once. */
const rows = (options: OmniboxOption[]) =>
  options.map((option) => {
    const group = omniboxGroupOf(option);
    switch (option.kind) {
      case 'app':
        return `${group}:${option.app.service}:${option.app.name}`;
      case 'bookmark':
        return `${group}:bookmark:${option.bookmark.name}`;
      case 'link':
        return `${group}:${option.link.link}`;
      case 'name':
        return `${group}:${option.name}${option.app ? `>${option.app.service}` : ''}`;
      case 'pinned':
        return `${group}:pin:${option.title}`;
      case 'tab':
        return `${group}:${option.tab.tabId}`;
      default:
        return `${group}:${option.query}`;
    }
  });

const build = (input: string, sources: Partial<OmniboxSources> = {}) =>
  rows(buildOmniboxOptions(input, { apps: [], ...sources }));

describe('parseOmniboxLink', () => {
  it('reads a link with the protocol in any case', () => {
    expect(
      parseOmniboxLink(' QORTAL://APP/Q-Tube/watch?identifier=v1 ')
    ).toEqual({
      identifier: 'v1',
      kind: 'resource',
      link: 'qortal://APP/Q-Tube/watch?identifier=v1',
      name: 'Q-Tube',
      path: 'watch',
      service: 'APP',
    });
    expect(parseOmniboxLink('Qortal://website/alice')).toEqual(
      expect.objectContaining({ name: 'alice', service: 'WEBSITE' })
    );
  });

  it('keeps a group link whole, for the group handlers', () => {
    expect(
      parseOmniboxLink('QORTAL://use-group/action-join/groupid-5')
    ).toEqual({
      kind: 'group',
      link: 'qortal://use-group/action-join/groupid-5',
    });
  });

  it('reads nothing else as a link', () => {
    expect(parseOmniboxLink('Q-Tube')).toBeNull();
    expect(parseOmniboxLink('APP/Q-Tube')).toBeNull();
    expect(parseOmniboxLink('qortal://')).toBeNull();
    expect(parseOmniboxLink('qortal://use-something')).toBeNull();
  });
});

describe('buildOmniboxOptions', () => {
  it('suggests nothing for an empty input', () => {
    expect(build('  ', { apps: [app('Q-Tube')] })).toEqual([]);
  });

  it('offers a link as its only row, or nothing when it cannot open', () => {
    const sources = {
      apps: [app('Q-Tube')],
      tabs: [tab('t1', 'Q-Tube')],
    };
    expect(build('QORTAL://APP/Q-Tube', sources)).toEqual([
      'link:qortal://APP/Q-Tube',
    ]);
    expect(build('qortal://', sources)).toEqual([]);
  });

  it('lists the groups in order, an app once, then the library search', () => {
    expect(
      build('tor', {
        apps: [
          app('Torq'),
          app('Torque', 'WEBSITE', 'Torque Garage'),
          app('Tortoise'),
        ],
        bookmarks: [bookmark('b1', 'Torq feed', 'Torq', 'feed')],
        names: ['Toril', 'Torq', 'torq'],
        pinnedApps: [{ name: 'Torque', service: 'WEBSITE' }],
        tabs: [tab('t1', 'Torq')],
      })
    ).toEqual([
      'tabs:t1',
      'saved:pin:Torque Garage',
      'saved:bookmark:Torq feed',
      'apps:APP:Tortoise',
      'names:Toril',
      'library:tor',
    ]);
  });

  describe('open tabs', () => {
    it('match by title, name or private app name, best match first', () => {
      expect(
        build('notes', {
          tabs: [
            tab('t1', 'Q-Notes'),
            tab('t2', 'Writer', { metadata: { title: 'Notes' } }),
            tab('t3', 'Alice', {
              isPrivate: true,
              privateAppProperties: privateApp,
              service: 'DOCUMENT',
            }),
            tab('t4', 'Q-Tube'),
          ],
        })
      ).toEqual(['tabs:t2', 'tabs:t1', 'tabs:t3', 'library:notes']);
    });

    it(`leave out the tab on screen, and show at most ${MAX_TAB_SUGGESTIONS}`, () => {
      const tabs = ['t1', 't2', 't3', 't4', 't5'].map((tabId) =>
        tab(tabId, `Q-App ${tabId}`)
      );
      expect(build('q-app', { onScreenTabId: 't2', tabs })).toEqual([
        'tabs:t1',
        'tabs:t3',
        'tabs:t4',
        'library:q-app',
      ]);
    });

    it('include Q-Chat, and skip tabs without a name', () => {
      expect(
        build('chat', {
          tabs: [
            tab('t1', 'Q-Chat', { internal: 'q-chat', service: 'INTERNAL' }),
            { tabId: 't2', url: 'http://localhost:3000' },
          ],
        })
      ).toEqual(['tabs:t1', 'library:chat']);
    });
  });

  describe('pinned apps and bookmarks', () => {
    it(`come pins first among equal matches, ${MAX_SAVED_SUGGESTIONS} at most`, () => {
      expect(
        build('mail', {
          apps: [app('Q-Mail')],
          bookmarks: [
            bookmark('b1', 'Mail drafts', 'Q-Mail', 'drafts'),
            bookmark('b2', 'Sent mail', 'Q-Mail', 'sent'),
            bookmark('b3', 'Mailing list', 'Q-Mail', 'lists'),
          ],
          pinnedApps: [{ name: 'Q-Mail', service: 'APP' }],
        })
      ).toEqual([
        'saved:bookmark:Mail drafts',
        'saved:bookmark:Mailing list',
        'saved:pin:Q-Mail',
        'library:mail',
      ]);
    });

    it('leave out an app that is listed as an open tab', () => {
      expect(
        build('tube', {
          apps: [app('Q-Tube')],
          bookmarks: [
            bookmark('b1', 'Q-Tube home', 'Q-Tube'),
            bookmark('b2', 'Cats', 'Q-Tube', 'channel/cats'),
          ],
          pinnedApps: [{ name: 'Q-Tube', service: 'APP' }],
          tabs: [tab('t1', 'Q-Tube')],
        })
      ).toEqual(['tabs:t1', 'saved:bookmark:Cats', 'library:tube']);
    });

    it('list a private app by its own name, once', () => {
      const pin = {
        isPrivate: true,
        isPreview: true,
        privateAppProperties: privateApp,
      };
      expect(build('secret', { pinnedApps: [pin, pin] })).toEqual([
        'saved:pin:Secret Notes',
        'library:secret',
      ]);
      expect(
        build('secret', {
          pinnedApps: [pin],
          tabs: [
            tab('t1', 'Alice', {
              isPrivate: true,
              privateAppProperties: privateApp,
              service: 'DOCUMENT',
            }),
          ],
        })
      ).toEqual(['tabs:t1', 'library:secret']);
    });

    it('take the title from the library, and skip broken pins', () => {
      expect(
        build('builder', {
          apps: [app('QWB', 'APP', 'Qortal Web Builder')],
          pinnedApps: [{ name: 'QWB', service: 'APP' }, {}, null as never],
        })
      ).toEqual(['saved:pin:Qortal Web Builder', 'library:builder']);
    });
  });

  describe('Q-Apps and websites', () => {
    it(`keep their ranking, without the apps listed above, ${MAX_APP_SUGGESTIONS} at most`, () => {
      const apps = Array.from({ length: 10 }, (_, index) =>
        app(`App ${index}`)
      );
      expect(
        build('app', {
          apps,
          pinnedApps: [{ name: 'App 0', service: 'APP' }],
          tabs: [tab('t1', 'App 1')],
        })
      ).toEqual([
        'tabs:t1',
        'saved:pin:App 0',
        ...[2, 3, 4, 5, 6, 7, 8].map((index) => `apps:APP:App ${index}`),
        'library:app',
      ]);
    });

    it('rank the most opened first, as before', () => {
      expect(
        build('q-', {
          apps: [app('Q-Blog'), app('Q-Mail')],
          openCounts: { 'APP:q-mail': 3 },
        })
      ).toEqual(['apps:APP:Q-Mail', 'apps:APP:Q-Blog', 'library:q-']);
    });
  });

  describe('names', () => {
    it('skip names listed as a Q-App or website, and repeats', () => {
      expect(
        build('al', {
          apps: [app('Alfa', 'WEBSITE')],
          names: ['Alfa', 'alice', 'Alice', 'alan'],
        })
      ).toEqual([
        'apps:WEBSITE:Alfa',
        'names:alice',
        'names:alan',
        'library:al',
      ]);
    });

    it(`show only names that match what is typed now, ${MAX_NAME_SUGGESTIONS} at most`, () => {
      expect(
        build('ali', { names: ['alan', 'alice', 'alina', 'alix', 'aliz'] })
      ).toEqual(['names:alice', 'names:alina', 'names:alix', 'library:ali']);
    });

    it('open the Q-App of the name, else its website', () => {
      const apps = Array.from({ length: 7 }, (_, index) => app(`Bob ${index}`));
      expect(
        build('bob', {
          apps: [
            ...apps,
            app('Bobby', 'WEBSITE'),
            app('Bobby'),
            app('Bobo', 'WEBSITE'),
          ],
          names: ['Bobby', 'Bobo', 'Bobcat'],
        }).filter((row) => row.startsWith('names:'))
      ).toEqual(['names:Bobby>APP', 'names:Bobo>WEBSITE', 'names:Bobcat']);
    });
  });

  it('gives every row its own key', () => {
    const options = buildOmniboxOptions('q', {
      apps: [app('Q-Tube'), app('Q-Tube', 'WEBSITE')],
      bookmarks: [bookmark('b1', 'Q page', 'Q-Mail', 'x')],
      names: ['Q-Tube', 'Qubit'],
      pinnedApps: [{ name: 'Q-Mail', service: 'APP' }],
      tabs: [tab('t1', 'Q-Blog'), tab('t2', 'Q-Blog')],
    });
    const keys = options.map(omniboxOptionKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('library');
  });
});

describe('omniboxTabTitle', () => {
  it('names a tab the way the strip does', () => {
    expect(
      omniboxTabTitle(tab('t1', 'qtube', { metadata: { title: 'Q-Tube' } }))
    ).toBe('Q-Tube');
    expect(
      omniboxTabTitle(
        tab('t2', 'Alice', {
          isPrivate: true,
          privateAppProperties: privateApp,
          service: 'DOCUMENT',
        })
      )
    ).toBe('Alice');
    expect(omniboxTabTitle(tab('t3', ' Q-Mail '))).toBe('Q-Mail');
  });
});

describe('findPrivateAppTab', () => {
  it('finds the tab showing that private app', () => {
    const tabs = [
      tab('t1', 'Alice'),
      tab('t2', 'Alice', {
        isPrivate: true,
        privateAppProperties: { ...privateApp, identifier: 'other' },
        service: 'DOCUMENT',
      }),
      tab('t3', 'Alice', {
        isPrivate: true,
        privateAppProperties: privateApp,
        service: 'DOCUMENT',
      }),
    ];
    const pin = { isPrivate: true, privateAppProperties: privateApp };
    expect(findPrivateAppTab(tabs, pin)?.tabId).toBe('t3');
    expect(findPrivateAppTab(tabs.slice(0, 2), pin)).toBeNull();
    expect(findPrivateAppTab(tabs, { isPrivate: true })).toBeNull();
  });
});

describe('the open tab of a row', () => {
  const torq = { name: 'Torq', service: 'APP', tabId: 't1' };

  it("finds the tab a row's Q-App or website is open in", () => {
    expect(omniboxOptionOpenTab({ kind: 'tab', tab: torq }, [])).toBe(torq);
    expect(
      omniboxOptionOpenTab(
        { app: { name: 'torq', service: 'APP' } as never, kind: 'app' },
        [torq]
      )
    ).toBe(torq);
    expect(
      omniboxOptionOpenTab(
        {
          bookmark: {
            appName: 'Torq',
            path: 'post/x',
            service: 'APP',
          } as never,
          kind: 'bookmark',
        },
        [torq]
      )
    ).toBe(torq);
    expect(
      omniboxOptionOpenTab(
        {
          kind: 'link',
          link: {
            kind: 'resource',
            link: 'qortal://APP/Torq',
            name: 'Torq',
            path: '',
            service: 'APP',
          },
        },
        [torq]
      )
    ).toBe(torq);
    expect(
      omniboxOptionOpenTab(
        { app: { name: 'Q-Tube', service: 'APP' } as never, kind: 'app' },
        [torq]
      )
    ).toBeNull();
    expect(
      omniboxOptionOpenTab({ kind: 'library', query: 'tor' }, [torq])
    ).toBeNull();
  });

  it('opens a new tab only for a Q-App or website', () => {
    expect(canOpenInNewTab(torq)).toBe(true);
    expect(canOpenInNewTab(null)).toBe(false);
    expect(canOpenInNewTab({ internal: 'q-chat', tabId: 'c' })).toBe(false);
    expect(
      canOpenInNewTab({
        isPrivate: true,
        name: 'Notes',
        service: 'APP',
        tabId: 'p',
      })
    ).toBe(false);
  });
});

describe('omniboxTabPage', () => {
  const tab = { name: 'Q Blog', service: 'APP', tabId: 't' };

  it("reads the page after the app from the tab's link", () => {
    expect(omniboxTabPage(tab, 'qortal://APP/Q Blog/post/abc')).toBe(
      'post/abc'
    );
    expect(omniboxTabPage(tab, 'qortal://app/Q%20Blog/post/a%20b')).toBe(
      'post/a b'
    );
  });

  it("is empty at the start page, or for another app's link", () => {
    expect(omniboxTabPage(tab, 'qortal://APP/Q Blog')).toBe('');
    expect(omniboxTabPage(tab, 'qortal://APP/Q Blog/')).toBe('');
    expect(omniboxTabPage(tab, 'qortal://APP/Q Blogs/post')).toBe('');
    expect(omniboxTabPage(tab, 'qortal://APP/Other/x')).toBe('');
    expect(omniboxTabPage(tab, undefined)).toBe('');
  });
});

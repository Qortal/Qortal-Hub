import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildQortalResourceLink } from '../../utils/qortalLink';
import { QCHAT_INTERNAL_TAB_ID } from '../../utils/openQChatTab';
import {
  createTabSessionWriter,
  isPrivateTabToReopen,
  loadTabSession,
  parseTabSession,
  relativeAppPath,
  reportedAppPath,
  restoredTab,
  saveTabSession,
  serializeTabSession,
  tabFlags,
  tabSessionStorageKey,
  toSavedTab,
  type TabSession,
} from './tabSession';

const NODE = 'http://127.0.0.1:12391';
const LIMIT = 10;

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
};

// Stored data as it may be found, junk included.
const stored = (session: Record<string, unknown>) => ({
  version: 1,
  selectedTabId: null,
  tabs: [],
  ...session,
});

describe('tabSessionStorageKey', () => {
  it('keeps each account apart', () => {
    expect(tabSessionStorageKey('QAlice')).toBe('ext_open_tabs:QAlice');
    expect(tabSessionStorageKey('QBob')).not.toBe(
      tabSessionStorageKey('QAlice')
    );
  });
});

describe('relativeAppPath', () => {
  it.each([
    ['/video/abc', 'video/abc'],
    ['video/abc', 'video/abc'],
    ['/', ''],
    ['', ''],
    ['/qortal?authOnMount=true', 'qortal?authOnMount=true'],
    ['/file/id%2Fpart', 'file/id%2Fpart'],
    ['/post/a/b#comments', 'post/a/b#comments'],
    ['/post/a/b#', 'post/a/b'],
  ])('keeps %j as %j', (input, expected) => {
    expect(relativeAppPath(input)).toBe(expected);
  });

  it("drops Hub's own render parameters and keeps the app's", () => {
    expect(
      relativeAppPath(
        '/channel/x?theme=dark&lang=en&identifier=&page=2&time=12&isManualNavigation=false'
      )
    ).toBe('channel/x?page=2');
    expect(relativeAppPath('/?theme=light&lang=de&identifier=abc')).toBe('');
  });

  it('never keeps a node API key', () => {
    expect(relativeAppPath('/inbox?apiKey=secret&page=2')).toBe('inbox?page=2');
    expect(relativeAppPath('/inbox?apikey=secret')).toBe('inbox');
    expect(relativeAppPath('/inbox?API_KEY=secret')).toBe('inbox');
    expect(relativeAppPath('/inbox?x-api-key=secret')).toBe('inbox');
    expect(
      relativeAppPath(`/open?u=${encodeURIComponent(`${NODE}/x?apiKey=s`)}`)
    ).toBe('');
    expect(relativeAppPath('/open#apiKey=secret')).toBe('');
  });

  it('never keeps a whole address', () => {
    expect(relativeAppPath(`${NODE}/render/APP/Q-Tube/video/abc`)).toBe('');
    expect(relativeAppPath('//evil.example/x')).toBe('');
    expect(relativeAppPath('https://evil.example/x')).toBe('');
  });

  it.each([
    '../../render/APP/Other',
    '/a/../../b',
    '%2e%2e/x',
    '%252e%252e/x',
    '..;/x',
    'a\\..\\b',
    'a%5C..%5Cb',
    'bad%zz',
    'line\nbreak',
  ])('refuses %j', (input) => {
    expect(relativeAppPath(input)).toBe('');
  });

  it('refuses anything but a short string', () => {
    expect(relativeAppPath(undefined)).toBe('');
    expect(relativeAppPath(42)).toBe('');
    expect(relativeAppPath(`/${'a'.repeat(3000)}`)).toBe('');
  });
});

describe('reportedAppPath', () => {
  const tab = { tabId: 't1', service: 'APP', name: 'Q Tube', identifier: 'v1' };
  const link = (path: string, identifier?: string) =>
    buildQortalResourceLink({
      service: 'APP',
      name: 'Q Tube',
      path,
      identifier,
    });

  it('is undefined until the app reports a page', () => {
    expect(reportedAppPath(tab, link(''))).toBeUndefined();
    expect(reportedAppPath(tab, link('', 'v1'))).toBeUndefined();
    expect(reportedAppPath(tab, undefined)).toBeUndefined();
  });

  it('gives the page the app reported, its start page included', () => {
    expect(reportedAppPath(tab, link('/'))).toBe('/');
    expect(reportedAppPath(tab, link('/video/abc', 'v1'))).toBe(
      '/video/abc?identifier=v1'
    );
    expect(
      relativeAppPath(reportedAppPath(tab, link('/video/abc', 'v1')))
    ).toBe('video/abc');
  });

  it("ignores another app's link", () => {
    const other = buildQortalResourceLink({
      service: 'APP',
      name: 'Q-Mail',
      path: '/inbox',
    });
    expect(reportedAppPath(tab, other)).toBeUndefined();
  });
});

describe('toSavedTab', () => {
  it('keeps what reopens an app, with its current address', () => {
    expect(
      toSavedTab(
        {
          tabId: 't1',
          service: 'APP',
          name: 'Q-Tube',
          identifier: 'v1',
          path: 'video/old',
          metadata: { title: 'Q-Tube', description: 'videos' },
          created: 1,
          status: { status: 'READY' },
          refreshFunc: () => undefined,
        },
        '/video/new?theme=dark&lang=en'
      )
    ).toEqual({
      tabId: 't1',
      service: 'APP',
      name: 'Q-Tube',
      identifier: 'v1',
      path: 'video/new',
      title: 'Q-Tube',
    });
  });

  it('keeps the address the tab was opened at until the app reports one', () => {
    expect(
      toSavedTab({
        tabId: 't1',
        service: 'APP',
        name: 'Q-Wallets',
        path: 'qortal?authOnMount=true',
      })
    ).toMatchObject({ path: 'qortal?authOnMount=true' });
    expect(
      toSavedTab({
        tabId: 't1',
        service: 'APP',
        name: 'Q-Mail',
        identifier: 'null',
      })
    ).toEqual({ tabId: 't1', service: 'APP', name: 'Q-Mail' });
  });

  it('carries true/false marks such as pinned, but not those of this run', () => {
    expect(
      toSavedTab({
        tabId: 't1',
        service: 'APP',
        name: 'Q-Mail',
        pinned: true,
        muted: false,
        lock: true,
        lockMessage: 'unsaved draft',
        navigateIfAlreadyOpen: true,
      })
    ).toEqual({
      tabId: 't1',
      service: 'APP',
      name: 'Q-Mail',
      flags: { pinned: true, muted: false },
    });
  });

  it('skips Dev Mode tabs and previews', () => {
    expect(
      toSavedTab({
        tabId: 'd1',
        url: `${NODE}/render/hash/abc?secret=x`,
        isPreview: true,
        filePath: '/home/me/app.zip',
      })
    ).toBeNull();
    expect(
      toSavedTab({
        tabId: 'd2',
        url: 'http://localhost:5173',
        isPreview: false,
      })
    ).toBeNull();
    expect(
      toSavedTab({ tabId: 'p1', service: 'APP', name: 'X', isPreview: true })
    ).toBeNull();
  });

  it('keeps Q-Chat but no other internal tab', () => {
    expect(
      toSavedTab({
        tabId: 'c1',
        internal: QCHAT_INTERNAL_TAB_ID,
        name: 'Q-Chat',
        service: 'INTERNAL',
      })
    ).toEqual({
      tabId: 'c1',
      internal: QCHAT_INTERNAL_TAB_ID,
      name: 'Q-Chat',
      service: 'INTERNAL',
    });
    expect(
      toSavedTab({
        tabId: 'c2',
        internal: 'something-else',
        name: 'X',
        service: 'INTERNAL',
      })
    ).toBeNull();
  });

  it("keeps what reopens a private app, never its preview's address", () => {
    const logo = `data:image/png;base64,${'A'.repeat(100)}`;
    const saved = toSavedTab({
      tabId: 'p1',
      identifier: 'app-id',
      name: 'Minter',
      service: 'DOCUMENT',
      url: `${NODE}/render/hash/abc?secret=xyz`,
      isPreview: true,
      isPrivate: true,
      filePath: '',
      refreshFunc: () => undefined,
      privateAppProperties: {
        service: 'DOCUMENT',
        name: 'Minter',
        identifier: 'app-id',
        groupId: 42,
        appName: 'Minter Helper',
        logo,
      },
    });
    expect(saved).toEqual({
      tabId: 'p1',
      service: 'DOCUMENT',
      name: 'Minter',
      identifier: 'app-id',
      isPrivate: true,
      privateAppProperties: {
        service: 'DOCUMENT',
        name: 'Minter',
        identifier: 'app-id',
        groupId: 42,
        appName: 'Minter Helper',
        logo,
      },
    });
    expect(JSON.stringify(saved)).not.toContain('secret');
    expect(JSON.stringify(saved)).not.toContain(NODE);
  });

  it("leaves out a private app's big logo, and an app it can't reopen", () => {
    const saved = toSavedTab({
      tabId: 'p1',
      isPrivate: true,
      privateAppProperties: {
        service: 'DOCUMENT',
        name: 'Minter',
        identifier: 'app-id',
        groupId: 42,
        logo: `data:image/png;base64,${'A'.repeat(70_000)}`,
      },
      service: 'DOCUMENT',
    });
    expect(saved?.privateAppProperties).toEqual({
      service: 'DOCUMENT',
      name: 'Minter',
      identifier: 'app-id',
      groupId: 42,
    });
    expect(
      toSavedTab({
        tabId: 'p2',
        isPrivate: true,
        service: 'DOCUMENT',
        privateAppProperties: { service: 'DOCUMENT', name: 'Minter' },
      })
    ).toBeNull();
  });

  it('refuses tabs without a usable id, service or name', () => {
    expect(toSavedTab({ service: 'APP', name: 'Q-Mail' })).toBeNull();
    expect(
      toSavedTab({ tabId: 'a b', service: 'APP', name: 'Q-Mail' })
    ).toBeNull();
    expect(toSavedTab({ tabId: 't1', service: 'APP', name: '' })).toBeNull();
    expect(
      toSavedTab({ tabId: 't1', service: '../APP', name: 'Q-Mail' })
    ).toBeNull();
    expect(toSavedTab(null)).toBeNull();
  });
});

describe('serializeTabSession', () => {
  const tabs = [
    { tabId: 'a', service: 'APP', name: 'Q-Tube' },
    { tabId: 'dev', url: 'http://localhost:5173' },
    { tabId: 'b', service: 'APP', name: 'Q-Mail' },
  ];

  it('keeps the order and the selected tab', () => {
    expect(serializeTabSession(tabs, 'b', LIMIT)).toEqual({
      tabs: [
        { tabId: 'a', service: 'APP', name: 'Q-Tube' },
        { tabId: 'b', service: 'APP', name: 'Q-Mail' },
      ],
      selectedTabId: 'b',
    });
  });

  it('selects nothing when the selected tab is not kept', () => {
    expect(serializeTabSession(tabs, 'dev', LIMIT).selectedTabId).toBeNull();
    expect(serializeTabSession(tabs, null, LIMIT).selectedTabId).toBeNull();
  });

  it('takes each app where it is now', () => {
    const session = serializeTabSession(tabs, 'a', LIMIT, (tab) =>
      tab.tabId === 'a' ? '/video/abc' : undefined
    );
    expect(session.tabs[0].path).toBe('video/abc');
    expect(session.tabs[1].path).toBeUndefined();
  });

  it('keeps at most the limit, and each tab once', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      tabId: `t${i}`,
      service: 'APP',
      name: `App ${i}`,
    }));
    const session = serializeTabSession([many[0], ...many], 't0', LIMIT);
    expect(session.tabs.map((tab) => tab.tabId)).toEqual(
      many.slice(0, LIMIT).map((tab) => tab.tabId)
    );
  });

  it('is an empty list when every tab is closed', () => {
    expect(serializeTabSession([], 'a', LIMIT)).toEqual({
      tabs: [],
      selectedTabId: null,
    });
  });
});

describe('parseTabSession', () => {
  it('reads back what was saved', () => {
    const session = serializeTabSession(
      [
        {
          tabId: 'a',
          service: 'APP',
          name: 'Q-Tube',
          path: 'video/abc',
          metadata: { title: 'Q-Tube videos' },
          pinned: true,
        },
        {
          tabId: 'c',
          internal: QCHAT_INTERNAL_TAB_ID,
          name: 'Q-Chat',
          service: 'INTERNAL',
        },
      ],
      'a',
      LIMIT
    );
    const json = JSON.parse(JSON.stringify({ version: 1, ...session }));
    expect(parseTabSession(json, LIMIT)).toEqual(session);
  });

  it.each([null, 'x', 42, [], {}, { version: 2, tabs: [] }])(
    'is empty for %j',
    (value) => {
      expect(parseTabSession(value, LIMIT)).toEqual({
        tabs: [],
        selectedTabId: null,
      });
    }
  );

  it('drops what would not be saved today', () => {
    const session = parseTabSession(
      stored({
        tabs: [
          { tabId: 'a', service: 'APP', name: 'Q-Tube', path: '../../x' },
          { tabId: 'b', service: 'APP' },
          'junk',
          null,
          { tabId: 'a', service: 'APP', name: 'Again' },
          {
            tabId: 'c',
            service: 'APP',
            name: 'Q-Mail',
            identifier: 7,
            flags: { pinned: true, lock: true, tabId: true, odd: 'yes' },
          },
        ],
        selectedTabId: 'b',
      }),
      LIMIT
    );
    expect(session).toEqual({
      tabs: [
        { tabId: 'a', service: 'APP', name: 'Q-Tube' },
        {
          tabId: 'c',
          service: 'APP',
          name: 'Q-Mail',
          flags: { pinned: true },
        },
      ],
      selectedTabId: null,
    });
  });

  it('keeps at most the limit', () => {
    const tabs = Array.from({ length: 12 }, (_, i) => ({
      tabId: `t${i}`,
      service: 'APP',
      name: `App ${i}`,
    }));
    expect(parseTabSession(stored({ tabs }), 3).tabs).toHaveLength(3);
  });
});

describe('restoredTab', () => {
  it('opens an app where it was, with its title and marks', () => {
    expect(
      restoredTab({
        tabId: 'a',
        service: 'APP',
        name: 'Q-Tube',
        identifier: 'v1',
        path: 'video/abc',
        title: 'Q-Tube videos',
        flags: { pinned: true },
      })
    ).toEqual({
      tabId: 'a',
      service: 'APP',
      name: 'Q-Tube',
      identifier: 'v1',
      path: 'video/abc',
      metadata: { title: 'Q-Tube videos' },
      pinned: true,
    });
  });

  it('gives a private app a tab that is reopened before it shows', () => {
    const tab = restoredTab({
      tabId: 'p1',
      service: 'DOCUMENT',
      name: 'Minter',
      identifier: 'app-id',
      isPrivate: true,
      privateAppProperties: {
        service: 'DOCUMENT',
        name: 'Minter',
        identifier: 'app-id',
        groupId: 42,
      },
    });
    expect(tab).not.toHaveProperty('url');
    expect(tab).not.toHaveProperty('isPreview');
    expect(isPrivateTabToReopen(tab)).toBe(true);
    expect(
      isPrivateTabToReopen({
        ...tab,
        isPreview: true,
        url: `${NODE}/render/hash/a`,
      })
    ).toBe(false);
    expect(isPrivateTabToReopen({ tabId: 'a', service: 'APP' })).toBe(false);
  });
});

describe('tabFlags', () => {
  it('takes only true/false fields with plain names', () => {
    expect(
      tabFlags({
        pinned: true,
        muted: false,
        name: 'x',
        isPreview: true,
        'bad-name': true,
        count: 1,
      })
    ).toEqual({ pinned: true, muted: false });
    expect(tabFlags(null)).toEqual({});
  });
});

describe('loadTabSession and saveTabSession', () => {
  it('each account reads only its own tabs', () => {
    const storage = memoryStorage();
    const alice = serializeTabSession(
      [{ tabId: 'a', service: 'APP', name: 'Q-Tube' }],
      'a',
      LIMIT
    );
    expect(saveTabSession('QAlice', alice, storage)).toBe(true);
    expect(loadTabSession('QAlice', LIMIT, storage)).toEqual(alice);
    expect(loadTabSession('QBob', LIMIT, storage)).toEqual({
      tabs: [],
      selectedTabId: null,
    });
    expect([...storage.items.keys()]).toEqual(['ext_open_tabs:QAlice']);
  });

  it('saves nothing and reads nothing without an account', () => {
    const storage = memoryStorage();
    expect(saveTabSession('', { tabs: [], selectedTabId: null }, storage)).toBe(
      false
    );
    expect(storage.items.size).toBe(0);
    expect(loadTabSession(undefined, LIMIT, storage).tabs).toEqual([]);
  });

  it('never throws when storage fails or holds junk', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(
      saveTabSession('QAlice', { tabs: [], selectedTabId: null }, failing)
    ).toBe(false);
    expect(loadTabSession('QAlice', LIMIT, failing).tabs).toEqual([]);
    const junk = memoryStorage();
    junk.setItem('ext_open_tabs:QAlice', '{not json');
    expect(loadTabSession('QAlice', LIMIT, junk).tabs).toEqual([]);
    error.mockRestore();
  });
});

describe('createTabSessionWriter', () => {
  const app = (tabId: string, path?: string) => ({
    tabId,
    service: 'APP',
    name: `App ${tabId}`,
    ...(path ? { path } : {}),
  });
  const session = (
    selectedTabId: string | null,
    ...tabs: ReturnType<typeof app>[]
  ): TabSession => serializeTabSession(tabs, selectedTabId, LIMIT);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves a new list, order or selection at once', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const writer = createTabSessionWriter('QAlice', { storage });
    writer.update(session('a', app('a'), app('b')));
    writer.update(session('a', app('b'), app('a')));
    writer.update(session('b', app('b'), app('a')));
    writer.update(session(null));
    expect(setItem).toHaveBeenCalledTimes(4);
    expect(loadTabSession('QAlice', LIMIT, storage)).toEqual(session(null));
  });

  it('waits before saving a new address inside an app', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const writer = createTabSessionWriter('QAlice', {
      delayMs: 1000,
      storage,
    });
    writer.update(session('a', app('a')));
    writer.update(session('a', app('a', 'one')));
    writer.update(session('a', app('a', 'two')));
    expect(setItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(loadTabSession('QAlice', LIMIT, storage).tabs[0].path).toBe('two');
  });

  it('saves a waiting address when flushed, and nothing twice', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const writer = createTabSessionWriter('QAlice', { storage });
    writer.update(session('a', app('a')));
    writer.update(session('a', app('a', 'one')));
    writer.flush();
    expect(loadTabSession('QAlice', LIMIT, storage).tabs[0].path).toBe('one');
    writer.update(session('a', app('a', 'one')));
    writer.flush();
    vi.runAllTimers();
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('does not write again what is stored already', () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const writer = createTabSessionWriter('QAlice', {
      saved: session('a', app('a', 'one')),
      storage,
    });
    writer.update(session('a', app('a', 'one')));
    vi.runAllTimers();
    expect(setItem).not.toHaveBeenCalled();
    writer.update(session('a', app('a', 'two')));
    vi.runAllTimers();
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('keeps going when storage fails', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writer = createTabSessionWriter('QAlice', {
      storage: {
        setItem: () => {
          throw new Error('quota');
        },
      },
    });
    expect(() => {
      writer.update(session('a', app('a')));
      writer.update(session('a', app('a', 'one')));
      vi.runAllTimers();
      writer.flush();
    }).not.toThrow();
    error.mockRestore();
  });
});

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockWebContents } from '../../src/test/mocks/electron';
import {
  APP_ZOOM_FILE,
  appZoomKey,
  createAppZoomStore,
  guestZoomApp,
  HUB_ZOOM_TAB_PREFIXES,
  keptLevels,
  MAX_SAVED_APPS,
  preparedForGuest,
  registerHubZoomIpc,
  type PreparedGuest,
} from './app-zoom';
import {
  followHubZoom,
  installZoomKeys,
  resetAppZoomForTests,
  type SavedAppZoom,
} from './hub-zoom';

const prepared = (
  service: string,
  name: string,
  tabId = 'tab-1',
  url = `http://127.0.0.1:12391/render/${service}/${encodeURIComponent(name)}`
): PreparedGuest => ({
  owner: { tabId, name, service },
  url,
  isDevMode: false,
});

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'app-zoom-test-'));
});
afterEach(() => {
  resetAppZoomForTests();
  rmSync(folder, { recursive: true, force: true });
});

describe('appZoomKey', () => {
  it('keeps a Q-App and a website of one name apart, whatever the case', () => {
    expect(appZoomKey(prepared('APP', 'Opened-App'))).toBe(
      '["APP","opened-app"]'
    );
    expect(appZoomKey(prepared('APP', 'OPENED-APP'))).toBe(
      '["APP","opened-app"]'
    );
    expect(appZoomKey(prepared('WEBSITE', 'Opened-App'))).toBe(
      '["WEBSITE","opened-app"]'
    );
  });

  it('keeps names with spaces and slashes as they are', () => {
    expect(appZoomKey(prepared('APP', 'Some Publisher/Tools'))).toBe(
      '["APP","some publisher/tools"]'
    );
  });

  it('keeps a dev mode tab by its address', () => {
    const dev = (url: string): PreparedGuest => ({
      owner: { tabId: 't', name: 'devapp', service: 'APP' },
      url,
      isDevMode: true,
    });
    expect(appZoomKey(dev('http://localhost:5173/?theme=dark'))).toBe(
      '["dev","http://localhost:5173"]'
    );
    expect(appZoomKey(dev('http://localhost:5174/'))).toBe(
      '["dev","http://localhost:5174"]'
    );
    expect(appZoomKey(dev('not a url'))).toBeNull();
  });

  it('keeps nothing for an app without a name, or one too long', () => {
    expect(appZoomKey(prepared('APP', ''))).toBeNull();
    expect(appZoomKey(prepared('APP', 'n'.repeat(700)))).toBeNull();
  });
});

describe('guestZoomApp', () => {
  it('gives a tab its app, and Home widgets and screenshot previews the Hub’s zoom', () => {
    expect(guestZoomApp(prepared('APP', 'Opened-App', 'tab-7'))).toEqual({
      kind: 'app',
      key: '["APP","opened-app"]',
      tabId: 'tab-7',
    });
    expect(
      guestZoomApp(
        prepared('APP', 'Opened-App', 'home-widget:Opened-App:go-widget')
      )
    ).toEqual({ kind: 'hub' });
    expect(
      guestZoomApp(prepared('APP', 'Opened-App', 'qhub-shots-1-2'))
    ).toEqual({
      kind: 'hub',
    });
    expect(guestZoomApp(null)).toBeNull();
  });

  it('knows the owner tab ids Hub gives widgets and screenshot previews', () => {
    // If these change, HUB_ZOOM_TAB_PREFIXES must change with them.
    const widget = readFileSync(
      resolve(process.cwd(), 'src/components/HomeWidgets/HomeWidgetView.tsx'),
      'utf8'
    );
    const shots = readFileSync(
      resolve(
        process.cwd(),
        'src/components/Apps/AppPage/ScreenshotCaptureDialog.tsx'
      ),
      'utf8'
    );
    expect(widget).toContain('tabId: `home-widget:${');
    expect(shots).toContain('const tabId = `qhub-shots-${');
    expect(HUB_ZOOM_TAB_PREFIXES).toEqual(['home-widget:', 'qhub-shots-']);
  });
});

describe('keptLevels', () => {
  it('keeps valid levels only, the most recent first', () => {
    const levels: Array<[string, SavedAppZoom]> = [
      ['["APP","old"]', { level: 1, at: 10 }],
      ['["APP","new"]', { level: -0.5, at: 20 }],
      ['["APP","none"]', { level: 0, at: 30 }],
      ['["APP","nan"]', { level: Number.NaN, at: 30 }],
      ['["APP","far"]', { level: 17, at: 30 }],
      ['["APP","\u0007"]', { level: 1, at: 30 }],
      ['x'.repeat(601), { level: 1, at: 30 }],
      ['["APP","undated"]', { level: 2, at: Number.NaN }],
    ];
    expect(keptLevels(levels)).toEqual([
      ['["APP","new"]', { level: -0.5, at: 20 }],
      ['["APP","old"]', { level: 1, at: 10 }],
      ['["APP","undated"]', { level: 2, at: 0 }],
    ]);
  });

  it(`keeps the ${MAX_SAVED_APPS} most recent`, () => {
    const levels = Array.from(
      { length: MAX_SAVED_APPS + 20 },
      (_, n): [string, SavedAppZoom] => [
        `["APP","app-${n}"]`,
        { level: 1, at: n },
      ]
    );
    const kept = keptLevels(levels);
    expect(kept).toHaveLength(MAX_SAVED_APPS);
    expect(kept[0][0]).toBe(`["APP","app-${MAX_SAVED_APPS + 19}"]`);
    expect(kept.some(([key]) => key === '["APP","app-0"]')).toBe(false);
  });
});

describe('createAppZoomStore', () => {
  const file = () => join(folder, APP_ZOOM_FILE);

  it('reads no file, a broken one or another version as no levels', async () => {
    const onError = vi.fn();
    const store = createAppZoomStore(file, onError);

    expect(await store.read()).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    writeFileSync(file(), '{ broken');
    expect(await store.read()).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    writeFileSync(file(), JSON.stringify({ version: 2, apps: {} }));
    expect(await store.read()).toEqual([]);
    writeFileSync(
      file(),
      JSON.stringify({ version: 1, apps: { '["APP","a"]': 'big' } })
    );
    expect(await store.read()).toEqual([]);
  });

  it('writes the last levels once, in one step, and reads them back', async () => {
    const store = createAppZoomStore(file);

    store.save([['["APP","a"]', { level: 1, at: 1 }]]);
    store.save([
      ['["APP","a"]', { level: 1.5, at: 2 }],
      ['["WEBSITE","b"]', { level: -1, at: 3 }],
    ]);
    // Not yet: saves wait for the last change.
    expect(readdirSync(folder)).toEqual([]);
    await store.flush();
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({
      version: 1,
      apps: {
        '["WEBSITE","b"]': { level: -1, at: 3 },
        '["APP","a"]': { level: 1.5, at: 2 },
      },
    });
    // No temporary file left beside it.
    expect(readdirSync(folder)).toEqual([APP_ZOOM_FILE]);
    expect(await createAppZoomStore(file).read()).toEqual([
      ['["WEBSITE","b"]', { level: -1, at: 3 }],
      ['["APP","a"]', { level: 1.5, at: 2 }],
    ]);
  });

  it('writes at once on quit', () => {
    const store = createAppZoomStore(file);

    store.save([['["APP","a"]', { level: 0.5, at: 1 }]]);
    store.flushNow();
    expect(JSON.parse(readFileSync(file(), 'utf8')).apps).toEqual({
      '["APP","a"]': { level: 0.5, at: 1 },
    });
    // Nothing pending: nothing written.
    rmSync(file());
    store.flushNow();
    expect(readdirSync(folder)).toEqual([]);
  });

  it('reports a failed write and keeps going', async () => {
    const onError = vi.fn();
    // The folder for the file is a file.
    writeFileSync(join(folder, 'taken'), '');
    const store = createAppZoomStore(
      () => join(folder, 'taken', APP_ZOOM_FILE),
      onError
    );

    store.save([['["APP","a"]', { level: 1, at: 1 }]]);
    await store.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    store.save([['["APP","a"]', { level: 1, at: 1 }]]);
    expect(() => store.flushNow()).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(2);
  });
});

describe('registerHubZoomIpc', () => {
  const setup = () => {
    const on = new Map<string, (...args: any[]) => void>();
    const handle = new Map<string, (...args: any[]) => unknown>();
    const hub = new MockWebContents();
    const guests = new Map<MockWebContents, PreparedGuest | null>();
    const fromHub = { sender: hub, senderFrame: {} };
    const other = { sender: new MockWebContents(), senderFrame: {} };
    // Hub's quit: before-quit, then app.exit() (no will-quit).
    const quitListeners: Array<() => void> = [];
    const store = registerHubZoomIpc({
      app: {
        on: (_event, listener) => quitListeners.push(listener),
      },
      ipcMain: {
        on: ((channel: string, listener: (...args: any[]) => void) => {
          on.set(channel, listener);
        }) as never,
        handle: ((channel: string, listener: (...args: any[]) => unknown) => {
          handle.set(channel, listener);
        }) as never,
      },
      checkSender: (event) => {
        if ((event as unknown as typeof fromHub).sender !== hub) {
          throw new Error('IPC is restricted to the Hub main document');
        }
      },
      getHubPage: () => hub as never,
      preparedOf: (guest) =>
        guests.get(guest as unknown as MockWebContents) ?? null,
      getFilePath: () => join(folder, APP_ZOOM_FILE),
    });
    installZoomKeys(hub, () => hub, 'linux');
    const open = (item: PreparedGuest) => {
      const guest = new MockWebContents();
      guests.set(guest, item);
      installZoomKeys(guest, () => hub, 'linux');
      followHubZoom(guest, () => hub);
      return guest;
    };
    const quit = () => quitListeners.forEach((listener) => listener());
    return { fromHub, guests, handle, hub, on, open, other, quit, store };
  };
  const tick = () => new Promise((done) => setTimeout(done, 20));

  it('writes a zoom changed just before quitting, before Hub exits', async () => {
    const { fromHub, handle, open, quit } = setup();
    open(prepared('APP', 'Opened-App', 'tab-1'));
    await tick();

    handle.get('hubZoom:change')(fromHub, { tabId: 'tab-1' }, 'in');
    // Hub quits within the moment a save waits for.
    quit();
    expect(
      JSON.parse(readFileSync(join(folder, APP_ZOOM_FILE), 'utf8')).apps
    ).toEqual({
      '["APP","opened-app"]': { level: 0.5, at: expect.any(Number) },
    });
  });

  it('answers and takes changes from the Hub page only', async () => {
    const { fromHub, handle, hub, open, other } = setup();
    open(prepared('APP', 'Opened-App', 'tab-1'));
    await tick();

    expect(() => handle.get('hubZoom:get')(other, 'tab-1')).toThrow(
      'IPC is restricted'
    );
    expect(() => handle.get('hubZoom:change')(other, 'hub', 'in')).toThrow();
    expect(hub.zoomLevel).toBe(0);
    expect(handle.get('hubZoom:get')(fromHub, 'tab-1')).toEqual({
      hub: { level: 0, canIn: true, canOut: true },
      app: { level: 0, canIn: true, canOut: true },
    });
  });

  it('checks what the Hub page asks for', async () => {
    const { fromHub, handle, hub } = setup();
    await tick();
    const change = handle.get('hubZoom:change');

    expect(() => change(fromHub, 'hub', 'sideways')).toThrow(
      'HUB_ZOOM_INVALID_ACTION'
    );
    expect(() => change(fromHub, 'everything', 'in')).toThrow(
      'HUB_ZOOM_INVALID_TARGET'
    );
    expect(() => change(fromHub, { tabId: 'x'.repeat(300) }, 'in')).toThrow(
      'HUB_ZOOM_INVALID_TARGET'
    );
    expect(() => change(fromHub, { tabId: 'a\nb' }, 'in')).toThrow(
      'HUB_ZOOM_INVALID_TARGET'
    );
    expect(hub.zoomLevel).toBe(0);
    expect(handle.get('hubZoom:get')(fromHub, 42).app).toBeNull();
  });

  it('zooms an app from the magnifier, tells the Hub page and saves it', async () => {
    const { fromHub, handle, hub, open, store } = setup();
    const tab = open(prepared('APP', 'Opened-App', 'tab-1'));
    await tick();

    expect(
      handle.get('hubZoom:change')(fromHub, { tabId: 'tab-1' }, 'in')
    ).toEqual({
      hub: { level: 0, canIn: true, canOut: true },
      app: { level: 0.5, canIn: true, canOut: true },
    });
    expect(tab.zoomLevel).toBe(0.5);
    // Besides the notice that the levels were read (source 'load').
    expect(
      hub.sent.filter((sent) => (sent.args[0] as any).source !== 'load')
    ).toEqual([
      {
        channel: 'hubZoom:changed',
        args: [
          {
            what: 'app',
            key: '["APP","opened-app"]',
            tabIds: ['tab-1'],
            source: 'panel',
          },
        ],
      },
    ]);
    expect(hub.sent[0]).toEqual({
      channel: 'hubZoom:changed',
      args: [{ what: 'hub', source: 'load' }],
    });
    await store.flush();
    expect(
      JSON.parse(readFileSync(join(folder, APP_ZOOM_FILE), 'utf8')).apps
    ).toEqual({
      '["APP","opened-app"]': { level: 0.5, at: expect.any(Number) },
    });
  });

  it('puts apps open at start at the zoom saved for them', async () => {
    writeFileSync(
      join(folder, APP_ZOOM_FILE),
      JSON.stringify({
        version: 1,
        apps: { '["APP","opened-app"]': { level: 1, at: 1 } },
      })
    );
    const { fromHub, handle, open } = setup();
    // Opened before the file was read.
    const tab = open(prepared('APP', 'Opened-App', 'tab-1'));
    const widget = open(
      prepared('APP', 'Opened-App', 'home-widget:Opened-App:go-widget')
    );
    expect(tab.zoomLevel).toBe(0);
    await tick();
    expect(tab.zoomLevel).toBe(1);
    expect(widget.zoomLevel).toBe(0);
    expect(handle.get('hubZoom:get')(fromHub, 'tab-1').app.level).toBe(1);
  });

  it('takes the Hub page’s report of what is on screen, checked', async () => {
    const { fromHub, hub, on, open, other } = setup();
    const tab = open(prepared('APP', 'Opened-App', 'tab-1'));
    await tick();
    const key = () =>
      tab.emit(
        'before-input-event',
        { preventDefault: vi.fn() },
        {
          type: 'keyDown',
          key: '=',
          code: 'Equal',
          control: true,
          alt: false,
          meta: false,
          shift: false,
          isComposing: false,
          isAutoRepeat: false,
        }
      );

    on.get('hubZoom:onScreen')(fromHub, { tabId: 'tab-1', locked: false });
    // Another page's report is ignored: Hub stays unlocked.
    on.get('hubZoom:onScreen')(other, { tabId: 'tab-1', locked: true });
    key();
    expect(tab.zoomLevel).toBe(0.5);
    expect(hub.zoomLevel).toBe(0);
    on.get('hubZoom:onScreen')(fromHub, { tabId: 'tab-1', locked: true });
    key();
    expect(hub.zoomLevel).toBe(0.5);
    // A report of the wrong shape is ignored too.
    expect(() => on.get('hubZoom:onScreen')(fromHub, 'unlocked')).not.toThrow();
    // Only true locks.
    on.get('hubZoom:onScreen')(fromHub, { tabId: 'tab-1', locked: 'no' });
    key();
    // The app's own zoom (1) on top of the Hub's (0.5).
    expect(tab.zoomLevel).toBe(1.5);
    expect(hub.zoomLevel).toBe(0.5);
    // A tab id that is none: no app on screen, so Hub.
    on.get('hubZoom:onScreen')(fromHub, { tabId: 7, locked: false });
    key();
    expect(hub.zoomLevel).toBe(1);
    expect(tab.zoomLevel).toBe(2);
  });

  it('takes the pointer on the magnifier from the Hub page only', async () => {
    const { fromHub, hub, on, open, other } = setup();
    const tab = open(prepared('APP', 'Opened-App', 'tab-1'));
    await tick();
    const keyInHub = () =>
      hub.emit(
        'before-input-event',
        { preventDefault: vi.fn() },
        {
          type: 'keyDown',
          key: '=',
          code: 'Equal',
          control: true,
          alt: false,
          meta: false,
          shift: false,
          isComposing: false,
          isAutoRepeat: false,
        }
      );
    hub.emit('before-mouse-event', {}, { type: 'mouseMove' });

    on.get('hubZoom:panelPointer')(other, 'tab-1');
    keyInHub();
    expect(hub.zoomLevel).toBe(0.5);
    on.get('hubZoom:panelPointer')(fromHub, 'tab-1');
    keyInHub();
    expect(hub.zoomLevel).toBe(0.5);
    expect(tab.zoomLevel).toBe(1);
    on.get('hubZoom:panelPointer')(fromHub, undefined);
    keyInHub();
    expect(hub.zoomLevel).toBe(1);
  });
});

const tick = () => new Promise((done) => setTimeout(done, 20));

type Prepared = PreparedGuest & { partition: string };
type Guest = MockWebContents & {
  session: string;
  url: string;
  getURL(): string;
};

/**
 * Main as setup.ts wires it: the guest's hello, or before it, what Hub
 * prepared for the guest's partition and address.
 */
const setup = async (levels: Record<string, number>) => {
  writeFileSync(
    join(folder, APP_ZOOM_FILE),
    JSON.stringify({
      version: 1,
      apps: Object.fromEntries(
        Object.entries(levels).map(([key, level]) => [key, { level, at: 1 }])
      ),
    })
  );
  const handle = new Map<string, (...args: any[]) => unknown>();
  const hub = new MockWebContents();
  const fromHub = { sender: hub, senderFrame: {} };
  const prepared: Prepared[] = [];
  const attached = new Map<Guest, Prepared | null>();
  registerHubZoomIpc({
    app: { on: () => undefined },
    ipcMain: {
      on: (() => undefined) as never,
      handle: ((channel: string, listener: (...args: any[]) => unknown) => {
        handle.set(channel, listener);
      }) as never,
    },
    checkSender: (event) => {
      if ((event as unknown as typeof fromHub).sender !== hub) {
        throw new Error('IPC is restricted to the Hub main document');
      }
    },
    getHubPage: () => hub as never,
    // As setup.ts finds it.
    preparedOf: (contents) => {
      const guest = contents as unknown as Guest;
      return preparedForGuest(
        attached.get(guest),
        prepared,
        (partition) => guest.session === partition,
        guest.getURL()
      );
    },
    getFilePath: () => join(folder, APP_ZOOM_FILE),
  });
  // The search bar asks as it mounts, before any app opens: the levels are
  // read then.
  const get = (tabId: string) =>
    handle.get('hubZoom:get')(fromHub, tabId) as {
      app: { level: number } | null;
    };
  get('none');
  await tick();

  /**
   * Hub prepares the tab (qappGuest:prepare) and sets the webview's src to
   * the same address; the guest attaches, its first page commits, and then
   * its preload's hello binds it. Measured in Electron 44.1.1: did-navigate
   * comes before the hello, every time, and the committed address is the
   * canonical one (`http://127.0.0.1:5173?a` commits as
   * `http://127.0.0.1:5173/?a`).
   */
  const open = (item: Prepared, committedUrl: string) => {
    prepared.push(item);
    const guest = new MockWebContents() as Guest;
    guest.session = item.partition;
    guest.url = '';
    guest.getURL = () => guest.url;
    attached.set(guest, null);
    followHubZoom(guest, () => hub);
    guest.url = committedUrl;
    guest.emit('did-navigate');
    attached.set(guest, item);
    return guest;
  };
  return { get, hub, open };
};

describe('a second Hub instance', () => {
  it('reads back the zooms it saved in its own userData', async () => {
    // index.ts imports setup.ts (which calls registerHubZoomIpc at its top
    // level) and only then runs setupMultiInstanceUserData(), which moves
    // userData to <appData>/qortal-instance-N when port 55000 is taken.
    const defaultUserData = join(folder, 'Qortal Hub');
    const instanceUserData = join(folder, 'qortal-instance-2');
    for (const [dir, level] of [
      [defaultUserData, -1],
      [instanceUserData, 2],
    ] as const) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, APP_ZOOM_FILE),
        JSON.stringify({
          version: 1,
          apps: { '["APP","opened-app"]': { level, at: 1 } },
        })
      );
    }
    let userData = defaultUserData;
    const hub = new MockWebContents();
    const guests = new Map<MockWebContents, PreparedGuest>();
    registerHubZoomIpc({
      app: { on: () => undefined },
      ipcMain: {
        on: (() => undefined) as never,
        handle: (() => undefined) as never,
      },
      checkSender: () => undefined,
      getHubPage: () => hub as never,
      preparedOf: (guest) =>
        guests.get(guest as unknown as MockWebContents) ?? null,
      getFilePath: () => join(userData, APP_ZOOM_FILE),
    });
    // setupMultiInstanceUserData(): app.setPath('userData', …instance-2).
    userData = instanceUserData;
    await tick();

    // This instance's tab of the app it zoomed to 2 levels last time.
    const tab = new MockWebContents();
    guests.set(tab, {
      owner: { tabId: 'tab-1', name: 'Opened-App', service: 'APP' },
      url: 'http://127.0.0.1:12391/render/APP/Opened-App',
      isDevMode: false,
    });
    followHubZoom(tab, () => hub);
    tab.emit('did-navigate');
    await tick();

    // Its own 2, not the first instance's -1.
    expect(tab.zoomLevel).toBe(2);
  });
});

describe('a dev mode tab reopened', () => {
  it('opens a Q-App tab at the zoom kept for it (as a control)', async () => {
    const { get, open } = await setup({ '["APP","opened-app"]': 1 });
    const url =
      'http://127.0.0.1:12391/render/APP/Opened-App?theme=dark&lang=en&identifier=';

    const tab = open(
      {
        owner: { tabId: 'tab-1', name: 'Opened-App', service: 'APP' },
        url,
        isDevMode: false,
        partition: 'persist:qapp-a',
      },
      url
    );

    expect(tab.zoomLevel).toBe(1);
    expect(get('tab-1').app.level).toBe(1);
  });

  it('opens a dev server tab at the zoom kept for it', async () => {
    const { get, open } = await setup({ '["dev","http://127.0.0.1:5173"]': 1 });

    // AppsDevModeHome's tab ('http://' + LOCALHOST + ':' + port) as AppViewer
    // loads it: app.url + '?theme=…&lang=…'.
    const tab = open(
      {
        owner: { tabId: 'tab-dev', name: 'devapp', service: 'APP' },
        url: 'http://127.0.0.1:5173?theme=dark&lang=en',
        isDevMode: true,
        partition: 'persist:qapp-dev',
      },
      'http://127.0.0.1:5173/?theme=dark&lang=en'
    );

    // Main says 120 % (what the magnifier shows), and the page is there,
    // though its address commits written differently.
    expect(get('tab-dev').app.level).toBe(1);
    expect(tab.zoomLevel).toBe(1);
  });
});

describe('two private apps of one publisher', () => {
  it('keeps each one’s zoom, as the panel says (“Kept for <app>”)', async () => {
    const handle = new Map<string, (...args: any[]) => unknown>();
    const hub = new MockWebContents();
    const fromHub = { sender: hub, senderFrame: {} };
    const guests = new Map<MockWebContents, PreparedGuest>();
    registerHubZoomIpc({
      app: { on: () => undefined },
      ipcMain: {
        on: (() => undefined) as never,
        handle: ((channel: string, listener: (...args: any[]) => unknown) => {
          handle.set(channel, listener);
        }) as never,
      },
      checkSender: () => undefined,
      getHubPage: () => hub as never,
      preparedOf: (guest) =>
        guests.get(guest as unknown as MockWebContents) ?? null,
      getFilePath: () => join(folder, APP_ZOOM_FILE),
    });
    handle.get('hubZoom:get')(fromHub, null);
    await tick();
    // useHandlePrivateApps opens each with name/service from its
    // privateAppProperties (the publisher's name, its own identifier), at
    // its own preview address.
    const open = (tabId: string, hash: string) => {
      const guest = new MockWebContents();
      guests.set(guest, {
        owner: {
          tabId,
          name: 'Publisher',
          service: 'DOCUMENT',
          identifier: hash,
        },
        url: `http://127.0.0.1:12391/render/hash/${hash}?secret=s&theme=dark&lang=en`,
        isDevMode: false,
      });
      followHubZoom(guest, () => hub);
      guest.emit('did-navigate');
      return guest;
    };
    const tools = open('tab-tools', 'HashOfTools');
    const notes = open('tab-notes', 'HashOfNotes');

    handle.get('hubZoom:change')(fromHub, { tabId: 'tab-tools' }, 'in');

    expect(tools.zoomLevel).toBe(0.5);
    expect(notes.zoomLevel).toBe(0);
  });
});

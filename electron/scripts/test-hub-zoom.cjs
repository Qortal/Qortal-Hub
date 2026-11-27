// Real Electron regression for the Hub's zoom (src/hub-zoom.ts): View's zoom
// items and the zoom keys zoom the Hub page, also from inside a Q-App, and
// every Q-App follows, also one opened or reopened later. Then each app's own
// zoom: the pointer decides what a key zooms, an app keeps its zoom on top of
// the Hub's, across its pages and reopening, and its Home widget, in the same
// partition, keeps the Hub's. Q-Apps are loopback HTTP <webview>s in
// partitions of their own, one of them in a hidden tab, as in the Hub.
// Isolated userData.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { app, BrowserWindow, Menu, protocol } = require('electron');
const {
  configureAppZoom,
  followHubZoom,
  installZoomKeys,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  menuPopupPoint,
  viewMenu,
} = require('../build/src/hub-zoom');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-zoom-'));
app.setPath('userData', path.join(scratch, 'userData'));
app.commandLine.appendSwitch('disable-gpu');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'capacitor-electron',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const shellUrl = 'capacitor-electron://-';
const web = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>Q-App</title>');
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchdog = setTimeout(() => {
  console.error('Hub zoom test timed out');
  app.exit(1);
}, 30_000);
let main;

app.whenReady().then(async () => {
  try {
    await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
    const port = web.address().port;
    const qapp = (id, host, style = '') =>
      `<div style="${style}"><webview id="${id}" partition="persist:${id}"` +
      ` src="http://${host}:${port}/${id}"></webview></div>`;
    protocol.handle(
      'capacitor-electron',
      () =>
        new Response(
          '<!doctype html><title>Hub shell fixture</title><body>' +
            '<button id="hub">Hub</button>' +
            qapp('shown', '127.0.0.1') +
            qapp('hidden', 'localhost', 'display:none') +
            '</body>',
          { headers: { 'Content-Type': 'text/html' } }
        )
    );
    main = new BrowserWindow({
      show: false,
      frame: false,
      webPreferences: { contextIsolation: true, webviewTag: true },
    });
    const hubPage = () =>
      main && !main.isDestroyed() ? main.webContents : null;
    const guests = new Map();
    const loaded = [];
    main.webContents.on('did-attach-webview', (_event, guest) => {
      installZoomKeys(guest, hubPage, process.platform);
      followHubZoom(guest, hubPage);
      loaded.push(
        new Promise((resolve) => guest.once('did-finish-load', resolve)).then(
          async () =>
            guests.set(
              await guest.executeJavaScript('location.pathname.slice(1)'),
              guest
            )
        )
      );
    });
    installZoomKeys(main.webContents, hubPage, process.platform);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'fileMenu' },
        viewMenu(hubPage),
        { role: 'editMenu' },
      ])
    );
    await main.loadURL(shellUrl);
    while (loaded.length < 2) await delay(50);
    await Promise.all(loaded);
    const shown = guests.get('shown');
    const hidden = guests.get('hidden');

    const levels = () => [
      main.webContents.getZoomLevel(),
      shown.getZoomLevel(),
      hidden.getZoomLevel(),
    ];
    const expectAll = async (level, what) => {
      await delay(100);
      assert.deepEqual(levels(), [level, level, level], what);
    };
    const mod = process.platform === 'darwin' ? 'meta' : 'control';
    const type = async (contents, keyCode, modifiers = [mod], wait = 100) => {
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await delay(wait);
    };

    // The menu, clicked as Electron clicks it: the Hub page zooms, with
    // every Q-App, the hidden one too.
    const view = Menu.getApplicationMenu().items.find(
      (item) => item.label === 'View'
    );
    const item = (label) =>
      view.submenu.items.find((entry) => entry.label === label);
    item('Zoom In').click();
    await expectAll(0.5, 'View → Zoom In');
    item('Zoom Out').click();
    item('Zoom Out').click();
    await expectAll(-0.5, 'View → Zoom Out');
    item('Actual Size').click();
    await expectAll(0, 'View → Actual Size');

    // Keys in the Hub page. Ctrl+Shift+= is also the menu's own shortcut:
    // one press is still one step.
    await type(main.webContents, '=');
    await expectAll(0.5, 'Ctrl+=');
    await type(main.webContents, 'Plus', [mod, 'shift']);
    await expectAll(1, 'Ctrl+Shift+=');
    await type(main.webContents, 'numadd');
    await expectAll(1.5, 'Ctrl and keypad +');
    await type(main.webContents, '-');
    await type(main.webContents, 'numsub');
    await expectAll(0.5, 'Ctrl+- and keypad -');
    await type(main.webContents, '0');
    await expectAll(0, 'Ctrl+0');

    // Keys typed inside a Q-App zoom the Hub page too. They are the Hub's:
    // the Q-App never gets them, while its other keys go on to it.
    const taken = [];
    shown.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown') {
        taken.push([input.key, event.defaultPrevented]);
      }
    });
    await type(shown, '=');
    await type(shown, '=');
    await expectAll(1, 'Ctrl+= in a Q-App');
    await type(shown, 'a', []);
    await type(shown, '0');
    await expectAll(0, 'Ctrl+0 in a Q-App');
    assert.deepEqual(taken, [
      ['=', true],
      ['=', true],
      ['a', false],
      ['0', true],
    ]);

    // A Q-App opened afterwards starts at the Hub's zoom.
    const openLate = async () => {
      const attached = new Promise((resolve) =>
        main.webContents.once('did-attach-webview', (_event, guest) =>
          guest.once('did-finish-load', () => resolve(guest))
        )
      );
      await main.webContents.executeJavaScript(
        `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(qapp('late', '127.0.0.1'))})`
      );
      const guest = await attached;
      await delay(100);
      return guest;
    };
    const expectAt = (guest, level, what) =>
      assert.ok(
        Math.abs(guest.getZoomLevel() - level) < 1e-9,
        `${what}: at ${guest.getZoomLevel()}, the Hub at ${level}`
      );
    await type(main.webContents, '=');
    expectAt(await openLate(), 0.5, 'a Q-App opened later');

    // Closed and reopened after the Hub's zoom changed, it starts at the
    // Hub's zoom, not at the level its partition kept for its site.
    await main.webContents.executeJavaScript(
      "document.getElementById('late').parentElement.remove()"
    );
    await type(main.webContents, '-');
    await type(main.webContents, '-');
    expectAt(await openLate(), -0.5, 'a Q-App reopened');

    // The steps stop where Chromium stops, with no press lost there.
    const pressTimes = async (times, keyCode) => {
      for (let press = 0; press < times; press++) {
        await type(main.webContents, keyCode, [mod], 10);
      }
    };
    await pressTimes(25, '=');
    await expectAll(MAX_ZOOM_LEVEL, 'up to the top');
    await type(main.webContents, '-');
    await expectAll(MAX_ZOOM_LEVEL - 0.5, 'one step down from the top');
    await pressTimes(40, '-');
    await expectAll(MIN_ZOOM_LEVEL, 'down to the bottom');

    // Each app's own zoom. Which app a webview shows, as setup.ts says it:
    // the shown Q-App and the hidden one are tabs; a widget of the shown one,
    // in its partition and at its site, follows the Hub.
    const appOf = (guest) => {
      const id = new URL(guest.getURL() || 'about:blank').pathname.slice(1);
      if (id === 'shown' || id.startsWith('shown-')) {
        return { kind: 'app', key: 'APP shown', tabId: 'tab-shown' };
      }
      if (id === 'hidden') {
        return { kind: 'app', key: 'APP hidden', tabId: 'tab-hidden' };
      }
      return id === 'widget' ? { kind: 'hub' } : null;
    };
    configureAppZoom({ appOf, getHubPage: hubPage });
    item('Actual Size').click();
    const widget = await (async () => {
      const attached = new Promise((resolve) =>
        main.webContents.once('did-attach-webview', (_event, guest) =>
          guest.once('did-finish-load', () => resolve(guest))
        )
      );
      await main.webContents.executeJavaScript(
        `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(
          `<div><webview id="widget" partition="persist:shown" src="http://127.0.0.1:${port}/widget"></webview></div>`
        )})`
      );
      return attached;
    })();
    await delay(100);
    const now = () => ({
      hub: main.webContents.getZoomLevel(),
      shown: shown.getZoomLevel(),
      hidden: hidden.getZoomLevel(),
      widget: widget.getZoomLevel(),
    });
    assert.deepEqual(
      [shown, hidden, widget].map((guest) => guest.getZoomMode()),
      ['isolated', 'isolated', 'isolated'],
      'every webview zooms on its own'
    );
    // Where the pointer is, as each page reports it to main: a mouse move
    // reaches the page under the pointer only. (This window is hidden, so
    // the test sends each move to that page itself.)
    const pointerOn = async (contents) => {
      contents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 });
      await delay(60);
    };
    let shownNow = shown;
    const overShown = () => pointerOn(shownNow);
    const overHub = () => pointerOn(main.webContents);

    await overShown();
    await type(main.webContents, '=');
    assert.deepEqual(
      now(),
      { hub: 0, shown: 0.5, hidden: 0, widget: 0 },
      'a key with the pointer on an app zooms that app only, not its widget'
    );
    await type(shown, '=');
    assert.deepEqual(now(), { hub: 0, shown: 1, hidden: 0, widget: 0 });

    await overHub();
    await type(shown, '=');
    assert.deepEqual(
      now(),
      { hub: 0.5, shown: 1.5, hidden: 0.5, widget: 0.5 },
      'the pointer on Hub zooms Hub; the app keeps its own zoom on top'
    );

    // Kept across the app's own pages and a reload.
    await new Promise((resolve) => {
      shown.once('did-finish-load', resolve);
      shown.loadURL(`http://127.0.0.1:${port}/shown-page-2`);
    });
    await delay(100);
    assert.equal(shown.getZoomLevel(), 1.5, 'kept on another page');
    await new Promise((resolve) => {
      shown.once('did-finish-load', resolve);
      shown.reload();
    });
    await delay(100);
    assert.equal(shown.getZoomLevel(), 1.5, 'kept on a reload');
    assert.equal(widget.getZoomLevel(), 0.5, 'its widget still at the Hub’s');

    // Closed and opened again: at its own zoom, on top of the Hub's.
    await main.webContents.executeJavaScript(
      "document.getElementById('shown').parentElement.remove()"
    );
    await delay(100);
    const reopened = await (async () => {
      const attached = new Promise((resolve) =>
        main.webContents.once('did-attach-webview', (_event, guest) =>
          guest.once('did-finish-load', () => resolve(guest))
        )
      );
      await main.webContents.executeJavaScript(
        `document.body.insertAdjacentHTML('afterbegin', ${JSON.stringify(qapp('shown', '127.0.0.1'))})`
      );
      return attached;
    })();
    await delay(100);
    assert.equal(reopened.getZoomLevel(), 1.5, 'reopened at its own zoom');
    shownNow = reopened;

    // Ctrl+0 with the pointer on the app: back to the Hub's zoom.
    await overShown();
    await type(main.webContents, '0');
    assert.equal(reopened.getZoomLevel(), 0.5, 'Ctrl+0 on the app');
    await overHub();
    await type(main.webContents, '0');
    assert.equal(reopened.getZoomLevel(), 0, 'Ctrl+0 on Hub');
    assert.equal(main.webContents.getZoomLevel(), 0);
    configureAppZoom({ appOf: () => null, getHubPage: hubPage });

    // The title bar's menu opens at a zoomed click: whole window pixels.
    item('Zoom In').click();
    const menu = Menu.getApplicationMenu();
    menu.popup({
      window: main,
      ...menuPopupPoint({ x: 12.5, y: 7.25 }, main.webContents.getZoomFactor()),
    });
    menu.closePopup(main);

    console.log(
      "PASS: View menu, zoom keys in the Hub page and in a Q-App, Q-Apps following (hidden, opened later and reopened), limits, each app's own zoom (by the pointer, on top of the Hub's, kept across pages and reopening, its widget apart), and the menu popup point"
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    if (main && !main.isDestroyed()) main.destroy();
    web.closeAllConnections();
    web.close();
    app.exit(process.exitCode || 0);
  }
});
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

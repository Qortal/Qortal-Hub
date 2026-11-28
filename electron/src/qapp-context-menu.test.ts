import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_QORTINO_TEXT,
  MAX_SUGGESTIONS,
  MENU_TTL_MS,
  QAppContextMenus,
  appPageLink,
  avatarName,
  browserLink,
  cleanFileName,
  copyableLink,
  elementText,
  hubLink,
  isLinkedFile,
  isQortalAddress,
  lookUpName,
  lookUpText,
  menuItemsFor,
  openableLink,
  pictureEmbedLink,
  qortinoText,
  readElementInfo,
  readFoundName,
  registerQAppMenuIpc,
  shownPageLink,
  LOOKUP_MS,
  withFoundPicture,
  withFoundVideo,
  withFound,
  saveFileName,
  savableUrl,
  screenRect,
  withFileExtension,
  type QAppMenuDeps,
  type QAppMenuGuest,
  type QAppMenuParams,
} from './qapp-context-menu';
import {
  QAPP_GUEST_ISOLATED_WORLD,
  QAPP_MENU_CHANNELS,
  QAPP_MENU_GUEST_KEY,
  type QAppElementInfo,
  type QAppMenuOpen,
  type QAppSaveUpdate,
} from './qapp-context-menu-types';

const NODE = 'http://127.0.0.1:12391';
const DOWNLOADS = path.join(path.sep, 'home', 'user', 'Downloads');
const NOW = new Date(2026, 10, 20, 15, 49, 7);

const params = (overrides: Partial<QAppMenuParams> = {}): QAppMenuParams => ({
  x: 130,
  y: 90,
  mediaType: 'none',
  srcURL: '',
  linkURL: '',
  selectionText: '',
  isEditable: false,
  hasImageContents: false,
  misspelledWord: '',
  dictionarySuggestions: [],
  editFlags: {
    canUndo: false,
    canRedo: false,
    canCut: false,
    canCopy: false,
    canPaste: false,
    canSelectAll: true,
  },
  mediaFlags: { canSave: false, hasAudio: false },
  ...overrides,
});

const guestInfo: QAppMenuGuest = {
  tabId: 'tab-1',
  appName: 'Opened-App',
  nodeOrigin: NODE,
  service: 'APP',
  devApp: false,
};
const DEV_MODE = { devMode: true, qortino: false };
const QORTINO_SET_UP = { devMode: false, qortino: true };

const actions = (items: ReturnType<typeof menuItemsFor>) =>
  items.map((item) => ('separator' in item ? '|' : item.action));

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest();
/**
 * A Qortal address as Core makes one from a public key's 20-byte hash: its
 * first byte (58, the Q), the hash, and 4 bytes checking them.
 */
const addressFrom = (hash: Buffer, version = 58) => {
  const body = Buffer.concat([Buffer.from([version]), hash]);
  const whole = Buffer.concat([body, sha256(sha256(body)).subarray(0, 4)]);
  let number = BigInt(`0x${whole.toString('hex')}`);
  let text = '';
  while (number > BigInt(0)) {
    text = BASE58[Number(number % BigInt(58))] + text;
    number /= BigInt(58);
  }
  return text;
};
const ADDRESS = addressFrom(Buffer.alloc(20, 7));
/** Shaped as an address, but its last bytes don't check it. */
const MADE_UP_ADDRESS = 'QPubsherAddrxyz123456789ABCDEFGHJK';
const avatarOf = (name: string) =>
  `${NODE}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar?async=true`;

class FakeSession extends EventEmitter {
  words: string[] = [];
  addWordToSpellCheckerDictionary(word: string) {
    this.words.push(word);
    return true;
  }
}

class FakeGuest extends EventEmitter {
  destroyed = false;
  session = new FakeSession();
  calls: string[] = [];
  downloads: string[] = [];
  replaced: string[] = [];
  copiedAt: [number, number][] = [];
  focused = 0;
  isDestroyed() {
    return this.destroyed;
  }
  focus() {
    this.focused += 1;
  }
  undo() {
    this.calls.push('undo');
  }
  redo() {
    this.calls.push('redo');
  }
  cut() {
    this.calls.push('cut');
  }
  copy() {
    this.calls.push('copy');
  }
  paste() {
    this.calls.push('paste');
  }
  selectAll() {
    this.calls.push('selectAll');
  }
  async insertText(word: string) {
    this.replaced.push(word);
  }
  copyImageAt(x: number, y: number) {
    this.copiedAt.push([x, y]);
  }
  downloadURL(url: string) {
    this.downloads.push(url);
  }
  zoom = 1;
  inputs: {
    type: string;
    x: number;
    y: number;
    button?: string;
    modifiers?: string[];
  }[] = [];
  /** The app's own page: a right-click elsewhere was inside a frame of it. */
  mainFrame = { page: 'own' };
  // Electron: a closed webview throws for anything but isDestroyed().
  private alive() {
    if (this.destroyed) throw new Error('Object has been destroyed');
  }
  getZoomFactor() {
    this.alive();
    return this.zoom;
  }
  sendInputEvent(event: { type: string; x: number; y: number }) {
    this.inputs.push(event);
  }
  // As Hub opens an app: with its theme, language and identifier.
  url = `${NODE}/render/APP/Opened-App/video/1?theme=dark&lang=en&identifier=`;
  getURL() {
    this.alive();
    return this.url;
  }
  /** Calls into the app's preload: [world, code, user gesture]. */
  guestCalls: [number, string, boolean][] = [];
  /** What the app's preload answers a call with. */
  answer: (code: string) => unknown = () => null;
  executeJavaScriptInIsolatedWorld(
    world: number,
    scripts: { code: string }[],
    userGesture: boolean
  ) {
    this.alive();
    this.guestCalls.push([world, scripts[0].code, userGesture]);
    return Promise.resolve(this.answer(scripts[0].code));
  }
  captured: { x: number; y: number; width: number; height: number }[] = [];
  capturePage(rect: { x: number; y: number; width: number; height: number }) {
    this.alive();
    this.captured.push(rect);
    return Promise.resolve(fakeImage('screen'));
  }
  inspected: [number, number][] = [];
  inspectElement(x: number, y: number) {
    this.inspected.push([x, y]);
  }
}

/** A NativeImage stand-in: what it was made from. */
const fakeImage = (from: string, empty = false) => ({
  from,
  isEmpty: () => empty,
  toPNG: () => Buffer.from(`png of ${from}`),
});

class FakeHub {
  sent: [string, unknown][] = [];
  zoom = 1;
  focused = 0;
  destroyed = false;
  send(channel: string, payload: unknown) {
    this.sent.push([channel, payload]);
  }
  getZoomFactor() {
    return this.zoom;
  }
  focus() {
    this.focused += 1;
  }
  isDestroyed() {
    return this.destroyed;
  }
}

class FakeItem extends EventEmitter {
  savePath = '';
  received = 0;
  cancelled = false;
  constructor(
    readonly url: string,
    readonly filename: string,
    readonly total = 1000
  ) {
    super();
  }
  getURL() {
    return this.url;
  }
  getURLChain() {
    return [this.url];
  }
  getFilename() {
    return this.filename;
  }
  setSavePath(filePath: string) {
    this.savePath = filePath;
  }
  getTotalBytes() {
    return this.total;
  }
  getReceivedBytes() {
    return this.received;
  }
  cancel() {
    this.cancelled = true;
    this.emit('done', {}, 'cancelled');
  }
}

/** Lets promises already resolved run (works with fake timers too). */
const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

/** Electron's will-download event: preventDefault() stops the download. */
const downloadEvent = () => ({ preventDefault: vi.fn() });

describe('what the menu may save and copy', () => {
  it("saves blob:, data: and the app's own node's files only", () => {
    expect(savableUrl(`${NODE}/arbitrary/IMAGE/Publisher/pic-1`, NODE)).toBe(
      true
    );
    expect(savableUrl(`blob:${NODE}/0f8a`, NODE)).toBe(true);
    expect(savableUrl('data:image/png;base64,AAAA', NODE)).toBe(true);
    expect(savableUrl('blob:http://127.0.0.1:9999/0f8a', NODE)).toBe(false);
    expect(savableUrl('http://127.0.0.1:9999/pic.png', NODE)).toBe(false);
    expect(savableUrl('https://example.org/pic.png', NODE)).toBe(false);
    expect(savableUrl('data:text/html,<p>x</p>', NODE)).toBe(false);
    expect(savableUrl('javascript:alert(1)', NODE)).toBe(false);
    expect(savableUrl('file:///etc/hosts', NODE)).toBe(false);
    expect(savableUrl('not a url', NODE)).toBe(false);
    expect(savableUrl(undefined, NODE)).toBe(false);
  });

  it("offers to save a link's file, not a page of the app", () => {
    expect(isLinkedFile(`${NODE}/arbitrary/FILE/Publisher/doc-1`, NODE)).toBe(
      true
    );
    expect(isLinkedFile(`blob:${NODE}/0f8a`, NODE)).toBe(true);
    expect(isLinkedFile(`${NODE}/render/APP/Opened-App/page`, NODE)).toBe(
      false
    );
    expect(isLinkedFile('https://example.org/file.zip', NODE)).toBe(false);
  });

  it('copies links into apps as qortal:// links, others as they are', () => {
    expect(
      copyableLink(`${NODE}/render/APP/Opened-App/video/1?t=3#top`, NODE)
    ).toBe('qortal://APP/Opened-App/video/1?t=3#top');
    expect(copyableLink(`${NODE}/render/WEBSITE/Publisher%20Site`, NODE)).toBe(
      'qortal://WEBSITE/Publisher%20Site'
    );
    // A private app's preview: its address carries the secret that opens it.
    expect(copyableLink(`${NODE}/render/hash/abc`, NODE)).toBeNull();
    expect(
      copyableLink(`${NODE}/render/hash/abc/page?secret=preview-key`, NODE)
    ).toBeNull();
    expect(copyableLink(`${NODE}/arbitrary/FILE/Publisher/doc-1`, NODE)).toBe(
      `${NODE}/arbitrary/FILE/Publisher/doc-1`
    );
    expect(copyableLink('https://example.org/a', NODE)).toBe(
      'https://example.org/a'
    );
    expect(copyableLink('qortal://APP/Opened-App', NODE)).toBe(
      'qortal://APP/Opened-App'
    );
    for (const link of [
      'javascript:alert(1)',
      'data:text/plain,hi',
      `blob:${NODE}/0f8a`,
      'file:///etc/hosts',
      '',
    ]) {
      expect(copyableLink(link, NODE)).toBeNull();
    }
  });
});

describe('file names', () => {
  const name = (url: string, suggested?: string) =>
    saveFileName({ url, appName: 'Opened-App', now: NOW, suggested });

  it("uses the link's own download name first", () => {
    expect(name(`blob:${NODE}/0f8a`, 'report.pdf')).toBe('report.pdf');
  });

  it('names what has no name after the app and the time', () => {
    expect(name(`blob:${NODE}/0f8a`)).toBe('Opened-App 2026-11-20 15-49-07');
    expect(name('data:image/png;base64,AAAA')).toBe(
      'Opened-App 2026-11-20 15-49-07.png'
    );
  });

  it("uses a QDN file's path, identifier or publisher", () => {
    expect(name(`${NODE}/arbitrary/IMAGE/Publisher/pic-1`)).toBe('pic-1');
    expect(name(`${NODE}/arbitrary/IMAGE/Publisher/default`)).toBe('Publisher');
    expect(name(`${NODE}/arbitrary/IMAGE/Publisher`)).toBe('Publisher');
    expect(
      name(`${NODE}/arbitrary/WEBSITE/Publisher/default/img/a%20b.webp`)
    ).toBe('a b.webp');
    expect(
      name(
        `${NODE}/arbitrary/FILE/Publisher/doc-1?attachment=true&attachmentFilename=notes.txt`
      )
    ).toBe('notes.txt');
  });

  it('cleans names a file system refuses or could hide', () => {
    expect(cleanFileName('a/b:c?d*.png')).toBe('a b c d .png');
    expect(cleanFileName('fake\u202egnp.exe')).toBe('fake gnp.exe');
    expect(cleanFileName('  ..hidden..  ')).toBe('hidden');
    expect(cleanFileName('CON.png')).toBe('_CON.png');
    expect([...cleanFileName('x'.repeat(500))]).toHaveLength(120);
    expect(cleanFileName(42)).toBe('');
  });

  it("adds the file's extension when the name has none, never over a file", () => {
    const taken = new Set([path.join(DOWNLOADS, 'shot.webp')]);
    const exists = (filePath: string) => taken.has(filePath);
    expect(
      withFileExtension(path.join(DOWNLOADS, 'shot.png'), 'x.webp', exists)
    ).toBe(path.join(DOWNLOADS, 'shot.png'));
    expect(
      withFileExtension(path.join(DOWNLOADS, 'picture'), 'x.webp', exists)
    ).toBe(path.join(DOWNLOADS, 'picture.webp'));
    expect(
      withFileExtension(path.join(DOWNLOADS, 'shot'), 'x.WEBP', exists)
    ).toBe(path.join(DOWNLOADS, 'shot (1).webp'));
    expect(withFileExtension(path.join(DOWNLOADS, 'shot'), 'x', exists)).toBe(
      path.join(DOWNLOADS, 'shot')
    );
    expect(
      withFileExtension(path.join(DOWNLOADS, 'App v1.2 shot'), 'x.png', exists)
    ).toBe(path.join(DOWNLOADS, 'App v1.2 shot.png'));
  });

  it("never adds a program's extension the Save dialog didn't show", () => {
    for (const program of ['x.exe', 'x.sh', 'x.bat', 'x.desktop', 'x.html']) {
      expect(
        withFileExtension(path.join(DOWNLOADS, 'picture'), program, () => false)
      ).toBe(path.join(DOWNLOADS, 'picture'));
    }
  });

  it('gives a name with a dot but no type its file type', () => {
    const suggested = saveFileName({
      url: `${NODE}/arbitrary/IMAGE/Pub.Name/default`,
      appName: 'Opened-App',
      now: NOW,
    });
    expect(suggested).toBe('Pub.Name');
    expect(
      withFileExtension(
        path.join(DOWNLOADS, suggested),
        'Pub.Name.webp',
        () => false
      )
    ).toBe(path.join(DOWNLOADS, 'Pub.Name.webp'));
    expect(
      withFileExtension(
        path.join(DOWNLOADS, 'notes.docx'),
        'x.pdf',
        () => false
      )
    ).toBe(path.join(DOWNLOADS, 'notes.docx'));
  });

  it('keeps names within what a file system takes (255 bytes)', () => {
    const name = cleanFileName(`${'\u6f22'.repeat(110)}.pdf`);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(200);
    expect(name.startsWith('\u6f22')).toBe(true);
  });
});

describe('links, names and questions the menu hands on', () => {
  it('opens links into Q-Apps and websites, nothing else', () => {
    expect(openableLink(`${NODE}/render/APP/Opened-App/video/1`, NODE)).toBe(
      'qortal://APP/Opened-App/video/1'
    );
    expect(openableLink('qortal://WEBSITE/Publisher%20Site', NODE)).toBe(
      'qortal://WEBSITE/Publisher%20Site'
    );
    expect(openableLink('QORTAL://APP/Opened-App', NODE)).toBe(
      'QORTAL://APP/Opened-App'
    );
    for (const link of [
      'qortal://use-group/action-join/groupid-1',
      'qortal://use-embed/IMAGE?name=Publisher&identifier=pic-1',
      'qortal://use-app-page/APP/Opened-App',
      'qortal://',
      'qortal:///APP/x',
      `${NODE}/arbitrary/FILE/Publisher/doc-1`,
      'https://example.org/a',
      'javascript:alert(1)',
      `qortal://APP/${'x'.repeat(5000)}`,
    ]) {
      expect(openableLink(link, NODE)).toBeNull();
    }
  });

  it("opens an app's page and a group's link with Hub's own opener", () => {
    for (const link of [
      'qortal://use-app-page/APP/Opened-App',
      'qortal://use-group/action-join/groupid-7',
      'QORTAL://use-group/action-calendar/groupid-7/event-1',
    ]) {
      expect(hubLink(link, NODE)).toBe(link);
    }
    for (const link of [
      'qortal://use-embed/IMAGE?name=Publisher&identifier=pic-1',
      'qortal://APP/Opened-App',
      'qortal://use-app-page/',
      'https://example.org/a',
      `${NODE}/render/hash/abc`,
    ]) {
      expect(hubLink(link, NODE)).toBeNull();
    }
  });

  it('opens web links to other sites in the browser, nothing hiding where they go', () => {
    expect(browserLink('https://example.org/a?b=1#c', NODE)).toBe(
      'https://example.org/a?b=1#c'
    );
    expect(browserLink('http://example.org', NODE)).toBe('http://example.org/');
    for (const link of [
      `${NODE}/arbitrary/FILE/Publisher/doc-1`,
      'https://user:secret@example.org/',
      'https://trusted.example@example.org/',
      'javascript:alert(1)',
      'file:///etc/hosts',
      'qortal://APP/Opened-App',
      `https://example.org/${'x'.repeat(5000)}`,
    ]) {
      expect(browserLink(link, NODE)).toBeNull();
    }
  });

  it('copies a QDN picture as the link Q-Chat shows as the picture', () => {
    expect(
      pictureEmbedLink(`${NODE}/arbitrary/IMAGE/Publisher/pic-1`, NODE)
    ).toBe(
      'qortal://use-embed/IMAGE?name=Publisher&identifier=pic-1&service=IMAGE'
    );
    expect(
      pictureEmbedLink(
        `${NODE}/arbitrary/THUMBNAIL/Pub%20Name/qortal_avatar?async=true`,
        NODE
      )
    ).toBe(
      'qortal://use-embed/IMAGE?name=Pub%20Name&identifier=qortal_avatar&service=THUMBNAIL'
    );
    expect(pictureEmbedLink(`${NODE}/arbitrary/IMAGE/a%26b/x%3Dy`, NODE)).toBe(
      'qortal://use-embed/IMAGE?name=a%26b&identifier=x%3Dy&service=IMAGE'
    );
    for (const url of [
      `${NODE}/arbitrary/IMAGE/Publisher`,
      `${NODE}/arbitrary/IMAGE/Publisher/default`,
      `${NODE}/arbitrary/IMAGE/Publisher/`,
      `${NODE}/arbitrary/VIDEO/Publisher/vid-1`,
      `${NODE}/arbitrary/WEBSITE/Publisher/default/img/a.png`,
      `${NODE}/arbitrary/IMAGE/%E0%A4%A/pic-1`,
      `${NODE}/arbitrary/IMAGE/Pub‮Name/pic-1`,
      'http://127.0.0.1:9999/arbitrary/IMAGE/Publisher/pic-1',
      `blob:${NODE}/0f8a`,
      'data:image/png;base64,AAAA',
    ]) {
      expect(pictureEmbedLink(url, NODE)).toBeNull();
    }
  });

  it('looks up addresses and what can be a name, nothing that changes the lookup', () => {
    const address = 'QPubsherAddrxyz123456789ABCDEFGHJK';
    expect(address).toHaveLength(34);
    expect(lookUpText(` ${address} `)).toBe(address);
    expect(lookUpText('Opened-App')).toBe('Opened-App');
    expect(lookUpText('@Publisher,')).toBe('Publisher');
    expect(lookUpText('Publisher Name')).toBe('Publisher Name');
    for (const text of [
      'ab',
      'x'.repeat(41),
      '漢'.repeat(14),
      'a/b',
      '../admin/stop',
      'a\\b',
      'name?x',
      'name#x',
      'name;x',
      '50%25',
      'a‮b',
      'two\nlines',
      'too  spaced',
      '...',
      42,
    ]) {
      expect(lookUpText(text)).toBeNull();
    }
  });

  it('takes a name an app gives as it is, with the same rules', () => {
    expect(lookUpName('Publisher Name')).toBe('Publisher Name');
    // Nothing is left out: "Wow!" is another name than "Wow", as "@x" is.
    expect(lookUpName('Wow!')).toBe('Wow!');
    expect(lookUpName('@Publisher')).toBe('@Publisher');
    for (const value of [
      ' Publisher',
      'Publisher ',
      'ab',
      'x'.repeat(41),
      'a/b',
      'name?x',
      'name#x',
      'name;x',
      '50%',
      'a\u202eb',
      'a\u200bb',
      'two\nlines',
      'too  spaced',
      '...',
      42,
      null,
    ]) {
      expect(lookUpName(value)).toBeNull();
    }
  });

  it('knows a Qortal address by the check in its last bytes', () => {
    expect(ADDRESS).toMatch(/^Q[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(isQortalAddress(ADDRESS)).toBe(true);
    // One character changed: the check no longer holds.
    const changed = `${ADDRESS.slice(0, 9)}${ADDRESS[9] === 'a' ? 'b' : 'a'}${ADDRESS.slice(10)}`;
    expect(isQortalAddress(changed)).toBe(false);
    for (const value of [
      MADE_UP_ADDRESS,
      `${ADDRESS}x`,
      ADDRESS.slice(1),
      `q${ADDRESS.slice(1)}`,
      ` ${ADDRESS}`,
      42,
      null,
    ]) {
      expect(isQortalAddress(value)).toBe(false);
    }
  });

  it('takes no name with what Hub itself calls hidden, nor other spaces than a plain one', () => {
    for (const name of [
      'Publisher\u2800', // Braille blank, used for look-alike names
      'Publisher\u3164', // Hangul filler
      'Pub\u00adlisher', // soft hyphen
      'Pub\u2060lisher', // word joiner
      'Pub\u061clisher', // Arabic letter mark
      'Publisher\u2028Name', // line separator
      'Publisher\u2029Name', // paragraph separator
      'Publisher\u00a0Name', // no-break space: the menu would show a space
      'Publisher\tName',
    ]) {
      expect(lookUpName(name)).toBeNull();
      expect(lookUpText(name)).toBeNull();
    }
  });

  it("checks the name or address the app's preload found", () => {
    expect(readFoundName({ kind: 'name', value: 'Publisher' })).toBe(
      'Publisher'
    );
    expect(readFoundName({ kind: 'address', value: ADDRESS })).toBe(ADDRESS);
    for (const found of [
      { kind: 'address', value: 'Publisher' },
      { kind: 'address', value: MADE_UP_ADDRESS },
      { kind: 'name', value: '../admin/stop' },
      { kind: 'name', value: ' Publisher' },
      { kind: 'group', value: 'Publisher' },
      { value: 'Publisher' },
      'Publisher',
      null,
    ]) {
      expect(readFoundName(found)).toBeNull();
    }
  });

  it("reads the name a profile picture from the app's node is of", () => {
    expect(
      avatarName(`${NODE}/arbitrary/THUMBNAIL/Publisher/qortal_avatar`, NODE)
    ).toBe('Publisher');
    expect(avatarName(avatarOf('Publisher Name'), NODE)).toBe('Publisher Name');
    expect(
      avatarName(`${NODE}/arbitrary/THUMBNAIL/Wow!/qortal_avatar`, NODE)
    ).toBe('Wow!');
    for (const url of [
      // Another site's picture at the same path.
      'http://127.0.0.1:9999/arbitrary/THUMBNAIL/Publisher/qortal_avatar',
      // Other pictures of the name.
      `${NODE}/arbitrary/THUMBNAIL/Publisher/pic-1`,
      `${NODE}/arbitrary/IMAGE/Publisher/qortal_avatar`,
      `${NODE}/arbitrary/THUMBNAIL/Publisher/qortal_avatar/more`,
      `${NODE}/render/THUMBNAIL/Publisher/qortal_avatar`,
      // A name the lookup can't take, or no text at all.
      `${NODE}/arbitrary/THUMBNAIL/a%2Fb/qortal_avatar`,
      `${NODE}/arbitrary/THUMBNAIL/a%3Bb/qortal_avatar`,
      `${NODE}/arbitrary/THUMBNAIL/Publisher%C2%A0Name/qortal_avatar`,
      `${NODE}/arbitrary/THUMBNAIL/%E0%A4/qortal_avatar`,
      `${NODE}/arbitrary/THUMBNAIL/ab/qortal_avatar`,
      'not a link',
      42,
    ]) {
      expect(avatarName(url, NODE)).toBeNull();
    }
  });

  it('reads no further than a name could be, however much is selected', () => {
    // A page can select any amount (Electron hands main all of it); a long
    // run of punctuation once took seconds to clean up.
    const selected = `${'.'.repeat(100_000)}x`;
    const started = performance.now();
    expect(lookUpText(selected)).toBeNull();
    expect(qortinoText(selected)).toHaveLength(MAX_QORTINO_TEXT + 1);
    menuItemsFor(
      params({ selectionText: selected }),
      guestInfo,
      QORTINO_SET_UP
    );
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('asks Qortino about the text on one line, cut when long', () => {
    expect(qortinoText('  what is\n\tminting‮?  ')).toBe('what is minting ?');
    const long = qortinoText('w'.repeat(MAX_QORTINO_TEXT + 50));
    expect([...long]).toHaveLength(MAX_QORTINO_TEXT + 1);
    expect(long.endsWith('…')).toBe(true);
    expect(qortinoText(' \n ')).toBeNull();
    expect(qortinoText(undefined)).toBeNull();
  });

  it("opens the app's page for a Q-App or website Hub opened", () => {
    expect(appPageLink(guestInfo)).toBe('qortal://use-app-page/APP/Opened-App');
    expect(
      appPageLink({ ...guestInfo, service: 'WEBSITE', appName: 'Pub Site' })
    ).toBe('qortal://use-app-page/WEBSITE/Pub%20Site');
    expect(appPageLink({ ...guestInfo, devApp: true })).toBeNull();
    // Another resource of the name (a widget): the library has no page for it.
    expect(
      appPageLink({ ...guestInfo, identifier: 'go-widget-now' })
    ).toBeNull();
    expect(appPageLink({ ...guestInfo, identifier: 'default' })).toBe(
      'qortal://use-app-page/APP/Opened-App'
    );
    // Link readers trim a sentence's punctuation from a link's end.
    expect(appPageLink({ ...guestInfo, appName: 'Publisher Co.' })).toBe(
      'qortal://use-app-page/APP/Publisher%20Co%2E'
    );
    expect(appPageLink({ ...guestInfo, appName: 'Publisher!' })).toBe(
      'qortal://use-app-page/APP/Publisher%21'
    );
    expect(appPageLink({ ...guestInfo, appName: 'Publisher (beta)' })).toBe(
      'qortal://use-app-page/APP/Publisher%20%28beta%29'
    );
    expect(appPageLink({ ...guestInfo, appName: "Pub's (beta)!" })).toBe(
      'qortal://use-app-page/APP/Pub%27s%20%28beta%29%21'
    );
    expect(appPageLink({ ...guestInfo, service: 'VIDEO' })).toBeNull();
    expect(appPageLink({ ...guestInfo, appName: '‮‮' })).toBeNull();
  });
});

describe("a video the app's preload found", () => {
  const found = {
    src: `${NODE}/arbitrary/VIDEO/Publisher/vid-1`,
    stream: false,
    hasAudio: null,
    error: false,
    pictureInPicture: 'can',
  };

  it("takes the video the app's preload found as the one right-clicked", () => {
    expect(withFoundVideo(params(), found)).toMatchObject({
      mediaType: 'video',
      srcURL: found.src,
      mediaFlags: {
        canSave: true,
        hasAudio: true,
        inError: false,
        canShowPictureInPicture: true,
        isShowingPictureInPicture: false,
      },
    });
    expect(
      withFoundVideo(params(), { ...found, stream: true }).mediaFlags.canSave
    ).toBe(false);
    expect(
      withFoundVideo(params(), { ...found, src: '' }).mediaFlags.canSave
    ).toBe(false);
    expect(
      withFoundVideo(params(), { ...found, pictureInPicture: 'showing' })
        .mediaFlags.isShowingPictureInPicture
    ).toBe(true);
  });

  it('keeps the right-click as it was without a video, or with a strange one', () => {
    const plain = params();
    expect(withFoundVideo(plain, null)).toBe(plain);
    expect(withFoundVideo(plain, { ...found, src: 7 })).toBe(plain);
    expect(
      withFoundVideo(plain, {
        ...found,
        src: `data:,${'x'.repeat(1_000_001)}`,
      })
    ).toBe(plain);
  });
});

describe("a picture the app's preload found", () => {
  const found = {
    src: `${NODE}/arbitrary/IMAGE/Publisher/pic-1?async=true`,
    loaded: true,
  };

  it('takes it as the picture right-clicked, copied from its pixels', () => {
    expect(withFoundPicture(params(), found)).toMatchObject({
      mediaType: 'image',
      srcURL: found.src,
      hasImageContents: true,
      foundPicture: true,
    });
    expect(
      withFoundPicture(params(), { ...found, loaded: false })
    ).toMatchObject({ srcURL: found.src, hasImageContents: false });
    // Too long an address to take, but loaded: it can still be copied.
    expect(withFoundPicture(params(), { src: '', loaded: true })).toMatchObject(
      { mediaType: 'image', srcURL: '', hasImageContents: true }
    );
  });

  it('keeps the right-click as it was without a picture, or with a strange one', () => {
    const plain = params();
    expect(withFoundPicture(plain, null)).toBe(plain);
    expect(withFoundPicture(plain, { src: '', loaded: false })).toBe(plain);
    expect(withFoundPicture(plain, { ...found, src: 7 })).toBe(plain);
    expect(
      withFoundPicture(plain, {
        src: `data:image/png;base64,${'A'.repeat(1_000_001)}`,
        loaded: true,
      })
    ).toBe(plain);
  });

  it('takes it only where Chromium named nothing', () => {
    const answer = { video: null, picture: found, link: null };
    expect(withFound(params(), answer)).toMatchObject({
      mediaType: 'image',
      foundPicture: true,
    });
    for (const named of [
      params({ selectionText: 'a caption' }),
      params({ isEditable: true }),
      params({ mediaType: 'video', srcURL: `${NODE}/arbitrary/VIDEO/P/v` }),
    ]) {
      expect(withFound(named, answer)).toEqual(named);
    }
  });
});

describe("a name the app's preload found", () => {
  it('takes it checked, on a link Chromium named too', () => {
    const named = (value: unknown) =>
      withFound(params(), { name: value }).foundName;
    expect(named({ kind: 'name', value: 'Publisher' })).toBe('Publisher');
    expect(named({ kind: 'address', value: ADDRESS })).toBe(ADDRESS);
    expect(named({ kind: 'name', value: '../admin/stop' })).toBeUndefined();
    expect(named({ kind: 'address', value: MADE_UP_ADDRESS })).toBeUndefined();
    const link = `${NODE}/render/APP/Opened-App/profile/Publisher`;
    const onLink = withFound(params({ linkURL: link }), {
      link: 'qortal://APP/Other-App',
      name: { kind: 'name', value: 'Publisher' },
    });
    // Chromium's own link stays; the name comes with it.
    expect(onLink.linkURL).toBe(link);
    expect(onLink.foundName).toBe('Publisher');
  });
});

describe("copying an element's description", () => {
  it("names the page without what Hub adds to an app's address", () => {
    expect(
      shownPageLink(
        `${NODE}/render/APP/Opened-App/video/1?theme=dark&lang=en&identifier=`,
        NODE
      )
    ).toBe('qortal://APP/Opened-App/video/1');
    expect(
      shownPageLink(
        `${NODE}/render/APP/Opened-App/video/1?theme=dark&identifier=clip-1&t=3#top`,
        NODE
      )
    ).toBe('qortal://APP/Opened-App/video/1?identifier=clip-1&t=3#top');
    expect(shownPageLink('http://localhost:5173/?theme=dark', NODE)).toBe(
      'http://localhost:5173/'
    );
    expect(shownPageLink('not a link', NODE)).toBe('');
    // A private app's preview: no page, nor the secret that opens it.
    const preview = `${NODE}/render/hash/preview-hash?secret=preview-key&theme=dark`;
    expect(shownPageLink(preview, NODE)).toBe('');
    expect(
      shownPageLink(`http://localhost:5173/?secret=preview-key`, NODE)
    ).toBe('http://localhost:5173/');
  });

  const described: QAppElementInfo = {
    tag: 'button',
    name: 'Subscribe',
    role: 'button',
    selector: 'main > div.card:nth-of-type(2) > button',
    box: { x: 306, y: 1044, width: 158, height: 46 },
    viewport: { width: 1577, height: 821 },
    style: {
      color: 'rgb(255, 255, 255)',
      background: 'rgb(25, 118, 210)',
      font: '600 15px Roboto',
    },
    html: '<button class="card-button">SUBSCRIBE</button>',
    cut: false,
    title: 'Opened-App',
  };

  it('writes what an AI needs to know which element is meant', () => {
    expect(
      elementText(described, {
        appName: 'Opened-App',
        service: 'APP',
        page: 'qortal://APP/Opened-App/video/1',
      }).split('\n')
    ).toEqual([
      'app: Opened-App (APP)',
      'page: qortal://APP/Opened-App/video/1',
      'title: Opened-App',
      'window: 1577×821',
      'element: button "Subscribe" (role button)',
      'selector: main > div.card:nth-of-type(2) > button',
      'box: 158×46 at 306,1044',
      'style: color rgb(255, 255, 255); background rgb(25, 118, 210); font 600 15px Roboto',
      'html:',
      '<button class="card-button">SUBSCRIBE</button>',
    ]);
  });

  it("checks what the app's preload says before using it", () => {
    expect(readElementInfo(null)).toBeNull();
    expect(readElementInfo({ tag: 7 })).toBeNull();
    const read = readElementInfo({
      ...described,
      name: `Sub‮scribe\n${'x'.repeat(500)}`,
      box: { x: Number.NaN, y: '3', width: 10.4, height: Infinity },
      html: `<b>\u0000x‮</b>\n${'y'.repeat(5000)}`,
      cut: 'no',
    });
    expect(read.name.startsWith('Sub scribe x')).toBe(true);
    expect(read.name.length).toBeLessThanOrEqual(101);
    expect(read.box).toEqual({ x: 0, y: 0, width: 10, height: 0 });
    expect(read.html.startsWith('<b>x</b>\n')).toBe(true);
    expect(read.html.length).toBeLessThanOrEqual(3_100);
    expect(read.cut).toBe(true);
  });

  it("takes the part of a box on screen, in the webview's own pixels", () => {
    const viewport = { width: 800, height: 600 };
    expect(
      screenRect(
        { box: { x: -10, y: 20, width: 100, height: 50 }, viewport },
        1.5
      )
    ).toEqual({ x: 0, y: 30, width: 135, height: 75 });
    expect(
      screenRect(
        { box: { x: 700, y: 550, width: 300, height: 300 }, viewport },
        1
      )
    ).toEqual({ x: 700, y: 550, width: 100, height: 50 });
    expect(
      screenRect({ box: { x: 900, y: 10, width: 50, height: 50 }, viewport }, 1)
    ).toBeNull();
    expect(
      screenRect({ box: { x: 0, y: 0, width: 0, height: 50 }, viewport }, 1)
    ).toBeNull();
    expect(screenRect({ box: { x: 'a' }, viewport }, 1)).toBeNull();
    expect(screenRect(null, 1)).toBeNull();
  });
});

describe('menuItemsFor', () => {
  it('offers save and copy for a picture from the node', () => {
    expect(
      actions(
        menuItemsFor(
          params({
            mediaType: 'image',
            srcURL: `${NODE}/arbitrary/IMAGE/Publisher/pic-1`,
            hasImageContents: true,
          }),
          guestInfo
        )
      )
    ).toEqual(['savePicture', 'copyPicture', 'copyPictureLink']);
  });

  it('offers only copy for a picture from elsewhere', () => {
    expect(
      actions(
        menuItemsFor(
          params({
            mediaType: 'image',
            srcURL: 'http://127.0.0.1:9999/pic.png',
            hasImageContents: true,
          }),
          guestInfo
        )
      )
    ).toEqual(['copyPicture']);
  });

  it('shows a streamed video as not savable, with the reason', () => {
    expect(
      menuItemsFor(
        params({
          mediaType: 'video',
          srcURL: `blob:${NODE}/0f8a`,
          mediaFlags: { canSave: false, hasAudio: true },
        }),
        guestInfo
      )
    ).toEqual([
      { action: 'saveVideo', disabled: true, reason: 'streamed' },
      { action: 'copyVideoFrame' },
      { action: 'saveVideoFrame' },
    ]);
  });

  it('offers to save a video and a sound from the node', () => {
    const saved = { canSave: true, hasAudio: true };
    expect(
      actions(
        menuItemsFor(
          params({
            mediaType: 'video',
            srcURL: `${NODE}/arbitrary/VIDEO/Publisher/vid-1`,
            mediaFlags: saved,
          }),
          guestInfo
        )
      )
    ).toEqual(['saveVideo', 'copyVideoFrame', 'saveVideoFrame']);
    expect(
      actions(
        menuItemsFor(
          params({
            mediaType: 'audio',
            srcURL: `${NODE}/arbitrary/AUDIO/Publisher/song-1`,
            mediaFlags: saved,
          }),
          guestInfo
        )
      )
    ).toEqual(['saveSound']);
  });

  it('offers the link items a link allows', () => {
    expect(
      actions(
        menuItemsFor(
          params({ linkURL: `${NODE}/arbitrary/FILE/Publisher/doc-1` }),
          guestInfo
        )
      )
    ).toEqual(['saveLinkedFile', 'copyLink']);
    expect(
      actions(
        menuItemsFor(params({ linkURL: 'https://example.org/a' }), guestInfo)
      )
    ).toEqual(['openWebLink', 'copyLink']);
    // Nothing for the link itself: only what a spot with nothing else gets.
    expect(
      actions(
        menuItemsFor(params({ linkURL: 'javascript:alert(1)' }), guestInfo)
      )
    ).toEqual(['aboutApp']);
  });

  it('offers to open each kind of link the way Hub opens it', () => {
    const linkItems = (linkURL: string) =>
      actions(menuItemsFor(params({ linkURL }), guestInfo));
    expect(linkItems('qortal://APP/Opened-App')).toEqual([
      'openLink',
      'copyLink',
    ]);
    expect(linkItems('qortal://use-app-page/APP/Opened-App')).toEqual([
      'openQortalLink',
      'copyLink',
    ]);
    expect(linkItems('qortal://use-group/action-join/groupid-7')).toEqual([
      'openQortalLink',
      'copyLink',
    ]);
    // An embed opens nowhere of its own: it is copied, to paste in Q-Chat.
    expect(
      linkItems('qortal://use-embed/IMAGE?name=Publisher&identifier=pic-1')
    ).toEqual(['copyLink']);
  });

  it("takes a link the app's preload found when Chromium named none", () => {
    expect(
      withFound(params({ selectionText: 'see this' }), {
        video: null,
        link: 'qortal://APP/Opened-App/post/1',
      }).linkURL
    ).toBe('qortal://APP/Opened-App/post/1');
    // Chromium's own link stays.
    expect(
      withFound(params({ linkURL: 'https://example.org/a' }), {
        video: null,
        link: 'qortal://APP/Opened-App',
      }).linkURL
    ).toBe('https://example.org/a');
    for (const link of [
      7,
      `qortal://APP/${'x'.repeat(5000)}`,
      'qortal://a\u202eb',
    ]) {
      expect(withFound(params(), { video: null, link }).linkURL).toBe('');
    }
    // A video only where Chromium named nothing at all.
    const video = {
      src: `${NODE}/arbitrary/VIDEO/Publisher/vid-1`,
      stream: false,
      hasAudio: null,
      error: false,
      pictureInPicture: 'can',
    };
    expect(withFound(params(), { video, link: null }).mediaType).toBe('video');
    expect(
      withFound(params({ selectionText: 'x' }), { video, link: null }).mediaType
    ).toBe('none');
  });

  it('puts spelling suggestions first in a text box, then editing', () => {
    const items = menuItemsFor(
      params({
        isEditable: true,
        misspelledWord: 'Testingg',
        dictionarySuggestions: [
          'Testing',
          'Tasting',
          'Jesting',
          'Nesting',
          'Resting',
          'Vesting',
        ],
        editFlags: {
          canUndo: true,
          canRedo: false,
          canCut: false,
          canCopy: false,
          canPaste: true,
          canSelectAll: true,
        },
      }),
      guestInfo
    );
    expect(actions(items)).toEqual([
      ...Array(MAX_SUGGESTIONS).fill('replaceMisspelling'),
      'addToDictionary',
      '|',
      'undo',
      'redo',
      '|',
      'cut',
      'copy',
      'paste',
      '|',
      'selectAll',
    ]);
    expect(items[0]).toEqual({
      action: 'replaceMisspelling',
      index: 0,
      label: 'Testing',
    });
    expect(
      items.find((item) => 'action' in item && item.action === 'redo')
    ).toMatchObject({ disabled: true });
    expect(
      items.find((item) => 'action' in item && item.action === 'paste')
    ).toMatchObject({ disabled: false });
  });

  it('offers to open a link into an app, before the picture it holds', () => {
    expect(
      actions(
        menuItemsFor(
          params({
            linkURL: `${NODE}/render/APP/Opened-App/video/1`,
            mediaType: 'image',
            srcURL: `${NODE}/arbitrary/THUMBNAIL/Publisher/thumb-1`,
            hasImageContents: true,
          }),
          guestInfo
        )
      )
    ).toEqual([
      'openLink',
      'copyLink',
      '|',
      'savePicture',
      'copyPicture',
      'copyPictureLink',
    ]);
  });

  it("offers a video's frame and picture in picture as the video allows", () => {
    const video = (mediaFlags: QAppMenuParams['mediaFlags']) =>
      actions(
        menuItemsFor(
          params({
            mediaType: 'video',
            srcURL: `blob:${NODE}/0f8a`,
            mediaFlags,
          }),
          guestInfo
        )
      );
    const flags = { canSave: false, hasAudio: true };
    expect(video({ ...flags, canShowPictureInPicture: true })).toEqual([
      'saveVideo',
      'copyVideoFrame',
      'saveVideoFrame',
      'pictureInPicture',
    ]);
    expect(
      video({
        ...flags,
        canShowPictureInPicture: true,
        isShowingPictureInPicture: true,
      })
    ).toEqual([
      'saveVideo',
      'copyVideoFrame',
      'saveVideoFrame',
      'exitPictureInPicture',
    ]);
    expect(video({ ...flags, inError: true })).toEqual(['saveVideo']);
  });

  it('shows "Ask Qortino" only once Qortino is set up', () => {
    const selected = (selectionText: string, settings?: typeof DEV_MODE) =>
      actions(menuItemsFor(params({ selectionText }), guestInfo, settings));
    expect(selected('what is minting')).toEqual(['copy', '|', 'lookUp']);
    expect(selected('what is minting', QORTINO_SET_UP)).toEqual([
      'copy',
      '|',
      'lookUp',
      'askQortino',
    ]);
    const paragraph = 'Minting is how blocks are made. '.repeat(3);
    expect(selected(paragraph, QORTINO_SET_UP)).toEqual([
      'copy',
      '|',
      'askQortino',
    ]);
    expect(selected(paragraph)).toEqual(['copy']);
  });

  it('offers "Look up" for a profile picture, the text selected or a name the app shows', () => {
    const avatar = {
      mediaType: 'image',
      srcURL: avatarOf('Publisher Name'),
      hasImageContents: true,
    };
    expect(actions(menuItemsFor(params(avatar), guestInfo))).toEqual([
      'savePicture',
      'copyPicture',
      'copyPictureLink',
      '|',
      'lookUp',
    ]);
    expect(menuItemsFor(params(avatar), guestInfo)).toContainEqual({
      action: 'lookUp',
      label: 'Publisher Name',
    });
    // A picture from another site isn't taken for the name's.
    const elsewhere = params({
      ...avatar,
      srcURL:
        'http://127.0.0.1:9999/arbitrary/THUMBNAIL/Publisher/qortal_avatar',
    });
    expect(actions(menuItemsFor(elsewhere, guestInfo))).not.toContain('lookUp');
    // A name the app shows there, found by its preload.
    expect(menuItemsFor(params({ foundName: 'Publisher' }), guestInfo)).toEqual(
      [{ action: 'lookUp', label: 'Publisher' }]
    );
    // Not in a box typed into.
    const typed = params({ foundName: 'Publisher', isEditable: true });
    expect(actions(menuItemsFor(typed, guestInfo))).not.toContain('lookUp');
    // The picture right-clicked comes first, then the text selected.
    const lookUp = (overrides: Partial<QAppMenuParams>) =>
      menuItemsFor(params(overrides), guestInfo).filter(
        (item) => 'action' in item && item.action === 'lookUp'
      );
    expect(lookUp({ ...avatar, selectionText: 'Other Name' })).toEqual([
      { action: 'lookUp', label: 'Publisher Name' },
    ]);
    expect(
      lookUp({ selectionText: 'Other Name', foundName: 'Publisher' })
    ).toEqual([{ action: 'lookUp', label: 'Other Name' }]);
  });

  it('takes the name found there over the word a right-click selected in it (macOS)', () => {
    const lookUp = (overrides: Partial<QAppMenuParams>) =>
      menuItemsFor(params(overrides), guestInfo).filter(
        (item) => 'action' in item && item.action === 'lookUp'
      );
    // On macOS a right-click selects the word under it, or a link's whole
    // text, before the menu opens.
    expect(
      lookUp({ selectionText: 'Publisher', foundName: 'Publisher Name' })
    ).toEqual([{ action: 'lookUp', label: 'Publisher Name' }]);
    expect(
      lookUp({
        linkURL: `${NODE}/render/APP/Opened-App/vote/2`,
        selectionText: 'Publisher Name (answered)',
        foundName: 'Publisher Name',
      })
    ).toEqual([{ action: 'lookUp', label: 'Publisher Name' }]);
    // Text selected apart from the name found is the user's own choice.
    expect(
      lookUp({ selectionText: 'Other Name', foundName: 'Publisher Name' })
    ).toEqual([{ action: 'lookUp', label: 'Other Name' }]);
  });

  it('names what it looks up, and the app whose page it opens', () => {
    expect(
      menuItemsFor(params({ selectionText: ' @Publisher, ' }), guestInfo)
    ).toContainEqual({ action: 'lookUp', label: 'Publisher' });
    expect(
      menuItemsFor(params(), {
        ...guestInfo,
        appName: 'Pub Site',
        service: 'WEBSITE',
      })
    ).toEqual([{ action: 'aboutApp', label: 'Pub Site' }]);
  });

  it('leaves the look-up and Qortino out for a misspelled word and a password', () => {
    const editable = {
      isEditable: true,
      selectionText: 'Testingg',
      editFlags: { ...params().editFlags, canCopy: true },
    };
    expect(
      actions(
        menuItemsFor(
          params({
            ...editable,
            misspelledWord: 'Testingg',
            dictionarySuggestions: ['Testing'],
          }),
          guestInfo,
          QORTINO_SET_UP
        )
      )
    ).not.toContain('lookUp');
    const password = actions(
      menuItemsFor(
        // Electron 44 names a password field so (and shows its text as dots).
        params({ ...editable, formControlType: 'input-password' }),
        guestInfo,
        QORTINO_SET_UP
      )
    );
    expect(password).not.toContain('lookUp');
    expect(password).not.toContain('askQortino');
  });

  it("shows the app's page only where nothing else is, and for Q-Apps and websites only", () => {
    expect(
      actions(menuItemsFor(params({ selectionText: 'some text' }), guestInfo))
    ).not.toContain('aboutApp');
    expect(
      actions(menuItemsFor(params(), { ...guestInfo, service: 'WEBSITE' }))
    ).toEqual(['aboutApp']);
    expect(menuItemsFor(params(), { ...guestInfo, service: 'VIDEO' })).toEqual(
      []
    );
  });

  it("adds the developers' items in dev mode only, last", () => {
    const devItems = ['copyElement', 'copyElementPicture', 'inspectElement'];
    expect(actions(menuItemsFor(params(), guestInfo, DEV_MODE))).toEqual([
      'aboutApp',
      '|',
      ...devItems,
    ]);
    expect(
      actions(
        menuItemsFor(
          params({ selectionText: 'some text' }),
          { ...guestInfo, devApp: true },
          DEV_MODE
        )
      )
    ).toEqual(['copy', '|', 'lookUp', '|', ...devItems]);
    expect(actions(menuItemsFor(params(), guestInfo))).not.toContain(
      'inspectElement'
    );
  });

  it("offers copy and look-up for selected text, and the app's page on an empty spot", () => {
    expect(
      actions(menuItemsFor(params({ selectionText: 'some text' }), guestInfo))
    ).toEqual(['copy', '|', 'lookUp']);
    expect(menuItemsFor(params(), guestInfo)).toEqual([
      { action: 'aboutApp', label: 'Opened-App' },
    ]);
    expect(menuItemsFor(params(), { ...guestInfo, devApp: true })).toEqual([]);
  });
});

describe('QAppContextMenus', () => {
  let guest: FakeGuest;
  let hub: FakeHub;
  let deps: QAppMenuDeps;
  let menus: QAppContextMenus;
  let info: QAppMenuGuest | null;
  let dialogAnswer: { canceled: boolean; filePath?: string };
  let clipboard: string[];
  let shown: string[];
  let existing: Set<string>;
  let written: [string, string][];

  const setup = () => {
    guest = new FakeGuest();
    hub = new FakeHub();
    info = { ...guestInfo };
    dialogAnswer = {
      canceled: false,
      filePath: path.join(DOWNLOADS, 'picture'),
    };
    clipboard = [];
    shown = [];
    existing = new Set();
    written = [];
    deps = {
      guestInfo: () => info,
      hubPage: () => hub as never,
      showSaveDialog: vi.fn(async () => dialogAnswer),
      downloadsDir: () => DOWNLOADS,
      writeClipboardText: (text) => {
        clipboard.push(text);
      },
      writeClipboardImage: (image) => {
        clipboard.push(`image:${(image as unknown as { from: string }).from}`);
      },
      imageFromDataUrl: (dataUrl) =>
        fakeImage(`data:${dataUrl.length}`, dataUrl.endsWith(',')) as never,
      writeFile: async (filePath, data) => {
        written.push([filePath, data.toString()]);
      },
      openInBrowser: () => undefined,
      showItemInFolder: (filePath) => {
        shown.push(filePath);
      },
      fileExists: (filePath) => existing.has(filePath),
      now: () => NOW,
      saveStartTimeoutMs: 1000,
    };
    menus = new QAppContextMenus(deps);
    menus.attach(guest as never);
  };

  /**
   * A right-click in the app, and the menu main asked for. On a spot with
   * nothing Chromium names, main asks the app's preload first (async).
   */
  const rightClick = async (overrides: Partial<QAppMenuParams>) => {
    const before = hub.sent.length;
    guest.emit('context-menu', {}, params(overrides));
    await settle();
    const opened = hub.sent
      .slice(before)
      .filter(([channel]) => channel === QAPP_MENU_CHANNELS.open);
    return opened[opened.length - 1]?.[1] as QAppMenuOpen | undefined;
  };

  const saveUpdates = () =>
    hub.sent
      .filter(([channel]) => channel === QAPP_MENU_CHANNELS.save)
      .map(([, update]) => update as QAppSaveUpdate);
  const lastSave = () => {
    const updates = saveUpdates();
    return updates[updates.length - 1];
  };

  const picture = {
    mediaType: 'image',
    srcURL: `${NODE}/arbitrary/IMAGE/Publisher/pic-1`,
    hasImageContents: true,
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks the Hub page to show the menu at the pointer, in its zoom', async () => {
    setup();
    hub.zoom = 1.25;
    const open = await rightClick(picture);
    expect(open).toMatchObject({ tabId: 'tab-1', x: 104, y: 72 });
    expect(actions(open.items)).toEqual([
      'savePicture',
      'copyPicture',
      'copyPictureLink',
    ]);
    expect(hub.focused).toBe(1);
  });

  it('listens once per webview', async () => {
    setup();
    menus.attach(guest as never);
    await rightClick(picture);
    expect(hub.sent).toHaveLength(1);
  });

  it("shows nothing for a webview Hub didn't register, on an empty spot of a dev app, or while locked", async () => {
    setup();
    info = null;
    expect(await rightClick(picture)).toBeUndefined();
    info = { ...guestInfo, devApp: true };
    expect(await rightClick({})).toBeUndefined();
    info = { ...guestInfo };
    menus.setHubLocked(true);
    expect(await rightClick(picture)).toBeUndefined();
    expect(hub.sent).toEqual([]);
  });

  it('runs an editing command in the app once, without moving the keyboard', async () => {
    setup();
    const open = await rightClick({
      isEditable: true,
      editFlags: { ...params().editFlags, canPaste: true },
    });
    expect(await menus.act(open.menuId, 'paste')).toBe(true);
    expect(guest.calls).toEqual(['paste']);
    // The Hub page gives the app the keyboard while it's on screen; a
    // hidden tab must never take it.
    expect(guest.focused).toBe(0);
    expect(await menus.act(open.menuId, 'paste')).toBe(false);
    expect(guest.calls).toEqual(['paste']);
  });

  it('forgets a menu closed with nothing chosen, without moving the keyboard', async () => {
    setup();
    const open = await rightClick({ isEditable: true });
    expect(menus.dismiss(open.menuId)).toBe(true);
    expect(menus.dismiss(open.menuId)).toBe(false);
    expect(await menus.act(open.menuId, 'selectAll')).toBe(false);
    expect(guest.focused).toBe(0);
  });

  it("refuses a choice once the app's page is on another node", async () => {
    setup();
    const open = await rightClick({ isEditable: true });
    info = { ...guestInfo, nodeOrigin: 'http://127.0.0.1:9999' };
    expect(await menus.act(open.menuId, 'selectAll')).toBe(false);
  });

  it('passes a right-click on to a registered app, at its zoom', () => {
    setup();
    deps.guestById = (id) => (id === 7 ? (guest as never) : null);
    guest.zoom = 1.25;
    expect(menus.rightClickAt(7, 40, 80)).toBe(true);
    expect(guest.inputs.map((input) => [input.type, input.x, input.y])).toEqual(
      [
        ['mouseMove', 50, 100],
        ['mouseDown', 50, 100],
        ['mouseUp', 50, 100],
      ]
    );
    expect(guest.inputs[1].button).toBe('right');
    guest.inputs = [];
    expect(menus.rightClickAt(8, 40, 80)).toBe(false);
    expect(menus.rightClickAt(7, -1, 80)).toBe(false);
    expect(menus.rightClickAt(7, Number.NaN, 80)).toBe(false);
    expect(menus.rightClickAt('7', 40, 80)).toBe(false);
    info = null;
    expect(menus.rightClickAt(7, 40, 80)).toBe(false);
    info = { ...guestInfo };
    menus.setHubLocked(true);
    expect(menus.rightClickAt(7, 40, 80)).toBe(false);
    expect(guest.inputs).toEqual([]);
  });

  it("refuses items the menu didn't offer, or offered greyed out", async () => {
    setup();
    let open = await rightClick({ isEditable: true });
    expect(await menus.act(open.menuId, 'paste')).toBe(false);
    open = await rightClick({ isEditable: true });
    expect(await menus.act(open.menuId, 'savePicture')).toBe(false);
    open = await rightClick({ isEditable: true });
    expect(await menus.act('another-menu', 'selectAll')).toBe(false);
    expect(await menus.act(open.menuId, 'selectAll')).toBe(true);
    expect(guest.calls).toEqual(['selectAll']);
  });

  it('forgets a menu when its app leaves the page, its tab changes or time passes', async () => {
    setup();
    let open = await rightClick({ isEditable: true });
    guest.emit('did-navigate');
    expect(await menus.act(open.menuId, 'selectAll')).toBe(false);

    open = await rightClick({ isEditable: true });
    info = { ...guestInfo, tabId: 'tab-2' };
    expect(await menus.act(open.menuId, 'selectAll')).toBe(false);

    info = { ...guestInfo };
    open = await rightClick({ isEditable: true });
    info = null;
    expect(await menus.act(open.menuId, 'selectAll')).toBe(false);

    info = { ...guestInfo };
    open = await rightClick({ isEditable: true });
    guest.destroyed = true;
    expect(await menus.act(open.menuId, 'selectAll')).toBe(false);

    guest.destroyed = false;
    vi.useFakeTimers({ now: Date.now() });
    open = await rightClick({ isEditable: true });
    vi.advanceTimersByTime(MENU_TTL_MS + 1);
    expect(await menus.act(open.menuId, 'selectAll')).toBe(false);
    expect(guest.calls).toEqual([]);
  });

  it('keeps one open menu per app and drops it when Hub locks', async () => {
    setup();
    const first = await rightClick({ isEditable: true });
    const second = await rightClick({ isEditable: true });
    expect(await menus.act(first.menuId, 'selectAll')).toBe(false);
    menus.setHubLocked(true);
    expect(await menus.act(second.menuId, 'selectAll')).toBe(false);
    menus.setHubLocked(false);
    const third = await rightClick({ isEditable: true });
    expect(await menus.act(third.menuId, 'selectAll')).toBe(true);
  });

  it("replaces a misspelling with main's own copy of the suggestion", async () => {
    setup();
    const open = await rightClick({
      isEditable: true,
      misspelledWord: 'Testingg',
      dictionarySuggestions: ['Testing', 'Tasting'],
    });
    expect(await menus.act(open.menuId, 'replaceMisspelling', 7)).toBe(false);
    const again = await rightClick({
      isEditable: true,
      misspelledWord: 'Testingg',
      dictionarySuggestions: ['Testing', 'Tasting'],
    });
    expect(await menus.act(again.menuId, 'replaceMisspelling', 1)).toBe(true);
    expect(guest.replaced).toEqual(['Tasting']);
  });

  it("adds a word to the app's dictionary", async () => {
    setup();
    const open = await rightClick({
      isEditable: true,
      misspelledWord: 'Qortal',
      dictionarySuggestions: ['Portal'],
    });
    expect(await menus.act(open.menuId, 'addToDictionary')).toBe(true);
    expect(guest.session.words).toEqual(['Qortal']);
  });

  it('copies the picture under the pointer, and links as qortal:// links', async () => {
    setup();
    let open = await rightClick({ ...picture, x: 220, y: 140 });
    expect(await menus.act(open.menuId, 'copyPicture')).toBe(true);
    expect(guest.copiedAt).toEqual([[220, 140]]);
    open = await rightClick({
      linkURL: `${NODE}/render/APP/Opened-App/item/7`,
    });
    expect(await menus.act(open.menuId, 'copyLink')).toBe(true);
    expect(clipboard).toEqual(['qortal://APP/Opened-App/item/7']);
  });

  it('saves through the app, to the place the dialog gave, with progress', async () => {
    setup();
    const open = await rightClick(picture);
    expect(await menus.act(open.menuId, 'savePicture')).toBe(true);
    expect(deps.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: path.join(DOWNLOADS, 'pic-1'),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    // Each save's download carries its own tag, in the part of the link a
    // server never sees.
    const [tagged] = guest.downloads;
    expect(tagged.startsWith(`${picture.srcURL}#qortal-hub-save-`)).toBe(true);

    // Downloads without this save's tag (the page's own) are left alone.
    for (const url of [picture.srcURL, `${NODE}/arbitrary/FILE/Publisher/x`]) {
      const pageOwn = new FakeItem(url, 'x.zip');
      const event = downloadEvent();
      guest.session.emit('will-download', event, pageOwn, guest);
      expect(pageOwn.savePath).toBe('');
      expect(event.preventDefault).not.toHaveBeenCalled();
    }

    const item = new FakeItem(tagged, 'pic-1.webp');
    guest.session.emit('will-download', downloadEvent(), item, guest);
    expect(item.savePath).toBe(path.join(DOWNLOADS, 'picture.webp'));
    item.received = 500;
    item.emit('updated');
    item.emit('updated');
    item.emit('done', {}, 'completed');
    const updates = saveUpdates();
    expect(updates.map((update) => [update.state, update.percent])).toEqual([
      ['saving', undefined],
      ['saving', undefined],
      ['saving', 50],
      ['done', 100],
    ]);
    expect(updates.map((update) => update.first === true)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(updates[updates.length - 1].name).toBe('picture.webp');
    expect(menus.showSaved(updates[0].saveId)).toBe(true);
    expect(shown).toEqual([path.join(DOWNLOADS, 'picture.webp')]);
  });

  it('starts nothing when the dialog is cancelled, Hub locked or the app went away meanwhile', async () => {
    setup();
    dialogAnswer = { canceled: true };
    let open = await rightClick(picture);
    expect(await menus.act(open.menuId, 'savePicture')).toBe(false);

    let answer: (value: { canceled: boolean; filePath?: string }) => void;
    deps.showSaveDialog = vi.fn(
      () =>
        new Promise<{ canceled: boolean; filePath?: string }>((resolve) => {
          answer = resolve;
        })
    );
    open = await rightClick(picture);
    const locking = menus.act(open.menuId, 'savePicture');
    menus.setHubLocked(true);
    answer({ canceled: false, filePath: path.join(DOWNLOADS, 'a.png') });
    expect(await locking).toBe(false);

    menus.setHubLocked(false);
    open = await rightClick(picture);
    const leaving = menus.act(open.menuId, 'savePicture');
    guest.destroyed = true;
    answer({ canceled: false, filePath: path.join(DOWNLOADS, 'b.png') });
    expect(await leaving).toBe(false);
    expect(guest.downloads).toEqual([]);
    expect(saveUpdates()).toEqual([]);
  });

  it('cancels a save that is downloading', async () => {
    setup();
    const open = await rightClick(picture);
    await menus.act(open.menuId, 'savePicture');
    const item = new FakeItem(guest.downloads[0], 'pic-1.png');
    guest.session.emit('will-download', downloadEvent(), item, guest);
    const saveId = saveUpdates()[0].saveId;
    expect(menus.cancelSave(saveId)).toBe(true);
    expect(item.cancelled).toBe(true);
    expect(lastSave().state).toBe('cancelled');
    expect(menus.showSaved(saveId)).toBe(false);
  });

  it('stops a download that comes after its save was cancelled', async () => {
    setup();
    const open = await rightClick(picture);
    await menus.act(open.menuId, 'savePicture');
    expect(menus.cancelSave(saveUpdates()[0].saveId)).toBe(true);
    expect(lastSave().state).toBe('cancelled');
    // The node answers after Cancel: Electron must not open a dialog of its
    // own for it.
    const late = new FakeItem(guest.downloads[0], 'pic-1.png');
    const event = downloadEvent();
    guest.session.emit('will-download', event, late, guest);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(late.savePath).toBe('');
  });

  it('fails a save whose download never starts, and stops it if it comes late', async () => {
    setup();
    vi.useFakeTimers({ now: Date.now() });
    const open = await rightClick(picture);
    await menus.act(open.menuId, 'savePicture');
    vi.advanceTimersByTime(1001);
    expect(lastSave().state).toBe('failed');
    const late = new FakeItem(guest.downloads[0], 'pic-1.png');
    const event = downloadEvent();
    guest.session.emit('will-download', event, late, guest);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('still saves where the dialog said when the tab closed before the download came', async () => {
    setup();
    const open = await rightClick(picture);
    await menus.act(open.menuId, 'savePicture');
    guest.destroyed = true;
    guest.emit('destroyed');
    // Electron gives no webContents for a download whose page is gone.
    const item = new FakeItem(guest.downloads[0], 'pic-1.png');
    guest.session.emit('will-download', downloadEvent(), item, null);
    expect(item.savePath).toBe(path.join(DOWNLOADS, 'picture.png'));
  });

  it('sends two saves of the same file each where their own dialog said', async () => {
    setup();
    const answers = [
      path.join(DOWNLOADS, 'first'),
      path.join(DOWNLOADS, 'second'),
    ];
    deps.showSaveDialog = vi.fn(async () => ({
      canceled: false,
      filePath: answers.shift(),
    }));
    let open = await rightClick(picture);
    await menus.act(open.menuId, 'savePicture');
    open = await rightClick(picture);
    await menus.act(open.menuId, 'savePicture');
    const [firstUrl, secondUrl] = guest.downloads;
    expect(firstUrl).not.toBe(secondUrl);
    const second = new FakeItem(secondUrl, 'pic-1.png');
    guest.session.emit('will-download', downloadEvent(), second, guest);
    const first = new FakeItem(firstUrl, 'pic-1.png');
    guest.session.emit('will-download', downloadEvent(), first, guest);
    expect(first.savePath).toBe(path.join(DOWNLOADS, 'first.png'));
    expect(second.savePath).toBe(path.join(DOWNLOADS, 'second.png'));
    // A second download for a save that has one already is stopped.
    const again = new FakeItem(firstUrl, 'pic-1.png');
    const event = downloadEvent();
    guest.session.emit('will-download', event, again, guest);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(again.savePath).toBe('');
  });

  it("doesn't add a program's extension to a picture's name", async () => {
    setup();
    const src = `blob:${NODE}/6f1c2d`;
    const open = await rightClick({ mediaType: 'image', srcURL: src });
    await menus.act(open.menuId, 'savePicture');
    const item = new FakeItem(guest.downloads[0], '6f1c2d.exe');
    guest.session.emit('will-download', downloadEvent(), item, guest);
    expect(item.savePath).toBe(path.join(DOWNLOADS, 'picture'));
  });

  it('saves a linked file under its own download name', async () => {
    setup();
    const open = await rightClick({
      linkURL: `blob:${NODE}/0f8a`,
      suggestedFilename: 'report.pdf',
    });
    await menus.act(open.menuId, 'saveLinkedFile');
    expect(deps.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: path.join(DOWNLOADS, 'report.pdf'),
      })
    );
    expect(guest.downloads).toHaveLength(1);
    expect(
      guest.downloads[0].startsWith(`blob:${NODE}/0f8a#qortal-hub-save-`)
    ).toBe(true);
  });
  it('hands the Hub page a link into an app, and copies a QDN picture as a link', async () => {
    setup();
    let open = await rightClick({
      linkURL: `${NODE}/render/APP/Opened-App/video/1`,
    });
    expect(await menus.act(open.menuId, 'openLink')).toEqual({
      open: 'qortal://APP/Opened-App/video/1',
    });
    open = await rightClick(picture);
    expect(await menus.act(open.menuId, 'copyPictureLink')).toBe(true);
    expect(clipboard).toEqual([
      'qortal://use-embed/IMAGE?name=Publisher&identifier=pic-1&service=IMAGE',
    ]);
  });

  it('hands back the name of a profile picture, or of one the app shows on a link', async () => {
    setup();
    let open = await rightClick({
      mediaType: 'image',
      srcURL: avatarOf('Publisher'),
      hasImageContents: true,
    });
    expect(await menus.act(open.menuId, 'lookUp')).toEqual({
      lookUp: 'Publisher',
    });
    guest.answer = (code) =>
      code.endsWith('at(false)')
        ? {
            video: null,
            picture: null,
            link: null,
            name: { kind: 'name', value: 'Publisher Name' },
          }
        : null;
    open = await rightClick({
      linkURL: `${NODE}/render/APP/Opened-App/profile/1`,
    });
    expect(open.items).toContainEqual({
      action: 'lookUp',
      label: 'Publisher Name',
    });
    expect(await menus.act(open.menuId, 'lookUp')).toEqual({
      lookUp: 'Publisher Name',
    });
  });

  it("hands back the name to look up and the app's page", async () => {
    setup();
    let open = await rightClick({ selectionText: '@Publisher.' });
    expect(await menus.act(open.menuId, 'lookUp')).toEqual({
      lookUp: 'Publisher',
    });
    open = await rightClick({});
    expect(await menus.act(open.menuId, 'aboutApp')).toEqual({
      open: 'qortal://use-app-page/APP/Opened-App',
    });
  });

  it('asks Qortino only while Qortino is set up', async () => {
    setup();
    let open = await rightClick({ selectionText: 'what is minting' });
    expect(await menus.act(open.menuId, 'askQortino')).toBe(false);
    menus.setSettings(QORTINO_SET_UP);
    open = await rightClick({ selectionText: 'what is\nminting' });
    expect(actions(open.items)).toContain('askQortino');
    // Qortino removed while the menu was open.
    menus.setSettings({ devMode: false, qortino: false });
    expect(await menus.act(open.menuId, 'askQortino')).toBe(false);
    menus.setSettings(QORTINO_SET_UP);
    open = await rightClick({ selectionText: 'what is\nminting' });
    expect(await menus.act(open.menuId, 'askQortino')).toEqual({
      ask: 'what is minting',
    });
  });

  it("copies the element's description from the app's preload, in its isolated world", async () => {
    setup();
    menus.setSettings(DEV_MODE);
    guest.answer = (code) =>
      code.endsWith('describe()')
        ? {
            tag: 'button',
            name: 'Subscribe',
            role: '',
            selector: 'main > button',
            box: { x: 1, y: 2, width: 3, height: 4 },
            viewport: { width: 800, height: 600 },
            style: { color: '', background: '', font: '' },
            html: '<button>Subscribe</button>',
            cut: false,
            title: '',
          }
        : null;
    const open = await rightClick({});
    // The right-click asked whether a video is under it; then the element.
    guest.guestCalls = [];
    expect(await menus.act(open.menuId, 'copyElement')).toBe(true);
    expect(guest.guestCalls).toEqual([
      [
        QAPP_GUEST_ISOLATED_WORLD,
        `globalThis[${JSON.stringify(QAPP_MENU_GUEST_KEY)}]?.describe()`,
        false,
      ],
    ]);
    expect(clipboard).toEqual([
      [
        'app: Opened-App (APP)',
        'page: qortal://APP/Opened-App/video/1',
        'window: 800×600',
        'element: button "Subscribe"',
        'selector: main > button',
        'box: 3×4 at 1,2',
        'html:',
        '<button>Subscribe</button>',
      ].join('\n'),
    ]);
  });

  it("does nothing for the developers' items once dev mode is off", async () => {
    setup();
    guest.answer = () => ({
      box: { x: 0, y: 0, width: 10, height: 10 },
      viewport: { width: 800, height: 600 },
    });
    for (const action of [
      'copyElement',
      'copyElementPicture',
      'inspectElement',
    ] as const) {
      menus.setSettings(DEV_MODE);
      const open = await rightClick({});
      expect(actions(open.items)).toContain(action);
      menus.setSettings({ devMode: false, qortino: false });
      expect(await menus.act(open.menuId, action)).toBe(false);
    }
    // Only the right-clicks' own question: is a video under the pointer.
    expect(
      guest.guestCalls.filter(([, code]) => !code.includes('?.at('))
    ).toEqual([]);
    expect(guest.captured).toEqual([]);
    expect(guest.inspected).toEqual([]);
    expect(clipboard).toEqual([]);
  });

  it("copies what's on screen of the element, at the app's zoom", async () => {
    setup();
    menus.setSettings(DEV_MODE);
    guest.zoom = 1.5;
    guest.answer = () => ({
      box: { x: -10, y: 20, width: 100, height: 50 },
      viewport: { width: 800, height: 600 },
    });
    const open = await rightClick({});
    expect(await menus.act(open.menuId, 'copyElementPicture')).toBe(true);
    expect(guest.guestCalls.map(([, code]) => code.split('?.')[1])).toEqual([
      'at(true)',
      'box()',
    ]);
    expect(guest.captured).toEqual([{ x: 0, y: 30, width: 135, height: 75 }]);
    expect(clipboard).toEqual(['image:screen']);
  });

  it("copies a video's frame, or what's on screen when it can't be read", async () => {
    setup();
    const video = {
      mediaType: 'video',
      srcURL: `blob:${NODE}/0f8a`,
      mediaFlags: { canSave: false, hasAudio: true },
    };
    guest.answer = () => ({ png: 'data:image/png;base64,AAAA' });
    let open = await rightClick(video);
    expect(await menus.act(open.menuId, 'copyVideoFrame')).toBe(true);
    // The right-click's own question (a link shown there), then the frame.
    expect(guest.guestCalls.map(([, code]) => code.split('?.')[1])).toEqual([
      'at(false)',
      'videoFrame()',
    ]);
    expect(clipboard).toEqual(['image:data:26']);

    guest.answer = () => ({
      box: { x: 0, y: 0, width: 320, height: 180 },
      viewport: { width: 800, height: 600 },
    });
    open = await rightClick(video);
    expect(await menus.act(open.menuId, 'copyVideoFrame')).toBe(true);
    expect(guest.captured).toEqual([{ x: 0, y: 0, width: 320, height: 180 }]);

    for (const answer of [
      { png: 'data:text/html;base64,AAAA' },
      { png: 'data:image/png;base64,' },
      null,
    ]) {
      guest.answer = () => answer;
      open = await rightClick(video);
      expect(await menus.act(open.menuId, 'copyVideoFrame')).toBe(false);
    }
    expect(clipboard).toEqual(['image:data:26', 'image:screen']);
  });

  it("starts and ends picture in picture as the user's own click", async () => {
    setup();
    guest.answer = () => true;
    let open = await rightClick({
      mediaType: 'video',
      mediaFlags: {
        canSave: false,
        hasAudio: true,
        canShowPictureInPicture: true,
      },
    });
    expect(await menus.act(open.menuId, 'pictureInPicture')).toBe(true);
    open = await rightClick({
      mediaType: 'video',
      mediaFlags: {
        canSave: false,
        hasAudio: true,
        isShowingPictureInPicture: true,
      },
    });
    guest.answer = () => 'yes';
    expect(await menus.act(open.menuId, 'exitPictureInPicture')).toBe(false);
    expect(
      guest.guestCalls
        .map(([, code, gesture]) => [
          code.slice(code.indexOf('?.') + 2),
          gesture,
        ])
        .filter(([call]) => !String(call).startsWith('at('))
    ).toEqual([
      ['pictureInPicture(true)', true],
      ['pictureInPicture(false)', true],
    ]);
  });

  it("gives up on an app that doesn't answer", async () => {
    setup();
    deps.guestCallTimeoutMs = 20;
    menus.setSettings(DEV_MODE);
    const open = await rightClick({});
    guest.executeJavaScriptInIsolatedWorld = () => new Promise(() => {});
    expect(await menus.act(open.menuId, 'copyElement')).toBe(false);
    expect(clipboard).toEqual([]);
  });

  it('inspects the element at the point the right-click gave', async () => {
    setup();
    menus.setSettings(DEV_MODE);
    const open = await rightClick({ x: 412, y: 233 });
    expect(await menus.act(open.menuId, 'inspectElement')).toBe(true);
    expect(guest.inspected).toEqual([[412, 233]]);
  });

  it('answers false when the clipboard refuses a copy', async () => {
    setup();
    deps.writeClipboardText = () => Promise.reject(new Error('busy'));
    const open = await rightClick({
      linkURL: `${NODE}/render/APP/Opened-App/item/7`,
    });
    expect(await menus.act(open.menuId, 'copyLink')).toBe(false);
  });

  it('takes only yes or no for each setting', async () => {
    setup();
    menus.setSettings({ devMode: 'yes', qortino: 1 });
    expect(
      actions((await rightClick({ selectionText: 'what is minting' })).items)
    ).toEqual(['copy', '|', 'lookUp']);
    menus.setSettings(null);
    expect(actions((await rightClick({})).items)).toEqual(['aboutApp']);
  });
  it("offers the video under a cover (a paused video's play button)", async () => {
    setup();
    guest.answer = (code) =>
      code.endsWith('at(true)')
        ? {
            video: {
              src: `${NODE}/arbitrary/VIDEO/Publisher/vid-1`,
              stream: false,
              hasAudio: null,
              error: false,
              pictureInPicture: 'can',
            },
            link: null,
          }
        : null;
    const open = await rightClick({});
    expect(actions(open.items)).toEqual([
      'saveVideo',
      'copyVideoFrame',
      'saveVideoFrame',
      'pictureInPicture',
    ]);
    // Saving it saves that video, through the app.
    expect(await menus.act(open.menuId, 'saveVideo')).toBe(true);
    expect(
      guest.downloads[0].startsWith(
        `${NODE}/arbitrary/VIDEO/Publisher/vid-1#qortal-hub-save-`
      )
    ).toBe(true);
  });

  it("offers the picture an image viewer shows, which doesn't take the pointer, and copies it from its pixels", async () => {
    setup();
    const src = `${NODE}/arbitrary/IMAGE/Publisher/pic-1?async=true`;
    let pixels: unknown = { png: 'data:image/png;base64,AAAA' };
    guest.answer = (code) =>
      code.endsWith('at(true)')
        ? { video: null, picture: { src, loaded: true }, link: null }
        : code.endsWith('picture()')
          ? pixels
          : null;
    let open = await rightClick({ x: 400, y: 300 });
    expect(actions(open.items)).toEqual([
      'savePicture',
      'copyPicture',
      'copyPictureLink',
    ]);
    // Chromium finds no picture at the point: the app's preload draws it.
    expect(await menus.act(open.menuId, 'copyPicture')).toBe(true);
    expect(guest.copiedAt).toEqual([]);
    expect(guest.guestCalls.map(([, code]) => code.split('?.')[1])).toEqual([
      'at(true)',
      'picture()',
    ]);
    expect(clipboard).toEqual(['image:data:26']);
    // One from elsewhere: what's on screen of it.
    pixels = {
      box: { x: 300, y: 200, width: 400, height: 300 },
      viewport: { width: 1000, height: 800 },
    };
    open = await rightClick({});
    expect(await menus.act(open.menuId, 'copyPicture')).toBe(true);
    expect(guest.captured).toEqual([
      { x: 300, y: 200, width: 400, height: 300 },
    ]);
    // Gone, or no longer what the menu was opened for.
    pixels = null;
    open = await rightClick({});
    expect(await menus.act(open.menuId, 'copyPicture')).toBe(false);
    open = await rightClick({});
    expect(await menus.act(open.menuId, 'copyPictureLink')).toBe(true);
    expect(clipboard.slice(2)).toEqual([
      'qortal://use-embed/IMAGE?name=Publisher&identifier=pic-1&service=IMAGE',
    ]);
    // Saving it saves that picture, through the app.
    open = await rightClick({});
    expect(await menus.act(open.menuId, 'savePicture')).toBe(true);
    expect(guest.downloads[0].startsWith(`${src}#qortal-hub-save-`)).toBe(true);
  });

  it('offers to copy a picture the app found only once it has loaded', async () => {
    setup();
    guest.answer = (code) =>
      code.endsWith('at(true)')
        ? {
            video: null,
            picture: {
              src: `${NODE}/arbitrary/IMAGE/Publisher/pic-1`,
              loaded: false,
            },
            link: null,
          }
        : null;
    expect(actions((await rightClick({})).items)).toEqual([
      'savePicture',
      'copyPictureLink',
    ]);
  });

  it('asks the app what it shows (on a link too, for a name), and about a picture or video only on a plain spot', async () => {
    setup();
    const asked = async (overrides: Partial<QAppMenuParams>) => {
      guest.guestCalls = [];
      await rightClick(overrides);
      return guest.guestCalls.map(([, code]) => code.split('?.')[1]);
    };
    expect(
      await asked({ linkURL: `${NODE}/render/APP/Opened-App/item/7` })
    ).toEqual(['at(false)']);
    expect(await asked({ isEditable: true })).toEqual(['at(false)']);
    expect(await asked({ selectionText: 'some text' })).toEqual(['at(false)']);
    expect(await asked(picture)).toEqual(['at(false)']);
    expect(await asked({})).toEqual(['at(true)']);
  });

  it("opens the menu without picture or video items when the app doesn't answer in time", async () => {
    setup();
    vi.useFakeTimers();
    guest.executeJavaScriptInIsolatedWorld = () => new Promise(() => {});
    guest.emit('context-menu', {}, params());
    await vi.advanceTimersByTimeAsync(LOOKUP_MS - 1);
    expect(hub.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const [[, open]] = hub.sent;
    expect(actions((open as QAppMenuOpen).items)).toEqual(['aboutApp']);
  });

  it("shows only the newest right-click's menu", async () => {
    setup();
    const answers: ((value: unknown) => void)[] = [];
    guest.executeJavaScriptInIsolatedWorld = () =>
      new Promise((resolve) => answers.push(resolve));
    guest.emit('context-menu', {}, params({ x: 10 }));
    guest.emit('context-menu', {}, params({ x: 20 }));
    answers[1](null);
    answers[0](null);
    await settle();
    const opened = hub.sent.filter(
      ([channel]) => channel === QAPP_MENU_CHANNELS.open
    );
    expect(opened.map(([, open]) => (open as QAppMenuOpen).x)).toEqual([20]);
  });

  it('asks nothing of the app for a right-click inside a frame of it', async () => {
    setup();
    menus.setSettings(DEV_MODE);
    guest.answer = () => true;
    // The app's preload knows its own page only: it would name an element
    // right-clicked there before.
    const inFrame = { frame: { page: 'frame' } } as Partial<QAppMenuParams>;
    let open = await rightClick(inFrame);
    expect(actions(open.items)).toEqual(['aboutApp', '|', 'inspectElement']);
    open = await rightClick({
      ...inFrame,
      mediaType: 'video',
      mediaFlags: {
        canSave: false,
        hasAudio: true,
        canShowPictureInPicture: true,
      },
    });
    expect(actions(open.items)).toEqual(['saveVideo', '|', 'inspectElement']);
    expect(await menus.act(open.menuId, 'pictureInPicture')).toBe(false);
    expect(guest.guestCalls).toEqual([]);
    // In the app's own page, all of them.
    open = await rightClick({
      frame: guest.mainFrame,
    } as Partial<QAppMenuParams>);
    expect(actions(open.items)).toContain('copyElement');
  });

  it('saves the frame as it is when chosen, where the Save dialog says', async () => {
    setup();
    const video = {
      mediaType: 'video',
      srcURL: `blob:${NODE}/0f8a`,
      mediaFlags: { canSave: false, hasAudio: true },
    };
    const order: string[] = [];
    guest.answer = (code) => {
      order.push(code.split('?.')[1]);
      return { png: 'data:image/png;base64,AAAA' };
    };
    (deps.showSaveDialog as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (options: { defaultPath: string }) => {
        order.push(`dialog ${path.basename(options.defaultPath)}`);
        return { canceled: false, filePath: path.join(DOWNLOADS, 'frame') };
      }
    );
    const open = await rightClick(video);
    expect(await menus.act(open.menuId, 'saveVideoFrame')).toBe(true);
    expect(order).toEqual([
      'at(false)',
      'videoFrame()',
      'dialog Opened-App 2026-11-20 15-49-07.png',
    ]);
    // A PNG made here, from the frame's pixels.
    expect(written).toEqual([
      [path.join(DOWNLOADS, 'frame.png'), 'png of data:26'],
    ]);
    const [update] = saveUpdates();
    expect(update).toMatchObject({
      name: 'frame.png',
      state: 'done',
      first: true,
    });
    expect(menus.showSaved(update.saveId)).toBe(true);
    expect(shown).toEqual([path.join(DOWNLOADS, 'frame.png')]);
  });

  it('writes no frame when the dialog is cancelled, Hub locked, or writing fails', async () => {
    setup();
    const video = {
      mediaType: 'video',
      srcURL: `blob:${NODE}/0f8a`,
      mediaFlags: { canSave: false, hasAudio: true },
    };
    guest.answer = () => ({ png: 'data:image/png;base64,AAAA' });
    dialogAnswer = { canceled: true };
    let open = await rightClick(video);
    expect(await menus.act(open.menuId, 'saveVideoFrame')).toBe(false);

    dialogAnswer = { canceled: false, filePath: path.join(DOWNLOADS, 'frame') };
    open = await rightClick(video);
    (deps.showSaveDialog as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        menus.setHubLocked(true);
        return dialogAnswer;
      }
    );
    expect(await menus.act(open.menuId, 'saveVideoFrame')).toBe(false);
    menus.setHubLocked(false);
    expect(written).toEqual([]);
    expect(saveUpdates()).toEqual([]);

    deps.writeFile = async () => {
      throw new Error('ENOSPC');
    };
    open = await rightClick(video);
    expect(await menus.act(open.menuId, 'saveVideoFrame')).toBe(false);
    expect(saveUpdates()).toMatchObject([
      { name: 'frame.png', state: 'failed' },
    ]);
  });

  it('answers false, without an error, when the app goes away or Hub locks while it answers', async () => {
    setup();
    menus.setSettings(DEV_MODE);
    const box = {
      box: { x: 1, y: 2, width: 30, height: 40 },
      viewport: { width: 800, height: 600 },
    };
    let open = await rightClick({});
    guest.answer = () => {
      guest.destroyed = true;
      return box;
    };
    await expect(menus.act(open.menuId, 'copyElementPicture')).resolves.toBe(
      false
    );

    setup();
    menus.setSettings(DEV_MODE);
    open = await rightClick({});
    guest.answer = (code) => {
      menus.setHubLocked(true);
      return code.endsWith('describe()')
        ? {
            tag: 'button',
            name: 'Subscribe',
            role: '',
            selector: 'button',
            box: box.box,
            viewport: box.viewport,
            style: { color: '', background: '', font: '' },
            html: '<button>Subscribe</button>',
            cut: false,
            title: '',
          }
        : null;
    };
    expect(await menus.act(open.menuId, 'copyElement')).toBe(false);

    setup();
    open = await rightClick({
      mediaType: 'video',
      mediaFlags: { canSave: false, hasAudio: true },
    });
    guest.answer = () => {
      guest.destroyed = true;
      return box;
    };
    await expect(menus.act(open.menuId, 'copyVideoFrame')).resolves.toBe(false);
    expect(clipboard).toEqual([]);
  });

  it("copies no private app's preview secret in an element's description", async () => {
    setup();
    info = { ...guestInfo, service: 'DOCUMENT' };
    menus.setSettings(DEV_MODE);
    guest.url = `${NODE}/render/hash/preview-hash?secret=preview-key&theme=dark`;
    guest.answer = (code) =>
      code.endsWith('describe()')
        ? {
            tag: 'button',
            name: 'Open',
            role: '',
            selector: 'button',
            box: { x: 1, y: 2, width: 3, height: 4 },
            viewport: { width: 800, height: 600 },
            style: { color: '', background: '', font: '' },
            html: '<button>Open</button>',
            cut: false,
            title: '',
          }
        : null;
    const open = await rightClick({});
    expect(await menus.act(open.menuId, 'copyElement')).toBe(true);
    expect(clipboard[0]).not.toContain('preview-key');
    expect(clipboard[0]).not.toContain('page:');
  });

  it("keeps Shift on a right-click passed on from the menu's backdrop", () => {
    setup();
    deps.guestById = (id) => (id === 7 ? (guest as never) : null);
    expect(menus.rightClickAt(7, 40, 80, true)).toBe(true);
    expect(guest.inputs.map((input) => input.modifiers)).toEqual([
      ['shift'],
      ['shift'],
      ['shift'],
    ]);
    guest.inputs = [];
    expect(menus.rightClickAt(7, 40, 80, 'yes')).toBe(true);
    expect(guest.inputs.map((input) => input.modifiers)).toEqual([[], [], []]);
  });
  it("offers the link the app shows outside an <a>, and opens it with Hub's opener", async () => {
    setup();
    guest.answer = (code) =>
      code.endsWith('at(false)')
        ? { video: null, link: 'qortal://use-app-page/APP/Opened-App' }
        : null;
    const open = await rightClick({ selectionText: 'Opened-App' });
    expect(actions(open.items)).toEqual([
      'openQortalLink',
      'copyLink',
      '|',
      'copy',
      '|',
      'lookUp',
    ]);
    expect(await menus.act(open.menuId, 'openQortalLink')).toEqual({
      open: 'qortal://use-app-page/APP/Opened-App',
    });
  });

  it('opens a web link in the browser when chosen, and says when it could not', async () => {
    setup();
    const opened: string[] = [];
    deps.openInBrowser = async (url) => {
      opened.push(url);
    };
    let open = await rightClick({ linkURL: 'https://example.org/a' });
    expect(await menus.act(open.menuId, 'openWebLink')).toBe(true);
    expect(opened).toEqual(['https://example.org/a']);
    deps.openInBrowser = async () => {
      throw new Error('no browser');
    };
    open = await rightClick({ linkURL: 'https://example.org/a' });
    expect(await menus.act(open.menuId, 'openWebLink')).toBe(false);
  });
});

describe('registerQAppMenuIpc', () => {
  it('checks the sender before every handler', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const menus = {
      act: vi.fn(),
      dismiss: vi.fn(),
      cancelSave: vi.fn(),
      showSaved: vi.fn(),
      setHubLocked: vi.fn(),
      rightClickAt: vi.fn(),
      setSettings: vi.fn(),
    };
    const checkSender = vi.fn((event: { sender: { id: number } }) => {
      if (event.sender.id !== 1) throw new Error('not the main window');
    });
    registerQAppMenuIpc({
      ipcMain: ipcMain as never,
      checkSender: checkSender as never,
      menus: menus as never,
    });
    expect([...handlers.keys()].sort()).toEqual(
      [
        QAPP_MENU_CHANNELS.act,
        QAPP_MENU_CHANNELS.dismiss,
        QAPP_MENU_CHANNELS.cancelSave,
        QAPP_MENU_CHANNELS.showSaved,
        QAPP_MENU_CHANNELS.hubLocked,
        QAPP_MENU_CHANNELS.rightClick,
        QAPP_MENU_CHANNELS.settings,
      ].sort()
    );
    for (const handler of handlers.values()) {
      expect(() => handler({ sender: { id: 2 } }, 'x')).toThrow(
        'not the main window'
      );
    }
    expect(Object.values(menus).every((fn) => fn.mock.calls.length === 0)).toBe(
      true
    );
    handlers.get(QAPP_MENU_CHANNELS.act)({ sender: { id: 1 } }, 'm', 'copy', 2);
    expect(menus.act).toHaveBeenCalledWith('m', 'copy', 2);
    handlers.get(QAPP_MENU_CHANNELS.hubLocked)({ sender: { id: 1 } }, 'yes');
    expect(menus.setHubLocked).toHaveBeenCalledWith(false);
    handlers.get(QAPP_MENU_CHANNELS.rightClick)(
      { sender: { id: 1 } },
      7,
      40,
      80,
      true
    );
    expect(menus.rightClickAt).toHaveBeenCalledWith(7, 40, 80, true);
    const settings = { devMode: true, qortino: false };
    handlers.get(QAPP_MENU_CHANNELS.settings)({ sender: { id: 1 } }, settings);
    expect(menus.setSettings).toHaveBeenCalledWith(settings);
  });
});

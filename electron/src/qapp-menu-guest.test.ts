// @vitest-environment jsdom
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_COPIED_ELEMENTS,
  MAX_ELEMENT_HTML,
  installQAppMenuGuest,
  selectorOf,
} from './qapp-menu-guest';
import { QAPP_MENU_GUEST_KEY } from './qapp-context-menu-types';

type TestWindow = Window & typeof globalThis;

/** A page of its own for each test, as each app's webview has. */
const page = (html: string) =>
  new JSDOM(
    `<!doctype html><html><head><title>Opened-App</title></head><body>${html}</body></html>`
  ).window as unknown as TestWindow;

/** Installs the helper as the app's preload does, with clicks taken as real. */
const install = (win: TestWindow) =>
  installQAppMenuGuest(win, { isTrusted: () => true });

/** A right-click on `element`, as the user's mouse gives it. */
const rightClick = (
  win: TestWindow,
  element: Element,
  { shiftKey = false, clientX = 0, clientY = 0 } = {}
) => {
  const event = new win.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey,
    clientX,
    clientY,
  });
  element.dispatchEvent(event);
  return event;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installQAppMenuGuest', () => {
  it("notes a real right-click's element only", () => {
    const win = page('<button>Subscribe</button>');
    // The page's own made-up right-click (not trusted) changes nothing.
    const helper = installQAppMenuGuest(win);
    rightClick(win, win.document.querySelector('button'));
    expect(helper.describe()).toBeNull();
  });

  it("sets the helper where the app's page can't replace it", () => {
    const win = page('');
    const helper = install(win);
    expect(win[QAPP_MENU_GUEST_KEY]).toBe(helper);
    expect(() => {
      (win as unknown as Record<string, unknown>)[QAPP_MENU_GUEST_KEY] = {};
    }).toThrow();
    expect(win[QAPP_MENU_GUEST_KEY]).toBe(helper);
    expect(Object.isFrozen(helper)).toBe(true);
  });

  it("lets Shift+right-click past the app's own menu", () => {
    const win = page('<p>Text</p>');
    install(win);
    const pageMenu = vi.fn((event: Event) => event.preventDefault());
    win.document.addEventListener('contextmenu', pageMenu);
    const target = win.document.querySelector('p');
    expect(rightClick(win, target).defaultPrevented).toBe(true);
    expect(pageMenu).toHaveBeenCalledTimes(1);
    expect(rightClick(win, target, { shiftKey: true }).defaultPrevented).toBe(
      false
    );
    expect(pageMenu).toHaveBeenCalledTimes(1);
  });

  it('forgets an element that has left the page', () => {
    const win = page('<button>Subscribe</button>');
    const helper = install(win);
    const button = win.document.querySelector('button');
    rightClick(win, button);
    expect(helper.describe()?.tag).toBe('button');
    button.remove();
    expect(helper.describe()).toBeNull();
    expect(helper.box()).toBeNull();
  });
});

describe('describe', () => {
  it('says what the element is, where it is and how it looks', () => {
    const win = page(
      '<main><div class="card"></div><div class="card css-1x2y3z">' +
        '<button role="button" style="color: rgb(255, 255, 255)">Subscribe now</button>' +
        '</div></main>'
    );
    const helper = install(win);
    const button = win.document.querySelector('button');
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      left: 306.4,
      top: 1044.2,
      width: 158,
      height: 46,
    } as DOMRect);
    rightClick(win, button);
    const info = helper.describe();
    expect(info).toMatchObject({
      tag: 'button',
      name: 'Subscribe now',
      role: 'button',
      selector: 'body > main > div.card:nth-of-type(2) > button',
      box: { x: 306, y: 1044, width: 158, height: 46 },
      viewport: { width: win.innerWidth, height: win.innerHeight },
      title: 'Opened-App',
      cut: false,
    });
    expect(info.style.color).toBe('rgb(255, 255, 255)');
    expect(info.html).toBe(
      '<button role="button" style="color: rgb(255, 255, 255)">Subscribe now</button>'
    );
  });

  it('leaves out what was typed: field values, text areas, editable parts', () => {
    const win = page(
      '<form>' +
        '<input aria-label="Amount" value="12.5">' +
        '<input type="password" value="secret-word">' +
        '<textarea placeholder="Message">typed message</textarea>' +
        '<div contenteditable="true">typed note</div>' +
        '<div contenteditable="false">fixed text</div>' +
        '</form>'
    );
    const helper = install(win);
    const form = win.document.querySelector('form');
    rightClick(win, form);
    const html = helper.describe().html;
    expect(html).not.toContain('12.5');
    expect(html).not.toContain('secret-word');
    expect(html).not.toContain('typed message');
    expect(html).not.toContain('typed note');
    expect(html).toContain('fixed text');
    // The page itself is left as it was.
    expect(win.document.querySelector('input').getAttribute('value')).toBe(
      '12.5'
    );

    rightClick(win, win.document.querySelector('input'));
    expect(helper.describe().name).toBe('Amount');
    rightClick(win, win.document.querySelector('[contenteditable="true"]'));
    expect(helper.describe()).toMatchObject({
      name: '',
      html: '<div contenteditable="true"></div>',
    });
  });

  it('leaves out the text inside a part of the page typed into', () => {
    const win = page('<div contenteditable=""><p><b>typed words</b></p></div>');
    const helper = install(win);
    rightClick(win, win.document.querySelector('b'));
    expect(helper.describe()).toMatchObject({ name: '', html: '<b></b>' });
  });

  it("cuts long HTML, and copies a very large part without what's in it", () => {
    const win = page(
      `<p id="long">${'word '.repeat(MAX_ELEMENT_HTML)}</p>` +
        `<ul>${'<li>x</li>'.repeat(MAX_COPIED_ELEMENTS + 1)}</ul>`
    );
    const helper = install(win);
    rightClick(win, win.document.querySelector('#long'));
    const long = helper.describe();
    expect(long.html).toHaveLength(MAX_ELEMENT_HTML);
    expect(long.cut).toBe(true);
    rightClick(win, win.document.querySelector('ul'));
    const large = helper.describe();
    expect(large).toMatchObject({ name: '', cut: true });
    expect(large.html).toBe('<ul><!-- … --></ul>');
  });
});

describe('selectorOf', () => {
  it('stops at an id and leaves out generated class names', () => {
    const win = page(
      '<div id="app"><section class="jss12 MuiBox-root css-9z8y7x">' +
        '<span></span><span class="label ab12345 x y"></span></section></div>'
    );
    const target = win.document.querySelectorAll('span')[1];
    expect(selectorOf(target)).toBe(
      '#app > section.MuiBox-root > span.label.x:nth-of-type(2)'
    );
  });

  it('goes on from a shadow root to the element holding it', () => {
    const win = page('<main><my-card></my-card></main>');
    const host = win.document.querySelector('my-card');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Go</button>';
    expect(selectorOf(shadow.querySelector('button'))).toBe(
      'body > main > my-card > button'
    );
  });
});

describe('videoFrame', () => {
  /** A video element with a frame to draw, as Chromium has it. */
  const playing = (win: TestWindow, size = { width: 640, height: 360 }) => {
    const video = win.document.querySelector('video');
    Object.defineProperties(video, {
      readyState: { value: 4, configurable: true },
      videoWidth: { value: size.width },
      videoHeight: { value: size.height },
    });
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 320,
      height: 180,
    } as DOMRect);
    return video;
  };

  it("draws the video's frame at its own size", () => {
    const win = page('<video></video>');
    const helper = install(win);
    const video = playing(win);
    const drawImage = vi.fn();
    const sizes: [number, number][] = [];
    vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as never);
    vi.spyOn(win.HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      function (this: HTMLCanvasElement) {
        sizes.push([this.width, this.height]);
        return 'data:image/png;base64,AAAA';
      }
    );
    rightClick(win, video);
    expect(helper.videoFrame()).toEqual({ png: 'data:image/png;base64,AAAA' });
    // A node of another page is compared as itself, not field by field.
    expect(drawImage.mock.calls[0][0]).toBe(video);
    expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 640, 360]);
    expect(sizes).toEqual([[640, 360]]);
  });

  it('makes a frame bigger than 4K smaller', () => {
    const win = page('<video></video>');
    const helper = install(win);
    const video = playing(win, { width: 7680, height: 4320 });
    const drawImage = vi.fn();
    vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as never);
    vi.spyOn(win.HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,AAAA'
    );
    rightClick(win, video);
    helper.videoFrame();
    expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 3840, 2160]);
  });

  it("gives the video's box when its frame can't be read", () => {
    const win = page('<video></video>');
    const helper = install(win);
    const video = playing(win);
    vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(win.HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      () => {
        throw new Error('SecurityError: tainted canvas');
      }
    );
    rightClick(win, video);
    const where = {
      box: { x: 10, y: 20, width: 320, height: 180 },
      viewport: { width: win.innerWidth, height: win.innerHeight },
    };
    expect(helper.videoFrame()).toEqual(where);
    // No frame yet: what's on screen there.
    Object.defineProperty(video, 'readyState', { value: 1 });
    expect(helper.videoFrame()).toEqual(where);
  });

  it('finds no video where none was right-clicked', () => {
    const win = page('<p>Text</p><video></video>');
    const helper = install(win);
    rightClick(win, win.document.querySelector('p'));
    expect(helper.videoFrame()).toBeNull();
  });
});

describe('pictureInPicture', () => {
  it('starts it for the video right-clicked, and ends it', async () => {
    const win = page('<video></video>');
    const helper = install(win);
    const video = win.document.querySelector('video');
    const request = vi.fn(async () => ({}));
    Object.defineProperty(video, 'requestPictureInPicture', {
      value: request,
    });
    const exit = vi.fn(async () => undefined);
    Object.defineProperty(win.document, 'exitPictureInPicture', {
      value: exit,
    });
    expect(await helper.pictureInPicture(false)).toBe(false);
    rightClick(win, video);
    expect(await helper.pictureInPicture(true)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    Object.defineProperty(win.document, 'pictureInPictureElement', {
      value: video,
    });
    expect(await helper.pictureInPicture(false)).toBe(true);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("answers false when the page won't allow it", async () => {
    const win = page('<video></video>');
    const helper = install(win);
    const video = win.document.querySelector('video');
    Object.defineProperty(video, 'requestPictureInPicture', {
      value: async () => {
        throw new Error('NotAllowedError');
      },
    });
    rightClick(win, video);
    expect(await helper.pictureInPicture(true)).toBe(false);
  });
});

describe('a video under a cover', () => {
  /**
   * A player as apps build one: the video, and over it a cover with a play
   * button (what a right-click on a paused video lands on).
   */
  const player = () => {
    const win = page(
      '<div id="player"><video></video><div class="cover">Play</div></div>'
    );
    const video = win.document.querySelector('video');
    const cover = win.document.querySelector('.cover');
    // jsdom lays nothing out: where they are, and what is under the point,
    // top first.
    for (const element of [
      win.document.querySelector('#player'),
      video,
      cover,
    ]) {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 640,
        height: 360,
      } as DOMRect);
    }
    const asked: [number, number][] = [];
    Object.defineProperty(win.document, 'elementsFromPoint', {
      configurable: true,
      value: (x: number, y: number) => {
        asked.push([x, y]);
        return [cover, win.document.querySelector('#player'), video];
      },
    });
    Object.defineProperty(win.document, 'pictureInPictureEnabled', {
      configurable: true,
      value: true,
    });
    return { win, video, cover, asked };
  };

  const playsFrom = (video: HTMLVideoElement, src: string) =>
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      value: src,
    });

  it('finds the video under what was right-clicked, at that point', async () => {
    const { win, video, cover, asked } = player();
    const helper = install(win);
    playsFrom(video, 'https://node.example/arbitrary/VIDEO/Publisher/vid-1');
    Object.defineProperty(video, 'webkitAudioDecodedByteCount', {
      configurable: true,
      value: 4096,
    });
    rightClick(win, cover, { clientX: 50, clientY: 60 });
    expect(await helper.videoAt()).toEqual({
      src: 'https://node.example/arbitrary/VIDEO/Publisher/vid-1',
      stream: false,
      hasAudio: true,
      error: false,
      pictureInPicture: 'can',
    });
    expect(asked).toEqual([[50, 60]]);
  });

  it('says a blob: video the app feeds in parts is a stream', async () => {
    const { win, video, cover } = player();
    const helper = install(win);
    playsFrom(video, 'blob:https://node.example/media-source');
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    Object.defineProperty(win, 'fetch', { configurable: true, value: fetch });
    rightClick(win, cover);
    expect(await helper.videoAt()).toMatchObject({
      stream: true,
      hasAudio: null,
    });
    // A whole file behind a blob: address is no stream (its start is read).
    const cancel = vi.fn(async () => undefined);
    fetch.mockImplementationOnce(async () => ({ body: { cancel } }) as never);
    expect(await helper.videoAt()).toMatchObject({ stream: false });
    expect(cancel).toHaveBeenCalled();
  });

  it('says when picture in picture shows it, or the app turned it off', async () => {
    const { win, video, cover } = player();
    const helper = install(win);
    rightClick(win, cover);
    Object.defineProperty(win.document, 'pictureInPictureElement', {
      configurable: true,
      value: video,
    });
    expect((await helper.videoAt()).pictureInPicture).toBe('showing');
    Object.defineProperty(win.document, 'pictureInPictureElement', {
      configurable: true,
      value: null,
    });
    video.disablePictureInPicture = true;
    expect((await helper.videoAt()).pictureInPicture).toBe('no');
  });

  it('draws the frame of the video under the cover, and plays it in picture in picture', async () => {
    const { win, video, cover } = player();
    const helper = install(win);
    Object.defineProperties(video, {
      readyState: { value: 4 },
      videoWidth: { value: 640 },
      videoHeight: { value: 360 },
    });
    const drawImage = vi.fn();
    vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as never);
    vi.spyOn(win.HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,AAAA'
    );
    const request = vi.fn(async () => ({}));
    Object.defineProperty(video, 'requestPictureInPicture', {
      value: request,
    });
    rightClick(win, cover);
    expect(helper.videoFrame()).toEqual({ png: 'data:image/png;base64,AAAA' });
    expect(drawImage.mock.calls[0][0]).toBe(video);
    expect(await helper.pictureInPicture(true)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('finds no video where none is under the point', async () => {
    const win = page('<p>Text</p>');
    const helper = install(win);
    Object.defineProperty(win.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [win.document.querySelector('p'), win.document.body],
    });
    rightClick(win, win.document.querySelector('p'));
    expect(await helper.videoAt()).toBeNull();
    expect(helper.videoFrame()).toBeNull();
    expect(await helper.pictureInPicture(true)).toBe(false);
  });
});

describe("a picture or video Chromium doesn't see at the point", () => {
  type Rect = { left: number; top: number; width: number; height: number };
  const NODE_PICTURE = 'https://node.example/arbitrary/IMAGE/Publisher';

  /** jsdom lays nothing out: where an element is on screen. */
  const place = (element: Element, rect: Rect) =>
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    } as DOMRect);

  /**
   * What Chromium lists at the point, top first: the elements under it that
   * take the pointer, also ones covered by others.
   */
  const listAtPoint = (win: TestWindow, ...ids: string[]) =>
    Object.defineProperty(win.document, 'elementsFromPoint', {
      configurable: true,
      value: () => [
        ...ids.map((id) => win.document.getElementById(id)),
        win.document.body,
        win.document.documentElement,
      ],
    });

  const loaded = (image: Element, width = 1600, height = 1200) =>
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: width },
      naturalHeight: { configurable: true, value: height },
    });

  /**
   * An image viewer as Torq's full-screen one is built: a dialog over the
   * feed, with a black stage the pointer lands on, and in it the pictures
   * the viewer moves itself, which don't take the pointer (the one shown,
   * and the ones before and after it, off to the sides).
   */
  const viewer = () => {
    const win = page(
      '<div id="root"><article id="post">' +
        `<img id="feed" src="${NODE_PICTURE}/feed-1">` +
        '<video id="feed-video"></video></article></div>' +
        '<div id="dialog" style="background-color: rgba(0, 0, 0, 0.96)">' +
        '<div id="stage" style="background: #000; overflow: hidden">' +
        '<div id="reel" style="pointer-events: none">' +
        `<img id="before" style="pointer-events: none" src="${NODE_PICTURE}/pic-0">` +
        `<img id="shown" style="pointer-events: none" src="${NODE_PICTURE}/pic-1">` +
        `<img id="after" style="pointer-events: none" src="${NODE_PICTURE}/pic-2">` +
        '</div></div></div>'
    );
    const byId = (id: string) => win.document.getElementById(id);
    const screen = { left: 0, top: 0, width: 1000, height: 800 };
    place(byId('dialog'), screen);
    place(byId('stage'), screen);
    place(byId('reel'), screen);
    place(byId('before'), { left: -700, top: 200, width: 400, height: 300 });
    place(byId('shown'), { left: 300, top: 200, width: 400, height: 300 });
    place(byId('after'), { left: 1300, top: 200, width: 400, height: 300 });
    // The feed's own picture and video, under the viewer at the same place.
    place(byId('feed'), { left: 250, top: 150, width: 500, height: 400 });
    place(byId('feed-video'), { left: 250, top: 150, width: 500, height: 400 });
    for (const id of ['before', 'shown', 'after', 'feed']) loaded(byId(id));
    listAtPoint(win, 'stage', 'dialog', 'feed-video', 'feed', 'post', 'root');
    return { win, byId };
  };

  it("finds the picture an image viewer shows, which doesn't take the pointer", async () => {
    const { win, byId } = viewer();
    const helper = install(win);
    rightClick(win, byId('stage'), { clientX: 500, clientY: 350 });
    expect(await helper.at(true)).toEqual({
      video: null,
      picture: { src: `${NODE_PICTURE}/pic-1`, loaded: true },
      link: null,
    });
    // Not loaded yet: there, but nothing to copy.
    loaded(byId('shown'), 0, 0);
    expect((await helper.at(true)).picture).toEqual({
      src: `${NODE_PICTURE}/pic-1`,
      loaded: false,
    });
    // Only on a spot Chromium named nothing at.
    expect((await helper.at(false)).picture).toBeNull();
  });

  it("never finds the feed's picture or video the viewer hides", async () => {
    const { win, byId } = viewer();
    const helper = install(win);
    // The viewer's black stage, beside its picture: over the feed's.
    rightClick(win, byId('stage'), { clientX: 270, clientY: 170 });
    expect(await helper.at(true)).toEqual({
      video: null,
      picture: null,
      link: null,
    });
    expect(helper.videoFrame()).toBeNull();
    expect(await helper.pictureInPicture(true)).toBe(false);
  });

  it('finds none of it where it is invisible or cut off, or under what was right-clicked', async () => {
    const { win, byId } = viewer();
    const helper = install(win);
    const shown = byId('shown') as HTMLImageElement;
    const found = async (on = 'stage') => {
      rightClick(win, byId(on), { clientX: 500, clientY: 350 });
      return (await helper.at(true)).picture;
    };
    shown.style.visibility = 'hidden';
    expect(await found()).toBeNull();
    shown.style.visibility = '';
    byId('reel').style.opacity = '0';
    expect(await found()).toBeNull();
    byId('reel').style.opacity = '';
    // The stage cuts the picture off where it sticks out of it.
    place(byId('stage'), { left: 0, top: 0, width: 450, height: 800 });
    expect(await found()).toBeNull();
    place(byId('stage'), { left: 0, top: 0, width: 1000, height: 800 });
    // A window of another part of the page, over the viewer's picture.
    win.document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="sheet" style="background-color: rgb(255, 255, 255)"></div>'
    );
    place(byId('sheet'), { left: 400, top: 300, width: 200, height: 100 });
    listAtPoint(win, 'sheet', 'stage', 'dialog');
    expect(await found('sheet')).toBeNull();
    listAtPoint(win, 'stage', 'dialog');
    expect(await found()).toMatchObject({ src: `${NODE_PICTURE}/pic-1` });
  });

  it('takes one that takes the pointer only where Chromium lists it', async () => {
    // Its box holds the point, but Chromium lists it only where it is shown
    // (here something cuts it off another way).
    const win = page(
      '<div id="card"><img id="picture" src="https://node.example/arbitrary/IMAGE/Publisher/pic-1"></div>'
    );
    const helper = install(win);
    const byId = (id: string) => win.document.getElementById(id);
    place(byId('card'), { left: 0, top: 0, width: 300, height: 200 });
    place(byId('picture'), { left: 0, top: 0, width: 300, height: 200 });
    listAtPoint(win, 'card');
    rightClick(win, byId('card'), { clientX: 100, clientY: 100 });
    expect((await helper.at(true)).picture).toBeNull();
    listAtPoint(win, 'picture', 'card');
    expect((await helper.at(true)).picture).not.toBeNull();
  });

  it('takes the last of two pictures shown there: it is drawn over the other', async () => {
    const { win, byId } = viewer();
    const helper = install(win);
    byId('shown').insertAdjacentHTML(
      'afterend',
      `<img id="sharp" style="pointer-events: none" src="${NODE_PICTURE}/pic-1-full">`
    );
    place(byId('sharp'), { left: 300, top: 200, width: 400, height: 300 });
    rightClick(win, byId('stage'), { clientX: 500, clientY: 350 });
    expect((await helper.at(true)).picture.src).toBe(
      `${NODE_PICTURE}/pic-1-full`
    );
  });

  it('finds a picture under a layer on it, and a video under its poster', async () => {
    const win = page(
      '<div id="card"><img id="picture" src="https://node.example/arbitrary/THUMBNAIL/Publisher/t-1">' +
        '<div id="shade"></div></div>' +
        '<div id="player"><video id="video"></video>' +
        '<div id="poster" style="background-color: rgb(0, 0, 0)">Play</div></div>'
    );
    const helper = install(win);
    const byId = (id: string) => win.document.getElementById(id);
    for (const id of ['card', 'picture', 'shade']) {
      place(byId(id), { left: 0, top: 0, width: 300, height: 200 });
    }
    for (const id of ['player', 'video', 'poster']) {
      place(byId(id), { left: 0, top: 300, width: 300, height: 200 });
    }
    listAtPoint(win, 'shade', 'picture', 'card');
    rightClick(win, byId('shade'), { clientX: 100, clientY: 100 });
    expect((await helper.at(true)).picture).toEqual({
      src: 'https://node.example/arbitrary/THUMBNAIL/Publisher/t-1',
      loaded: false,
    });
    listAtPoint(win, 'poster', 'video', 'player');
    Object.defineProperty(byId('video'), 'currentSrc', {
      configurable: true,
      value: 'https://node.example/arbitrary/VIDEO/Publisher/vid-1',
    });
    rightClick(win, byId('poster'), { clientX: 100, clientY: 400 });
    expect(await helper.at(true)).toMatchObject({
      video: { src: 'https://node.example/arbitrary/VIDEO/Publisher/vid-1' },
      picture: null,
    });
    // The video smaller than its player (black bars), the poster over all
    // of the player: still the player's own poster.
    place(byId('video'), { left: 0, top: 337, width: 300, height: 126 });
    expect((await helper.at(true)).video).not.toBeNull();
  });

  it('finds the video under its play button when its poster is a picture', async () => {
    // The poster is an <img> over the video, with a play button over both;
    // then the poster doesn't take the pointer, in the player's own layer.
    const win = page(
      '<div id="player"><video id="video"></video>' +
        '<img id="poster" src="https://node.example/arbitrary/THUMBNAIL/Publisher/vid-1">' +
        '<div id="layer"><img id="still" style="pointer-events: none" src="https://node.example/arbitrary/THUMBNAIL/Publisher/vid-1">' +
        '<button id="play">Play</button></div></div>'
    );
    const helper = install(win);
    const byId = (id: string) => win.document.getElementById(id);
    for (const id of ['player', 'video', 'poster', 'layer', 'still']) {
      place(byId(id), { left: 0, top: 0, width: 640, height: 360 });
    }
    place(byId('play'), { left: 280, top: 140, width: 80, height: 80 });
    Object.defineProperty(byId('video'), 'currentSrc', {
      configurable: true,
      value: 'https://node.example/arbitrary/VIDEO/Publisher/vid-1',
    });
    listAtPoint(win, 'play', 'layer', 'poster', 'video', 'player');
    rightClick(win, byId('play'), { clientX: 320, clientY: 180 });
    expect(await helper.at(true)).toMatchObject({
      video: { src: 'https://node.example/arbitrary/VIDEO/Publisher/vid-1' },
      picture: null,
    });
    listAtPoint(win, 'layer', 'video', 'player');
    rightClick(win, byId('layer'), { clientX: 100, clientY: 100 });
    expect(await helper.at(true)).toMatchObject({
      video: { src: 'https://node.example/arbitrary/VIDEO/Publisher/vid-1' },
      picture: null,
    });
  });

  it("never finds a picture under the app's own top bar or a panel it draws over the page", async () => {
    const win = page(
      '<div id="root"><header id="bar" style="background-color: rgb(255, 255, 255)">Opened-App</header>' +
        '<main id="feed">' +
        `<img id="first" src="${NODE_PICTURE}/pic-1">` +
        `<article id="post"><img id="picture" src="${NODE_PICTURE}/pic-2"></article>` +
        '</main>' +
        '<div id="panel" style="background-color: rgb(255, 255, 255)">Settings</div></div>'
    );
    const helper = install(win);
    const byId = (id: string) => win.document.getElementById(id);
    place(byId('root'), { left: 0, top: -600, width: 1000, height: 3000 });
    place(byId('feed'), { left: 0, top: -536, width: 1000, height: 2936 });
    place(byId('bar'), { left: 0, top: 0, width: 1000, height: 64 });
    // Scrolled partly under the bar.
    place(byId('first'), { left: 16, top: -20, width: 300, height: 200 });
    place(byId('post'), { left: 100, top: 300, width: 600, height: 400 });
    place(byId('picture'), { left: 100, top: 300, width: 600, height: 400 });
    place(byId('panel'), { left: 0, top: 0, width: 1000, height: 800 });
    listAtPoint(win, 'bar', 'first', 'feed', 'root');
    rightClick(win, byId('bar'), { clientX: 100, clientY: 30 });
    expect((await helper.at(true)).picture).toBeNull();
    for (const covered of ['first', 'picture']) {
      listAtPoint(win, 'panel', covered, 'feed', 'root');
      rightClick(win, byId('panel'), { clientX: 300, clientY: 400 });
      expect((await helper.at(true)).picture).toBeNull();
    }
  });

  it('never finds a picture under a layer of its own over the page, however it is drawn', async () => {
    // A sheet painted with a gradient (no background colour), and a dialog
    // drawn by a web component, whose own layers Chromium doesn't list.
    const win = page(
      '<div id="root"><article id="post">' +
        `<img id="picture" src="${NODE_PICTURE}/pic-1">` +
        '</article></div>' +
        '<div id="sheet" style="background-image: linear-gradient(rgb(16, 16, 32), rgb(32, 32, 64))">Profile</div>' +
        '<div id="dialog-host"></div>'
    );
    const helper = install(win);
    const byId = (id: string) => win.document.getElementById(id);
    const shadow = byId('dialog-host').attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<div id="overlay" style="background-color: rgb(0, 0, 0)"></div>';
    // A short page: the picture fills most of it.
    place(win.document.body, { left: 0, top: 0, width: 1000, height: 800 });
    place(byId('root'), { left: 0, top: 0, width: 1000, height: 800 });
    place(byId('post'), { left: 0, top: 0, width: 1000, height: 600 });
    place(byId('picture'), { left: 0, top: 0, width: 1000, height: 600 });
    place(byId('sheet'), { left: 0, top: 0, width: 1000, height: 800 });
    place(byId('dialog-host'), { left: 0, top: 0, width: 1000, height: 800 });
    listAtPoint(win, 'sheet', 'picture', 'post', 'root');
    rightClick(win, byId('sheet'), { clientX: 300, clientY: 300 });
    expect((await helper.at(true)).picture).toBeNull();
    listAtPoint(win, 'dialog-host', 'picture', 'post', 'root');
    rightClick(win, shadow.getElementById('overlay'), {
      clientX: 300,
      clientY: 300,
    });
    expect((await helper.at(true)).picture).toBeNull();
  });

  it('finds a picture behind the page only where nothing else was right-clicked', async () => {
    // A hero section: a picture behind a heading, which doesn't take the
    // pointer so the heading does.
    const win = page(
      '<section id="hero">' +
        `<img id="wallpaper" style="pointer-events: none" src="${NODE_PICTURE}/wallpaper">` +
        '<h1 id="heading">Welcome</h1></section>'
    );
    const helper = install(win);
    const byId = (id: string) => win.document.getElementById(id);
    place(byId('hero'), { left: 0, top: 0, width: 1000, height: 600 });
    place(byId('wallpaper'), { left: 0, top: 0, width: 1000, height: 600 });
    place(byId('heading'), { left: 100, top: 200, width: 800, height: 80 });
    listAtPoint(win, 'heading', 'hero');
    rightClick(win, byId('heading'), { clientX: 300, clientY: 240 });
    expect((await helper.at(true)).picture).toBeNull();
    // The hero's own empty part: the picture is what shows there.
    listAtPoint(win, 'hero');
    rightClick(win, byId('hero'), { clientX: 300, clientY: 450 });
    expect((await helper.at(true)).picture).toMatchObject({
      src: `${NODE_PICTURE}/wallpaper`,
    });
  });

  it('finds the picture of a viewer fixed over the window from inside a narrow column', async () => {
    // The column cuts off its own overflow, but not the fixed viewer in it.
    const win = page(
      '<div id="column" style="overflow: hidden">' +
        '<div id="stage" style="position: fixed">' +
        `<img id="shown" style="pointer-events: none" src="${NODE_PICTURE}/pic-1">` +
        '</div></div>'
    );
    const helper = install(win);
    const byId = (id: string) => win.document.getElementById(id);
    place(byId('column'), { left: 0, top: 0, width: 300, height: 3000 });
    place(byId('stage'), { left: 0, top: 0, width: 1000, height: 800 });
    place(byId('shown'), { left: 300, top: 200, width: 400, height: 300 });
    listAtPoint(win, 'stage');
    rightClick(win, byId('stage'), { clientX: 500, clientY: 350 });
    expect((await helper.at(true)).picture).toMatchObject({
      src: `${NODE_PICTURE}/pic-1`,
    });
  });

  it("finds one on the page's own empty spot, whatever <body>'s own box", async () => {
    // <body> has overflow: hidden (as a dialog library sets it) and a box
    // ending above the point: that overflow is the window's, not <body>'s.
    const win = page(
      `<img id="art" style="pointer-events: none" src="${NODE_PICTURE}/art">`
    );
    const helper = install(win);
    win.document.body.style.overflow = 'hidden';
    place(win.document.body, { left: 0, top: 0, width: 1000, height: 100 });
    place(win.document.getElementById('art'), {
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
    });
    listAtPoint(win);
    rightClick(win, win.document.body, { clientX: 300, clientY: 400 });
    expect((await helper.at(true)).picture).toMatchObject({
      src: `${NODE_PICTURE}/art`,
    });
  });

  it("finds a video that doesn't take the pointer", async () => {
    const win = page(
      '<div id="player"><video id="video" style="pointer-events: none"></video></div>'
    );
    const helper = install(win);
    const byId = (id: string) => win.document.getElementById(id);
    place(byId('player'), { left: 0, top: 0, width: 640, height: 360 });
    place(byId('video'), { left: 0, top: 0, width: 640, height: 360 });
    Object.defineProperty(byId('video'), 'currentSrc', {
      configurable: true,
      value: 'https://node.example/arbitrary/VIDEO/Publisher/vid-1',
    });
    listAtPoint(win, 'player');
    rightClick(win, byId('player'), { clientX: 320, clientY: 180 });
    expect((await helper.videoAt())?.src).toBe(
      'https://node.example/arbitrary/VIDEO/Publisher/vid-1'
    );
  });

  describe('picture', () => {
    const drawn = (win: TestWindow) => {
      const drawImage = vi.fn();
      const sizes: [number, number][] = [];
      vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage,
      } as never);
      vi.spyOn(win.HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
        function (this: HTMLCanvasElement) {
          sizes.push([this.width, this.height]);
          return 'data:image/png;base64,AAAA';
        }
      );
      return { drawImage, sizes };
    };

    it('draws the picture the menu was opened for at its own size', async () => {
      const { win, byId } = viewer();
      const helper = install(win);
      const { drawImage, sizes } = drawn(win);
      // No menu with a picture yet.
      expect(helper.picture()).toBeNull();
      rightClick(win, byId('stage'), { clientX: 500, clientY: 350 });
      await helper.at(true);
      expect(helper.picture()).toEqual({ png: 'data:image/png;base64,AAAA' });
      expect(drawImage.mock.calls[0][0]).toBe(byId('shown'));
      expect(sizes).toEqual([[1600, 1200]]);
      // Bigger than 4K: made smaller.
      loaded(byId('shown'), 7680, 4320);
      helper.picture();
      expect(sizes[1]).toEqual([3840, 2160]);
    });

    it("gives the picture's box when it can't be read or hasn't loaded", async () => {
      const { win, byId } = viewer();
      const helper = install(win);
      vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
      } as never);
      vi.spyOn(win.HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
        () => {
          throw new Error('SecurityError: tainted canvas');
        }
      );
      rightClick(win, byId('stage'), { clientX: 500, clientY: 350 });
      await helper.at(true);
      const where = {
        box: { x: 300, y: 200, width: 400, height: 300 },
        viewport: { width: win.innerWidth, height: win.innerHeight },
      };
      expect(helper.picture()).toEqual(where);
      loaded(byId('shown'), 0, 0);
      expect(helper.picture()).toEqual(where);
    });

    it('copies nothing once the picture changed, left the page, or another right-click came', async () => {
      const { win, byId } = viewer();
      const helper = install(win);
      drawn(win);
      const shown = byId('shown') as HTMLImageElement;
      rightClick(win, byId('stage'), { clientX: 500, clientY: 350 });
      await helper.at(true);
      shown.src = `${NODE_PICTURE}/pic-2`;
      expect(helper.picture()).toBeNull();
      shown.src = `${NODE_PICTURE}/pic-1`;
      expect(helper.picture()).not.toBeNull();
      // A new right-click: its own menu, with no picture asked about yet.
      rightClick(win, byId('stage'), { clientX: 500, clientY: 350 });
      expect(helper.picture()).toBeNull();
      await helper.at(true);
      shown.remove();
      expect(helper.picture()).toBeNull();
    });
  });
});

describe('a link the app shows outside an <a>', () => {
  it('reads a link put on the element, or on one it is in', async () => {
    const win = page(
      '<article data-qortal-link="qortal://APP/Opened-App/post/1">' +
        '<p>Post text</p>' +
        '<button data-clipboard-text="qortal://use-embed/IMAGE?name=Publisher&amp;identifier=pic-1">Share</button>' +
        '<button data-href="not a link">Like</button>' +
        '</article>'
    );
    const helper = install(win);
    rightClick(win, win.document.querySelector('p'));
    expect((await helper.at(false)).link).toBe(
      'qortal://APP/Opened-App/post/1'
    );
    rightClick(win, win.document.querySelector('button'));
    expect((await helper.at(false)).link).toBe(
      'qortal://use-embed/IMAGE?name=Publisher&identifier=pic-1'
    );
    // Not a whole link: the next element out is asked.
    rightClick(win, win.document.querySelectorAll('button')[1]);
    expect((await helper.at(false)).link).toBe(
      'qortal://APP/Opened-App/post/1'
    );
  });

  it("reads a card's link from inside a component's shadow root", async () => {
    // A post card whose Share button is drawn by a web component.
    const win = page(
      '<article data-qortal-link="qortal://APP/Opened-App/post/1">' +
        '<share-button id="share"></share-button></article>'
    );
    const helper = install(win);
    const shadow = win.document
      .getElementById('share')
      .attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Share</button>';
    rightClick(win, shadow.querySelector('button'));
    expect((await helper.at(false)).link).toBe(
      'qortal://APP/Opened-App/post/1'
    );
  });

  it("reads the link of an <a> that has none in its href (SubWire's)", async () => {
    const win = page(
      '<a data-qortal-href="qortal://APP/Opened-App/article/1">Article</a>'
    );
    const helper = install(win);
    rightClick(win, win.document.querySelector('a'));
    expect((await helper.at(false)).link).toBe(
      'qortal://APP/Opened-App/article/1'
    );
  });

  it('reads a box that shows one link (a share window)', async () => {
    const win = page(
      '<input readonly value="qortal://APP/Opened-App/post/1">' +
        '<input value="see qortal://APP/Opened-App">'
    );
    const helper = install(win);
    const [shared, typed] = win.document.querySelectorAll('input');
    rightClick(win, shared);
    expect((await helper.at(false)).link).toBe(
      'qortal://APP/Opened-App/post/1'
    );
    rightClick(win, typed);
    expect((await helper.at(false)).link).toBeNull();
  });

  it('reads a link written as text under the pointer, without the sentence end', async () => {
    const win = page(
      '<p>Watch qortal://APP/Q-Tube/video/Publisher/vid-1. Or https://example.org/a, then.</p>'
    );
    const helper = install(win);
    const text = win.document.querySelector('p').firstChild as Text;
    let offset = 0;
    // jsdom lays nothing out: the text and the place in it under the point.
    Object.defineProperty(win.document, 'caretRangeFromPoint', {
      configurable: true,
      value: () => ({ startContainer: text, startOffset: offset }),
    });
    offset = text.data.indexOf('video');
    rightClick(win, win.document.querySelector('p'));
    expect((await helper.at(false)).link).toBe(
      'qortal://APP/Q-Tube/video/Publisher/vid-1'
    );
    offset = text.data.indexOf('example');
    expect((await helper.at(false)).link).toBe('https://example.org/a');
    offset = text.data.indexOf('Or');
    expect((await helper.at(false)).link).toBeNull();
  });

  it('answers the video too when asked', async () => {
    const win = page('<p>Text</p>');
    const helper = install(win);
    rightClick(win, win.document.querySelector('p'));
    expect(await helper.at(true)).toEqual({
      video: null,
      picture: null,
      link: null,
    });
  });
});

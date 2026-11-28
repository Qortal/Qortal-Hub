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
      name: null,
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
      name: null,
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
      name: null,
    });
  });
});

describe('a Qortal name or address the app shows', () => {
  const NODE = 'http://127.0.0.1:12391';
  /** A page from the node, as an app's is (its pictures load from there). */
  const nodePage = (html: string) =>
    new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
      url: `${NODE}/render/APP/Opened-App`,
    }).window as unknown as TestWindow;
  const avatar = (name: string) =>
    `<img src="/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar?async=true">`;
  /** Shaped as an address: main checks the rest. */
  const ADDRESS = 'QPubsherAddrxyz123456789ABCDEFGHJK';

  /** jsdom lays nothing out: the text and the place in it under the point. */
  const pointAt = (win: TestWindow, text: Node, offset: number) =>
    Object.defineProperty(win.document, 'caretRangeFromPoint', {
      configurable: true,
      value: () => ({ startContainer: text, startOffset: offset }),
    });

  const helpers = new WeakMap<TestWindow, ReturnType<typeof install>>();
  /** What the menu gets for a right-click on `element` at `text`'s offset. */
  const nameAt = async (
    win: TestWindow,
    element: Element,
    offset = 1,
    text: Node = element.firstChild
  ) => {
    if (!helpers.has(win)) helpers.set(win, install(win));
    const helper = helpers.get(win);
    pointAt(win, text, offset);
    rightClick(win, element);
    return (await helper.at(false)).name;
  };

  it('reads a name or address the app puts on the element, or on one it is in', async () => {
    const win = nodePage(
      '<li data-qortal-name="Publisher Name"><span>A row</span></li>' +
        `<li data-qortal-address="${ADDRESS}"><span>Another</span></li>`
    );
    const [first, second] = win.document.querySelectorAll('span');
    expect(await nameAt(win, first)).toEqual({
      kind: 'name',
      value: 'Publisher Name',
    });
    expect(await nameAt(win, second)).toEqual({
      kind: 'address',
      value: ADDRESS,
    });
  });

  it('reads a name written beside its profile picture, also as @name and in a sentence', async () => {
    const win = nodePage(
      '<article><header>' +
        avatar('Publisher Name') +
        '<div><span id="name">Publisher Name</span>' +
        '<span id="handle">@publisher name</span></div></header>' +
        '<p id="body">Posted by Publisher Name, not Publisher Namesake.</p>' +
        '</article>'
    );
    const byId = (id: string) => win.document.getElementById(id);
    const named = { kind: 'name', value: 'Publisher Name' };
    expect(await nameAt(win, byId('name'), 3)).toEqual(named);
    expect(await nameAt(win, byId('handle'), 3)).toEqual(named);
    const sentence = byId('body').textContent;
    expect(
      await nameAt(win, byId('body'), sentence.indexOf('Publisher') + 2)
    ).toEqual(named);
    // Elsewhere in the sentence, and inside a longer word: no name.
    expect(await nameAt(win, byId('body'), 1)).toBeNull();
    expect(
      await nameAt(win, byId('body'), sentence.indexOf('Namesake') + 2)
    ).toBeNull();
  });

  it('takes no text for a name without its profile picture close by', async () => {
    // Most short words are registered names: text alone isn't one.
    const alone = nodePage('<button>Reply</button>');
    expect(await nameAt(alone, alone.document.querySelector('button'))).toBe(
      null
    );
    // The picture further out than the row or card holding the text.
    const far = nodePage(
      `<section>${avatar('Share')}<div><div><div><div><div>` +
        '<b>Share</b></div></div></div></div></div></section>'
    );
    expect(await nameAt(far, far.document.querySelector('b'))).toBeNull();
    // Another site's picture, or another picture of the name.
    const other = nodePage(
      '<div><img src="http://127.0.0.1:9999/arbitrary/THUMBNAIL/Publisher/qortal_avatar">' +
        '<img src="/arbitrary/THUMBNAIL/Publisher/pic-1"><b>Publisher</b></div>'
    );
    expect(await nameAt(other, other.document.querySelector('b'))).toBeNull();
  });

  it('reads an address written as text under the pointer', async () => {
    const win = nodePage(
      `<p id="sent">Sent to ${ADDRESS} today</p>` +
        `<p id="longer">Signature 2${ADDRESS}</p>`
    );
    const sent = win.document.getElementById('sent');
    const at = sent.textContent.indexOf(ADDRESS);
    expect(await nameAt(win, sent, at + 5)).toEqual({
      kind: 'address',
      value: ADDRESS,
    });
    expect(await nameAt(win, sent, 1)).toBeNull();
    // Part of a longer run of the same letters (a signature) isn't one.
    const longer = win.document.getElementById('longer');
    expect(
      await nameAt(win, longer, longer.textContent.indexOf(ADDRESS) + 5)
    ).toBeNull();
  });

  it('reads the name of a link laid over its card, picture and all', async () => {
    // As Q-Mintership+ shows people: the name's link has a layer (::after)
    // stretched over the whole card, so a right-click on the picture or the
    // name lands on the link, with no text under the pointer.
    const win = nodePage(
      '<div>' +
        `<span data-avatar>${avatar('Publisher')}</span>` +
        '<div><span><a id="link" href="/render/APP/Opened-App/account/1">' +
        '<span>Publisher</span></a></span></div></div>' +
        `<div>${avatar('Publisher Name')}` +
        '<a id="answered" href="/render/APP/Opened-App/vote/2">' +
        '<span>Publisher Name</span><span>(answered)</span></a></div>'
    );
    const byId = (id: string) => win.document.getElementById(id);
    expect(await nameAt(win, byId('link'), 0, byId('link'))).toEqual({
      kind: 'name',
      value: 'Publisher',
    });
    // The name and a word or two.
    expect(await nameAt(win, byId('answered'), 0, byId('answered'))).toEqual({
      kind: 'name',
      value: 'Publisher Name',
    });
  });

  it("reads a label's address, but no label with two names, nor a long one", async () => {
    const win = nodePage(
      `<a id="address" href="/render/APP/Opened-App/1">${ADDRESS}</a>` +
        `<div>${avatar('Publisher')}${avatar('Other Name')}` +
        '<a id="both" href="/render/APP/Opened-App/2">Publisher and Other Name</a></div>' +
        `<div>${avatar('Publisher')}` +
        `<a id="long" href="/render/APP/Opened-App/3">Publisher ${'wrote a long post. '.repeat(5)}</a></div>`
    );
    const byId = (id: string) => win.document.getElementById(id);
    const onLayer = (id: string) => nameAt(win, byId(id), 0, byId(id));
    expect(await onLayer('address')).toEqual({
      kind: 'address',
      value: ADDRESS,
    });
    expect(await onLayer('both')).toBeNull();
    expect(await onLayer('long')).toBeNull();
  });

  it("reads no name from what is typed, nor a long card's text away from the pointer", async () => {
    const win = nodePage(
      `<div id="row">${avatar('Publisher')}` +
        '<div id="typed" contenteditable="true">Publisher</div></div>' +
        `<article id="card">${avatar('Publisher')}` +
        `<p>${'A long post about the network. '.repeat(4)}</p>` +
        '<span id="name">Publisher</span></article>'
    );
    const byId = (id: string) => win.document.getElementById(id);
    expect(await nameAt(win, byId('typed'))).toBeNull();
    // The row beside the typed text: its own text is only what's typed.
    expect(await nameAt(win, byId('row'), 0, byId('row'))).toBeNull();
    // The card right-clicked away from its text: the caret's nearest text
    // is the name, but the pointer isn't on it, and the card is no label.
    expect(
      await nameAt(win, byId('card'), 1, byId('name').firstChild)
    ).toBeNull();
  });

  it('reads the longest name written there, the same on the text as beside it', async () => {
    // "Publisher mentioned Publisher Name", both people's pictures in the
    // header: the second text is all of "Publisher Name".
    const win = nodePage(
      `<header>${avatar('Publisher')}<span>Publisher</span> mentioned ` +
        `${avatar('Publisher Name')}<span id="second">Publisher Name</span></header>` +
        `<div>${avatar('Publisher')}${avatar('Publisher Name')}` +
        '<a id="answered" href="/render/APP/Opened-App/vote/2">' +
        '<span>Publisher Name</span><span>(answered)</span></a></div>' +
        `<div>${avatar('Publisher')}${avatar('Publisher Name')}` +
        '<a id="both" href="/render/APP/Opened-App/vote/3">' +
        'Publisher and Publisher Name</a></div>' +
        `<p>${avatar('Publisher')}${avatar('Publisher Name')}` +
        '<span id="thanks">Thanks to Publisher Name for this</span></p>'
    );
    const byId = (id: string) => win.document.getElementById(id);
    const named = { kind: 'name', value: 'Publisher Name' };
    expect(await nameAt(win, byId('second'), 2)).toEqual(named);
    // In a sentence, on the part both names share: the longer one.
    expect(await nameAt(win, byId('thanks'), 'Thanks to Pub'.length)).toEqual(
      named
    );
    expect(await nameAt(win, byId('second'), 0, byId('second'))).toEqual(named);
    // In a label, a name that is only part of a longer one written there
    // doesn't count; two names written apart say nothing about which one.
    expect(await nameAt(win, byId('answered'), 0, byId('answered'))).toEqual(
      named
    );
    expect(await nameAt(win, byId('both'), 0, byId('both'))).toBeNull();
  });

  it('takes no name inside a longer one: joined by _ or -, before a vowel sign, beside a long character, or across a highlight', async () => {
    const win = nodePage(
      `<ul><li>${avatar('Publisher')}<span>Publisher</span>` +
        '<span id="under">Publisher_2</span><span id="dash">Publisher-Two</span>' +
        '<span id="sentence">Thanks, Publisher.</span></li></ul>' +
        `<ul><li>${avatar('\u0930\u093e\u092e')}` +
        '<span id="vowel">\u0930\u093e\u092e\u093e</span></li></ul>' +
        `<ul><li>${avatar('\u91ce\u5bb6')}` +
        '<span id="long">\u{20bb7}\u91ce\u5bb6</span>' +
        '<span id="longAfter">\u91ce\u5bb6\u{20bb7}</span></li></ul>' +
        `<ul><li>${avatar('Pub')}${avatar('Publisher')}` +
        '<a href="/render/APP/Opened-App/1"><b id="hit">Pub</b>lisher</a></li></ul>'
    );
    const byId = (id: string) => win.document.getElementById(id);
    expect(await nameAt(win, byId('under'), 3)).toBeNull();
    expect(await nameAt(win, byId('dash'), 3)).toBeNull();
    // A sentence's punctuation ends a word.
    expect(await nameAt(win, byId('sentence'), 10)).toEqual({
      kind: 'name',
      value: 'Publisher',
    });
    // रामा (a vowel sign at its end) is another name than राम.
    expect(await nameAt(win, byId('vowel'), 1)).toBeNull();
    // 𠮷 is one character written as two UTF-16 units.
    expect(await nameAt(win, byId('long'), 3)).toBeNull();
    expect(await nameAt(win, byId('longAfter'), 1)).toBeNull();
    // "Pub" bolded inside "Publisher" (a search highlight) is no "Pub".
    expect(await nameAt(win, byId('hit'), 1)).toBeNull();
  });

  it("doesn't reach past one person's row for a name (a chat, a list)", async () => {
    const win = nodePage(
      `<ul><li>${avatar('Bitcoin')}<div><span>Bitcoin</span><p>gm</p></div></li>` +
        `<li>${avatar('Reply')}<div><span>Reply</span><p>hi</p></div></li>` +
        `<li>${avatar('Publisher')}<div><span>Publisher</span>` +
        '<p id="message">I sold some Bitcoin today</p>' +
        '<button id="reply">Reply</button></div></li>' +
        // A person with no picture loaded: the letter in its place.
        '<li><span data-avatar>B</span><div><p id="letter">Bitcoin</p></div></li></ul>'
    );
    const byId = (id: string) => win.document.getElementById(id);
    const message = byId('message');
    const at = message.textContent.indexOf('Bitcoin') + 2;
    expect(await nameAt(win, message, at)).toBeNull();
    expect(await nameAt(win, byId('reply'), 2)).toBeNull();
    expect(await nameAt(win, byId('letter'), 2)).toBeNull();
  });

  it('looks past a hidden place for a picture (a copy for another layout)', async () => {
    // As Torq keeps a letter avatar in a display: none part beside the name,
    // one level below the shown picture.
    const win = nodePage(
      `<section>${avatar('Publisher')}<div>` +
        '<div><span class="MuiAvatar-root" id="hidden">P</span></div>' +
        '<div><div><b id="name">Publisher</b></div></div></div></section>'
    );
    const byId = (id: string) => win.document.getElementById(id);
    Object.defineProperty(byId('hidden'), 'checkVisibility', {
      value: () => false,
    });
    expect(await nameAt(win, byId('name'))).toEqual({
      kind: 'name',
      value: 'Publisher',
    });
  });

  it('finds the picture four elements out from the text, not five', async () => {
    const nested = (depth: number, id: string) =>
      `<section>${avatar('Publisher')}` +
      '<div>'.repeat(depth - 1) +
      `<b id="${id}">Publisher</b>` +
      '</div>'.repeat(depth - 1) +
      '</section>';
    const win = nodePage(nested(4, 'four') + nested(5, 'five'));
    const byId = (id: string) => win.document.getElementById(id);
    expect(await nameAt(win, byId('four'))).toEqual({
      kind: 'name',
      value: 'Publisher',
    });
    expect(await nameAt(win, byId('five'))).toBeNull();
  });

  it('takes a name shown under the pointer before one put on an element further out', async () => {
    const win = nodePage(
      `<article data-qortal-name="Publisher">${avatar('Publisher')}<span>Publisher</span>` +
        `<p>Thanks to ${avatar('Other Name')}<span id="mention">Other Name</span>, again</p>` +
        '<p id="plain">A post</p>' +
        '<b id="marked" data-qortal-name="Marked Name">Other Name</b></article>'
    );
    const byId = (id: string) => win.document.getElementById(id);
    expect(await nameAt(win, byId('mention'), 2)).toEqual({
      kind: 'name',
      value: 'Other Name',
    });
    // Nothing written there: the post's own name.
    expect(await nameAt(win, byId('plain'), 2)).toEqual({
      kind: 'name',
      value: 'Publisher',
    });
    // Put on the element right-clicked itself: that comes first.
    expect(await nameAt(win, byId('marked'), 2)).toEqual({
      kind: 'name',
      value: 'Marked Name',
    });
  });

  it("reads an element's own text no further than a label can be, typed text too", async () => {
    const win = nodePage(
      `<div id="frame"><div contenteditable="true">${'<p>typed</p>'.repeat(3_000)}</div></div>`
    );
    const original = win.document.createTreeWalker.bind(win.document);
    let visited = 0;
    win.document.createTreeWalker = ((
      ...args: Parameters<Document['createTreeWalker']>
    ) => {
      const walker = original(...args);
      const next = walker.nextNode.bind(walker);
      walker.nextNode = () => {
        visited += 1;
        return next();
      };
      return walker;
    }) as Document['createTreeWalker'];
    const frame = win.document.getElementById('frame');
    expect(await nameAt(win, frame, 0, frame)).toBeNull();
    // 80 characters at most (320 read), not all 3,000 pieces.
    expect(visited).toBeLessThan(100);
  });
});

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
    // jsdom lays nothing out: what is under the point, top first.
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
    expect(await helper.at(true)).toEqual({ video: null, link: null });
  });
});

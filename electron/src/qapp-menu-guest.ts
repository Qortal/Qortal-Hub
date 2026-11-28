/**
 * The app's side of the right-click menu (qapp-context-menu.ts). The app's
 * preload runs it in its isolated world, where the page can't see or call it.
 *
 * It notes the element of each real right-click, for the menu's items that
 * act on that element (copy its description, a picture, a video's frame,
 * picture in picture), and lets Shift+right-click reach Hub's menu in an app
 * that has a menu of its own. Main calls it with
 * executeJavaScriptInIsolatedWorld. What it answers comes from the page, so
 * main checks it.
 */
import {
  QAPP_MENU_GUEST_KEY,
  type QAppElementBox,
  type QAppElementInfo,
  type QAppFoundAt,
  type QAppMenuGuestHelper,
  type QAppNameAt,
  type QAppPictureAt,
  type QAppPixels,
  type QAppVideoAt,
} from './qapp-context-menu-types';

/** An element's HTML is cut after this many characters. */
export const MAX_ELEMENT_HTML = 3_000;
const MAX_NAME = 80;
const MAX_TITLE = 120;
const MAX_SELECTOR_PARTS = 8;
/** An element with more inside it is copied without what's inside. */
export const MAX_COPIED_ELEMENTS = 2_000;
/** A picture or video frame bigger than 4K is copied smaller. */
const MAX_FRAME_PIXELS = 3840 * 2160;
/**
 * A picture's or video's address longer than this (a big data: one) isn't
 * handed over.
 */
const MAX_MEDIA_SRC = 1_000_000;
/**
 * A picture or video under the element right-clicked counts when it fills
 * at least this much of the nearest element holding both (see sameFrame).
 */
const FRAME_SHARE = 0.5;
/** A link longer than this isn't one. */
const MAX_LINK = 4_096;
/**
 * Where apps put a link on an element that isn't an <a>: Hub's own
 * data-qortal-link (Subscreen uses it), data-qortal-href (SubWire's links
 * with no href), data-url (Q-Tube's), and the usual data-href, data-link and
 * copy-button data-clipboard-text. Their values count only when they are
 * whole links.
 */
const LINK_ATTRIBUTES = [
  'data-qortal-link',
  'data-qortal-href',
  'data-url',
  'data-href',
  'data-link',
  'data-clipboard-text',
];
const WHOLE_LINK = /^(qortal:\/\/|https?:\/\/)\S+$/i;
/** Links written as text. */
const LINK_IN_TEXT = /(?:qortal:\/\/|https?:\/\/)[^\s<>"'`]+/gi;
/** A sentence's punctuation after a link written as text. */
const AFTER_LINK = /[),.;:!?'"\]]+$/;
/**
 * Where an app puts the Qortal name or address an element stands for (a
 * user's row, a post's author), for the menu's "Look up": Hub's own
 * data-qortal-name and data-qortal-address.
 */
const NAME_ATTRIBUTES: [string, QAppNameAt['kind']][] = [
  ['data-qortal-name', 'name'],
  ['data-qortal-address', 'address'],
];
/** A name or address put on an element longer than this isn't one. */
const MAX_NAME_VALUE = 200;
/**
 * A name's profile picture, /arbitrary/THUMBNAIL/<name>/qortal_avatar: the
 * address apps load it from (Core's GET_QDN_RESOURCE_URL gives the same).
 */
const AVATAR_PATH = /^\/arbitrary\/THUMBNAIL\/([^/]+)\/qortal_avatar$/;
/**
 * How many elements out from a name written as text the profile picture of
 * that name is looked for in: the row, card or header holding both.
 */
const NAME_HOLDERS = 4;
/** Pictures read at most for their names (a long feed has many). */
const MAX_AVATARS_READ = 500;
/**
 * Where a person's picture goes even when none is loaded (the letter shown
 * instead): MUI's Avatar, and Q-Mintership+'s data-avatar.
 */
const AVATAR_PLACES = '[data-avatar], .MuiAvatar-root';
/**
 * Elements that mark part of a word (a search highlight): text on either
 * side of one is the same word. Other pieces of a line can sit apart on
 * screen (a margin), so they are taken as words of their own.
 */
const HIGHLIGHTS = 'b, strong, em, i, mark, u';
/** An address written as text: Q and 33 more base58 characters. */
const ADDRESS_IN_TEXT =
  /(?<![1-9A-HJ-NP-Za-km-z])Q[1-9A-HJ-NP-Za-km-z]{33}(?![1-9A-HJ-NP-Za-km-z])/g;
/**
 * What a word goes on with: a letter, a digit, a mark (a vowel sign), or _
 * and -, which join names. A name inside a longer word isn't that name.
 */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}_-]/u;
/** An element's own text longer than this is no label for a name. */
const MAX_LABEL_TEXT = 80;
/** NodeFilter.SHOW_TEXT. */
const SHOW_TEXT = 4;

/** The whole character (code point) before `index` in a text, or ''. */
function characterBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text.charAt(index - 1);
}

/** The whole character (code point) at `index` in a text, or ''. */
function characterAt(text: string, index: number): string {
  const code = text.codePointAt(index);
  return code === undefined ? '' : String.fromCodePoint(code);
}

/**
 * Where a name is written in a text as a whole word, not inside one. At the
 * text's own ends, `before` and `after` are the characters next to it on the
 * page (another piece of the same line, as around a highlight).
 */
function wordsOf(
  text: string,
  name: string,
  before = '',
  after = ''
): number[] {
  const found: number[] = [];
  if (!name) return found;
  for (
    let from = text.indexOf(name);
    from >= 0;
    from = text.indexOf(name, from + 1)
  ) {
    const to = from + name.length;
    const left = from === 0 ? before : characterBefore(text, from);
    const right = to === text.length ? after : characterAt(text, to);
    if (!WORD_CHARACTER.test(left) && !WORD_CHARACTER.test(right)) {
      found.push(from);
    }
  }
  return found;
}
/** Text read around the pointer for a link written there. */
const TEXT_AROUND = 2_000;
const TEXT_NODE = 3;
/** Readable class names only: generated ones (css-1x2y3z) say nothing. */
const READABLE_CLASS = /^[A-Za-z_][\w-]*$/;
const GENERATED_CLASS = /^(css|jss|sc|emotion)-|^jss\d|\d{4,}/i;
const DOCUMENT_FRAGMENT_NODE = 11;
/** A colour that shows nothing: rgba(…, 0). */
const CLEAR_COLOR = /^rgba\([^)]*,\s*0\)$/;

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const oneLine = (text: unknown) =>
  typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';

const rounded = (rect: DOMRect) => ({
  x: Math.round(rect.left),
  y: Math.round(rect.top),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
});

/** Inside a part of the page typed into (contenteditable). */
function inEditableArea(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = node.getAttribute('contenteditable');
    if (value !== null) return value.toLowerCase() !== 'false';
  }
  return false;
}

/** A field whose text the user types (or picks). */
const isField = (element: Element) =>
  ['input', 'textarea', 'select'].includes(element.localName) ||
  inEditableArea(element);

/**
 * What the element says or is called; never what was typed into it, and not
 * the text of a large part of the page (it would take long to read).
 */
function nameOf(element: Element, large: boolean): string {
  for (const attribute of ['aria-label', 'alt', 'title', 'placeholder']) {
    const value = oneLine(element.getAttribute(attribute));
    if (value) return cut(value, MAX_NAME);
  }
  if (large || isField(element)) return '';
  const text = (element as HTMLElement).innerText ?? element.textContent;
  return cut(oneLine(text), MAX_NAME);
}

/** The element's place in the page, as a CSS selector. */
export function selectorOf(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && parts.length < MAX_SELECTOR_PARTS) {
    if (node.id && READABLE_CLASS.test(node.id)) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const classes = [...node.classList]
      .filter(
        (name) => READABLE_CLASS.test(name) && !GENERATED_CLASS.test(name)
      )
      .slice(0, 2);
    let part = node.localName + classes.map((name) => `.${name}`).join('');
    const parent = node.parentElement;
    if (parent) {
      const same = [...parent.children].filter(
        (child) => child.localName === node.localName
      );
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    if (node.localName === 'body' || node.localName === 'html') break;
    node = holderOf(node);
  }
  return parts.join(' > ');
}

/**
 * The element an element is in: its parent, or out of a shadow root (a
 * document fragment), the element holding it.
 */
function holderOf(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root.nodeType === DOCUMENT_FRAGMENT_NODE
    ? ((root as ShadowRoot).host ?? null)
    : null;
}

type Box = { left: number; top: number; right: number; bottom: number };

const boxOf = (element: Element): Box => {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  };
};

const holds = (box: Box, x: number, y: number) =>
  x >= box.left && x < box.right && y >= box.top && y < box.bottom;

/** Whether an element cuts off what sticks out of its box. */
const clipsOverflow = (style: CSSStyleDeclaration) =>
  [style.overflow, style.overflowX, style.overflowY]
    .join(' ')
    .split(/\s+/)
    .some((value) => value !== '' && value !== 'visible');

/** The colour behind the element: its own, or the nearest one under it. */
function backgroundOf(element: Element, win: Window): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = win.getComputedStyle(node).backgroundColor;
    if (color && color !== 'transparent' && !CLEAR_COLOR.test(color)) {
      return color;
    }
  }
  return '';
}

/**
 * The element's HTML, without what was typed into it: no field's value
 * (React writes a field's text into its value attribute), no text area's or
 * editable part's text. Copied into a page of its own, so none of the app's
 * code runs for the copy.
 */
function htmlOf(
  element: Element,
  large: boolean,
  win: Window
): { html: string; cut: boolean } {
  const doc = win.document.implementation.createHTMLDocument('');
  const copy = doc.importNode(element, !large) as Element;
  const fields = [copy, ...copy.querySelectorAll('*')];
  for (const node of fields) {
    if (node.localName === 'input') node.removeAttribute('value');
    if (node.localName === 'textarea') node.textContent = '';
    const editable = node.getAttribute('contenteditable');
    if (editable !== null && editable.toLowerCase() !== 'false') {
      node.replaceChildren();
    }
  }
  if (inEditableArea(element)) copy.replaceChildren();
  if (large) copy.append(doc.createComment(' … '));
  const html = copy.outerHTML;
  return {
    html:
      html.length > MAX_ELEMENT_HTML ? html.slice(0, MAX_ELEMENT_HTML) : html,
    cut: large || html.length > MAX_ELEMENT_HTML,
  };
}

type GuestOptions = {
  /** Whether a right-click came from the user (tests stand in for it). */
  isTrusted?: (event: Event) => boolean;
};

/**
 * Notes each right-click's element, and sets the helper main calls on the
 * window of this (isolated) world.
 */
export function installQAppMenuGuest(
  win: Window & typeof globalThis = window,
  { isTrusted = (event) => event.isTrusted }: GuestOptions = {}
): QAppMenuGuestHelper {
  let last: Element | null = null;
  // Where it was right-clicked, in the page's CSS pixels.
  let point = { x: 0, y: 0 };
  // The picture the latest right-click's menu was opened for (see at()),
  // with the address it had then.
  let offered: { picture: HTMLImageElement; src: string } | null = null;
  win.addEventListener(
    'contextmenu',
    (event) => {
      // A page's own made-up right-click changes nothing.
      if (!isTrusted(event)) return;
      const target = event.composedPath()[0];
      last = target instanceof win.Element ? target : null;
      point = { x: event.clientX, y: event.clientY };
      offered = null;
      // Shift+right-click: Hub's menu, even where the app has its own.
      if ((event as MouseEvent).shiftKey) event.stopImmediatePropagation();
    },
    true
  );
  // The element right-clicked last, while it is still on the page.
  const element = () => (last?.isConnected ? last : null);
  const viewport = () => ({ width: win.innerWidth, height: win.innerHeight });

  type Media = HTMLImageElement | HTMLVideoElement;
  const isMedia = (node: unknown): node is Media =>
    node instanceof win.HTMLImageElement ||
    node instanceof win.HTMLVideoElement;

  const pageEdge = (node: Element) =>
    node === win.document.body || node === win.document.documentElement;

  /**
   * Whether a picture or video in the element right-clicked that doesn't
   * take the pointer (as an image viewer's picture, which the viewer moves
   * itself) is shown at the point: its box holds the point, it is visible,
   * and nothing it is in, up to that element, makes it invisible or cuts it
   * off there. (Overflow on <body> and <html> is the window's own.)
   */
  const shownIn = (target: Element, media: Media, x: number, y: number) => {
    if (!holds(boxOf(media), x, y)) return false;
    const own = win.getComputedStyle(media);
    if (own.pointerEvents !== 'none') return false;
    if (own.visibility === 'hidden' || own.visibility === 'collapse') {
      return false;
    }
    for (let node: Element | null = media; node; node = holderOf(node)) {
      const style = node === media ? own : win.getComputedStyle(node);
      if (Number.parseFloat(style.opacity) === 0) return false;
      const cutOff =
        node !== media &&
        !pageEdge(node) &&
        clipsOverflow(style) &&
        !holds(boxOf(node), x, y);
      if (cutOff) return false;
      if (node === target) break;
    }
    return true;
  };

  /** The elements an element is in, from itself out, across shadow roots. */
  const chainOf = (node: Element): Element[] => {
    const chain: Element[] = [];
    for (
      let current: Element | null = node;
      current;
      current = holderOf(current)
    ) {
      chain.push(current);
    }
    return chain;
  };

  /**
   * Whether the element right-clicked and a picture or video under it are in
   * the same small frame (a player with its play button or poster, a
   * thumbnail with a layer on it): the nearest element holding both isn't
   * the page's own <body> or <html>, and the picture or video fills at least
   * FRAME_SHARE of it. A dialog, a top bar or a panel drawn over the page
   * shares only the page or a much bigger part of it with what is under it.
   */
  const sameFrame = (target: Element, media: Media) => {
    const around = new Set(chainOf(target));
    const holder = chainOf(media).find((node) => around.has(node));
    if (!holder || pageEdge(holder)) return false;
    const frame = boxOf(holder);
    const own = boxOf(media);
    const frameArea = (frame.right - frame.left) * (frame.bottom - frame.top);
    const ownArea = (own.right - own.left) * (own.bottom - own.top);
    return frameArea > 0 && ownArea >= frameArea * FRAME_SHARE;
  };

  /**
   * The picture or video right-clicked, where Chromium named none: the one
   * the element is in (a player's own controls); else one that doesn't take
   * the pointer, shown at the point inside the element right-clicked (an
   * image viewer's picture: drawn over the element, the last one in the page
   * over the ones before it); else one under the element, in the same small
   * frame (a paused video under its play button), as Chromium lists them.
   * A picture found with a video there (the video's poster) gives way to
   * the video. Nothing under a dialog, a top bar or a panel is found.
   */
  const mediaUnder = (): Media | null => {
    const target = element();
    if (!target) return null;
    const own = target.closest('video, img');
    if (isMedia(own)) return own;
    const { x, y } = point;
    const inside = [...target.querySelectorAll('img, video')].filter(
      (node): node is Media => isMedia(node) && shownIn(target, node, x, y)
    );
    const under = (win.document.elementsFromPoint?.(x, y) ?? []).filter(
      (node): node is Media => isMedia(node) && sameFrame(target, node)
    );
    const found = [...inside.reverse(), ...under];
    return (
      found.find((media) => media instanceof win.HTMLVideoElement) ??
      found[0] ??
      null
    );
  };

  const videoUnder = (): HTMLVideoElement | null => {
    const media = mediaUnder();
    return media instanceof win.HTMLVideoElement ? media : null;
  };

  const srcOf = (picture: HTMLImageElement) =>
    picture.currentSrc || picture.src || '';

  const describe = (): QAppElementInfo | null => {
    const target = element();
    if (!target) return null;
    const style = win.getComputedStyle(target);
    const large = target.getElementsByTagName('*').length > MAX_COPIED_ELEMENTS;
    return {
      tag: target.localName,
      name: nameOf(target, large),
      role: oneLine(target.getAttribute('role')),
      selector: selectorOf(target),
      box: rounded(target.getBoundingClientRect()),
      viewport: viewport(),
      style: {
        color: style.color,
        background: backgroundOf(target, win),
        font: [style.fontWeight, style.fontSize, style.fontFamily]
          .filter(Boolean)
          .join(' '),
      },
      ...htmlOf(target, large, win),
      title: cut(oneLine(win.document.title), MAX_TITLE),
    };
  };

  const box = (): QAppElementBox | null => {
    const target = element();
    if (!target) return null;
    return {
      box: rounded(target.getBoundingClientRect()),
      viewport: viewport(),
    };
  };

  /**
   * A picture's or a video frame's pixels at their own size (width × height,
   * none when nothing can be drawn yet), made smaller past 4K; where it is
   * on screen when they can't be read.
   */
  const pixelsOf = (
    media: Media,
    width: number,
    height: number
  ): QAppPixels => {
    const where = {
      box: rounded(media.getBoundingClientRect()),
      viewport: viewport(),
    };
    if (!width || !height) return where;
    try {
      const scale = Math.min(1, Math.sqrt(MAX_FRAME_PIXELS / (width * height)));
      const canvas = win.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) return where;
      context.drawImage(media, 0, 0, canvas.width, canvas.height);
      return { png: canvas.toDataURL('image/png') };
    } catch {
      // One from elsewhere can't be read: what's on screen is taken.
      return where;
    }
  };

  const videoFrame = (): QAppPixels | null => {
    const video = videoUnder();
    if (!video) return null;
    // HAVE_CURRENT_DATA: a frame to draw.
    const ready = video.readyState >= 2;
    return pixelsOf(
      video,
      ready ? video.videoWidth : 0,
      ready ? video.videoHeight : 0
    );
  };

  /**
   * The picture the latest right-click's menu was opened for, while it is
   * still on the page showing what it showed then.
   */
  const picture = (): QAppPixels | null => {
    const shown = offered;
    if (!shown?.picture.isConnected || srcOf(shown.picture) !== shown.src) {
      return null;
    }
    const image = shown.picture;
    const loaded = image.complete && image.naturalWidth > 0;
    return pixelsOf(
      image,
      loaded ? image.naturalWidth : 0,
      loaded ? image.naturalHeight : 0
    );
  };

  const pictureInPicture = async (on: boolean): Promise<boolean> => {
    try {
      if (!on) {
        if (!win.document.pictureInPictureElement) return false;
        await win.document.exitPictureInPicture();
        return true;
      }
      const video = videoUnder();
      if (!video) return false;
      await video.requestPictureInPicture();
      return true;
    } catch {
      return false;
    }
  };

  const videoAt = async (): Promise<QAppVideoAt | null> => {
    const video = videoUnder();
    return video ? videoInfo(video) : null;
  };

  const videoInfo = async (video: HTMLVideoElement): Promise<QAppVideoAt> => {
    const src = video.currentSrc.length > MAX_MEDIA_SRC ? '' : video.currentSrc;
    // A blob: address of a MediaSource (fed in parts) can't be fetched; one
    // of a whole file can (only its start is read).
    let stream = !src && video.srcObject != null;
    if (src.startsWith('blob:')) {
      try {
        const response = await win.fetch(src);
        await response.body?.cancel();
      } catch {
        stream = true;
      }
    }
    const heard = (video as { webkitAudioDecodedByteCount?: number })
      .webkitAudioDecodedByteCount;
    return {
      src,
      stream,
      hasAudio: typeof heard === 'number' && heard > 0 ? true : null,
      error: video.error != null,
      pictureInPicture:
        win.document.pictureInPictureElement === video
          ? 'showing'
          : video.disablePictureInPicture ||
              !win.document.pictureInPictureEnabled
            ? 'no'
            : 'can',
    };
  };

  /**
   * A link the app shows at the right-click that isn't an <a> (Chromium
   * names those): on the element or one it is in (an attribute), in a box
   * showing one link (a share window), or written as text under the pointer.
   */
  const linkAt = (): string | null => {
    const target = element();
    if (!target) return null;
    for (let node: Element | null = target; node; node = holderOf(node)) {
      for (const name of LINK_ATTRIBUTES) {
        const value = node.getAttribute(name)?.trim() ?? '';
        if (value.length <= MAX_LINK && WHOLE_LINK.test(value)) return value;
      }
    }
    if (
      target instanceof win.HTMLInputElement ||
      target instanceof win.HTMLTextAreaElement
    ) {
      const value = target.value.trim();
      return value.length <= MAX_LINK && WHOLE_LINK.test(value) ? value : null;
    }
    const caret = win.document.caretRangeFromPoint?.(point.x, point.y);
    const node = caret?.startContainer;
    if (!caret || node?.nodeType !== TEXT_NODE) return null;
    const start = Math.max(0, caret.startOffset - TEXT_AROUND);
    const text = (node as Text).data.slice(
      start,
      caret.startOffset + TEXT_AROUND
    );
    const offset = caret.startOffset - start;
    for (const match of text.matchAll(LINK_IN_TEXT)) {
      const link = match[0].replace(AFTER_LINK, '');
      const from = match.index ?? 0;
      if (offset >= from && offset <= from + link.length) {
        return link.length <= MAX_LINK ? link : null;
      }
    }
    return null;
  };

  /**
   * The name a picture is the profile picture of, if it is one, loaded from
   * the app's own node (the page's origin).
   */
  const avatarNameOf = (image: HTMLImageElement): string | null => {
    let url: URL;
    try {
      url = new URL(srcOf(image));
    } catch {
      return null;
    }
    if (url.origin !== win.location.origin) return null;
    const match = AVATAR_PATH.exec(url.pathname);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  };

  /**
   * Whether an element is shown: apps keep hidden copies of a person's
   * picture place for other layouts (Torq: a letter in a display: none
   * part), which don't count.
   */
  const isShown = (node: Element) => {
    const check = (
      node as Element & {
        checkVisibility?: (options?: Record<string, boolean>) => boolean;
      }
    ).checkVisibility;
    return (
      typeof check !== 'function' ||
      check.call(node, { checkOpacity: true, checkVisibilityCSS: true })
    );
  };

  /**
   * The names of the profile pictures nearest an element: in it, or in the
   * nearest element it is in that holds any (one person's row, card or
   * header, not a list of people), NAME_HOLDERS out at most, short of the
   * page's <body>. A shown place for a person's picture with none loaded in
   * it (the letter shown instead) ends the search with none: further out are
   * other people's rows.
   */
  const avatarNamesNear = (start: Element): string[] => {
    let read = 0;
    let node: Element | null = start;
    for (let level = 0; node && level <= NAME_HOLDERS; level += 1) {
      if (pageEdge(node)) break;
      const names = new Set<string>();
      for (const image of node.querySelectorAll('img')) {
        read += 1;
        if (read > MAX_AVATARS_READ) return [];
        const name = avatarNameOf(image as HTMLImageElement);
        if (name) names.add(name);
      }
      if (names.size) return [...names];
      const places = [
        ...(node.matches(AVATAR_PLACES) ? [node] : []),
        ...node.querySelectorAll(AVATAR_PLACES),
      ];
      if (places.some(isShown)) return [];
      node = holderOf(node);
    }
    return [];
  };

  /**
   * Whether an element is a box of its own (a block, an inline-block, a list
   * item…): text in it isn't on the same line as text around it.
   */
  const isBox = (node: Element) => {
    const display = win.getComputedStyle(node).display;
    return display !== '' && display !== 'inline' && display !== 'contents';
  };

  /** The box a text is in: the nearest element holding it that is one. */
  const lineBoxOf = (node: Node): Element | null => {
    let holder = node.parentElement;
    while (holder && !isBox(holder)) holder = holder.parentElement;
    return holder;
  };

  /** Whether two pieces of text are parts of one word (a highlight). */
  const onePiece = (first: Text, second: Text) =>
    lineBoxOf(first) === lineBoxOf(second) &&
    [first.parentElement, second.parentElement].some((holder) =>
      holder?.matches(HIGHLIGHTS)
    );

  /**
   * The character next to a text on the page when the word goes on there
   * (around a search highlight); '' where it doesn't.
   */
  const characterBeside = (text: Text, before: boolean): string => {
    const box = lineBoxOf(text);
    if (!box) return '';
    const walker = win.document.createTreeWalker(box, SHOW_TEXT);
    walker.currentNode = text;
    for (let step = 0; step < 50; step += 1) {
      const node = (
        before ? walker.previousNode() : walker.nextNode()
      ) as Text | null;
      if (!node) return '';
      if (!node.data) continue;
      if (!onePiece(text, node)) return '';
      return before
        ? characterBefore(node.data, node.data.length)
        : characterAt(node.data, 0);
    }
    return '';
  };

  /**
   * A Qortal name or address written in a text where the pointer is (at
   * offset): an address, or the name of a profile picture in the row or
   * header holding both, the longest one written there (one name can be a
   * word of another).
   */
  const nameAtCaret = (
    target: Element,
    text: Text,
    caretOffset: number
  ): QAppNameAt | null => {
    const data = text.data;
    const start = Math.max(0, caretOffset - TEXT_AROUND);
    const end = Math.min(data.length, caretOffset + TEXT_AROUND);
    const around = data.slice(start, end);
    const offset = caretOffset - start;
    for (const match of around.matchAll(ADDRESS_IN_TEXT)) {
      const from = match.index ?? 0;
      if (offset >= from && offset <= from + match[0].length) {
        return { kind: 'address', value: match[0] };
      }
    }
    const names = avatarNamesNear(target);
    if (!names.length) return null;
    // What comes before and after what was read: the rest of the text, or
    // at its ends the rest of the line on the page.
    const before =
      start === 0 ? characterBeside(text, true) : characterBefore(data, start);
    const after =
      end === data.length
        ? characterBeside(text, false)
        : characterAt(data, end);
    // The whole text as a handle (@name), or in other letter case, when it
    // is a whole word on the page.
    const alone = !WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after);
    if (alone && data.length <= MAX_LABEL_TEXT * 4) {
      const whole = oneLine(data).replace(/^@/, '').toLowerCase();
      const exact = names.find((name) => name.toLowerCase() === whole);
      if (exact) return { kind: 'name', value: exact };
    }
    const written = names
      .filter((name) =>
        wordsOf(around, name, before, after).some(
          (from) => offset >= from && offset <= from + name.length
        )
      )
      .sort((a, b) => b.length - a.length);
    return written.length ? { kind: 'name', value: written[0] } : null;
  };

  /**
   * The element's own text, when short (a label: a name, a handle, a name
   * and a few words), on one line; without what's typed into a field in it.
   * Parts of one word join up (a highlight); other pieces are kept apart.
   */
  const labelTextOf = (element: Element): string => {
    const walker = win.document.createTreeWalker(element, SHOW_TEXT);
    let text = '';
    let read = 0;
    let last: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const piece = node as Text;
      read += piece.data.length;
      // Read no further than a label can be, typed text too (a big part of
      // the page, or an editor in it, is no label).
      if (read > MAX_LABEL_TEXT * 4) return '';
      const holder = piece.parentElement;
      if (holder && isField(holder)) continue;
      if (last && !onePiece(last, piece)) text += ' ';
      text += piece.data;
      last = piece;
    }
    const line = oneLine(text);
    return line.length > MAX_LABEL_TEXT ? '' : line;
  };

  /**
   * A name or address the element right-clicked stands for, when the
   * pointer isn't on its own text (a layer laid over it, as a person's link
   * stretched over the whole card with the picture, or a part of it with no
   * text): its own short text, when that is an address, or names one profile
   * picture beside it (a name that is only part of a longer one written
   * there doesn't count; two names say nothing about which one).
   */
  const nameInLabel = (target: Element): QAppNameAt | null => {
    const text = labelTextOf(target);
    if (!text) return null;
    const bare = text.replace(/^@/, '');
    const addresses = bare.match(ADDRESS_IN_TEXT);
    if (addresses?.length === 1 && addresses[0] === bare) {
      return { kind: 'address', value: bare };
    }
    const names = avatarNamesNear(target);
    const exact = names.find(
      (name) => name.toLowerCase() === bare.toLowerCase()
    );
    if (exact) return { kind: 'name', value: exact };
    const written = names
      .map((name) => ({ name, at: wordsOf(text, name) }))
      .filter(({ at }) => at.length > 0);
    const inLonger = (name: string, from: number) =>
      written.some(
        (other) =>
          other.name.length > name.length &&
          other.at.some(
            (start) =>
              start <= from && from + name.length <= start + other.name.length
          )
      );
    const own = written.filter(({ name, at }) =>
      at.some((from) => !inLonger(name, from))
    );
    return own.length === 1 ? { kind: 'name', value: own[0].name } : null;
  };

  /**
   * A Qortal name or address written as text where the element right-clicked
   * is: at the pointer when it is on the element's own text, else in the
   * element's own short text. Text alone isn't taken for a name (many words
   * are registered names), nor what's typed into a field.
   */
  const nameInText = (target: Element): QAppNameAt | null => {
    if (isField(target)) return null;
    const caret = win.document.caretRangeFromPoint?.(point.x, point.y);
    const node = caret?.startContainer;
    // The text of the element right-clicked, not the nearest text elsewhere.
    if (node?.nodeType === TEXT_NODE && node.parentElement === target) {
      return nameAtCaret(target, node as Text, caret.startOffset);
    }
    return nameInLabel(target);
  };

  /** A name or address the app puts on an element (NAME_ATTRIBUTES). */
  const markedOn = (node: Element): QAppNameAt | null => {
    for (const [attribute, kind] of NAME_ATTRIBUTES) {
      const value = node.getAttribute(attribute)?.trim() ?? '';
      if (value && value.length <= MAX_NAME_VALUE) return { kind, value };
    }
    return null;
  };

  /**
   * The Qortal name or address the app shows at the right-click, for "Look
   * up", the nearest first: one the app puts on the element, else one
   * written as text there, else one the app puts on an element it is in.
   * (Main reads a profile picture right-clicked from the picture's own
   * address.)
   */
  const nameAt = (): QAppNameAt | null => {
    const target = element();
    if (!target) return null;
    const found = markedOn(target) ?? nameInText(target);
    if (found) return found;
    for (let node = holderOf(target); node; node = holderOf(node)) {
      const marked = markedOn(node);
      if (marked) return marked;
    }
    return null;
  };

  /** A picture found at the right-click, kept for "Copy picture". */
  const pictureAt = (image: HTMLImageElement): QAppPictureAt => {
    const src = srcOf(image);
    offered = { picture: image, src };
    return {
      src: src.length > MAX_MEDIA_SRC ? '' : src,
      loaded: image.complete && image.naturalWidth > 0,
    };
  };

  /**
   * What the app shows at the right-click besides what Chromium named: a
   * link, a Qortal name or address, and on a spot where Chromium named
   * nothing (wantMedia), a picture or a video.
   */
  const at = async (wantMedia: boolean): Promise<QAppFoundAt> => {
    offered = null;
    const media = wantMedia ? mediaUnder() : null;
    return {
      video:
        media instanceof win.HTMLVideoElement ? await videoInfo(media) : null,
      picture: media instanceof win.HTMLImageElement ? pictureAt(media) : null,
      link: linkAt(),
      name: nameAt(),
    };
  };

  const helper: QAppMenuGuestHelper = Object.freeze({
    at,
    describe,
    box,
    videoFrame,
    picture,
    videoAt,
    pictureInPicture,
  });
  Object.defineProperty(win, QAPP_MENU_GUEST_KEY, {
    value: helper,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return helper;
}

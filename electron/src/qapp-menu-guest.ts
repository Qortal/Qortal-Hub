/**
 * The app's side of the right-click menu (qapp-context-menu.ts). The app's
 * preload runs it in its isolated world, where the page can't see or call it.
 *
 * It notes the element of each real right-click, for the menu's items that
 * act on that element (copy its description, a video's frame, picture in
 * picture), and lets Shift+right-click reach Hub's menu in an app that has a
 * menu of its own. Main calls it with executeJavaScriptInIsolatedWorld. What
 * it answers comes from the page, so main checks it.
 */
import {
  QAPP_MENU_GUEST_KEY,
  type QAppElementBox,
  type QAppElementInfo,
  type QAppFoundAt,
  type QAppMenuGuestHelper,
  type QAppVideoAt,
  type QAppVideoFrame,
} from './qapp-context-menu-types';

/** An element's HTML is cut after this many characters. */
export const MAX_ELEMENT_HTML = 3_000;
const MAX_NAME = 80;
const MAX_TITLE = 120;
const MAX_SELECTOR_PARTS = 8;
/** An element with more inside it is copied without what's inside. */
export const MAX_COPIED_ELEMENTS = 2_000;
/** A video frame bigger than 4K is made smaller. */
const MAX_FRAME_PIXELS = 3840 * 2160;
/** A video address longer than this (a big data: one) isn't handed over. */
const MAX_VIDEO_SRC = 1_000_000;
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
  win.addEventListener(
    'contextmenu',
    (event) => {
      // A page's own made-up right-click changes nothing.
      if (!isTrusted(event)) return;
      const target = event.composedPath()[0];
      last = target instanceof win.Element ? target : null;
      point = { x: event.clientX, y: event.clientY };
      // Shift+right-click: Hub's menu, even where the app has its own.
      if ((event as MouseEvent).shiftKey) event.stopImmediatePropagation();
    },
    true
  );
  // The element right-clicked last, while it is still on the page.
  const element = () => (last?.isConnected ? last : null);
  const viewport = () => ({ width: win.innerWidth, height: win.innerHeight });
  /**
   * The video right-clicked: the element itself or one it is in, else the
   * one under the point beneath what covers it (a play button, a player's
   * own layer).
   */
  const videoUnder = (): HTMLVideoElement | null => {
    const target = element();
    if (!target) return null;
    const own = videoOf(target);
    if (own) return own;
    const under = win.document.elementsFromPoint?.(point.x, point.y) ?? [];
    for (const node of under) {
      if (node instanceof win.HTMLVideoElement) return node;
    }
    return null;
  };
  const videoOf = (node: Element | null): HTMLVideoElement | null => {
    if (!node) return null;
    if (node instanceof win.HTMLVideoElement) return node;
    const found = node.closest('video');
    return found instanceof win.HTMLVideoElement ? found : null;
  };

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

  const videoFrame = (): QAppVideoFrame | null => {
    const video = videoUnder();
    if (!video) return null;
    const where = {
      box: rounded(video.getBoundingClientRect()),
      viewport: viewport(),
    };
    // HAVE_CURRENT_DATA: a frame to draw.
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return where;
    }
    try {
      const scale = Math.min(
        1,
        Math.sqrt(MAX_FRAME_PIXELS / (video.videoWidth * video.videoHeight))
      );
      const canvas = win.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) return where;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return { png: canvas.toDataURL('image/png') };
    } catch {
      // A video from elsewhere can't be read: what's on screen is taken.
      return where;
    }
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
    if (!video) return null;
    const src = video.currentSrc.length > MAX_VIDEO_SRC ? '' : video.currentSrc;
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

  const at = async (wantVideo: boolean): Promise<QAppFoundAt> => ({
    video: wantVideo ? await videoAt() : null,
    link: linkAt(),
  });

  const helper: QAppMenuGuestHelper = Object.freeze({
    at,
    describe,
    box,
    videoFrame,
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

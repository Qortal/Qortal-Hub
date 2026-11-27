/**
 * The right-click menu inside Q-Apps and websites.
 *
 * Main hears a right-click from an app's webview through Electron's
 * context-menu event. A page can't fake that event, and an app with a
 * right-click menu of its own cancels it, so it keeps its own. Main keeps
 * what was under the pointer and asks the Hub page to show the menu there;
 * the Hub page answers with the item chosen and nothing else, so no link,
 * word or path ever comes back from a page.
 *
 * Saves go through the app's own session (downloadURL, as Hub's SAVE_FILE
 * does): only files the app could load itself from its own node, never
 * with the API key, and only to a place the user picks in the Save dialog.
 *
 * Items that act on the element right-clicked (copy its description, a video's
 * frame, picture in picture) ask the app's preload, which noted that element
 * in its isolated world (qapp-menu-guest.ts); what it answers is checked
 * here. A link to open, a name to look up and a question for Qortino go back
 * to the Hub page, which carries them out with Hub's own openers.
 */
import { randomUUID } from 'crypto';
import path from 'path';
import type {
  DownloadItem,
  IpcMain,
  IpcMainInvokeEvent,
  NativeImage,
  Rectangle,
  Session,
  WebContents,
} from 'electron';
import {
  QAPP_GUEST_ISOLATED_WORLD,
  QAPP_MENU_CHANNELS,
  QAPP_MENU_GUEST_KEY,
  QAPP_MENU_TTL_MS,
  isMenuSeparator,
  type QAppElementInfo,
  type QAppMenuAction,
  type QAppMenuContext,
  type QAppMenuEntry,
  type QAppMenuItem,
  type QAppMenuOpen,
  type QAppMenuResult,
  type QAppMenuSettings,
  type QAppPictureAt,
  type QAppSaveState,
  type QAppSaveUpdate,
  type QAppVideoAt,
} from './qapp-context-menu-types';

/** A menu left open longer than this does nothing. */
export const MENU_TTL_MS = QAPP_MENU_TTL_MS;
/** Spelling suggestions shown at most. */
export const MAX_SUGGESTIONS = 5;
/** A suggestion longer than this isn't shown. */
const MAX_SUGGESTION_LENGTH = 60;
/** A save that hasn't started downloading by then has failed. */
export const SAVE_START_TIMEOUT_MS = 30_000;
/** Finished saves remembered for "Show in folder". */
const MAX_SAVES_KEPT = 50;
const MAX_FILE_NAME_LENGTH = 120;
/** File names stay under this many bytes: most file systems allow 255. */
const MAX_FILE_NAME_BYTES = 200;
/**
 * A save's download carries this in its link (the part a server never sees),
 * so each download is matched to the one save that started it.
 */
const SAVE_TAG = '#qortal-hub-save-';
/** A save's tag is watched this long after it ended, to stop a late download. */
export const LATE_DOWNLOAD_MS = 10 * 60_000;
/** A call into the app's page that hasn't answered by then has failed. */
export const GUEST_CALL_TIMEOUT_MS = 5_000;
/** Qortino is asked about at most this much of the text selected. */
export const MAX_QORTINO_TEXT = 1_000;
/** "Copy element description": its HTML, a little more than the page sends. */
const MAX_COPIED_HTML = 3_100;
/** A video frame's PNG bigger than this isn't copied (4K is far less). */
const MAX_FRAME_DATA_URL = 64 * 1024 * 1024;
/** A link longer than this isn't opened. */
const MAX_OPENED_LINK = 4_096;
/** A Qortal name is 3 to 40 bytes long. */
const MIN_NAME_BYTES = 3;
const MAX_NAME_BYTES = 40;
/** Selected text longer than this is no name to look up (read no further). */
const MAX_LOOKUP_SELECTION = 200;
/**
 * The menu waits this long for the app to say what it shows at the
 * right-click besides what Chromium named (a link, a picture, a video).
 */
export const LOOKUP_MS = 300;
/**
 * A picture's or video's address longer than this (a big data: one) isn't
 * taken.
 */
const MAX_MEDIA_SRC = 1_000_000;

/** What the menu reads from Electron's context-menu params. */
export type QAppMenuParams = {
  x: number;
  y: number;
  mediaType: string;
  srcURL: string;
  linkURL: string;
  selectionText: string;
  isEditable: boolean;
  hasImageContents: boolean;
  misspelledWord: string;
  dictionarySuggestions: string[];
  /** A link's download name, when the page gave one. */
  suggestedFilename?: string;
  /** Electron 44: 'input-password' for a password field. */
  formControlType?: string;
  /** The frame right-clicked: the app's own page, or a frame inside it. */
  frame?: unknown;
  /**
   * Set here, not by Electron: the picture is one the app's preload found
   * where Chromium named none, so it is copied from its pixels (Chromium
   * finds no picture at the point).
   */
  foundPicture?: boolean;
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
  mediaFlags: {
    canSave: boolean;
    hasAudio: boolean;
    inError?: boolean;
    canShowPictureInPicture?: boolean;
    isShowingPictureInPicture?: boolean;
  };
};

/** A Q-App tab's webview as Hub registered it. */
export type QAppMenuGuest = {
  tabId: string;
  /** The app's name, for saved files that have no name of their own. */
  appName: string;
  /** The node the app runs from: only its own files are saved. */
  nodeOrigin: string;
  /** Its service (APP, WEBSITE…), as Hub opened it. */
  service: string;
  /** Opened in dev mode from a server of the developer's: no app page. */
  devApp: boolean;
  /**
   * The resource's identifier when it isn't the default one (a widget, an
   * app published under another identifier): its page isn't in the library.
   */
  identifier?: string;
};

export type QAppMenuDeps = {
  /**
   * The webview's current registration: null when it isn't a Q-App Hub
   * registered, or its page has left its app.
   */
  guestInfo: (guest: WebContents) => QAppMenuGuest | null;
  hubPage: () => WebContents | null;
  showSaveDialog: (options: {
    defaultPath: string;
    properties: ('createDirectory' | 'showOverwriteConfirmation')[];
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  downloadsDir: () => string;
  /** Electron 44's clipboard writes are async. */
  writeClipboardText: (text: string) => Promise<void> | void;
  writeClipboardImage: (image: NativeImage) => Promise<void> | void;
  /** A picture from a PNG's data: link (nativeImage). */
  imageFromDataUrl: (dataUrl: string) => NativeImage;
  /** Writes a file the Save dialog named (a video's frame). */
  writeFile: (filePath: string, data: Buffer) => Promise<void>;
  /** Opens a web link in the system's browser. */
  openInBrowser: (url: string) => Promise<void> | void;
  showItemInFolder: (filePath: string) => void;
  fileExists: (filePath: string) => boolean;
  /** An app webview by its id: null unless Hub registered it. */
  guestById?: (id: number) => WebContents | null;
  now?: () => Date;
  saveStartTimeoutMs?: number;
  guestCallTimeoutMs?: number;
};

// Control characters, and the ones that turn text around.
const UNSAFE_CHARACTERS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const UNSAFE_CHARACTER = new RegExp(UNSAFE_CHARACTERS.source);
/** In HTML: control characters but line breaks and tabs, and the ones that
 * turn text around. */
const UNSAFE_IN_HTML =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
/**
 * Hub's name lookup puts a name into the node's address as it is: text with
 * these would ask the node for something else.
 */
const NOT_IN_LOOKUPS = /[/\\?#%]/;
/** Pictures Q-Chat shows from a qortal://use-embed/IMAGE link. */
const PICTURE_SERVICES = new Set(['IMAGE', 'THUMBNAIL', 'QCHAT_IMAGE']);
/** Services whose page Hub's library shows. */
const APP_PAGE_SERVICES = new Set(['APP', 'WEBSITE']);
const NO_SETTINGS: QAppMenuSettings = { devMode: false, qortino: false };
/** Characters encodeURIComponent leaves, which link readers may trim. */
const LINK_TRIMMED = /[!'()*.]/g;
const FILE_NAME_FORBIDDEN = /[<>:"/\\|?*]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const PLAIN_EXTENSION = /^\.[a-z0-9]{1,8}$/i;
/**
 * Extensions added to a name typed without one, from the file's own type:
 * pictures, sound, video, documents and archives. A program's or a script's
 * is never added: the dialog didn't show it, and some systems hide it.
 */
const ADDED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.flac',
  '.weba',
  '.mp4',
  '.m4v',
  '.webm',
  '.mkv',
  '.mov',
  '.ogv',
  '.pdf',
  '.txt',
  '.json',
  '.csv',
  '.md',
  '.srt',
  '.vtt',
  '.zip',
  '.7z',
  '.tar',
  '.gz',
]);
/** Extensions that say a typed name has its type already. */
const KNOWN_EXTENSIONS = new Set([
  ...ADDED_EXTENSIONS,
  '.svg',
  '.html',
  '.htm',
  '.js',
  '.css',
  '.xml',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.rtf',
  '.rar',
  '.xz',
  '.bz2',
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.ps1',
  '.sh',
  '.apk',
  '.appimage',
  '.deb',
  '.rpm',
  '.dmg',
  '.pkg',
  '.jar',
  '.iso',
]);
const SERVICE = /^[A-Z][A-Z0-9_]*$/;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
};

/** Text from a page for a menu label: no control or direction characters. */
export function cleanLabel(value: unknown, max = MAX_SUGGESTION_LENGTH) {
  if (typeof value !== 'string') return '';
  const clean = value
    .replace(UNSAFE_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...clean].length > max ? '' : clean;
}

/** The longest start of `text` that fits in `max` bytes as UTF-8. */
function withinBytes(text: string, max: number): string {
  let out = '';
  for (const char of text) {
    if (Buffer.byteLength(out + char) > max) break;
    out += char;
  }
  return out;
}

/** A file name: nothing a file system refuses or a name could hide. */
export function cleanFileName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const short = [
    ...value
      .replace(UNSAFE_CHARACTERS, ' ')
      .replace(FILE_NAME_FORBIDDEN, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, MAX_FILE_NAME_LENGTH)
    .join('');
  const clean = withinBytes(short, MAX_FILE_NAME_BYTES).replace(
    /^[\s.]+|[\s.]+$/g,
    ''
  );
  return WINDOWS_RESERVED.test(clean) ? `_${clean}` : clean;
}

/**
 * A file the menu may save: a blob: or data: one from the page, or one from
 * the app's own node. Anything else (another site, a local service) isn't
 * fetched for the page.
 */
export function savableUrl(url: unknown, nodeOrigin: string): boolean {
  if (typeof url !== 'string' || !url) return false;
  if (/^data:(image|video|audio)\//i.test(url)) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!['blob:', 'http:', 'https:'].includes(parsed.protocol)) return false;
  return parsed.origin === nodeOrigin;
}

/** A link worth "Save linked file as…": a file, not a page of the app. */
export function isLinkedFile(url: unknown, nodeOrigin: string): boolean {
  if (!savableUrl(url, nodeOrigin)) return false;
  const text = url as string;
  if (/^(blob|data):/i.test(text)) return true;
  return new URL(text).pathname.startsWith('/arbitrary/');
}

/**
 * The text "Copy link" copies: a link into a Q-App or website as the
 * qortal:// link Hub opens (the node's own address works on this PC only),
 * other web and qortal:// links as they are, anything else not at all.
 */
export function copyableLink(url: unknown, nodeOrigin: string): string | null {
  if (typeof url !== 'string' || !url) return null;
  if (/^qortal:\/\//i.test(url)) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.origin === nodeOrigin) {
    const segments = parsed.pathname.split('/');
    // A private app's preview: its address carries the secret that opens it.
    if (segments[1] === 'render' && segments[2] === 'hash') return null;
    if (
      segments[1] === 'render' &&
      SERVICE.test(segments[2] ?? '') &&
      segments[3]
    ) {
      return `qortal://${segments.slice(2).join('/')}${parsed.search}${parsed.hash}`;
    }
  }
  return url;
}

/**
 * The page an app shows, as its link (qortal:// for a Q-App or website),
 * without what Hub adds to an app's address: its theme, language and an
 * empty identifier. None for a private app's preview, nor any secret.
 */
export function shownPageLink(url: unknown, nodeOrigin: string): string {
  if (typeof url !== 'string' || !url) return '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  parsed.searchParams.delete('secret');
  parsed.searchParams.delete('theme');
  parsed.searchParams.delete('lang');
  if (!parsed.searchParams.get('identifier')) {
    parsed.searchParams.delete('identifier');
  }
  return copyableLink(parsed.toString(), nodeOrigin) ?? '';
}

/**
 * A link "Open link in new tab" opens: one into a Q-App or website, as the
 * qortal:// link Hub's link opener takes (Hub's other links: hubLink).
 */
export function openableLink(url: unknown, nodeOrigin: string): string | null {
  const link = copyableLink(url, nodeOrigin);
  if (!link || link.length > MAX_OPENED_LINK) return null;
  if (!/^qortal:\/\//i.test(link)) return null;
  const rest = link.replace(/^qortal:\/\//i, '');
  if (!/^[^/?#\s]/.test(rest) || /^use-/i.test(rest)) return null;
  return link;
}

/**
 * A qortal:// link "Open link" opens with Hub's link opener: an app's page
 * in the library (use-app-page) or a group's link (use-group: the group for
 * its members, else a window that asks before joining). Embeds (use-embed)
 * have nothing to open: they are copied.
 */
export function hubLink(url: unknown, nodeOrigin: string): string | null {
  const link = copyableLink(url, nodeOrigin);
  if (!link || link.length > MAX_OPENED_LINK) return null;
  return /^qortal:\/\/use-(app-page|group)\/[^\s]/i.test(link) ? link : null;
}

/**
 * A web link "Open link in browser" opens: http(s) to another site, with no
 * name and password in it (a way to disguise where a link goes).
 */
export function browserLink(url: unknown, nodeOrigin: string): string | null {
  if (typeof url !== 'string' || !url || url.length > MAX_OPENED_LINK) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname || parsed.username || parsed.password) return null;
  if (parsed.origin === nodeOrigin) return null;
  return parsed.href;
}

/**
 * "Copy picture as Qortal link": a picture on QDN, as the
 * qortal://use-embed/IMAGE link Q-Chat shows as the picture. Only one the
 * app loads whole from its node: /arbitrary/<SERVICE>/<name>/<identifier>.
 */
export function pictureEmbedLink(
  url: unknown,
  nodeOrigin: string
): string | null {
  if (typeof url !== 'string' || !url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.origin !== nodeOrigin) return null;
  // ['', 'arbitrary', service, name, identifier]
  const segments = parsed.pathname.split('/');
  if (segments.length !== 5 || segments[1] !== 'arbitrary') return null;
  const service = segments[2];
  if (!PICTURE_SERVICES.has(service)) return null;
  let name: string;
  let identifier: string;
  try {
    name = decodeURIComponent(segments[3]);
    identifier = decodeURIComponent(segments[4]);
  } catch {
    return null;
  }
  if (!name.trim() || !identifier.trim()) return null;
  if (['default', 'null'].includes(identifier.toLowerCase())) return null;
  if (UNSAFE_CHARACTER.test(name) || UNSAFE_CHARACTER.test(identifier)) {
    return null;
  }
  return (
    'qortal://use-embed/IMAGE' +
    `?name=${encodeURIComponent(name)}` +
    `&identifier=${encodeURIComponent(identifier)}` +
    `&service=${service}`
  );
}

/**
 * Selected text "Look up" takes: text that can be a name or an address (3 to
 * 40 bytes on one line; an address is 34), with an @ before it and a
 * sentence's punctuation after it left out. Nothing hidden, and none of
 * / \ ? # %.
 */
export function lookUpText(value: unknown): string | null {
  // A long selection is no name: it isn't read (a page can select a lot).
  if (typeof value !== 'string' || value.length > MAX_LOOKUP_SELECTION) {
    return null;
  }
  const text = value
    .trim()
    .replace(/^@/, '')
    .replace(/[),.;:!?]+$/, '');
  const bytes = Buffer.byteLength(text);
  if (bytes < MIN_NAME_BYTES || bytes > MAX_NAME_BYTES) return null;
  if (UNSAFE_CHARACTER.test(text) || NOT_IN_LOOKUPS.test(text)) return null;
  if (/\s{2,}/.test(text) || /^\.+$/.test(text)) return null;
  return text;
}

/** The selected text Qortino is asked about: on one line, not too long. */
export function qortinoText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Only the start of a long selection is read (a page can select a lot).
  const head = value.slice(0, MAX_QORTINO_TEXT * 4);
  const text = head.replace(UNSAFE_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const characters = [...text];
  return characters.length > MAX_QORTINO_TEXT || head.length < value.length
    ? `${characters.slice(0, MAX_QORTINO_TEXT).join('')}…`
    : text;
}

/**
 * "About <app>": the page of a Q-App or website in Hub's library (the
 * default resource of its name). The name is encoded whole: a link reader
 * trims a sentence's punctuation from a link's end.
 */
export function appPageLink(guest: QAppMenuGuest): string | null {
  if (guest.devApp || !APP_PAGE_SERVICES.has(guest.service)) return null;
  const identifier = guest.identifier ?? '';
  if (identifier && !['default', 'null'].includes(identifier.toLowerCase())) {
    return null;
  }
  if (!cleanLabel(guest.appName)) return null;
  const name = encodeURIComponent(guest.appName).replace(
    LINK_TRIMMED,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `qortal://use-app-page/${guest.service}/${name}`;
}

/**
 * The right-click as a right-click on the picture the app's preload found
 * under the pointer (one that doesn't take the pointer, as an image viewer's,
 * or one under a cover), checked; as it was when none.
 */
export function withFoundPicture(
  params: QAppMenuParams,
  found: unknown
): QAppMenuParams {
  if (!found || typeof found !== 'object') return params;
  const picture = found as Partial<Record<keyof QAppPictureAt, unknown>>;
  if (typeof picture.src !== 'string' || picture.src.length > MAX_MEDIA_SRC) {
    return params;
  }
  const loaded = picture.loaded === true;
  // Nothing to save or copy.
  if (!picture.src && !loaded) return params;
  return {
    ...params,
    mediaType: 'image',
    srcURL: picture.src,
    hasImageContents: loaded,
    foundPicture: true,
  };
}

/**
 * The right-click as a right-click on the video the app's preload found
 * under the pointer (under what covers it, or one that doesn't take the
 * pointer), checked; as it was when none.
 */
export function withFoundVideo(
  params: QAppMenuParams,
  found: unknown
): QAppMenuParams {
  if (!found || typeof found !== 'object') return params;
  const video = found as Partial<Record<keyof QAppVideoAt, unknown>>;
  if (typeof video.src !== 'string' || video.src.length > MAX_MEDIA_SRC) {
    return params;
  }
  return {
    ...params,
    mediaType: 'video',
    srcURL: video.src,
    mediaFlags: {
      canSave: video.src !== '' && video.stream !== true,
      hasAudio: video.hasAudio !== false,
      inError: video.error === true,
      canShowPictureInPicture: video.pictureInPicture === 'can',
      isShowingPictureInPicture: video.pictureInPicture === 'showing',
    },
  };
}

/**
 * A right-click on nothing Chromium names (no picture, video, link, text box
 * or selection) may be on a picture or video Chromium doesn't see there: one
 * under a cover, or one that doesn't take the pointer. The app's preload is
 * asked.
 */
const mayCoverMedia = (params: QAppMenuParams) =>
  params.mediaType === 'none' &&
  params.isEditable !== true &&
  !params.linkURL &&
  !params.selectionText;

/**
 * The right-click with what the app's preload found there (checked): a
 * picture or video Chromium doesn't see, and a link not in an <a> when
 * Chromium named none.
 */
export function withFound(
  params: QAppMenuParams,
  found: unknown
): QAppMenuParams {
  if (!found || typeof found !== 'object') return params;
  const { video, picture, link } = found as {
    video?: unknown;
    picture?: unknown;
    link?: unknown;
  };
  let result = params;
  if (mayCoverMedia(params)) {
    result = withFoundPicture(params, picture);
    if (result === params) result = withFoundVideo(params, video);
  }
  if (
    !params.linkURL &&
    typeof link === 'string' &&
    link.length <= MAX_OPENED_LINK &&
    !UNSAFE_CHARACTER.test(link)
  ) {
    result = { ...result, linkURL: link };
  }
  return result;
}

const finite = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;

/** Text from the page on one line, cut when long. */
const pageText = (value: unknown, max = 300) => {
  const text =
    typeof value === 'string'
      ? value
          .slice(0, max * 4)
          .replace(UNSAFE_CHARACTERS, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/** What the app's preload says about an element, checked. */
export function readElementInfo(value: unknown): QAppElementInfo | null {
  if (!value || typeof value !== 'object') return null;
  const info = value as Partial<Record<keyof QAppElementInfo, unknown>>;
  if (typeof info.tag !== 'string' || !info.tag) return null;
  const box = (info.box ?? {}) as Record<string, unknown>;
  const viewport = (info.viewport ?? {}) as Record<string, unknown>;
  const style = (info.style ?? {}) as Record<string, unknown>;
  const html = typeof info.html === 'string' ? info.html : '';
  return {
    tag: pageText(info.tag, 60),
    name: pageText(info.name, 100),
    role: pageText(info.role, 60),
    selector: pageText(info.selector, 1_000),
    box: {
      x: finite(box.x),
      y: finite(box.y),
      width: finite(box.width),
      height: finite(box.height),
    },
    viewport: {
      width: finite(viewport.width),
      height: finite(viewport.height),
    },
    style: {
      color: pageText(style.color, 80),
      background: pageText(style.background, 80),
      font: pageText(style.font, 200),
    },
    html: html
      .slice(0, MAX_COPIED_HTML * 2)
      .replace(UNSAFE_IN_HTML, '')
      .slice(0, MAX_COPIED_HTML),
    cut: info.cut === true || html.length > MAX_COPIED_HTML,
    title: pageText(info.title, 150),
  };
}

/**
 * "Copy element description": what an AI chat (or a person) needs to know which element is
 * meant and what it looks like, as plain "key: value" lines.
 */
export function elementText(
  info: QAppElementInfo,
  where: { appName: string; service: string; page: string }
): string {
  const element =
    info.tag +
    (info.name ? ` "${info.name}"` : '') +
    (info.role ? ` (role ${info.role})` : '');
  const style = [
    info.style.color && `color ${info.style.color}`,
    info.style.background && `background ${info.style.background}`,
    info.style.font && `font ${info.style.font}`,
  ].filter(Boolean);
  return [
    `app: ${pageText(where.appName)} (${pageText(where.service)})`,
    where.page && `page: ${pageText(where.page, 2_000)}`,
    info.title && `title: ${info.title}`,
    `window: ${info.viewport.width}×${info.viewport.height}`,
    `element: ${element}`,
    info.selector && `selector: ${info.selector}`,
    `box: ${info.box.width}×${info.box.height} at ${info.box.x},${info.box.y}`,
    style.length > 0 && `style: ${style.join('; ')}`,
    info.cut ? 'html (cut):' : 'html:',
    info.html,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The part of a box the app's preload gave that is on screen, in the
 * webview's own pixels (the page's CSS pixels times its zoom): what
 * capturePage takes.
 */
export function screenRect(value: unknown, zoom: number): Rectangle | null {
  if (!value || typeof value !== 'object') return null;
  const { box, viewport } = value as {
    box?: Record<string, unknown>;
    viewport?: Record<string, unknown>;
  };
  const numbers = [
    box?.x,
    box?.y,
    box?.width,
    box?.height,
    viewport?.width,
    viewport?.height,
  ];
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  const [x, y, width, height, viewWidth, viewHeight] = numbers as number[];
  if (width <= 0 || height <= 0 || viewWidth <= 0 || viewHeight <= 0) {
    return null;
  }
  if (viewWidth > 100_000 || viewHeight > 100_000) return null;
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(viewWidth, x + width);
  const bottom = Math.min(viewHeight, y + height);
  if (right - left < 1 || bottom - top < 1) return null;
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const rect = {
    x: Math.floor(left * scale),
    y: Math.floor(top * scale),
    width: 0,
    height: 0,
  };
  rect.width = Math.ceil(right * scale) - rect.x;
  rect.height = Math.ceil(bottom * scale) - rect.y;
  return rect;
}

const stamp = (now: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  );
};

const decode = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/**
 * The name the Save dialog suggests: the link's own download name, the
 * file's name on QDN (its path, or its identifier, else its publisher's
 * name), or "<app> <date and time>" for what has no name (a picture the app
 * decrypted). Without a known type the name has no extension; the download
 * adds it.
 */
export function saveFileName({
  url,
  appName,
  now,
  suggested,
}: {
  url: string;
  appName: string;
  now: Date;
  suggested?: string;
}): string {
  const fallback = `${cleanFileName(appName) || 'Qortal'} ${stamp(now)}`;
  const given = cleanFileName(suggested);
  if (given) return given;
  if (/^data:/i.test(url)) {
    const mime = /^data:([^;,]+)/i.exec(url)?.[1]?.toLowerCase() ?? '';
    return `${fallback}${MIME_EXTENSIONS[mime] ?? ''}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fallback;
  }
  if (parsed.protocol === 'blob:') return fallback;
  const attachmentName = cleanFileName(
    parsed.searchParams.get('attachmentFilename') ?? ''
  );
  if (attachmentName) return attachmentName;
  const segments = parsed.pathname.split('/').filter(Boolean).map(decode);
  if (segments[0] === 'arbitrary' && segments.length >= 3) {
    // /arbitrary/<SERVICE>/<name>[/<identifier>[/<file path>]]
    const filePart = segments.length > 4 ? segments[segments.length - 1] : '';
    if (filePart && PLAIN_EXTENSION.test(path.extname(filePart))) {
      return cleanFileName(filePart) || fallback;
    }
    const identifier = segments[3];
    const base =
      identifier && !['default', 'null'].includes(identifier.toLowerCase())
        ? identifier
        : segments[2];
    return cleanFileName(base) || fallback;
  }
  const last = segments[segments.length - 1] ?? '';
  if (PLAIN_EXTENSION.test(path.extname(last))) {
    return cleanFileName(last) || fallback;
  }
  return fallback;
}

/**
 * The path a download is saved to: the dialog's answer as it is when it
 * names a type ("song.mp3"); else with the downloaded file's extension added
 * when that is a harmless type, under a name not taken yet (the dialog asked
 * about overwriting only the name it showed). "Pub.Name" names no type.
 */
export function withFileExtension(
  chosen: string,
  downloadName: string,
  exists: (filePath: string) => boolean
): string {
  if (KNOWN_EXTENSIONS.has(path.extname(chosen).toLowerCase())) return chosen;
  const extension = path.extname(downloadName).toLowerCase();
  if (!ADDED_EXTENSIONS.has(extension)) return chosen;
  const dir = path.dirname(chosen);
  const base = path.basename(chosen);
  for (let count = 0; count < 100; count += 1) {
    const candidate = path.join(
      dir,
      `${base}${count ? ` (${count})` : ''}${extension}`
    );
    if (!exists(candidate)) return candidate;
  }
  return chosen;
}

/** The spelling suggestions shown: the first few, cleaned. */
export function spellingSuggestions(params: QAppMenuParams): string[] {
  const words = Array.isArray(params.dictionarySuggestions)
    ? params.dictionarySuggestions
    : [];
  return words
    .slice(0, MAX_SUGGESTIONS)
    .filter((word) => typeof word === 'string' && cleanLabel(word) !== '');
}

/**
 * The menu for what's under the pointer, grouped, with separators: a
 * misspelled word, a link, a picture or video, editing or the text
 * selected, the app's page where nothing else is, and dev mode's items.
 */
export function menuItemsFor(
  params: QAppMenuParams,
  guest: QAppMenuGuest,
  settings: QAppMenuContext = NO_SETTINGS
): QAppMenuItem[] {
  const groups: QAppMenuEntry[][] = [];
  const editable = params.isEditable === true;
  // Items that ask the app's preload about the element: in the app's own
  // page only (in a frame inside it, the preload knows another element).
  const inPage = settings.inMainFrame !== false;
  const misspelled =
    editable &&
    typeof params.misspelledWord === 'string' &&
    params.misspelledWord.trim() !== '';
  if (misspelled) {
    groups.push([
      ...spellingSuggestions(params).map((word, index) => ({
        action: 'replaceMisspelling' as const,
        index,
        label: cleanLabel(word),
      })),
      { action: 'addToDictionary' },
    ]);
  }
  const link = typeof params.linkURL === 'string' ? params.linkURL : '';
  if (link) {
    const group: QAppMenuEntry[] = [];
    if (openableLink(link, guest.nodeOrigin)) {
      group.push({ action: 'openLink' });
    } else if (hubLink(link, guest.nodeOrigin)) {
      group.push({ action: 'openQortalLink' });
    } else if (browserLink(link, guest.nodeOrigin)) {
      group.push({ action: 'openWebLink' });
    }
    if (isLinkedFile(link, guest.nodeOrigin)) {
      group.push({ action: 'saveLinkedFile' });
    }
    if (copyableLink(link, guest.nodeOrigin))
      group.push({ action: 'copyLink' });
    groups.push(group);
  }
  const src = typeof params.srcURL === 'string' ? params.srcURL : '';
  if (params.mediaType === 'image') {
    const group: QAppMenuEntry[] = [];
    if (savableUrl(src, guest.nodeOrigin))
      group.push({ action: 'savePicture' });
    if (params.hasImageContents) group.push({ action: 'copyPicture' });
    if (pictureEmbedLink(src, guest.nodeOrigin)) {
      group.push({ action: 'copyPictureLink' });
    }
    groups.push(group);
  } else if (params.mediaType === 'video' || params.mediaType === 'audio') {
    const group: QAppMenuEntry[] = [];
    const flags = params.mediaFlags ?? ({} as QAppMenuParams['mediaFlags']);
    const action = params.mediaType === 'video' ? 'saveVideo' : 'saveSound';
    if (!flags.canSave) {
      // A stream the app feeds in parts (MediaSource): no file to save.
      group.push({ action, disabled: true, reason: 'streamed' });
    } else if (savableUrl(src, guest.nodeOrigin)) {
      group.push({ action });
    }
    if (params.mediaType === 'video' && inPage) {
      if (!flags.inError) {
        group.push({ action: 'copyVideoFrame' }, { action: 'saveVideoFrame' });
      }
      if (flags.isShowingPictureInPicture) {
        group.push({ action: 'exitPictureInPicture' });
      } else if (flags.canShowPictureInPicture) {
        group.push({ action: 'pictureInPicture' });
      }
    }
    groups.push(group);
  }
  if (editable) {
    const flags = params.editFlags ?? ({} as QAppMenuParams['editFlags']);
    if (flags.canUndo || flags.canRedo) {
      groups.push([
        { action: 'undo', disabled: !flags.canUndo },
        { action: 'redo', disabled: !flags.canRedo },
      ]);
    }
    groups.push([
      { action: 'cut', disabled: !flags.canCut },
      { action: 'copy', disabled: !flags.canCopy },
      { action: 'paste', disabled: !flags.canPaste },
    ]);
    groups.push([{ action: 'selectAll', disabled: !flags.canSelectAll }]);
  } else if (
    typeof params.selectionText === 'string' &&
    params.selectionText.trim()
  ) {
    groups.push([{ action: 'copy' }]);
  }
  // What the text selected can be looked up as or asked about: not a
  // misspelled word (selected by the right-click), nor a password.
  if (!misspelled && params.formControlType !== 'input-password') {
    const group: QAppMenuEntry[] = [];
    const name = lookUpText(params.selectionText);
    if (name) group.push({ action: 'lookUp', label: cleanLabel(name) });
    if (settings.qortino && qortinoText(params.selectionText)) {
      group.push({ action: 'askQortino' });
    }
    groups.push(group);
  }
  // The app's page, from a part of the app with nothing else to offer.
  if (!groups.some((entries) => entries.length) && appPageLink(guest)) {
    groups.push([{ action: 'aboutApp', label: cleanLabel(guest.appName) }]);
  }
  if (settings.devMode) {
    groups.push([
      ...(inPage
        ? [
            { action: 'copyElement' as const },
            { action: 'copyElementPicture' as const },
          ]
        : []),
      { action: 'inspectElement' },
    ]);
  }
  const items: QAppMenuItem[] = [];
  for (const group of groups.filter((entries) => entries.length)) {
    if (items.length) items.push({ separator: true });
    items.push(...group);
  }
  return items;
}

type MenuRecord = {
  guest: WebContents;
  info: QAppMenuGuest;
  params: QAppMenuParams;
  suggestions: string[];
  items: QAppMenuItem[];
  openedAt: number;
};

type SaveRecord = {
  name: string;
  state: QAppSaveState;
  /** The tagged link this save downloads (see SAVE_TAG). */
  tagged: string;
  /** Where the dialog said, before the download's own extension. */
  chosenPath: string;
  filePath?: string;
  item?: DownloadItem;
  /** Stops a save whose download hasn't started yet. */
  stopWaiting?: () => void;
  percent?: number;
  endedAt?: number;
  tell: () => void;
};

const SAVE_ACTIONS = new Set<QAppMenuAction>([
  'savePicture',
  'saveVideo',
  'saveSound',
  'saveLinkedFile',
]);

/** The webview's zoom: its page's CSS pixels times this are its own. */
const zoomOf = (guest: WebContents) => guest.getZoomFactor?.() || 1;

const firstUrl = (item: DownloadItem) =>
  item.getURLChain?.()[0] ?? item.getURL();

export class QAppContextMenus {
  private readonly menus = new Map<string, MenuRecord>();
  private readonly saves = new Map<string, SaveRecord>();
  /** Saves by their tagged link, kept a while after they end. */
  private readonly byTag = new Map<string, SaveRecord>();
  private readonly attached = new WeakSet<WebContents>();
  private readonly watchedSessions = new WeakSet<Session>();
  private locked = false;
  private settings: QAppMenuSettings = NO_SETTINGS;
  /** Each app's latest right-click, so only its menu shows. */
  private readonly rightClicks = new WeakMap<WebContents, number>();

  constructor(private readonly deps: QAppMenuDeps) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  /** Listens to one app webview's right-clicks. */
  attach(guest: WebContents): void {
    if (this.attached.has(guest)) return;
    this.attached.add(guest);
    guest.on('context-menu', (_event, params) =>
      this.open(guest, params as unknown as QAppMenuParams)
    );
    // A menu belongs to the page it was opened on.
    guest.on('did-navigate', () => this.forgetMenusOf(guest));
    guest.once('destroyed', () => this.forgetMenusOf(guest));
  }

  /**
   * A right-click in an app. Unless Chromium named a link, the app's preload
   * is asked first (briefly) what it shows there: a link not in an <a> (an
   * attribute, a link written as text, a box showing one), and on a spot
   * Chromium names nothing at, a picture or video Chromium doesn't see there
   * (a paused video's play button over it, an image viewer's picture that
   * doesn't take the pointer).
   */
  open(guest: WebContents, params: QAppMenuParams): void {
    if (this.locked || guest.isDestroyed()) return;
    if (!this.deps.guestInfo(guest)) return;
    const ticket = (this.rightClicks.get(guest) ?? 0) + 1;
    this.rightClicks.set(guest, ticket);
    const inMainFrame = !params.frame || params.frame === guest.mainFrame;
    // Chromium names a link only in an <a>; the app may show one otherwise.
    if (!inMainFrame || params.linkURL) {
      this.show(guest, params, inMainFrame);
      return;
    }
    void this.callGuest(
      guest,
      `at(${mayCoverMedia(params)})`,
      false,
      LOOKUP_MS
    ).then((found) => {
      // A newer right-click in this app meanwhile: that one's menu shows.
      if (this.rightClicks.get(guest) !== ticket) return;
      this.show(guest, withFound(params, found), inMainFrame);
    });
  }

  private show(
    guest: WebContents,
    params: QAppMenuParams,
    inMainFrame: boolean
  ): void {
    if (this.locked || guest.isDestroyed()) return;
    const info = this.deps.guestInfo(guest);
    if (!info) return;
    const items = menuItemsFor(params, info, {
      ...this.settings,
      inMainFrame,
    });
    if (!items.length) return;
    const hub = this.deps.hubPage();
    if (!hub || hub.isDestroyed()) return;
    this.forgetMenusOf(guest);
    this.forgetOldMenus();
    const menuId = randomUUID();
    this.menus.set(menuId, {
      guest,
      info,
      params,
      suggestions: spellingSuggestions(params),
      items,
      openedAt: Date.now(),
    });
    // The pointer as the window has it; the Hub page may be zoomed.
    const zoom = hub.getZoomFactor?.() || 1;
    const open: QAppMenuOpen = {
      menuId,
      tabId: info.tabId,
      x: Math.round(params.x / zoom),
      y: Math.round(params.y / zoom),
      items,
    };
    // The menu takes the keyboard (arrows, Escape) from the app.
    hub.focus();
    hub.send(QAPP_MENU_CHANNELS.open, open);
  }

  /**
   * The item chosen in a menu. Each menu takes one choice, from the items it
   * offered, while its app is still the page it was opened on.
   */
  async act(
    menuId: unknown,
    action: unknown,
    index?: unknown
  ): Promise<boolean | QAppMenuResult> {
    const record = this.takeMenu(menuId);
    if (!record || typeof action !== 'string') return false;
    const item = record.items.find(
      (entry): entry is QAppMenuEntry =>
        !isMenuSeparator(entry) &&
        entry.action === action &&
        (action !== 'replaceMisspelling' || entry.index === index)
    );
    if (!item || item.disabled) return false;
    const { guest, params, info } = record;
    switch (item.action) {
      case 'replaceMisspelling': {
        const word = record.suggestions[item.index];
        if (typeof word !== 'string') return false;
        // The right-click selected the misspelled word: typing the
        // suggestion over it replaces it (replaceMisspelling() doesn't reach
        // a webview's text box). The Hub page gave the app the keyboard.
        await guest.insertText(word);
        return true;
      }
      case 'addToDictionary':
        return guest.session.addWordToSpellCheckerDictionary(
          params.misspelledWord
        );
      case 'undo':
      case 'redo':
      case 'cut':
      case 'copy':
      case 'paste':
      case 'selectAll':
        guest[item.action]();
        return true;
      case 'copyPicture': {
        if (!params.foundPicture) {
          guest.copyImageAt(params.x, params.y);
          return true;
        }
        // Chromium finds no picture at the point: the app's preload draws
        // the one it found there.
        const image = await this.pixelsImage(guest, 'picture()');
        return image
          ? this.toClipboard(() => this.deps.writeClipboardImage(image))
          : false;
      }
      case 'copyLink': {
        const text = copyableLink(params.linkURL, info.nodeOrigin);
        if (!text) return false;
        return this.toClipboard(() => this.deps.writeClipboardText(text));
      }
      case 'openLink': {
        const open = openableLink(params.linkURL, info.nodeOrigin);
        return open ? { open } : false;
      }
      case 'openQortalLink': {
        const open = hubLink(params.linkURL, info.nodeOrigin);
        return open ? { open } : false;
      }
      case 'openWebLink': {
        const web = browserLink(params.linkURL, info.nodeOrigin);
        if (!web) return false;
        try {
          await this.deps.openInBrowser(web);
          return true;
        } catch {
          return false;
        }
      }
      case 'copyPictureLink': {
        const text = pictureEmbedLink(params.srcURL, info.nodeOrigin);
        if (!text) return false;
        return this.toClipboard(() => this.deps.writeClipboardText(text));
      }
      case 'copyVideoFrame': {
        const image = await this.pixelsImage(guest, 'videoFrame()');
        return image
          ? this.toClipboard(() => this.deps.writeClipboardImage(image))
          : false;
      }
      case 'saveVideoFrame':
        return this.saveVideoFrame(record);
      case 'pictureInPicture':
      case 'exitPictureInPicture':
        // Called as the user's own click: Chromium opens picture in
        // picture only for one.
        return (
          (await this.callGuest(
            guest,
            `pictureInPicture(${item.action === 'pictureInPicture'})`,
            true
          )) === true
        );
      case 'lookUp': {
        const lookUp = lookUpText(params.selectionText);
        return lookUp ? { lookUp } : false;
      }
      case 'askQortino': {
        const ask = this.settings.qortino && qortinoText(params.selectionText);
        return ask ? { ask } : false;
      }
      case 'aboutApp': {
        const open = appPageLink(info);
        return open ? { open } : false;
      }
      case 'copyElement': {
        if (!this.settings.devMode) return false;
        const described = readElementInfo(
          await this.callGuest(guest, 'describe()')
        );
        if (!described || this.gone(guest)) return false;
        const text = elementText(described, {
          appName: info.appName,
          service: info.service,
          page: shownPageLink(guest.getURL(), info.nodeOrigin),
        });
        return this.toClipboard(() => this.deps.writeClipboardText(text));
      }
      case 'copyElementPicture': {
        if (!this.settings.devMode) return false;
        const box = await this.callGuest(guest, 'box()');
        if (this.gone(guest)) return false;
        const rect = screenRect(box, zoomOf(guest));
        const image = rect ? await this.screenImage(guest, rect) : null;
        return image
          ? this.toClipboard(() => this.deps.writeClipboardImage(image))
          : false;
      }
      case 'inspectElement':
        if (!this.settings.devMode) return false;
        // The point as the right-click gave it (the window's): Electron
        // finds the element under it in the webview.
        guest.inspectElement(params.x, params.y);
        return true;
      default:
        if (!SAVE_ACTIONS.has(item.action)) return false;
        return this.save(
          record,
          item.action === 'saveLinkedFile' ? params.linkURL : params.srcURL
        );
    }
  }

  /**
   * A menu closed with nothing chosen. The Hub page gives its app the
   * keyboard back when the app is still on screen; main doesn't, so a hidden
   * tab never takes it.
   */
  dismiss(menuId: unknown): boolean {
    return this.takeMenu(menuId) !== null;
  }

  /**
   * A right-click on the menu's backdrop, passed on to the app under it at
   * that point of its page (CSS pixels), so the app's own menu opens there.
   * With Shift held, as it was: Hub's menu, even where the app has its own.
   */
  rightClickAt(
    guestId: unknown,
    x: unknown,
    y: unknown,
    shift?: unknown
  ): boolean {
    if (
      this.locked ||
      !Number.isSafeInteger(guestId) ||
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x > 100_000 ||
      y > 100_000
    ) {
      return false;
    }
    const guest = this.deps.guestById?.(guestId as number);
    if (!guest || guest.isDestroyed() || !this.deps.guestInfo(guest)) {
      return false;
    }
    const zoom = zoomOf(guest);
    const point = { x: Math.round(x * zoom), y: Math.round(y * zoom) };
    const modifiers: 'shift'[] = shift === true ? ['shift'] : [];
    guest.sendInputEvent({ type: 'mouseMove', ...point, modifiers });
    guest.sendInputEvent({
      type: 'mouseDown',
      ...point,
      button: 'right',
      clickCount: 1,
      modifiers,
    });
    guest.sendInputEvent({
      type: 'mouseUp',
      ...point,
      button: 'right',
      clickCount: 1,
      modifiers,
    });
    return true;
  }

  cancelSave(saveId: unknown): boolean {
    const save = typeof saveId === 'string' ? this.saves.get(saveId) : null;
    if (!save || save.state !== 'saving') return false;
    if (save.item) save.item.cancel();
    else save.stopWaiting?.();
    return true;
  }

  /**
   * One listener per app session: a download carrying a save's tag goes
   * where that save's dialog said; one that comes after its save ended
   * (cancelled, timed out) or a second one for the same save is stopped,
   * so Electron never opens a Save dialog of its own for it. Downloads the
   * page starts itself carry no tag and are left as they are.
   */
  private watchSession(session: Session) {
    if (this.watchedSessions.has(session)) return;
    this.watchedSessions.add(session);
    session.on('will-download', (event, item) => {
      const save = this.byTag.get(firstUrl(item));
      if (!save) return;
      if (save.state !== 'saving' || save.item) {
        event.preventDefault();
        return;
      }
      this.claim(save, item);
    });
  }

  private claim(save: SaveRecord, item: DownloadItem) {
    save.item = item;
    save.stopWaiting?.();
    save.stopWaiting = undefined;
    save.filePath = withFileExtension(
      save.chosenPath,
      item.getFilename(),
      this.deps.fileExists
    );
    save.name = path.basename(save.filePath);
    item.setSavePath(save.filePath);
    item.on('updated', () => {
      const total = item.getTotalBytes();
      if (total <= 0) return;
      const percent = Math.min(
        99,
        Math.floor((item.getReceivedBytes() / total) * 100)
      );
      if (percent === save.percent) return;
      save.percent = percent;
      save.tell();
    });
    item.once('done', (_done, state) => {
      this.end(
        save,
        state === 'completed'
          ? 'done'
          : state === 'cancelled'
            ? 'cancelled'
            : 'failed'
      );
    });
    save.tell();
  }

  private end(save: SaveRecord, state: QAppSaveState) {
    if (save.state !== 'saving') return;
    save.state = state;
    save.endedAt = Date.now();
    if (state === 'done') save.percent = 100;
    save.tell();
  }

  showSaved(saveId: unknown): boolean {
    const save = typeof saveId === 'string' ? this.saves.get(saveId) : null;
    if (!save || save.state !== 'done' || !save.filePath) return false;
    this.deps.showItemInFolder(save.filePath);
    return true;
  }

  /** While Hub is locked no menu opens, and none still open does anything. */
  setHubLocked(locked: boolean): void {
    this.locked = locked === true;
    if (this.locked) this.menus.clear();
  }

  /**
   * Hub's settings the menu follows: dev mode's items, and "Ask Qortino"
   * once Qortino AI is set up on this PC.
   */
  setSettings(value: unknown): boolean {
    const next =
      value && typeof value === 'object'
        ? (value as Partial<QAppMenuSettings>)
        : {};
    this.settings = {
      devMode: next.devMode === true,
      qortino: next.qortino === true,
    };
    return true;
  }

  /**
   * Calls the helper the app's preload set in its isolated world (fixed
   * calls only). Null when it doesn't answer in time; what it answers is
   * the page's, so it is checked before use.
   */
  private async callGuest(
    guest: WebContents,
    call: string,
    userGesture = false,
    timeoutMs?: number
  ): Promise<unknown> {
    if (guest.isDestroyed()) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        guest.executeJavaScriptInIsolatedWorld(
          QAPP_GUEST_ISOLATED_WORLD,
          [
            {
              code: `globalThis[${JSON.stringify(QAPP_MENU_GUEST_KEY)}]?.${call}`,
            },
          ],
          userGesture
        ),
        new Promise((resolve) => {
          timer = setTimeout(
            () => resolve(null),
            timeoutMs ?? this.deps.guestCallTimeoutMs ?? GUEST_CALL_TIMEOUT_MS
          );
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The app went away, or Hub locked, while main waited on something. */
  private gone(guest: WebContents) {
    return guest.isDestroyed() || this.locked;
  }

  /** What's on screen in that part of the webview. */
  private async screenImage(
    guest: WebContents,
    rect: Rectangle
  ): Promise<NativeImage | null> {
    try {
      if (this.gone(guest)) return null;
      const image = await guest.capturePage(rect);
      if (this.gone(guest) || !image || image.isEmpty()) return null;
      return image;
    } catch {
      return null;
    }
  }

  /**
   * A video's frame as it is, or the picture found at the right-click, at
   * its own size; what's on screen there when it can't be read (from
   * elsewhere). None when the app went away or Hub locked meanwhile.
   */
  private async pixelsImage(
    guest: WebContents,
    call: 'videoFrame()' | 'picture()'
  ): Promise<NativeImage | null> {
    const frame = await this.callGuest(guest, call);
    if (this.gone(guest)) return null;
    const png = (frame as { png?: unknown } | null)?.png;
    if (typeof png === 'string') {
      if (
        png.length > MAX_FRAME_DATA_URL ||
        !png.startsWith('data:image/png;base64,')
      ) {
        return null;
      }
      const image = this.deps.imageFromDataUrl(png);
      return image.isEmpty() ? null : image;
    }
    const rect = screenRect(frame, zoomOf(guest));
    return rect ? this.screenImage(guest, rect) : null;
  }

  /**
   * "Save video frame as…": the frame as it is when chosen, then the Save
   * dialog. The picture is written as a PNG made here, from its pixels.
   */
  private async saveVideoFrame(record: MenuRecord): Promise<boolean> {
    const { guest, info } = record;
    const image = await this.pixelsImage(guest, 'videoFrame()');
    if (!image) return false;
    const name = `${cleanFileName(info.appName) || 'Qortal'} ${stamp(
      this.now()
    )}.png`;
    const choice = await this.deps.showSaveDialog({
      defaultPath: path.join(this.deps.downloadsDir(), name),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (choice.canceled || !choice.filePath || this.locked) return false;
    const filePath = withFileExtension(
      choice.filePath,
      'frame.png',
      this.deps.fileExists
    );
    try {
      await this.deps.writeFile(filePath, image.toPNG());
    } catch {
      this.savedFile(filePath, 'failed');
      return false;
    }
    this.savedFile(filePath, 'done');
    return true;
  }

  /** A file written here (not downloaded), shown in the saves notice. */
  private savedFile(filePath: string, state: 'done' | 'failed') {
    const saveId = randomUUID();
    const save: SaveRecord = {
      name: path.basename(filePath),
      state,
      tagged: '',
      chosenPath: filePath,
      endedAt: Date.now(),
      ...(state === 'done' ? { filePath, percent: 100 } : {}),
      tell: () => {
        const hub = this.deps.hubPage();
        if (!hub || hub.isDestroyed()) return;
        const update: QAppSaveUpdate = {
          saveId,
          name: save.name,
          state: save.state,
          ...(save.percent === undefined ? {} : { percent: save.percent }),
          first: true,
        };
        hub.send(QAPP_MENU_CHANNELS.save, update);
      },
    };
    this.saves.set(saveId, save);
    this.forgetOldSaves();
    save.tell();
  }

  /** A clipboard write, as true once done, or false when it failed. */
  private async toClipboard(
    write: () => Promise<void> | void
  ): Promise<boolean> {
    try {
      await write();
      return true;
    } catch {
      return false;
    }
  }

  private takeMenu(menuId: unknown): MenuRecord | null {
    if (typeof menuId !== 'string') return null;
    const record = this.menus.get(menuId);
    this.menus.delete(menuId);
    if (!record || this.locked) return null;
    if (Date.now() - record.openedAt > MENU_TTL_MS) return null;
    if (record.guest.isDestroyed()) return null;
    const info = this.deps.guestInfo(record.guest);
    if (
      !info ||
      info.tabId !== record.info.tabId ||
      info.nodeOrigin !== record.info.nodeOrigin
    ) {
      return null;
    }
    return record;
  }

  private forgetMenusOf(guest: WebContents) {
    for (const [menuId, record] of this.menus) {
      if (record.guest === guest) this.menus.delete(menuId);
    }
  }

  private forgetOldMenus() {
    const oldest = Date.now() - MENU_TTL_MS;
    for (const [menuId, record] of this.menus) {
      if (record.openedAt < oldest) this.menus.delete(menuId);
    }
  }

  private async save(record: MenuRecord, url: string): Promise<boolean> {
    const { guest, info, params } = record;
    if (!savableUrl(url, info.nodeOrigin)) return false;
    const name = saveFileName({
      url,
      appName: info.appName,
      now: this.now(),
      suggested: url === params.linkURL ? params.suggestedFilename : undefined,
    });
    const choice = await this.deps.showSaveDialog({
      defaultPath: path.join(this.deps.downloadsDir(), name),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (choice.canceled || !choice.filePath) return false;
    // Hub locked, or the app went away, while the dialog was open.
    if (this.locked || guest.isDestroyed()) return false;
    this.download(guest, url, choice.filePath);
    return true;
  }

  private download(guest: WebContents, url: string, chosenPath: string) {
    const saveId = randomUUID();
    let first = true;
    const save: SaveRecord = {
      name: path.basename(chosenPath),
      state: 'saving',
      // A link's own fragment means nothing to a download.
      tagged: `${url.split('#')[0]}${SAVE_TAG}${saveId}`,
      chosenPath,
      tell: () => {
        const hub = this.deps.hubPage();
        if (!hub || hub.isDestroyed()) return;
        const update: QAppSaveUpdate = {
          saveId,
          name: save.name,
          state: save.state,
          ...(save.percent === undefined ? {} : { percent: save.percent }),
          ...(first ? { first: true } : {}),
        };
        first = false;
        hub.send(QAPP_MENU_CHANNELS.save, update);
      },
    };
    this.saves.set(saveId, save);
    this.byTag.set(save.tagged, save);
    this.forgetOldSaves();
    this.watchSession(guest.session);
    const timer = setTimeout(
      () => stopWaiting('failed'),
      this.deps.saveStartTimeoutMs ?? SAVE_START_TIMEOUT_MS
    );
    const stopWaiting = (state: QAppSaveState) => {
      clearTimeout(timer);
      if (!save.item) this.end(save, state);
    };
    save.stopWaiting = () => stopWaiting('cancelled');
    save.tell();
    try {
      guest.downloadURL(save.tagged);
    } catch {
      stopWaiting('failed');
    }
  }

  private forgetOldSaves() {
    const oldest = Date.now() - LATE_DOWNLOAD_MS;
    for (const [tagged, save] of this.byTag) {
      if (save.endedAt !== undefined && save.endedAt < oldest) {
        this.byTag.delete(tagged);
      }
    }
    if (this.saves.size <= MAX_SAVES_KEPT) return;
    for (const [saveId, save] of this.saves) {
      if (this.saves.size <= MAX_SAVES_KEPT) break;
      if (save.state !== 'saving') this.saves.delete(saveId);
    }
  }
}

export function registerQAppMenuIpc({
  ipcMain,
  checkSender,
  menus,
}: {
  ipcMain: Pick<IpcMain, 'handle'>;
  checkSender: (event: IpcMainInvokeEvent) => void;
  menus: QAppContextMenus;
}): void {
  const handle = (channel: string, handler: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      checkSender(event);
      return handler(...args);
    });
  handle(QAPP_MENU_CHANNELS.act, (menuId, action, index) =>
    menus.act(menuId, action, index)
  );
  handle(QAPP_MENU_CHANNELS.dismiss, (menuId) => menus.dismiss(menuId));
  handle(QAPP_MENU_CHANNELS.cancelSave, (saveId) => menus.cancelSave(saveId));
  handle(QAPP_MENU_CHANNELS.showSaved, (saveId) => menus.showSaved(saveId));
  handle(QAPP_MENU_CHANNELS.hubLocked, (locked) => {
    menus.setHubLocked(locked === true);
    return true;
  });
  handle(QAPP_MENU_CHANNELS.rightClick, (guestId, x, y, shift) =>
    menus.rightClickAt(guestId, x, y, shift)
  );
  handle(QAPP_MENU_CHANNELS.settings, (settings) =>
    menus.setSettings(settings)
  );
}

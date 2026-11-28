/**
 * What main and the Hub page tell each other about the right-click menu
 * inside Q-Apps and websites (qapp-context-menu.ts). Types only: the Hub
 * page imports this file too.
 */

export const QAPP_MENU_CHANNELS = {
  /** main → Hub page: show a menu (QAppMenuOpen). */
  open: 'qappMenu:open',
  /** main → Hub page: a save's progress (QAppSaveUpdate). */
  save: 'qappMenu:save',
  /** Hub page → main: the item chosen in a menu. */
  act: 'qappMenu:act',
  /** Hub page → main: a menu closed with nothing chosen. */
  dismiss: 'qappMenu:dismiss',
  cancelSave: 'qappMenu:cancelSave',
  showSaved: 'qappMenu:showSaved',
  /** Hub page → main: Hub locked or unlocked. */
  hubLocked: 'qappMenu:hubLocked',
  /**
   * Hub page → main: a right-click on the closing menu's backdrop, passed on
   * to the app under it, so its menu opens there.
   */
  rightClick: 'qappMenu:rightClick',
  /** Hub page → main: Hub's settings the menu follows (QAppMenuSettings). */
  settings: 'qappMenu:settings',
} as const;

/**
 * The global the app's preload sets in its isolated world (where the page
 * can't reach it) for the items that act on the element right-clicked
 * (qapp-menu-guest.ts). Main calls it with executeJavaScriptInIsolatedWorld.
 */
export const QAPP_MENU_GUEST_KEY = '__qortalHubMenu';
/** Electron's isolated world, where the app's preload runs. */
export const QAPP_GUEST_ISOLATED_WORLD = 999;
/**
 * A menu left open this long does nothing: main forgets it, and the Hub page
 * closes it a moment before.
 */
export const QAPP_MENU_TTL_MS = 2 * 60_000;

export type QAppMenuAction =
  | 'replaceMisspelling'
  | 'addToDictionary'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'savePicture'
  | 'copyPicture'
  | 'saveVideo'
  | 'saveSound'
  | 'saveLinkedFile'
  | 'copyLink'
  | 'openLink'
  | 'openQortalLink'
  | 'openWebLink'
  | 'copyPictureLink'
  | 'copyVideoFrame'
  | 'saveVideoFrame'
  | 'pictureInPicture'
  | 'exitPictureInPicture'
  | 'lookUp'
  | 'askQortino'
  | 'aboutApp'
  | 'copyElement'
  | 'copyElementPicture'
  | 'inspectElement';

export type QAppMenuEntry = {
  action: QAppMenuAction;
  disabled?: boolean;
  /**
   * Why an item can't be used: the app plays it in parts (a stream), or it
   * hasn't loaded.
   */
  reason?: 'streamed';
  /** A spelling suggestion's place in the list. */
  index?: number;
  /**
   * The text the item shows: a spelling suggestion, the name or address to
   * look up, or the app's name ("About Q-Tube").
   */
  label?: string;
};

export type QAppMenuItem = QAppMenuEntry | { separator: true };

export type QAppMenuOpen = {
  menuId: string;
  /** The tab whose app was right-clicked. */
  tabId: string;
  /** Where the pointer was, in the Hub page's CSS pixels. */
  x: number;
  y: number;
  items: QAppMenuItem[];
};

export type QAppSaveState = 'saving' | 'done' | 'failed' | 'cancelled';

export type QAppSaveUpdate = {
  saveId: string;
  /** The saved file's name (not its folder). */
  name: string;
  state: QAppSaveState;
  /** 0 to 100, when the size is known. */
  percent?: number;
  /**
   * Set on a save's first update only: a page that comes later (another
   * account signed in) doesn't take up a save it never saw starting.
   */
  first?: boolean;
};

/** Hub's settings the menu follows, sent by the Hub page. */
export type QAppMenuSettings = {
  /** Hub's dev mode: the items for developers show. */
  devMode: boolean;
  /** Qortino AI can answer on this PC: "Ask Qortino" shows. */
  qortino: boolean;
};

/** What a menu is built with besides what was right-clicked. */
export type QAppMenuContext = QAppMenuSettings & {
  /**
   * The right-click was in the app's own page, not a frame inside it: only
   * there does the app's preload know the element (it runs in the page).
   */
  inMainFrame?: boolean;
};

/**
 * What the Hub page does once main has acted, for the items Hub's page
 * carries out: open a qortal:// link with Hub's link opener, look up a name
 * or address, ask Qortino. Main read each from the right-click and checked
 * it; the other items answer true or false.
 */
export type QAppMenuResult =
  | { open: string }
  | { lookUp: string }
  | { ask: string };

/** What the element right-clicked is, for "Copy element description". */
export type QAppElementInfo = {
  /** Its tag, lowercase. */
  tag: string;
  /** What it says or is called (never what was typed into it). */
  name: string;
  role: string;
  selector: string;
  /** Its box in the page's CSS pixels, from the window's top left. */
  box: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  style: { color: string; background: string; font: string };
  /** Its HTML, with what was typed into fields left out, cut when long. */
  html: string;
  cut: boolean;
  title: string;
};

/** The box of what was right-clicked, in the page's CSS pixels. */
export type QAppElementBox = {
  box: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
};

/**
 * A picture's or a video frame's pixels: a PNG, or where it is on screen
 * when they can't be read.
 */
export type QAppPixels = { png: string } | QAppElementBox;

/**
 * The video under the pointer, also one under what covers it (a play button,
 * a player's own layer) or one that doesn't take the pointer: what the menu
 * needs to offer the video's items.
 */
export type QAppVideoAt = {
  /** Where it plays from; empty while it has none. */
  src: string;
  /** Fed in parts by the app (MediaSource) or live: no file to save. */
  stream: boolean;
  /** True once sound was heard; null when not known yet. */
  hasAudio: boolean | null;
  error: boolean;
  pictureInPicture: 'can' | 'showing' | 'no';
};

/**
 * A picture under the pointer that Chromium doesn't name: one that doesn't
 * take the pointer (an image viewer's, which moves the picture itself), or
 * one under a cover.
 */
export type QAppPictureAt = {
  /** Where it was loaded from; empty when it has none, or it is too long. */
  src: string;
  /** Loaded, so it can be copied. */
  loaded: boolean;
};

/**
 * What the app shows at the right-click besides what Chromium names: a
 * picture or a video (at most one of them), and a link not in an <a> (an
 * attribute, a link written as text, a box showing one).
 */
export type QAppFoundAt = {
  video: QAppVideoAt | null;
  picture: QAppPictureAt | null;
  link: string | null;
};

/** What the app's preload offers main (QAPP_MENU_GUEST_KEY). */
export type QAppMenuGuestHelper = {
  at: (wantMedia: boolean) => Promise<QAppFoundAt>;
  describe: () => QAppElementInfo | null;
  box: () => QAppElementBox | null;
  videoFrame: () => QAppPixels | null;
  /** The picture the latest at() found, for "Copy picture". */
  picture: () => QAppPixels | null;
  videoAt: () => Promise<QAppVideoAt | null>;
  pictureInPicture: (on: boolean) => Promise<boolean>;
};

export const isMenuSeparator = (
  item: QAppMenuItem
): item is { separator: true } => 'separator' in item;

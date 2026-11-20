/**
 * The app that asks for an approval, as the approval dialog names it.
 *
 * The name and service come only from the tab the request came from (the
 * `appInfo` Hub attaches to every Q-App request), never from what the app
 * sends, so an app can't claim to be another one.
 */
export type RequestingApp = {
  name: string;
  /** QDN service such as APP or WEBSITE, or null when unknown. */
  service: string | null;
};

// Control characters, zero-width characters, bidi controls, fillers and tags
// that draw nothing, which could hide, pad or reorder part of a name
// ("Q-Wallets" + a right-to-left override). Built from code points so this
// file holds no invisible characters itself.
const HIDDEN_CHARACTERS = new RegExp(
  '[' +
    [
      '\\u0000-\\u001f',
      '\\u007f-\\u009f',
      '\\u00ad',
      '\\u061c',
      // Hangul choseong / jungseong fillers.
      '\\u115f-\\u1160',
      // Mongolian vowel separator.
      '\\u180e',
      '\\u200b-\\u200f',
      '\\u2028-\\u202e',
      '\\u2060-\\u206f',
      // Braille blank.
      '\\u2800',
      // Hangul filler.
      '\\u3164',
      '\\ufeff',
      // Halfwidth Hangul filler.
      '\\uffa0',
      '\\ufff9-\\ufffb',
      // Musical symbol format characters.
      '\\u{1d173}-\\u{1d17a}',
      // Tag characters.
      '\\u{e0000}-\\u{e007f}',
    ].join('') +
    ']',
  'gu'
);

// Marks that draw nothing: the combining grapheme joiner, Khmer inherent
// vowels and variation selectors. Kept apart so the class holds only marks.
const HIDDEN_MARKS = new RegExp(
  '[' +
    [
      '\\u034f',
      '\\u17b4-\\u17b5',
      '\\u180b-\\u180d',
      '\\u180f',
      '\\ufe00-\\ufe0f',
      '\\u{e0100}-\\u{e01ef}',
    ].join('') +
    ']',
  'gu'
);

/** Qortal names are at most 40 characters; anything longer is cut. */
const MAX_APP_NAME_CHARACTERS = 48;

const SERVICE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;

/**
 * The `appInfo` Hub's own pages pass when they send a request themselves
 * (Minting, a group chat image, the Torq composer). The dialog then names no
 * app. A Q-App's or widget's request always carries the `appInfo` Hub builds
 * from its tab, which never has this field.
 */
export const HUB_REQUEST = { fromHub: true } as const;

/** True when Hub itself sent the request, with HUB_REQUEST as its appInfo. */
export const isHubRequest = (appInfo: unknown): boolean =>
  !!appInfo &&
  typeof appInfo === 'object' &&
  (appInfo as { fromHub?: unknown }).fromHub === true;

/** The app to show for a request, from the request's `appInfo` only. */
export function requestingAppFromAppInfo(
  appInfo: unknown
): RequestingApp | null {
  if (!appInfo || typeof appInfo !== 'object') return null;
  const { name, service } = appInfo as { name?: unknown; service?: unknown };
  if (typeof name !== 'string') return null;
  const visible = name
    .replace(HIDDEN_CHARACTERS, '')
    .replace(HIDDEN_MARKS, '')
    .trim();
  if (!visible) return null;
  const characters = Array.from(visible);
  const cleanName =
    characters.length > MAX_APP_NAME_CHARACTERS
      ? `${characters.slice(0, MAX_APP_NAME_CHARACTERS).join('')}…`
      : visible;
  const serviceText =
    typeof service === 'string' ? service.trim().toUpperCase() : '';
  return {
    name: cleanName,
    service: SERVICE_PATTERN.test(serviceText) ? serviceText : null,
  };
}

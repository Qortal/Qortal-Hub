import { QORTAL_PROTOCOL } from '../../../constants/constants';
import { executeEvent } from '../../../utils/events';
import { normalizeAppService } from './appPageIds';

/**
 * `qortal://use-app-page/<SERVICE>/<name>` opens an app's or website's page
 * in the library (screenshots, ratings) instead of the app itself,
 * like the existing `qortal://use-group/...` links do for groups.
 */

const PAGE_LINK_PATTERN =
  /^qortal:\/\/use-app-page\/(app|website)\/([^/?#]+)\/?$/i;

export const buildAppPageLink = (service: string, name: string) =>
  `${QORTAL_PROTOCOL}use-app-page/${normalizeAppService(service)}/${encodeURIComponent(name)}`;

export const buildAppOpenLink = (service: string, name: string) =>
  `${QORTAL_PROTOCOL}${normalizeAppService(service)}/${encodeURIComponent(name)}`;

const decodeName = (value: string): string | null => {
  try {
    const name = decodeURIComponent(value.replace(/\+/g, '%20')).trim();
    return name && name.length <= 128 ? name : null;
  } catch {
    return null;
  }
};

export const parseAppPageLink = (
  input: string | null | undefined
): { service: string; name: string } | null => {
  // Chat leaves a sentence's punctuation on a link: "…/Q-Blog," still opens.
  const match = String(input || '')
    .trim()
    .replace(/[),.;!?]+$/, '')
    .match(PAGE_LINK_PATTERN);
  if (!match) return null;
  const name = decodeName(match[2]);
  return name ? { service: match[1].toUpperCase(), name } : null;
};

/**
 * Opens the page of an app or website, from anywhere in Hub. The apps view
 * puts the page in front of any tab that was on screen.
 */
export const openAppPage = (app: { service: string; name: string }) => {
  executeEvent('open-apps-mode', {});
  // The apps view may only now be shown; give it a moment to listen.
  setTimeout(() => {
    executeEvent('selectedAppInfo', {
      data: { name: app.name, service: normalizeAppService(app.service) },
    });
  }, 0);
};

export const openAppPageLink = (input: string | null | undefined) => {
  const app = parseAppPageLink(input);
  if (!app) return false;
  openAppPage(app);
  return true;
};

const LINK_PATTERN = /\b(?:https?:\/\/|qortal:\/\/)[^\s<>"'`]+/gi;

export type TextPart = { kind: 'text' | 'link'; value: string };

/** Text split around the http(s) and qortal:// links in it. */
export const splitTextLinks = (text: string): TextPart[] => {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    let link = match[0];
    // Sentence punctuation right after a link isn't part of it.
    const trailing = link.match(/[.,;:!?)\]]+$/);
    if (trailing) link = link.slice(0, -trailing[0].length);
    const start = match.index ?? 0;
    if (start > last)
      parts.push({ kind: 'text', value: text.slice(last, start) });
    parts.push({ kind: 'link', value: link });
    last = start + link.length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  return parts;
};

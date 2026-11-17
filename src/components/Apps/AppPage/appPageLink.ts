import { QORTAL_PROTOCOL } from '../../../constants/constants';
import { executeEvent } from '../../../utils/events';
import { inLauncherTab } from '../launcherTabs';
import { openHttpUrlExternally } from '../../../utils/openExternalHttp';
import { openQortalUseGroupLink } from '../../../utils/openQortalUseGroupLink';
import { normalizeAppService } from './appPageIds';

/**
 * `qortal://use-app-page/<SERVICE>/<name>` opens an app's or website's page
 * in the library (screenshots, ratings, reviews) instead of the app itself,
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
 * puts the page in front of any tab that was on screen. From a page in a
 * launcher tab (`launcherTabId`), the new page takes that one's place.
 */
export const openAppPage = (
  app: { service: string; name: string },
  launcherTabId: string | null = null
) => {
  executeEvent('open-apps-mode', {});
  // The apps view may only now be shown; give it a moment to listen.
  setTimeout(() => {
    executeEvent('selectedAppInfo', {
      data: inLauncherTab(
        { name: app.name, service: normalizeAppService(app.service) },
        launcherTabId
      ),
    });
  }, 0);
};

export const openAppPageLink = (
  input: string | null | undefined,
  launcherTabId: string | null = null
) => {
  const app = parseAppPageLink(input);
  if (!app) return false;
  openAppPage(app, launcherTabId);
  return true;
};

/** A plain qortal://SERVICE/name/path link as a tab to open. */
export const parseQortalResourceLink = (input: string) => {
  const trimmed = input.trim();
  if (!/^qortal:\/\//i.test(trimmed)) return null;
  const rest = trimmed.replace(/^qortal:\/\//i, '');
  if (!rest || /^use-/i.test(rest)) return null;
  const [basePart, query = ''] = rest.split('?');
  const parts = basePart.split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  const service = parts[0].toUpperCase();
  const name = decodeName(parts[1]);
  if (!name || !/^[A-Z_]{2,32}$/.test(service)) return null;
  const params = new URLSearchParams(query);
  const identifier = params.get('identifier') || undefined;
  params.delete('identifier');
  const remaining = params.toString();
  const path = `${parts.slice(2).join('/')}${remaining ? `?${remaining}` : ''}`;
  return { service, name, identifier, path };
};

/**
 * Opens a link from a page's text or the publisher's links: page links and
 * group links inside Hub, other qortal:// links in a tab, web links outside.
 */
export const openPageTextLink = async (
  href: string,
  launcherTabId: string | null = null
) => {
  if (openAppPageLink(href, launcherTabId)) return;
  if (/^qortal:\/\//i.test(href)) {
    try {
      if (await openQortalUseGroupLink(href)) return;
    } catch {
      // Not a group link Hub can open; try it as a resource.
    }
    const resource = parseQortalResourceLink(href);
    if (resource) {
      executeEvent('addTab', { data: inLauncherTab(resource, launcherTabId) });
      executeEvent('open-apps-mode', {});
    }
    return;
  }
  if (/^https?:\/\//i.test(href)) openHttpUrlExternally(href);
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

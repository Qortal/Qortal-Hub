import { QORTAL_PROTOCOL } from '../../constants/constants';
import { parseAppPageLink } from '../../components/Apps/AppPage/appPageLink';
import { parseQortalUseGroupLink } from '../qortalGroupLinks';

/**
 * Reading qortal:// links: one parser for every place in Hub that opens them
 * (the top bar, the launcher's search, chat, an app's page, a Q-App's
 * OPEN_NEW_TAB and notifications), so a link opens the same way from all of
 * them. `openQortalLink.ts` opens what this reads.
 */

// Decode the name once, after splitting the URI into segments. Decoding the
// whole link would turn escaped route/query delimiters into URL structure.
const decodeQortalName = (name: string): string => {
  try {
    return decodeURIComponent(name);
  } catch {
    // Retain compatibility with literal percent signs in unescaped names.
    return name;
  }
};

// The protocol is read in any case: QORTAL://APP/Q-Tube works too.
const QORTAL_LINK_PATTERN = /^qortal:\/\//i;
const QORTAL_USE_LINK_PATTERN = /^qortal:\/\/use-/i;

export const extractComponents = (url: string) => {
  if (!url || !QORTAL_LINK_PATTERN.test(url)) {
    return null;
  }

  // Skip links starting with "qortal://use-"
  if (QORTAL_USE_LINK_PATTERN.test(url)) {
    return null;
  }

  // Remove protocol prefix
  url = url.replace(/^qortal:\/\/?/i, '').trim();

  // If nothing meaningful left (e.g., "qortal://", "qortal:////"), return null
  if (!/[^/]/.test(url)) return null;

  // Case 1: url contains a slash -> already service-based
  if (url.includes('/')) {
    // Identifier is part of QDN resource identity when present. Keep older
    // links without identifier working, and route future reopen flows here.
    const [basePart, queryString = ''] = url.split('?');
    const parts = basePart.split('/');
    const service = parts[0].toUpperCase();
    parts.shift();
    const name = decodeQortalName(parts[0] ?? '');
    parts.shift();

    const params = new URLSearchParams(queryString);
    const identifier = params.get('identifier') || undefined;
    if (identifier) {
      params.delete('identifier');
    }

    const remainingQuery = params.toString();
    const basePath = parts.join('/');
    const path = `${basePath}${remainingQuery ? `?${remainingQuery}` : ''}`;

    return { service, name, identifier, path };
  }

  // Case 2: url is just a username -> default to WEBSITE
  return {
    service: 'WEBSITE',
    name: decodeQortalName(url),
    identifier: undefined,
    path: '',
  };
};

/** A Q-App, website or other resource a link opens in a tab. */
export type QortalResource = {
  service: string;
  name: string;
  identifier?: string;
  path: string;
};

/** A qortal:// link, read: what it opens. */
export type QortalLink =
  | ({ kind: 'resource'; link: string } & QortalResource)
  /** An app's or website's page in the library: qortal://use-app-page/… */
  | { kind: 'page'; link: string; service: string; name: string }
  /** A group's link, to join it or to an event of its calendar. */
  | { kind: 'group'; link: string };

/**
 * What a qortal:// link opens, or null for anything else (search words, web
 * links, embeds). The protocol may be in any letter case.
 */
export const parseQortalLink = (
  input: string | null | undefined
): QortalLink | null => {
  const text = String(input ?? '').trim();
  if (!QORTAL_LINK_PATTERN.test(text)) return null;
  const link = QORTAL_PROTOCOL + text.replace(QORTAL_LINK_PATTERN, '');

  const page = parseAppPageLink(link);
  if (page) return { kind: 'page', link, ...page };
  if (parseQortalUseGroupLink(link)) return { kind: 'group', link };

  const parts = extractComponents(link);
  if (!parts?.service || !parts?.name) return null;
  return {
    kind: 'resource',
    link,
    service: parts.service,
    name: parts.name,
    identifier: parts.identifier,
    path: parts.path,
  };
};

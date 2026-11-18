import { openAppPage } from '../../components/Apps/AppPage/appPageLink';
import { executeEvent } from '../events';
import { openHttpUrlExternally } from '../openExternalHttp';
import { openQortalUseGroupLink } from '../openQortalUseGroupLink';
import {
  parseQortalLink,
  type QortalLink,
  type QortalResource,
} from './parseQortalLink';

/**
 * Opening qortal:// links: one opener for every place in Hub that opens them,
 * so each kind of link works the same from all of them, and a new kind is
 * added here once.
 *
 * Nothing a link opens acts by itself. A Q-App or website, or an app's page,
 * only shows; a group's link opens the group for its members, and for anyone
 * else a window that asks before joining and shows the fee. A group's link a
 * Q-App opens (OPEN_NEW_TAB, `fromApp`) only opens that window, for members
 * too, and never one in place of a window that is open. Keep it so for any
 * kind added here.
 */

export type OpenQortalLinkOptions = {
  /** How a Q-App or website opens from here; by default in a tab of its own. */
  openResource?: (resource: QortalResource) => void;
  /** How an app's page opens from here; by default in the apps view. */
  openPage?: (page: { service: string; name: string }) => void;
  /** An app that is open already shows the link's page in its tab. */
  navigateIfAlreadyOpen?: boolean;
  /**
   * Opened at a Q-App's or a Home widget's request (OPEN_NEW_TAB), not by the
   * user: a group's link then only opens the group's join window.
   */
  fromApp?: boolean;
};

/** A Q-App or website in a tab of its own, as Hub opens one from a link. */
export const openResourceInTab = (
  resource: QortalResource,
  navigateIfAlreadyOpen = false
) => {
  const { service, name, identifier, path } = resource;
  executeEvent('addTab', {
    data: {
      service,
      name,
      identifier,
      path,
      ...(navigateIfAlreadyOpen ? { navigateIfAlreadyOpen: true } : {}),
    },
  });
  executeEvent('open-apps-mode', {});
};

/**
 * Opens a qortal:// link of any kind: a Q-App or website, an app's page, or
 * a group's link (join, calendar event). Resolves false when the text is no
 * qortal:// link Hub opens, or when a group's link couldn't open.
 */
export async function openQortalLink(
  input: string | QortalLink | null | undefined,
  options: OpenQortalLinkOptions = {}
): Promise<boolean> {
  // A link read before is read again from its text, so only what the parser
  // reads opens, whatever else was passed in (a Q-App's request, a node's
  // notification).
  const link = parseQortalLink(typeof input === 'string' ? input : input?.link);
  if (!link) return false;

  if (link.kind === 'page') {
    (options.openPage ?? openAppPage)({
      service: link.service,
      name: link.name,
    });
    return true;
  }

  if (link.kind === 'group') {
    try {
      if (options.fromApp) {
        return await openQortalUseGroupLink(link.link, { fromApp: true });
      }
      return await openQortalUseGroupLink(link.link);
    } catch (error) {
      console.error('Could not open the group link', error);
      return false;
    }
  }

  if (options.openResource) options.openResource(link);
  else openResourceInTab(link, options.navigateIfAlreadyOpen);
  return true;
}

/**
 * A link in a text, such as an app page's About or its publisher's links:
 * qortal:// links open in Hub, web links in the browser.
 */
export async function openTextLink(
  href: string,
  options: OpenQortalLinkOptions = {}
): Promise<void> {
  if (await openQortalLink(href, options)) return;
  if (/^https?:\/\//i.test(href)) openHttpUrlExternally(href);
}

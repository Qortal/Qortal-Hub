/**
 * The search bar's magnifier: what it shows, and how. Main keeps the zooms
 * (electron/src/hub-zoom.ts); the Hub page tells it which app tab is on
 * screen and shows the zoom of that app, or Hub's.
 */

/** As main answers: the Hub's zoom, and the zoom of an app on top of it. */
export type HubZoomState = {
  hub: { level: number; canIn: boolean; canOut: boolean };
  /** Null while no app's tab is on screen, or its app isn't loaded yet. */
  app: { level: number; canIn: boolean; canOut: boolean } | null;
};

/** `load`: a page loaded or the saved levels were read; nothing to show. */
export type HubZoomSource = 'keys' | 'menu' | 'wheel' | 'panel' | 'load';

/**
 * Sent by main after every change. `pointer`: the pointer left the magnifier
 * or its panel straight onto an app's page, which the Hub page doesn't see.
 */
export type HubZoomChange =
  | { what: 'hub'; source: HubZoomSource }
  | { what: 'app'; key: string; tabIds: string[]; source: HubZoomSource }
  | { what: 'pointer' };

/** The fields of a tab the magnifier reads. */
export type HubZoomTab = {
  tabId?: string;
  name?: string;
  service?: string;
  internal?: string;
  privateAppProperties?: { appName?: string; name?: string } | null;
} | null;

/** Hub-owned surfaces in the tab strip (Q-Chat), not Q-Apps. */
const INTERNAL_TAB_SERVICE = 'INTERNAL';

/**
 * The tab of the Q-App or website on screen, or null for Home, Q-Chat, a
 * launcher tab or any other of Hub's own pages.
 */
export function appTabOnScreen(
  desktopViewMode: string,
  tab: HubZoomTab
): string | null {
  if (desktopViewMode !== 'apps' && desktopViewMode !== 'dev') return null;
  if (!tab?.tabId || typeof tab.tabId !== 'string') return null;
  if (tab.internal || tab.service === INTERNAL_TAB_SERVICE) return null;
  return tab.tabId;
}

/** The name the panel shows for the app on screen. */
export function appNameOf(tab: HubZoomTab): string {
  return tab?.privateAppProperties?.appName || tab?.name || '';
}

/**
 * Whether the keyboard is in one of Hub's windows, dialogs or menus (a MUI
 * modal), where the zoom keys zoom Hub. The magnifier's own panel isn't one.
 */
export function isInHubWindow(element: Element | null): boolean {
  return !!element?.closest?.('.MuiModal-root');
}

/** As Chromium compares zoom levels. */
export const isNormalZoom = (level: number) => Math.abs(level) < 0.001;

/** A zoom level as a percent, in the language's own way of writing it. */
export function formatZoomPercent(level: number, language: string): string {
  const factor = 1.2 ** level;
  try {
    return new Intl.NumberFormat(language, {
      maximumFractionDigits: 0,
      style: 'percent',
    }).format(factor);
  } catch {
    return `${Math.round(factor * 100)}%`;
  }
}

/**
 * Whether the magnifier shows by itself: the Q-App or website on screen isn't
 * at Hub's zoom. Hub's own zoom has no magnifier.
 */
export function appOffHubZoom(
  tabId: string | null,
  state: HubZoomState | null
): boolean {
  return !!tabId && !!state?.app && !isNormalZoom(state.app.level);
}

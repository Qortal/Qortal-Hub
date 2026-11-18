/**
 * The launcher's pages. Each launcher tab is on one of them (launcherTabs.ts):
 * the launcher itself, or a page opened from it. Dev Mode's `mode` uses the
 * same names for its own pages.
 */

/** The pages opened from the launcher: Back returns from them to it. */
export const LAUNCHER_SUB_PAGE_MODES = [
  'category',
  'appInfo-from-category',
  'appInfo',
  'publish',
  'publish-app',
  'publish-website',
  'publish-widget',
];

export const isLauncherSubPage = (mode: string): boolean =>
  LAUNCHER_SUB_PAGE_MODES.includes(mode);

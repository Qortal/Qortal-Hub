/**
 * Where the launcher stands among the Apps pages. `mode` is the page the Apps
 * view is on: 'home' and 'library' are both the launcher now, 'viewer' shows
 * the open tabs, and the rest are the pages opened from the launcher.
 */

/** The pages opened from the launcher: Back returns from them to it. */
export const LAUNCHER_SUB_PAGE_MODES = [
  'category',
  'appInfo-from-category',
  'appInfo',
  'publish',
  'publish-app',
  'publish-website',
];

export const isLauncherSubPage = (mode: string): boolean =>
  LAUNCHER_SUB_PAGE_MODES.includes(mode);

type AppsViewState = {
  desktopViewMode: string;
  mode: string;
  hasSelectedTab: boolean;
  /** True while a new tab is being chosen and the open tabs are set aside. */
  isNewTabWindow: boolean;
};

/**
 * The launcher shows as the start page, as the page the library pages return
 * to, and in place of the open tabs while a new tab is being chosen.
 */
export const isLauncherShown = ({
  desktopViewMode,
  mode,
  hasSelectedTab,
  isNewTabWindow,
}: AppsViewState): boolean =>
  desktopViewMode === 'apps' &&
  (mode === 'home' ||
    (mode === 'library' && !hasSelectedTab) ||
    (mode === 'viewer' && isNewTabWindow));

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { HomeWindowId } from './homeGrid';

/** Each Home window's name, as the settings and Edit Home show it. */
export const useHomeWindowTitles = (): Record<HomeWindowId, string> => {
  const { t } = useTranslation(['group']);
  return useMemo(
    () => ({
      account: t('group:dashboard.account_overview'),
      featured: t('group:dashboard.featured_q_apps'),
      feed: t('group:dashboard.torq_feed'),
      groupActivity: t('group:dashboard.group_activity_module'),
      qortino: t('group:dashboard.qortino_module'),
      status: t('group:dashboard.node_status'),
      tools: t('group:dashboard.quick_tools_module'),
      wallet: t('group:dashboard.wallet_activity'),
      widgets: t('group:dashboard.widgets_module'),
    }),
    [t]
  );
};

type ScreenRect = { height: number; left: number; top: number; width: number };

/** Windows this close count as one on top of the other. */
const STACKED_GAP_PX = 24;
const RAIL_MIN_WIDTH_PX = 300;
const RAIL_MIN_HEIGHT_PX = 480;

/**
 * Where Send and Receive open on Home, on screen: over Wallet Activity's
 * column, as they did over the old right-hand column. That is Wallet
 * Activity with the windows right above and below it in exactly the same
 * columns (Node Status, by default). Null when there's no such column, or
 * it's too small for them: they open in the middle of the window instead.
 */
export const homeWalletRailRect = (): ScreenRect | null => {
  if (typeof document === 'undefined') return null;
  const wallet = document.querySelector(
    '[data-home-layout="grid"] > [data-home-window="wallet"]'
  );
  if (!wallet?.parentElement) return null;
  const box = wallet.getBoundingClientRect();
  const column = Array.from(
    wallet.parentElement.querySelectorAll(':scope > [data-home-window]')
  )
    .map((frame) => frame.getBoundingClientRect())
    .filter(
      (rect) =>
        Math.abs(rect.left - box.left) < 1 &&
        Math.abs(rect.width - box.width) < 1
    );
  let top = box.top;
  let bottom = box.bottom;
  for (let grown = true; grown; ) {
    grown = false;
    for (const rect of column) {
      if (rect.bottom <= top + 0.5 && top - rect.bottom <= STACKED_GAP_PX) {
        top = rect.top;
        grown = true;
      }
      if (rect.top >= bottom - 0.5 && rect.top - bottom <= STACKED_GAP_PX) {
        bottom = rect.bottom;
        grown = true;
      }
    }
  }
  const rect = {
    height: bottom - top,
    left: box.left,
    top,
    width: box.width,
  };
  return rect.width >= RAIL_MIN_WIDTH_PX && rect.height >= RAIL_MIN_HEIGHT_PX
    ? rect
    : null;
};

/**
 * A container query for content in one of Home's windows (HomeGrid makes
 * each one a container named "home-window"): its styles apply while the
 * window is at least `px` wide.
 */
export const homeWindowWiderThan = (px: number) =>
  `@container home-window (min-width: ${px}px)`;

/** Applies while the window is less than `px` wide. */
export const homeWindowNarrowerThan = (px: number) =>
  `@container home-window (width < ${px}px)`;

/** Applies while the window is less than `px` tall. */
export const homeWindowShorterThan = (px: number) =>
  `@container home-window (height < ${px}px)`;

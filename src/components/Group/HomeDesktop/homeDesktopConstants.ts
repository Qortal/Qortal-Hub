import type { WidgetDisplayMode } from '../../Widgets/DashboardWidgetFrame';
import type { HomeCustomizableCardId } from './types';

/** Wide hub layout activates at this min viewport width (below theme xl / 1536). */
export const HOME_WIDE_DASHBOARD_MIN_WIDTH_PX = 1250;

export const INFO_PANEL_EXPAND_OPEN_DELAY_MS = 35;
export const INFO_PANEL_EXPAND_CLOSE_DELAY_MS = 60;
export const INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX = 52;

export const SYSTEM_BADGE_SX = {
  borderRadius: '4px',
  fontSize: '0.7rem',
  fontWeight: 700,
  height: '26px',
  letterSpacing: '0.05em',
  lineHeight: 1,
  px: '10px',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
} as const;

export const HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY =
  'home-dashboard-customizable-cards-layout-v1';
export const HOME_DASHBOARD_MODULE_VISIBILITY_CHANGE_EVENT =
  'home-dashboard-module-visibility-change';
/** Starts editing Home's layout (executeEvent; the Modules settings send it). */
export const HOME_EDIT_LAYOUT_EVENT = 'homeEditLayout';
export const HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY =
  'home-dashboard-module-group-activity-visible';
export const HOME_QUITTER_FEED_VISIBLE_STORAGE_KEY =
  'home-dashboard-module-quitter-feed-visible';
export const HOME_WIDGETS_VISIBLE_STORAGE_KEY =
  'home-dashboard-module-widgets-visible';
export const HOME_DASHBOARD_WIDGET_HEIGHT_PX = 612;
export const HOME_DASHBOARD_WIDGET_DISPLAY_MODE: WidgetDisplayMode = 'expanded';
export const HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS: Record<
  HomeCustomizableCardId,
  number
> = {
  groupActivity: HOME_DASHBOARD_WIDGET_HEIGHT_PX,
  quitter: HOME_DASHBOARD_WIDGET_HEIGHT_PX,
};
export const HOME_CUSTOMIZABLE_CARD_MAX_HEIGHTS: Record<
  HomeCustomizableCardId,
  number
> = {
  groupActivity: HOME_DASHBOARD_WIDGET_HEIGHT_PX,
  quitter: HOME_DASHBOARD_WIDGET_HEIGHT_PX,
};
export const HOME_QUITTER_WIDGET_INITIAL_BATCH_SIZES: Record<
  WidgetDisplayMode,
  number
> = {
  compact: 6,
  expanded: 8,
};
export const HOME_QUITTER_WIDGET_LOAD_MORE_BATCH_SIZES: Record<
  WidgetDisplayMode,
  number
> = {
  compact: 4,
  expanded: 4,
};
export const HOME_QUITTER_WIDGET_SEARCH_LIMITS: Record<
  WidgetDisplayMode,
  number
> = {
  compact: 6,
  expanded: 8,
};
export const WALLET_ACTIVITY_RECENT_PAYMENT_LOOKBACK_MS =
  7 * 24 * 60 * 60 * 1000;
export const WALLET_ACTIVITY_RECENT_PAYMENT_FETCH_LIMIT = 50;
export const INFO_VALUE_COLUMN_MIN_WIDTH_PX = 136;

export const DASHBOARD_MINTER_DEFAULT_VIEW_STORAGE_KEY =
  'dashboardMinterDefaultView';
export const HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT: HomeCustomizableCardId[] = [
  'groupActivity',
  'quitter',
];

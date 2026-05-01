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

export const GROUP_ACTIVITY_COMPACT_VIEWPORT_HEIGHT_PX = 680;
export const GROUP_ACTIVITY_TOGGLE_TRANSITION = {
  width: {
    duration: 0.24,
    ease: [0.22, 1, 0.36, 1] as const,
  },
  x: {
    type: 'spring' as const,
    stiffness: 360,
    damping: 31,
    mass: 0.74,
  },
};

// Home dashboard desktop layout invariants:
// - Info top aligns visually with Account Overview top.
// - Account Overview -> Featured Q-Apps gap = 20px.
// - Info -> Wallet Activity gap = 20px.
// - Info collapsed height stays fixed to preserve spacing and overlay behavior.
export const HOME_DASHBOARD_VERTICAL_GAP_PX = 20;
export const HOME_SHARED_SIDE_RAIL_WIDTH_MD = 'minmax(285px, 330px)';
export const HOME_SHARED_SIDE_RAIL_WIDTH_XL = 'minmax(310px, 360px)';
export const HOME_LEFT_CENTER_GRID_TEMPLATE_COLUMNS = {
  xs: '1fr',
  md: `${HOME_SHARED_SIDE_RAIL_WIDTH_MD} minmax(0, 1fr)`,
  xl: `${HOME_SHARED_SIDE_RAIL_WIDTH_XL} minmax(0, 1fr)`,
} as const;
export const HOME_LEFT_CENTER_LOWER_ROW_GRID_TEMPLATE_COLUMNS = {
  xs: '1fr',
  lg: `${HOME_SHARED_SIDE_RAIL_WIDTH_MD} minmax(0, 1fr)`,
} as const;
// Right rail is offset to visually align Info with Account Overview.
// The left column includes the "Qortal Hub" eyebrow label above Account Overview,
// while the right column starts directly with the rail cards, so this offset
// compensates for that extra left-side content. The alignment is visual, not structural.
export const HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX = 29;
export const HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX = 322;
export const HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX = 426;
export const HOME_EMBEDDED_QAPP_PANEL_HEIGHT_PX = 720;
export const HOME_GROUP_ACTIVITY_CARD_CHROME_HEIGHT_PX = 100;
export const HOME_GROUP_ACTIVITY_CARD_DEFAULT_HEIGHT_PX =
  GROUP_ACTIVITY_COMPACT_VIEWPORT_HEIGHT_PX +
  HOME_GROUP_ACTIVITY_CARD_CHROME_HEIGHT_PX;
export const HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY =
  'home-dashboard-customizable-cards-layout-v1';
export const HOME_CUSTOMIZABLE_CARD_RESIZE_STEP_PX = 60;
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
export const HOME_QUITTER_WIDGET_SEARCH_LIMITS: Record<WidgetDisplayMode, number> =
  {
    compact: 6,
    expanded: 8,
  };
export const WALLET_ACTIVITY_RECENT_PAYMENT_LOOKBACK_MS =
  7 * 24 * 60 * 60 * 1000;
export const WALLET_ACTIVITY_RECENT_PAYMENT_FETCH_LIMIT = 50;
export const INFO_VALUE_COLUMN_MIN_WIDTH_PX = 136;

export const DASHBOARD_MINTER_DEFAULT_VIEW_STORAGE_KEY =
  'dashboardMinterDefaultView';
export const DASHBOARD_EMBEDDED_QUITTER_APP = {
  identifier: '',
  name: 'Quitter',
  path: '',
  service: 'APP',
  tabId: 'dashboard-embedded-quitter',
} as const;
export const HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT: HomeCustomizableCardId[] = [
  'groupActivity',
  'quitter',
];

import { Box, ButtonBase, CircularProgress, IconButton, Menu, MenuItem, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import RefreshIcon from '@mui/icons-material/Refresh';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import SouthWestRoundedIcon from '@mui/icons-material/SouthWestRounded';
import DensitySmallRoundedIcon from '@mui/icons-material/DensitySmallRounded';
import DensityLargeRoundedIcon from '@mui/icons-material/DensityLargeRounded';
import { alpha, darken } from '@mui/material/styles';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  balanceAtom,
  memberGroupsAtom,
  nodeInfosAtom,
  paymentNotificationsAtom,
  selectedNodeInfoAtom,
  userInfoAtom,
} from '../../atoms/global';
import ErrorBoundary from '../../common/ErrorBoundary';
import { Spacer } from '../../common/Spacer';
import { GroupJoinRequests } from './GroupJoinRequests';
import { GroupInvites } from './GroupInvites';
import { ListOfGroupPromotions } from './ListOfGroupPromotions';
import { HomeProfileCard } from './HomeProfileCard';
import { GETTING_STARTED_LS_KEY } from './HomeGettingStarted';
import { HomeQortinoWorkspaceCard } from './HomeQortinoWorkspaceCard';
import { HomeQuickToolsPad } from './HomeQuickToolsPad';
import { HomeFeaturedApps } from './HomeFeaturedApps';
import { HomeFeaturedGroups } from './HomeFeaturedGroups';
import { HomeDeveloperTab } from './HomeDeveloperTab';
import { accountTargetBlocks } from '../Minting/MintingStats';
import {
  APP_BLUE_SURFACE_TEXT,
  GROUP_ACTIVITY_BLUE,
  getBlueAmbientPillGlowBackground,
  getBlueTier1ButtonSx,
  getBlueTier1PillSurface,
  getBlueTier2BadgeSx,
  getBlueTier3DotSx,
} from './groupActivityColorSystem';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, LazyMotion, domAnimation, motion, useReducedMotion } from 'framer-motion';
import { getBaseApiReact } from '../../App';
import { manifestData } from '../NotAuthenticated';
import { executeEvent, subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { openQChatTab } from '../../utils/openQChatTab';
import { dashboardPanelSx, handleDashboardPanelPointerLeave, handleDashboardPanelPointerMove, useDashboardPanelMouseLight } from './dashboardPanelEffects';
import { useHandleUserInfo } from '../../hooks/useHandleUserInfo';
import {
  getDefaultLocalNodeUrl,
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../../constants/constants';
import { nodeDisplay } from '../../utils/helpers';
import { DashboardWidgetFrame, type WidgetDisplayMode } from '../Widgets/DashboardWidgetFrame';
import { GroupsWidget } from '../Widgets/GroupsWidget';
import { QuitterFeedWidget } from '../Widgets/QuitterFeedWidget';
import { ProgressiveBlur } from '../ui/progressive-blur';
import { useAuth } from '../../hooks/useAuth';
import type { ApiKey } from '../../types/auth';

type HomeTab = 'user' | 'developer';
type ActivityTab = 'requests' | 'invites' | 'promotions';
type HomeCustomizableCardId = 'groupActivity' | 'quitter';
type DashboardInfoStatusTone = 'operational' | 'syncing' | 'issue';
type MinterProgressSnapshot = {
  currentBlocks: number;
  currentLevel: number;
  progressRatio: number;
  requiredBlocks: number;
};
type MinterInfoView = 'dots' | 'progress';
type WalletActivityTransaction = {
  amount?: number | string;
  creator?: string;
  creatorAddress?: string;
  recipientAddress?: string;
  recipient?: string;
  sender?: string;
  senderAddress?: string;
  signature?: string;
  timestamp?: number | string;
};
type WalletActivityPaymentNotification = {
  data?: WalletActivityTransaction;
  event?: string;
  timestamp?: number | string;
};
type WalletActivityDirection = 'incoming' | 'outgoing';
type WalletActivityEntry = {
  amount: number;
  counterpartyAddress: string;
  counterpartyLabel: string;
  direction: WalletActivityDirection;
  timestamp: number;
};
type DashboardNodeOption = {
  key: string;
  label: string;
  node: ApiKey;
  secondary: string;
  type: 'custom' | 'local' | 'public';
};
const BLOCK_HEIGHT_TAIL_DIGITS = 4;
const GROUP_ACTIVITY_COMPACT_VIEWPORT_HEIGHT_PX = 680;
const GROUP_ACTIVITY_TOGGLE_TRANSITION = {
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

const SHOW_USER_DEVELOPER_TOGGLE = false;
const SHOW_MOST_ACTIVE_GROUPS = false;

// Home dashboard desktop layout invariants:
// - Info top aligns visually with Account Overview top.
// - Account Overview -> Featured Q-Apps gap = 20px.
// - Info -> Wallet Activity gap = 20px.
// - Info collapsed height stays fixed to preserve spacing and overlay behavior.
const HOME_DASHBOARD_VERTICAL_GAP_PX = 20;
const HOME_SHARED_SIDE_RAIL_WIDTH_MD = 'minmax(285px, 330px)';
const HOME_SHARED_SIDE_RAIL_WIDTH_XL = 'minmax(310px, 360px)';
const HOME_LEFT_CENTER_GRID_TEMPLATE_COLUMNS = {
  xs: '1fr',
  md: `${HOME_SHARED_SIDE_RAIL_WIDTH_MD} minmax(0, 1fr)`,
  xl: `${HOME_SHARED_SIDE_RAIL_WIDTH_XL} minmax(0, 1fr)`,
} as const;
const HOME_LEFT_CENTER_LOWER_ROW_GRID_TEMPLATE_COLUMNS = {
  xs: '1fr',
  lg: `${HOME_SHARED_SIDE_RAIL_WIDTH_MD} minmax(0, 1fr)`,
} as const;
// Right rail is offset to visually align Info with Account Overview.
// The left column includes the "Qortal Hub" eyebrow label above Account Overview,
// while the right column starts directly with the rail cards, so this offset
// compensates for that extra left-side content. The alignment is visual, not structural.
const HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX = 29;
const HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX = 322;
const HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX = 426;
const HOME_EMBEDDED_QAPP_PANEL_HEIGHT_PX = 720;
const HOME_GROUP_ACTIVITY_CARD_CHROME_HEIGHT_PX = 100;
const HOME_GROUP_ACTIVITY_CARD_DEFAULT_HEIGHT_PX =
  GROUP_ACTIVITY_COMPACT_VIEWPORT_HEIGHT_PX +
  HOME_GROUP_ACTIVITY_CARD_CHROME_HEIGHT_PX;
const HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY =
  'home-dashboard-customizable-cards-layout-v1';
const HOME_CUSTOMIZABLE_CARD_RESIZE_STEP_PX = 60;
const HOME_DASHBOARD_WIDGET_HEIGHT_PX = 612;
const HOME_DASHBOARD_WIDGET_DISPLAY_MODE: WidgetDisplayMode = 'expanded';
const HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS: Record<HomeCustomizableCardId, number> = {
  groupActivity: HOME_DASHBOARD_WIDGET_HEIGHT_PX,
  quitter: HOME_DASHBOARD_WIDGET_HEIGHT_PX,
};
const HOME_CUSTOMIZABLE_CARD_MAX_HEIGHTS: Record<HomeCustomizableCardId, number> = {
  groupActivity: HOME_DASHBOARD_WIDGET_HEIGHT_PX,
  quitter: HOME_DASHBOARD_WIDGET_HEIGHT_PX,
};
const HOME_QUITTER_WIDGET_INITIAL_BATCH_SIZES: Record<WidgetDisplayMode, number> = {
  compact: 6,
  expanded: 8,
};
const HOME_QUITTER_WIDGET_LOAD_MORE_BATCH_SIZES: Record<WidgetDisplayMode, number> = {
  compact: 4,
  expanded: 4,
};
const HOME_QUITTER_WIDGET_SEARCH_LIMITS: Record<WidgetDisplayMode, number> = {
  compact: 6,
  expanded: 8,
};
const SYSTEM_BADGE_SX = {
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
const WALLET_ACTIVITY_RECENT_PAYMENT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const WALLET_ACTIVITY_RECENT_PAYMENT_FETCH_LIMIT = 50;
const WALLET_ACTIVITY_PAYMENT_RECEIVED_EVENT = 'PAYMENT_RECEIVED';
const INFO_PANEL_EXPAND_OPEN_DELAY_MS = 35;
const INFO_PANEL_EXPAND_CLOSE_DELAY_MS = 60;
const INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX = 52;
const INFO_VALUE_COLUMN_MIN_WIDTH_PX = 136;

function normalizeDashboardNodeUrl(url?: string | null) {
  return (url || '').trim().replace(/\/+$/, '');
}

function getDashboardNodeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return nodeDisplay(url);
  }
}

function normalizeDashboardCustomNodes(nodes: unknown): ApiKey[] {
  if (!Array.isArray(nodes)) return [];

  return nodes
    .map((node) => ({
      url:
        typeof node?.url === 'string'
          ? normalizeDashboardNodeUrl(node.url)
          : '',
      apikey: typeof node?.apikey === 'string' ? node.apikey : '',
      name: typeof node?.name === 'string' ? node.name.trim() : '',
    }))
    .filter((node) => Boolean(node.url));
}

function getBlockHeightParts(value?: string | null) {
  const rawValue = `${value || ''}`.trim();
  const digits = rawValue.replace(/\D/g, '');

  if (digits.length <= BLOCK_HEIGHT_TAIL_DIGITS) {
    return {
      canHighlightTail: false,
      fullValue: rawValue,
      prefix: '',
      tail: rawValue,
    };
  }

  return {
    canHighlightTail: true,
    fullValue: digits,
    prefix: digits.slice(0, -BLOCK_HEIGHT_TAIL_DIGITS),
    tail: digits.slice(-BLOCK_HEIGHT_TAIL_DIGITS),
  };
}

function BlockHeightValue({ theme, value }) {
  const parts = getBlockHeightParts(value);

  return (
    <Box
      aria-label={`Node height ${parts.fullValue || value}`}
      component="span"
      title={parts.fullValue ? `Full height: ${parts.fullValue}` : undefined}
      sx={{
        alignItems: 'center',
        color: alpha(theme.palette.text.primary, 0.88),
        display: 'inline-flex',
        fontFamily:
          '"IBM Plex Mono","SFMono-Regular","Cascadia Mono","Fira Code","Consolas",monospace',
        fontSize: '0.9rem',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 700,
        gap: '6px',
        justifySelf: 'end',
        letterSpacing: '0.028em',
        lineHeight: 1,
        maxWidth: '100%',
        minWidth: 0,
        overflow: 'hidden',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}
    >
      {parts.canHighlightTail ? (
        <>
          <Box
            component="span"
            sx={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {parts.prefix}
          </Box>
          <Box
            component="span"
            sx={{
              backgroundColor: alpha(
                GROUP_ACTIVITY_BLUE.primary,
                theme.palette.mode === 'dark' ? 0.18 : 0.12
              ),
              border: `1px solid ${alpha(
                GROUP_ACTIVITY_BLUE.gradientTop,
                theme.palette.mode === 'dark' ? 0.42 : 0.34
              )}`,
              borderRadius: '6px',
              boxShadow:
                theme.palette.mode === 'dark'
                  ? `0 0 0 1px ${alpha(GROUP_ACTIVITY_BLUE.primary, 0.08)}`
                  : 'none',
              color:
                theme.palette.mode === 'dark'
                  ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.96)
                  : alpha(GROUP_ACTIVITY_BLUE.pressed, 0.94),
              display: 'inline-flex',
              justifyContent: 'center',
              letterSpacing: '0.05em',
              minWidth: '5ch',
              px: '7px',
              py: '4px',
            }}
          >
            {parts.tail}
          </Box>
        </>
      ) : (
        parts.tail
      )}
    </Box>
  );
}

const DASHBOARD_MINTER_DEFAULT_VIEW_STORAGE_KEY = 'dashboardMinterDefaultView';
const DASHBOARD_EMBEDDED_QUITTER_APP = {
  identifier: '',
  name: 'Quitter',
  path: '',
  service: 'APP',
  tabId: 'dashboard-embedded-quitter',
} as const;
const HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT: HomeCustomizableCardId[] = [
  'groupActivity',
  'quitter',
];

const isWalletActivityTimestampRecent = (timestamp: number) =>
  Date.now() - timestamp <= WALLET_ACTIVITY_RECENT_PAYMENT_LOOKBACK_MS;

const formatWalletActivityRelativeTime = (timestamp: number, now: number) => {
  const elapsedMs = Math.max(0, now - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);

  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
};

const formatWalletActivityAmount = (
  amount: number,
  direction: WalletActivityDirection
) => `${direction === 'outgoing' ? '-' : '+'}${Math.abs(amount).toFixed(2)} QORT`;

const getWalletActivityCreatorAddress = (
  transaction: WalletActivityTransaction
) =>
  (
    transaction.creatorAddress ||
    transaction.senderAddress ||
    transaction.sender ||
    transaction.creator ||
    ''
  ).trim();

const getWalletActivityRecipientAddress = (
  transaction: WalletActivityTransaction
) => (transaction.recipient || transaction.recipientAddress || '').trim();

const parseMinterInfoView = (value: string | null): MinterInfoView =>
  value === 'progress' ? 'progress' : 'dots';

type HomeCustomizableCardsLayout = {
  heights: Partial<Record<HomeCustomizableCardId, number>>;
  order: HomeCustomizableCardId[];
};

const clampHomeCustomizableCardHeight = (
  cardId: HomeCustomizableCardId,
  value: number
) =>
  Math.max(
    HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS[cardId],
    Math.min(HOME_CUSTOMIZABLE_CARD_MAX_HEIGHTS[cardId], Math.round(value))
  );

const parseHomeCustomizableCardsLayout = (
  rawValue: string | null
): HomeCustomizableCardsLayout => {
  if (!rawValue) {
    return {
      heights: {},
      order: HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT,
    };
  }

  try {
    const parsed = JSON.parse(rawValue);
    const parsedOrder = Array.isArray(parsed?.order)
      ? parsed.order.filter(
          (value): value is HomeCustomizableCardId =>
            value === 'groupActivity' || value === 'quitter'
        )
      : [];
    const order =
      parsedOrder.length === HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT.length &&
      HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT.every((value) =>
        parsedOrder.includes(value)
      )
        ? parsedOrder
        : HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT;

    const nextHeights: Partial<Record<HomeCustomizableCardId, number>> = {};
    const parsedHeights = parsed?.heights ?? {};

    HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT.forEach((cardId) => {
      const value = parsedHeights?.[cardId];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        nextHeights[cardId] = clampHomeCustomizableCardHeight(cardId, value);
      }
    });

    return {
      heights: nextHeights,
      order,
    };
  } catch {
    return {
      heights: {},
      order: HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT,
    };
  }
};

type HomeLayoutDebugMetric = {
  bottom: number;
  height: number;
  left: number;
  top: number;
  width: number;
};

type HomeLayoutDebugKey =
  | 'accountOverview'
  | 'featuredApps'
  | 'info'
  | 'profileCard'
  | 'tools'
  | 'walletActivity';

const measureHomeLayoutDebugMetric = (
  node: HTMLElement,
  rootRect: DOMRect
): HomeLayoutDebugMetric => {
  const rect = node.getBoundingClientRect();

  return {
    bottom: rect.bottom - rootRect.top,
    height: rect.height,
    left: rect.left - rootRect.left,
    top: rect.top - rootRect.top,
    width: rect.width,
  };
};

const DashboardUtilityPanel = ({ title, children, theme, sx = undefined, titleSx = undefined, panelBoxRef = undefined }) => {
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const assignPanelNode = (node) => {
    panelRef.current = node;

    if (typeof panelBoxRef === 'function') {
      panelBoxRef(node);
      return;
    }

    if (panelBoxRef) {
      panelBoxRef.current = node;
    }
  };

  return (
    <Box ref={assignPanelNode} sx={{ ...dashboardPanelSx(theme, 'utility'), borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px', width: '100%', ...sx }} onMouseMove={handleDashboardPanelPointerMove} onMouseLeave={handleDashboardPanelPointerLeave}>
      <Typography sx={{ color: theme.palette.text.primary, fontSize: '1rem', fontWeight: 600, ...titleSx }}>{title}</Typography>
      {children}
    </Box>
  );
};

const sepSx = (theme) => ({ borderBottom: `1px solid ${theme.palette.border.subtle}` });

const infoSepSx = (theme, index, total) => sepSx(theme);

const WalletActionButton = ({ icon, label, onClick, theme }) => {
  const blueStrongHover = getBlueTier1ButtonSx()['&:hover'];
  const isDarkMode = theme.palette.mode === 'dark';

  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: 'center',
        background: isDarkMode
          ? 'linear-gradient(145deg, rgba(53,58,68,0.99) 0%, rgba(41,45,54,1) 48%, rgba(30,34,41,1) 100%)'
          : 'linear-gradient(145deg, rgba(251,253,255,0.99) 0%, rgba(232,237,245,0.99) 48%, rgba(216,223,234,1) 100%)',
        border: `1px solid ${
          isDarkMode
            ? alpha(theme.palette.primary.main, 0.06)
            : alpha(theme.palette.text.primary, 0.072)
        }`,
        borderRadius: '12px',
        boxShadow: isDarkMode
          ? 'inset 0 1px 0 rgba(255,255,255,0.075), inset 0 0 0 1px rgba(255,255,255,0.012), inset 0 -1px 0 rgba(0,0,0,0.44), inset -1px -1px 0 rgba(0,0,0,0.18), 0 4px 8px rgba(0,0,0,0.17)'
          : 'inset 0 1px 0 rgba(255,255,255,0.86), inset 0 0 0 1px rgba(255,255,255,0.24), inset 0 -1px 0 rgba(104,116,140,0.22), inset -1px -1px 0 rgba(146,158,182,0.14), 0 4px 8px rgba(94,108,132,0.11)',
        display: 'flex',
        gap: '9px',
        height: '46px',
        justifyContent: 'center',
        overflow: 'hidden',
        px: 1.5,
        position: 'relative',
        transition:
          'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, color 140ms ease, transform 120ms ease, filter 140ms ease',
        width: '100%',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '1px',
          borderRadius: 'inherit',
          pointerEvents: 'none',
          background: isDarkMode
            ? 'linear-gradient(145deg, rgba(255,255,255,0.052) 0%, rgba(255,255,255,0.02) 24%, rgba(255,255,255,0) 58%)'
            : 'linear-gradient(145deg, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.22) 28%, rgba(255,255,255,0) 58%)',
          opacity: 0.92,
        },
        '&:hover': {
          ...blueStrongHover,
          borderColor: 'rgba(143, 184, 243, 0.22)',
          color: APP_BLUE_SURFACE_TEXT,
          transform: 'translateY(-1px)',
        },
        '&:active': {
          boxShadow:
            'inset 2px 2px 6px rgba(0, 0, 0, 0.7), inset -1px -1px 3px rgba(255, 255, 255, 0.04)',
          transform: 'scale(0.97)',
        },
      }}
    >
      <Box
        sx={{
          color: 'inherit',
          display: 'inline-flex',
        }}
      >
        {icon}
      </Box>
      <Typography
        sx={{
          color: 'inherit',
          fontSize: '0.8rem',
          fontWeight: 600,
        }}
      >
        {label}
      </Typography>
    </ButtonBase>
  );
};

const InfoPreviewPanel = ({
  rows,
  theme,
  maxExpandedHeightPx = null,
  forceExpanded = false,
  resetKey = 'default',
}) => {
  const enableOverlay = useMediaQuery(theme.breakpoints.up('xl'));
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [collapsedHeight, setCollapsedHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const footerSectionCount = rows.footerSections.length;
  const footerItemCount = rows.footerSections.reduce(
    (total, section) => total + section.items.length,
    0
  );

  const clearHoverTimers = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearHoverTimers();
  }, []);

  useEffect(() => {
    clearHoverTimers();
    setIsExpanded(false);
    setCollapsedHeight(0);
    setContentHeight(0);
  }, [resetKey]);

  useEffect(() => {
    if (!enableOverlay) {
      setIsExpanded(false);
      return;
    }

    const wrapperNode = wrapperRef.current;
    const contentNode = contentRef.current;
    if (!wrapperNode || !contentNode) return;

    const updateMeasurements = () => {
      setCollapsedHeight(wrapperNode.getBoundingClientRect().height);
      setContentHeight(contentNode.scrollHeight);
    };

    updateMeasurements();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateMeasurements);
      return () => {
        window.removeEventListener('resize', updateMeasurements);
      };
    }

    const resizeObserver = new ResizeObserver(updateMeasurements);
    resizeObserver.observe(wrapperNode);
    resizeObserver.observe(contentNode);
    window.addEventListener('resize', updateMeasurements);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateMeasurements);
    };
  }, [
    enableOverlay,
    footerItemCount,
    footerSectionCount,
    rows.metricItems.length,
    rows.primaryItems.length,
  ]);

  const hasOverflow =
    enableOverlay && collapsedHeight > 0 && contentHeight > collapsedHeight + 4;
  const isEffectivelyExpanded = isExpanded || (forceExpanded && hasOverflow);
  const resolvedCollapsedHeight =
    collapsedHeight > 0 ? collapsedHeight : undefined;
  const rawExpandedHeight = resolvedCollapsedHeight
    ? Math.max(
        resolvedCollapsedHeight,
        contentHeight + INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX
      )
    : contentHeight + INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX;
  const expandedHeight =
    maxExpandedHeightPx != null
      ? Math.max(
          resolvedCollapsedHeight ?? 0,
          Math.min(rawExpandedHeight, maxExpandedHeightPx)
        )
      : rawExpandedHeight;

  const handleMouseEnter = () => {
    if (!hasOverflow) return;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (isExpanded || openTimerRef.current !== null) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setIsExpanded(true);
    }, INFO_PANEL_EXPAND_OPEN_DELAY_MS);
  };

  const handleMouseLeave = (event) => {
    handleDashboardPanelPointerLeave(event);
    if (forceExpanded) return;
    if (!hasOverflow) return;
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (!isExpanded || closeTimerRef.current !== null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setIsExpanded(false);
    }, INFO_PANEL_EXPAND_CLOSE_DELAY_MS);
  };

  const showCollapsedFade = hasOverflow && !isEffectivelyExpanded;
  const statusAccentColor =
    rows.status.tone === 'issue'
      ? theme.palette.mode === 'dark'
        ? alpha(theme.palette.error.light, 0.9)
        : alpha(theme.palette.error.main, 0.88)
      : rows.status.tone === 'syncing'
        ? theme.palette.mode === 'dark'
          ? alpha(theme.palette.warning.light, 0.9)
          : alpha(theme.palette.warning.main, 0.88)
        : theme.palette.mode === 'dark'
          ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.96)
          : alpha(GROUP_ACTIVITY_BLUE.gradientBottom, 0.92);
  const statusGlowColor =
    rows.status.tone === 'issue'
      ? alpha(theme.palette.error.light, 0.16)
      : rows.status.tone === 'syncing'
        ? alpha(theme.palette.warning.light, 0.18)
        : alpha(GROUP_ACTIVITY_BLUE.primary, 0.18);

  const renderPrimaryValue = (row) => {
    if (row.valueNode) return row.valueNode;

    if (row.variant === 'pill') {
      const pillTone =
        row.pillTone === 'negative'
          ? {
              background:
                theme.palette.mode === 'dark'
                  ? 'rgba(104, 70, 74, 0.32)'
                  : 'rgba(168, 90, 90, 0.12)',
              border: alpha(
                theme.palette.error.light,
                theme.palette.mode === 'dark' ? 0.16 : 0.22
              ),
              color:
                theme.palette.mode === 'dark'
                  ? alpha(theme.palette.error.light, 0.88)
                  : alpha(theme.palette.error.dark, 0.88),
            }
          : row.pillTone === 'warning'
            ? {
                background:
                  theme.palette.mode === 'dark'
                    ? 'rgba(123, 102, 62, 0.3)'
                    : 'rgba(173, 140, 74, 0.14)',
                border: alpha(
                  theme.palette.warning.light,
                  theme.palette.mode === 'dark' ? 0.18 : 0.24
                ),
                color:
                  theme.palette.mode === 'dark'
                    ? alpha(theme.palette.warning.light, 0.9)
                    : alpha(theme.palette.warning.dark, 0.88),
              }
            : {
                background:
                  theme.palette.mode === 'dark'
                    ? 'rgba(88, 122, 178, 0.3)'
                    : 'rgba(117, 161, 227, 0.15)',
                border: alpha(
                  GROUP_ACTIVITY_BLUE.gradientTop,
                  theme.palette.mode === 'dark' ? 0.18 : 0.24
                ),
                color:
                  theme.palette.mode === 'dark'
                    ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.92)
                    : alpha(GROUP_ACTIVITY_BLUE.pressed, 0.9),
              };
      return (
        <Box
          sx={{
            alignItems: 'center',
            background: pillTone.background,
            border: `1px solid ${pillTone.border}`,
            boxShadow: pillTone.boxShadow ?? 'none',
            color: pillTone.color,
            display: 'inline-flex',
            justifyContent: 'center',
            justifySelf: 'end',
            maxWidth: '100%',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            ...SYSTEM_BADGE_SX,
          }}
        >
          {row.value}
        </Box>
      );
    }

    return (
      <Typography
        sx={{
          color: row.emphasize ? theme.palette.text.primary : alpha(theme.palette.text.primary, 0.9),
          fontSize: row.emphasize ? '0.96rem' : '0.88rem',
          fontWeight: row.emphasize ? 700 : 600,
          letterSpacing: row.emphasize ? '0.01em' : '0.012em',
          lineHeight: 1.2,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {row.value}
      </Typography>
    );
  };

  return (
    <Box
      ref={wrapperRef}
      sx={{
        minWidth: 0,
        position: 'relative',
        width: '100%',
        ...(enableOverlay
          ? {
              height: '100%',
              minHeight: 0,
              zIndex: isEffectivelyExpanded ? 4 : 1,
            }
          : {}),
      }}
    >
      <Box
      ref={panelRef}
      sx={{
        ...dashboardPanelSx(theme, 'utility'),
        borderRadius: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        minWidth: 0,
        overflow: 'hidden',
        px: '16px',
        py: '12px',
        width: '100%',
        ...(enableOverlay
          ? {
              borderColor: isEffectivelyExpanded
                ? theme.palette.border.main
                : theme.palette.border.subtle,
              boxShadow: isEffectivelyExpanded
                ? theme.palette.mode === 'dark'
                  ? '0 26px 34px -12px rgba(0, 0, 0, 0.34)'
                  : '0 24px 28px -12px rgba(15, 23, 42, 0.16)'
                : undefined,
              height:
                resolvedCollapsedHeight == null
                  ? '100%'
                  : `${
                      isEffectivelyExpanded
                        ? expandedHeight
                        : resolvedCollapsedHeight
                    }px`,
              left: 0,
              position: 'absolute',
              right: 0,
              top: 0,
              transition:
                'height 160ms cubic-bezier(0.2, 0, 0, 1), box-shadow 140ms ease, border-color 140ms ease',
            }
          : {
              height: '100%',
            }),
      }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleDashboardPanelPointerMove}
      onMouseLeave={handleMouseLeave}
    >
      <Box
        className="dashboard-panel-decoration"
        sx={{
          display: 'none',
        }}
      />
      <Box
        ref={contentRef}
        sx={{
          '& > *': {
            flexShrink: 0,
          },
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          position: 'relative',
          width: '100%',
        }}
      >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'flex-start',
          mb: '14px',
          width: '100%',
        }}
      >
        <Typography
          component="div"
          sx={{
            alignItems: 'center',
            color: theme.palette.text.primary,
            display: 'inline-flex',
            fontFamily:
              '"IBM Plex Mono","SFMono-Regular","Cascadia Mono","Fira Code","Consolas",monospace',
            fontSize: '0.95rem',
            fontWeight: 600,
            letterSpacing: '0.02em',
            lineHeight: 1,
            textTransform: 'none',
          }}
        >
          <Box component="span">status</Box>
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              animation: 'homeStatusCursorBlink 1.08s steps(1, end) infinite',
              color: statusAccentColor,
              display: 'inline-block',
              ml: '1px',
              textShadow: `0 0 8px ${statusGlowColor}`,
              '@keyframes homeStatusCursorBlink': {
                '0%, 42%': {
                  opacity: 1,
                },
                '43%, 100%': {
                  opacity: 0.26,
                },
              },
            }}
          >
            _
          </Box>
        </Typography>
      </Box>

      <Box sx={{ ...sepSx(theme), pb: '12px', mb: '8px' }} />

      {rows.primaryItems.map((row, index) => (
        <Box
          key={row.label}
          sx={{
            ...(index < rows.primaryItems.length - 1
              ? infoSepSx(theme, index, rows.primaryItems.length)
              : {}),
            alignItems: 'center',
            columnGap: '18px',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            height: '46px',
            minWidth: 0,
            overflow: 'hidden',
            py: 0,
          }}
        >
          <Typography
            sx={{
              color:
                theme.palette.mode === 'dark'
                  ? alpha(theme.palette.common.white, 0.56)
                  : alpha(theme.palette.text.primary, 0.62),
              fontSize: '0.82rem',
              fontWeight: 500,
              letterSpacing: '0.012em',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.label}
          </Typography>
          <Box
            sx={{
              alignItems: 'center',
              color: theme.palette.text.primary,
              display: 'flex',
              height: '100%',
              justifyContent: 'flex-end',
              maxWidth: '100%',
              minWidth: 0,
              textAlign: 'right',
            }}
          >
            {renderPrimaryValue(row)}
          </Box>
        </Box>
      ))}

      <Box
        sx={{
          display: 'grid',
          gap: '10px',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          mb: '12px',
          mt: '16px',
        }}
      >
        {rows.metricItems.map((metric) => (
          <Box
            key={metric.label}
            sx={{
              bgcolor:
                theme.palette.mode === 'dark'
                  ? 'rgba(38, 42, 52, 0.9)'
                  : 'rgba(248, 244, 238, 0.96)',
              border: `1px solid ${alpha(
                theme.palette.border.subtle,
                theme.palette.mode === 'dark' ? 0.92 : 0.68
              )}`,
              borderRadius: '10px',
              boxShadow:
                theme.palette.mode === 'dark'
                  ? 'inset 0 1px 0 rgba(255,255,255,0.04)'
                  : 'inset 0 1px 0 rgba(255,255,255,0.72)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: '70px',
              minWidth: 0,
              overflow: 'hidden',
              position: 'relative',
              px: '12px',
              py: '10px',
            }}
          >
            <Typography
              sx={{
                color:
                  theme.palette.mode === 'dark'
                    ? alpha(theme.palette.common.white, 0.46)
                    : alpha(theme.palette.text.primary, 0.52),
                fontSize: '0.66rem',
                fontWeight: 500,
                letterSpacing: '0.03em',
                lineHeight: 1.1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {metric.label}
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: '1.08rem',
                fontWeight: 700,
                letterSpacing: '0.01em',
                lineHeight: 1.1,
                minWidth: 0,
                mt: '8px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {metric.value}
            </Typography>
          </Box>
        ))}
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          mt: '12px',
          width: '100%',
        }}
      >
        {rows.footerSections.map((section, sectionIndex) => {
          const isNodeSection = section.title === 'Node';
          const sectionHeaderLabel = isNodeSection
            ? '// node_info'
            : section.title;

          return (
            <Box
              key={section.title}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                mt:
                  section.offsetTopPx != null
                    ? `${section.offsetTopPx}px`
                    : sectionIndex === 0
                      ? 0
                      : '2px',
              }}
            >
              <Typography
                component="div"
                sx={{
                  alignItems: 'center',
                  color:
                    isNodeSection
                      ? theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.38)
                        : alpha(theme.palette.text.secondary, 0.92)
                      : theme.palette.text.primary,
                  display: 'inline-flex',
                  fontFamily:
                    '"IBM Plex Mono","SFMono-Regular","Cascadia Mono","Fira Code","Consolas",monospace',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  lineHeight: 1,
                  mb: '8px',
                  textTransform: 'none',
                }}
              >
                {sectionHeaderLabel}
              </Typography>

              {section.items.map((row, index) => (
                <Box
                  key={row.label}
                  sx={{
                    ...(index < section.items.length - 1
                      ? infoSepSx(theme, index, section.items.length)
                      : {}),
                    ...(isNodeSection
                      ? {
                          alignItems: 'center',
                          columnGap: '18px',
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) auto',
                          height: '46px',
                          minWidth: 0,
                          mt: index === 0 ? '14px' : 0,
                          overflow: 'hidden',
                          py: 0,
                          width: '100%',
                        }
                      : {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          minHeight: '50px',
                          py: '6px',
                        }),
                  }}
                >
                  {row.labelAction ? (
                    <Tooltip title={row.labelAction.tooltip}>
                      <ButtonBase
                        aria-label={row.labelAction.ariaLabel}
                        onClick={row.labelAction.onClick}
                        sx={{
                          alignItems: 'center',
                          borderRadius: '6px',
                          color:
                            theme.palette.mode === 'dark'
                              ? alpha(theme.palette.common.white, 0.58)
                              : alpha(theme.palette.text.primary, 0.64),
                          display: 'inline-flex',
                          gap: '3px',
                          justifySelf: 'start',
                          minWidth: 0,
                          px: '4px',
                          py: '3px',
                          transform: 'translateX(-4px)',
                          transition:
                            'background-color 140ms ease, color 140ms ease',
                          '&:hover': {
                            backgroundColor: alpha(
                              GROUP_ACTIVITY_BLUE.primary,
                              theme.palette.mode === 'dark' ? 0.13 : 0.09
                            ),
                            color:
                              theme.palette.mode === 'dark'
                                ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.95)
                                : alpha(GROUP_ACTIVITY_BLUE.pressed, 0.94),
                          },
                        }}
                      >
                        <Typography
                          component="span"
                          sx={{
                            color: 'inherit',
                            fontSize: '0.79rem',
                            fontWeight: 600,
                            letterSpacing: '0.012em',
                            lineHeight: 1.1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.label}
                        </Typography>
                        <KeyboardArrowDownRoundedIcon
                          sx={{
                            fontSize: '0.95rem',
                            transform: row.labelAction.isOpen
                              ? 'rotate(180deg)'
                              : 'none',
                            transition: 'transform 140ms ease',
                          }}
                        />
                      </ButtonBase>
                    </Tooltip>
                  ) : (
                    <Typography
                      sx={{
                        color:
                          theme.palette.mode === 'dark'
                            ? alpha(theme.palette.common.white, 0.52)
                            : alpha(theme.palette.text.primary, 0.58),
                        fontSize: '0.79rem',
                        fontWeight: 500,
                        letterSpacing: '0.012em',
                        lineHeight: 1.1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.label}
                    </Typography>
                  )}
                  {row.valueNode || (
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.primary, 0.88),
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        letterSpacing: '0.01em',
                        lineHeight: 1.2,
                        maxWidth: '100%',
                        minWidth: 0,
                        overflow: 'hidden',
                        ...(isNodeSection
                          ? {
                              justifySelf: 'end',
                              textAlign: 'right',
                            }
                          : {}),
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.value}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>

      <Box sx={{ minHeight: '8px', width: '100%' }} />
      {showCollapsedFade && (
        <ProgressiveBlur
          blurStrength={18}
          height="78px"
          position="bottom"
          sx={{
            bottom: -12,
            left: '-16px',
            right: '-16px',
          }}
          tintColor={
            theme.palette.mode === 'dark'
              ? theme.palette.background.paper
              : theme.palette.common.white
          }
        />
      )}
      </Box>
    </Box>
    </Box>
  );
};

function nodeMenuItemSx(theme, selected: boolean) {
  return {
    alignItems: 'center',
    borderRadius: '8px',
    color: selected
      ? theme.palette.mode === 'dark'
        ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.96)
        : alpha(GROUP_ACTIVITY_BLUE.pressed, 0.94)
      : alpha(theme.palette.text.primary, 0.9),
    display: 'flex',
    gap: '12px',
    minHeight: 52,
    px: 1.15,
    py: 0.9,
    '&.Mui-disabled': {
      color: alpha(theme.palette.text.secondary, 0.52),
      opacity: 1,
    },
    '&:hover': {
      backgroundColor: alpha(
        GROUP_ACTIVITY_BLUE.primary,
        theme.palette.mode === 'dark' ? 0.12 : 0.08
      ),
    },
  };
}

export const HomeDesktop = ({ myAddress, setGroupSection, setSelectedGroup, getTimestampEnterChat, setOpenManageMembers, setOpenAddGroup, setOpenAddGroupTab, setMobileViewMode, setDesktopViewMode, desktopViewMode, onOpenSettings }) => {
  const groupActivityPanelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const groupActivityCardHeightRef = useRef<HTMLDivElement | null>(null);
  const groupActivityContentFrameRef = useRef<HTMLDivElement | null>(null);
  const groupActivityTopControlsRef = useRef<HTMLDivElement | null>(null);
  const quitterCardHeightRef = useRef<HTMLDivElement | null>(null);
  const activityToggleTrackRef = useRef<HTMLDivElement | null>(null);
  const activityToggleSegmentRefs = useRef<Record<ActivityTab, HTMLButtonElement | null>>({
    requests: null,
    promotions: null,
    invites: null,
  });
  const homeLayoutDebugRootRef = useRef<HTMLDivElement | null>(null);
  const accountOverviewDebugRef = useRef<HTMLDivElement | null>(null);
  const infoDebugRef = useRef<HTMLDivElement | null>(null);
  const profileCardDebugRef = useRef<HTMLDivElement | null>(null);
  const toolsDebugRef = useRef<HTMLDivElement | null>(null);
  const featuredAppsDebugRef = useRef<HTMLDivElement | null>(null);
  const walletActivityDebugRef = useRef<HTMLDivElement | null>(null);
  const rightRailRef = useRef<HTMLDivElement | null>(null);
  const layoutStabilizeFrameRef = useRef<number | null>(null);
  const walletActivityNameCacheRef = useRef<Record<string, string>>({});
  const lastWalletActivityBalanceRef = useRef<string | null>(null);
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const groups = useAtomValue(memberGroupsAtom);
  const nodeInfos = useAtomValue(nodeInfosAtom);
  const paymentNotifications = useAtomValue(paymentNotificationsAtom);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const setNodeInfos = useSetAtom(nodeInfosAtom);
  const { getBalanceFunc, handleSaveNodeInfo } = useAuth();
  const [activeTab, setActiveTab] = useState<HomeTab>('user');
  const [activityTab, setActivityTab] = useState<ActivityTab>('promotions');
  const [requestsCount, setRequestsCount] = useState(0);
  const [invitesCount, setInvitesCount] = useState(0);
  const [promotionsCount, setPromotionsCount] = useState(0);
  const [showMostActiveGroups, setShowMostActiveGroups] = useState(false);
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const [requestsCountLoading, setRequestsCountLoading] = useState(true);
  const [invitesCountLoading, setInvitesCountLoading] = useState(true);
  const [minterLevel, setMinterLevel] = useState<number | null>(null);
  const [minterProgress, setMinterProgress] =
    useState<MinterProgressSnapshot | null>(null);
  const [walletActivityTargetHeightPx, setWalletActivityTargetHeightPx] =
    useState<number | null>(null);
  const [qortinoCardTargetHeightPx, setQortinoCardTargetHeightPx] =
    useState<number | null>(null);
  const [customizableCardsLayout, setCustomizableCardsLayout] =
    useState<HomeCustomizableCardsLayout>(() =>
      parseHomeCustomizableCardsLayout(
        localStorage.getItem(HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY)
      )
    );
  const [groupWidgetRefreshToken, setGroupWidgetRefreshToken] = useState(0);
  const [isGroupWidgetRefreshing, setIsGroupWidgetRefreshing] = useState(false);
  const [quitterWidgetRefreshToken, setQuitterWidgetRefreshToken] = useState(0);
  const [isQuitterWidgetRefreshing, setIsQuitterWidgetRefreshing] = useState(false);
  const [recentWalletActivity, setRecentWalletActivity] =
    useState<WalletActivityEntry | null>(null);
  const [isWalletActivityLoading, setIsWalletActivityLoading] = useState(false);
  const [walletActivityRelativeTimeNow, setWalletActivityRelativeTimeNow] =
    useState(() => Date.now());
  const [dashboardCustomNodes, setDashboardCustomNodes] = useState<ApiKey[]>(
    []
  );
  const [nodeMenuAnchorEl, setNodeMenuAnchorEl] =
    useState<HTMLElement | null>(null);
  const [isSwitchingNodeUrl, setIsSwitchingNodeUrl] = useState('');
  const [nodeSwitchError, setNodeSwitchError] = useState('');
  const [activityToggleIndicator, setActivityToggleIndicator] = useState({
    ready: false,
    width: 0,
    x: 0,
  });
  const [groupActivityMeasuredViewportHeightPx, setGroupActivityMeasuredViewportHeightPx] =
    useState<number | null>(null);
  const [coreVersionLabel, setCoreVersionLabel] = useState('—');
  const [minterDefaultView, setMinterDefaultView] = useState<MinterInfoView>(() =>
    parseMinterInfoView(
      localStorage.getItem(DASHBOARD_MINTER_DEFAULT_VIEW_STORAGE_KEY)
    )
  );
  const [isMinterFieldHovered, setIsMinterFieldHovered] = useState(false);
  const minterPreviewMode = minterLevel && minterLevel > 0 ? 'on' : 'off';
  const statusPreviewMode: string = 'live';
  const reduce = useReducedMotion();
  const { i18n, t } = useTranslation(['core', 'group', 'tutorial', 'auth']);
  const td = useCallback(
    (key: string, defaultValue: string) =>
      t(`group:dashboard.${key}`, { defaultValue }),
    [t]
  );
  const dashboardLanguageKey = (i18n.resolvedLanguage || i18n.language || 'en')
    .split('-')[0];
  const theme = useTheme();
  const isSplitDashboardLayout = useMediaQuery(theme.breakpoints.up('md'));
  const isWideDashboardLayout = useMediaQuery(theme.breakpoints.up('xl'));
  const resolvedWideLeftLowerRowPanelHeightPx = isWideDashboardLayout
    ? HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX
    : null;
  const resolvedQortinoCardHeightPx = isSplitDashboardLayout
    ? qortinoCardTargetHeightPx ?? HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX
    : null;
  const resolvedWalletActivityHeightPx = isWideDashboardLayout
    ? walletActivityTargetHeightPx ?? HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX
    : null;
  const groupActivityAccentTextColor = theme.palette.getContrastText(
    GROUP_ACTIVITY_BLUE.primary
  );
  const groupActivityAccentBadgeTextColor = theme.palette.getContrastText(
    GROUP_ACTIVITY_BLUE.pressed
  );
  const groupActivityToggleIndicatorSurface = getBlueTier1PillSurface(theme);
  const groupActivityActiveBadgeSurface = getBlueTier2BadgeSx(theme, true);
  const groupActivityInactiveBadgeSurface = getBlueTier2BadgeSx(theme, false);
  const filledBlueDotSx = getBlueTier3DotSx(theme, true);
  const emptyBlueDotSx = getBlueTier3DotSx(theme, false);
  const sharedAmbientPillGlowBackground = getBlueAmbientPillGlowBackground(theme);
  const groupActivityToggleTrackBackground =
    theme.palette.mode === 'dark'
      ? darken(theme.palette.background.surface, 0.25)
      : darken(theme.palette.background.paper, 0.25);
  const groupActivityToggleTrackShadow =
    theme.palette.mode === 'dark'
      ? 'inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.32)'
      : 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(31,39,53,0.08)';
  const walletActivitySecondaryTextColor = alpha(
    theme.palette.text.primary,
    0.6
  );
  const infoPanelMaxExpandedHeightPx =
    isWideDashboardLayout && resolvedWalletActivityHeightPx != null
      ? HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX +
        HOME_DASHBOARD_VERTICAL_GAP_PX +
        resolvedWalletActivityHeightPx +
        2
      : null;
  const getIndividualUserInfo = useHandleUserInfo();
  const userAddress = userInfo?.address;
  const selectedNodeUrl = normalizeDashboardNodeUrl(
    selectedNode?.url || getBaseApiReact()
  );
  const publicNodeUrl = normalizeDashboardNodeUrl(HTTPS_EXT_NODE_QORTAL_LINK);
  const loadDashboardCustomNodes = useCallback(async () => {
    try {
      const nodes = normalizeDashboardCustomNodes(
        await window.sendMessage('getCustomNodesFromStorage')
      );
      setDashboardCustomNodes(nodes);
      window.electronAPI?.setAllowedDomains?.(nodes.map((node) => node.url));
    } catch (error) {
      console.error(error);
      setDashboardCustomNodes([]);
    }
  }, []);
  const handleOpenNodeMenu = useCallback(
    (event) => {
      event.stopPropagation();
      setNodeSwitchError('');
      setNodeMenuAnchorEl(event.currentTarget);
      loadDashboardCustomNodes();
    },
    [loadDashboardCustomNodes]
  );
  const handleCloseNodeMenu = useCallback(() => {
    if (isSwitchingNodeUrl) return;
    setNodeMenuAnchorEl(null);
  }, [isSwitchingNodeUrl]);
  const dashboardNodeOptions = useMemo<DashboardNodeOption[]>(() => {
    const nodes = dashboardCustomNodes.filter((node) => {
      const nodeUrl = normalizeDashboardNodeUrl(node.url);
      return nodeUrl && nodeUrl !== publicNodeUrl && !isLocalNodeUrl(nodeUrl);
    });
    const localNodeUrl = normalizeDashboardNodeUrl(getDefaultLocalNodeUrl());
    const localNodeOption: DashboardNodeOption | null = isLocalNodeUrl(
      selectedNodeUrl
    )
      ? null
      : {
          key: 'local',
          label: 'Local Node',
          node: { url: localNodeUrl, apikey: '' },
          secondary: getDashboardNodeHost(localNodeUrl),
          type: 'local',
        };

    if (
      selectedNodeUrl &&
      selectedNodeUrl !== publicNodeUrl &&
      !isLocalNodeUrl(selectedNodeUrl) &&
      !nodes.some((node) => normalizeDashboardNodeUrl(node.url) === selectedNodeUrl)
    ) {
      nodes.unshift({
        url: selectedNodeUrl,
        apikey: selectedNode?.apikey || '',
        name: selectedNode?.name || '',
      });
    }

    return [
      ...nodes.map((node) => {
        const nodeUrl = normalizeDashboardNodeUrl(node.url);
        const host = getDashboardNodeHost(nodeUrl);
        return {
          key: `custom:${nodeUrl}`,
          label: node.name || host,
          node: { ...node, url: nodeUrl },
          secondary: host,
          type: 'custom' as const,
        };
      }),
      ...(localNodeOption ? [localNodeOption] : []),
      {
        key: 'public',
        label: 'Public Node',
        node: { url: HTTPS_EXT_NODE_QORTAL_LINK, apikey: '' },
        secondary: getDashboardNodeHost(HTTPS_EXT_NODE_QORTAL_LINK),
        type: 'public' as const,
      },
    ];
  }, [
    dashboardCustomNodes,
    publicNodeUrl,
    selectedNode?.apikey,
    selectedNode?.name,
    selectedNodeUrl,
  ]);
  const handleSelectDashboardNode = useCallback(
    async (option: DashboardNodeOption) => {
      const nextUrl = normalizeDashboardNodeUrl(option.node.url);
      if (!nextUrl || isSwitchingNodeUrl) return;

      if (nextUrl === selectedNodeUrl) {
        setNodeMenuAnchorEl(null);
        return;
      }

      try {
        setNodeSwitchError('');
        setIsSwitchingNodeUrl(nextUrl);
        let nodeToSave = option.node;

        if (option.type === 'local') {
          const apiKey = window?.coreSetup?.getApiKey
            ? await window.coreSetup.getApiKey()
            : '';
          nodeToSave = { ...option.node, apikey: apiKey || '' };

          if (nextUrl.startsWith('https://')) {
            const certResult = await window.electronAPI?.ensureCertForBase?.(
              nextUrl,
              apiKey || ''
            );

            if (!certResult?.success) {
              throw new Error(
                certResult?.error ||
                  'Unable to prepare local HTTPS certificate'
              );
            }
          }
        }

        await handleSaveNodeInfo(nodeToSave);
        setNodeInfos({});
        await getBalanceFunc();
        setNodeMenuAnchorEl(null);
      } catch (error) {
        console.error(error);
        setNodeSwitchError('Could not switch nodes right now.');
      } finally {
        setIsSwitchingNodeUrl('');
      }
    },
    [
      getBalanceFunc,
      handleSaveNodeInfo,
      isSwitchingNodeUrl,
      selectedNodeUrl,
      setNodeInfos,
    ]
  );
  useEffect(() => {
    loadDashboardCustomNodes();
  }, [loadDashboardCustomNodes]);
  const handleOpenReceiveQort = useCallback((target: HTMLElement | null) => {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const rightRailRect = rightRailRef.current?.getBoundingClientRect();
    executeEvent('openReceiveQortInternal', {
      address: userAddress ?? myAddress ?? '',
      anchorRect: {
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width,
      },
      targetRect: rightRailRect
        ? {
            height: rightRailRect.height,
            left: rightRailRect.left,
            top: rightRailRect.top,
            width: rightRailRect.width,
          }
        : null,
    });
  }, [myAddress, userAddress]);
  const handleOpenWalletActivityCounterparty = useCallback(
    (address: string) => {
      if (!address) return;
      executeEvent('openUserLookupDrawer', {
        addressOrName: address,
      });
    },
    []
  );
  const resolveWalletActivityAddressLabel = useCallback(
    async (address: string) => {
      if (!address) return 'Unknown address';

      const cachedSenderName = walletActivityNameCacheRef.current[address];
      if (cachedSenderName !== undefined) {
        return cachedSenderName || address;
      }

      try {
        const response = await fetch(
          `${getBaseApiReact()}/names/primary/${address}`
        );
        const responseData = await response.json();
        const senderName =
          response.ok && responseData?.name ? responseData.name : '';
        walletActivityNameCacheRef.current[address] = senderName || '';
        return senderName || address;
      } catch (error) {
        console.error('Failed to resolve wallet activity participant name:', error);
        walletActivityNameCacheRef.current[address] = '';
        return address;
      }
    },
    []
  );
  const fetchWalletActivityTransactionBySignature = useCallback(
    async (signature?: string) => {
      if (!signature) return null;

      try {
        const response = await fetch(
          `${getBaseApiReact()}/transactions/signature/${encodeURIComponent(signature)}`
        );

        if (!response.ok) return null;

        const responseData = await response.json();
        return responseData && typeof responseData === 'object'
          ? (responseData as WalletActivityTransaction)
          : null;
      } catch (error) {
        console.error('Failed to load wallet activity transaction by signature:', error);
        return null;
      }
    },
    []
  );
  const buildWalletActivityEntry = useCallback(
    async (transaction: WalletActivityTransaction | null | undefined) => {
      if (!transaction || !userAddress) return null;

      let resolvedTransaction = transaction;
      let creatorAddress = getWalletActivityCreatorAddress(resolvedTransaction);
      let recipientAddress = getWalletActivityRecipientAddress(resolvedTransaction);

      if (
        (!creatorAddress || !recipientAddress) &&
        resolvedTransaction.signature
      ) {
        const fullTransaction = await fetchWalletActivityTransactionBySignature(
          resolvedTransaction.signature
        );

        if (fullTransaction) {
          resolvedTransaction = {
            ...resolvedTransaction,
            ...fullTransaction,
            timestamp:
              resolvedTransaction.timestamp ?? fullTransaction.timestamp,
          };
          creatorAddress = getWalletActivityCreatorAddress(resolvedTransaction);
          recipientAddress = getWalletActivityRecipientAddress(resolvedTransaction);
        }
      }

      const timestamp = Number(resolvedTransaction.timestamp);
      const amount = Number(resolvedTransaction.amount);
      const isOutgoing = creatorAddress === userAddress;
      const isIncoming = recipientAddress === userAddress;

      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(amount) ||
        (!isIncoming && !isOutgoing) ||
        !isWalletActivityTimestampRecent(timestamp)
      ) {
        return null;
      }

      const counterpartyAddress = isOutgoing
        ? recipientAddress
        : creatorAddress;

      if (!counterpartyAddress) return null;

      const counterpartyLabel = await resolveWalletActivityAddressLabel(
        counterpartyAddress
      );

      return {
        amount,
        counterpartyAddress,
        counterpartyLabel,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        timestamp,
      };
    },
    [
      fetchWalletActivityTransactionBySignature,
      resolveWalletActivityAddressLabel,
      userAddress,
    ]
  );
  const latestPaymentNotificationTransaction =
    useMemo<WalletActivityTransaction | null>(() => {
      if (!userAddress || !Array.isArray(paymentNotifications)) return null;

      return paymentNotifications
        .map((notification: WalletActivityPaymentNotification) => {
          if (
            notification?.event !== WALLET_ACTIVITY_PAYMENT_RECEIVED_EVENT ||
            !notification?.data
          ) {
            return null;
          }

          const transaction = {
            ...notification.data,
            timestamp: notification.data.timestamp ?? notification.timestamp,
          };
          const timestamp = Number(transaction.timestamp);
          const creatorAddress = getWalletActivityCreatorAddress(transaction);
          const recipientAddress = getWalletActivityRecipientAddress(transaction);

          if (
            !Number.isFinite(timestamp) ||
            !isWalletActivityTimestampRecent(timestamp) ||
            (creatorAddress !== userAddress && recipientAddress !== userAddress)
          ) {
            return null;
          }

          return transaction;
        })
        .filter((transaction): transaction is WalletActivityTransaction =>
          Boolean(transaction)
        )
        .sort(
          (first, second) =>
            Number(second.timestamp) - Number(first.timestamp)
        )[0] ?? null;
    }, [paymentNotifications, userAddress]);
  const loadRecentWalletActivity = useCallback(async () => {
    if (!userAddress) {
      setRecentWalletActivity(null);
      setIsWalletActivityLoading(false);
      return;
    }

    setIsWalletActivityLoading(true);

    try {
      const response = await fetch(
        `${getBaseApiReact()}/transactions/search?txType=PAYMENT&address=${userAddress}&confirmationStatus=CONFIRMED&limit=${WALLET_ACTIVITY_RECENT_PAYMENT_FETCH_LIMIT}&reverse=true`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch wallet activity payments');
      }

      const responseData = await response.json();
      const latestRelevantPayment = Array.isArray(responseData)
        ? responseData.find(
            (transaction: WalletActivityTransaction) =>
              (getWalletActivityCreatorAddress(transaction) === userAddress ||
                getWalletActivityRecipientAddress(transaction) === userAddress) &&
              Number.isFinite(Number(transaction?.timestamp)) &&
              isWalletActivityTimestampRecent(Number(transaction.timestamp))
          )
        : null;

      const recentEntry = await buildWalletActivityEntry(latestRelevantPayment);
      setRecentWalletActivity((currentEntry) => {
        if (!recentEntry) {
          return currentEntry &&
            isWalletActivityTimestampRecent(currentEntry.timestamp)
            ? currentEntry
            : null;
        }

        if (
          currentEntry &&
          isWalletActivityTimestampRecent(currentEntry.timestamp) &&
          currentEntry.timestamp > recentEntry.timestamp
        ) {
          return currentEntry;
        }

        return recentEntry;
      });
    } catch (error) {
      console.error('Failed to load recent wallet activity:', error);
      setRecentWalletActivity((currentEntry) =>
        currentEntry && isWalletActivityTimestampRecent(currentEntry.timestamp)
          ? currentEntry
          : null
      );
    } finally {
      setIsWalletActivityLoading(false);
    }
  }, [buildWalletActivityEntry, userAddress]);
  const assignGroupActivityPanelNode = useCallback((node: HTMLDivElement | null) => {
    groupActivityPanelRef.current = node;
    groupActivityCardHeightRef.current = node;
  }, [groupActivityPanelRef]);

  useEffect(() => {
    localStorage.setItem(
      HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY,
      JSON.stringify(customizableCardsLayout)
    );
  }, [customizableCardsLayout]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setWalletActivityRelativeTimeNow(Date.now());
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    setRecentWalletActivity(null);
    lastWalletActivityBalanceRef.current = null;
  }, [userAddress]);

  useEffect(() => {
    if (!userAddress || balance == null) {
      return;
    }

    const nextBalanceKey = String(balance);
    if (lastWalletActivityBalanceRef.current == null) {
      lastWalletActivityBalanceRef.current = nextBalanceKey;
      return;
    }

    if (lastWalletActivityBalanceRef.current === nextBalanceKey) {
      return;
    }

    lastWalletActivityBalanceRef.current = nextBalanceKey;
    const refreshTimer = window.setTimeout(() => {
      loadRecentWalletActivity();
    }, 650);

    return () => {
      window.clearTimeout(refreshTimer);
    };
  }, [balance, loadRecentWalletActivity, userAddress]);

  useEffect(() => {
    let isCancelled = false;

    const updateRecentActivityFromNotifications = async () => {
      if (!latestPaymentNotificationTransaction) return;

      const notificationEntry = await buildWalletActivityEntry(
        latestPaymentNotificationTransaction
      );

      if (isCancelled || !notificationEntry) return;

      setRecentWalletActivity((currentEntry) => {
        if (
          currentEntry &&
          isWalletActivityTimestampRecent(currentEntry.timestamp) &&
          currentEntry.timestamp > notificationEntry.timestamp
        ) {
          return currentEntry;
        }

        return notificationEntry;
      });
      setIsWalletActivityLoading(false);
    };

    // The notification websocket now supplies recent PAYMENT_RECEIVED history
    // faster than transaction search. The bell filters those entries out, but
    // Wallet Activity can still use them as the fast path and keep search as a fallback.
    updateRecentActivityFromNotifications();

    return () => {
      isCancelled = true;
    };
  }, [buildWalletActivityEntry, latestPaymentNotificationTransaction]);

  useEffect(() => {
    let isCancelled = false;

    loadRecentWalletActivity();

    const handleRecentWalletPaymentMessage = async (event: MessageEvent) => {
      if (!userAddress) return;
      if (event.origin !== window.location.origin) return;

      const message = event.data;
      if (message?.action !== 'SET_PAYMENT_ANNOUNCEMENT' || !message?.payload) {
        return;
      }

      if (getWalletActivityRecipientAddress(message.payload) !== userAddress) {
        return;
      }

      const incomingEntry = await buildWalletActivityEntry(message.payload);
      if (!incomingEntry) {
        return;
      }

      if (!isCancelled) {
        setRecentWalletActivity((currentEntry) => {
          if (
            currentEntry &&
            isWalletActivityTimestampRecent(currentEntry.timestamp) &&
            currentEntry.timestamp > incomingEntry.timestamp
          ) {
            return currentEntry;
          }

          return incomingEntry;
        });
        setIsWalletActivityLoading(false);
      }
    };

    window.addEventListener('message', handleRecentWalletPaymentMessage);

    return () => {
      isCancelled = true;
      window.removeEventListener('message', handleRecentWalletPaymentMessage);
    };
  }, [buildWalletActivityEntry, loadRecentWalletActivity, userAddress]);

  useEffect(() => {
    setCustomizableCardsLayout((currentLayout) => {
      let changed = false;
      const nextHeights: Partial<Record<HomeCustomizableCardId, number>> = {
        ...currentLayout.heights,
      };

      HOME_CUSTOMIZABLE_CARD_ORDER_DEFAULT.forEach((cardId) => {
        const currentHeight = currentLayout.heights[cardId];
        if (typeof currentHeight !== 'number' || !Number.isFinite(currentHeight)) {
          return;
        }
        const clampedHeight = clampHomeCustomizableCardHeight(
          cardId,
          currentHeight
        );
        if (clampedHeight !== currentHeight) {
          nextHeights[cardId] = clampedHeight;
          changed = true;
        }
      });

      if (!changed) return currentLayout;
      return {
        ...currentLayout,
        heights: nextHeights,
      };
    });
  }, []);

  const getCurrentCustomizableCardHeight = useCallback(
    (cardId: HomeCustomizableCardId) => {
      const storedHeight = customizableCardsLayout.heights[cardId];
      if (storedHeight != null) return storedHeight;

      const sourceNode =
        cardId === 'groupActivity'
          ? groupActivityCardHeightRef.current
          : quitterCardHeightRef.current;
      const measuredHeight = sourceNode?.getBoundingClientRect().height;

      if (measuredHeight && Number.isFinite(measuredHeight)) {
        return Math.round(measuredHeight);
      }

      return cardId === 'groupActivity'
        ? HOME_GROUP_ACTIVITY_CARD_DEFAULT_HEIGHT_PX
        : HOME_EMBEDDED_QAPP_PANEL_HEIGHT_PX;
    },
    [customizableCardsLayout.heights]
  );

  const moveCustomizableCard = useCallback(
    (cardId: HomeCustomizableCardId, direction: 'up' | 'down') => {
      setCustomizableCardsLayout((currentLayout) => {
        const currentIndex = currentLayout.order.indexOf(cardId);
        if (currentIndex === -1) return currentLayout;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= currentLayout.order.length) {
          return currentLayout;
        }

        const nextOrder = [...currentLayout.order];
        const [movedCard] = nextOrder.splice(currentIndex, 1);
        nextOrder.splice(targetIndex, 0, movedCard);

        return {
          ...currentLayout,
          order: nextOrder,
        };
      });
    },
    []
  );

  const resizeCustomizableCard = useCallback(
    (cardId: HomeCustomizableCardId, direction: 'grow' | 'shrink') => {
      const currentHeight = getCurrentCustomizableCardHeight(cardId);
      const delta =
        direction === 'grow'
          ? HOME_CUSTOMIZABLE_CARD_RESIZE_STEP_PX
          : -HOME_CUSTOMIZABLE_CARD_RESIZE_STEP_PX;
      const nextHeight = Math.max(
        HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS[cardId],
        Math.min(
          HOME_CUSTOMIZABLE_CARD_MAX_HEIGHTS[cardId],
          currentHeight + delta
        )
      );

      setCustomizableCardsLayout((currentLayout) => ({
        ...currentLayout,
        heights: {
          ...currentLayout.heights,
          [cardId]: nextHeight,
        },
      }));
    },
    [getCurrentCustomizableCardHeight]
  );

  const renderCustomizableCardControls = useCallback(
    (cardId: HomeCustomizableCardId) => {
      const currentIndex = customizableCardsLayout.order.indexOf(cardId);
      const canMoveUp = currentIndex > 0;
      const canMoveDown = currentIndex !== -1 && currentIndex < customizableCardsLayout.order.length - 1;
      const iconButtonSx = {
        borderRadius: '8px',
        color: theme.palette.text.secondary,
        height: 28,
        width: 28,
        '&:hover': {
          backgroundColor: theme.palette.action.hover,
          color: theme.palette.text.primary,
        },
      } as const;

      return (
        <Box
          sx={{
            alignItems: 'center',
            display: 'inline-flex',
            gap: '4px',
          }}
        >
          <IconButton
            aria-label="Move card up"
            disabled={!canMoveUp}
            onClick={() => moveCustomizableCard(cardId, 'up')}
            size="small"
            sx={iconButtonSx}
          >
            <KeyboardArrowUpRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton
            aria-label="Move card down"
            disabled={!canMoveDown}
            onClick={() => moveCustomizableCard(cardId, 'down')}
            size="small"
            sx={iconButtonSx}
          >
            <KeyboardArrowDownRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton
            aria-label="Decrease card height"
            onClick={() => resizeCustomizableCard(cardId, 'shrink')}
            size="small"
            sx={iconButtonSx}
          >
            <RemoveRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton
            aria-label="Increase card height"
            onClick={() => resizeCustomizableCard(cardId, 'grow')}
            size="small"
            sx={iconButtonSx}
          >
            <AddRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      );
    },
    [customizableCardsLayout.order, moveCustomizableCard, resizeCustomizableCard, theme.palette.action.hover, theme.palette.text.primary, theme.palette.text.secondary]
  );

  useLayoutEffect(() => {
    const rootNode = homeLayoutDebugRootRef.current;

    if (!rootNode || desktopViewMode !== 'home') {
      setWalletActivityTargetHeightPx(null);
      return;
    }

    const measureDebugLayout = () => {
      const rootRect = rootNode.getBoundingClientRect();
      const nextMetrics: Partial<Record<HomeLayoutDebugKey, HomeLayoutDebugMetric>> = {};

      if (accountOverviewDebugRef.current) {
        nextMetrics.accountOverview = measureHomeLayoutDebugMetric(
          accountOverviewDebugRef.current,
          rootRect
        );
      }

      if (infoDebugRef.current) {
        nextMetrics.info = measureHomeLayoutDebugMetric(infoDebugRef.current, rootRect);
      }

      if (profileCardDebugRef.current) {
        nextMetrics.profileCard = measureHomeLayoutDebugMetric(
          profileCardDebugRef.current,
          rootRect
        );
      }

      if (toolsDebugRef.current) {
        nextMetrics.tools = measureHomeLayoutDebugMetric(
          toolsDebugRef.current,
          rootRect
        );
      }

      if (featuredAppsDebugRef.current) {
        nextMetrics.featuredApps = measureHomeLayoutDebugMetric(
          featuredAppsDebugRef.current,
          rootRect
        );
      }

      if (walletActivityDebugRef.current) {
        nextMetrics.walletActivity = measureHomeLayoutDebugMetric(
          walletActivityDebugRef.current,
          rootRect
        );
      }

      if (isWideDashboardLayout) {
        const profileMetric = nextMetrics.profileCard;
        const leftRowMetric =
          nextMetrics.featuredApps ?? nextMetrics.tools ?? undefined;
        const featuredMetric = nextMetrics.featuredApps;
        const toolsMetric = nextMetrics.tools;
        const walletMetric = nextMetrics.walletActivity;

        if (profileMetric && featuredMetric && toolsMetric) {
          const nextQortinoTargetHeight = Math.max(
            HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX,
            Math.round(profileMetric.height + featuredMetric.height - toolsMetric.height)
          );

          setQortinoCardTargetHeightPx((currentHeight) =>
            currentHeight !== null &&
            Math.abs(currentHeight - nextQortinoTargetHeight) < 0.25
              ? currentHeight
              : nextQortinoTargetHeight
          );
        } else {
          setQortinoCardTargetHeightPx(null);
        }

        if (leftRowMetric && walletMetric) {
          const nextTargetHeight = Math.max(
            0,
            leftRowMetric.bottom - walletMetric.top
          );

          setWalletActivityTargetHeightPx((currentHeight) =>
            currentHeight !== null &&
            Math.abs(currentHeight - nextTargetHeight) < 0.25
              ? currentHeight
              : nextTargetHeight
          );
        } else {
          setWalletActivityTargetHeightPx(null);
        }
      } else {
        setQortinoCardTargetHeightPx(null);
        setWalletActivityTargetHeightPx(null);
      }

      return {
        accountOverviewTop: nextMetrics.accountOverview?.top ?? 0,
        featuredBottom: nextMetrics.featuredApps?.bottom ?? 0,
        featuredTop: nextMetrics.featuredApps?.top ?? 0,
        infoBottom: nextMetrics.info?.bottom ?? 0,
        toolsBottom: nextMetrics.tools?.bottom ?? 0,
        walletBottom: nextMetrics.walletActivity?.bottom ?? 0,
        walletTop: nextMetrics.walletActivity?.top ?? 0,
      };
    };

    const cancelLayoutStabilizePass = () => {
      if (layoutStabilizeFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutStabilizeFrameRef.current);
        layoutStabilizeFrameRef.current = null;
      }
    };

    const startLayoutStabilizePass = () => {
      cancelLayoutStabilizePass();

      const startTime = performance.now();
      let lastSnapshot = '';
      let stableFrameCount = 0;

      const step = () => {
        const snapshot = measureDebugLayout();
        const snapshotKey = JSON.stringify(snapshot);

        if (snapshotKey === lastSnapshot) {
          stableFrameCount += 1;
        } else {
          lastSnapshot = snapshotKey;
          stableFrameCount = 0;
        }

        const elapsed = performance.now() - startTime;
        if (stableFrameCount >= 3 || elapsed > 900) {
          layoutStabilizeFrameRef.current = null;
          return;
        }

        layoutStabilizeFrameRef.current = window.requestAnimationFrame(step);
      };

      layoutStabilizeFrameRef.current = window.requestAnimationFrame(step);
    };

    measureDebugLayout();
    startLayoutStabilizePass();

    const fonts = (document as Document & {
      fonts?: { ready?: Promise<unknown> };
    }).fonts;

    if (fonts?.ready) {
      fonts.ready.then(() => {
        startLayoutStabilizePass();
      });
    }

    const observedNodes = [
      rootNode,
      accountOverviewDebugRef.current,
      infoDebugRef.current,
      profileCardDebugRef.current,
      toolsDebugRef.current,
      featuredAppsDebugRef.current,
      walletActivityDebugRef.current,
    ].filter(Boolean) as HTMLElement[];

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureDebugLayout);

      return () => {
        window.removeEventListener('resize', measureDebugLayout);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      startLayoutStabilizePass();
    });

    observedNodes.forEach((node) => {
      resizeObserver.observe(node);
    });
    window.addEventListener('resize', startLayoutStabilizePass);

    return () => {
      cancelLayoutStabilizePass();
      resizeObserver.disconnect();
      window.removeEventListener('resize', startLayoutStabilizePass);
    };
  }, [
    activeTab,
    desktopViewMode,
    isOnboardingComplete,
    isWideDashboardLayout,
    showMostActiveGroups,
  ]);

  const setActivityToggleSegmentRef = useCallback(
    (tab: ActivityTab) => (node: HTMLButtonElement | null) => {
      activityToggleSegmentRefs.current[tab] = node;
    },
    []
  );
  const updateActivityToggleIndicator = useCallback(() => {
    const track = activityToggleTrackRef.current;
    const activeSegment = activityToggleSegmentRefs.current[activityTab];

    if (!track || !activeSegment) return;

    const trackRect = track.getBoundingClientRect();
    const segmentRect = activeSegment.getBoundingClientRect();
    const nextIndicator = {
      ready: true,
      width: segmentRect.width,
      x: segmentRect.left - trackRect.left,
    };

    setActivityToggleIndicator((prev) => {
      if (
        prev.ready === nextIndicator.ready &&
        Math.abs(prev.width - nextIndicator.width) < 0.5 &&
        Math.abs(prev.x - nextIndicator.x) < 0.5
      ) {
        return prev;
      }

      return nextIndicator;
    });
  }, [activityTab]);

  useLayoutEffect(() => {
    updateActivityToggleIndicator();
  }, [
    updateActivityToggleIndicator,
    requestsCount,
    invitesCount,
    promotionsCount,
    requestsCountLoading,
    invitesCountLoading,
  ]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const contentNode = groupActivityContentFrameRef.current;
    const topControlsNode = groupActivityTopControlsRef.current;
    if (!contentNode || !topControlsNode) return undefined;

    let animationFrame = 0;

    const updateViewportHeight = () => {
      const contentRect = contentNode.getBoundingClientRect();
      const topControlsRect = topControlsNode.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(contentNode);
      const gapPx = parseFloat(computedStyle.rowGap || computedStyle.gap || '0') || 0;
      const nextViewportHeight = Math.max(
        280,
        Math.floor(contentRect.height - topControlsRect.height - gapPx)
      );

      setGroupActivityMeasuredViewportHeightPx((prev) =>
        prev != null && Math.abs(prev - nextViewportHeight) < 1
          ? prev
          : nextViewportHeight
      );
    };

    const scheduleViewportHeightUpdate = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateViewportHeight);
    };

    scheduleViewportHeightUpdate();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', scheduleViewportHeightUpdate);
      return () => {
        cancelAnimationFrame(animationFrame);
        window.removeEventListener('resize', scheduleViewportHeightUpdate);
      };
    }

    const resizeObserver = new ResizeObserver(scheduleViewportHeightUpdate);
    resizeObserver.observe(contentNode);
    resizeObserver.observe(topControlsNode);
    window.addEventListener('resize', scheduleViewportHeightUpdate);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleViewportHeightUpdate);
    };
  }, [
    activityTab,
    customizableCardsLayout.heights.groupActivity,
    invitesCount,
    invitesCountLoading,
    promotionsCount,
    requestsCount,
    requestsCountLoading,
  ]);

  useEffect(() => {
    const track = activityToggleTrackRef.current;
    if (!track) return;

    let animationFrame = 0;
    const scheduleIndicatorUpdate = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateActivityToggleIndicator);
    };

    scheduleIndicatorUpdate();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', scheduleIndicatorUpdate);
      return () => {
        cancelAnimationFrame(animationFrame);
        window.removeEventListener('resize', scheduleIndicatorUpdate);
      };
    }

    const resizeObserver = new ResizeObserver(scheduleIndicatorUpdate);
    resizeObserver.observe(track);
    Object.values(activityToggleSegmentRefs.current).forEach((segment) => {
      if (segment) resizeObserver.observe(segment);
    });
    window.addEventListener('resize', scheduleIndicatorUpdate);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleIndicatorUpdate);
    };
  }, [
    updateActivityToggleIndicator,
    requestsCount,
    invitesCount,
    promotionsCount,
    requestsCountLoading,
    invitesCountLoading,
  ]);

  useEffect(() => {
    if (!userAddress) {
      setIsOnboardingComplete(false);
      setShowMostActiveGroups(false);
      return;
    }

    const isComplete =
      localStorage.getItem(`${GETTING_STARTED_LS_KEY}_${userAddress}`) ===
      'completed';
    setIsOnboardingComplete(isComplete);
    setShowMostActiveGroups(isComplete);
  }, [userAddress]);

  useEffect(() => {
    let active = true;
    if (!userAddress) { setMinterLevel(null); return; }
    getIndividualUserInfo(userAddress).then((level) => {
      if (active) setMinterLevel(typeof level === 'number' ? level : null);
    }).catch(() => {
      if (active) setMinterLevel(null);
    });
    return () => { active = false; };
  }, [getIndividualUserInfo, userAddress]);

  useEffect(() => {
    let active = true;

    const loadMinterProgress = async () => {
      if (!userAddress) {
        if (active) setMinterProgress(null);
        return;
      }

      try {
        const response = await fetch(`${getBaseApiReact()}/addresses/${userAddress}`);
        if (!response.ok) {
          throw new Error('network error');
        }

        const data = await response.json();
        if (!active) return;

        const currentLevel =
          typeof data?.level === 'number' && Number.isFinite(data.level)
            ? data.level
            : null;
        const mintedBlocks =
          typeof data?.blocksMinted === 'number' && Number.isFinite(data.blocksMinted)
            ? data.blocksMinted
            : 0;
        const mintedAdjustment =
          typeof data?.blocksMintedAdjustment === 'number' &&
          Number.isFinite(data.blocksMintedAdjustment)
            ? data.blocksMintedAdjustment
            : 0;
        const currentBlocks = Math.max(0, mintedBlocks + mintedAdjustment);
        const requiredBlocks =
          currentLevel != null
            ? currentLevel >= 10
              ? currentBlocks
              : accountTargetBlocks(currentLevel)
            : undefined;

        if (currentLevel == null || requiredBlocks == null) {
          setMinterProgress(null);
          return;
        }

        setMinterProgress({
          currentBlocks,
          currentLevel,
          progressRatio:
            requiredBlocks > 0
              ? Math.max(0, Math.min(1, currentBlocks / requiredBlocks))
              : 0,
          requiredBlocks,
        });
      } catch {
        if (active) {
          setMinterProgress(null);
        }
      }
    };

    loadMinterProgress();
    const interval = window.setInterval(loadMinterProgress, 30000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [userAddress]);

  useEffect(() => {
    let active = true;

    const loadCoreInfo = async () => {
      try {
        const response = await fetch(`${getBaseApiReact()}/admin/info`, {
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'GET',
        });
        const data = await response.json();
        if (!active) return;
        setCoreVersionLabel(data?.buildVersion ? String(data.buildVersion).substring(0, 20) : '—');
      } catch {
        if (active) {
          setCoreVersionLabel('—');
        }
      }
    };

    loadCoreInfo();
    const interval = window.setInterval(loadCoreInfo, 30000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const handleSetMinterDefaultView = useCallback((nextView: MinterInfoView) => {
    setMinterDefaultView(nextView);
    localStorage.setItem(DASHBOARD_MINTER_DEFAULT_VIEW_STORAGE_KEY, nextView);
  }, []);

  const handleRefreshGroupActivity = () => {
    setGroupWidgetRefreshToken((value) => value + 1);
  };

  const handleRefreshQuitterWidget = useCallback(() => {
    setQuitterWidgetRefreshToken((value) => value + 1);
  }, []);

  const handleSwapDashboardWidgets = useCallback(() => {
    setCustomizableCardsLayout((currentLayout) => ({
      ...currentLayout,
      order: [...currentLayout.order].reverse(),
    }));
  }, []);

  const balanceLabel = balance != null ? `${Number(balance).toFixed(2)} QORT` : '—';
  const handleOpenAppsPanel = useCallback(() => {
    executeEvent('newTabWindow', {});
    setDesktopViewMode('apps');
  }, [setDesktopViewMode]);
  const handleOpenEmbeddedQuitter = () => {
    executeEvent('addTab', { data: { service: 'APP', name: 'Quitter' } });
    executeEvent('open-apps-mode', {});
  };
  const handleOpenQChatPanel = useCallback(() => {
    setSelectedGroup(null);
    setGroupSection('chat');
    openQChatTab();
  }, [setGroupSection, setSelectedGroup]);
  const handleOpenGroupsWidget = useCallback(() => {
    handleOpenQChatPanel();
  }, [handleOpenQChatPanel]);

  const hasLiveNodeConnection = nodeInfos?.height != null;
  const liveSyncPercent =
    hasLiveNodeConnection &&
    nodeInfos?.isSynchronizing &&
    nodeInfos?.syncPercent !== 100
      ? Math.round(nodeInfos?.syncPercent || 0)
      : 100;
  const nodeStatusValue = hasLiveNodeConnection
    ? t('group:dashboard.sync_percent', {
        defaultValue: '{{percent}}% Synced',
        percent: liveSyncPercent,
      })
    : td('node_unavailable', 'Node unavailable');
  const peersLabel = `${nodeInfos?.numberOfConnections || 0}`;
  const blockHeightLabel = `${nodeInfos?.height || '—'}`;
  const hubVersionLabel = manifestData.version || '—';
  const qdnPeersLabel = `${nodeInfos?.numberOfDataConnections || 0}`;
  const qortinoWorkspaceShellFallback = (
    <Box
      sx={{
        ...dashboardPanelSx(theme, 'utility'),
        alignItems: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: '100%',
        justifyContent: 'center',
        p: '20px',
      }}
    >
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}
      >
        {td('qortino_runtime_title', 'QORTINO card shell hit a runtime snag.')}
      </Typography>
      <Typography
        sx={{
          color: alpha(theme.palette.text.secondary, 0.82),
          fontSize: '0.82rem',
          lineHeight: 1.5,
          maxWidth: '34ch',
        }}
      >
        {td(
          'qortino_runtime_body',
          'The rest of the dashboard is still safe. Refresh the Hub and if this keeps happening report it to the team.'
        )}
      </Typography>
    </Box>
  );
  const nodeBase = getBaseApiReact();
  const nodeHostLabel = (() => {
    try {
      return new URL(nodeBase).host;
    } catch {
      return nodeDisplay(nodeBase);
    }
  })();
  const nodeTypeLabel = isLocalNodeUrl(nodeBase)
    ? td('local_node', 'Local node')
    : nodeBase.includes('ext-node.qortal.link')
      ? td('public_node', 'Public node')
      : td('custom_node', 'Custom node');
  const isSystemOperational =
    hasLiveNodeConnection &&
    !(nodeInfos?.isSynchronizing && nodeInfos?.syncPercent !== 100);
  const statusPreviewOverrides =
    statusPreviewMode === 'live'
      ? null
      : statusPreviewMode === 'syncing'
        ? {
            blockHeight: '1,944,216',
            coreVersion: coreVersionLabel,
            hubVersion: hubVersionLabel,
            isOperational: false,
            nodeHost: 'ext-node.qortal.link',
            nodeStatus: t('group:dashboard.sync_percent', {
              defaultValue: '{{percent}}% Synced',
              percent: 62,
            }),
            nodeType: td('public_node', 'Public node'),
            peers: '184',
            qdnPeers: '97',
            statusLabel: td('synchronizing', 'Synchronizing'),
          }
        : statusPreviewMode === 'local'
          ? {
              blockHeight: '1,944,882',
              coreVersion: coreVersionLabel,
              hubVersion: hubVersionLabel,
              isOperational: true,
              nodeHost: '127.0.0.1:12391',
              nodeStatus: t('group:dashboard.sync_percent', {
                defaultValue: '{{percent}}% Synced',
                percent: 100,
              }),
              nodeType: td('local_node', 'Local node'),
              peers: '42',
              qdnPeers: '28',
              statusLabel: td('fully_operational', 'Fully operational'),
            }
          : statusPreviewMode === 'custom'
            ? {
                blockHeight: '1,944,801',
                coreVersion: coreVersionLabel,
                hubVersion: hubVersionLabel,
                isOperational: true,
                nodeHost: 'node.qortal.example',
                nodeStatus: t('group:dashboard.sync_percent', {
                  defaultValue: '{{percent}}% Synced',
                  percent: 100,
                }),
                nodeType: td('custom_node', 'Custom node'),
                peers: '221',
                qdnPeers: '153',
                statusLabel: td('fully_operational', 'Fully operational'),
              }
            : {
                blockHeight: '—',
                coreVersion: coreVersionLabel,
                hubVersion: hubVersionLabel,
                isOperational: false,
                nodeHost: 'node.qortal.example',
                nodeStatus: td('node_unavailable', 'Node unavailable'),
                nodeType: td('custom_node', 'Custom node'),
                peers: '0',
                qdnPeers: '0',
                statusLabel: td('attention_needed', 'Attention needed'),
              };
  const resolvedInfoStatusLabel =
    statusPreviewOverrides?.statusLabel ??
    (isSystemOperational
      ? td('fully_operational', 'Fully operational')
      : td('not_operational', 'Not operational'));
  const resolvedIsSystemOperational =
    statusPreviewOverrides?.isOperational ?? isSystemOperational;
  const resolvedInfoStatusTone: DashboardInfoStatusTone =
    statusPreviewMode === 'issue'
      ? 'issue'
      : statusPreviewMode === 'syncing' ||
          (!statusPreviewOverrides && nodeInfos?.isSynchronizing && nodeInfos?.syncPercent !== 100)
        ? 'syncing'
        : resolvedIsSystemOperational
          ? 'operational'
          : 'issue';
  const resolvedNodeStatusValue =
    statusPreviewOverrides?.nodeStatus ?? nodeStatusValue;
  const resolvedPeersLabel = statusPreviewOverrides?.peers ?? peersLabel;
  const resolvedBlockHeightLabel =
    statusPreviewOverrides?.blockHeight ?? blockHeightLabel;
  const resolvedQdnPeersLabel =
    statusPreviewOverrides?.qdnPeers ?? qdnPeersLabel;
  const resolvedNodeHostLabel =
    statusPreviewOverrides?.nodeHost ?? nodeHostLabel;
  const resolvedNodeTypeLabel =
    statusPreviewOverrides?.nodeType ?? nodeTypeLabel;
  const resolvedCoreVersionLabel =
    statusPreviewOverrides?.coreVersion ?? coreVersionLabel;
  const resolvedHubVersionLabel =
    statusPreviewOverrides?.hubVersion ?? hubVersionLabel;
  const minterDotsFilled =
    minterPreviewMode === 'on'
      ? Math.max(1, Math.min(9, minterLevel ?? 5))
      : 0;
  const isMinterOn = minterPreviewMode === 'on';
  const formattedMinterCurrentBlocks =
    minterProgress?.currentBlocks != null
      ? minterProgress.currentBlocks.toLocaleString()
      : null;
  const formattedMinterRequiredBlocks =
    minterProgress?.requiredBlocks != null
      ? minterProgress.requiredBlocks.toLocaleString()
      : null;
  const hasMinterProgressSummary =
    minterProgress != null &&
    formattedMinterCurrentBlocks != null &&
    formattedMinterRequiredBlocks != null;
  const resolvedMinterDefaultView: MinterInfoView =
    hasMinterProgressSummary && minterDefaultView === 'progress'
      ? 'progress'
      : 'dots';
  const minterHoverView: MinterInfoView =
    resolvedMinterDefaultView === 'dots' ? 'progress' : 'dots';
  const isShowingMinterHoverView =
    hasMinterProgressSummary && isMinterFieldHovered;
  const activeMinterInfoView: MinterInfoView = isShowingMinterHoverView
    ? minterHoverView
    : resolvedMinterDefaultView;
  const minterPinActionLabel =
    activeMinterInfoView === 'progress'
      ? 'Save level bar as default view'
      : 'Save minting dots as default view';
  const minterValue = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'inline-flex',
        height: '22px',
        justifyContent: 'flex-end',
        minWidth: `${INFO_VALUE_COLUMN_MIN_WIDTH_PX}px`,
        width: '100%',
      }}
    >
      <AnimatePresence initial={false} mode="wait">
        {isMinterOn ? (
          <motion.div
            key="minter-level"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            style={{ alignItems: 'center', display: 'flex', height: '22px', justifyContent: 'flex-end', width: '100%' }}
          >
            <Box
              onMouseEnter={
                hasMinterProgressSummary
                  ? () => setIsMinterFieldHovered(true)
                  : undefined
              }
              onMouseLeave={
                hasMinterProgressSummary
                  ? () => setIsMinterFieldHovered(false)
                  : undefined
              }
              onFocusCapture={
                hasMinterProgressSummary
                  ? () => setIsMinterFieldHovered(true)
                  : undefined
              }
              onBlurCapture={
                hasMinterProgressSummary
                  ? (event) => {
                      const nextFocusedElement = event.relatedTarget;

                      if (
                        !(nextFocusedElement instanceof Node) ||
                        !event.currentTarget.contains(nextFocusedElement)
                      ) {
                        setIsMinterFieldHovered(false);
                      }
                    }
                  : undefined
              }
              sx={{
                alignItems: 'center',
                display: 'inline-flex',
                height: '22px',
                justifyContent: 'flex-end',
                maxWidth: '100%',
                minWidth: '180px',
                width: '180px',
              }}
            >
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={activeMinterInfoView}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  style={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '8px',
                    height: '22px',
                    justifyContent: 'flex-end',
                    width: '100%',
                  }}
                >
                  {isShowingMinterHoverView ? (
                    <Tooltip title={minterPinActionLabel}>
                      <ButtonBase
                        aria-label={minterPinActionLabel}
                        disableRipple
                        onClick={() =>
                          handleSetMinterDefaultView(activeMinterInfoView)
                        }
                        sx={{
                          alignItems: 'center',
                          borderRadius: '999px',
                          color: alpha(
                            GROUP_ACTIVITY_BLUE.primary,
                            theme.palette.mode === 'dark' ? 0.92 : 0.82
                          ),
                          display: 'inline-flex',
                          flexShrink: 0,
                          height: '18px',
                          justifyContent: 'center',
                          transition:
                            'background-color 140ms ease, color 140ms ease, transform 120ms ease',
                          width: '18px',
                          '&:hover': {
                            backgroundColor: alpha(
                              GROUP_ACTIVITY_BLUE.primary,
                              theme.palette.mode === 'dark' ? 0.18 : 0.12
                            ),
                            color: GROUP_ACTIVITY_BLUE.primary,
                            transform: 'translateY(-1px)',
                          },
                          '&:active': {
                            transform: 'translateY(0)',
                          },
                        }}
                      >
                        <LockOpenRoundedIcon sx={{ fontSize: '0.92rem' }} />
                      </ButtonBase>
                    </Tooltip>
                  ) : null}

                  {activeMinterInfoView === 'progress' && hasMinterProgressSummary ? (
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'inline-flex',
                        gap: '8px',
                        justifyContent: 'flex-end',
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Box
                        sx={{
                          background:
                            theme.palette.mode === 'dark'
                              ? 'rgba(255,255,255,0.08)'
                              : 'rgba(15,23,42,0.08)',
                          borderRadius: '999px',
                          flexShrink: 0,
                          height: '6px',
                          overflow: 'hidden',
                          width: '56px',
                        }}
                      >
                        <Box
                          sx={{
                            background: GROUP_ACTIVITY_BLUE.primary,
                            borderRadius: '999px',
                            height: '100%',
                            transition: 'width 180ms ease',
                            width: `${Math.max(
                              0,
                              Math.min(100, minterProgress.progressRatio * 100)
                            )}%`,
                          }}
                        />
                      </Box>
                      <Typography
                        sx={{
                          color: alpha(theme.palette.text.primary, 0.84),
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          letterSpacing: '0.01em',
                          lineHeight: 1,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formattedMinterCurrentBlocks} / {formattedMinterRequiredBlocks}
                      </Typography>
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'inline-flex',
                        gap: '4px',
                        height: '18px',
                        justifyContent: 'flex-end',
                      }}
                    >
                      {Array.from({ length: 9 }).map((_, index) => (
                        <Box
                          key={index}
                          sx={{
                            ...(index < minterDotsFilled
                              ? filledBlueDotSx
                              : emptyBlueDotSx),
                            borderRadius: '50%',
                            height: '11px',
                            width: '11px',
                          }}
                        />
                      ))}
                    </Box>
                  )}
                </motion.div>
              </AnimatePresence>
            </Box>
          </motion.div>
        ) : (
          <motion.div
            key="minter-apply"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            style={{ alignItems: 'center', display: 'flex', height: '22px', justifyContent: 'flex-end', width: '100%' }}
          >
            <ButtonBase
              onClick={() => {
                executeEvent('addTab', {
                  data: { service: 'APP', name: 'q-mintership', path: '' },
                });
                executeEvent('open-apps-mode', {});
              }}
              sx={{
                alignItems: 'center',
                backgroundColor: 'transparent',
                display: 'inline-flex',
                justifyContent: 'center',
                minWidth: 0,
                ml: 'auto',
                px: 0,
                py: 0,
                transition:
                  'color 140ms ease, text-shadow 140ms ease, transform 120ms ease',
                whiteSpace: 'nowrap',
                '&:hover': {
                  '& .minter-apply-text': {
                    color: theme.palette.mode === 'dark'
                      ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 1)
                      : alpha(GROUP_ACTIVITY_BLUE.hover, 0.98),
                    textShadow: `0 0 10px ${alpha(
                      GROUP_ACTIVITY_BLUE.primary,
                      theme.palette.mode === 'dark' ? 0.18 : 0.12
                    )}`,
                  },
                  transform: 'translateY(-1px)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                },
              }}
            >
              <Box
                component="span"
                sx={{
                  alignItems: 'center',
                  display: 'inline-flex',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  lineHeight: 1,
                  textTransform: 'uppercase',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.52),
                  }}
                >
                  [
                </Box>
                <Box
                  component="span"
                  className="minter-apply-text"
                  sx={{
                    color: theme.palette.mode === 'dark'
                      ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.94)
                      : alpha(GROUP_ACTIVITY_BLUE.pressed, 0.9),
                    px: '4px',
                    transition: 'color 140ms ease, text-shadow 140ms ease',
                  }}
                >
                  {td('apply', 'Apply')}
                </Box>
                <Box
                  component="span"
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.52),
                  }}
                >
                  ]
                </Box>
              </Box>
            </ButtonBase>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
  const coreVersionMetricLabel =
    resolvedCoreVersionLabel && resolvedCoreVersionLabel !== '—'
      ? resolvedCoreVersionLabel.replace(/^qortal-/i, '').split('-')[0] || resolvedCoreVersionLabel
      : '—';
  const infoRows = {
    status: {
      isOperational: resolvedIsSystemOperational,
      label: resolvedInfoStatusLabel,
      tone: resolvedInfoStatusTone,
    },
    primaryItems: [
      {
        emphasize: true,
        label: td('qort_balance', 'QORT Balance'),
        value: balanceLabel,
      },
      {
        label: td('node_status', 'Node Status'),
        pillTone:
          resolvedNodeStatusValue === td('node_unavailable', 'Node unavailable')
            ? 'negative'
            : resolvedNodeStatusValue ===
                t('group:dashboard.sync_percent', {
                  defaultValue: '{{percent}}% Synced',
                  percent: 100,
                })
              ? 'positive'
              : 'warning',
        value: resolvedNodeStatusValue,
        variant: 'pill',
      },
      {
        label: td('minter_level', 'Minter Level'),
        valueNode: minterValue,
      },
    ],
    metricItems: [
      {
        accent: 'blue',
        label: td('peers', 'Peers'),
        value: resolvedPeersLabel,
      },
      {
        accent: 'blue',
        label: td('qdn', 'QDN'),
        value: resolvedQdnPeersLabel,
      },
      {
        accent: 'green',
        label: td('core', 'Core'),
        value: coreVersionMetricLabel,
      },
      {
        accent: 'violet',
        label: td('hub', 'Hub'),
        value: hubVersionLabel,
      },
    ],
    footerSections: [
      {
        title: td('node', 'Node'),
        offsetTopPx: 10,
        items: [
          {
            label: td('using_node', 'Using Node'),
            labelAction: {
              ariaLabel: td('change_node', 'Change node'),
              isOpen: Boolean(nodeMenuAnchorEl),
              onClick: handleOpenNodeMenu,
              tooltip: td('change_node', 'Change node'),
            },
            value: resolvedNodeHostLabel,
          },
          {
            label: td('node_type', 'Node Type'),
            value: resolvedNodeTypeLabel,
          },
          {
            label: td('node_height', 'Node Height'),
            value: resolvedBlockHeightLabel,
            valueNode: (
              <BlockHeightValue
                theme={theme}
                value={resolvedBlockHeightLabel}
              />
            ),
          },
        ],
      },
    ],
  };

  const sharedGroupNavProps = { getTimestampEnterChat, setDesktopViewMode, setGroupSection, setMobileViewMode, setSelectedGroup };
  const groupActivityCardOrder = Math.max(
    0,
    customizableCardsLayout.order.indexOf('groupActivity')
  );
  const quitterCardOrder = Math.max(
    0,
    customizableCardsLayout.order.indexOf('quitter')
  );
  const quitterWidgetInitialBatchSize =
    HOME_QUITTER_WIDGET_INITIAL_BATCH_SIZES[HOME_DASHBOARD_WIDGET_DISPLAY_MODE];
  const quitterWidgetLoadMoreBatchSize =
    HOME_QUITTER_WIDGET_LOAD_MORE_BATCH_SIZES[HOME_DASHBOARD_WIDGET_DISPLAY_MODE];
  const quitterWidgetSearchLimit =
    HOME_QUITTER_WIDGET_SEARCH_LIMITS[HOME_DASHBOARD_WIDGET_DISPLAY_MODE];

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence mode="wait">
        {desktopViewMode === 'home' && (
          <motion.div key="home" initial={{ opacity: 0, scale: 1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} custom={reduce} style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', scrollbarGutter: 'stable', width: '100%', willChange: 'opacity', backfaceVisibility: 'hidden' }}>
            <Spacer height="20px" />
            <Box ref={homeLayoutDebugRootRef} sx={{ alignItems: 'flex-start', display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, maxWidth: { xs: '1320px', xl: '1520px' }, padding: '0 20px', position: 'relative', width: '100%' }}>
              {/*
                    T/F Δb {(lowerRowDebugMetrics.toolsBottom - lowerRowDebugMetrics.featuredBottom).toFixed(1)} | F/W Δb {(lowerRowDebugMetrics.featuredBottom - lowerRowDebugMetrics.walletBottom).toFixed(1)}
              */}
              <Box sx={{ display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateColumns: '1fr', alignItems: 'start', width: '100%', [theme.breakpoints.up('xl')]: { alignItems: 'stretch', gridTemplateColumns: `minmax(0, 1fr) ${HOME_SHARED_SIDE_RAIL_WIDTH_XL}` } }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, minWidth: 0, width: '100%' }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                    <Box sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.0605em', textTransform: 'uppercase' }}>Qortal Hub</Box>
                    {isWideDashboardLayout ? (
                      <Box
                        sx={{
                          alignItems: 'start',
                          display: 'grid',
                          gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                          gridTemplateColumns: HOME_LEFT_CENTER_GRID_TEMPLATE_COLUMNS.xl,
                          width: '100%',
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                            minWidth: 0,
                            width: '100%',
                          }}
                        >
                          <Box
                            ref={accountOverviewDebugRef}
                            sx={{
                              display: 'block',
                              height:
                                resolvedQortinoCardHeightPx != null
                                  ? `${resolvedQortinoCardHeightPx}px`
                                  : undefined,
                              minWidth: 0,
                              position: 'relative',
                              '& > *': { height: '100%' },
                            }}
                          >
                            <ErrorBoundary fallback={qortinoWorkspaceShellFallback}>
                              <HomeQortinoWorkspaceCard
                                onGettingStartedComplete={() => { setShowMostActiveGroups(true); setIsOnboardingComplete(true); }}
                                onOpenAppsPanel={handleOpenAppsPanel}
                              />
                            </ErrorBoundary>
                          </Box>
                          <Box
                            ref={toolsDebugRef}
                            sx={{
                              display: 'block',
                              minWidth: 0,
                              position: 'relative',
                              width: '100%',
                            }}
                          >
                            <HomeQuickToolsPad
                              fillHeight={false}
                              onOpenApps={handleOpenAppsPanel}
                              onOpenChat={handleOpenQChatPanel}
                              onOpenSettings={onOpenSettings}
                            />
                          </Box>
                        </Box>
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                            minWidth: 0,
                            width: '100%',
                          }}
                        >
                          <Box
                            ref={profileCardDebugRef}
                            sx={{
                              display: 'block',
                              minWidth: 0,
                              position: 'relative',
                              width: '100%',
                              '& > *': { width: '100%' },
                            }}
                          >
                            <HomeProfileCard
                              onOpenReceive={handleOpenReceiveQort}
                            />
                          </Box>
                          <Box
                            ref={featuredAppsDebugRef}
                            sx={{
                              display: 'flex',
                              height:
                                resolvedWideLeftLowerRowPanelHeightPx != null
                                  ? `${resolvedWideLeftLowerRowPanelHeightPx}px`
                                  : undefined,
                              minWidth: 0,
                              overflow: 'visible',
                              position: 'relative',
                              width: '100%',
                              '& > *': {
                                height: '100%',
                                position: 'relative',
                                width: '100%',
                                zIndex: 1,
                              },
                            }}
                          >
                            <HomeFeaturedApps />
                          </Box>
                        </Box>
                      </Box>
                    ) : (
                      <>
                        <Box sx={{ display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateColumns: HOME_LEFT_CENTER_LOWER_ROW_GRID_TEMPLATE_COLUMNS, alignItems: 'stretch', width: '100%' }}>
                          <Box
                            ref={accountOverviewDebugRef}
                            sx={{ display: 'block', height: resolvedQortinoCardHeightPx != null ? `${resolvedQortinoCardHeightPx}px` : undefined, minWidth: 0, position: 'relative', '& > *': { height: '100%' } }}
                          >
                            <ErrorBoundary fallback={qortinoWorkspaceShellFallback}>
                              <HomeQortinoWorkspaceCard
                                onGettingStartedComplete={() => { setShowMostActiveGroups(true); setIsOnboardingComplete(true); }}
                                onOpenAppsPanel={handleOpenAppsPanel}
                              />
                            </ErrorBoundary>
                          </Box>
                          <Box ref={profileCardDebugRef} sx={{ display: 'block', minWidth: 0, position: 'relative', width: '100%', '& > *': { width: '100%' } }}>
                            <HomeProfileCard
                              onOpenReceive={handleOpenReceiveQort}
                            />
                          </Box>
                        </Box>
                        <Box sx={{ display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateColumns: HOME_LEFT_CENTER_LOWER_ROW_GRID_TEMPLATE_COLUMNS, alignItems: 'stretch', width: '100%' }}>
                          <Box ref={toolsDebugRef} sx={{ display: 'block', minWidth: 0, position: 'relative', width: '100%' }}>
                            <HomeQuickToolsPad
                              fillHeight={false}
                              onOpenApps={handleOpenAppsPanel}
                              onOpenChat={handleOpenQChatPanel}
                              onOpenSettings={onOpenSettings}
                            />
                          </Box>
                          <Box ref={featuredAppsDebugRef} sx={{ display: 'flex', height: resolvedWideLeftLowerRowPanelHeightPx != null ? `${resolvedWideLeftLowerRowPanelHeightPx}px` : undefined, minWidth: 0, overflow: 'visible', position: 'relative', width: '100%', '& > *': { height: '100%', position: 'relative', width: '100%', zIndex: 1 } }}>
                            <HomeFeaturedApps />
                          </Box>
                        </Box>
                      </>
                    )}
                  </Box>
                </Box>
                <Box ref={rightRailRef} sx={{ alignContent: 'start', display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, minWidth: 0, [theme.breakpoints.up('xl')]: { display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateRows: `${HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX}px ${resolvedWalletActivityHeightPx != null ? `${resolvedWalletActivityHeightPx}px` : 'auto'}`, marginTop: `${HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX}px` } }}>
                  <Box ref={infoDebugRef} sx={{ minWidth: 0, position: 'relative', width: '100%', '& > *': { height: '100%' } }}>
                    <InfoPreviewPanel
                      resetKey={dashboardLanguageKey}
                      rows={infoRows}
                      theme={theme}
                      maxExpandedHeightPx={infoPanelMaxExpandedHeightPx}
                      forceExpanded={Boolean(nodeMenuAnchorEl)}
                    />
                    <Menu
                      anchorEl={nodeMenuAnchorEl}
                      open={Boolean(nodeMenuAnchorEl)}
                      onClose={handleCloseNodeMenu}
                      anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
                      transformOrigin={{ horizontal: 'left', vertical: 'top' }}
                      PaperProps={{
                        sx: {
                          background:
                            theme.palette.mode === 'dark'
                              ? 'rgba(18, 23, 32, 0.98)'
                              : 'rgba(250, 252, 255, 0.98)',
                          border: `1px solid ${alpha(
                            theme.palette.border.subtle,
                            0.88
                          )}`,
                          borderRadius: '10px',
                          boxShadow:
                            theme.palette.mode === 'dark'
                              ? '0 18px 42px rgba(0,0,0,0.42)'
                              : '0 16px 36px rgba(24,32,44,0.16)',
                          minWidth: 260,
                          mt: 0.7,
                          p: 0.6,
                        },
                      }}
                    >
                      {dashboardNodeOptions.filter(
                        (option) => option.type === 'custom'
                      ).length === 0 && (
                        <MenuItem disabled sx={nodeMenuItemSx(theme, false)}>
                          {td('no_custom_nodes_saved', 'No custom nodes saved')}
                        </MenuItem>
                      )}
                      {dashboardNodeOptions.map((option) => {
                        const isCurrent =
                          normalizeDashboardNodeUrl(option.node.url) ===
                          selectedNodeUrl;
                        const isSwitching =
                          isSwitchingNodeUrl ===
                          normalizeDashboardNodeUrl(option.node.url);
                        return (
                          <MenuItem
                            key={option.key}
                            disabled={Boolean(isSwitchingNodeUrl)}
                            onClick={() => handleSelectDashboardNode(option)}
                            sx={{
                              ...nodeMenuItemSx(theme, isCurrent),
                              ...(option.type === 'public'
                                ? {
                                    borderTop: `1px solid ${alpha(
                                      theme.palette.text.primary,
                                      0.08
                                    )}`,
                                    mt: 0.55,
                                  }
                                : {}),
                            }}
                          >
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography
                                sx={{
                                  color: 'inherit',
                                  fontSize: '0.84rem',
                                  fontWeight: 700,
                                  lineHeight: 1.25,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {option.label}
                              </Typography>
                              <Typography
                                sx={{
                                  color: alpha(
                                    theme.palette.text.secondary,
                                    0.78
                                  ),
                                  fontSize: '0.72rem',
                                  lineHeight: 1.3,
                                  mt: 0.3,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {option.secondary}
                              </Typography>
                            </Box>
                            {isSwitching ? (
                              <CircularProgress size={16} thickness={5} />
                            ) : isCurrent ? (
                              <CheckRoundedIcon sx={{ fontSize: 18 }} />
                            ) : null}
                          </MenuItem>
                        );
                      })}
                      {nodeSwitchError && (
                        <Typography
                          sx={{
                            color: theme.palette.warning.light,
                            fontSize: '0.74rem',
                            lineHeight: 1.35,
                            px: 1.15,
                            py: 0.8,
                          }}
                        >
                          {nodeSwitchError}
                        </Typography>
                      )}
                    </Menu>
                  </Box>
                  <Box ref={walletActivityDebugRef} sx={{ maxWidth: { xs: '100%', md: '360px' }, position: 'relative', width: '100%', minHeight: '182px', height: resolvedWalletActivityHeightPx != null ? `${resolvedWalletActivityHeightPx}px` : undefined, '& > *': { height: '100%' } }}>
                  <DashboardUtilityPanel title={td('wallet_activity', 'Wallet Activity')} theme={theme} sx={{ gap: '12px', height: '100%', minHeight: '182px', padding: '14px 16px 16px' }}>
                    <Box sx={{ ...sepSx(theme), pb: 1.35 }} />
                    <Box sx={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', pt: 0.5 }}>
                      <WalletActionButton
                        icon={<SendRoundedIcon sx={{ fontSize: '16px' }} />}
                        label={td('send', 'Send')}
                        onClick={(event) => {
                          const rect = (
                            event.currentTarget as HTMLElement
                          ).getBoundingClientRect();
                          const rightRailRect =
                            rightRailRef.current?.getBoundingClientRect();
                          executeEvent('openPaymentInternal', {
                            anchorRect: {
                              height: rect.height,
                              left: rect.left,
                              top: rect.top,
                              width: rect.width,
                            },
                            targetRect: rightRailRect
                              ? {
                                  height: rightRailRect.height,
                                  left: rightRailRect.left,
                                  top: rightRailRect.top,
                                  width: rightRailRect.width,
                                }
                              : null,
                          });
                        }}
                        theme={theme}
                      />
                      <WalletActionButton
                        icon={<SouthWestRoundedIcon sx={{ fontSize: '16px' }} />}
                        label={td('receive', 'Receive')}
                        onClick={(event) => {
                          handleOpenReceiveQort(event.currentTarget as HTMLElement);
                        }}
                        theme={theme}
                      />
                      <WalletActionButton icon={<ShoppingBagRoundedIcon sx={{ fontSize: '16px' }} />} label={td('buy', 'Buy')} onClick={() => { executeEvent('addTab', { data: { service: 'APP', name: 'q-trade' } }); executeEvent('open-apps-mode', {}); }} theme={theme} />
                    </Box>
                    <Box
                      sx={{
                        borderTop: `1px solid ${theme.palette.border.subtle}`,
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1,
                        gap: '5px',
                        mt: 0.35,
                        minHeight: 0,
                        pt: 2.2,
                      }}
                    >
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '0.64rem',
                          fontWeight: 600,
                          letterSpacing: '0.08em',
                          textAlign: 'left',
                          textTransform: 'uppercase',
                        }}
                      >
                        {td('recent_transaction', 'Recent Transaction')}
                      </Typography>
                      {isWalletActivityLoading ? (
                        <Typography
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '0.82rem',
                            lineHeight: 1.45,
                          }}
                        >
                          {td('loading_wallet_activity', 'Loading recent wallet activity...')}
                        </Typography>
                      ) : recentWalletActivity ? (
                        [recentWalletActivity].map((activityEntry, index) => (
                          <Box
                            key={`${activityEntry.timestamp}-${index}`}
                            sx={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                              minWidth: 0,
                              '& + &': {
                                borderTop: `1px solid ${alpha(
                                  theme.palette.text.primary,
                                  0.08
                                )}`,
                                mt: 0.25,
                                pt: 1.2,
                              },
                            }}
                          >
                            <Box
                              sx={{
                                alignItems: 'baseline',
                                color: theme.palette.text.primary,
                                display: 'flex',
                                gap: '5px',
                                minWidth: 0,
                                textAlign: 'left',
                                width: '100%',
                              }}
                            >
                              <Typography
                                sx={{
                                  color: theme.palette.text.primary,
                                  fontSize: '0.95rem',
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {formatWalletActivityAmount(
                                  activityEntry.amount,
                                  activityEntry.direction
                                )}
                              </Typography>
                              <Typography
                                sx={{
                                  color: theme.palette.text.primary,
                                  fontSize: '0.83rem',
                                  lineHeight: 1.45,
                                  minWidth: 0,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <Box
                                  component="span"
                                  sx={{ color: walletActivitySecondaryTextColor }}
                                >
                                  {activityEntry.direction === 'outgoing'
                                    ? td('sent_to', 'sent to ')
                                    : td('received_from', 'received from ')}
                                </Box>
                                <ButtonBase
                                  component="span"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleOpenWalletActivityCounterparty(
                                      activityEntry.counterpartyAddress
                                    );
                                  }}
                                  sx={{
                                    borderRadius: '6px',
                                    color: theme.palette.text.primary,
                                    display: 'inline-flex',
                                    font: 'inherit',
                                    fontWeight: 600,
                                    lineHeight: 'inherit',
                                    maxWidth: '100%',
                                    minWidth: 0,
                                    p: 0,
                                    textAlign: 'left',
                                    verticalAlign: 'baseline',
                                    '&:hover': {
                                      color: theme.palette.primary.light,
                                      textDecoration: 'underline',
                                      textUnderlineOffset: '2px',
                                    },
                                  }}
                                >
                                  {activityEntry.counterpartyLabel}
                                </ButtonBase>
                              </Typography>
                            </Box>
                            <Typography
                              sx={{
                                color: walletActivitySecondaryTextColor,
                                fontSize: '0.74rem',
                                lineHeight: 1.4,
                                textAlign: 'left',
                              }}
                            >
                              {formatWalletActivityRelativeTime(
                                activityEntry.timestamp,
                                walletActivityRelativeTimeNow
                              )}
                            </Typography>
                          </Box>
                        ))
                      ) : (
                        <Typography
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '0.82rem',
                            lineHeight: 1.45,
                          }}
                        >
                          {td('no_wallet_activity', 'No new wallet activity.')}
                        </Typography>
                      )}
                      <Box
                        sx={{
                          mt: 'auto',
                          pt: 1.05,
                        }}
                      >
                        <Typography
                          sx={{
                            color: walletActivitySecondaryTextColor,
                            fontSize: '0.68rem',
                            lineHeight: 1.45,
                            textAlign: 'left',
                          }}
                        >
                          {td(
                            'wallet_activity_window',
                            'Latest transaction within the past 7 days'
                          )}
                        </Typography>
                      </Box>
                    </Box>
                  </DashboardUtilityPanel>
                  </Box>
                </Box>
              </Box>

              {SHOW_USER_DEVELOPER_TOGGLE && (
                <Box sx={{ alignSelf: 'center', bgcolor: theme.palette.background.paper, borderRadius: '50px', display: 'flex', gap: '4px', padding: '4px' }}>
                  {(['user', 'developer'] as HomeTab[]).map((tab) => (
                    <ButtonBase key={tab} onClick={() => setActiveTab(tab)} sx={{ bgcolor: activeTab === tab ? theme.palette.primary.main : 'transparent', borderRadius: '50px', color: activeTab === tab ? theme.palette.primary.contrastText : theme.palette.text.secondary, fontSize: '0.85rem', fontWeight: activeTab === tab ? 600 : 400, minWidth: '100px', px: 2, py: 1, textTransform: 'none' }}>
                      {t(`tutorial:home.tab_${tab}`, { postProcess: 'capitalizeFirstChar' })}
                    </ButtonBase>
                  ))}
                </Box>
              )}

              {activeTab === 'user' && (
                <>
                  {SHOW_MOST_ACTIVE_GROUPS && showMostActiveGroups && <HomeFeaturedGroups {...sharedGroupNavProps} />}
                  <Box
                    sx={{
                      alignItems: 'start',
                      display: 'grid',
                      gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                      gridTemplateColumns: {
                        xs: '1fr',
                        xl: 'repeat(2, minmax(0, 1fr))',
                      },
                      width: '100%',
                    }}
                  >
                    <DashboardWidgetFrame
                      actionIcon={<ForumRoundedIcon sx={{ fontSize: '0.86rem' }} />}
                      actionLabel={td('open_in_q_chat', 'Open in Q-Chat')}
                      height={HOME_DASHBOARD_WIDGET_HEIGHT_PX}
                      onAction={handleOpenGroupsWidget}
                      onRefresh={handleRefreshGroupActivity}
                      onSwap={handleSwapDashboardWidgets}
                      order={groupActivityCardOrder}
                      panelRef={assignGroupActivityPanelNode}
                      refreshing={isGroupWidgetRefreshing}
                      title={t('tutorial:home.group_activity', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                      widgetId="groups"
                    >
                      <GroupsWidget
                        displayMode={HOME_DASHBOARD_WIDGET_DISPLAY_MODE}
                        myAddress={myAddress}
                        onRefreshStateChange={setIsGroupWidgetRefreshing}
                        refreshToken={groupWidgetRefreshToken}
                      />
                    </DashboardWidgetFrame>

                    <DashboardWidgetFrame
                      actionIcon={<OpenInNewRoundedIcon sx={{ fontSize: '0.86rem' }} />}
                      actionLabel={td('open_in_q_apps', 'Open in Q-Apps')}
                      height={HOME_DASHBOARD_WIDGET_HEIGHT_PX}
                      onAction={handleOpenEmbeddedQuitter}
                      onRefresh={handleRefreshQuitterWidget}
                      onSwap={handleSwapDashboardWidgets}
                      order={quitterCardOrder}
                      panelRef={quitterCardHeightRef}
                      refreshing={isQuitterWidgetRefreshing}
                      title={td('quitter_feed', 'Quitter Feed')}
                      widgetId="quitter"
                    >
                      <QuitterFeedWidget
                        batchSize={quitterWidgetLoadMoreBatchSize}
                        displayMode={HOME_DASHBOARD_WIDGET_DISPLAY_MODE}
                        initialBatchSize={quitterWidgetInitialBatchSize}
                        onRefreshStateChange={setIsQuitterWidgetRefreshing}
                        refreshToken={quitterWidgetRefreshToken}
                        searchLimit={quitterWidgetSearchLimit}
                      />
                    </DashboardWidgetFrame>
                  </Box>
                </>
              )}

              {activeTab === 'developer' && <HomeDeveloperTab {...sharedGroupNavProps} />}
            </Box>
            <Spacer height="120px" />
          </motion.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
};

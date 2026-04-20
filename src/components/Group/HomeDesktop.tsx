import { Box, ButtonBase, CircularProgress, IconButton, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import SouthWestRoundedIcon from '@mui/icons-material/SouthWestRounded';
import DensitySmallRoundedIcon from '@mui/icons-material/DensitySmallRounded';
import DensityLargeRoundedIcon from '@mui/icons-material/DensityLargeRounded';
import { alpha, darken } from '@mui/material/styles';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { balanceAtom, memberGroupsAtom, nodeInfosAtom, userInfoAtom } from '../../atoms/global';
import { Spacer } from '../../common/Spacer';
import { GroupJoinRequests } from './GroupJoinRequests';
import { GroupInvites } from './GroupInvites';
import { ListOfGroupPromotions } from './ListOfGroupPromotions';
import { HomeProfileCard } from './HomeProfileCard';
import { GETTING_STARTED_LS_KEY, HomeGettingStarted } from './HomeGettingStarted';
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
import {
  DASHBOARD_GETTING_STARTED_DEBUG_EVENT,
  DASHBOARD_GETTING_STARTED_DEBUG_STORAGE_KEY,
  EMPTY_GETTING_STARTED_DEBUG_OVERRIDES,
  parseGettingStartedDebugOverrides,
  type GettingStartedDebugOverrides,
} from './homeGettingStartedDebug';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, LazyMotion, domAnimation, motion, useReducedMotion } from 'framer-motion';
import { getBaseApiReact } from '../../App';
import { manifestData } from '../NotAuthenticated';
import { executeEvent, subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { dashboardPanelSx, handleDashboardPanelPointerLeave, handleDashboardPanelPointerMove, useDashboardPanelMouseLight } from './dashboardPanelEffects';
import { useHandleUserInfo } from '../../hooks/useHandleUserInfo';
import { isLocalNodeUrl } from '../../constants/constants';
import { nodeDisplay } from '../../utils/helpers';
import { DashboardWidgetFrame, type WidgetDisplayMode } from '../Widgets/DashboardWidgetFrame';
import { GroupsWidget } from '../Widgets/GroupsWidget';
import { QuitterFeedWidget } from '../Widgets/QuitterFeedWidget';

type HomeTab = 'user' | 'developer';
type ActivityTab = 'requests' | 'invites' | 'promotions';
type HomeCustomizableCardId = 'groupActivity' | 'quitter';
type DashboardStatusPreviewMode =
  | 'live'
  | 'syncing'
  | 'local'
  | 'custom'
  | 'issue';
type DashboardInfoStatusTone = 'operational' | 'syncing' | 'issue';
type MinterProgressSnapshot = {
  currentBlocks: number;
  currentLevel: number;
  progressRatio: number;
  requiredBlocks: number;
};
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
const INFO_PANEL_EXPAND_OPEN_DELAY_MS = 35;
const INFO_PANEL_EXPAND_CLOSE_DELAY_MS = 60;
const INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX = 52;
const INFO_VALUE_COLUMN_MIN_WIDTH_PX = 136;
const DASHBOARD_STATUS_PREVIEW_EVENT = 'setDashboardStatusPreview';
const DASHBOARD_STATUS_PREVIEW_STORAGE_KEY = 'dashboardStatusPreviewMode';
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

const parseDashboardStatusPreviewMode = (
  value: string | null
): DashboardStatusPreviewMode => {
  switch (value) {
    case 'syncing':
    case 'local':
    case 'custom':
    case 'issue':
      return value;
    default:
      return 'live';
  }
};

const getNextDashboardStatusPreviewMode = (
  currentMode: DashboardStatusPreviewMode
): DashboardStatusPreviewMode => {
  switch (currentMode) {
    case 'live':
      return 'syncing';
    case 'syncing':
      return 'local';
    case 'local':
      return 'custom';
    case 'custom':
      return 'issue';
    default:
      return 'live';
  }
};

const getDashboardStatusPreviewModeLabel = (
  mode: DashboardStatusPreviewMode
) => {
  switch (mode) {
    case 'syncing':
      return 'Syncing';
    case 'local':
      return 'Local';
    case 'custom':
      return 'Custom';
    case 'issue':
      return 'Issue';
    default:
      return 'Live';
  }
};

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

  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: 'center',
        bgcolor:
          theme.palette.mode === 'dark'
            ? '#262931'
            : theme.palette.background.surface,
        border: `1px solid ${theme.palette.border.subtle}`,
        borderRadius: '10px',
        display: 'flex',
        gap: '9px',
        height: '46px',
        justifyContent: 'center',
        px: 1.5,
        transition:
          'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, color 140ms ease, transform 120ms ease, filter 140ms ease',
        width: '100%',
        '&:hover': {
          ...blueStrongHover,
          borderColor: 'rgba(143, 184, 243, 0.22)',
          color: APP_BLUE_SURFACE_TEXT,
          transform: 'translateY(-1px)',
        },
        '&:active': {
          transform: 'translateY(0)',
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

const InfoPreviewPanel = ({ rows, theme, maxExpandedHeightPx = null }) => {
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

  const showCollapsedFade = hasOverflow && !isExpanded;
  const statusAccentColor =
    rows.status.tone === 'issue'
      ? theme.palette.mode === 'dark'
        ? alpha(theme.palette.error.light, 0.9)
        : alpha(theme.palette.error.main, 0.88)
      : rows.status.tone === 'syncing'
        ? theme.palette.mode === 'dark'
          ? alpha(theme.palette.warning.light, 0.9)
          : alpha(theme.palette.warning.main, 0.88)
        : alpha(
            GROUP_ACTIVITY_BLUE.primary,
            theme.palette.mode === 'dark' ? 0.98 : 0.9
          );
  const statusTextColor =
    rows.status.tone === 'issue'
      ? theme.palette.mode === 'dark'
        ? alpha(theme.palette.error.light, 0.76)
        : alpha(theme.palette.error.main, 0.76)
      : rows.status.tone === 'syncing'
        ? theme.palette.mode === 'dark'
          ? alpha(theme.palette.warning.light, 0.76)
          : alpha(theme.palette.warning.dark, 0.8)
        : theme.palette.mode === 'dark'
          ? alpha(theme.palette.common.white, 0.7)
          : alpha(theme.palette.text.primary, 0.72);
  const statusGlowColor =
    rows.status.tone === 'issue'
      ? alpha(theme.palette.error.light, 0.12)
      : rows.status.tone === 'syncing'
        ? alpha(theme.palette.warning.light, 0.16)
        : alpha(GROUP_ACTIVITY_BLUE.primary, 0.14);

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
          : row.pillTone === 'neutral'
            ? {
                background:
                  theme.palette.mode === 'dark'
                    ? 'rgba(62, 72, 89, 0.34)'
                    : 'rgba(70, 97, 140, 0.11)',
                border: alpha(
                  GROUP_ACTIVITY_BLUE.primary,
                  theme.palette.mode === 'dark' ? 0.16 : 0.18
                ),
                color:
                  theme.palette.mode === 'dark'
                    ? alpha(theme.palette.common.white, 0.84)
                    : alpha(theme.palette.text.primary, 0.84),
              }
            : {
                background:
                  theme.palette.mode === 'dark'
                    ? 'rgba(71, 100, 86, 0.3)'
                    : 'rgba(84, 124, 103, 0.14)',
                border: alpha(
                  theme.palette.success.light,
                  theme.palette.mode === 'dark' ? 0.16 : 0.22
                ),
                color:
                  theme.palette.mode === 'dark'
                    ? '#C2D9CA'
                    : '#406C53',
              };
      return (
        <Box
          sx={{
            alignItems: 'center',
            bgcolor: pillTone.background,
            border: `1px solid ${pillTone.border}`,
            borderRadius: '999px',
            color: pillTone.color,
            display: 'inline-flex',
            fontSize: '0.7rem',
            fontWeight: 700,
            height: '26px',
            justifyContent: 'center',
            letterSpacing: '0.01em',
            maxWidth: '100%',
            minWidth: 0,
            px: '10px',
            whiteSpace: 'nowrap',
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
          ? { height: '100%', minHeight: 0, zIndex: isExpanded ? 4 : 1 }
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
              borderColor: isExpanded
                ? theme.palette.border.main
                : theme.palette.border.subtle,
              boxShadow: isExpanded
                ? theme.palette.mode === 'dark'
                  ? '0 26px 34px -12px rgba(0, 0, 0, 0.34)'
                  : '0 24px 28px -12px rgba(15, 23, 42, 0.16)'
                : undefined,
              height:
                resolvedCollapsedHeight == null
                  ? '100%'
                  : `${isExpanded ? expandedHeight : resolvedCollapsedHeight}px`,
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
          ...(showCollapsedFade
            ? {
                WebkitMaskImage:
                  'linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) calc(100% - 102px), rgba(0,0,0,0.86) calc(100% - 68px), rgba(0,0,0,0.46) calc(100% - 40px), rgba(0,0,0,0.12) calc(100% - 18px), rgba(0,0,0,0) 100%)',
                WebkitMaskRepeat: 'no-repeat',
                WebkitMaskSize: '100% 100%',
                maskImage:
                  'linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) calc(100% - 102px), rgba(0,0,0,0.86) calc(100% - 68px), rgba(0,0,0,0.46) calc(100% - 40px), rgba(0,0,0,0.12) calc(100% - 18px), rgba(0,0,0,0) 100%)',
                maskRepeat: 'no-repeat',
                maskSize: '100% 100%',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  left: '8px',
                  right: '8px',
                  bottom: -12,
                  height: '72px',
                  pointerEvents: 'none',
                  background:
                    theme.palette.mode === 'dark'
                      ? 'linear-gradient(180deg, rgba(27,29,36,0) 0%, rgba(27,29,36,0.08) 22%, rgba(27,29,36,0.28) 46%, rgba(27,29,36,0.62) 74%, rgba(27,29,36,0.9) 100%)'
                      : 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 22%, rgba(255,255,255,0.22) 46%, rgba(255,255,255,0.52) 74%, rgba(255,255,255,0.84) 100%)',
                },
              }
            : {}),
        }}
      >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
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
        <Box
          sx={{
            alignItems: 'center',
            display: 'inline-flex',
            gap: '8px',
            justifyContent: 'flex-end',
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              bgcolor: statusAccentColor,
              borderRadius: '50%',
              boxShadow: `0 0 6px ${statusGlowColor}`,
              flexShrink: 0,
              height: '7px',
              width: '7px',
            }}
          />
          <Typography
            sx={{
              color: statusTextColor,
              fontSize: '0.73rem',
              fontWeight: 400,
              letterSpacing: '0.015em',
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            {rows.status.label}
          </Typography>
        </Box>
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
                textTransform: 'uppercase',
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
                mt: '8px',
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
        {rows.footerSections.map((section, sectionIndex) => (
          <Box
            key={section.title}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              mt: sectionIndex === 0 ? 0 : '2px',
            }}
          >
            <Typography
              sx={{
                color:
                  theme.palette.mode === 'dark'
                    ? alpha(theme.palette.common.white, 0.4)
                    : alpha(theme.palette.text.primary, 0.48),
                fontSize: '0.67rem',
                fontWeight: 600,
                letterSpacing: '0.08em',
                lineHeight: 1,
                mb: '1px',
                textTransform: 'uppercase',
              }}
            >
              {section.title}
            </Typography>

            {section.items.map((row, index) => (
              <Box
                key={row.label}
                sx={{
                  ...(index < section.items.length - 1
                    ? infoSepSx(theme, index, section.items.length)
                    : {}),
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  minHeight: '50px',
                  py: '6px',
                }}
              >
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
                  }}
                >
                  {row.label}
                </Typography>
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.primary, 0.88),
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    letterSpacing: '0.01em',
                    lineHeight: 1.2,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.value}
                </Typography>
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      <Box sx={{ minHeight: '8px', width: '100%' }} />
      </Box>
    </Box>
    </Box>
  );
};

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
  const toolsDebugRef = useRef<HTMLDivElement | null>(null);
  const featuredAppsDebugRef = useRef<HTMLDivElement | null>(null);
  const walletActivityDebugRef = useRef<HTMLDivElement | null>(null);
  const rightRailRef = useRef<HTMLDivElement | null>(null);
  const layoutStabilizeFrameRef = useRef<number | null>(null);
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const groups = useAtomValue(memberGroupsAtom);
  const nodeInfos = useAtomValue(nodeInfosAtom);
  const [activeTab, setActiveTab] = useState<HomeTab>('user');
  const [activityTab, setActivityTab] = useState<ActivityTab>('promotions');
  const [requestsCount, setRequestsCount] = useState(0);
  const [invitesCount, setInvitesCount] = useState(0);
  const [promotionsCount, setPromotionsCount] = useState(0);
  const [showMostActiveGroups, setShowMostActiveGroups] = useState(() => localStorage.getItem(GETTING_STARTED_LS_KEY) === 'completed');
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const [gettingStartedDebugOverrides, setGettingStartedDebugOverrides] = useState<GettingStartedDebugOverrides>(() =>
    parseGettingStartedDebugOverrides(
      localStorage.getItem(DASHBOARD_GETTING_STARTED_DEBUG_STORAGE_KEY)
    )
  );
  const [gettingStartedDebugPathActive, setGettingStartedDebugPathActive] = useState(false);
  const [gettingStartedDebugReplayToken, setGettingStartedDebugReplayToken] = useState(0);
  const [requestsCountLoading, setRequestsCountLoading] = useState(true);
  const [invitesCountLoading, setInvitesCountLoading] = useState(true);
  const [minterLevel, setMinterLevel] = useState<number | null>(null);
  const [minterProgress, setMinterProgress] =
    useState<MinterProgressSnapshot | null>(null);
  const [walletActivityTargetHeightPx, setWalletActivityTargetHeightPx] =
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
  const [activityToggleIndicator, setActivityToggleIndicator] = useState({
    ready: false,
    width: 0,
    x: 0,
  });
  const [groupActivityMeasuredViewportHeightPx, setGroupActivityMeasuredViewportHeightPx] =
    useState<number | null>(null);
  const [coreVersionLabel, setCoreVersionLabel] = useState('—');
  const [minterPreviewMode, setMinterPreviewMode] = useState<'off' | 'on'>(() => {
    const saved = localStorage.getItem('dashboardMinterPreviewMode');
    return saved === 'on' ? 'on' : 'off';
  });
  const [statusPreviewMode, setStatusPreviewMode] =
    useState<DashboardStatusPreviewMode>(() =>
      parseDashboardStatusPreviewMode(
        localStorage.getItem(DASHBOARD_STATUS_PREVIEW_STORAGE_KEY)
      )
    );
  const reduce = useReducedMotion();
  const { t } = useTranslation(['core', 'group', 'tutorial', 'auth']);
  const theme = useTheme();
  const isWideDashboardLayout = useMediaQuery(theme.breakpoints.up('xl'));
  const resolvedWideLeftLowerRowPanelHeightPx = isWideDashboardLayout
    ? HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX
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
  const infoPanelMaxExpandedHeightPx =
    isWideDashboardLayout && walletActivityTargetHeightPx != null
      ? HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX +
        HOME_DASHBOARD_VERTICAL_GAP_PX +
        walletActivityTargetHeightPx +
        2
      : null;
  const getIndividualUserInfo = useHandleUserInfo();
  const userAddress = userInfo?.address;
  const isLocalPreview = typeof window !== 'undefined' && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
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
        const leftRowMetric =
          nextMetrics.featuredApps ?? nextMetrics.tools ?? undefined;
        const walletMetric = nextMetrics.walletActivity;

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
    isLocalPreview,
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
    if (!userAddress) { setIsOnboardingComplete(false); return; }
    setIsOnboardingComplete(localStorage.getItem(`${GETTING_STARTED_LS_KEY}_${userAddress}`) === 'completed');
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
    if (localStorage.getItem('dashboardMinterPreviewMode')) return;
    setMinterPreviewMode(minterLevel && minterLevel > 0 ? 'on' : 'off');
  }, [minterLevel]);

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

  useEffect(() => {
    const handleSetDashboardMinterPreview = (e: CustomEvent) => {
      const mode = e.detail?.data?.mode === 'on' ? 'on' : 'off';
      setMinterPreviewMode(mode);
      localStorage.setItem('dashboardMinterPreviewMode', mode);
    };

    subscribeToEvent('setDashboardMinterPreview', handleSetDashboardMinterPreview);
    return () => {
      unsubscribeFromEvent('setDashboardMinterPreview', handleSetDashboardMinterPreview);
    };
  }, []);

  useEffect(() => {
    const handleSetDashboardStatusPreview = (e: CustomEvent) => {
      const nextMode = parseDashboardStatusPreviewMode(
        e.detail?.data?.mode ?? null
      );
      setStatusPreviewMode(nextMode);
      localStorage.setItem(DASHBOARD_STATUS_PREVIEW_STORAGE_KEY, nextMode);
    };

    subscribeToEvent(
      DASHBOARD_STATUS_PREVIEW_EVENT,
      handleSetDashboardStatusPreview
    );
    return () => {
      unsubscribeFromEvent(
        DASHBOARD_STATUS_PREVIEW_EVENT,
        handleSetDashboardStatusPreview
      );
    };
  }, []);

  useEffect(() => {
    const handleSetDashboardGettingStartedDebugOverrides = (e: CustomEvent) => {
      const nextOverrides = {
        ...EMPTY_GETTING_STARTED_DEBUG_OVERRIDES,
        ...(e.detail?.data?.overrides ?? {}),
      };
      setGettingStartedDebugPathActive(true);
      setGettingStartedDebugOverrides(nextOverrides);
      localStorage.setItem(
        DASHBOARD_GETTING_STARTED_DEBUG_STORAGE_KEY,
        JSON.stringify(nextOverrides)
      );

      if (e.detail?.data?.resetReplay) {
        if (userAddress) {
          localStorage.removeItem(`${GETTING_STARTED_LS_KEY}_${userAddress}`);
        }
        setIsOnboardingComplete(false);
        setShowMostActiveGroups(false);
        setGettingStartedDebugReplayToken((prev) => prev + 1);
      }
    };

    subscribeToEvent(
      DASHBOARD_GETTING_STARTED_DEBUG_EVENT,
      handleSetDashboardGettingStartedDebugOverrides
    );
    return () => {
      unsubscribeFromEvent(
        DASHBOARD_GETTING_STARTED_DEBUG_EVENT,
        handleSetDashboardGettingStartedDebugOverrides
      );
    };
  }, [userAddress]);

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
  const handleOpenEmbeddedQuitter = () => {
    executeEvent('addTab', { data: { service: 'APP', name: 'Quitter' } });
    executeEvent('open-apps-mode', {});
  };
  const handleOpenGroupsWidget = useCallback(() => {
    setSelectedGroup(null);
    setGroupSection('chat');
    setDesktopViewMode('chat');
  }, [setDesktopViewMode, setGroupSection, setSelectedGroup]);

  const liveSyncPercent =
    nodeInfos?.isSynchronizing && nodeInfos?.syncPercent !== 100
      ? Math.round(nodeInfos?.syncPercent || 0)
      : 100;
  const nodeStatusValue = `${liveSyncPercent}% Synced`;
  const peersLabel = `${nodeInfos?.numberOfConnections || 0}`;
  const blockHeightLabel = `${nodeInfos?.height || '—'}`;
  const hubVersionLabel = manifestData.version || '—';
  const qdnPeersLabel = `${nodeInfos?.numberOfDataConnections || 0}`;
  const nodeBase = getBaseApiReact();
  const nodeHostLabel = (() => {
    try {
      return new URL(nodeBase).host;
    } catch {
      return nodeDisplay(nodeBase);
    }
  })();
  const nodeTypeLabel = isLocalNodeUrl(nodeBase)
    ? 'Local node'
    : nodeBase.includes('ext-node.qortal.link')
      ? 'Public node'
      : 'Custom node';
  const isSystemOperational =
    !!nodeInfos &&
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
            nodeStatus: '62% Synced',
            nodeType: 'Public node',
            peers: '184',
            qdnPeers: '97',
            statusLabel: 'Synchronizing',
          }
        : statusPreviewMode === 'local'
          ? {
              blockHeight: '1,944,882',
              coreVersion: coreVersionLabel,
              hubVersion: hubVersionLabel,
              isOperational: true,
              nodeHost: '127.0.0.1:12391',
              nodeStatus: '100% Synced',
              nodeType: 'Local node',
              peers: '42',
              qdnPeers: '28',
              statusLabel: 'Fully operational',
            }
          : statusPreviewMode === 'custom'
            ? {
                blockHeight: '1,944,801',
                coreVersion: coreVersionLabel,
                hubVersion: hubVersionLabel,
                isOperational: true,
                nodeHost: 'node.qortal.example',
                nodeStatus: '100% Synced',
                nodeType: 'Custom node',
                peers: '221',
                qdnPeers: '153',
                statusLabel: 'Fully operational',
              }
            : {
                blockHeight: '—',
                coreVersion: coreVersionLabel,
                hubVersion: hubVersionLabel,
                isOperational: false,
                nodeHost: 'node.qortal.example',
                nodeStatus: 'Node unavailable',
                nodeType: 'Custom node',
                peers: '0',
                qdnPeers: '0',
                statusLabel: 'Attention needed',
              };
  const resolvedInfoStatusLabel =
    statusPreviewOverrides?.statusLabel ??
    (isSystemOperational ? 'Fully operational' : 'Not operational');
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
  const minterValue = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'inline-flex',
        height: '22px',
        justifyContent: 'flex-end',
        minWidth: `${INFO_VALUE_COLUMN_MIN_WIDTH_PX}px`,
        position: 'relative',
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
              sx={{
                alignItems: 'center',
                cursor: minterProgress ? 'default' : 'inherit',
                display: 'inline-flex',
                height: '18px',
                justifyContent: 'flex-end',
                overflow: 'hidden',
                position: 'relative',
                width: '156px',
                maxWidth: '100%',
                '& .minter-dots-layer': {
                  opacity: minterProgress ? 1 : 1,
                  transform: 'scaleX(1)',
                  transition:
                    'opacity 200ms cubic-bezier(0.2, 0, 0, 1), transform 200ms cubic-bezier(0.2, 0, 0, 1)',
                },
                '& .minter-progress-layer': {
                  opacity: 0,
                  transform: 'scaleX(0.96)',
                  transition:
                    'opacity 200ms cubic-bezier(0.2, 0, 0, 1), transform 200ms cubic-bezier(0.2, 0, 0, 1)',
                },
                ...(minterProgress
                  ? {
                      '&:hover .minter-dots-layer': {
                        opacity: 0,
                        transform: 'scaleX(0.94)',
                      },
                      '&:hover .minter-progress-layer': {
                        opacity: 1,
                        transform: 'scaleX(1)',
                      },
                    }
                  : {}),
              }}
            >
              <Box
                className="minter-dots-layer"
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  inset: 0,
                  justifyContent: 'flex-end',
                  pointerEvents: 'none',
                  position: 'absolute',
                  transformOrigin: 'right center',
                }}
              >
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
                        ...(index < minterDotsFilled ? filledBlueDotSx : emptyBlueDotSx),
                        borderRadius: '50%',
                        height: '11px',
                        width: '11px',
                      }}
                    />
                  ))}
                </Box>
              </Box>

              {minterProgress && formattedMinterCurrentBlocks && formattedMinterRequiredBlocks ? (
                <Box
                  className="minter-progress-layer"
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    inset: 0,
                    justifyContent: 'flex-end',
                    pointerEvents: 'none',
                    position: 'absolute',
                    transformOrigin: 'right center',
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'inline-flex',
                      gap: '8px',
                      justifyContent: 'flex-end',
                      width: '100%',
                    }}
                  >
                    <Box
                      sx={{
                        background:
                          theme.palette.mode === 'dark'
                            ? 'rgba(255,255,255,0.08)'
                            : 'rgba(15,23,42,0.08)',
                        borderRadius: '999px',
                        height: '6px',
                        overflow: 'hidden',
                        width: '64px',
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
                </Box>
              ) : null}
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
            <ButtonBase onClick={() => { executeEvent('addTab', { data: { service: 'APP', name: 'q-mintership' } }); executeEvent('open-apps-mode', {}); }} sx={{ alignItems: 'center', bgcolor: alpha(theme.palette.background.surface, theme.palette.mode === 'dark' ? 0.92 : 1), border: `1px solid ${alpha(theme.palette.border.subtle, 0.9)}`, borderRadius: '999px', color: alpha(theme.palette.text.secondary, 0.9), display: 'inline-flex', fontSize: '0.66rem', fontWeight: 600, height: '21px', justifyContent: 'center', minWidth: '50px', px: 1, py: 0, whiteSpace: 'nowrap' }}>
              Apply
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
        label: 'QORT Balance',
        value: balanceLabel,
      },
      {
        label: 'Node Status',
        pillTone:
          resolvedNodeStatusValue === 'Node unavailable'
            ? 'negative'
            : resolvedNodeStatusValue === '100% Synced'
              ? 'positive'
              : 'neutral',
        value: resolvedNodeStatusValue,
        variant: 'pill',
      },
      {
        label: 'Minter Level',
        valueNode: minterValue,
      },
    ],
    metricItems: [
      {
        accent: 'blue',
        label: 'Peers',
        value: resolvedPeersLabel,
      },
      {
        accent: 'blue',
        label: 'QDN',
        value: resolvedQdnPeersLabel,
      },
      {
        accent: 'green',
        label: 'Core',
        value: coreVersionMetricLabel,
      },
      {
        accent: 'violet',
        label: 'Hub',
        value: hubVersionLabel,
      },
    ],
    footerSections: [
      {
        title: 'Node',
        items: [
          {
            label: 'Using Node',
            value: resolvedNodeHostLabel,
          },
          {
            label: 'Node Type',
            value: resolvedNodeTypeLabel,
          },
          {
            label: 'Node Height',
            value: resolvedBlockHeightLabel,
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
          <motion.div key="home" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} custom={reduce} style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', scrollbarGutter: 'stable', width: '100%', willChange: 'transform, opacity', backfaceVisibility: 'hidden' }}>
            <Spacer height="20px" />
            <Box ref={homeLayoutDebugRootRef} sx={{ alignItems: 'flex-start', display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, maxWidth: { xs: '1320px', xl: '1520px' }, padding: '0 20px', position: 'relative', width: '100%' }}>
              {/*
                    T/F Δb {(lowerRowDebugMetrics.toolsBottom - lowerRowDebugMetrics.featuredBottom).toFixed(1)} | F/W Δb {(lowerRowDebugMetrics.featuredBottom - lowerRowDebugMetrics.walletBottom).toFixed(1)}
              */}
              <Box sx={{ display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateColumns: '1fr', alignItems: 'start', width: '100%', [theme.breakpoints.up('xl')]: { alignItems: 'stretch', gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 400px)' } }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, minWidth: 0, width: '100%' }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                    <Box sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.0605em', textTransform: 'uppercase' }}>Qortal Hub</Box>
                    <Box ref={accountOverviewDebugRef} sx={{ position: 'relative', width: '100%' }}>
                      <HomeProfileCard onOpenSettings={onOpenSettings} />
                    </Box>
                  </Box>
                  <Box sx={{ display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateColumns: { xs: '1fr', md: 'minmax(285px, 330px) minmax(0, 1fr)', xl: 'minmax(310px, 360px) minmax(0, 1fr)' }, alignItems: 'stretch', width: '100%' }}>
                    <Box ref={toolsDebugRef} sx={{ display: 'block', height: resolvedWideLeftLowerRowPanelHeightPx != null ? `${resolvedWideLeftLowerRowPanelHeightPx}px` : undefined, minWidth: 0, position: 'relative', '& > *': { height: '100%' } }}>
                      <HomeGettingStarted
                        debugCompletionOverrides={isLocalPreview ? gettingStartedDebugOverrides : undefined}
                        debugReplayToken={gettingStartedDebugReplayToken}
                        debugUseOverridesOnly={isLocalPreview && gettingStartedDebugPathActive}
                        onGettingStartedComplete={() => { setShowMostActiveGroups(true); setIsOnboardingComplete(true); }}
                      />
                    </Box>
                    <Box ref={featuredAppsDebugRef} sx={{ display: 'flex', height: resolvedWideLeftLowerRowPanelHeightPx != null ? `${resolvedWideLeftLowerRowPanelHeightPx}px` : undefined, minWidth: 0, overflow: 'visible', position: 'relative', width: '100%', '& > *': { height: '100%', position: 'relative', width: '100%', zIndex: 1 } }}>
                      <HomeFeaturedApps />
                    </Box>
                  </Box>
                </Box>
                <Box ref={rightRailRef} sx={{ alignContent: 'start', display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, minWidth: 0, [theme.breakpoints.up('xl')]: { display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateRows: `${HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX}px ${walletActivityTargetHeightPx != null ? `${walletActivityTargetHeightPx}px` : 'auto'}`, marginTop: `${HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX}px` } }}>
                  <Box ref={infoDebugRef} sx={{ minWidth: 0, position: 'relative', width: '100%', '& > *': { height: '100%' } }}>
                    <InfoPreviewPanel
                      rows={infoRows}
                      theme={theme}
                      maxExpandedHeightPx={infoPanelMaxExpandedHeightPx}
                    />
                  </Box>
                  <Box ref={walletActivityDebugRef} sx={{ position: 'relative', width: '100%', minHeight: '182px', height: walletActivityTargetHeightPx != null ? `${walletActivityTargetHeightPx}px` : undefined, '& > *': { height: '100%' } }}>
                  <DashboardUtilityPanel title="WALLET ACTIVITY" theme={theme} sx={{ gap: '12px', height: '100%', minHeight: '182px', padding: '14px 16px 16px' }}>
                    <Box sx={{ ...sepSx(theme), alignItems: 'center', display: 'flex', justifyContent: 'space-between', pb: 1.35 }}>
                      <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.72rem' }}>Last activity</Typography>
                      <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.72rem' }}>2 days ago</Typography>
                    </Box>
                    <Box sx={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', pt: 0.5 }}>
                      <WalletActionButton
                        icon={<SendRoundedIcon sx={{ fontSize: '16px' }} />}
                        label="Send"
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
                        label="Receive"
                        onClick={(event) => {
                          const rect = (
                            event.currentTarget as HTMLElement
                          ).getBoundingClientRect();
                          const rightRailRect =
                            rightRailRef.current?.getBoundingClientRect();
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
                        }}
                        theme={theme}
                      />
                      <WalletActionButton icon={<ShoppingBagRoundedIcon sx={{ fontSize: '16px' }} />} label="Buy" onClick={() => { executeEvent('addTab', { data: { service: 'APP', name: 'q-trade' } }); executeEvent('open-apps-mode', {}); }} theme={theme} />
                    </Box>
                    <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.66rem', lineHeight: 1.45, mt: 'auto', pt: 1.05 }}>
                      Use these shortcuts for your most common wallet actions directly from your Hub Dashboard
                    </Typography>
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
                      actionLabel="Open in Q-Chat"
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
                      actionLabel="Open in Q-Apps"
                      height={HOME_DASHBOARD_WIDGET_HEIGHT_PX}
                      onAction={handleOpenEmbeddedQuitter}
                      onRefresh={handleRefreshQuitterWidget}
                      onSwap={handleSwapDashboardWidgets}
                      order={quitterCardOrder}
                      panelRef={quitterCardHeightRef}
                      refreshing={isQuitterWidgetRefreshing}
                      title="Quitter"
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

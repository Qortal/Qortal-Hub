import { Box, ButtonBase, CircularProgress, IconButton, Typography, useMediaQuery, useTheme } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import SouthWestRoundedIcon from '@mui/icons-material/SouthWestRounded';
import { alpha, darken } from '@mui/material/styles';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { balanceAtom, groupInvitesCacheAtom, joinRequestsCacheAtom, memberGroupsAtom, nodeInfosAtom, userInfoAtom } from '../../atoms/global';
import { Spacer } from '../../common/Spacer';
import { GroupJoinRequests } from './GroupJoinRequests';
import { GroupInvites } from './GroupInvites';
import { ListOfGroupPromotions } from './ListOfGroupPromotions';
import { HomeProfileCard } from './HomeProfileCard';
import { GETTING_STARTED_LS_KEY, HomeGettingStarted } from './HomeGettingStarted';
import { HomeFeaturedApps } from './HomeFeaturedApps';
import { HomeFeaturedGroups } from './HomeFeaturedGroups';
import { HomeDeveloperTab } from './HomeDeveloperTab';
import AppViewerContainer from '../Apps/AppViewerContainer';
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

type HomeTab = 'user' | 'developer';
type ActivityTab = 'requests' | 'invites' | 'promotions';
type HomeCustomizableCardId = 'groupActivity' | 'quitter';
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
const HOME_GROUP_ACTIVITY_CARD_SAFE_MIN_HEIGHT_PX =
  HOME_GROUP_ACTIVITY_CARD_CHROME_HEIGHT_PX + 600;
const HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS: Record<HomeCustomizableCardId, number> = {
  groupActivity: HOME_GROUP_ACTIVITY_CARD_SAFE_MIN_HEIGHT_PX,
  quitter: 420,
};
const HOME_CUSTOMIZABLE_CARD_MAX_HEIGHTS: Record<HomeCustomizableCardId, number> = {
  groupActivity: 1480,
  quitter: 1280,
};
const INFO_PANEL_EXPAND_OPEN_DELAY_MS = 35;
const INFO_PANEL_EXPAND_CLOSE_DELAY_MS = 60;
const INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX = 18;
const INFO_VALUE_COLUMN_MIN_WIDTH_PX = 136;
const INFO_SECONDARY_LAYER_TRANSITION_MS = 145;
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

const InfoPreviewPanel = ({ rows, theme }) => {
  const enableOverlay = useMediaQuery(theme.breakpoints.up('xl'));
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [collapsedHeight, setCollapsedHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

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

    const resizeObserver = new ResizeObserver(() => updateMeasurements());
    resizeObserver.observe(wrapperNode);
    resizeObserver.observe(contentNode);
    window.addEventListener('resize', updateMeasurements);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateMeasurements);
    };
  }, [enableOverlay, rows.items.length]);

  const hasOverflow = enableOverlay && collapsedHeight > 0 && contentHeight > collapsedHeight + 4;
  const resolvedCollapsedHeight = collapsedHeight > 0 ? collapsedHeight : undefined;
  const expandedHeight = resolvedCollapsedHeight
    ? Math.max(
        resolvedCollapsedHeight,
        contentHeight + INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX
      )
    : contentHeight + INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX;

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

  const isInteractive = enableOverlay && hasOverflow;
  const showCollapsedFade = isInteractive && !isExpanded;

  return (
    <Box
      ref={wrapperRef}
      sx={{
        minWidth: 0,
        position: 'relative',
        width: '100%',
        ...(enableOverlay ? { height: '100%', minHeight: 0, zIndex: isExpanded ? 4 : 1 } : {}),
      }}
    >
      <Box
        ref={panelRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        sx={{
          ...dashboardPanelSx(theme, 'utility'),
          borderRadius: '14px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          width: '100%',
          ...(enableOverlay
            ? {
                borderColor: isExpanded ? theme.palette.border.main : theme.palette.border.subtle,
                boxShadow: isExpanded
                  ? theme.palette.mode === 'dark'
                    ? '0 26px 34px -12px rgba(0, 0, 0, 0.34)'
                    : '0 24px 28px -12px rgba(15, 23, 42, 0.16)'
                  : undefined,
                height: resolvedCollapsedHeight == null
                  ? '100%'
                  : `${isExpanded ? expandedHeight : resolvedCollapsedHeight}px`,
                left: 0,
                position: 'absolute',
                right: 0,
                top: 0,
                transition: 'height 160ms cubic-bezier(0.2, 0, 0, 1), box-shadow 140ms ease, border-color 140ms ease',
              }
            : {}),
        }}
        onMouseMove={handleDashboardPanelPointerMove}
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
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            pb: isExpanded ? '18px' : '12px',
            px: '16px',
            pt: '12px',
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
                    bottom: 0,
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
              sx={{
                color: theme.palette.text.primary,
                fontSize: '1rem',
                fontWeight: 600,
                letterSpacing: '0.015em',
              }}
            >
              STATUS
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
                  bgcolor: rows.status.isOperational
                    ? alpha(GROUP_ACTIVITY_BLUE.primary, 0.92)
                    : alpha(theme.palette.error.light, 0.86),
                  borderRadius: '50%',
                  boxShadow: rows.status.isOperational
                    ? `0 0 6px ${alpha(GROUP_ACTIVITY_BLUE.primary, 0.14)}`
                    : `0 0 6px ${alpha(theme.palette.error.light, 0.12)}`,
                  flexShrink: 0,
                  height: '7px',
                  width: '7px',
                }}
              />
              <Typography
                sx={{
                  color: rows.status.isOperational
                    ? theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.7)
                      : alpha(theme.palette.text.primary, 0.72)
                    : theme.palette.mode === 'dark'
                      ? alpha(theme.palette.error.light, 0.76)
                      : alpha(theme.palette.error.main, 0.76),
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

          {rows.items.map((row, index) => {
            const nextRow = rows.items[index + 1];
            const showSeparator =
              index < rows.items.length - 1 && !nextRow?.sectionStart;

            return (
              <Box
                key={row.label}
                {...(row.secondary
                  ? {
                      component: motion.div,
                      initial: false,
                      animate: enableOverlay
                        ? {
                            opacity: isExpanded ? 1 : 0.84,
                            y: isExpanded ? 0 : 4,
                          }
                        : undefined,
                      transition: enableOverlay
                        ? {
                            duration: INFO_SECONDARY_LAYER_TRANSITION_MS / 1000,
                            ease: [0.2, 0, 0, 1],
                          }
                        : undefined,
                    }
                  : {})}
                sx={{
                  ...(showSeparator
                    ? infoSepSx(theme, index, rows.items.length)
                    : {}),
                  alignItems: 'center',
                  columnGap: '18px',
                  display: 'grid',
                  gridTemplateColumns: `minmax(0, 1fr) minmax(${INFO_VALUE_COLUMN_MIN_WIDTH_PX}px, 44%)`,
                  minHeight: '38px',
                  mt: row.sectionStart ? '18px' : 0,
                  py: row.secondary ? '6px' : '7px',
                }}
              >
                <Typography
                  sx={{
                    color: row.secondary
                      ? theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.46)
                        : alpha(theme.palette.text.primary, 0.52)
                      : theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.62)
                        : alpha(theme.palette.text.primary, 0.66),
                    fontSize: row.secondary ? '0.7rem' : '0.73rem',
                    fontWeight: row.secondary ? 400 : 500,
                    letterSpacing: '0.018em',
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
                    justifyContent: 'flex-end',
                    justifySelf: 'stretch',
                    maxWidth: '100%',
                    minHeight: '24px',
                    minWidth: 0,
                    textAlign: 'right',
                  }}
                >
                  {typeof row.value === 'string' ? (
                    <Typography
                      sx={{
                        color: row.secondary
                          ? theme.palette.mode === 'dark'
                            ? alpha(theme.palette.common.white, 0.72)
                            : alpha(theme.palette.text.primary, 0.76)
                          : theme.palette.text.primary,
                        fontSize: row.secondary
                          ? '0.785rem'
                          : row.emphasize
                            ? '0.94rem'
                            : '0.86rem',
                        fontWeight: row.secondary
                          ? 400
                          : row.emphasize
                            ? 700
                            : 600,
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
                  ) : (
                    row.value
                  )}
                </Box>
              </Box>
            );
          })}
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
  const [walletActivityTargetHeightPx, setWalletActivityTargetHeightPx] =
    useState<number | null>(null);
  const [customizableCardsLayout, setCustomizableCardsLayout] =
    useState<HomeCustomizableCardsLayout>(() =>
      parseHomeCustomizableCardsLayout(
        localStorage.getItem(HOME_CUSTOMIZABLE_CARD_LAYOUT_STORAGE_KEY)
      )
    );
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
  const setGroupInvitesCache = useSetAtom(groupInvitesCacheAtom);
  const setJoinRequestsCache = useSetAtom(joinRequestsCacheAtom);
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
    setGroupInvitesCache(null);
    setJoinRequestsCache(null);
  };

  const balanceLabel = balance != null ? `${Number(balance).toFixed(2)} QORT` : '—';
  const handleOpenEmbeddedQuitter = () => {
    executeEvent('addTab', { data: { service: 'APP', name: 'Quitter' } });
    executeEvent('open-apps-mode', {});
  };

  const nodeStatusValue = nodeInfos?.isSynchronizing && nodeInfos?.syncPercent !== 100 ? `Syncing ${Math.round(nodeInfos?.syncPercent || 0)}%` : 'Fully Synced';
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
  const minterDotsFilled = minterPreviewMode === 'on' ? 5 : 0;
  const isMinterOn = minterPreviewMode === 'on';
  const minterValue = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'inline-flex',
        height: '24px',
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
            style={{ alignItems: 'center', display: 'flex', height: '24px', justifyContent: 'flex-end', width: '100%' }}
          >
            <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: '4px', height: '20px', justifyContent: 'flex-end' }}>
              {Array.from({ length: 8 }).map((_, index) => (
                <Box
                  key={index}
                  sx={{
                    ...(index < minterDotsFilled ? filledBlueDotSx : emptyBlueDotSx),
                    borderRadius: '50%',
                    height: '12px',
                    width: '12px',
                  }}
                />
              ))}
            </Box>
          </motion.div>
        ) : (
          <motion.div
            key="minter-apply"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            style={{ alignItems: 'center', display: 'flex', height: '24px', justifyContent: 'flex-end', width: '100%' }}
          >
            <ButtonBase onClick={() => { executeEvent('addTab', { data: { service: 'APP', name: 'q-mintership' } }); executeEvent('open-apps-mode', {}); }} sx={{ alignItems: 'center', bgcolor: theme.palette.background.surface, border: `1px solid ${theme.palette.border.subtle}`, borderRadius: '999px', color: theme.palette.text.secondary, display: 'inline-flex', fontSize: '0.69rem', fontWeight: 600, height: '24px', justifyContent: 'center', minWidth: '56px', px: 1.15, py: 0, whiteSpace: 'nowrap' }}>
              Apply
            </ButtonBase>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
  const infoRows = {
    status: {
      isOperational: isSystemOperational,
      label: isSystemOperational ? 'Fully operational' : 'Not operational',
    },
    items: [
      {
        emphasize: true,
        label: 'QORT Balance',
        value: balanceLabel,
      },
      {
        label: 'Node Status',
        value: nodeStatusValue,
      },
      {
        label: 'Minter Level',
        value: minterValue,
      },
      {
        label: 'Connected Peers',
        value: peersLabel,
      },
      {
        label: 'Block Height',
        value: blockHeightLabel,
      },
      {
        label: 'QDN Peers',
        value: qdnPeersLabel,
      },
      {
        label: 'Using Node',
        secondary: true,
        sectionStart: true,
        value: nodeHostLabel,
      },
      {
        label: 'Node Type',
        secondary: true,
        value: nodeTypeLabel,
      },
      {
        label: 'Core Version',
        secondary: true,
        value: coreVersionLabel,
      },
      {
        label: 'Hub Version',
        secondary: true,
        value: hubVersionLabel,
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
  const groupActivityCardHeightPx =
    customizableCardsLayout.heights.groupActivity ?? null;
  const quitterCardHeightPx = customizableCardsLayout.heights.quitter ?? null;
  const groupActivityViewportHeightPx = Math.max(
    280,
    groupActivityMeasuredViewportHeightPx ??
      ((groupActivityCardHeightPx ?? HOME_GROUP_ACTIVITY_CARD_DEFAULT_HEIGHT_PX) -
        HOME_GROUP_ACTIVITY_CARD_CHROME_HEIGHT_PX)
  );

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
                    <InfoPreviewPanel rows={infoRows} theme={theme} />
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
                      display: 'flex',
                      flexDirection: 'column',
                      gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                      width: '100%',
                    }}
                  >
                  <Box
                    ref={assignGroupActivityPanelNode}
                    sx={{
                      ...dashboardPanelSx(theme, 'base'),
                      borderRadius: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      height:
                        groupActivityCardHeightPx != null
                          ? `${groupActivityCardHeightPx}px`
                          : undefined,
                      minHeight: `${HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS.groupActivity}px`,
                      order: groupActivityCardOrder,
                      overflow: 'hidden',
                      padding: '12px 20px 16px',
                      width: '100%',
                    }}
                    onMouseMove={handleDashboardPanelPointerMove}
                    onMouseLeave={handleDashboardPanelPointerLeave}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <Box sx={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                        <Box>
                          <Box sx={{ color: theme.palette.text.primary, fontSize: '1.02rem', fontWeight: 650, letterSpacing: '-0.01em' }}>{t('tutorial:home.group_activity', { postProcess: 'capitalizeFirstChar' })}</Box>
                          <Typography sx={{ color: theme.palette.mode === 'dark' ? 'rgba(223, 228, 238, 0.7)' : 'rgba(72, 78, 92, 0.68)', fontSize: '0.78rem', mt: '2px' }}>
                            Keep up with promotions, invites, and membership requests.
                          </Typography>
                        </Box>
                        <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: '6px' }}>
                          {renderCustomizableCardControls('groupActivity')}
                          <IconButton aria-label={t('core:action.refresh', { postProcess: 'capitalizeFirstChar', defaultValue: 'Refresh' })} onClick={handleRefreshGroupActivity} size="small" sx={{ color: theme.palette.text.secondary }}>
                            <RefreshIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      </Box>
                    </Box>
                    <Box
                      ref={groupActivityContentFrameRef}
                      sx={{
                        display: 'flex',
                        flex: '1 1 auto',
                        flexDirection: 'column',
                        gap: '8px',
                        minHeight: 0,
                        overflow: 'hidden',
                      }}
                    >
                      <Box
                        ref={groupActivityTopControlsRef}
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <Box
                          ref={activityToggleTrackRef}
                          sx={{
                            alignSelf: 'center',
                            bgcolor: groupActivityToggleTrackBackground,
                            borderRadius: '999px',
                            boxShadow: groupActivityToggleTrackShadow,
                            display: 'inline-flex',
                            gap: '1px',
                            minWidth: 0,
                            overflow: 'hidden',
                            padding: '2px',
                            position: 'relative',
                            width: 'fit-content',
                          }}
                        >
                        {activityToggleIndicator.ready && (
                          <motion.div
                            aria-hidden="true"
                            animate={{
                              width: activityToggleIndicator.width,
                              x: activityToggleIndicator.x,
                            }}
                            initial={false}
                            transition={
                              reduce ? { duration: 0 } : GROUP_ACTIVITY_TOGGLE_TRANSITION
                            }
                            style={{
                              background: groupActivityToggleIndicatorSurface.background,
                              borderRadius: 999,
                              bottom: 2,
                              boxShadow: groupActivityToggleIndicatorSurface.boxShadow,
                              left: 0,
                              pointerEvents: 'none',
                              position: 'absolute',
                              top: 2,
                              willChange: 'transform, width',
                              zIndex: 0,
                            }}
                          />
                        )}
                        {([ 
                          { key: 'requests' as ActivityTab, label: t('tutorial:home.group_activity_requests_short', { defaultValue: 'Requests' }), count: requestsCount, countLoading: requestsCountLoading, showBadge: true },
                          { key: 'promotions' as ActivityTab, label: t('tutorial:home.group_activity_promoted_short', { defaultValue: 'Promoted' }), count: promotionsCount, countLoading: false, showBadge: false },
                          { key: 'invites' as ActivityTab, label: t('tutorial:home.group_activity_invites_short', { defaultValue: 'Invites' }), count: invitesCount, countLoading: invitesCountLoading, showBadge: true },
                        ]).map(({ key, label, count, countLoading, showBadge }) => {
                          const showLoadingIndicator = countLoading && key !== 'invites';
                          const showCount = showBadge && count > 0;

                          return (
                            <ButtonBase
                              key={key}
                              ref={setActivityToggleSegmentRef(key)}
                              onClick={() => setActivityTab(key)}
                              sx={{
                                borderRadius: '999px',
                                color:
                                  activityTab === key
                                    ? groupActivityAccentTextColor
                                    : theme.palette.text.secondary,
                                display: 'inline-flex',
                                fontSize: '0.79rem',
                                fontWeight: 650,
                                height: '32px',
                                justifyContent: 'center',
                                minWidth: 0,
                                px: 1.7,
                                position: 'relative',
                                textTransform: 'none',
                                transition: reduce
                                  ? 'none'
                                  : 'color 220ms ease-out',
                                whiteSpace: 'nowrap',
                                zIndex: 1,
                              }}
                            >
                              <Box
                                component="span"
                                sx={{
                                  alignItems: 'center',
                                  display: 'inline-flex',
                                  gap:
                                    showLoadingIndicator || showCount ? '6px' : '0px',
                                  justifyContent: 'center',
                                  minWidth: 0,
                                }}
                              >
                                <Box
                                  component="span"
                                  sx={{
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {label}
                                </Box>
                                <Box
                                  component="span"
                                  sx={{
                                    alignItems: 'center',
                                    display: 'inline-flex',
                                    justifyContent: 'center',
                                    minWidth:
                                      showLoadingIndicator || showCount ? '18px' : 0,
                                  }}
                                >
                                  {showLoadingIndicator ? (
                                    <CircularProgress
                                      size={12}
                                      thickness={4}
                                      sx={{
                                        color:
                                          activityTab === key
                                            ? groupActivityAccentTextColor
                                            : GROUP_ACTIVITY_BLUE.primary,
                                      }}
                                    />
                                  ) : showCount ? (
                                    <Box
                                      component="span"
                                      sx={{
                                        alignItems: 'center',
                                        borderRadius: '50px',
                                        color:
                                          activityTab === key
                                            ? alpha(groupActivityAccentBadgeTextColor, 0.92)
                                            : alpha(APP_BLUE_SURFACE_TEXT, 0.86),
                                        display: 'inline-flex',
                                        fontSize: '0.64rem',
                                        fontWeight: 630,
                                        height: '15px',
                                        justifyContent: 'center',
                                        lineHeight: 1,
                                        minWidth: '15px',
                                        px: '4px',
                                        ...(activityTab === key
                                          ? groupActivityActiveBadgeSurface
                                          : groupActivityInactiveBadgeSurface),
                                      }}
                                    >
                                      <Box
                                        component="span"
                                        sx={{ position: 'relative', top: '0.5px' }}
                                      >
                                        {count}
                                      </Box>
                                    </Box>
                                  ) : null}
                                </Box>
                              </Box>
                            </ButtonBase>
                          );
                        })}
                        </Box>
                        <Box
                          data-group-activity-ghost-bar="true"
                          sx={{
                            alignItems: 'center',
                            alignSelf: 'center',
                            display: 'inline-flex',
                            justifyContent: 'center',
                            maxWidth: 'min(100%, 404px)',
                            mt: '12px',
                            px: '18px',
                            py: '10px',
                            position: 'relative',
                            width: '100%',
                          }}
                        >
                          <Box
                            aria-hidden="true"
                            sx={{
                              background: theme.palette.mode === 'dark'
                                ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.01) 16%, rgba(255,255,255,0.022) 50%, rgba(255,255,255,0.01) 84%, transparent 100%)'
                                : 'linear-gradient(90deg, transparent 0%, rgba(24,29,36,0.008) 16%, rgba(24,29,36,0.018) 50%, rgba(24,29,36,0.008) 84%, transparent 100%)',
                              borderRadius: '999px',
                              inset: 0,
                              pointerEvents: 'none',
                              position: 'absolute',
                            }}
                          />
                          <Box
                            aria-hidden="true"
                            sx={{
                              background: sharedAmbientPillGlowBackground,
                              borderRadius: '999px',
                              bottom: '-1px',
                              filter: 'blur(7px)',
                              left: '12%',
                              opacity: 0.9,
                              pointerEvents: 'none',
                              position: 'absolute',
                              right: '12%',
                              top: '-1px',
                            }}
                          />
                          <Box
                            aria-hidden="true"
                            sx={{
                              background: theme.palette.mode === 'dark'
                                ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.008) 10%, rgba(255,255,255,0.026) 26%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.026) 74%, rgba(255,255,255,0.008) 90%, transparent 100%)'
                                : 'linear-gradient(90deg, transparent 0%, rgba(24,29,36,0.006) 10%, rgba(24,29,36,0.018) 26%, rgba(24,29,36,0.042) 50%, rgba(24,29,36,0.018) 74%, rgba(24,29,36,0.006) 90%, transparent 100%)',
                              height: '1px',
                              left: '4%',
                              pointerEvents: 'none',
                              position: 'absolute',
                              right: '4%',
                              top: 0,
                            }}
                          />
                          <Box
                            aria-hidden="true"
                            sx={{
                              background: theme.palette.mode === 'dark'
                                ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.006) 10%, rgba(255,255,255,0.018) 26%, rgba(255,255,255,0.042) 50%, rgba(255,255,255,0.018) 74%, rgba(255,255,255,0.006) 90%, transparent 100%)'
                                : 'linear-gradient(90deg, transparent 0%, rgba(24,29,36,0.005) 10%, rgba(24,29,36,0.014) 26%, rgba(24,29,36,0.032) 50%, rgba(24,29,36,0.014) 74%, rgba(24,29,36,0.005) 90%, transparent 100%)',
                              bottom: 0,
                              height: '1px',
                              left: '4%',
                              pointerEvents: 'none',
                              position: 'absolute',
                              right: '4%',
                            }}
                          />
                          <Typography
                            sx={{
                              color: theme.palette.mode === 'dark'
                                ? 'rgba(223, 228, 238, 0.56)'
                                : 'rgba(72, 78, 92, 0.54)',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              letterSpacing: '0.018em',
                              lineHeight: 1.2,
                              position: 'relative',
                              textAlign: 'center',
                              zIndex: 1,
                            }}
                          >
                            Join censorship-free decentralized groups
                          </Typography>
                        </Box>
                      </Box>
                      <Box sx={{ display: activityTab === 'requests' ? 'block' : 'none' }}>
                        <GroupJoinRequests compact isVisible={activityTab === 'requests'} compactViewportHeight={groupActivityViewportHeightPx} onCountChange={setRequestsCount} onLoadingChange={setRequestsCountLoading} setGroupSection={setGroupSection} setSelectedGroup={setSelectedGroup} getTimestampEnterChat={getTimestampEnterChat} setOpenAddGroup={setOpenAddGroup} setOpenManageMembers={setOpenManageMembers} myAddress={myAddress} groups={groups} setMobileViewMode={setMobileViewMode} setDesktopViewMode={setDesktopViewMode} />
                      </Box>
                      <Box sx={{ display: activityTab === 'invites' ? 'block' : 'none' }}>
                        <GroupInvites compact isVisible={activityTab === 'invites'} compactViewportHeight={groupActivityViewportHeightPx} onCountChange={setInvitesCount} onLoadingChange={setInvitesCountLoading} setOpenAddGroup={setOpenAddGroup} setOpenAddGroupTab={setOpenAddGroupTab} myAddress={myAddress} />
                      </Box>
                      <Box sx={{ display: activityTab === 'promotions' ? 'block' : 'none' }}>
                        <ListOfGroupPromotions compact compactViewportHeight={groupActivityViewportHeightPx} onCountChange={setPromotionsCount} />
                      </Box>
                    </Box>
                  </Box>
                  <Box
                    ref={quitterCardHeightRef}
                    sx={{
                      ...dashboardPanelSx(theme, 'base'),
                      borderRadius: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      height:
                        quitterCardHeightPx != null
                          ? `${quitterCardHeightPx}px`
                          : undefined,
                      minHeight: `${HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS.quitter}px`,
                      order: quitterCardOrder,
                      overflow: 'hidden',
                      padding: '14px 16px 16px',
                      width: '100%',
                    }}
                    onMouseMove={handleDashboardPanelPointerMove}
                    onMouseLeave={handleDashboardPanelPointerLeave}
                  >
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: '14px',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          sx={{
                            color: theme.palette.text.primary,
                            fontSize: '1.02rem',
                            fontWeight: 650,
                            letterSpacing: '-0.01em',
                          }}
                        >
                          Quitter
                        </Typography>
                        <Typography
                          sx={{
                            color:
                              theme.palette.mode === 'dark'
                                ? 'rgba(223, 228, 238, 0.68)'
                                : 'rgba(72, 78, 92, 0.66)',
                            fontSize: '0.78rem',
                            mt: '2px',
                          }}
                        >
                          Live Q-App preview directly from your Main Page.
                        </Typography>
                      </Box>
                      <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: '8px' }}>
                        {renderCustomizableCardControls('quitter')}
                        <ButtonBase
                          disableRipple
                          onClick={handleOpenEmbeddedQuitter}
                          sx={{
                            ...getBlueTier1ButtonSx(),
                            borderRadius: '999px',
                            color: APP_BLUE_SURFACE_TEXT,
                            flexShrink: 0,
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            minHeight: '36px',
                            px: 1.7,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Open In Apps
                        </ButtonBase>
                      </Box>
                    </Box>
                    <Box
                      sx={{
                        border: `1px solid ${alpha(theme.palette.border.main, theme.palette.mode === 'dark' ? 0.26 : 0.18)}`,
                        borderRadius: '12px',
                        flex: '1 1 auto',
                        minHeight: 0,
                        overflow: 'hidden',
                        width: '100%',
                      }}
                    >
                      <AppViewerContainer
                        app={DASHBOARD_EMBEDDED_QUITTER_APP}
                        customHeight="100%"
                        hide={false}
                        isDevMode={false}
                        isSelected
                      />
                    </Box>
                  </Box>
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

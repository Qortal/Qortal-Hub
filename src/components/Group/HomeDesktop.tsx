import { Box, ButtonBase, CircularProgress, IconButton, Typography, useMediaQuery, useTheme } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import SouthWestRoundedIcon from '@mui/icons-material/SouthWestRounded';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import { alpha } from '@mui/material/styles';
import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { balanceAtom, groupInvitesCacheAtom, joinRequestsCacheAtom, memberGroupsAtom, nodeInfosAtom, userInfoAtom } from '../../atoms/global';
import { Spacer } from '../../common/Spacer';
import { GroupJoinRequests } from './GroupJoinRequests';
import { GroupInvites } from './GroupInvites';
import { ListOfGroupPromotions } from './ListOfGroupPromotions';
import { HomeProfileCard } from './HomeProfileCard';
import { GETTING_STARTED_LS_KEY, HomeGettingStarted } from './HomeGettingStarted';
import { getFeaturedDecorationMotionSx, HomeFeaturedApps } from './HomeFeaturedApps';
import { HomeFeaturedGroups } from './HomeFeaturedGroups';
import { HomeDeveloperTab } from './HomeDeveloperTab';
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
const GROUP_ACTIVITY_COMPACT_VIEWPORT_HEIGHT_PX = 680;

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
const INFO_PANEL_EXPAND_OPEN_DELAY_MS = 35;
const INFO_PANEL_EXPAND_CLOSE_DELAY_MS = 60;
const INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX = 18;
const HOME_INFO_PANEL_DARK_BACKGROUND = '#24272f';
const HOME_INFO_PANEL_DARK_GRADIENT = 'linear-gradient(180deg, #24272f 0%, #24272f 30%, #1B1D24 100%)';
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
    <Box ref={assignPanelNode} sx={{ ...dashboardPanelSx(theme), borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px', width: '100%', ...sx }} onMouseMove={handleDashboardPanelPointerMove} onMouseLeave={handleDashboardPanelPointerLeave}>
      <Typography sx={{ color: theme.palette.text.primary, fontSize: '1rem', fontWeight: 600, ...titleSx }}>{title}</Typography>
      {children}
    </Box>
  );
};

const sepSx = (theme) => ({ borderBottom: `1px solid ${theme.palette.border.subtle}` });

const infoSepSx = (theme, index, total) => {
  const progress = total > 1 ? index / (total - 1) : 0;
  const opacity = theme.palette.mode === 'dark'
    ? (0.16 - progress * 0.08) * 0.6
    : (0.14 - progress * 0.06) * 0.6;
  const edgeOpacity = opacity * 0.32;

  return {
    position: 'relative',
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: '1px',
      pointerEvents: 'none',
      background: theme.palette.mode === 'dark'
        ? `linear-gradient(90deg, rgba(255,255,255,${edgeOpacity}) 0%, rgba(255,255,255,${opacity}) 14%, rgba(255,255,255,${opacity}) 86%, rgba(255,255,255,${edgeOpacity}) 100%)`
        : `linear-gradient(90deg, rgba(60,76,90,${edgeOpacity}) 0%, rgba(60,76,90,${opacity}) 14%, rgba(60,76,90,${opacity}) 86%, rgba(60,76,90,${edgeOpacity}) 100%)`,
    },
  };
};

const WalletActionButton = ({ icon, label, onClick, theme }) => (
  <ButtonBase onClick={onClick} sx={{ alignItems: 'center', bgcolor: theme.palette.mode === 'dark' ? '#262931' : theme.palette.background.surface, border: `1px solid ${theme.palette.border.subtle}`, borderRadius: '10px', display: 'flex', gap: '9px', height: '46px', justifyContent: 'center', px: 1.5, transition: 'background-color 140ms ease, border-color 140ms ease, transform 120ms ease', width: '100%', '&:hover': { bgcolor: theme.palette.mode === 'dark' ? '#262931' : theme.palette.background.elevated, borderColor: theme.palette.border.main, transform: 'translateY(-1px)' }, '&:active': { transform: 'translateY(0)' } }}>
    <Box sx={{ color: theme.palette.text.secondary, display: 'inline-flex' }}>{icon}</Box>
    <Typography sx={{ color: theme.palette.text.primary, fontSize: '0.8rem', fontWeight: 600 }}>{label}</Typography>
  </ButtonBase>
);

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
  }, [enableOverlay, rows.length]);

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
          ...dashboardPanelSx(theme),
          ...(theme.palette.mode === 'dark'
            ? {
                backgroundColor: HOME_INFO_PANEL_DARK_BACKGROUND,
                backgroundImage: HOME_INFO_PANEL_DARK_GRADIENT,
              }
            : {}),
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
          <Typography sx={{ color: theme.palette.text.primary, fontSize: '1rem', fontWeight: 600, letterSpacing: '0.015em', mb: '10px' }}>
            INFO
          </Typography>

          {rows.map((row, index) => (
            <Box
              key={row.label}
              sx={{
                ...(index < rows.length - 1 ? infoSepSx(theme, index, rows.length) : {}),
                alignItems: 'center',
                display: 'flex',
                gap: '14px',
                justifyContent: 'space-between',
                py: 1.14,
              }}
            >
              <Box sx={{ alignItems: 'center', color: theme.palette.text.primary, display: 'inline-flex', gap: '10px', minWidth: 0 }}>
                {row.icon}
                <Typography sx={{ color: theme.palette.text.primary, fontSize: '0.78rem', fontWeight: 500, letterSpacing: '0.02em', minWidth: 0 }}>
                  {row.label}
                </Typography>
              </Box>
              <Box sx={{ alignItems: 'center', color: theme.palette.text.primary, display: 'inline-flex', flexShrink: 0, fontSize: row.emphasize ? '0.92rem' : '0.82rem', fontWeight: row.emphasize ? 700 : 600, justifyContent: 'flex-end', letterSpacing: '0.018em', maxWidth: '62%', minWidth: 0, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {row.value}
              </Box>
            </Box>
          ))}
        </Box>

      </Box>
    </Box>
  );
};

export const HomeDesktop = ({ myAddress, setGroupSection, setSelectedGroup, getTimestampEnterChat, setOpenManageMembers, setOpenAddGroup, setMobileViewMode, setDesktopViewMode, desktopViewMode }) => {
  const groupActivityPanelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const rightRailRef = useRef<HTMLDivElement | null>(null);
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
  const [featuredAmbientDecorationsVisible, setFeaturedAmbientDecorationsVisible] = useState(false);
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
  const [coreVersionLabel, setCoreVersionLabel] = useState('—');
  const [minterPreviewMode, setMinterPreviewMode] = useState<'off' | 'on'>(() => {
    const saved = localStorage.getItem('dashboardMinterPreviewMode');
    return saved === 'on' ? 'on' : 'off';
  });
  const reduce = useReducedMotion();
  const { t } = useTranslation(['core', 'group', 'tutorial', 'auth']);
  const theme = useTheme();
  const setGroupInvitesCache = useSetAtom(groupInvitesCacheAtom);
  const setJoinRequestsCache = useSetAtom(joinRequestsCacheAtom);
  const getIndividualUserInfo = useHandleUserInfo();
  const userAddress = userInfo?.address;
  const isLocalPreview = typeof window !== 'undefined' && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');

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
  const minterDotsFilled = minterPreviewMode === 'on' ? 5 : 0;
  const isMinterOn = minterPreviewMode === 'on';
  const minterValue = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'inline-flex',
        height: '28px',
        justifyContent: 'flex-end',
        minWidth: '126px',
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
            style={{ alignItems: 'center', display: 'flex', height: '28px', justifyContent: 'flex-end', width: '100%' }}
          >
            <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: '6px', height: '28px' }}>
              {Array.from({ length: 8 }).map((_, index) => (
                <Box key={index} sx={{ bgcolor: index < minterDotsFilled ? '#40B4C7' : alpha(theme.palette.text.secondary, 0.28), borderRadius: '50%', boxShadow: index < minterDotsFilled ? `0 0 0 1px ${alpha('#40B4C7', 0.18)}` : 'none', height: '14px', width: '14px' }} />
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
            style={{ alignItems: 'center', display: 'flex', height: '28px', justifyContent: 'flex-end', width: '100%' }}
          >
            <ButtonBase onClick={() => { executeEvent('addTab', { data: { service: 'APP', name: 'q-mintership' } }); executeEvent('open-apps-mode', {}); }} sx={{ alignItems: 'center', bgcolor: theme.palette.background.surface, border: `1px solid ${theme.palette.border.subtle}`, borderRadius: '999px', color: theme.palette.text.secondary, display: 'inline-flex', fontSize: '0.72rem', fontWeight: 600, height: '26px', justifyContent: 'center', minWidth: '58px', px: 1.3, py: 0, whiteSpace: 'nowrap' }}>
              Apply
            </ButtonBase>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
  const infoRows = [
    {
      emphasize: true,
      icon: <AccountBalanceWalletOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />,
      label: 'QORT Balance',
      value: balanceLabel,
    },
    {
      icon: <HubOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />,
      label: 'Node Status',
      value: nodeStatusValue,
    },
    {
      icon: <AutoAwesomeOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />,
      label: 'Minter Level',
      value: minterValue,
    },
    {
      icon: <GroupOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />,
      label: 'Connected Peers',
      value: peersLabel,
    },
    {
      icon: <LayersOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />,
      label: 'Block Height',
      value: blockHeightLabel,
    },
    {
      icon: <DnsOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />,
      label: 'QDN Peers',
      value: qdnPeersLabel,
    },
    {
      icon: <ComputerOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />,
      label: 'Using Node',
      value: nodeHostLabel,
    },
    {
      icon: <ComputerOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />,
      label: 'Node Type',
      value: nodeTypeLabel,
    },
    {
      icon: <InfoOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />,
      label: 'Core Version',
      value: coreVersionLabel,
    },
    {
      icon: <InfoOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />,
      label: 'Hub Version',
      value: hubVersionLabel,
    },
  ];

  const sharedGroupNavProps = { getTimestampEnterChat, setDesktopViewMode, setGroupSection, setMobileViewMode, setSelectedGroup };
  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence mode="wait">
        {desktopViewMode === 'home' && (
          <motion.div key="home" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} custom={reduce} style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', scrollbarGutter: 'stable', width: '100%', willChange: 'transform, opacity', backfaceVisibility: 'hidden' }}>
            <Spacer height="20px" />
            <Box sx={{ alignItems: 'flex-start', display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, maxWidth: { xs: '1320px', xl: '1520px' }, padding: '0 20px', width: '100%' }}>
              <Box sx={{ display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateColumns: '1fr', alignItems: 'start', width: '100%', [theme.breakpoints.up('xl')]: { alignItems: 'stretch', gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 400px)' } }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, minWidth: 0, width: '100%' }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                    <Box sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.0605em', textTransform: 'uppercase' }}>Qortal Hub</Box>
                    <HomeProfileCard />
                  </Box>
                  <Box sx={{ display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateColumns: { xs: '1fr', md: 'minmax(285px, 330px) minmax(0, 1fr)', xl: 'minmax(310px, 360px) minmax(0, 1fr)' }, alignItems: 'stretch', width: '100%' }}>
                    <Box sx={{ display: 'block', minWidth: 0, '& > *': { height: '100%' } }}>
                      <HomeGettingStarted
                        debugCompletionOverrides={isLocalPreview ? gettingStartedDebugOverrides : undefined}
                        debugReplayToken={gettingStartedDebugReplayToken}
                        debugUseOverridesOnly={isLocalPreview && gettingStartedDebugPathActive}
                        onGettingStartedComplete={() => { setShowMostActiveGroups(true); setIsOnboardingComplete(true); }}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', minWidth: 0, overflow: 'visible', position: 'relative', width: '100%', '& > *': { position: 'relative', width: '100%', zIndex: 1 } }}>
                      <Box
                        className="dashboard-panel-decoration"
                        aria-hidden="true"
                        sx={{
                          position: 'absolute',
                          left: '-6%',
                          right: '50%',
                          bottom: '-20px',
                          height: '20px',
                          pointerEvents: 'none',
                          zIndex: 0,
                          background: theme.palette.mode === 'dark'
                            ? `radial-gradient(88% 140% at 50% 0%, rgba(87, 170, 219, 0.08) 0%, rgba(87, 170, 219, 0.048) 26%, rgba(14, 15, 20, 0.022) 56%, transparent 82%),
                               linear-gradient(90deg, transparent 0%, rgba(87, 170, 219, 0.01) 18%, rgba(87, 170, 219, 0.042) 50%, rgba(87, 170, 219, 0.01) 82%, transparent 100%)`
                            : `radial-gradient(88% 140% at 50% 0%, rgba(60, 76, 90, 0.06) 0%, rgba(60, 76, 90, 0.036) 26%, rgba(14, 15, 20, 0.016) 56%, transparent 82%),
                               linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0.008) 18%, rgba(60, 76, 90, 0.03) 50%, rgba(60, 76, 90, 0.008) 82%, transparent 100%)`,
                          filter: 'blur(8px)',
                          ...getFeaturedDecorationMotionSx(
                            featuredAmbientDecorationsVisible,
                            1
                          ),
                        }}
                      />
                      <HomeFeaturedApps
                        decorationsVisible={featuredAmbientDecorationsVisible}
                        onIntroComplete={() => {
                          setFeaturedAmbientDecorationsVisible(true);
                        }}
                      />
                    </Box>
                  </Box>
                </Box>
                <Box ref={rightRailRef} sx={{ alignContent: 'start', display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, minWidth: 0, [theme.breakpoints.up('xl')]: { display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateRows: `${HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX}px auto`, marginTop: `${HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX}px` } }}>
                  <InfoPreviewPanel rows={infoRows} theme={theme} />
                  <DashboardUtilityPanel title="WALLET ACTIVITY" theme={theme} sx={{ gap: '12px', minHeight: '182px', padding: '14px 16px 16px' }}>
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
                  <Box ref={groupActivityPanelRef} sx={{ ...dashboardPanelSx(theme), borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 20px', width: '100%' }} onMouseMove={handleDashboardPanelPointerMove} onMouseLeave={handleDashboardPanelPointerLeave}>
                    <Box
                      className="dashboard-panel-decoration"
                      aria-hidden="true"
                      sx={{
                        position: 'absolute',
                        left: '1.03125%',
                        right: '1.03125%',
                        top: '-3px',
                        height: '3.3px',
                        pointerEvents: 'none',
                        zIndex: -1,
                        background: theme.palette.mode === 'dark'
                          ? `linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0) 12%, rgba(60, 76, 90, 0.14) 26%, rgba(87, 170, 219, 0.216) 40%, rgba(87, 170, 219, 0.486) 46%, rgba(87, 170, 219, 0.594) 50%, rgba(87, 170, 219, 0.486) 54%, rgba(87, 170, 219, 0.216) 60%, rgba(60, 76, 90, 0.14) 74%, rgba(60, 76, 90, 0) 88%, transparent 100%),
                             radial-gradient(90% 92% at 50% 100%, rgba(87, 170, 219, 0.198) 0%, rgba(87, 170, 219, 0.108) 30%, rgba(14, 15, 20, 0.035) 52%, transparent 76%)`
                          : `linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0) 12%, rgba(60, 76, 90, 0.075) 26%, rgba(60, 76, 90, 0.18) 44%, rgba(60, 76, 90, 0.22) 50%, rgba(60, 76, 90, 0.18) 56%, rgba(60, 76, 90, 0.075) 74%, rgba(60, 76, 90, 0) 88%, transparent 100%),
                             radial-gradient(90% 92% at 50% 100%, rgba(60, 76, 90, 0.11) 0%, rgba(60, 76, 90, 0.055) 30%, rgba(14, 15, 20, 0.016) 52%, transparent 76%)`,
                        filter: 'blur(0.72px)',
                        ...getFeaturedDecorationMotionSx(
                          featuredAmbientDecorationsVisible,
                          1
                        ),
                      }}
                    />
                    <Box sx={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <Box>
                        <Box sx={{ color: theme.palette.text.primary, fontSize: '1rem', fontWeight: 600 }}>{t('tutorial:home.group_activity', { postProcess: 'capitalizeFirstChar' })}</Box>
                        <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.78rem', mt: '3px' }}>
                          Keep up with promotions, invites, and membership requests.
                        </Typography>
                      </Box>
                      <IconButton aria-label={t('core:action.refresh', { postProcess: 'capitalizeFirstChar', defaultValue: 'Refresh' })} onClick={handleRefreshGroupActivity} size="small" sx={{ color: theme.palette.text.secondary }}>
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <Box sx={{ alignSelf: 'center', bgcolor: theme.palette.mode === 'dark' ? 'rgba(14,15,20,0.82)' : 'rgba(255,255,255,0.68)', border: `1px solid ${alpha(theme.palette.border.subtle, theme.palette.mode === 'dark' ? 0.7 : 0.9)}`, borderRadius: '50px', display: 'flex', gap: '4px', justifyContent: 'center', minWidth: 'fit-content', padding: '4px', boxShadow: theme.palette.mode === 'dark' ? 'inset 0 1px 0 rgba(255,255,255,0.03)' : 'inset 0 1px 0 rgba(255,255,255,0.45)' }}>
                      {([
                        { key: 'requests' as ActivityTab, label: t('group:join_requests', { postProcess: 'capitalizeFirstChar' }), count: requestsCount, countLoading: requestsCountLoading },
                        { key: 'promotions' as ActivityTab, label: t('group:group.promotions', { postProcess: 'capitalizeFirstChar' }), count: promotionsCount, countLoading: false },
                        { key: 'invites' as ActivityTab, label: t('group:group.invites', { postProcess: 'capitalizeFirstChar' }), count: invitesCount, countLoading: invitesCountLoading },
                      ]).map(({ key, label, count, countLoading }) => (
                        <ButtonBase key={key} onClick={() => setActivityTab(key)} sx={{ bgcolor: activityTab === key ? (theme.palette.mode === 'dark' ? '#8DB6F2' : '#90B6F0') : 'transparent', borderRadius: '50px', color: activityTab === key ? '#172132' : theme.palette.text.secondary, fontSize: '0.82rem', fontWeight: activityTab === key ? 600 : 400, px: 2, py: 0.8, textTransform: 'none', whiteSpace: 'nowrap', transition: 'background-color 140ms ease, color 140ms ease', '&:hover': { bgcolor: activityTab === key ? (theme.palette.mode === 'dark' ? '#84AFF0' : '#89B0EE') : (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(24,29,36,0.04)') } }}>
                          {label}
                          {countLoading && key !== 'invites' ? <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', ml: '6px' }}><CircularProgress size={14} thickness={4} sx={{ color: activityTab === key ? '#172132' : theme.palette.primary.main }} /></Box> : count > 0 ? <Box component="span" sx={{ bgcolor: activityTab === key ? 'rgba(23,33,50,0.14)' : (theme.palette.mode === 'dark' ? '#8DB6F2' : '#90B6F0'), borderRadius: '50px', color: activityTab === key ? '#172132' : '#172132', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, height: '18px', lineHeight: 1, ml: '6px', minWidth: '18px', px: '6px' }}>{count}</Box> : null}
                        </ButtonBase>
                      ))}
                    </Box>
                    <Box
                      sx={{
                        alignItems: 'center',
                        alignSelf: 'center',
                        display: 'inline-flex',
                        justifyContent: 'center',
                        maxWidth: 'min(100%, 420px)',
                        mt: '2px',
                        px: '18px',
                        py: '13px',
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
                          background: theme.palette.mode === 'dark'
                            ? 'radial-gradient(58% 136% at 50% 50%, rgba(87,170,219,0.11) 0%, rgba(87,170,219,0.072) 20%, rgba(87,170,219,0.038) 42%, rgba(14,15,20,0.012) 72%, transparent 100%)'
                            : 'radial-gradient(58% 136% at 50% 50%, rgba(60,76,90,0.072) 0%, rgba(60,76,90,0.045) 20%, rgba(60,76,90,0.022) 42%, rgba(255,255,255,0.008) 72%, transparent 100%)',
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
                    <Box sx={{ display: activityTab === 'requests' ? 'block' : 'none' }}>
                      <GroupJoinRequests compact compactViewportHeight={GROUP_ACTIVITY_COMPACT_VIEWPORT_HEIGHT_PX} onCountChange={setRequestsCount} onLoadingChange={setRequestsCountLoading} setGroupSection={setGroupSection} setSelectedGroup={setSelectedGroup} getTimestampEnterChat={getTimestampEnterChat} setOpenManageMembers={setOpenManageMembers} myAddress={myAddress} groups={groups} setMobileViewMode={setMobileViewMode} setDesktopViewMode={setDesktopViewMode} />
                    </Box>
                    <Box sx={{ display: activityTab === 'invites' ? 'block' : 'none' }}>
                      <GroupInvites compact compactViewportHeight={GROUP_ACTIVITY_COMPACT_VIEWPORT_HEIGHT_PX} onCountChange={setInvitesCount} onLoadingChange={setInvitesCountLoading} setOpenAddGroup={setOpenAddGroup} myAddress={myAddress} />
                    </Box>
                    <Box sx={{ display: activityTab === 'promotions' ? 'block' : 'none' }}>
                      <ListOfGroupPromotions compact compactViewportHeight={GROUP_ACTIVITY_COMPACT_VIEWPORT_HEIGHT_PX} onCountChange={setPromotionsCount} />
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

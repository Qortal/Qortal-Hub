import { Box, ButtonBase, CircularProgress, IconButton, Popover, Typography, useMediaQuery, useTheme } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import QrCode2Icon from '@mui/icons-material/QrCode2';
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
import { HomeFeaturedApps } from './HomeFeaturedApps';
import { HomeFeaturedGroups } from './HomeFeaturedGroups';
import { HomeDeveloperTab } from './HomeDeveloperTab';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import { AnimatePresence, LazyMotion, domAnimation, motion, useReducedMotion } from 'framer-motion';
import { getBaseApiReact } from '../../App';
import { manifestData } from '../NotAuthenticated';
import { executeEvent, subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { dashboardPanelSx, handleDashboardPanelPointerLeave, handleDashboardPanelPointerMove } from './dashboardPanelEffects';
import { useHandleUserInfo } from '../../hooks/useHandleUserInfo';
import { isLocalNodeUrl } from '../../constants/constants';
import { nodeDisplay } from '../../utils/helpers';

type HomeTab = 'user' | 'developer';
type ActivityTab = 'requests' | 'invites' | 'promotions';

const SHOW_USER_DEVELOPER_TOGGLE = false;
const SHOW_MOST_ACTIVE_GROUPS = false;
const DASHBOARD_WELCOME_PREVIEW_KEY = 'dashboardWelcomePreviewMode';

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
const HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX = 38;
const HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX = 321;
const INFO_PANEL_EXPAND_OPEN_DELAY_MS = 120;
const INFO_PANEL_EXPAND_CLOSE_DELAY_MS = 160;

const DashboardUtilityPanel = ({ title, children, theme, sx = undefined, titleSx = undefined }) => (
  <Box sx={{ ...dashboardPanelSx(theme), borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px', width: '100%', ...sx }} onMouseMove={handleDashboardPanelPointerMove} onMouseLeave={handleDashboardPanelPointerLeave}>
    <Typography sx={{ color: theme.palette.text.primary, fontSize: '1rem', fontWeight: 600, ...titleSx }}>{title}</Typography>
    {children}
  </Box>
);

const sepSx = (theme) => ({ borderBottom: `1px solid ${theme.palette.border.subtle}` });

const WalletActionButton = ({ icon, label, onClick, theme }) => (
  <ButtonBase onClick={onClick} sx={{ alignItems: 'center', bgcolor: theme.palette.background.surface, border: `1px solid ${theme.palette.border.subtle}`, borderRadius: '10px', display: 'flex', gap: '9px', height: '46px', justifyContent: 'center', px: 1.5, transition: 'background-color 140ms ease, border-color 140ms ease, transform 120ms ease', width: '100%', '&:hover': { bgcolor: theme.palette.background.elevated, borderColor: theme.palette.border.main, transform: 'translateY(-1px)' }, '&:active': { transform: 'translateY(0)' } }}>
    <Box sx={{ color: theme.palette.text.secondary, display: 'inline-flex' }}>{icon}</Box>
    <Typography sx={{ color: theme.palette.text.primary, fontSize: '0.8rem', fontWeight: 600 }}>{label}</Typography>
  </ButtonBase>
);

const InfoPreviewPanel = ({ rows, theme }) => {
  const enableOverlay = useMediaQuery(theme.breakpoints.up('xl'));
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
    ? Math.max(resolvedCollapsedHeight, contentHeight)
    : contentHeight;

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
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        sx={{
          ...dashboardPanelSx(theme),
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
                    ? '0 24px 60px rgba(0, 0, 0, 0.34)'
                    : '0 22px 52px rgba(15, 23, 42, 0.16)'
                  : undefined,
                height: resolvedCollapsedHeight == null
                  ? '100%'
                  : `${isExpanded ? expandedHeight : resolvedCollapsedHeight}px`,
                left: 0,
                position: 'absolute',
                right: 0,
                top: 0,
                transition: 'height 260ms cubic-bezier(0.2, 0, 0, 1), box-shadow 220ms ease, border-color 220ms ease',
              }
            : {}),
        }}
        onMouseMove={handleDashboardPanelPointerMove}
      >
        <Box
          ref={contentRef}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            px: '16px',
            py: '12px',
            width: '100%',
            ...(showCollapsedFade
              ? {
                  WebkitMaskImage:
                    'linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) calc(100% - 72px), rgba(0,0,0,0.94) calc(100% - 50px), rgba(0,0,0,0.72) calc(100% - 28px), rgba(0,0,0,0.38) calc(100% - 10px), rgba(0,0,0,0) 100%)',
                  WebkitMaskRepeat: 'no-repeat',
                  WebkitMaskSize: '100% 100%',
                  maskImage:
                    'linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) calc(100% - 72px), rgba(0,0,0,0.94) calc(100% - 50px), rgba(0,0,0,0.72) calc(100% - 28px), rgba(0,0,0,0.38) calc(100% - 10px), rgba(0,0,0,0) 100%)',
                  maskRepeat: 'no-repeat',
                  maskSize: '100% 100%',
                }
              : {}),
          }}
        >
          <Typography sx={{ color: theme.palette.text.primary, fontSize: '1rem', fontWeight: 600, mb: '8px' }}>
            Info
          </Typography>

          {rows.map((row, index) => (
            <Box
              key={row.label}
              sx={{
                ...(index < rows.length - 1 ? sepSx(theme) : {}),
                alignItems: 'center',
                display: 'flex',
                gap: '12px',
                justifyContent: 'space-between',
                py: 0.98,
              }}
            >
              <Box sx={{ alignItems: 'center', color: theme.palette.text.primary, display: 'inline-flex', gap: '8px', minWidth: 0 }}>
                {row.icon}
                <Typography sx={{ color: theme.palette.text.primary, fontSize: '0.78rem', fontWeight: 600, minWidth: 0 }}>
                  {row.label}
                </Typography>
              </Box>
              <Box sx={{ alignItems: 'center', color: theme.palette.text.primary, display: 'inline-flex', flexShrink: 0, fontSize: row.emphasize ? '0.92rem' : '0.82rem', fontWeight: row.emphasize ? 700 : 600, justifyContent: 'flex-end', maxWidth: '62%', minWidth: 0, textAlign: 'right', whiteSpace: 'nowrap' }}>
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
  const [requestsCountLoading, setRequestsCountLoading] = useState(true);
  const [invitesCountLoading, setInvitesCountLoading] = useState(true);
  const [qrAnchorEl, setQrAnchorEl] = useState<HTMLElement | null>(null);
  const [minterLevel, setMinterLevel] = useState<number | null>(null);
  const [coreVersionLabel, setCoreVersionLabel] = useState('—');
  const [minterPreviewMode, setMinterPreviewMode] = useState<'off' | 'on'>(() => {
    const saved = localStorage.getItem('dashboardMinterPreviewMode');
    return saved === 'on' ? 'on' : 'off';
  });
  const [welcomePreviewMode, setWelcomePreviewMode] = useState<'off' | 'on'>(() => {
    const saved = localStorage.getItem(DASHBOARD_WELCOME_PREVIEW_KEY);
    return saved === 'off' ? 'off' : 'on';
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
    const handleSetDashboardWelcomePreview = (e: CustomEvent) => {
      const mode = e.detail?.data?.mode === 'off' ? 'off' : 'on';
      setWelcomePreviewMode(mode);
      localStorage.setItem(DASHBOARD_WELCOME_PREVIEW_KEY, mode);
    };

    subscribeToEvent('setDashboardWelcomePreview', handleSetDashboardWelcomePreview);
    return () => {
      unsubscribeFromEvent('setDashboardWelcomePreview', handleSetDashboardWelcomePreview);
    };
  }, []);

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
        height: '24px',
        justifyContent: 'flex-end',
        minWidth: '104px',
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
            <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: '5px', height: '24px' }}>
              {Array.from({ length: 8 }).map((_, index) => (
                <Box key={index} sx={{ bgcolor: index < minterDotsFilled ? theme.palette.primary.main : alpha(theme.palette.text.secondary, 0.28), borderRadius: '50%', boxShadow: index < minterDotsFilled ? `0 0 0 1px ${alpha(theme.palette.primary.main, 0.18)}` : 'none', height: '8px', width: '8px' }} />
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
            <ButtonBase onClick={() => { executeEvent('addTab', { data: { service: 'APP', name: 'q-mintership' } }); executeEvent('open-apps-mode', {}); }} sx={{ alignItems: 'center', bgcolor: theme.palette.background.surface, border: `1px solid ${theme.palette.border.subtle}`, borderRadius: '999px', color: theme.palette.text.secondary, display: 'inline-flex', fontSize: '0.72rem', fontWeight: 600, height: '24px', justifyContent: 'center', minWidth: '54px', px: 1.2, py: 0, whiteSpace: 'nowrap' }}>
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
          <motion.div key="home" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} custom={reduce} style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', width: '100%', willChange: 'transform, opacity', backfaceVisibility: 'hidden' }}>
            <Spacer height="20px" />
            <Box sx={{ alignItems: 'flex-start', display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, maxWidth: { xs: '1320px', xl: '1520px' }, padding: '0 20px', width: '100%' }}>
              <Box sx={{ display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateColumns: '1fr', alignItems: 'start', width: '100%', [theme.breakpoints.up('xl')]: { alignItems: 'stretch', gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 400px)' } }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, minWidth: 0, width: '100%' }}>
                  <Box sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.055em', textTransform: 'uppercase' }}>Qortal Hub</Box>
                  <HomeProfileCard />
                  <Box sx={{ display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateColumns: { xs: '1fr', md: 'minmax(285px, 330px) minmax(0, 1fr)', xl: 'minmax(310px, 360px) minmax(0, 1fr)' }, alignItems: 'stretch', width: '100%' }}>
                    <Box sx={{ display: 'block', minWidth: 0, '& > *': { height: '100%' } }}>
                      <HomeGettingStarted previewMode={isLocalPreview ? welcomePreviewMode : 'live'} onGettingStartedComplete={() => { setShowMostActiveGroups(true); setIsOnboardingComplete(true); }} />
                    </Box>
                    <Box sx={{ display: 'flex', minWidth: 0, width: '100%', '& > *': { width: '100%' } }}>
                      <HomeFeaturedApps />
                    </Box>
                  </Box>
                </Box>
                <Box sx={{ alignContent: 'start', display: 'flex', flexDirection: 'column', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, minWidth: 0, [theme.breakpoints.up('xl')]: { display: 'grid', gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`, gridTemplateRows: `${HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX}px auto`, height: `calc(100% - ${HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX}px)`, marginTop: `${HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX}px` } }}>
                  <InfoPreviewPanel rows={infoRows} theme={theme} />
                  <DashboardUtilityPanel title="Wallet Activity" theme={theme} sx={{ gap: '12px', minHeight: '182px', padding: '14px 16px 16px' }}>
                    <Box sx={{ ...sepSx(theme), alignItems: 'center', display: 'flex', justifyContent: 'space-between', pb: 1.35 }}>
                      <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.72rem' }}>Last activity</Typography>
                      <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.72rem' }}>2 days ago</Typography>
                    </Box>
                    <Box sx={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', pt: 0.5 }}>
                      <WalletActionButton icon={<SendRoundedIcon sx={{ fontSize: '16px' }} />} label="Send" onClick={() => executeEvent('openPaymentInternal', {})} theme={theme} />
                      <WalletActionButton icon={<SouthWestRoundedIcon sx={{ fontSize: '16px' }} />} label="Receive" onClick={(event) => setQrAnchorEl(event.currentTarget)} theme={theme} />
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
                  <Box sx={{ ...dashboardPanelSx(theme), borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 20px', width: '100%' }} onMouseMove={handleDashboardPanelPointerMove} onMouseLeave={handleDashboardPanelPointerLeave}>
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
                    <Box sx={{ alignSelf: 'center', bgcolor: theme.palette.background.default, borderRadius: '50px', display: 'flex', gap: '4px', justifyContent: 'center', minWidth: 'fit-content', padding: '4px' }}>
                      {([
                        { key: 'requests' as ActivityTab, label: t('group:join_requests', { postProcess: 'capitalizeFirstChar' }), count: requestsCount, countLoading: requestsCountLoading },
                        { key: 'promotions' as ActivityTab, label: t('group:group.promotions', { postProcess: 'capitalizeFirstChar' }), count: promotionsCount, countLoading: false },
                        { key: 'invites' as ActivityTab, label: t('group:group.invites', { postProcess: 'capitalizeFirstChar' }), count: invitesCount, countLoading: invitesCountLoading },
                      ]).map(({ key, label, count, countLoading }) => (
                        <ButtonBase key={key} onClick={() => setActivityTab(key)} sx={{ bgcolor: activityTab === key ? theme.palette.primary.main : 'transparent', borderRadius: '50px', color: activityTab === key ? theme.palette.primary.contrastText : theme.palette.text.secondary, fontSize: '0.82rem', fontWeight: activityTab === key ? 600 : 400, px: 2, py: 0.8, textTransform: 'none', whiteSpace: 'nowrap', '&:hover': { bgcolor: activityTab === key ? theme.palette.primary.dark : theme.palette.action.hover } }}>
                          {label}
                          {countLoading ? <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', ml: '6px' }}><CircularProgress size={14} thickness={4} sx={{ color: activityTab === key ? 'rgba(255,255,255,0.9)' : theme.palette.primary.contrastText }} /></Box> : count > 0 ? <Box component="span" sx={{ bgcolor: activityTab === key ? 'rgba(255,255,255,0.25)' : theme.palette.primary.main, borderRadius: '50px', color: theme.palette.primary.contrastText, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, height: '18px', lineHeight: 1, ml: '6px', minWidth: '18px', px: '6px' }}>{count}</Box> : null}
                        </ButtonBase>
                      ))}
                    </Box>
                    <Box sx={{ display: activityTab === 'requests' ? 'block' : 'none' }}>
                      <GroupJoinRequests compact onCountChange={setRequestsCount} onLoadingChange={setRequestsCountLoading} setGroupSection={setGroupSection} setSelectedGroup={setSelectedGroup} getTimestampEnterChat={getTimestampEnterChat} setOpenManageMembers={setOpenManageMembers} myAddress={myAddress} groups={groups} setMobileViewMode={setMobileViewMode} setDesktopViewMode={setDesktopViewMode} />
                    </Box>
                    <Box sx={{ display: activityTab === 'invites' ? 'block' : 'none' }}>
                      <GroupInvites compact onCountChange={setInvitesCount} onLoadingChange={setInvitesCountLoading} setOpenAddGroup={setOpenAddGroup} myAddress={myAddress} />
                    </Box>
                    <Box sx={{ display: activityTab === 'promotions' ? 'block' : 'none' }}>
                      <ListOfGroupPromotions compact onCountChange={setPromotionsCount} />
                    </Box>
                  </Box>
                </>
              )}

              {activeTab === 'developer' && <HomeDeveloperTab {...sharedGroupNavProps} />}
            </Box>

            <Popover open={Boolean(qrAnchorEl)} anchorEl={qrAnchorEl} onClose={() => setQrAnchorEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
              <Box sx={{ bgcolor: theme.palette.background.paper, border: `1px solid ${theme.palette.border.subtle}`, borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '12px', p: 2, width: '220px' }}>
                <Typography sx={{ color: theme.palette.text.primary, fontSize: '0.9rem', fontWeight: 600, textAlign: 'center' }}>Wallet QR</Typography>
                <Box sx={{ alignItems: 'center', bgcolor: '#ffffff', borderRadius: '12px', display: 'flex', justifyContent: 'center', p: 1.5 }}>
                  <QRCode value={userAddress ?? ''} size={150} level="M" bgColor="#FFFFFF" fgColor="#000000" />
                </Box>
                <Typography sx={{ color: theme.palette.text.secondary, fontFamily: 'monospace', fontSize: '0.72rem', textAlign: 'center', wordBreak: 'break-all' }}>{userAddress ?? '—'}</Typography>
              </Box>
            </Popover>

            <Spacer height="120px" />
          </motion.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
};

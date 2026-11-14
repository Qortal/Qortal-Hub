import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import { alpha, darken } from '@mui/material/styles';
import {
  Activity,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import ErrorBoundary from '../../../common/ErrorBoundary';
import { Spacer } from '../../../common/Spacer';
import { HomeProfileCard } from '../HomeProfileCard';
import { GETTING_STARTED_LS_KEY } from '../gettingStartedStorage';
import {
  HomeQortinoWorkspaceCard,
  QortinoMusicPlaybackController,
} from '../HomeQortinoWorkspaceCard';
import { HomeQuickToolsPad } from '../HomeQuickToolsPad';
import { HomeFeaturedApps } from '../HomeFeaturedApps';
import { useTranslation } from 'react-i18next';
import {
  LazyMotion,
  domAnimation,
  motion,
  useReducedMotion,
} from 'framer-motion';
import { getBaseApiReact } from '../../../App';
import { executeEvent } from '../../../utils/events';
import { openQChatTab } from '../../../utils/openQChatTab';
import {
  dashboardPanelSx,
  useDashboardPanelMouseLight,
} from '../dashboardPanelEffects';
import { DashboardWidgetFrame } from '../../Widgets/DashboardWidgetFrame';
import { GroupsWidget } from '../../Widgets/GroupsWidget';
import { QuitterFeedWidget } from '../../Widgets/QuitterFeedWidget';
import {
  HomeWidgetsPanel,
  canHostHomeWidgets,
} from '../../HomeWidgets/HomeWidgetsPanel';
import { TORQ_APP_NAME } from '../../Widgets/quitter/torqFeed';
import { InfoPreviewPanel } from './InfoPreviewPanel';
import { HomeDesktopWalletActivity } from './HomeDesktopWalletActivity';
import { OnlineUsersBadge } from './OnlineUsersBadge';
import {
  HOME_CUSTOMIZABLE_CARD_MAX_HEIGHTS,
  HOME_CUSTOMIZABLE_CARD_MIN_HEIGHTS,
  HOME_CUSTOMIZABLE_CARD_RESIZE_STEP_PX,
  HOME_DASHBOARD_VERTICAL_GAP_PX,
  HOME_DASHBOARD_WIDGET_DISPLAY_MODE,
  HOME_DASHBOARD_WIDGET_HEIGHT_PX,
  HOME_EMBEDDED_QAPP_PANEL_HEIGHT_PX,
  HOME_GROUP_ACTIVITY_CARD_DEFAULT_HEIGHT_PX,
  HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX,
  HOME_LEFT_CENTER_GRID_TEMPLATE_COLUMNS,
  HOME_LEFT_CENTER_LOWER_ROW_GRID_TEMPLATE_COLUMNS,
  HOME_QUITTER_WIDGET_INITIAL_BATCH_SIZES,
  HOME_QUITTER_WIDGET_LOAD_MORE_BATCH_SIZES,
  HOME_QUITTER_WIDGET_SEARCH_LIMITS,
  HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX,
  HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX,
  HOME_SHARED_SIDE_RAIL_WIDTH_XL,
  HOME_WALLET_ACTIVITY_MIN_HEIGHT_PX,
  HOME_WIDE_DASHBOARD_MIN_WIDTH_PX,
} from './homeDesktopConstants';
import type { HomeLayoutDebugKey, HomeLayoutDebugMetric } from './types';
import { measureHomeLayoutDebugMetric } from './utils';
import { returnToQChat } from './homeNavigation';
import {
  homeQortinoTargetHeight,
  homeStackRows,
  homeWalletTargetHeight,
  isHomePanelShown,
  useHomeLayout,
} from './homeLayout';

export const HomeDesktop = ({
  myAddress,
  setGroupSection,
  setDesktopViewMode,
  desktopViewMode,
  onOpenSettings,
  onOpenQortalLand,
}) => {
  const groupActivityPanelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const groupActivityCardHeightRef = useRef<HTMLDivElement | null>(null);
  const quitterCardHeightRef = useRef<HTMLDivElement | null>(null);
  const homeLayoutDebugRootRef = useRef<HTMLDivElement | null>(null);
  const accountOverviewDebugRef = useRef<HTMLDivElement | null>(null);
  const infoDebugRef = useRef<HTMLDivElement | null>(null);
  const profileCardDebugRef = useRef<HTMLDivElement | null>(null);
  const toolsDebugRef = useRef<HTMLDivElement | null>(null);
  const featuredAppsDebugRef = useRef<HTMLDivElement | null>(null);
  const walletActivityDebugRef = useRef<HTMLDivElement | null>(null);
  const rightRailRef = useRef<HTMLDivElement | null>(null);
  const layoutStabilizeFrameRef = useRef<number | null>(null);
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const [walletActivityTargetHeightPx, setWalletActivityTargetHeightPx] =
    useState<number | null>(null);
  const [qortinoCardTargetHeightPx, setQortinoCardTargetHeightPx] = useState<
    number | null
  >(null);
  const [homeLayout] = useHomeLayout(myAddress);
  const showQortino = isHomePanelShown(homeLayout, 'qortino');
  const showTools = isHomePanelShown(homeLayout, 'tools');
  const showFeatured = isHomePanelShown(homeLayout, 'featured');
  const showStatus = isHomePanelShown(homeLayout, 'status');
  const showWallet = isHomePanelShown(homeLayout, 'wallet');
  const showQortinoColumn = showQortino || showTools;
  const showRightRail = showStatus || showWallet;
  // Measured panels come and go with these, so the measuring starts over.
  const hiddenPanelsKey = homeLayout.hidden.join(',');
  const [groupWidgetRefreshToken, setGroupWidgetRefreshToken] = useState(0);
  const [isGroupWidgetRefreshing, setIsGroupWidgetRefreshing] = useState(false);
  const [quitterWidgetRefreshToken, setQuitterWidgetRefreshToken] = useState(0);
  const [isQuitterWidgetRefreshing, setIsQuitterWidgetRefreshing] =
    useState(false);
  const reduce = useReducedMotion();
  const { t } = useTranslation(['core', 'group', 'auth']);
  const td = useCallback(
    (key: string, defaultValue: string) =>
      t(`group:dashboard.${key}`, { defaultValue }),
    [t]
  );
  const theme = useTheme();
  const isSplitDashboardLayout = useMediaQuery(theme.breakpoints.up('md'));
  const isWideDashboardLayout = useMediaQuery(
    theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)
  );
  const resolvedWideLeftLowerRowPanelHeightPx = isWideDashboardLayout
    ? HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX
    : null;
  const resolvedQortinoCardHeightPx = isSplitDashboardLayout
    ? (qortinoCardTargetHeightPx ?? HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX)
    : null;
  const resolvedWalletActivityHeightPx = isWideDashboardLayout
    ? (walletActivityTargetHeightPx ??
      HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX)
    : null;

  const infoPanelMaxExpandedHeightPx =
    isWideDashboardLayout &&
    showWallet &&
    resolvedWalletActivityHeightPx != null
      ? HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX +
        HOME_DASHBOARD_VERTICAL_GAP_PX +
        resolvedWalletActivityHeightPx +
        2
      : null;
  const handleOpenReceiveQort = useCallback(
    (target: HTMLElement | null) => {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const rightRailRect = isWideDashboardLayout
        ? rightRailRef.current?.getBoundingClientRect()
        : null;
      executeEvent('openReceiveQortInternal', {
        address: myAddress ?? '',
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
    },
    [isWideDashboardLayout, myAddress]
  );
  const assignGroupActivityPanelNode = useCallback(
    (node: HTMLDivElement | null) => {
      groupActivityPanelRef.current = node;
      groupActivityCardHeightRef.current = node;
    },
    [groupActivityPanelRef]
  );

  useLayoutEffect(() => {
    const rootNode = homeLayoutDebugRootRef.current;

    if (!rootNode || desktopViewMode !== 'home') {
      setWalletActivityTargetHeightPx(null);
      return;
    }

    const measureDebugLayout = () => {
      const rootRect = rootNode.getBoundingClientRect();
      const nextMetrics: Partial<
        Record<HomeLayoutDebugKey, HomeLayoutDebugMetric>
      > = {};

      if (accountOverviewDebugRef.current) {
        nextMetrics.accountOverview = measureHomeLayoutDebugMetric(
          accountOverviewDebugRef.current,
          rootRect
        );
      }

      if (infoDebugRef.current) {
        nextMetrics.info = measureHomeLayoutDebugMetric(
          infoDebugRef.current,
          rootRect
        );
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
        const walletMetric = nextMetrics.walletActivity;
        const nextQortinoTargetHeight = homeQortinoTargetHeight({
          featured: nextMetrics.featuredApps,
          gap: HOME_DASHBOARD_VERTICAL_GAP_PX,
          minHeight: HOME_SHARED_LEFT_LOWER_ROW_PANEL_HEIGHT_PX,
          profile: nextMetrics.profileCard,
          tools: nextMetrics.tools,
        });

        setQortinoCardTargetHeightPx((currentHeight) =>
          nextQortinoTargetHeight !== null &&
          currentHeight !== null &&
          Math.abs(currentHeight - nextQortinoTargetHeight) < 0.25
            ? currentHeight
            : nextQortinoTargetHeight
        );

        const leftBottoms = [
          nextMetrics.accountOverview,
          nextMetrics.tools,
          nextMetrics.profileCard,
          nextMetrics.featuredApps,
        ]
          .filter(Boolean)
          .map((metric) => metric.bottom);
        const nextTargetHeight = walletMetric
          ? homeWalletTargetHeight(
              leftBottoms,
              walletMetric.top,
              HOME_WALLET_ACTIVITY_MIN_HEIGHT_PX
            )
          : null;

        setWalletActivityTargetHeightPx((currentHeight) =>
          nextTargetHeight !== null &&
          currentHeight !== null &&
          Math.abs(currentHeight - nextTargetHeight) < 0.25
            ? currentHeight
            : nextTargetHeight
        );
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

    const fonts = (
      document as Document & {
        fonts?: { ready?: Promise<unknown> };
      }
    ).fonts;

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
    desktopViewMode,
    hiddenPanelsKey,
    isOnboardingComplete,
    isWideDashboardLayout,
  ]);

  useEffect(() => {
    if (!myAddress) {
      setIsOnboardingComplete(false);
      return;
    }

    const isComplete =
      localStorage.getItem(`${GETTING_STARTED_LS_KEY}_${myAddress}`) ===
      'completed';
    setIsOnboardingComplete(isComplete);
  }, [myAddress]);

  const handleGettingStartedComplete = useCallback(() => {
    setIsOnboardingComplete(true);
  }, []);

  const handleRefreshGroupActivity = useCallback(() => {
    setGroupWidgetRefreshToken((value) => value + 1);
  }, []);

  const handleRefreshQuitterWidget = useCallback(() => {
    setQuitterWidgetRefreshToken((value) => value + 1);
  }, []);

  const handleOpenAppsPanel = useCallback(() => {
    executeEvent('newTabWindow', {});
    setDesktopViewMode('apps');
  }, [setDesktopViewMode]);
  const handleOpenFeedApp = useCallback(() => {
    executeEvent('addTab', { data: { service: 'APP', name: TORQ_APP_NAME } });
    executeEvent('open-apps-mode', {});
  }, []);
  const handleOpenQChatPanel = useCallback(() => {
    returnToQChat(setGroupSection, openQChatTab);
  }, [setGroupSection]);
  const handleOpenGroupsWidget = useCallback(() => {
    handleOpenQChatPanel();
  }, [handleOpenQChatPanel]);

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
  const quitterWidgetInitialBatchSize =
    HOME_QUITTER_WIDGET_INITIAL_BATCH_SIZES[HOME_DASHBOARD_WIDGET_DISPLAY_MODE];
  const quitterWidgetLoadMoreBatchSize =
    HOME_QUITTER_WIDGET_LOAD_MORE_BATCH_SIZES[
      HOME_DASHBOARD_WIDGET_DISPLAY_MODE
    ];
  const quitterWidgetSearchLimit =
    HOME_QUITTER_WIDGET_SEARCH_LIMITS[HOME_DASHBOARD_WIDGET_DISPLAY_MODE];
  const stackRows = homeStackRows(homeLayout.stack, (id) =>
    id === 'widgets'
      ? isHomePanelShown(homeLayout, 'widgets') && canHostHomeWidgets()
      : isHomePanelShown(homeLayout, id)
  );
  // Wide layout without the Qortino card: Quick Tools moves up beside the
  // account card and Featured Q-Apps takes the whole width under both, rather
  // than leaving the narrow column mostly empty. The two columns' boxes step
  // aside (display: contents) so their panels sit in the grid directly.
  const toolsBesideProfile = isWideDashboardLayout && !showQortino && showTools;
  const rightRailRows = [
    showStatus ? `${HOME_INFO_COLLAPSED_VISIBLE_HEIGHT_PX}px` : null,
    showWallet
      ? resolvedWalletActivityHeightPx != null
        ? `${resolvedWalletActivityHeightPx}px`
        : 'auto'
      : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <LazyMotion features={domAnimation}>
      {/* Keeps Qortino's music playing while its card isn't on screen. */}
      {desktopViewMode !== 'home' || !showQortino ? (
        <QortinoMusicPlaybackController />
      ) : null}
      <Activity mode={desktopViewMode === 'home' ? 'visible' : 'hidden'}>
        <motion.div
          data-tour="hub-home-page"
          key="home"
          initial={{ opacity: 0, scale: 1 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          custom={reduce}
          style={{
            alignItems: 'center',
            display: desktopViewMode === 'home' ? 'flex' : 'none',
            flexDirection: 'column',
            height: '100%',
            overflow: 'auto',
            scrollbarGutter: 'stable',
            width: '100%',
            willChange: 'opacity',
            backfaceVisibility: 'hidden',
          }}
        >
          <Spacer height="20px" />
          <Box
            ref={homeLayoutDebugRootRef}
            sx={{
              alignItems: 'flex-start',
              display: 'flex',
              flexDirection: 'column',
              gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
              maxWidth: '1320px',
              padding: '0 20px',
              position: 'relative',
              width: '100%',
              [theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)]: {
                maxWidth: '1520px',
              },
            }}
          >
            <Box
              sx={{
                alignItems: 'start',
                display: 'grid',
                gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                gridTemplateColumns: '1fr',
                width: '100%',
                [theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)]: {
                  alignItems: 'stretch',
                  gridTemplateColumns: showRightRail
                    ? `minmax(0, 1fr) ${HOME_SHARED_SIDE_RAIL_WIDTH_XL}`
                    : 'minmax(0, 1fr)',
                },
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
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    width: '100%',
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      color: theme.palette.text.secondary,
                      display: 'flex',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      justifyContent: 'space-between',
                      letterSpacing: '0.0605em',
                      minWidth: 0,
                      textTransform: 'uppercase',
                    }}
                  >
                    <Box component="span">Qortal Hub</Box>
                    <OnlineUsersBadge />
                  </Box>
                  {isWideDashboardLayout ? (
                    <Box
                      sx={{
                        alignItems: toolsBesideProfile ? 'stretch' : 'start',
                        display: 'grid',
                        gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                        gridTemplateColumns: showQortinoColumn
                          ? HOME_LEFT_CENTER_GRID_TEMPLATE_COLUMNS.xl
                          : 'minmax(0, 1fr)',
                        width: '100%',
                      }}
                    >
                      {showQortinoColumn ? (
                        <Box
                          sx={{
                            display: toolsBesideProfile ? 'contents' : 'flex',
                            flexDirection: 'column',
                            gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                            minWidth: 0,
                            width: '100%',
                          }}
                        >
                          {showQortino ? (
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
                              {desktopViewMode === 'home' ? (
                                <ErrorBoundary
                                  fallback={qortinoWorkspaceShellFallback}
                                >
                                  <HomeQortinoWorkspaceCard
                                    onGettingStartedComplete={
                                      handleGettingStartedComplete
                                    }
                                    onOpenAppsPanel={handleOpenAppsPanel}
                                  />
                                </ErrorBoundary>
                              ) : null}
                            </Box>
                          ) : null}
                          {showTools ? (
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
                                fillHeight={toolsBesideProfile}
                                onOpenApps={handleOpenAppsPanel}
                                onOpenChat={handleOpenQChatPanel}
                                onOpenQortalLand={onOpenQortalLand}
                                onOpenSettings={onOpenSettings}
                              />
                            </Box>
                          ) : null}
                        </Box>
                      ) : null}
                      <Box
                        sx={{
                          display: toolsBesideProfile ? 'contents' : 'flex',
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
                        {showFeatured ? (
                          <Box
                            ref={featuredAppsDebugRef}
                            sx={{
                              display: 'flex',
                              gridColumn: toolsBesideProfile
                                ? '1 / -1'
                                : undefined,
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
                        ) : null}
                      </Box>
                    </Box>
                  ) : (
                    <>
                      <Box
                        sx={{
                          display: 'grid',
                          gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                          gridTemplateColumns: showQortino
                            ? HOME_LEFT_CENTER_LOWER_ROW_GRID_TEMPLATE_COLUMNS
                            : '1fr',
                          alignItems: 'stretch',
                          width: '100%',
                        }}
                      >
                        {showQortino ? (
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
                            {desktopViewMode === 'home' ? (
                              <ErrorBoundary
                                fallback={qortinoWorkspaceShellFallback}
                              >
                                <HomeQortinoWorkspaceCard
                                  onGettingStartedComplete={() => {
                                    setIsOnboardingComplete(true);
                                  }}
                                  onOpenAppsPanel={handleOpenAppsPanel}
                                />
                              </ErrorBoundary>
                            ) : null}
                          </Box>
                        ) : null}
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
                      </Box>
                      {showTools || showFeatured ? (
                        <Box
                          sx={{
                            display: 'grid',
                            gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                            gridTemplateColumns:
                              showTools && showFeatured
                                ? HOME_LEFT_CENTER_LOWER_ROW_GRID_TEMPLATE_COLUMNS
                                : '1fr',
                            alignItems: 'stretch',
                            width: '100%',
                          }}
                        >
                          {showTools ? (
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
                                onOpenQortalLand={onOpenQortalLand}
                                onOpenSettings={onOpenSettings}
                              />
                            </Box>
                          ) : null}
                          {showFeatured ? (
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
                          ) : null}
                        </Box>
                      ) : null}
                    </>
                  )}
                </Box>
              </Box>
              {showRightRail ? (
                <Box
                  ref={rightRailRef}
                  data-home-right-rail=""
                  sx={{
                    alignContent: 'start',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                    minWidth: 0,
                    [theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)]: {
                      display: 'grid',
                      gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                      gridTemplateRows: rightRailRows,
                      marginTop: `${HOME_RIGHT_RAIL_TOP_ALIGNMENT_OFFSET_PX}px`,
                    },
                  }}
                >
                  {showStatus ? (
                    <Box
                      ref={infoDebugRef}
                      sx={{
                        minWidth: 0,
                        position: 'relative',
                        width: '100%',
                        '& > *': { height: '100%' },
                      }}
                    >
                      <InfoPreviewPanel
                        maxExpandedHeightPx={infoPanelMaxExpandedHeightPx}
                      />
                    </Box>
                  ) : null}
                  {showWallet ? (
                    <Box
                      ref={walletActivityDebugRef}
                      sx={{
                        maxWidth: { xs: '100%', md: '360px' },
                        position: 'relative',
                        width: '100%',
                        minHeight: '182px',
                        height:
                          resolvedWalletActivityHeightPx != null
                            ? `${resolvedWalletActivityHeightPx}px`
                            : undefined,
                        '& > *': { height: '100%' },
                      }}
                    >
                      <HomeDesktopWalletActivity />
                    </Box>
                  ) : null}
                </Box>
              ) : null}
            </Box>

            {stackRows.map((row) =>
              row[0] === 'widgets' ? (
                <ErrorBoundary fallback={null} key="widgets">
                  <HomeWidgetsPanel active={desktopViewMode === 'home'} />
                </ErrorBoundary>
              ) : (
                <Box
                  key={row.join('+')}
                  sx={{
                    alignItems: 'start',
                    display: 'grid',
                    gap: `${HOME_DASHBOARD_VERTICAL_GAP_PX}px`,
                    gridTemplateColumns: '1fr',
                    width: '100%',
                    [theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)]: {
                      gridTemplateColumns:
                        row.length === 2 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
                    },
                  }}
                >
                  {row.map((id) =>
                    id === 'groupActivity' ? (
                      <DashboardWidgetFrame
                        key="groupActivity"
                        actionIcon={
                          <ForumRoundedIcon sx={{ fontSize: '0.86rem' }} />
                        }
                        actionLabel={td('open_in_q_chat', 'Open in Q-Chat')}
                        height={HOME_DASHBOARD_WIDGET_HEIGHT_PX}
                        onAction={handleOpenGroupsWidget}
                        onRefresh={handleRefreshGroupActivity}
                        panelRef={assignGroupActivityPanelNode}
                        refreshing={isGroupWidgetRefreshing}
                        title={t('group:home.group_activity', {
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
                    ) : (
                      <DashboardWidgetFrame
                        key="feed"
                        actionIcon={
                          <OpenInNewRoundedIcon sx={{ fontSize: '0.86rem' }} />
                        }
                        actionLabel={td('open_in_q_apps', 'Open in Q-Apps')}
                        height={HOME_DASHBOARD_WIDGET_HEIGHT_PX}
                        onAction={handleOpenFeedApp}
                        onRefresh={handleRefreshQuitterWidget}
                        panelRef={quitterCardHeightRef}
                        refreshing={isQuitterWidgetRefreshing}
                        title={td('torq_feed', 'Torq Feed')}
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
                    )
                  )}
                </Box>
              )
            )}
          </Box>
          <Spacer height="120px" />
        </motion.div>
      </Activity>
    </LazyMotion>
  );
};

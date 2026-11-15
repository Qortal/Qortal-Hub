import { Box, Typography, useTheme } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { alpha } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import { Activity, useCallback, useMemo, useState } from 'react';
import ErrorBoundary from '../../../common/ErrorBoundary';
import { Spacer } from '../../../common/Spacer';
import { HomeProfileCard } from '../HomeProfileCard';
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
import { HomeWidgetPicker } from '../../HomeWidgets/HomeWidgetPicker';
import { HomeWidgetWindow } from '../../HomeWidgets/HomeWidgetWindow';
import {
  HOME_WIDGET_LIMIT,
  savedHomeWidgetsAtom,
} from '../../HomeWidgets/homeWidgets';
import { TORQ_APP_NAME } from '../../Widgets/quitter/torqFeed';
import { InfoPreviewPanel } from './InfoPreviewPanel';
import { HomeDesktopWalletActivity } from './HomeDesktopWalletActivity';
import { OnlineUsersBadge } from './OnlineUsersBadge';
import {
  HOME_DASHBOARD_WIDGET_DISPLAY_MODE,
  HOME_QUITTER_WIDGET_INITIAL_BATCH_SIZES,
  HOME_QUITTER_WIDGET_LOAD_MORE_BATCH_SIZES,
  HOME_QUITTER_WIDGET_SEARCH_LIMITS,
} from './homeDesktopConstants';
import { returnToQChat } from './homeNavigation';
import {
  type HomePanelId,
  homeLayoutGrid,
  isHomePanelShown,
  useHomeLayout,
  withHomeGrid,
  withHomePanelShown,
  withHomeWidgetWindow,
  withHomeWidgetWindowHeight,
  withoutHomeWidgetWindow,
} from './homeLayout';
import {
  HOME_WINDOW_IDS,
  type HomeFixedWindowId,
  homeWidgetWindowId,
  isHomeWidgetWindowId,
} from './homeGrid';
import { HomeGrid, type HomeGridWindow } from './HomeGrid';
import { homeWalletRailRect, useHomeWindowTitles } from './homeWindows';

export const HomeDesktop = ({
  myAddress,
  setGroupSection,
  setDesktopViewMode,
  desktopViewMode,
  onOpenSettings,
  onOpenQortalLand,
}) => {
  const groupActivityPanelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const [homeLayout, updateHomeLayout] = useHomeLayout(myAddress);
  const isShown = (id: HomePanelId) =>
    isHomePanelShown(homeLayout, id) &&
    (id !== 'widgets' || canHostHomeWidgets());
  const showQortino = isShown('qortino');
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
  const titles = useHomeWindowTitles();
  const homeActive = desktopViewMode === 'home';
  const [isEditingHome, setIsEditingHome] = useState(false);
  const [isWidgetPickerOpen, setIsWidgetPickerOpen] = useState(false);
  const [widgetReloadKeys, setWidgetReloadKeys] = useState<
    Record<string, number>
  >({});
  const canHostWidgets = canHostHomeWidgets();
  // Widgets in windows of their own; the Widgets window keeps the others.
  const widgetWindows = canHostWidgets ? (homeLayout.widgetWindows ?? []) : [];
  const panelWidgets = useAtomValue(savedHomeWidgetsAtom);
  const widgetsOnHome = [...panelWidgets, ...widgetWindows];
  const homeFull = widgetsOnHome.length >= HOME_WIDGET_LIMIT;

  const handleOpenReceiveQort = useCallback(
    (target: HTMLElement | null) => {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      executeEvent('openReceiveQortInternal', {
        address: myAddress ?? '',
        anchorRect: {
          height: rect.height,
          left: rect.left,
          top: rect.top,
          width: rect.width,
        },
        targetRect: homeWalletRailRect(),
      });
    },
    [myAddress]
  );

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

  const content: Record<HomeFixedWindowId, () => React.ReactNode> = {
    account: () => <HomeProfileCard onOpenReceive={handleOpenReceiveQort} />,
    qortino: () =>
      homeActive ? (
        <ErrorBoundary fallback={qortinoWorkspaceShellFallback}>
          <HomeQortinoWorkspaceCard onOpenAppsPanel={handleOpenAppsPanel} />
        </ErrorBoundary>
      ) : null,
    tools: () => (
      <HomeQuickToolsPad
        fillHeight
        onOpenApps={handleOpenAppsPanel}
        onOpenChat={handleOpenQChatPanel}
        onOpenQortalLand={onOpenQortalLand}
        onOpenSettings={onOpenSettings}
      />
    ),
    featured: () => <HomeFeaturedApps />,
    status: () => <InfoPreviewPanel />,
    wallet: () => <HomeDesktopWalletActivity />,
    widgets: () => (
      <ErrorBoundary fallback={null}>
        <HomeWidgetsPanel active={homeActive} elsewhere={widgetWindows} />
      </ErrorBoundary>
    ),
    groupActivity: () => (
      <DashboardWidgetFrame
        actionIcon={<ForumRoundedIcon sx={{ fontSize: '0.86rem' }} />}
        actionLabel={td('open_in_q_chat', 'Open in Q-Chat')}
        onAction={handleOpenQChatPanel}
        onRefresh={handleRefreshGroupActivity}
        panelRef={groupActivityPanelRef}
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
    ),
    feed: () => (
      <DashboardWidgetFrame
        actionIcon={<OpenInNewRoundedIcon sx={{ fontSize: '0.86rem' }} />}
        actionLabel={td('open_in_q_apps', 'Open in Q-Apps')}
        onAction={handleOpenFeedApp}
        onRefresh={handleRefreshQuitterWidget}
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
    ),
  };
  const widgetWindowEntries: HomeGridWindow[] = widgetWindows.map(
    (widget, index) => {
      const id = homeWidgetWindowId(widget);
      return {
        actions: [
          {
            icon: <OpenInNewRoundedIcon sx={{ fontSize: 16 }} />,
            label: t('group:home_widgets.open_app', {
              name: widget.name,
              postProcess: 'capitalizeFirstChar',
            }),
            onClick: () => {
              executeEvent('addTab', {
                data: { service: 'APP', name: widget.name },
              });
              executeEvent('open-apps-mode', {});
            },
          },
          {
            icon: <RefreshRoundedIcon sx={{ fontSize: 16 }} />,
            label: t('group:home_widgets.reload', {
              postProcess: 'capitalizeFirstChar',
            }),
            onClick: () =>
              setWidgetReloadKeys((current) => ({
                ...current,
                [id]: (current[id] ?? 0) + 1,
              })),
          },
          {
            icon: <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />,
            label: t('group:home_widgets.remove', {
              postProcess: 'capitalizeFirstChar',
            }),
            onClick: () =>
              updateHomeLayout((current) =>
                withoutHomeWidgetWindow(current, id)
              ),
          },
        ],
        id,
        node: (
          <ErrorBoundary fallback={null}>
            <HomeWidgetWindow
              active={homeActive}
              interactive={!isEditingHome}
              loadDelayMs={index * 250}
              onAskHeight={(heightPx) =>
                updateHomeLayout((current) =>
                  withHomeWidgetWindowHeight(current, id, heightPx)
                )
              }
              reloadKey={widgetReloadKeys[id] ?? 0}
              widget={widget}
            />
          </ErrorBoundary>
        ),
        title: widget.title ?? widget.name,
      };
    }
  );
  const windows: HomeGridWindow[] = [
    ...HOME_WINDOW_IDS.filter((id) => id === 'account' || isShown(id)).map(
      (id) => ({ id, node: content[id](), title: titles[id] })
    ),
    ...widgetWindowEntries,
  ];
  const hiddenWindows = HOME_WINDOW_IDS.filter(
    (id) =>
      id !== 'account' &&
      !isShown(id) &&
      (id !== 'widgets' || canHostHomeWidgets())
  ).map((id) => ({ id, title: titles[id] }));
  const grid = useMemo(() => homeLayoutGrid(homeLayout), [homeLayout]);
  const headerLabelSx = {
    color: theme.palette.text.secondary,
    fontSize: '0.74rem',
    fontWeight: 700,
    letterSpacing: '0.0605em',
    textTransform: 'uppercase',
  } as const;

  return (
    <LazyMotion features={domAnimation}>
      {/* Keeps Qortino's music playing while its card isn't on screen. */}
      {!homeActive || !showQortino ? <QortinoMusicPlaybackController /> : null}
      <Activity mode={homeActive ? 'visible' : 'hidden'}>
        <motion.div
          data-tour="hub-home-page"
          key="home"
          initial={{ opacity: 0, scale: 1 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          custom={reduce}
          style={{
            alignItems: 'center',
            display: homeActive ? 'flex' : 'none',
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
            sx={{
              maxWidth: '1520px',
              padding: '0 20px',
              width: '100%',
            }}
          >
            <HomeGrid
              active={homeActive}
              addWidget={
                canHostWidgets
                  ? {
                      description: homeFull
                        ? t('group:home_widgets.limit', {
                            max: HOME_WIDGET_LIMIT,
                          })
                        : t('group:dashboard.add_widget_window_desc'),
                      disabled: homeFull,
                      onAdd: () => setIsWidgetPickerOpen(true),
                    }
                  : undefined
              }
              grid={grid}
              headerEnd={
                <Box sx={headerLabelSx}>
                  <OnlineUsersBadge />
                </Box>
              }
              headerStart={
                <Box component="span" sx={headerLabelSx}>
                  Qortal Hub
                </Box>
              }
              hiddenWindows={hiddenWindows}
              onChangeGrid={(next) =>
                updateHomeLayout((current) => withHomeGrid(current, next))
              }
              onEditingChange={setIsEditingHome}
              onHideWindow={(id) => {
                if (id === 'account') return;
                if (isHomeWidgetWindowId(id)) {
                  // A widget's window is removed, not hidden.
                  updateHomeLayout((current) =>
                    withoutHomeWidgetWindow(current, id)
                  );
                  return;
                }
                updateHomeLayout((current) =>
                  withHomePanelShown(current, id, false)
                );
              }}
              onResetGrid={() =>
                updateHomeLayout((current) => ({ ...current, grid: undefined }))
              }
              onShowWindow={(id) => {
                if (id === 'account' || isHomeWidgetWindowId(id)) return;
                updateHomeLayout((current) =>
                  withHomePanelShown(current, id, true)
                );
              }}
              windows={windows}
            />
            {canHostWidgets ? (
              <HomeWidgetPicker
                added={widgetsOnHome}
                onAdd={(listing) => {
                  updateHomeLayout((current) =>
                    withHomeWidgetWindow(current, listing)
                  );
                  setIsWidgetPickerOpen(false);
                }}
                onClose={() => setIsWidgetPickerOpen(false)}
                open={isWidgetPickerOpen}
              />
            ) : null}
          </Box>
          <Spacer height="120px" />
        </motion.div>
      </Activity>
    </LazyMotion>
  );
};

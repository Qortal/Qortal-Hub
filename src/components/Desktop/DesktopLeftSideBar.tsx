import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  alpha,
  Box,
  ButtonBase,
  Divider,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { HomeIcon } from '../../assets/Icons/HomeIcon';
import { AppsIcon } from '../../assets/Icons/AppsIcon';
import { MessagingIconFilled } from '../../assets/Icons/MessagingIconFilled';
import qortalLogoOfficial from '../../assets/sidebar/qortal-logo-official.webp';
import qortalLogoMinting from '../../assets/sidebar/qortal-logo-official-minting.webp';
import { coreInfoSurfaceSx } from './coreInfoSurface';
import { NodeStateLogo } from './NodeStateLogo';
import { useNodeState } from './nodeState';
import { SidePanelAppIcon } from './SidePanelAppIcon';
import { SidePanelEditor } from './SidePanelEditor';
import {
  isSidePanelItemShown,
  SIDE_PANEL_DEFAULT,
  type SidePanelItem,
  useSidePanelSettings,
} from './sidePanel';
import {
  enabledDevModeAtom,
  hasUnreadGroupsAtom,
  isNewTabWindowAtom,
  supportChatOpenAtom,
  userInfoAtom,
} from '../../atoms/global';
import { keyframes } from '@mui/material/styles';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { openQChatTab, QCHAT_INTERNAL_TAB_ID } from '../../utils/openQChatTab';
import { CoreSyncStatus } from '../CoreSyncStatus';
import LanguageSelector from '../Language/LanguageSelector';
import ThemeSelector from '../Theme/ThemeSelector';

type DesktopSideBarProps = {
  desktopViewMode: string;
  goToHome: any;
  hasUnreadDirects: any;
  isApps: boolean;
  setAppsModeDev: Dispatch<SetStateAction<string>>;
  setDesktopViewMode: (mode: string) => void;
  isDirects?: any;
  isGroups?: any;
  lastQappViewMode?: any;
  mode?: any;
  setDesktopSideView?: any;
  setMode?: any;
  toggleSideViewDirects?: any;
  toggleSideViewGroups?: any;
};

const SIDEBAR_WIDTH_PX = 72;
const EDGE_SENSOR_WIDTH_PX = 8;
/** How much taller the edge's hover sensor is than the handle. */
const EDGE_SENSOR_EXTRA_PX = 28;
const TRIGGER_WIDTH_PX = 10;
const TRIGGER_HEIGHT_PX = SIDE_PANEL_DEFAULT.handleHeight;
const ITEM_WIDTH_PX = 56;
const ITEM_MIN_HEIGHT_PX = 58;
const ICON_WRAP_SIZE_PX = 40;
const ICON_SIZE_PX = 24;
const ITEM_GAP_PX = 6;
const ITEM_PADDING_Y = 1;
const OVERLAY_TRANSITION = '200ms cubic-bezier(0.2, 0, 0, 1)';
const SIDEBAR_OPEN_DELAY_MS = 0;
const SIDEBAR_CLOSE_DELAY_MS = 140;
const SIDEBAR_NUDGE_POSITION_KEY = 'qortal-hub-sidebar-nudge-top-v1';
/** Menus, dialogs and tooltips, which open in portals outside the panel. */
const SIDEBAR_POPUPS = '.MuiModal-root, .MuiPopper-root';

export const clampSidebarNudgeTop = (
  value: number,
  viewportHeight: number,
  height = TRIGGER_HEIGHT_PX
) =>
  Math.max(
    0,
    Math.min(
      Math.max(0, viewportHeight - height),
      Number.isFinite(value) ? value : 0
    )
  );

const readSidebarNudgeTop = (height = TRIGGER_HEIGHT_PX) => {
  if (typeof window === 'undefined') return 0;
  try {
    const savedValue = window.localStorage.getItem(
      SIDEBAR_NUDGE_POSITION_KEY
    );
    if (savedValue !== null) {
      const saved = Number(savedValue);
      if (Number.isFinite(saved)) {
        return clampSidebarNudgeTop(saved, window.innerHeight, height);
      }
    }
  } catch {
    // The nudge remains movable for this session when storage is unavailable.
  }
  return clampSidebarNudgeTop(
    (window.innerHeight - height) / 2,
    window.innerHeight,
    height
  );
};

const persistSidebarNudgeTop = (value: number) => {
  try {
    window.localStorage.setItem(
      SIDEBAR_NUDGE_POSITION_KEY,
      String(Math.round(value))
    );
  } catch {
    // The current position remains active for this session.
  }
};

const pulse = keyframes`
  0%, 100% {
    transform: translateY(-50%) scale(1);
    opacity: 1;
  }
  50% {
    transform: translateY(-50%) scale(1.3);
    opacity: 0.6;
  }
`;

const DevModeIcon = ({
  color = 'currentColor',
  height = 24,
  width = 24,
}: {
  color?: string;
  height?: number;
  width?: number;
}) => {
  const dotRadius = 2.3;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="12" cy="3.5" r={dotRadius} fill={color} />
      <circle cx="3.5" cy="12" r={dotRadius} fill={color} />
      <circle cx="12" cy="12" r={dotRadius} fill={color} />
      <circle cx="20.5" cy="12" r={dotRadius} fill={color} />
      <circle cx="12" cy="20.5" r={dotRadius} fill={color} />
    </svg>
  );
};

const SidebarItem = ({
  active = false,
  children,
  isInfo = false,
  dataTheme,
  itemClassName,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  isInfo?: boolean;
  dataTheme?: string;
  itemClassName?: string;
  label: string;
  onClick?: () => void;
}) => {
  const theme = useTheme();
  const content = (
    <>
      <Box
        className="sidebarItemIconWrap"
        sx={{
          alignItems: 'center',
          display: 'flex',
          height: ICON_WRAP_SIZE_PX,
          justifyContent: 'center',
          width: ICON_WRAP_SIZE_PX,
        }}
      >
        {children}
      </Box>
      <Typography
        className="sidebarItemLabel"
        sx={{
          color: 'inherit',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.01em',
          lineHeight: 1,
          textAlign: 'center',
        }}
      >
        {label}
      </Typography>
    </>
  );

  const sharedSx = {
    alignItems: 'center',
    backgroundColor: active
      ? alpha(
          theme.palette.action.selected,
          theme.palette.mode === 'dark' ? 0.78 : 0.88
        )
      : 'transparent',
    borderRadius: '14px',
    color: active ? theme.palette.text.primary : theme.palette.text.secondary,
    display: 'flex',
    flexDirection: 'column',
    gap: `${ITEM_GAP_PX}px`,
    justifyContent: 'flex-start',
    minHeight: `${ITEM_MIN_HEIGHT_PX}px`,
    py: ITEM_PADDING_Y,
    transition:
      'background-color 180ms ease, color 180ms ease, box-shadow 140ms ease, transform 120ms ease',
    width: `${ITEM_WIDTH_PX}px`,
    '& .sidebarItemIconWrap': {
      transition: 'transform 150ms ease, color 180ms ease, opacity 180ms ease',
    },
    '& .sidebarItemLabel': {
      transition: 'color 180ms ease, opacity 180ms ease',
    },
    ...((onClick || isInfo) && {
      '&:hover': {
        backgroundColor: theme.palette.action.hover,
        color: theme.palette.text.primary,
        boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.border.main, 0.18)}, inset 0 1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.12)}`,
        '& .sidebarItemIconWrap': {
          transform: 'translateY(-1px)',
        },
      },
      '&:active': {
        transform: 'translateY(0)',
      },
    }),
    '&:focus-visible': {
      backgroundColor: alpha(
        theme.palette.action.hover,
        theme.palette.mode === 'dark' ? 0.72 : 0.82
      ),
      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.border.main, 0.22)}, inset 0 1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.03 : 0.12)}`,
      color: theme.palette.text.primary,
      '& .sidebarItemIconWrap': {
        transform: 'translateY(-1px)',
      },
    },
    ...(active && {
      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.light, 0.14)}, inset 0 1px 0 ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.02 : 0.1)}`,
    }),
  } as const;

  if (!onClick) {
    return (
      <Box className={itemClassName} data-theme={dataTheme} sx={sharedSx}>
        {content}
      </Box>
    );
  }

  return (
    <ButtonBase
      className={itemClassName}
      data-theme={dataTheme}
      disableRipple
      onClick={onClick}
      sx={sharedSx}
    >
      {content}
    </ButtonBase>
  );
};

export const DesktopSideBar = ({
  goToHome,
  hasUnreadDirects,
  isApps,
  setDesktopViewMode,
  desktopViewMode,
  setAppsModeDev,
}: DesktopSideBarProps) => {
  const isEnabledDevMode = useAtomValue(enabledDevModeAtom);
  const setIsNewTabWindow = useSetAtom(isNewTabWindowAtom);
  const hasUnreadGroups = useAtomValue(hasUnreadGroupsAtom);
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const nodeState = useNodeState();
  const address = useAtomValue(userInfoAtom)?.address;
  const [panel, updatePanel] = useSidePanelSettings(address);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  // Always open: beside the content, which makes room for it.
  const alwaysOpen = panel.show === 'always';
  const [isVisible, setIsVisible] = useState(false);
  const shown = alwaysOpen || isVisible || isEditorOpen;
  const [selectedAppsTab, setSelectedAppsTab] = useState<any>(null);
  const [isInfoActive, setIsInfoActive] = useState(false);
  const [isDraggingNudge, setIsDraggingNudge] = useState(false);
  // The buttons, a bit smaller or bigger, and the panel's width with them.
  const buttonSize = panel.buttonSize;
  const panelWidth = Math.round(SIDEBAR_WIDTH_PX * buttonSize);
  const handleHeight = panel.handleHeight;
  // Without the handle, the whole left edge opens the panel.
  const edgeHandle = panel.edgeHandle;
  const [nudgeTop, setNudgeTop] = useState(() =>
    readSidebarNudgeTop(handleHeight)
  );
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? 0 : window.innerHeight
  );
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const nudgeTopRef = useRef(nudgeTop);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const nudgeDragRef = useRef<{
    offsetY: number;
    pointerId: number;
  } | null>(null);
  const hasUnreadChat = hasUnreadDirects || hasUnreadGroups;
  const effectiveUnreadChat = hasUnreadChat;
  const isQChatActive =
    desktopViewMode === 'apps' &&
    selectedAppsTab?.internal === QCHAT_INTERNAL_TAB_ID;

  const unreadAccent = useMemo(
    () =>
      theme.palette.mode === 'dark'
        ? 'rgba(255, 110, 140, 0.9)'
        : 'rgba(235, 95, 125, 0.92)',
    [theme.palette.mode]
  );

  const sidebarSurfaceColor =
    theme.palette.mode === 'dark'
      ? 'rgb(36, 39, 45)'
      : theme.palette.background.paper;
  const sidebarSurfaceShadow =
    theme.palette.mode === 'dark'
      ? '8px 0 18px rgba(0, 0, 0, 0.12)'
      : '6px 0 14px rgba(0,0,0,0.04)';

  useEffect(() => {
    const handleTabsToNav = (e: CustomEvent) => {
      setSelectedAppsTab(e.detail?.data?.selectedTab || null);
    };

    subscribeToEvent('setTabsToNav', handleTabsToNav);
    return () => {
      unsubscribeFromEvent('setTabsToNav', handleTabsToNav);
    };
  }, []);

  const alwaysOpenRef = useRef(alwaysOpen);
  alwaysOpenRef.current = alwaysOpen;
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
  const handleHeightRef = useRef(handleHeight);
  // Over the content: the Apps tab strip moves aside for it. Always open,
  // it isn't over anything.
  const emitOverlayState = (nextVisible: boolean) => {
    const over = nextVisible && !alwaysOpenRef.current;
    executeEvent('sidebarOverlayVisibility', {
      data: {
        isVisible: over,
        width: over ? panelWidthRef.current : 0,
      },
    });
  };
  useEffect(() => {
    if (alwaysOpen) emitOverlayState(false);
    // Only when the mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysOpen]);
  useEffect(() => {
    // Resized while over the content: the tab strip moves aside as far.
    if (isVisible) emitOverlayState(true);
    // Only when the width changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelWidth]);
  useEffect(() => {
    // A taller or shorter handle keeps its middle where it was put.
    const before = handleHeightRef.current;
    handleHeightRef.current = handleHeight;
    if (before === handleHeight) return;
    setNudgeTop((current) => {
      const next = clampSidebarNudgeTop(
        current + (before - handleHeight) / 2,
        window.innerHeight,
        handleHeight
      );
      nudgeTopRef.current = next;
      persistSidebarNudgeTop(next);
      return next;
    });
  }, [handleHeight]);

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

  const showSidebar = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (isVisible || openTimerRef.current !== null) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setIsVisible((prev) => {
        if (!prev) {
          emitOverlayState(true);
        }
        return true;
      });
    }, SIDEBAR_OPEN_DELAY_MS);
  };

  const showSidebarImmediate = () => {
    clearHoverTimers();
    setIsVisible((prev) => {
      if (!prev) {
        emitOverlayState(true);
      }
      return true;
    });
  };

  const hideSidebar = () => {
    if (nudgeDragRef.current) return;
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setIsVisible((prev) => {
        if (prev) {
          emitOverlayState(false);
        }
        return false;
      });
    }, SIDEBAR_CLOSE_DELAY_MS);
  };

  const runSidebarAction = (fn: () => void) => {
    fn();
    if (!alwaysOpen) hideSidebar();
  };

  // Opened by the pointer, the panel closes once the pointer is away from
  // it, its handle and any menu or tooltip it opened. Leaving the panel over
  // its handle, or from a menu, sends the panel itself no mouseleave.
  useEffect(() => {
    if (!isVisible || alwaysOpen) return;
    const onPointerMove = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const isNear =
        !!target &&
        (!!panelRef.current?.contains(target) ||
          !!handleRef.current?.contains(target) ||
          !!target.closest(SIDEBAR_POPUPS));
      if (isNear || closeTimerRef.current !== null) return;
      hideSidebar();
    };
    window.addEventListener('pointermove', onPointerMove);
    return () => window.removeEventListener('pointermove', onPointerMove);
    // hideSidebar works through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, alwaysOpen]);

  useEffect(() => {
    nudgeTopRef.current = nudgeTop;
  }, [nudgeTop]);

  useEffect(() => {
    const onResize = () => {
      const nextHeight = window.innerHeight;
      setViewportHeight(nextHeight);
      setNudgeTop((current) => {
        const next = clampSidebarNudgeTop(
          current,
          nextHeight,
          handleHeightRef.current
        );
        nudgeTopRef.current = next;
        persistSidebarNudgeTop(next);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const finishNudgeDrag = (pointerId: number) => {
    if (nudgeDragRef.current?.pointerId !== pointerId) return;
    nudgeDragRef.current = null;
    setIsDraggingNudge(false);
    persistSidebarNudgeTop(nudgeTopRef.current);
  };

  useEffect(() => {
    emitOverlayState(false);
    return () => {
      clearHoverTimers();
      emitOverlayState(false);
    };
  }, []);

  const background = panel.background;
  const handleFill = panel.handleBackground;
  const isQdnActive = (item: { service: string; name: string }) =>
    desktopViewMode === 'apps' &&
    selectedAppsTab?.service === item.service &&
    typeof selectedAppsTab?.name === 'string' &&
    selectedAppsTab.name.toLowerCase() === item.name.toLowerCase();

  const renderItem = (item: SidePanelItem) => {
    switch (item.kind) {
      case 'home':
        return (
          <Box data-tour="hub-home" key="home">
            <SidebarItem
              active={desktopViewMode === 'home'}
              label={t('core:home', {
                postProcess: 'capitalizeFirstChar',
              })}
              onClick={() => runSidebarAction(goToHome)}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  color:
                    desktopViewMode === 'home'
                      ? theme.palette.text.primary
                      : theme.palette.text.secondary,
                  display: 'flex',
                  height: `${ICON_WRAP_SIZE_PX}px`,
                  justifyContent: 'center',
                  width: `${ICON_WRAP_SIZE_PX}px`,
                }}
              >
                <HomeIcon height={26} width={26} color="currentColor" />
              </Box>
            </SidebarItem>
          </Box>
        );
      case 'apps':
        return (
          <SidebarItem
            active={isApps && !isQChatActive}
            key="apps"
            label={t('core:app_other', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={() =>
              runSidebarAction(() => {
                executeEvent('newTabWindow', {});
                setDesktopViewMode('apps');
              })
            }
          >
            <AppsIcon height={24} color="currentColor" />
          </SidebarItem>
        );
      case 'qchat':
        return (
          <Box key="qchat" sx={{ position: 'relative' }}>
            <SidebarItem
              active={isQChatActive}
              label="Q-Chat"
              onClick={() => runSidebarAction(() => openQChatTab())}
            >
              <MessagingIconFilled height={24} color="currentColor" />
            </SidebarItem>

            {effectiveUnreadChat ? (
              <Box
                className="qChatUnreadDot"
                sx={{
                  position: 'absolute',
                  top: 11,
                  right: 7,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: unreadAccent,
                  boxShadow: `0 0 0 3px ${alpha(unreadAccent, 0.16)}`,
                }}
              />
            ) : null}
          </Box>
        );
      case 'dev':
        return isEnabledDevMode ? (
          <SidebarItem
            active={desktopViewMode === 'dev'}
            key="dev"
            label={t('core:dev_mode', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={() =>
              runSidebarAction(() => {
                setDesktopViewMode('dev');
                setAppsModeDev('home');
                setIsNewTabWindow(false);
              })
            }
          >
            <DevModeIcon height={24} width={24} color="currentColor" />
          </SidebarItem>
        ) : null;
      case 'divider':
        return (
          <Divider
            flexItem
            key="divider"
            sx={{
              borderColor: alpha(theme.palette.text.primary, 0.1),
              flexShrink: 0,
              my: 1.2,
              opacity: 0.8,
            }}
          />
        );
      case 'info':
        return (
          <Tooltip
            // On hover, at once, as the title bar's.
            enterDelay={0}
            enterNextDelay={0}
            key="info"
            onClose={() => setIsInfoActive(false)}
            onOpen={() => setIsInfoActive(true)}
            placement="right"
            slotProps={{ tooltip: { sx: coreInfoSurfaceSx(theme) } }}
            title={<CoreSyncStatus panelOnly />}
          >
            <Box>
              <SidebarItem isInfo label="Info">
                {/* Always mounted: it keeps the P2P health others read. */}
                <CoreSyncStatus
                  iconOnly
                  renderIcon={
                    // Grey on the public node, blue on the user's own,
                    // with its small cube in gold while it mints.
                    <NodeStateLogo
                      alt={t(`core:node_state.${nodeState}`)}
                      highlighted={isInfoActive}
                      mintingSrc={qortalLogoMinting}
                      size={ICON_SIZE_PX}
                      src={qortalLogoOfficial}
                      state={nodeState}
                    />
                  }
                />
              </SidebarItem>
            </Box>
          </Tooltip>
        );
      case 'language':
        return <LanguageSelector key="language" sidebar />;
      case 'theme':
        return <ThemeSelector key="theme" sidebar />;
      default:
        return (
          <SidebarItem
            active={isQdnActive(item)}
            key={`qdn:${item.service}:${item.name}`}
            label={item.name}
            onClick={() =>
              runSidebarAction(() => {
                executeEvent('addTab', {
                  data: { service: item.service, name: item.name },
                });
                executeEvent('open-apps-mode', {});
              })
            }
          >
            <SidePanelAppIcon name={item.name} size={26} />
          </SidebarItem>
        );
    }
  };

  return (
    <>
      {alwaysOpen ? (
        // The panel's room beside the content.
        <Box
          aria-hidden
          sx={{
            flexShrink: 0,
            height: '100%',
            width: `${panelWidth}px`,
          }}
        />
      ) : (
        <Box
          data-side-panel-edge={edgeHandle ? 'handle' : 'edge'}
          onMouseEnter={showSidebar}
          sx={{
            position: 'fixed',
            left: 0,
            // Around the handle, or all along the edge without it.
            ...(edgeHandle
              ? {
                  top: `${clampSidebarNudgeTop(
                    nudgeTop - EDGE_SENSOR_EXTRA_PX / 2,
                    viewportHeight,
                    handleHeight + EDGE_SENSOR_EXTRA_PX
                  )}px`,
                  height: `${handleHeight + EDGE_SENSOR_EXTRA_PX}px`,
                }
              : { top: 0, bottom: 0 }),
            width: `${EDGE_SENSOR_WIDTH_PX}px`,
            opacity: 0,
            pointerEvents: isVisible ? 'none' : 'auto',
            zIndex: 9996,
          }}
        />
      )}

      <Box
        ref={panelRef}
        sx={{
          position: 'fixed',
          left: 0,
          // From the top of the room under the title and navigation bars:
          // Group's wrappers are what fixed boxes here sit in.
          top: 0,
          bottom: 0,
          width: `${panelWidth}px`,
          backgroundColor: alpha(sidebarSurfaceColor, background),
          // A see-through panel blurs what's behind it, so its buttons
          // stay readable.
          backdropFilter:
            background > 0 && background < 1 ? 'blur(10px)' : 'none',
          borderRight: `1px solid ${alpha(theme.palette.border.subtle, background)}`,
          boxShadow:
            background >= 0.5 && !alwaysOpen ? sidebarSurfaceShadow : 'none',
          opacity: shown ? 1 : 0,
          transform: shown ? 'translateX(0)' : 'translateX(-100%)',
          pointerEvents: 'none',
          transition: `transform ${OVERLAY_TRANSITION}, opacity ${OVERLAY_TRANSITION}, box-shadow 200ms ease, background-color 200ms ease`,
          overflow: shown ? 'visible' : 'hidden',
          // Always open, it's part of the page: dialogs and menus go over it.
          zIndex: alwaysOpen ? 1100 : 9998,
        }}
      >
        <Box
          data-side-panel={panel.show}
          onMouseEnter={alwaysOpen ? undefined : showSidebarImmediate}
          onMouseLeave={alwaysOpen ? undefined : hideSidebar}
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${panelWidth}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            // Centred while the buttons fit; from the top, scrolling, when
            // they don't.
            justifyContent: 'safe center',
            overflowX: 'hidden',
            overflowY: 'auto',
            pointerEvents: shown ? 'auto' : 'none',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
            '& > *': { flexShrink: 0 },
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.35,
              px: 1,
              py: 1.5,
              // Every button, the language's and the theme's too, a bit
              // smaller or bigger as the account chose.
              zoom: buttonSize,
              '& > *': { flexShrink: 0 },
            }}
          >
            {panel.items.filter(isSidePanelItemShown).map(renderItem)}
            <Tooltip
              placement="right"
              title={t('core:side_panel.edit', {
                postProcess: 'capitalizeFirstChar',
              })}
            >
              <IconButton
                aria-label={t('core:side_panel.edit', {
                  postProcess: 'capitalizeFirstChar',
                })}
                disabled={!address}
                onClick={() => setIsEditorOpen(true)}
                size="small"
                sx={{ color: theme.palette.text.secondary, mt: 1 }}
              >
                <TuneRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      {panel.items.some(
        (item) => item.kind === 'info' && !isSidePanelItemShown(item)
      ) ? (
        // The node's status, kept while its button is hidden: it keeps the
        // P2P health that Q-Chat and the call widget read.
        <Box aria-hidden sx={{ display: 'none' }}>
          <CoreSyncStatus iconOnly renderIcon={<span />} />
        </Box>
      ) : null}

      <SidePanelEditor
        devMode={!!isEnabledDevMode}
        onChange={updatePanel}
        onClose={() => {
          setIsEditorOpen(false);
          if (!alwaysOpen) hideSidebar();
        }}
        open={isEditorOpen}
        settings={panel}
      />

      {alwaysOpen || !edgeHandle ? null : (
        <Box
          aria-label="Move sidebar handle"
          onMouseEnter={showSidebarImmediate}
          ref={handleRef}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            nudgeDragRef.current = {
              offsetY: event.clientY - nudgeTopRef.current,
              pointerId: event.pointerId,
            };
            setIsDraggingNudge(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            showSidebarImmediate();
          }}
          onPointerMove={(event) => {
            const drag = nudgeDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            event.preventDefault();
            const next = clampSidebarNudgeTop(
              event.clientY - drag.offsetY,
              viewportHeight,
              handleHeight
            );
            nudgeTopRef.current = next;
            setNudgeTop(next);
          }}
          onPointerUp={(event) => finishNudgeDrag(event.pointerId)}
          onPointerCancel={(event) => finishNudgeDrag(event.pointerId)}
          onLostPointerCapture={(event) => finishNudgeDrag(event.pointerId)}
          role="separator"
          sx={{
            // As much of its fill as the account chose; the less, the more
            // its outline shows, until only the outline is left.
            background:
              theme.palette.mode === 'dark'
                ? `rgba(255, 255, 255, ${(isDraggingNudge ? 0.24 : 0.14) * handleFill})`
                : `rgba(17, 24, 39, ${(isDraggingNudge ? 0.2 : 0.12) * handleFill})`,
            borderRadius: '0 10px 10px 0',
            boxShadow:
              theme.palette.mode === 'dark'
                ? `0 0 0 1px rgba(255, 255, 255, ${0.08 + 0.34 * (1 - handleFill)})`
                : `0 0 0 1px rgba(17, 24, 39, ${0.08 + 0.34 * (1 - handleFill)})`,
            cursor: isDraggingNudge ? 'grabbing' : 'grab',
            height: `${handleHeight}px`,
            // Beside the panel while it shows, its editor open too.
            left: shown ? `${panelWidth}px` : 0,
            position: 'fixed',
            touchAction: 'none',
            top: `${nudgeTop}px`,
            transition: isDraggingNudge
              ? 'background 120ms ease'
              : `left ${OVERLAY_TRANSITION}, background 200ms ease, box-shadow 200ms ease`,
            userSelect: 'none',
            width: `${TRIGGER_WIDTH_PX}px`,
            zIndex: 9999,
            '&::after':
              effectiveUnreadChat && !isVisible
                ? {
                    animation: `${pulse} 1.2s ease-out 2`,
                    background: unreadAccent,
                    borderRadius: '50%',
                    boxShadow: `0 0 0 2px ${alpha(unreadAccent, 0.14)}`,
                    content: '""',
                    height: 6,
                    position: 'absolute',
                    right: 2,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 6,
                  }
                : undefined,
          }}
        />
      )}
    </>
  );
};

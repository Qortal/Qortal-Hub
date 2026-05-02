import {
  alpha,
  Box,
  ButtonBase,
  Divider,
  Typography,
  useTheme,
} from '@mui/material';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HomeIcon } from '../../assets/Icons/HomeIcon';
import { AppsIcon } from '../../assets/Icons/AppsIcon';
import { MessagingIconFilled } from '../../assets/Icons/MessagingIconFilled';
import qortalLogoOfficial from '../../assets/sidebar/qortal-logo-official.png';
import { enabledDevModeAtom, hasUnreadGroupsAtom } from '../../atoms/global';
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

const SIDEBAR_WIDTH_PX = 72;
const EDGE_SENSOR_WIDTH_PX = 8;
const EDGE_SENSOR_HEIGHT_PX = 124;
const TRIGGER_WIDTH_PX = 10;
const TRIGGER_HEIGHT_PX = 96;
const ITEM_WIDTH_PX = 56;
const ITEM_MIN_HEIGHT_PX = 58;
const ICON_WRAP_SIZE_PX = 40;
const ICON_SIZE_PX = 24;
const ITEM_GAP_PX = 6;
const ITEM_PADDING_Y = 1;
const OVERLAY_TRANSITION = '200ms cubic-bezier(0.2, 0, 0, 1)';
const SIDEBAR_OPEN_DELAY_MS = 0;
const SIDEBAR_CLOSE_DELAY_MS = 140;

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
}) => {
  const isEnabledDevMode = useAtomValue(enabledDevModeAtom);
  const hasUnreadGroups = useAtomValue(hasUnreadGroupsAtom);
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [isVisible, setIsVisible] = useState(false);
  const [selectedAppsTab, setSelectedAppsTab] = useState<any>(null);
  const [isInfoActive, setIsInfoActive] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
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

  const emitOverlayState = (nextVisible: boolean) => {
    executeEvent('sidebarOverlayVisibility', {
      data: {
        isVisible: nextVisible,
        width: nextVisible ? SIDEBAR_WIDTH_PX : 0,
      },
    });
  };

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
    hideSidebar();
  };

  useEffect(() => {
    emitOverlayState(false);
    return () => {
      clearHoverTimers();
      emitOverlayState(false);
    };
  }, []);

  return (
    <>
      <Box
        onMouseEnter={showSidebar}
        sx={{
          position: 'fixed',
          left: 0,
          top: '50%',
          height: `${EDGE_SENSOR_HEIGHT_PX}px`,
          transform: 'translateY(-50%)',
          width: `${EDGE_SENSOR_WIDTH_PX}px`,
          opacity: 0,
          pointerEvents: isVisible ? 'none' : 'auto',
          zIndex: 9996,
        }}
      />

      <Box
        onMouseEnter={showSidebarImmediate}
        sx={{
          position: 'fixed',
          left: 0,
          top: '50%',
          transform: isVisible
            ? 'translateY(-50%) translateX(-4px)'
            : 'translateY(-50%) translateX(0)',
          width: `${TRIGGER_WIDTH_PX}px`,
          height: `${TRIGGER_HEIGHT_PX}px`,
          borderRadius: '0 10px 10px 0',
          background:
            theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.14)'
              : 'rgba(17, 24, 39, 0.12)',
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 0 0 1px rgba(255,255,255,0.08)'
              : '0 0 0 1px rgba(17,24,39,0.08)',
          opacity: isVisible ? 0 : 1,
          pointerEvents: isVisible ? 'none' : 'auto',
          transition: isVisible
            ? 'opacity 100ms ease, transform 100ms ease, background 200ms ease, box-shadow 200ms ease'
            : 'opacity 120ms ease 110ms, transform 120ms ease 110ms, background 200ms ease, box-shadow 200ms ease',
          zIndex: 9997,
          '&::after':
            effectiveUnreadChat && !isVisible
              ? {
                  content: '""',
                  position: 'absolute',
                  top: '50%',
                  right: 2,
                  transform: 'translateY(-50%)',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: unreadAccent,
                  boxShadow: `0 0 0 2px ${alpha(unreadAccent, 0.14)}`,
                  animation: `${pulse} 1.2s ease-out 2`,
                }
              : undefined,
        }}
      />

      <Box
        sx={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${SIDEBAR_WIDTH_PX}px`,
          backgroundColor: sidebarSurfaceColor,
          borderRight: `1px solid ${theme.palette.border.subtle}`,
          boxShadow: sidebarSurfaceShadow,
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translateX(0)' : 'translateX(-100%)',
          pointerEvents: 'none',
          transition: `transform ${OVERLAY_TRANSITION}, opacity ${OVERLAY_TRANSITION}, box-shadow 200ms ease`,
          overflow: isVisible ? 'visible' : 'hidden',
          zIndex: 9998,
        }}
      >
        <Box
          onMouseEnter={showSidebarImmediate}
          onMouseLeave={hideSidebar}
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${SIDEBAR_WIDTH_PX}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'visible',
            pointerEvents: isVisible ? 'auto' : 'none',
            '& .sidebarItem:hover .sidebarInfoLogo, & .sidebarItem:focus-visible .sidebarInfoLogo, & .sidebarItem.isOpen .sidebarInfoLogo':
              {
                filter: 'grayscale(0) saturate(1) brightness(1) contrast(1)',
                opacity: 1,
              },
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              px: 1,
              width: '100%',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.35,
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <SidebarItem
                active={desktopViewMode === 'home'}
                label={t('core:home', { postProcess: 'capitalizeFirstChar' })}
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

              <SidebarItem
                active={isApps && !isQChatActive}
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

              <Box sx={{ position: 'relative' }}>
                <SidebarItem
                  active={desktopViewMode === 'chat' || isQChatActive}
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

              {isEnabledDevMode ? (
                <SidebarItem
                  active={desktopViewMode === 'dev'}
                  label={t('core:dev_mode', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  onClick={() =>
                    runSidebarAction(() => setDesktopViewMode('dev'))
                  }
                >
                  <DevModeIcon height={24} width={24} color="currentColor" />
                </SidebarItem>
              ) : null}
            </Box>

            <Divider
              flexItem
              sx={{
                borderColor: alpha(theme.palette.text.primary, 0.1),
                my: 1.2,
                opacity: 0.8,
              }}
            />

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.35,
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <Box
                className="tooltip"
                data-theme={theme.palette.mode}
                onMouseEnter={() => setIsInfoActive(true)}
                onMouseLeave={() => setIsInfoActive(false)}
                onFocus={() => setIsInfoActive(true)}
                onBlur={() => setIsInfoActive(false)}
              >
                <SidebarItem
                  dataTheme={theme.palette.mode}
                  itemClassName={`sidebarItem tooltip${isInfoActive ? ' isOpen' : ''}`}
                  isInfo
                  label="Info"
                >
                  <CoreSyncStatus
                    useExternalTooltip
                    renderIcon={
                      <img
                        src={qortalLogoOfficial}
                        alt="Qortal Info"
                        className="sidebarInfoLogo"
                        style={{
                          width: `${ICON_SIZE_PX}px`,
                          height: `${ICON_SIZE_PX}px`,
                          objectFit: 'contain',
                          filter: isInfoActive
                            ? 'grayscale(0) saturate(1) brightness(1) contrast(1)'
                            : 'grayscale(0.82) saturate(0.32) brightness(0.82) contrast(0.9)',
                          opacity: isInfoActive ? 1 : 0.78,
                          transform: isInfoActive ? 'scale(1.02)' : 'scale(1)',
                          transition:
                            'filter 0.2s ease, opacity 0.2s ease, transform 0.2s ease',
                        }}
                      />
                    }
                  />
                </SidebarItem>
              </Box>
              <LanguageSelector sidebar />
              <ThemeSelector sidebar />
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  );
};

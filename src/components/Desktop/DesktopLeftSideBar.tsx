import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Slider,
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
import { executeEvent } from '../../utils/events';
import {
  DASHBOARD_LOGIN_INTRO_PREVIEW_EVENT,
  DASHBOARD_LOGIN_INTRO_PREVIEW_STORAGE_KEY,
  getDashboardLoginIntroModeLabel,
  getNextDashboardLoginIntroMode,
  parseDashboardLoginIntroMode,
  type DashboardLoginIntroMode,
} from '../App/dashboardIntroPreview';
import { CoreSyncStatus } from '../CoreSyncStatus';
import LanguageSelector from '../Language/LanguageSelector';
import ThemeSelector from '../Theme/ThemeSelector';
import {
  DASHBOARD_GETTING_STARTED_DEBUG_EVENT,
  DASHBOARD_GETTING_STARTED_DEBUG_STORAGE_KEY,
  GETTING_STARTED_DEBUG_STEPS,
  parseGettingStartedDebugOverrides,
  type GettingStartedDebugOverrides,
  type GettingStartedDebugStepKey,
} from '../Group/homeGettingStartedDebug';
import {
  areQortinoCompanionDebugSettingsEqual,
  DEFAULT_QORTINO_COMPANION_DEBUG_SETTINGS,
  parseQortinoCompanionDebugSettings,
  QORTINO_COMPANION_DEBUG_EVENT,
  QORTINO_COMPANION_DEBUG_STORAGE_KEY,
  type QortinoCompanionDebugSettings,
} from '../Group/qortinoCompanionDebug';
import {
  areQortinoLookDebugSettingsEqual,
  DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS,
  parseQortinoLookDebugSettings,
  QORTINO_LOOK_DEBUG_EVENT,
  QORTINO_LOOK_DEBUG_STORAGE_KEY,
  type QortinoLookDebugSettings,
} from '../Group/qortinoLookDebug';
import {
  areQortinoLayoutDebugSettingsEqual,
  DEFAULT_QORTINO_LAYOUT_DEBUG_SETTINGS,
  parseQortinoLayoutDebugSettings,
  QORTINO_LAYOUT_DEBUG_EVENT,
  QORTINO_LAYOUT_DEBUG_STORAGE_KEY,
  type QortinoLayoutDebugSettings,
} from '../Group/qortinoLayoutDebug';
import {
  areQortinoInletDebugSettingsEqual,
  DEFAULT_QORTINO_INLET_DEBUG_SETTINGS,
  parseQortinoInletDebugSettings,
  QORTINO_INLET_DEBUG_EVENT,
  QORTINO_INLET_DEBUG_STORAGE_KEY,
  type QortinoInletDebugSettings,
} from '../Snackbar/qortinoInletDebug';

const SIDEBAR_WIDTH_PX = 72;
const EDGE_SENSOR_WIDTH_PX = 12;
const EDGE_SENSOR_TOP_EXCLUSION_PX = 300;
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
type DashboardStatusPreviewMode =
  | 'live'
  | 'syncing'
  | 'local'
  | 'custom'
  | 'issue';
const DASHBOARD_STATUS_PREVIEW_EVENT = 'setDashboardStatusPreview';
const DASHBOARD_STATUS_PREVIEW_STORAGE_KEY = 'dashboardStatusPreviewMode';
const MINTING_LOCAL_DEBUG_STORAGE_KEY = 'hub.mintingLocalDebug';
const DASHBOARD_DEBUG_GOGGLES_VISIBILITY_STORAGE_KEY =
  'hub.dashboardDebugGogglesVisible';
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
  const [debugUnread, setDebugUnread] = useState(false);
  const [showDebugGoggles, setShowDebugGoggles] = useState(() => {
    const saved = localStorage.getItem(
      DASHBOARD_DEBUG_GOGGLES_VISIBILITY_STORAGE_KEY
    );
    return saved == null ? true : saved === '1' || saved === 'true';
  });
  const [debugMinterPreview, setDebugMinterPreview] = useState<'off' | 'on'>(() => {
    const saved = localStorage.getItem('dashboardMinterPreviewMode');
    return saved === 'on' ? 'on' : 'off';
  });
  const [debugGroupsWidget, setDebugGroupsWidget] = useState(() => {
    const saved = localStorage.getItem('hub.groupsWidgetDebug');
    return saved === '1' || saved === 'true';
  });
  const [debugQuitterNewPosts, setDebugQuitterNewPosts] = useState(() => {
    const saved = localStorage.getItem('hub.quitterWidgetNewPostsDebug');
    return saved === '1' || saved === 'true';
  });
  const [debugStatusPreviewMode, setDebugStatusPreviewMode] =
    useState<DashboardStatusPreviewMode>(() =>
      parseDashboardStatusPreviewMode(
        localStorage.getItem(DASHBOARD_STATUS_PREVIEW_STORAGE_KEY)
      )
    );
  const [debugMintingLocal, setDebugMintingLocal] = useState(() => {
    const saved = localStorage.getItem(MINTING_LOCAL_DEBUG_STORAGE_KEY);
    return saved === '1' || saved === 'true';
  });
  const [debugDashboardIntroMode, setDebugDashboardIntroMode] =
    useState<DashboardLoginIntroMode>(() =>
      parseDashboardLoginIntroMode(
        localStorage.getItem(DASHBOARD_LOGIN_INTRO_PREVIEW_STORAGE_KEY)
      )
    );
  const [debugGettingStartedOverrides, setDebugGettingStartedOverrides] =
    useState<GettingStartedDebugOverrides>(() =>
      parseGettingStartedDebugOverrides(
        localStorage.getItem(DASHBOARD_GETTING_STARTED_DEBUG_STORAGE_KEY)
      )
    );
  const [debugQortinoLookSettings, setDebugQortinoLookSettings] =
    useState<QortinoLookDebugSettings>(() =>
      parseQortinoLookDebugSettings(
        localStorage.getItem(QORTINO_LOOK_DEBUG_STORAGE_KEY)
      )
    );
  const [debugQortinoLayoutSettings, setDebugQortinoLayoutSettings] =
    useState<QortinoLayoutDebugSettings>(() =>
      parseQortinoLayoutDebugSettings(
        localStorage.getItem(QORTINO_LAYOUT_DEBUG_STORAGE_KEY)
      )
    );
  const [debugQortinoCompanionSettings, setDebugQortinoCompanionSettings] =
    useState<QortinoCompanionDebugSettings>(() =>
      parseQortinoCompanionDebugSettings(
        localStorage.getItem(QORTINO_COMPANION_DEBUG_STORAGE_KEY)
      )
    );
  const [debugQortinoInletSettings, setDebugQortinoInletSettings] =
    useState<QortinoInletDebugSettings>(() =>
      parseQortinoInletDebugSettings(
        localStorage.getItem(QORTINO_INLET_DEBUG_STORAGE_KEY)
      )
    );
  const [isQortinoLookDialogOpen, setIsQortinoLookDialogOpen] = useState(false);
  const [isQortinoLayoutDialogOpen, setIsQortinoLayoutDialogOpen] =
    useState(false);
  const [isQortinoCompanionDialogOpen, setIsQortinoCompanionDialogOpen] =
    useState(false);
  const [isQortinoInletDialogOpen, setIsQortinoInletDialogOpen] =
    useState(false);
  const [isInfoActive, setIsInfoActive] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const hasUnreadChat = hasUnreadDirects || hasUnreadGroups;
  const effectiveUnreadChat = hasUnreadChat || debugUnread;
  const isLocalPreview =
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' ||
      window.location.hostname === 'localhost');

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

  const debugToggleSx = {
    borderRadius: '10px',
    backgroundColor: alpha(theme.palette.background.paper, 0.94),
    border: `1px solid ${theme.palette.border.subtle}`,
    color: theme.palette.text.primary,
    fontSize: '11px',
    fontWeight: 700,
    px: 1,
    py: 0.6,
    boxShadow:
      theme.palette.mode === 'dark'
        ? '0 6px 16px rgba(0,0,0,0.24)'
        : '0 6px 16px rgba(0,0,0,0.1)',
  } as const;

  const getDebugToggleSx = (active = false) => ({
    ...debugToggleSx,
    backgroundColor: active
      ? alpha(
          theme.palette.primary.main,
          theme.palette.mode === 'dark' ? 0.24 : 0.16
        )
      : debugToggleSx.backgroundColor,
    border: active
      ? `1px solid ${alpha(theme.palette.primary.light, 0.54)}`
      : debugToggleSx.border,
    boxShadow: active
      ? theme.palette.mode === 'dark'
        ? '0 8px 18px rgba(0,0,0,0.28), inset 0 0 0 1px rgba(255,255,255,0.04)'
        : '0 8px 18px rgba(28,36,52,0.14), inset 0 0 0 1px rgba(255,255,255,0.32)'
      : debugToggleSx.boxShadow,
  });

  const emitGettingStartedDebugOverrides = (
    nextOverrides: GettingStartedDebugOverrides,
    resetReplay = false
  ) => {
    setDebugGettingStartedOverrides(nextOverrides);
    localStorage.setItem(
      DASHBOARD_GETTING_STARTED_DEBUG_STORAGE_KEY,
      JSON.stringify(nextOverrides)
    );
    executeEvent(DASHBOARD_GETTING_STARTED_DEBUG_EVENT, {
      data: {
        overrides: nextOverrides,
        resetReplay,
      },
    });
  };

  const toggleGettingStartedDebugStep = (stepKey: GettingStartedDebugStepKey) => {
    emitGettingStartedDebugOverrides({
      ...debugGettingStartedOverrides,
      [stepKey]: !debugGettingStartedOverrides[stepKey],
    });
  };

  const emitQortinoLookDebugSettings = (
    nextSettings: QortinoLookDebugSettings
  ) => {
    setDebugQortinoLookSettings(nextSettings);
    localStorage.setItem(
      QORTINO_LOOK_DEBUG_STORAGE_KEY,
      JSON.stringify(nextSettings)
    );
    executeEvent(QORTINO_LOOK_DEBUG_EVENT, {
      data: {
        settings: nextSettings,
      },
    });
  };

  const updateQortinoLookDebugSetting = (
    key: keyof QortinoLookDebugSettings,
    value: number
  ) => {
    emitQortinoLookDebugSettings({
      ...debugQortinoLookSettings,
      [key]: Math.round(value * 100) / 100,
    });
  };

  const resetQortinoLookDebugSettings = () => {
    emitQortinoLookDebugSettings({ ...DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS });
  };

  const isQortinoLookCustomized = !areQortinoLookDebugSettingsEqual(
    debugQortinoLookSettings,
    DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS
  );

  const emitQortinoLayoutDebugSettings = (
    nextSettings: QortinoLayoutDebugSettings
  ) => {
    setDebugQortinoLayoutSettings(nextSettings);
    localStorage.setItem(
      QORTINO_LAYOUT_DEBUG_STORAGE_KEY,
      JSON.stringify(nextSettings)
    );
    executeEvent(QORTINO_LAYOUT_DEBUG_EVENT, {
      data: {
        settings: nextSettings,
      },
    });
  };

  const updateQortinoLayoutDebugSetting = (
    key: keyof QortinoLayoutDebugSettings,
    value: number
  ) => {
    emitQortinoLayoutDebugSettings({
      ...debugQortinoLayoutSettings,
      [key]: Math.round(value),
    });
  };

  const resetQortinoLayoutDebugSettings = () => {
    emitQortinoLayoutDebugSettings({ ...DEFAULT_QORTINO_LAYOUT_DEBUG_SETTINGS });
  };

  const isQortinoLayoutCustomized = !areQortinoLayoutDebugSettingsEqual(
    debugQortinoLayoutSettings,
    DEFAULT_QORTINO_LAYOUT_DEBUG_SETTINGS
  );

  const emitQortinoCompanionDebugSettings = (
    nextSettings: QortinoCompanionDebugSettings
  ) => {
    setDebugQortinoCompanionSettings(nextSettings);
    localStorage.setItem(
      QORTINO_COMPANION_DEBUG_STORAGE_KEY,
      JSON.stringify(nextSettings)
    );
    executeEvent(QORTINO_COMPANION_DEBUG_EVENT, {
      data: {
        settings: nextSettings,
      },
    });
  };

  const updateQortinoCompanionDebugSetting = (
    key: keyof QortinoCompanionDebugSettings,
    value: number
  ) => {
    emitQortinoCompanionDebugSettings({
      ...debugQortinoCompanionSettings,
      [key]: Math.round(value),
    });
  };

  const resetQortinoCompanionDebugSettings = () => {
    emitQortinoCompanionDebugSettings({
      ...DEFAULT_QORTINO_COMPANION_DEBUG_SETTINGS,
    });
  };

  const isQortinoCompanionCustomized = !areQortinoCompanionDebugSettingsEqual(
    debugQortinoCompanionSettings,
    DEFAULT_QORTINO_COMPANION_DEBUG_SETTINGS
  );

  const emitQortinoInletDebugSettings = (
    nextSettings: QortinoInletDebugSettings
  ) => {
    setDebugQortinoInletSettings(nextSettings);
    localStorage.setItem(
      QORTINO_INLET_DEBUG_STORAGE_KEY,
      JSON.stringify(nextSettings)
    );
    executeEvent(QORTINO_INLET_DEBUG_EVENT, {
      data: {
        settings: nextSettings,
      },
    });
  };

  const updateQortinoInletDebugSetting = (
    key: keyof QortinoInletDebugSettings,
    value: number
  ) => {
    emitQortinoInletDebugSettings({
      ...debugQortinoInletSettings,
      [key]:
        key === 'offsetX' || key === 'offsetY'
          ? Math.round(value)
          : Math.round(value * 100) / 100,
    });
  };

  const resetQortinoInletDebugSettings = () => {
    emitQortinoInletDebugSettings({ ...DEFAULT_QORTINO_INLET_DEBUG_SETTINGS });
  };

  const isQortinoInletCustomized = !areQortinoInletDebugSettingsEqual(
    debugQortinoInletSettings,
    DEFAULT_QORTINO_INLET_DEBUG_SETTINGS
  );

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
          top: `${EDGE_SENSOR_TOP_EXCLUSION_PX}px`,
          bottom: 0,
          width: `${EDGE_SENSOR_WIDTH_PX}px`,
          opacity: 0,
          pointerEvents: isVisible ? 'none' : 'auto',
          zIndex: 9996,
        }}
      />

      <Box
        onMouseEnter={showSidebarImmediate}
        className={!isVisible ? (effectiveUnreadChat ? 'hasUnread' : '') : ''}
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
          '&::after': effectiveUnreadChat && !isVisible
            ? {
                content: '""',
                position: 'absolute',
                top: '50%',
                right: -4,
                transform: 'translateY(-50%)',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: unreadAccent,
                boxShadow: `0 0 0 3px ${alpha(unreadAccent, 0.16)}`,
              }
            : undefined,
          '&.hasUnread': !isVisible
            ? {
                animation: 'sidebarUnreadPulse 2s ease-in-out infinite',
              }
            : undefined,
          '@keyframes sidebarUnreadPulse': {
            '0%': {
              background: 'rgba(255, 110, 140, 0.18)',
              boxShadow: '0 0 0 rgba(255, 110, 140, 0)',
            },
            '50%': {
              background: 'rgba(255, 110, 140, 0.42)',
              boxShadow: '0 0 14px rgba(255, 110, 140, 0.35)',
            },
            '100%': {
              background: 'rgba(255, 110, 140, 0.18)',
              boxShadow: '0 0 0 rgba(255, 110, 140, 0)',
            },
          },
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
            '& .sidebarItem:hover .sidebarInfoLogo, & .sidebarItem:focus-visible .sidebarInfoLogo, & .sidebarItem.isOpen .sidebarInfoLogo': {
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
                active={isApps}
                label={t('core:app_other', { postProcess: 'capitalizeFirstChar' })}
                onClick={() =>
                  runSidebarAction(() => {
                    executeEvent('newTabWindow', {});
                    setDesktopViewMode('apps');
                  })
                }
              >
                <AppsIcon
                  height={24}
                  color="currentColor"
                />
              </SidebarItem>

              <Box sx={{ position: 'relative' }}>
                <SidebarItem
                  active={desktopViewMode === 'chat'}
                  label="Q-Chat"
                  onClick={() =>
                    runSidebarAction(() => setDesktopViewMode('chat'))
                  }
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
                  label={t('core:dev_mode', { postProcess: 'capitalizeFirstChar' })}
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

      <Dialog
        open={isLocalPreview && isQortinoLookDialogOpen}
        onClose={() => setIsQortinoLookDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>QORTINO Look Debug</DialogTitle>
        <DialogContent
          dividers
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.2 }}
        >
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: '0.84rem' }}
          >
            These sliders only affect the local preview. Tune QORTINO&apos;s
            body circle, body width, antenna shape, face, and Qortal mark live.
          </Typography>
          {([
            {
              key: 'bodyScale',
              label: 'Circle Size',
              max: 150,
              min: 70,
            },
            {
              key: 'bodyWidthScale',
              label: 'Circle Width',
              max: 170,
              min: 70,
            },
            {
              key: 'antennaScale',
              label: 'Antenna Size',
              max: 170,
              min: 70,
            },
            {
              key: 'antennaLength',
              label: 'Antenna Length',
              max: 190,
              min: 55,
            },
            {
              key: 'faceScale',
              label: 'Face Size',
              max: 150,
              min: 70,
            },
            {
              key: 'logoScale',
              label: 'Qortal Logo Size',
              max: 170,
              min: 60,
            },
          ] as const).map((control) => (
            <Box key={control.key}>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  justifyContent: 'space-between',
                  mb: 0.5,
                }}
              >
                <Typography
                  sx={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.01em' }}
                >
                  {control.label}
                </Typography>
                <Typography
                  sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem' }}
                >
                  {Math.round(debugQortinoLookSettings[control.key] * 100)}%
                </Typography>
              </Box>
              <Slider
                min={control.min}
                max={control.max}
                step={5}
                value={Math.round(debugQortinoLookSettings[control.key] * 100)}
                onChange={(_, value) =>
                  updateQortinoLookDebugSetting(
                    control.key,
                    (value as number) / 100
                  )
                }
              />
            </Box>
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.25, pt: 1.5 }}>
          <Button
            onClick={resetQortinoLookDebugSettings}
            disabled={!isQortinoLookCustomized}
          >
            Reset
          </Button>
          <Button variant="contained" onClick={() => setIsQortinoLookDialogOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={isLocalPreview && isQortinoLayoutDialogOpen}
        onClose={() => setIsQortinoLayoutDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>QORTINO Layout Debug</DialogTitle>
        <DialogContent
          dividers
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.2 }}
        >
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: '0.84rem' }}
          >
            These sliders only affect the local preview. Tune the separator and
            upper music player spacing without touching the bubble/name/status
            controls below.
          </Typography>
          {([
            { key: 'separatorOffsetY', label: 'Separator Bar', max: 80, min: -80 },
            {
              key: 'musicHeaderOffsetY',
              label: 'Search / Title / Close',
              max: 80,
              min: -80,
            },
            { key: 'prevNextOffsetY', label: 'Prev / Next', max: 80, min: -80 },
            { key: 'vinylOffsetY', label: 'Vinyl + Play', max: 80, min: -80 },
            {
              key: 'titleAuthorOffsetY',
              label: 'Title + Author',
              max: 80,
              min: -80,
            },
            {
              key: 'progressOffsetY',
              label: 'Progress + Time + Repeat',
              max: 80,
              min: -80,
            },
            {
              key: 'nodeStatusOffsetY',
              label: 'Node Status Text',
              max: 80,
              min: -80,
            },
          ] as const).map((control) => (
            <Box key={control.key}>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  justifyContent: 'space-between',
                  mb: 0.5,
                }}
              >
                <Typography
                  sx={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.01em' }}
                >
                  {control.label}
                </Typography>
                <Typography
                  sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem' }}
                >
                  {`${debugQortinoLayoutSettings[control.key] > 0 ? '+' : ''}${
                    debugQortinoLayoutSettings[control.key]
                  }px`}
                </Typography>
              </Box>
              <Slider
                min={control.min}
                max={control.max}
                step={1}
                value={debugQortinoLayoutSettings[control.key]}
                onChange={(_, value) =>
                  updateQortinoLayoutDebugSetting(control.key, value as number)
                }
              />
            </Box>
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.25, pt: 1.5 }}>
          <Button
            onClick={resetQortinoLayoutDebugSettings}
            disabled={!isQortinoLayoutCustomized}
          >
            Reset
          </Button>
          <Button
            variant="contained"
            onClick={() => setIsQortinoLayoutDialogOpen(false)}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={isLocalPreview && isQortinoCompanionDialogOpen}
        onClose={() => setIsQortinoCompanionDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>QORTINO Bubble Debug</DialogTitle>
        <DialogContent
          dividers
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.2 }}
        >
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: '0.84rem' }}
          >
            These sliders only affect the local preview. Tune the QORTINO label,
            status tag, and speech bubble position live.
          </Typography>
          {([
            { key: 'nameOffsetX', label: 'QORTINO X', max: 80, min: -80 },
            { key: 'nameOffsetY', label: 'QORTINO Y', max: 80, min: -80 },
            { key: 'statusOffsetX', label: 'Status X', max: 80, min: -80 },
            { key: 'statusOffsetY', label: 'Status Y', max: 80, min: -80 },
            { key: 'bubbleOffsetX', label: 'Bubble X', max: 80, min: -80 },
            { key: 'bubbleOffsetY', label: 'Bubble Y', max: 80, min: -80 },
          ] as const).map((control) => (
            <Box key={control.key}>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  justifyContent: 'space-between',
                  mb: 0.5,
                }}
              >
                <Typography
                  sx={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.01em' }}
                >
                  {control.label}
                </Typography>
                <Typography
                  sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem' }}
                >
                  {`${debugQortinoCompanionSettings[control.key] > 0 ? '+' : ''}${
                    debugQortinoCompanionSettings[control.key]
                  }px`}
                </Typography>
              </Box>
              <Slider
                min={control.min}
                max={control.max}
                step={1}
                value={debugQortinoCompanionSettings[control.key]}
                onChange={(_, value) =>
                  updateQortinoCompanionDebugSetting(control.key, value as number)
                }
              />
            </Box>
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.25, pt: 1.5 }}>
          <Button
            onClick={resetQortinoCompanionDebugSettings}
            disabled={!isQortinoCompanionCustomized}
          >
            Reset
          </Button>
          <Button
            variant="contained"
            onClick={() => setIsQortinoCompanionDialogOpen(false)}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={isLocalPreview && isQortinoInletDialogOpen}
        onClose={() => setIsQortinoInletDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>QORTINO Inlet Debug</DialogTitle>
        <DialogContent
          dividers
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.2 }}
        >
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: '0.84rem' }}
          >
            These sliders affect the global QORTINO inlet head live. Tune the
            saved no-antenna head shape, proportions, and dock position without
            touching notification behavior.
          </Typography>
          {([
            {
              key: 'headWidthScale',
              label: 'Head Width',
              max: 135,
              min: 70,
              step: 5,
              unit: '%',
            },
            {
              key: 'headHeightScale',
              label: 'Head Height',
              max: 135,
              min: 70,
              step: 5,
              unit: '%',
            },
            {
              key: 'shellRoundness',
              label: 'Head Shape',
              max: 125,
              min: 75,
              step: 5,
              unit: '%',
            },
            {
              key: 'faceWidthScale',
              label: 'Face Width',
              max: 135,
              min: 70,
              step: 5,
              unit: '%',
            },
            {
              key: 'faceHeightScale',
              label: 'Face Height',
              max: 135,
              min: 70,
              step: 5,
              unit: '%',
            },
            {
              key: 'offsetX',
              label: 'Position X',
              max: 40,
              min: -40,
              step: 1,
              unit: 'px',
            },
            {
              key: 'offsetY',
              label: 'Position Y',
              max: 30,
              min: -30,
              step: 1,
              unit: 'px',
            },
          ] as const).map((control) => {
            const rawValue = debugQortinoInletSettings[control.key];
            const sliderValue =
              control.unit === 'px'
                ? (rawValue as number)
                : Math.round((rawValue as number) * 100);

            return (
              <Box key={control.key}>
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    justifyContent: 'space-between',
                    mb: 0.5,
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      letterSpacing: '0.01em',
                    }}
                  >
                    {control.label}
                  </Typography>
                  <Typography
                    sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem' }}
                  >
                    {control.unit === 'px'
                      ? `${sliderValue > 0 ? '+' : ''}${sliderValue}${control.unit}`
                      : `${sliderValue}${control.unit}`}
                  </Typography>
                </Box>
                <Slider
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={sliderValue}
                  onChange={(_, value) =>
                    updateQortinoInletDebugSetting(
                      control.key,
                      control.unit === 'px'
                        ? (value as number)
                        : (value as number) / 100
                    )
                  }
                />
              </Box>
            );
          })}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.25, pt: 1.5 }}>
          <Button
            onClick={resetQortinoInletDebugSettings}
            disabled={!isQortinoInletCustomized}
          >
            Reset
          </Button>
          <Button
            variant="contained"
            onClick={() => setIsQortinoInletDialogOpen(false)}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

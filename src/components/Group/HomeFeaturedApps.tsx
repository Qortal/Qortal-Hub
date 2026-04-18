import { CSSProperties, useEffect, useEffectEvent, useRef, useState } from 'react';
import { alpha } from '@mui/material/styles';
import { Avatar, Box, Button, ButtonBase, Typography, useTheme } from '@mui/material';
import { executeEvent } from '../../utils/events';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';
import BorderGlow from '../common/BorderGlow';
import GlassSurface from '../common/GlassSurface';
import { getBlueTier1ButtonSx } from '../../styles/blueMaterial';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
  useDashboardPanelMouseLight,
} from './dashboardPanelEffects';
import {
  GROUP_ACTIVITY_BLUE,
  getBlueAmbientLineBackground,
} from './groupActivityColorSystem';

const RETRY_DELAY_MS = 5000;
export const FEATURED_PREVIEW_EXPAND_DELAY_MS = 200;
export const FEATURED_INITIAL_PREVIEW_DURATION_MS = 3500;
export const FEATURED_INTRO_TOTAL_DURATION_MS =
  FEATURED_PREVIEW_EXPAND_DELAY_MS + FEATURED_INITIAL_PREVIEW_DURATION_MS;
const FEATURED_STRIP_HOVER_DURATION_MS = 190;
const FEATURED_INITIAL_PREVIEW_SESSION_KEY = 'dashboard-featured-pirate-preview-seen';
const FEATURED_TEASER_FADE_DURATION_MS = 300;
const PIRATE_APP_NAME = 'Pirate Nintendo';
const Q_TUBE_APP_NAME = 'Q-Tube';
const PIRATE_PREVIEW_VIDEO_SRC = '/pirate-nintendo-preview.mp4';
const Q_TUBE_PREVIEW_VIDEO_SRC = '/q-tube-preview.mp4';
const FEATURED_TILE_VIDEO_SRC = {
  [Q_TUBE_APP_NAME]: Q_TUBE_PREVIEW_VIDEO_SRC,
  [PIRATE_APP_NAME]: PIRATE_PREVIEW_VIDEO_SRC,
} as const;
const FEATURED_STRIP_HOVER_TRANSITION =
  `${FEATURED_STRIP_HOVER_DURATION_MS}ms ease`;
const FEATURED_PREVIEW_CONFIG = {
  [Q_TUBE_APP_NAME]: {
    subtitle: "Decentralized Cat Videos, can't beat that.",
    title: Q_TUBE_APP_NAME,
    videoSrc: Q_TUBE_PREVIEW_VIDEO_SRC,
  },
  [PIRATE_APP_NAME]: {
    subtitle: 'Play and grow a community-powered retro game library.',
    title: PIRATE_APP_NAME,
    videoSrc: PIRATE_PREVIEW_VIDEO_SRC,
  },
} as const;
type PreviewAppName = keyof typeof FEATURED_PREVIEW_CONFIG;
const FEATURED_APP_GRID = [
  Q_TUBE_APP_NAME,
  'Quitter',
  'Q-Mail',
  'Q-Blog',
  'Q-Trade',
  PIRATE_APP_NAME,
] as const;

const openApp = (appName: string) => {
  executeEvent('addTab', { data: { service: 'APP', name: appName } });
  executeEvent('open-apps-mode', {});
};

const openAppsLibrary = () => {
  executeEvent('openAppsLibrarySearch', {
    data: {
      query: '',
    },
  });
  executeEvent('open-apps-mode', {});
};

export const HomeFeaturedApps = ({
  panelBoxRef = undefined,
}) => {
  const theme = useTheme();
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
  const pirateExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pirateCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPreviewStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPreviewEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedPreviewApp, setExpandedPreviewApp] = useState<PreviewAppName | null>(null);
  const [autoPreviewActive, setAutoPreviewActive] = useState(false);
  const featuredFooterStripBackground =
    theme.palette.mode === 'dark'
      ? `radial-gradient(140% 252% at 50% 54%, ${alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.225)} 0%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.132
        )} 18%, ${alpha(GROUP_ACTIVITY_BLUE.hover, 0.078)} 38%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.032
        )} 62%, transparent 88%), linear-gradient(90deg, transparent 0%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.014
        )} 18%, ${alpha(GROUP_ACTIVITY_BLUE.gradientMid, 0.072)} 50%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.014
        )} 82%, transparent 100%), linear-gradient(180deg, ${alpha(
          theme.palette.common.white,
          0.024
        )} 0%, ${alpha(theme.palette.common.white, 0.012)} 12%, transparent 34%, transparent 64%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.03
        )} 100%), linear-gradient(180deg, transparent 0%, transparent 46%, ${alpha(
          theme.palette.common.white,
          0.034
        )} 49.5%, ${alpha(theme.palette.common.white, 0.05)} 50%, ${alpha(
          theme.palette.common.white,
          0.034
        )} 50.5%, transparent 54%, transparent 100%)`
      : `radial-gradient(140% 252% at 50% 54%, ${alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.162)} 0%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.096
        )} 18%, ${alpha(GROUP_ACTIVITY_BLUE.hover, 0.056)} 38%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.022
        )} 62%, transparent 88%), linear-gradient(90deg, transparent 0%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.009
        )} 18%, ${alpha(GROUP_ACTIVITY_BLUE.gradientMid, 0.05)} 50%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.009
        )} 82%, transparent 100%), linear-gradient(180deg, ${alpha(
          theme.palette.common.white,
          0.018
        )} 0%, ${alpha(theme.palette.common.white, 0.008)} 12%, transparent 34%, transparent 64%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.02
        )} 100%), linear-gradient(180deg, transparent 0%, transparent 46%, ${alpha(
          theme.palette.common.white,
          0.022
        )} 49.5%, ${alpha(theme.palette.common.white, 0.03)} 50%, ${alpha(
          theme.palette.common.white,
          0.022
        )} 50.5%, transparent 54%, transparent 100%)`;
  const featuredFooterStripCoreGlow =
    theme.palette.mode === 'dark'
      ? `radial-gradient(92% 202% at 50% 56%, ${alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.285)} 0%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.168
        )} 30%, ${alpha(GROUP_ACTIVITY_BLUE.primary, 0.055)} 56%, transparent 80%)`
      : `radial-gradient(92% 202% at 50% 56%, ${alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.195)} 0%, ${alpha(
          GROUP_ACTIVITY_BLUE.primary,
          0.114
        )} 30%, ${alpha(GROUP_ACTIVITY_BLUE.primary, 0.036)} 56%, transparent 80%)`;

  const clearInitialPreviewTimers = useEffectEvent(() => {
    if (initialPreviewStartTimerRef.current) {
      clearTimeout(initialPreviewStartTimerRef.current);
      initialPreviewStartTimerRef.current = null;
    }
    if (initialPreviewEndTimerRef.current) {
      clearTimeout(initialPreviewEndTimerRef.current);
      initialPreviewEndTimerRef.current = null;
    }
  });

  useEffect(() => {
    let shouldRunInitialPreview = true;

    try {
      shouldRunInitialPreview =
        window.sessionStorage.getItem(FEATURED_INITIAL_PREVIEW_SESSION_KEY) !== '1';
    } catch {
      shouldRunInitialPreview = true;
    }

    if (!shouldRunInitialPreview) {
      setAutoPreviewActive(false);
      return () => {
        if (pirateExpandTimerRef.current) clearTimeout(pirateExpandTimerRef.current);
        if (pirateCollapseTimerRef.current) clearTimeout(pirateCollapseTimerRef.current);
        clearInitialPreviewTimers();
      };
    }

    try {
      window.sessionStorage.setItem(FEATURED_INITIAL_PREVIEW_SESSION_KEY, '1');
    } catch {
      // Ignore sessionStorage failures and allow the intro to behave as a normal first-mount teaser.
    }

    setAutoPreviewActive(true);

    initialPreviewStartTimerRef.current = setTimeout(() => {
      initialPreviewStartTimerRef.current = null;
      setExpandedPreviewApp(PIRATE_APP_NAME);
    }, FEATURED_PREVIEW_EXPAND_DELAY_MS);

    initialPreviewEndTimerRef.current = setTimeout(() => {
      initialPreviewEndTimerRef.current = null;
      setAutoPreviewActive(false);
      setExpandedPreviewApp((current) => (current === PIRATE_APP_NAME ? null : current));
    }, FEATURED_INTRO_TOTAL_DURATION_MS);

    return () => {
      if (pirateExpandTimerRef.current) clearTimeout(pirateExpandTimerRef.current);
      if (pirateCollapseTimerRef.current) clearTimeout(pirateCollapseTimerRef.current);
      clearInitialPreviewTimers();
    };
  }, []);

  const clearPirateTimers = () => {
    if (pirateExpandTimerRef.current) {
      clearTimeout(pirateExpandTimerRef.current);
      pirateExpandTimerRef.current = null;
    }
    if (pirateCollapseTimerRef.current) {
      clearTimeout(pirateCollapseTimerRef.current);
      pirateCollapseTimerRef.current = null;
    }
  };

  const stopInitialPreview = () => {
    clearInitialPreviewTimers();
    setAutoPreviewActive(false);
  };

  const schedulePreviewExpand = (appName: PreviewAppName) => {
    if (autoPreviewActive) {
      stopInitialPreview();
    }
    if (expandedPreviewApp === appName && !pirateExpandTimerRef.current) return;
    if (pirateCollapseTimerRef.current) {
      clearTimeout(pirateCollapseTimerRef.current);
      pirateCollapseTimerRef.current = null;
    }
    if (pirateExpandTimerRef.current) {
      clearTimeout(pirateExpandTimerRef.current);
      pirateExpandTimerRef.current = null;
    }
    pirateExpandTimerRef.current = setTimeout(() => {
      pirateExpandTimerRef.current = null;
      setExpandedPreviewApp(appName);
    }, FEATURED_PREVIEW_EXPAND_DELAY_MS);
  };

  const schedulePreviewCollapse = () => {
    if (autoPreviewActive) return;
    if (pirateExpandTimerRef.current) {
      clearTimeout(pirateExpandTimerRef.current);
      pirateExpandTimerRef.current = null;
    }
    if (!expandedPreviewApp || pirateCollapseTimerRef.current) return;
    pirateCollapseTimerRef.current = setTimeout(() => {
      pirateCollapseTimerRef.current = null;
      setExpandedPreviewApp(null);
    }, 70);
  };

  return (
    <Box
      ref={assignPanelNode}
      sx={{
        ...dashboardPanelSx(theme, 'base'),
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: '100%',
        minHeight: 0,
        padding: '15px 20px 16px',
        transition: 'border-color 180ms ease, background-color 180ms ease',
        width: '100%',
      }}
      onMouseMove={handleDashboardPanelPointerMove}
      onMouseLeave={handleDashboardPanelPointerLeave}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
          textAlign: 'center',
        }}
      >
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '1rem',
            fontWeight: 600,
          }}
        >
          Featured Q-Apps
        </Typography>
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.76rem',
            letterSpacing: '0.012em',
            lineHeight: 1.45,
            maxWidth: '420px',
          }}
        >
          Launch trusted community apps directly from your dashboard.
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: '0px',
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            justifyContent: 'center',
            minHeight: 0,
            padding: '18px 0',
            position: 'relative',
            width: '100%',
          }}
        >
          <Box
            sx={{
              alignItems: 'stretch',
              display: 'grid',
              gap: '12px',
              gridAutoRows: '124px',
              gridTemplateColumns: 'repeat(4, 124px)',
              justifyContent: 'center',
              maxWidth: '100%',
              position: 'relative',
              width: 'max-content',
              zIndex: 1,
            }}
          >
            {FEATURED_APP_GRID.map((appName, index) =>
              appName ? (
                <AppTile
                  key={appName}
                  appName={appName}
                  theme={theme}
                  expandedPreviewApp={expandedPreviewApp}
                  onPreviewExpandStart={schedulePreviewExpand}
                  onPreviewExpandEnd={schedulePreviewCollapse}
                />
              ) : (
                <Box
                  key={`featured-empty-slot-${index}`}
                  aria-hidden="true"
                  sx={{
                    height: '100%',
                    visibility: 'hidden',
                    width: '100%',
                  }}
                />
              )
            )}
          </Box>
          <FeaturedExpandedPreview
            appName={expandedPreviewApp}
            theme={theme}
            visible={!!expandedPreviewApp}
            teaserMode={autoPreviewActive && expandedPreviewApp === PIRATE_APP_NAME}
            onMouseEnter={() => {
              clearPirateTimers();
            }}
            onMouseLeave={schedulePreviewCollapse}
          />
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexShrink: 0,
            justifyContent: 'center',
            height: '42px',
            position: 'relative',
          }}
        >
          <Box
            className="dashboard-panel-decoration"
            aria-hidden="true"
            sx={{
              position: 'absolute',
              left: '50%',
              top: 0,
              transform: 'translateX(-50%)',
              height: '1px',
              maxWidth: '780px',
              pointerEvents: 'none',
              width: '126%',
              background: getBlueAmbientLineBackground(theme, 'medium'),
              filter: 'blur(0.45px)',
              opacity: theme.palette.mode === 'dark' ? 0.72 : 0.6,
              transition: `opacity ${FEATURED_STRIP_HOVER_TRANSITION}, filter ${FEATURED_STRIP_HOVER_TRANSITION}`,
              '&::after': {
                content: '""',
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                height: '24px',
                pointerEvents: 'none',
                background:
                  theme.palette.mode === 'dark'
                    ? 'radial-gradient(92% 210% at 50% 0%, rgba(255,255,255,0.038) 0%, rgba(255,255,255,0.025) 18%, rgba(255,255,255,0.013) 34%, rgba(60,76,90,0.006) 52%, transparent 82%)'
                    : 'radial-gradient(92% 210% at 50% 0%, rgba(255,255,255,0.028) 0%, rgba(255,255,255,0.018) 18%, rgba(255,255,255,0.01) 34%, rgba(60,76,90,0.006) 52%, transparent 82%)',
                filter: 'blur(3.6px)',
                transform: 'translateY(1px)',
              },
            }}
          />
          <ButtonBase
            disableRipple
            onClick={openAppsLibrary}
            sx={{
              alignItems: 'center',
              color: theme.palette.text.secondary,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'center',
              inset: '0 -20px -16px',
              lineHeight: 1,
              overflow: 'hidden',
              padding: 0,
              position: 'absolute',
              boxShadow:
                theme.palette.mode === 'dark'
                  ? 'inset 0 1px 0 rgba(255,255,255,0.018), inset 0 -1px 0 rgba(132,175,240,0.024)'
                  : 'inset 0 1px 0 rgba(255,255,255,0.022), inset 0 -1px 0 rgba(132,175,240,0.018)',
              textAlign: 'center',
              textDecoration: 'none',
              transition: `color ${FEATURED_STRIP_HOVER_TRANSITION}, box-shadow ${FEATURED_STRIP_HOVER_TRANSITION}`,
              zIndex: 0,
              '&::before': {
                content: '""',
                position: 'absolute',
                inset: '0 0 0 0',
                pointerEvents: 'none',
                background: featuredFooterStripBackground,
                filter: 'blur(7px)',
                opacity: theme.palette.mode === 'dark' ? 0.1 : 0.07,
                transition: `opacity ${FEATURED_STRIP_HOVER_TRANSITION}, filter ${FEATURED_STRIP_HOVER_TRANSITION}`,
              },
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: '0 10% 0 10%',
                pointerEvents: 'none',
                background: featuredFooterStripCoreGlow,
                filter: 'blur(12px)',
                opacity: theme.palette.mode === 'dark' ? 0.1 : 0.07,
                transition: `opacity ${FEATURED_STRIP_HOVER_TRANSITION}, filter ${FEATURED_STRIP_HOVER_TRANSITION}, inset ${FEATURED_STRIP_HOVER_TRANSITION}`,
              },
              '&:hover, &:focus-visible': {
                backgroundColor: 'transparent',
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? 'inset 0 1px 0 rgba(255,255,255,0.024), inset 0 -1px 0 rgba(132,175,240,0.04)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.028), inset 0 -1px 0 rgba(132,175,240,0.026)',
                '&::before': {
                  filter: 'blur(8px)',
                  opacity: theme.palette.mode === 'dark' ? 1 : 0.9,
                },
                '&::after': {
                  inset: '0 6% 0 6%',
                  filter: 'blur(14px)',
                  opacity: theme.palette.mode === 'dark' ? 1 : 0.96,
                },
                '& .featured-apps-strip-label': {
                  color:
                    theme.palette.mode === 'dark'
                      ? theme.palette.common.white
                      : theme.palette.text.primary,
                  opacity: 1,
                  textShadow:
                    theme.palette.mode === 'dark'
                      ? '0 0 12px rgba(132, 175, 240, 0.24), 0 0 22px rgba(132, 175, 240, 0.1)'
                      : '0 0 12px rgba(132, 175, 240, 0.12)',
                },
                '& .featured-apps-strip-subtle': {
                  color:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.92)
                      : theme.palette.text.primary,
                  opacity: 1,
                },
              },
            }}
          >
            <Typography
              sx={{
                alignItems: 'center',
                color: 'inherit',
                columnGap: '4px',
                display: 'inline-flex',
                fontSize: '0.851rem',
                position: 'relative',
                textAlign: 'center',
                zIndex: 1,
              }}
            >
              <Box
                component="span"
                className="featured-apps-strip-label"
                sx={{
                  color:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.9)
                      : theme.palette.text.primary,
                  display: 'inline-flex',
                  fontSize: 'inherit',
                  fontWeight: 700,
                  lineHeight: 1,
                  opacity: theme.palette.mode === 'dark' ? 0.94 : 1,
                  transition:
                    `color ${FEATURED_STRIP_HOVER_TRANSITION}, text-shadow ${FEATURED_STRIP_HOVER_TRANSITION}, opacity ${FEATURED_STRIP_HOVER_TRANSITION}`,
                }}
              >
                Explore
              </Box>
              <Box
                component="span"
                className="featured-apps-strip-subtle"
                sx={{
                  color: theme.palette.text.secondary,
                  display: 'inline-flex',
                  fontSize: 'inherit',
                  fontWeight: 400,
                  lineHeight: 1,
                  opacity: theme.palette.mode === 'dark' ? 0.88 : 1,
                  transition: `color ${FEATURED_STRIP_HOVER_TRANSITION}, opacity ${FEATURED_STRIP_HOVER_TRANSITION}`,
                }}
              >
                All Q-Apps
              </Box>
            </Typography>
          </ButtonBase>
        </Box>
      </Box>
    </Box>
  );
};

// ---------------------------------------------------------------------------

interface AppTileProps {
  appName: string;
  theme: any;
  expandedPreviewApp: PreviewAppName | null;
  onPreviewExpandStart: (appName: PreviewAppName) => void;
  onPreviewExpandEnd: () => void;
}

const AppTile = ({
  appName,
  theme,
  expandedPreviewApp,
  onPreviewExpandStart,
  onPreviewExpandEnd,
}: AppTileProps) => {
  const baseAvatarUrl = `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${appName}/qortal_avatar?async=true`;
  const [imageSrc, setImageSrc] = useState(baseAvatarUrl);
  const [hasTileVideoError, setHasTileVideoError] = useState(false);
  const hasRetriedRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPreviewableTile = appName in FEATURED_PREVIEW_CONFIG;
  const isWideLeftTile = appName === Q_TUBE_APP_NAME;
  const isWideRightTile = appName === PIRATE_APP_NAME;
  const isWideTile = isWideLeftTile || isWideRightTile;
  const tileVideoSrc = appName in FEATURED_TILE_VIDEO_SRC
    ? FEATURED_TILE_VIDEO_SRC[appName as keyof typeof FEATURED_TILE_VIDEO_SRC]
    : null;
  const fadeOutForPreview = !!expandedPreviewApp && expandedPreviewApp !== appName;
  const hideBasePreviewTile = !!expandedPreviewApp && expandedPreviewApp === appName;
  const allowTileHover = !expandedPreviewApp;
  const hiddenTileStyles = {
    opacity: fadeOutForPreview ? 0 : hideBasePreviewTile ? 0 : 1,
    pointerEvents: fadeOutForPreview || hideBasePreviewTile ? 'none' : 'auto',
    visibility: fadeOutForPreview || hideBasePreviewTile ? 'hidden' : 'visible',
  } as const;

  useEffect(() => {
    setHasTileVideoError(false);
  }, [tileVideoSrc]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  const handleImageError = () => {
    if (hasRetriedRef.current) return;
    console.log('handleImageError', appName);
    hasRetriedRef.current = true;
    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      setImageSrc(`${baseAvatarUrl}&_retry=${Date.now()}`);
    }, RETRY_DELAY_MS);
  };

  const tileButton = (
    <ButtonBase
      disableRipple
      onClick={() => openApp(appName)}
      onMouseEnter={
        isPreviewableTile
          ? () => onPreviewExpandStart(appName as PreviewAppName)
          : undefined
      }
      onMouseLeave={isPreviewableTile ? onPreviewExpandEnd : undefined}
      sx={{
        alignItems: isWideLeftTile ? 'flex-start' : isWideRightTile ? 'flex-end' : 'center',
        bgcolor:
          theme.palette.mode === 'dark'
            ? '#181a20'
            : theme.palette.background.surface,
        border: `1px solid ${theme.palette.border.subtle}`,
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        justifyContent: 'center',
        height: '100%',
        minHeight: 0,
        padding: '12px 10px',
        transition:
          'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, opacity 160ms ease',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        gridColumn: isWideTile ? 'span 2' : 'span 1',
        ...(!isWideTile ? hiddenTileStyles : null),
        transform: 'translateY(0)',
        boxShadow:
          theme.palette.mode === 'dark'
            ? 'inset 0 1px 0 rgba(255,255,255,0.035), inset 0 -10px 18px rgba(0,0,0,0.22)'
            : 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -8px 14px rgba(15,23,42,0.06)',
        '&:hover': {
          bgcolor:
            theme.palette.mode === 'dark'
              ? '#181a20'
              : theme.palette.background.paper,
          borderColor: theme.palette.border.main,
          boxShadow:
            theme.palette.mode === 'dark'
              ? 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -10px 18px rgba(0,0,0,0.24), 0 8px 18px rgba(0,0,0,0.1)'
              : 'inset 0 1px 0 rgba(255,255,255,0.76), inset 0 -8px 14px rgba(15,23,42,0.07), 0 8px 18px rgba(15,23,42,0.08)',
          ...(allowTileHover ? { transform: 'translateY(-1px)' } : null),
        },
        '&:active': {
          boxShadow:
            theme.palette.mode === 'dark'
              ? 'inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -8px 14px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)'
              : 'inset 0 1px 0 rgba(255,255,255,0.68), inset 0 -8px 14px rgba(15,23,42,0.06), 0 2px 8px rgba(15,23,42,0.07)',
          ...(allowTileHover ? { transform: 'translateY(0)' } : null),
        },
        '&:focus-visible': {
          backgroundColor: theme.palette.background.surface,
          borderColor: theme.palette.border.main,
          boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}`,
        },
      }}
    >
      {tileVideoSrc && !hasTileVideoError ? (
        <Box
          aria-hidden="true"
          sx={{
            inset: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            position: 'absolute',
            zIndex: 0,
          }}
        >
          <Box
            component="video"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => setHasTileVideoError(true)}
            sx={{
              height: '100%',
              inset: 0,
              objectFit: 'cover',
              objectPosition: 'center center',
              opacity: theme.palette.mode === 'dark' ? 0.88 : 0.8,
              pointerEvents: 'none',
              position: 'absolute',
              transform: 'scale(1.18)',
              width: '100%',
              filter:
                theme.palette.mode === 'dark'
                  ? 'blur(10px) saturate(0.9)'
                  : 'blur(9px) saturate(0.86)',
            }}
          >
            <source src={tileVideoSrc} type="video/mp4" />
          </Box>
        </Box>
      ) : null}
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          position: 'relative',
          width: isWideTile ? '104px' : '100%',
          alignSelf: isWideRightTile ? 'flex-end' : 'auto',
          zIndex: 1,
        }}
      >
        <Avatar
          src={imageSrc}
          variant="rounded"
          onError={handleImageError}
          sx={{ height: 52, width: 52 }}
        >
          {appName.charAt(0)}
        </Avatar>

        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '0.8rem',
            fontWeight: 600,
            maxWidth: '100px',
            overflow: 'hidden',
            textAlign: 'center',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {appName}
        </Typography>
      </Box>
      {isWideLeftTile ? (
        <Box
          aria-hidden="true"
          sx={{
            alignItems: 'center',
            display: 'flex',
            inset: '0 16px 0 124px',
            justifyContent: 'center',
            pointerEvents: 'none',
            position: 'absolute',
            transform: 'translateX(-20px)',
            zIndex: 1,
          }}
        >
          <Box
            sx={{
              alignItems: 'stretch',
              display: 'inline-flex',
              gap: '6px',
            }}
          >
            <Box
              sx={{
                bgcolor:
                  theme.palette.mode === 'dark'
                    ? 'rgba(239,243,250,0.72)'
                    : 'rgba(20,28,40,0.66)',
                borderRadius: '999px',
                flexShrink: 0,
                width: '3px',
              }}
            />
            <Typography
              component="div"
              sx={{
                color:
                  theme.palette.mode === 'dark'
                    ? 'rgba(239,243,250,0.9)'
                    : 'rgba(20,28,40,0.84)',
                display: 'inline-flex',
                flexDirection: 'column',
                fontSize: '0.8rem',
                fontWeight: 800,
                letterSpacing: '0.004em',
                lineHeight: 0.98,
                textAlign: 'left',
                textShadow:
                  theme.palette.mode === 'dark'
                    ? '0 1px 10px rgba(0,0,0,0.28)'
                    : '0 1px 6px rgba(255,255,255,0.16)',
              }}
            >
              <Box component="span" sx={{ display: 'block' }}>
                decentralized.
              </Box>
              <Box component="span" sx={{ display: 'block' }}>
                cat. videos.
              </Box>
              <Box component="span" sx={{ display: 'block' }}>
                debauchery.
              </Box>
            </Typography>
          </Box>
        </Box>
      ) : null}
      {isWideRightTile ? (
        <Box
          aria-hidden="true"
          sx={{
            alignItems: 'center',
            display: 'flex',
            inset: '0 124px 0 16px',
            justifyContent: 'center',
            pointerEvents: 'none',
            position: 'absolute',
            transform: 'translateX(20px)',
            zIndex: 1,
          }}
        >
          <Box
            sx={{
              alignItems: 'stretch',
              display: 'inline-flex',
              gap: '6px',
            }}
          >
            <Box
              sx={{
                bgcolor:
                  theme.palette.mode === 'dark'
                    ? 'rgba(239,243,250,0.72)'
                    : 'rgba(20,28,40,0.66)',
                borderRadius: '999px',
                flexShrink: 0,
                width: '3px',
              }}
            />
            <Typography
              component="div"
              sx={{
                color:
                  theme.palette.mode === 'dark'
                    ? 'rgba(239,243,250,0.9)'
                    : 'rgba(20,28,40,0.84)',
                display: 'inline-flex',
                flexDirection: 'column',
                fontSize: '0.8rem',
                fontWeight: 800,
                letterSpacing: '0.004em',
                lineHeight: 0.98,
                textAlign: 'left',
                textShadow:
                  theme.palette.mode === 'dark'
                    ? '0 1px 10px rgba(0,0,0,0.28)'
                    : '0 1px 6px rgba(255,255,255,0.16)',
              }}
            >
              <Box component="span" sx={{ display: 'block' }}>
                community.
              </Box>
              <Box component="span" sx={{ display: 'block' }}>
                rom.library.
              </Box>
              <Box component="span" sx={{ display: 'block' }}>
                bowser.
              </Box>
            </Typography>
          </Box>
        </Box>
      ) : null}
    </ButtonBase>
  );

  if (!isWideTile) {
    return tileButton;
  }

  return (
    <BorderGlow
      alwaysOn
      animated={false}
      foregroundGlow
      interactive={false}
      edgeSensitivity={30}
      glowColor="40 80 80"
      backgroundColor="transparent"
      borderRadius={10}
      glowRadius={40}
      glowIntensity={1}
      coneSpread={25}
      colors={[
        '#c084fc',
        '#f472b6',
        '#38bdf8',
      ]}
      style={
        {
          '--card-border': 'transparent',
          '--card-shadow': 'none',
          borderRadius: '10px',
          gridColumn: 'span 2',
          height: '100%',
          minHeight: 0,
          transition: 'opacity 160ms ease',
          width: '100%',
          ...hiddenTileStyles,
        } as CSSProperties
      }
    >
      {tileButton}
    </BorderGlow>
  );
};

const FeaturedExpandedPreview = ({
  appName,
  theme,
  visible,
  teaserMode,
  onMouseEnter,
  onMouseLeave,
}: {
  appName: PreviewAppName | null;
  theme: any;
  visible: boolean;
  teaserMode: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) => {
  const lastResolvedAppRef = useRef<PreviewAppName>(PIRATE_APP_NAME);
  if (appName) {
    lastResolvedAppRef.current = appName;
  }
  const resolvedAppName = appName ?? lastResolvedAppRef.current;
  const previewConfig = FEATURED_PREVIEW_CONFIG[resolvedAppName];
  const baseAvatarUrl = `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${resolvedAppName}/qortal_avatar?async=true`;
  const [imageSrc, setImageSrc] = useState(baseAvatarUrl);
  const [hasVideoError, setHasVideoError] = useState(false);

  useEffect(() => {
    setImageSrc(baseAvatarUrl);
    setHasVideoError(false);
  }, [baseAvatarUrl, resolvedAppName]);

  return (
    <Box
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 3,
        borderRadius: '12px',
        background:
          theme.palette.mode === 'dark'
            ? 'linear-gradient(180deg, rgba(16,18,24,0.96) 0%, rgba(22,24,31,0.98) 100%)'
            : 'linear-gradient(180deg, rgba(243,238,230,0.96) 0%, rgba(233,226,214,0.98) 100%)',
        border: `1px solid ${theme.palette.border.main}`,
        boxShadow:
          theme.palette.mode === 'dark'
            ? '0 18px 34px rgba(0,0,0,0.24)'
            : '0 14px 28px rgba(28,36,52,0.1)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transform: visible ? 'scale(1)' : teaserMode ? 'scale(0.992)' : 'scale(0.985)',
        transition: `opacity ${teaserMode ? FEATURED_TEASER_FADE_DURATION_MS : 220}ms ease, transform ${teaserMode ? FEATURED_TEASER_FADE_DURATION_MS : 220}ms ease`,
        '& video': {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center center',
          pointerEvents: 'none',
          transform: 'scale(1.035)',
          opacity: teaserMode ? 0.8 : 1,
          transition: `opacity ${FEATURED_TEASER_FADE_DURATION_MS}ms ease`,
        },
      }}
    >
      {!hasVideoError ? (
        <Box
          key={previewConfig.videoSrc}
          component="video"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setHasVideoError(true)}
        >
          <source src={previewConfig.videoSrc} type="video/mp4" />
        </Box>
      ) : null}
        <Box
          sx={{
            position: 'absolute',
            inset: '-1px 0',
            zIndex: 2,
            pointerEvents: 'none',
            borderRadius: 'inherit',
            overflow: 'hidden',
          }}
        >
          <GlassSurface
            borderRadius={12}
            borderWidth={0.036}
            brightness={theme.palette.mode === 'dark' ? 26 : 66}
            opacity={theme.palette.mode === 'dark' ? 0.86 : 0.83}
            blur={theme.palette.mode === 'dark' ? 2.35 : 2.05}
            displace={theme.palette.mode === 'dark' ? 0.05 : 0.04}
            backgroundOpacity={theme.palette.mode === 'dark' ? 0.018 : 0.038}
            saturation={theme.palette.mode === 'dark' ? 1.005 : 0.99}
            distortionScale={theme.palette.mode === 'dark' ? -30 : -25}
            redOffset={0}
            greenOffset={1.5}
            blueOffset={3}
            mixBlendMode="difference"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1,
              overflow: 'hidden',
            }}
        >
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                theme.palette.mode === 'dark'
                  ? teaserMode
                    ? 'linear-gradient(180deg, rgba(7,9,13,0.62) 0%, rgba(7,9,13,0.52) 18%, rgba(8,10,14,0.28) 30%, rgba(8,10,14,0.06) 56%, rgba(8,10,14,0) 100%), linear-gradient(90deg, rgba(8,10,14,0.58) 0%, rgba(8,10,14,0.48) 26%, rgba(8,10,14,0.32) 54%, rgba(8,10,14,0.14) 100%), linear-gradient(180deg, rgba(10,12,16,0.56) 0%, rgba(10,12,16,0.44) 26%, rgba(10,12,16,0.3) 54%, rgba(10,12,16,0.46) 100%), radial-gradient(120% 82% at 50% 8%, rgba(132,175,240,0.026) 0%, rgba(132,175,240,0.01) 24%, rgba(10,12,16,0) 58%), linear-gradient(180deg, rgba(255,255,255,0.006) 0%, rgba(255,255,255,0) 24%)'
                    : 'linear-gradient(180deg, rgba(7,9,13,0.72) 0%, rgba(7,9,13,0.62) 18%, rgba(8,10,14,0.36) 30%, rgba(8,10,14,0.08) 56%, rgba(8,10,14,0) 100%), linear-gradient(90deg, rgba(8,10,14,0.72) 0%, rgba(8,10,14,0.64) 26%, rgba(8,10,14,0.44) 54%, rgba(8,10,14,0.24) 100%), linear-gradient(180deg, rgba(10,12,16,0.68) 0%, rgba(10,12,16,0.54) 26%, rgba(10,12,16,0.42) 54%, rgba(10,12,16,0.56) 100%), radial-gradient(120% 82% at 50% 8%, rgba(132,175,240,0.032) 0%, rgba(132,175,240,0.012) 24%, rgba(10,12,16,0) 58%), linear-gradient(180deg, rgba(255,255,255,0.008) 0%, rgba(255,255,255,0) 24%)'
                  : teaserMode
                    ? 'linear-gradient(180deg, rgba(20,24,30,0.32) 0%, rgba(20,24,30,0.26) 18%, rgba(20,24,30,0.13) 30%, rgba(20,24,30,0.03) 56%, rgba(20,24,30,0) 100%), linear-gradient(90deg, rgba(18,22,28,0.46) 0%, rgba(18,22,28,0.38) 26%, rgba(18,22,28,0.24) 54%, rgba(18,22,28,0.12) 100%), linear-gradient(180deg, rgba(22,26,32,0.42) 0%, rgba(22,26,32,0.3) 26%, rgba(22,26,32,0.22) 54%, rgba(22,26,32,0.34) 100%), radial-gradient(120% 82% at 50% 8%, rgba(132,175,240,0.02) 0%, rgba(132,175,240,0.008) 24%, rgba(22,26,32,0) 58%), linear-gradient(180deg, rgba(255,255,255,0.014) 0%, rgba(255,255,255,0) 24%)'
                    : 'linear-gradient(180deg, rgba(20,24,30,0.4) 0%, rgba(20,24,30,0.32) 18%, rgba(20,24,30,0.16) 30%, rgba(20,24,30,0.04) 56%, rgba(20,24,30,0) 100%), linear-gradient(90deg, rgba(18,22,28,0.58) 0%, rgba(18,22,28,0.5) 26%, rgba(18,22,28,0.34) 54%, rgba(18,22,28,0.18) 100%), linear-gradient(180deg, rgba(22,26,32,0.54) 0%, rgba(22,26,32,0.38) 26%, rgba(22,26,32,0.32) 54%, rgba(22,26,32,0.44) 100%), radial-gradient(120% 82% at 50% 8%, rgba(132,175,240,0.024) 0%, rgba(132,175,240,0.01) 24%, rgba(22,26,32,0) 58%), linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0) 24%)',
              pointerEvents: 'none',
              zIndex: 0,
              transition: `background ${FEATURED_TEASER_FADE_DURATION_MS}ms ease`,
            }}
          />
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: '44%',
              background:
                theme.palette.mode === 'dark'
                  ? 'linear-gradient(90deg, rgba(6,8,12,0.22) 0%, rgba(6,8,12,0.14) 52%, rgba(6,8,12,0) 100%)'
                  : 'linear-gradient(90deg, rgba(16,20,28,0.12) 0%, rgba(16,20,28,0.08) 52%, rgba(16,20,28,0) 100%)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          <Box
            sx={{
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              p: '22px',
              position: 'relative',
              width: '100%',
              zIndex: 1,
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', mb: '18px', position: 'relative', pl: '24px', pr: '14px', pt: '24px' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Avatar
                  src={imageSrc}
                  variant="rounded"
                  sx={{
                    height: 52,
                    width: 52,
                    bgcolor: theme.palette.mode === 'dark' ? '#181a20' : theme.palette.background.surface,
                    border: `1px solid ${theme.palette.border.subtle}`,
                    flexShrink: 0,
                    opacity: theme.palette.mode === 'dark' ? 0.94 : 0.9,
                  }}
                >
                  {previewConfig.title.charAt(0)}
                </Avatar>
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '1.24rem',
                    fontWeight: 700,
                    letterSpacing: '0.026em',
                    textShadow:
                      theme.palette.mode === 'dark'
                        ? '0 2px 12px rgba(0,0,0,0.42)'
                        : '0 2px 10px rgba(18,22,28,0.22)',
                  }}
                >
                  {previewConfig.title}
                </Typography>
              </Box>
              <Typography
                sx={{
                  color:
                    theme.palette.mode === 'dark'
                      ? 'rgba(232,236,244,0.86)'
                      : 'rgba(28,36,52,0.8)',
                  fontSize: '0.96rem',
                  lineHeight: 1.55,
                  maxWidth: '54ch',
                  textShadow:
                    theme.palette.mode === 'dark'
                      ? '0 2px 14px rgba(0,0,0,0.36)'
                      : '0 2px 10px rgba(18,22,28,0.18)',
                }}
              >
                {previewConfig.subtitle}
              </Typography>
              <Box sx={{ pt: '6px', pointerEvents: 'auto' }}>
                <Button
                  onClick={() => openApp(resolvedAppName)}
                  variant="contained"
                  sx={{
                    ...getBlueTier1ButtonSx(),
                    borderRadius: '11px',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    minWidth: '138px',
                    minHeight: '42px',
                    px: 2.2,
                    py: 0.9,
                    textTransform: 'none',
                    backdropFilter: 'blur(2px)',
                    WebkitBackdropFilter: 'blur(2px)',
                    position: 'relative',
                    overflow: 'hidden',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      backgroundImage:
                        'radial-gradient(circle at 20% 25%, rgba(255,255,255,0.1) 0.5px, transparent 0.8px), radial-gradient(circle at 72% 64%, rgba(0,0,0,0.08) 0.5px, transparent 0.9px), radial-gradient(circle at 48% 38%, rgba(255,255,255,0.06) 0.45px, transparent 0.75px)',
                      backgroundSize: '18px 18px, 22px 22px, 16px 16px',
                      opacity: theme.palette.mode === 'dark' ? 0.06 : 0.05,
                      mixBlendMode: 'soft-light',
                      pointerEvents: 'none',
                    },
                    '&:hover': {
                      ...getBlueTier1ButtonSx()['&:hover'],
                      transform: 'none',
                    },
                    '&:active': {
                      ...getBlueTier1ButtonSx()['&:active'],
                      transform: 'none',
                    },
                  }}
                >
                  Open Q-App
                </Button>
              </Box>
            </Box>
            <Box sx={{ flex: 1, minHeight: '150px', position: 'relative' }} />
          </Box>
        </GlassSurface>
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: '12px',
              pointerEvents: 'none',
              zIndex: 2,
              boxShadow:
                theme.palette.mode === 'dark'
                  ? 'inset 0 0 0 0.72px rgba(8,10,14,0.26), inset 0 -1px 2px rgba(6,8,12,0.16), inset -1px 0 2px rgba(6,8,12,0.13)'
                  : 'inset 0 0 0 0.72px rgba(22,26,32,0.11), inset 0 -1px 2px rgba(22,26,32,0.07), inset -1px 0 2px rgba(22,26,32,0.05)',
            }}
          />
        </Box>
      </Box>
    );
  };

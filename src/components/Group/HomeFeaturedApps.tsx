import { useEffect, useRef, useState } from 'react';
import { Avatar, Box, Button, ButtonBase, Typography, useTheme } from '@mui/material';
import { executeEvent } from '../../utils/events';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';
import GlassSurface from '../common/GlassSurface';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
  useDashboardPanelMouseLight,
} from './dashboardPanelEffects';

const RETRY_DELAY_MS = 5000;
const PIRATE_EXPAND_DELAY_MS = 200;
const PIRATE_APP_NAME = 'Pirate Nintendo';
const PIRATE_PREVIEW_VIDEO_SRC = '/pirate-nintendo-preview.mp4';
const FEATURED_APP_NAMES = [
  'Q-Tube',
  'Quitter',
  'Q-Mail',
  'Q-Trade',
  'Q-Blog',
  'Q-Fund',
  PIRATE_APP_NAME,
  'Q-Manager',
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

export const HomeFeaturedApps = () => {
  const theme = useTheme();
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const pirateExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pirateCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPirateExpanded, setIsPirateExpanded] = useState(false);

  useEffect(() => {
    return () => {
      if (pirateExpandTimerRef.current) clearTimeout(pirateExpandTimerRef.current);
      if (pirateCollapseTimerRef.current) clearTimeout(pirateCollapseTimerRef.current);
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

  const schedulePirateExpand = () => {
    if (isPirateExpanded || pirateExpandTimerRef.current) return;
    if (pirateCollapseTimerRef.current) {
      clearTimeout(pirateCollapseTimerRef.current);
      pirateCollapseTimerRef.current = null;
    }
    pirateExpandTimerRef.current = setTimeout(() => {
      pirateExpandTimerRef.current = null;
      setIsPirateExpanded(true);
    }, PIRATE_EXPAND_DELAY_MS);
  };

  const schedulePirateCollapse = () => {
    if (pirateExpandTimerRef.current) {
      clearTimeout(pirateExpandTimerRef.current);
      pirateExpandTimerRef.current = null;
    }
    if (!isPirateExpanded || pirateCollapseTimerRef.current) return;
    pirateCollapseTimerRef.current = setTimeout(() => {
      pirateCollapseTimerRef.current = null;
      setIsPirateExpanded(false);
    }, 70);
  };

  return (
    <Box
      ref={panelRef}
      sx={{
        ...dashboardPanelSx(theme),
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '16px 20px',
        transition: 'border-color 180ms ease, background-color 180ms ease',
        width: '100%',
      }}
      onMouseMove={handleDashboardPanelPointerMove}
      onMouseLeave={handleDashboardPanelPointerLeave}
    >
      <Box
        className="dashboard-panel-decoration"
        aria-hidden="true"
        sx={{
          position: 'absolute',
          left: '0.875%',
          right: '0.875%',
          bottom: '-3px',
          height: '3.3px',
          pointerEvents: 'none',
          zIndex: -1,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0) 12%, rgba(60, 76, 90, 0.12) 26%, rgba(87, 170, 219, 0.252) 40%, rgba(87, 170, 219, 0.648) 46%, rgba(87, 170, 219, 0.774) 50%, rgba(87, 170, 219, 0.648) 54%, rgba(87, 170, 219, 0.252) 60%, rgba(60, 76, 90, 0.12) 74%, rgba(60, 76, 90, 0) 88%, transparent 100%),
               radial-gradient(92% 92% at 50% 0%, rgba(87, 170, 219, 0.27) 0%, rgba(87, 170, 219, 0.144) 30%, rgba(14, 15, 20, 0.035) 52%, transparent 76%)`
            : `linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0) 12%, rgba(60, 76, 90, 0.07) 26%, rgba(60, 76, 90, 0.22) 44%, rgba(60, 76, 90, 0.28) 50%, rgba(60, 76, 90, 0.22) 56%, rgba(60, 76, 90, 0.07) 74%, rgba(60, 76, 90, 0) 88%, transparent 100%),
               radial-gradient(92% 92% at 50% 0%, rgba(60, 76, 90, 0.1) 0%, rgba(60, 76, 90, 0.055) 30%, rgba(14, 15, 20, 0.016) 52%, transparent 76%)`,
          filter: 'blur(0.72px)',
          opacity: 1,
        }}
      />
      {/* Section title */}
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1rem',
          fontWeight: 600,
        }}
      >
        Featured Q-Apps
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gap: '12px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
          alignItems: 'start',
          gridAutoRows: '132px',
          justifyContent: 'stretch',
          position: 'relative',
          width: '100%',
        }}
      >
        {FEATURED_APP_NAMES.map((appName) => (
          <AppTile
            key={appName}
            appName={appName}
            theme={theme}
            isPirateExpanded={isPirateExpanded}
            onPirateExpandStart={schedulePirateExpand}
            onPirateExpandEnd={schedulePirateCollapse}
          />
        ))}
        <PirateExpandedPreview
          theme={theme}
          visible={isPirateExpanded}
          onMouseEnter={() => {
            clearPirateTimers();
          }}
          onMouseLeave={schedulePirateCollapse}
        />
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'center',
          mt: '10px',
          position: 'relative',
        }}
      >
        <Box
          className="dashboard-panel-decoration"
          aria-hidden="true"
          sx={{
            position: 'absolute',
            left: '50%',
            top: '-10px',
            transform: 'translateX(-50%)',
            height: '1px',
            maxWidth: '780px',
            opacity: theme.palette.mode === 'dark' ? 0.9 : 0.7,
            pointerEvents: 'none',
            width: '126%',
            background:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(90deg, transparent 0%, rgba(60,76,90,0.02) 10%, rgba(60,76,90,0.08) 24%, rgba(87,170,219,0.12) 50%, rgba(60,76,90,0.08) 76%, rgba(60,76,90,0.02) 90%, transparent 100%)'
                : 'linear-gradient(90deg, transparent 0%, rgba(60,76,90,0.015) 10%, rgba(60,76,90,0.06) 24%, rgba(87,170,219,0.08) 50%, rgba(60,76,90,0.06) 76%, rgba(60,76,90,0.015) 90%, transparent 100%)',
            filter: 'blur(0.45px)',
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
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.851rem',
            textAlign: 'center',
          }}
        >
          <ButtonBase
            onClick={openAppsLibrary}
            sx={{
              alignItems: 'center',
              color: 'inherit',
              columnGap: '4px',
              display: 'inline-flex',
              fontSize: 'inherit',
              lineHeight: 1,
              textDecoration: 'none',
              transition: 'color 160ms ease',
                '&:hover': {
                  backgroundColor: 'transparent',
                  '& .featured-apps-explore': {
                  color:
                    theme.palette.mode === 'dark'
                      ? theme.palette.common.white
                      : theme.palette.text.primary,
                    filter: 'brightness(1.04)',
                    textShadow:
                      theme.palette.mode === 'dark'
                        ? '0 0 8px rgba(87, 170, 219, 0.22), 0 0 16px rgba(87, 170, 219, 0.08)'
                      : '0 0 8px rgba(87, 170, 219, 0.1)',
                  },
                  '& .featured-apps-all': {
                  color:
                    theme.palette.mode === 'dark'
                      ? theme.palette.common.white
                      : theme.palette.text.primary,
                  },
                },
            }}
          >
            <Box
              component="span"
              className="featured-apps-explore"
              sx={{
                color:
                  theme.palette.mode === 'dark'
                    ? theme.palette.common.white
                    : theme.palette.text.primary,
                display: 'inline-flex',
                fontSize: 'inherit',
                fontWeight: 700,
                lineHeight: 1,
                transition:
                  'color 160ms ease, text-shadow 180ms ease, filter 180ms ease',
              }}
            >
              Explore
            </Box>
            <Box
              component="span"
              className="featured-apps-all"
              sx={{
                color: theme.palette.text.secondary,
                display: 'inline-flex',
                fontSize: 'inherit',
                fontWeight: 400,
                lineHeight: 1,
                transition: 'color 160ms ease',
              }}
            >
              All Q-Apps
            </Box>
          </ButtonBase>
        </Typography>
      </Box>
    </Box>
  );
};

// ---------------------------------------------------------------------------

interface AppTileProps {
  appName: string;
  theme: any;
  isPirateExpanded: boolean;
  onPirateExpandStart: () => void;
  onPirateExpandEnd: () => void;
}

const AppTile = ({
  appName,
  theme,
  isPirateExpanded,
  onPirateExpandStart,
  onPirateExpandEnd,
}: AppTileProps) => {
  const baseAvatarUrl = `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${appName}/qortal_avatar?async=true`;
  const [imageSrc, setImageSrc] = useState(baseAvatarUrl);
  const hasRetriedRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPirateTile = appName === PIRATE_APP_NAME;
  const fadeOutForPiratePreview = isPirateExpanded && !isPirateTile;
  const hideBasePirateTile = isPirateExpanded && isPirateTile;
  const allowTileHover = !isPirateExpanded;

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

  return (
    <ButtonBase
      disableRipple
      onClick={() => openApp(appName)}
      onMouseEnter={isPirateTile ? onPirateExpandStart : undefined}
      onMouseLeave={isPirateTile ? onPirateExpandEnd : undefined}
      sx={{
        alignItems: 'center',
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
        padding: '14px 10px',
        transition:
          'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, opacity 160ms ease',
        position: 'relative',
        width: '100%',
        minHeight: '132px',
        opacity: fadeOutForPiratePreview ? 0 : hideBasePirateTile ? 0 : 1,
        pointerEvents: fadeOutForPiratePreview ? 'none' : 'auto',
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
    </ButtonBase>
  );
};

const PirateExpandedPreview = ({
  theme,
  visible,
  onMouseEnter,
  onMouseLeave,
}: {
  theme: any;
  visible: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) => {
  const baseAvatarUrl = `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${PIRATE_APP_NAME}/qortal_avatar?async=true`;
  const [imageSrc, setImageSrc] = useState(baseAvatarUrl);
  const [hasVideoError, setHasVideoError] = useState(false);

  useEffect(() => {
    setImageSrc(baseAvatarUrl);
  }, [baseAvatarUrl]);

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
        p: '22px',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transform: visible ? 'scale(1)' : 'scale(0.985)',
        transition: 'opacity 220ms ease, transform 220ms ease',
        '& video': {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center center',
          pointerEvents: 'none',
          transform: 'scale(1.035)',
        },
      }}
    >
      {!hasVideoError ? (
        <Box
          component="video"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setHasVideoError(true)}
        >
          <source src={PIRATE_PREVIEW_VIDEO_SRC} type="video/mp4" />
        </Box>
      ) : null}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            pointerEvents: 'none',
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
                  ? 'linear-gradient(180deg, rgba(7,9,13,0.72) 0%, rgba(7,9,13,0.62) 18%, rgba(8,10,14,0.36) 30%, rgba(8,10,14,0.08) 56%, rgba(8,10,14,0) 100%), linear-gradient(90deg, rgba(8,10,14,0.72) 0%, rgba(8,10,14,0.64) 26%, rgba(8,10,14,0.44) 54%, rgba(8,10,14,0.24) 100%), linear-gradient(180deg, rgba(10,12,16,0.68) 0%, rgba(10,12,16,0.54) 26%, rgba(10,12,16,0.42) 54%, rgba(10,12,16,0.56) 100%), radial-gradient(120% 82% at 50% 8%, rgba(87,170,219,0.038) 0%, rgba(87,170,219,0.014) 24%, rgba(10,12,16,0) 58%), linear-gradient(180deg, rgba(255,255,255,0.008) 0%, rgba(255,255,255,0) 24%)'
                  : 'linear-gradient(180deg, rgba(20,24,30,0.4) 0%, rgba(20,24,30,0.32) 18%, rgba(20,24,30,0.16) 30%, rgba(20,24,30,0.04) 56%, rgba(20,24,30,0) 100%), linear-gradient(90deg, rgba(18,22,28,0.58) 0%, rgba(18,22,28,0.5) 26%, rgba(18,22,28,0.34) 54%, rgba(18,22,28,0.18) 100%), linear-gradient(180deg, rgba(22,26,32,0.54) 0%, rgba(22,26,32,0.38) 26%, rgba(22,26,32,0.32) 54%, rgba(22,26,32,0.44) 100%), radial-gradient(120% 82% at 50% 8%, rgba(87,170,219,0.03) 0%, rgba(87,170,219,0.012) 24%, rgba(22,26,32,0) 58%), linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0) 24%)',
              pointerEvents: 'none',
              zIndex: 0,
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
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', mb: '18px', position: 'relative', zIndex: 1, pl: '24px', pr: '14px', pt: '24px' }}>
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
                {PIRATE_APP_NAME.charAt(0)}
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
                Pirate Nintendo
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
              Play and grow a community-powered retro game library.
            </Typography>
            <Box sx={{ pt: '6px', pointerEvents: 'auto' }}>
              <Button
                onClick={() => openApp(PIRATE_APP_NAME)}
                variant="contained"
                  sx={{
                    borderRadius: '11px',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    minWidth: '138px',
                  minHeight: '42px',
                    px: 2.2,
                    py: 0.9,
                    textTransform: 'none',
                    background:
                      theme.palette.mode === 'dark'
                        ? 'linear-gradient(180deg, rgba(118, 164, 230, 0.9) 0%, rgba(104, 146, 206, 0.88) 100%)'
                        : 'linear-gradient(180deg, rgba(126, 171, 233, 0.88) 0%, rgba(111, 153, 214, 0.86) 100%)',
                    color: '#172132',
                    border: '1px solid rgba(255,255,255,0.06)',
                    backdropFilter: 'blur(2px)',
                    WebkitBackdropFilter: 'blur(2px)',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow:
                      theme.palette.mode === 'dark'
                        ? '0 14px 30px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)'
                        : '0 14px 28px rgba(28,36,52,0.18), 0 4px 10px rgba(28,36,52,0.1), inset 0 1px 0 rgba(255,255,255,0.07)',
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
                      background:
                        theme.palette.mode === 'dark'
                          ? 'linear-gradient(180deg, rgba(126, 172, 236, 0.92) 0%, rgba(112, 154, 214, 0.9) 100%)'
                          : 'linear-gradient(180deg, rgba(132, 176, 237, 0.9) 0%, rgba(117, 159, 220, 0.88) 100%)',
                      filter: 'brightness(1.05)',
                      boxShadow:
                        theme.palette.mode === 'dark'
                          ? '0 16px 34px rgba(0,0,0,0.34), 0 5px 14px rgba(0,0,0,0.22), 0 0 18px rgba(120, 167, 230, 0.16), inset 0 1px 0 rgba(255,255,255,0.06)'
                          : '0 16px 30px rgba(28,36,52,0.2), 0 5px 12px rgba(28,36,52,0.12), 0 0 14px rgba(122, 166, 227, 0.14), inset 0 1px 0 rgba(255,255,255,0.08)',
                      transform: 'none',
                    },
                    '&:active': {
                      filter: 'none',
                      transform: 'none',
                      boxShadow:
                        theme.palette.mode === 'dark'
                          ? '0 8px 18px rgba(0,0,0,0.24), 0 2px 6px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.05)'
                          : '0 8px 16px rgba(28,36,52,0.12), 0 2px 5px rgba(28,36,52,0.08), inset 0 1px 0 rgba(255,255,255,0.07)',
                    },
                  }}
                >
                Open Q-App
              </Button>
            </Box>
          </Box>
            <Box sx={{ flex: 1, minHeight: '150px', position: 'relative', zIndex: 1 }} />
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

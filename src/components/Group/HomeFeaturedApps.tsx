import { useEffect, useRef, useState } from 'react';
import { Avatar, Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { executeEvent } from '../../utils/events';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
  useDashboardPanelMouseLight,
} from './dashboardPanelEffects';

const RETRY_DELAY_MS = 5000;
const FEATURED_APP_NAMES = [
  'Q-Tube',
  'Quitter',
  'Q-Mail',
  'Q-Trade',
  'Q-Blog',
  'Q-Fund',
  'Pirate Nintendo',
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
          width: '100%',
        }}
      >
        {FEATURED_APP_NAMES.map((appName) => (
          <AppTile key={appName} appName={appName} theme={theme} />
        ))}
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
                  color: theme.palette.common.white,
                  filter: 'brightness(1.04)',
                  textShadow:
                    theme.palette.mode === 'dark'
                      ? '0 0 8px rgba(87, 170, 219, 0.22), 0 0 16px rgba(87, 170, 219, 0.08)'
                      : '0 0 8px rgba(87, 170, 219, 0.16)',
                },
                '& .featured-apps-all': {
                  color: theme.palette.common.white,
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
}

const AppTile = ({ appName, theme }: Omit<AppTileProps, 'label'>) => {
  const baseAvatarUrl = `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${appName}/qortal_avatar?async=true`;
  const [imageSrc, setImageSrc] = useState(baseAvatarUrl);
  const hasRetriedRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      sx={{
        alignItems: 'center',
        bgcolor: '#181a20',
        border: `1px solid ${theme.palette.border.subtle}`,
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        justifyContent: 'center',
        padding: '14px 10px',
        transition:
          'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 120ms ease',
        position: 'relative',
        width: '100%',
        minHeight: '132px',
        boxShadow:
          theme.palette.mode === 'dark'
            ? 'inset 0 1px 0 rgba(255,255,255,0.035), inset 0 -10px 18px rgba(0,0,0,0.22)'
            : 'inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -8px 14px rgba(15,23,42,0.08)',
        '&:hover': {
          bgcolor: '#181a20',
          borderColor: theme.palette.border.main,
          boxShadow:
            theme.palette.mode === 'dark'
              ? 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -10px 18px rgba(0,0,0,0.24), 0 8px 18px rgba(0,0,0,0.1)'
              : 'inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -8px 14px rgba(15,23,42,0.08), 0 8px 18px rgba(0,0,0,0.1)',
          transform: 'translateY(-1px)',
        },
        '&:active': {
          boxShadow:
            theme.palette.mode === 'dark'
              ? 'inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -8px 14px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)'
              : 'inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -8px 14px rgba(15,23,42,0.07), 0 2px 8px rgba(0,0,0,0.1)',
          transform: 'translateY(0)',
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

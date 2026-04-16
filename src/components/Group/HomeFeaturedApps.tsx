import { useEffect, useRef, useState } from 'react';
import { Avatar, Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { executeEvent } from '../../utils/events';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
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

export const HomeFeaturedApps = () => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        ...dashboardPanelSx(theme),
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: '14px',
        minHeight: { md: '382px' },
        padding: '16px 20px',
        transition: 'border-color 180ms ease, background-color 180ms ease',
        width: '100%',
      }}
      onMouseMove={handleDashboardPanelPointerMove}
      onMouseLeave={handleDashboardPanelPointerLeave}
    >
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
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(132px, 132px))',
            sm: 'repeat(2, minmax(132px, 132px))',
            md: 'repeat(4, minmax(132px, 132px))',
          },
          alignItems: 'start',
          gridAutoRows: '132px',
          justifyContent: {
            xs: 'center',
            md: 'start',
          },
          width: '100%',
        }}
      >
        {FEATURED_APP_NAMES.map((appName) => (
          <AppTile key={appName} appName={appName} theme={theme} />
        ))}
      </Box>

      <Typography
        sx={{
          color: theme.palette.text.secondary,
          fontSize: '0.74rem',
          mt: '10px',
          textAlign: 'center',
        }}
      >
        <ButtonBase
          onClick={() => executeEvent('open-apps-mode', {})}
          sx={{
            color: theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.text.primary,
            fontSize: 'inherit',
            fontWeight: 700,
            mr: '4px',
            textDecoration: 'none',
            '&:hover': {
              backgroundColor: 'transparent',
            },
          }}
        >
          Explore
        </ButtonBase>
        All Q-Apps
      </Typography>
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
        bgcolor: theme.palette.background.surface,
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
        width: '132px',
        minHeight: '132px',
        '&:hover': {
          bgcolor: theme.palette.background.elevated,
          borderColor: theme.palette.border.main,
          boxShadow: '0 8px 18px rgba(0,0,0,0.1)',
          transform: 'translateY(-1px)',
        },
        '&:active': {
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          transform: 'translateY(0)',
        },
        '&:focus-visible': {
          backgroundColor: theme.palette.background.elevated,
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

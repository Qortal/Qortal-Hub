import { Avatar, Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../utils/events';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';
import { officialAppsConfig } from '../Apps/config/officialApps';

const openApp = (appName: string) => {
  executeEvent('addTab', { data: { service: 'APP', name: appName } });
  executeEvent('open-apps-mode', {});
};

export const HomeFeaturedApps = () => {
  const { t } = useTranslation(['tutorial']);
  const theme = useTheme();

  return (
    <Box
      sx={{
        bgcolor: theme.palette.background.paper,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px 20px',
        width: '100%',
      }}
    >
      {/* Section title */}
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1rem',
          fontWeight: 600,
        }}
      >
        {t('tutorial:home.featured_apps')}
      </Typography>

      {/* Horizontally scrollable app row */}
      <Box
        sx={{
          display: 'flex',
          gap: '12px',
          justifyContent: 'center',
          overflowX: 'auto',
          pb: '4px', // prevent clipping box-shadows on scroll
          // Hide scrollbar visually while keeping it functional
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {officialAppsConfig.featured.map((appName) => (
          <AppTile
            key={appName}
            appName={appName}
            theme={theme}
          />
        ))}
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
  const avatarUrl = `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${appName}/qortal_avatar?async=true`;

  return (
    <ButtonBase
      onClick={() => openApp(appName)}
      sx={{
        alignItems: 'center',
        bgcolor: theme.palette.background.default,
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        gap: '8px',
        padding: '14px 10px',
        width: '120px',
        '&:hover': { bgcolor: theme.palette.action.hover },
      }}
    >
      <Avatar
        src={avatarUrl}
        variant="rounded"
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

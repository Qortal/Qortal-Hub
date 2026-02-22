import { Avatar, Box, Button, Typography, useTheme } from '@mui/material';
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
            label={t('tutorial:home.open_app', { postProcess: 'capitalizeFirstChar' })}
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
  label: string;
  theme: any;
}

const AppTile = ({ appName, label, theme }: AppTileProps) => {
  const avatarUrl = `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${appName}/qortal_avatar?async=true`;

  return (
    <Box
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

      <Button
        onClick={() => openApp(appName)}
        size="small"
        variant="outlined"
        sx={{ borderRadius: '50px', fontSize: '0.75rem', textTransform: 'none', width: '100%' }}
      >
        {label}
      </Button>
    </Box>
  );
};

import { Box, Button, Typography, useTheme } from '@mui/material';
import BuildIcon from '@mui/icons-material/Build';
import GroupsIcon from '@mui/icons-material/Groups';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../utils/events';

// TODO: replace with real group IDs once confirmed
const CORE_SUPPORT_GROUP = { id: 120, name: 'Qortal-CORE-Support' };
const DEVNET_TESTING_GROUP = { id: 269, name: 'Q-App-DevNet-Testing' };

interface HomeDeveloperTabProps {
  getTimestampEnterChat: () => void;
  setDesktopViewMode: (mode: string) => void;
  setGroupSection: (section: string) => void;
  setMobileViewMode: (mode: string) => void;
  setSelectedGroup: (group: any) => void;
}

export const HomeDeveloperTab = ({
  getTimestampEnterChat,
  setDesktopViewMode,
  setGroupSection,
  setMobileViewMode,
  setSelectedGroup,
}: HomeDeveloperTabProps) => {
  const { t } = useTranslation(['tutorial']);
  const theme = useTheme();

  const openApp = (appName: string) => {
    executeEvent('addTab', { data: { service: 'APP', name: appName } });
    executeEvent('open-apps-mode', {});
  };

  const openGroup = (group: { id: number; name: string }) => {
    setSelectedGroup({ groupId: String(group.id), groupName: group.name });
    setMobileViewMode('group');
    getTimestampEnterChat();
    setGroupSection('default');
    setDesktopViewMode('chat');
  };

  const cards = [
    {
      key: 'qtube_tutorial',
      icon: <VideoLibraryIcon sx={{ color: theme.palette.primary.main, fontSize: '1.8rem' }} />,
      title: t('tutorial:home.qtube_tutorial'),
      description: t('tutorial:home.qtube_tutorial_desc'),
      onAction: () => openApp('q-tube'),
    },
    {
      key: 'core_support',
      icon: <GroupsIcon sx={{ color: theme.palette.primary.main, fontSize: '1.8rem' }} />,
      title: t('tutorial:home.core_support'),
      description: t('tutorial:home.core_support_desc'),
      onAction: () => openGroup(CORE_SUPPORT_GROUP),
    },
    {
      key: 'devnet_testing',
      icon: <BuildIcon sx={{ color: theme.palette.primary.main, fontSize: '1.8rem' }} />,
      title: t('tutorial:home.devnet_testing'),
      description: t('tutorial:home.devnet_testing_desc'),
      onAction: () => openGroup(DEVNET_TESTING_GROUP),
    },
  ];

  return (
    <Box
      sx={{
        bgcolor: theme.palette.background.paper,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '16px 20px',
        width: '100%',
      }}
    >
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1rem',
          fontWeight: 600,
          mb: '4px',
        }}
      >
        {t('tutorial:home.developer_resources')}
      </Typography>

      {cards.map((card) => (
        <Box
          key={card.key}
          sx={{
            alignItems: 'center',
            bgcolor: theme.palette.background.default,
            borderRadius: '10px',
            display: 'flex',
            gap: '16px',
            padding: '14px 16px',
          }}
        >
          {/* Icon */}
          <Box sx={{ flexShrink: 0 }}>{card.icon}</Box>

          {/* Title + description */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: '0.9rem',
                fontWeight: 600,
              }}
            >
              {card.title}
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.78rem',
              }}
            >
              {card.description}
            </Typography>
          </Box>

          {/* Action button */}
          <Button
            onClick={card.onAction}
            size="small"
            variant="outlined"
            sx={{ flexShrink: 0, fontSize: '0.78rem' }}
          >
            {t('tutorial:home.open')}
          </Button>
        </Box>
      ))}
    </Box>
  );
};

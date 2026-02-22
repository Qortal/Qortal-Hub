import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { featuredGroups } from '../../data/featuredGroups';
import { HomeGroupCard } from './HomeGroupCard';

interface HomeFeaturedGroupsProps {
  getTimestampEnterChat: () => void;
  setDesktopViewMode: (mode: string) => void;
  setGroupSection: (section: string) => void;
  setMobileViewMode: (mode: string) => void;
  setSelectedGroup: (group: any) => void;
}

export const HomeFeaturedGroups = ({
  getTimestampEnterChat,
  setDesktopViewMode,
  setGroupSection,
  setMobileViewMode,
  setSelectedGroup,
}: HomeFeaturedGroupsProps) => {
  const { t } = useTranslation(['tutorial']);
  const theme = useTheme();

  const handleGroupClick = (group: (typeof featuredGroups)[number]) => {
    setSelectedGroup({ groupId: String(group.id), groupName: group.name });
    setMobileViewMode('group');
    getTimestampEnterChat();
    setGroupSection('default');
    setDesktopViewMode('chat');
  };

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
        {t('tutorial:home.featured_groups')}
      </Typography>

      {featuredGroups.map((group) => (
        <HomeGroupCard
          key={group.id}
          group={group}
          onClick={() => handleGroupClick(group)}
        />
      ))}
    </Box>
  );
};

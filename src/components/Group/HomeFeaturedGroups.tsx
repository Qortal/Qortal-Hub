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
        gap: '12px',
        padding: '16px 20px',
        width: '100%',
      }}
    >
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1rem',
          fontWeight: 600,
        }}
      >
        {t('tutorial:home.featured_groups')}
      </Typography>

      {/* Horizontally scrollable group card row */}
      <Box
        sx={{
          display: 'flex',
          gap: '12px',
          justifyContent: 'center',
          overflowX: 'auto',
          pb: '4px',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {featuredGroups.map((group) => (
          <HomeGroupCard
            key={group.id}
            group={group}
            onClick={() => handleGroupClick(group)}
          />
        ))}
      </Box>
    </Box>
  );
};

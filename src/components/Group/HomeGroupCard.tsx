import { Avatar, Box, Button, Typography, useTheme } from '@mui/material';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { groupsOwnerNamesSelector } from '../../atoms/global';
import { getBaseApiReact } from '../../App';
import { FeaturedGroup } from '../../data/featuredGroups';

interface HomeGroupCardProps {
  group: FeaturedGroup;
  onClick: () => void;
}

export const HomeGroupCard = ({ group, onClick }: HomeGroupCardProps) => {
  const { t } = useTranslation(['tutorial']);
  const theme = useTheme();
  const ownerName = useAtomValue(groupsOwnerNamesSelector(String(group.id)));

  const avatarUrl = ownerName
    ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${ownerName}/qortal_group_avatar_${group.id}?async=true`
    : null;

  // Two-letter fallback label (e.g. "QG" from "Qortal-General-Chat")
  const fallbackLabel = group.name
    .split(/[-\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  return (
    <Box
      sx={{
        alignItems: 'center',
        bgcolor: theme.palette.background.default,
        borderRadius: '10px',
        display: 'flex',
        gap: '12px',
        padding: '12px 14px',
        width: '100%',
      }}
    >
      {/* Logo */}
      <Avatar
        src={avatarUrl ?? undefined}
        variant="rounded"
        sx={{
          bgcolor: theme.palette.primary.main,
          flexShrink: 0,
          fontSize: '0.8rem',
          fontWeight: 700,
          height: 44,
          width: 44,
        }}
      >
        {fallbackLabel}
      </Avatar>

      {/* Name + description */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '0.9rem',
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {group.name}
        </Typography>
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.78rem',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {group.description}
        </Typography>
      </Box>

      {/* View button */}
      <Button
        onClick={onClick}
        size="small"
        variant="outlined"
        sx={{ borderRadius: '50px', flexShrink: 0, fontSize: '0.78rem', textTransform: 'none' }}
      >
        {t('tutorial:home.view_group', { postProcess: 'capitalizeFirstChar' })}
      </Button>
    </Box>
  );
};

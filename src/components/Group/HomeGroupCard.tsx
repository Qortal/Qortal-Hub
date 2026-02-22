import { Avatar, Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { useAtomValue } from 'jotai';
import { groupsOwnerNamesSelector } from '../../atoms/global';
import { getBaseApiReact } from '../../App';
import { FeaturedGroup } from '../../data/featuredGroups';

interface HomeGroupCardProps {
  group: FeaturedGroup;
  onClick: () => void;
}

export const HomeGroupCard = ({ group, onClick }: HomeGroupCardProps) => {
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
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: 'center',
        bgcolor: theme.palette.background.default,
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        gap: '8px',
        padding: '14px 10px',
        width: '160px',
        '&:hover': { bgcolor: theme.palette.action.hover },
      }}
    >
      {/* Avatar */}
      <Avatar
        src={avatarUrl ?? undefined}
        variant="rounded"
        sx={{
          bgcolor: theme.palette.primary.main,
          fontSize: '0.85rem',
          fontWeight: 700,
          height: 52,
          width: 52,
        }}
      >
        {fallbackLabel}
      </Avatar>

      {/* Name */}
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '0.82rem',
          fontWeight: 600,
          maxWidth: '140px',
          overflow: 'hidden',
          textAlign: 'center',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {group.name}
      </Typography>

      {/* Description */}
      <Typography
        sx={{
          color: theme.palette.text.secondary,
          display: '-webkit-box',
          fontSize: '0.72rem',
          lineHeight: 1.3,
          overflow: 'hidden',
          textAlign: 'center',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          flex: 1,
        }}
      >
        {group.description}
      </Typography>
    </ButtonBase>
  );
};

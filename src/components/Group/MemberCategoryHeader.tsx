import { ReactNode } from 'react';
import {
  alpha,
  Box,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';

export type MemberCategoryType =
  | 'admins'
  | 'lounge'
  | 'park'
  | 'members'
  | 'offline';

type Props = {
  count: number;
  totalCount?: number;
  expanded: boolean;
  first: boolean;
  icon: ReactNode;
  label: string;
  onToggle: () => void;
  type: MemberCategoryType;
};

const CategoryMotif = ({ type }: { type: MemberCategoryType }) => {
  if (type === 'admins') {
    return (
      <svg aria-hidden="true" viewBox="0 0 120 44">
        <path
          d="M82-8 118 6l-4 23c-3 11-14 19-32 25-18-6-29-14-32-25L46 6 82-8Zm-21 35h42l-3-15-10 11-8-14-8 14-10-11-3 15Zm5 5h32v4H66v-4Z"
          fill="currentColor"
          fillOpacity="0.9"
          fillRule="evenodd"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      </svg>
    );
  }

  if (type === 'lounge') {
    return (
      <svg aria-hidden="true" viewBox="0 0 120 44">
        <path
          d="M50 19V9c0-6 5-10 11-10h38c7 0 11 4 11 10v10H50Z"
          fill="currentColor"
          fillOpacity="0.88"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.4"
        />
        <path
          d="M47 24h66v16H47V24Z"
          fill="currentColor"
          fillOpacity="0.88"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.4"
        />
        <path
          d="M34 27c0-6 4-10 10-10h3v23H34V27Zm79-10h3c6 0 10 4 10 10v13h-13V17Z"
          fill="currentColor"
          fillOpacity="0.88"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.4"
        />
      </svg>
    );
  }

  if (type === 'park') {
    return (
      <svg aria-hidden="true" viewBox="0 0 120 44">
        <path
          d="M54 49C38 22 53-4 104-10c5 35-11 55-50 59Z"
          fill="currentColor"
          fillOpacity="0.86"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
        <path
          d="M51 46C67 27 82 11 105-6"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
    );
  }

  if (type === 'offline') {
    return (
      <svg aria-hidden="true" viewBox="0 0 120 44">
        <g fill="currentColor">
          <path d="M48 28h19v4L55 41h12v4H48v-4l12-9H48v-4Z" />
          <path d="M66 16h22v4L74 30h14v4H66v-4l15-10H66v-4Z" />
          <path d="M88 3h26v5L97 20h17v5H88v-5l18-12H88V3Z" />
          <path d="M107-9h31v6l-20 14h20v6h-31v-6l22-14h-22v-6Z" />
        </g>
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 120 44">
      <path
        d="M31 42 55 16l24 15 25-24 22 16"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
      <g fill="currentColor">
        <circle cx="31" cy="42" r="7" />
        <circle cx="55" cy="16" r="8" />
        <circle cx="79" cy="31" r="10" />
        <circle cx="104" cy="7" r="9" />
        <circle cx="126" cy="23" r="7" />
      </g>
    </svg>
  );
};

export const MemberCategoryHeader = ({
  count,
  totalCount,
  expanded,
  first,
  icon,
  label,
  onToggle,
  type,
}: Props) => {
  const theme = useTheme();
  const accentByType: Record<MemberCategoryType, string> = {
    admins: theme.palette.mode === 'dark' ? '#67c7dc' : '#16718d',
    lounge: theme.palette.mode === 'dark' ? '#a68bd7' : '#7152a1',
    park: theme.palette.mode === 'dark' ? '#72b89e' : '#347d63',
    members: theme.palette.mode === 'dark' ? '#6ca6cf' : '#356f9c',
    offline: theme.palette.mode === 'dark' ? '#8d94a3' : '#5f6673',
  };
  const baseGraphicOpacity = theme.palette.mode === 'dark' ? 0.1 : 0.095;
  const graphicOpacity = baseGraphicOpacity + (expanded ? 0.02 : 0);
  const surfaceTintOpacity =
    theme.palette.mode === 'dark'
      ? expanded
        ? 0.03
        : 0.018
      : expanded
        ? 0.045
        : 0.032;

  return (
    <Box
      onClick={onToggle}
      sx={{
        alignItems: 'center',
        backgroundColor: alpha(accentByType[type], surfaceTintOpacity),
        border: `1px solid ${alpha(theme.palette.divider, expanded ? 0.72 : 0.5)}`,
        borderRadius: '7px',
        boxSizing: 'border-box',
        cursor: 'pointer',
        contain: 'paint',
        display: 'flex',
        height: first ? '100%' : 'calc(100% - 6px)',
        isolation: 'isolate',
        mt: first ? 0 : 0.75,
        overflow: 'hidden',
        px: 0.75,
        position: 'relative',
        transition:
          'background-color 160ms ease, border-color 160ms ease',
        '&:hover': {
          backgroundColor: alpha(
            accentByType[type],
            theme.palette.mode === 'dark' ? 0.04 : 0.032
          ),
          borderColor: alpha(theme.palette.divider, 0.9),
          '& .member-category-motif': {
            opacity: Math.min(graphicOpacity + 0.025, 0.145),
          },
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '& .member-category-motif': {
            transition: 'none',
          },
        },
      }}
    >
      <Box
        aria-hidden="true"
        className="member-category-motif"
        sx={{
          bottom: 0,
          color: accentByType[type],
          left: '48%',
          maskImage:
            'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.28) 20%, #000 48%, #000 100%)',
          WebkitMaskImage:
            'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.28) 20%, #000 48%, #000 100%)',
          opacity: graphicOpacity,
          pointerEvents: 'none',
          position: 'absolute',
          right: -12,
          top: 0,
          transform: 'scale(1.18)',
          transformOrigin: 'center right',
          transition: 'opacity 160ms ease',
          zIndex: 0,
          '& svg': {
            display: 'block',
            height: '100%',
            width: '100%',
          },
        }}
      >
        <CategoryMotif type={type} />
      </Box>

      <Box
        aria-hidden="true"
        sx={{
          background: `linear-gradient(90deg, ${
            theme.palette.mode === 'dark'
              ? alpha(theme.palette.background.paper, 0.28)
              : alpha(theme.palette.background.paper, 0.2)
          } 0%, transparent 68%)`,
          inset: 0,
          pointerEvents: 'none',
          position: 'absolute',
          zIndex: 0,
        }}
      />

      <Box
        sx={{
          alignItems: 'center',
          color: accentByType[type],
          display: 'flex',
          flexShrink: 0,
          fontSize: 17,
          mr: 0.75,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {icon}
      </Box>
      <Typography
        sx={{
          flex: 1,
          fontSize: 11,
          fontWeight: 750,
          letterSpacing: '0.06em',
          minWidth: 0,
          position: 'relative',
          textTransform: 'uppercase',
          zIndex: 1,
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          color: 'text.secondary',
          flexShrink: 0,
          fontSize: 11,
          mr: 0.25,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {totalCount == null ? count : `${count}/${totalCount}`}
      </Typography>
      <IconButton
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
        size="small"
        sx={{
          color: 'text.secondary',
          flexShrink: 0,
          p: 0.25,
          pointerEvents: 'none',
          position: 'relative',
          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 140ms ease',
          zIndex: 1,
        }}
      >
        <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Box>
  );
};

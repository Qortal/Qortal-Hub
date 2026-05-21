import { Badge, Box, Tooltip, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ReactNode } from 'react';
import type { UserStatus } from '../../atoms/presence';
import { statusDotColor } from '../../hooks/usePresence';

type PresenceStatus = UserStatus | 'offline' | null;

type PresenceStatusBadgeProps = {
  children: ReactNode;
  online?: boolean;
  status: PresenceStatus;
};

const getPresenceLabel = (status: Exclude<PresenceStatus, null>) => {
  if (status === 'busy') return 'Busy';
  if (status === 'idle') return 'Idle';
  if (status === 'offline') return 'Offline';
  return 'Online';
};

export const PresenceStatusBadge = ({
  children,
  online,
  status,
}: PresenceStatusBadgeProps) => {
  const theme = useTheme();
  const effectiveStatus: Exclude<PresenceStatus, null> =
    online === false || !status ? 'offline' : status;
  const label = getPresenceLabel(effectiveStatus);
  const isIdle = effectiveStatus === 'idle';
  const isOffline = effectiveStatus === 'offline';
  const tooltipBackground = alpha(theme.palette.background.paper, 0.98);
  const statusColor = statusDotColor(effectiveStatus);

  const dotCutout = isIdle
    ? {
        backgroundColor: theme.palette.background.paper,
        borderRadius: '50%',
        content: '""',
        height: 8,
        left: -1,
        position: 'absolute',
        top: -1,
        width: 8,
      }
    : undefined;

  const tooltipDotCutout = isIdle
    ? {
        backgroundColor: tooltipBackground,
        borderRadius: '50%',
        content: '""',
        height: 6,
        left: -1,
        position: 'absolute',
        top: -1,
        width: 6,
      }
    : undefined;

  return (
    <Badge
      overlap="circular"
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      badgeContent={
        <Tooltip
          arrow
          placement="top"
          enterDelay={180}
          title={
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: '8px',
                px: '2px',
                py: '1px',
              }}
            >
              <Box
                sx={{
                  background: isOffline ? 'transparent' : statusColor,
                  borderRadius: '50%',
                  border: isOffline ? `2px solid ${statusColor}` : 'none',
                  boxSizing: 'border-box',
                  height: 8,
                  position: 'relative',
                  width: 8,
                  '&::after': tooltipDotCutout,
                }}
              />
              <Typography
                component="span"
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0,
                  lineHeight: 1.2,
                }}
              >
                {label}
              </Typography>
            </Box>
          }
          slotProps={{
            tooltip: {
              sx: {
                backgroundColor: tooltipBackground,
                border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
                borderRadius: '8px',
                boxShadow: theme.shadows[8],
                color: theme.palette.text.primary,
                px: '10px',
                py: '7px',
              },
            },
            arrow: {
              sx: {
                color: tooltipBackground,
                '&::before': {
                  border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
                },
              },
            },
          }}
        >
          <Box
            aria-label={`${label} status`}
            sx={{
              background: isOffline ? theme.palette.background.paper : statusColor,
              border: `3px solid ${theme.palette.background.paper}`,
              borderRadius: '50%',
              boxSizing: 'content-box',
              boxShadow: isOffline ? `inset 0 0 0 2px ${statusColor}` : 'none',
              height: 11,
              minWidth: 11,
              position: 'relative',
              width: 11,
              '&::after': dotCutout,
            }}
          />
        </Tooltip>
      }
      sx={{
        '& .MuiBadge-badge': {
          backgroundColor: 'transparent',
          height: 'auto',
          minWidth: 0,
          padding: 0,
        },
      }}
    >
      {children}
    </Badge>
  );
};

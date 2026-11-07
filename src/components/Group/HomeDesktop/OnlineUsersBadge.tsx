import { Box, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { onlineUserCountAtom } from '../../../atoms/presence';

export const OnlineUsersBadge = memo(function OnlineUsersBadge() {
  const onlineUserCount = useAtomValue(onlineUserCountAtom);
  const theme = useTheme();
  const { t } = useTranslation('group');

  return (
    <Box
      component="span"
      sx={{
        alignItems: 'center',
        bgcolor: alpha(theme.palette.success.main, 0.08),
        border: `1px solid ${alpha(theme.palette.success.main, 0.16)}`,
        borderRadius: '999px',
        color: alpha(theme.palette.text.primary, 0.72),
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: '0.68rem',
        fontWeight: 700,
        gap: '6px',
        letterSpacing: '0.045em',
        lineHeight: 1,
        px: '8px',
        py: '5px',
      }}
      title={t('group:dashboard.online_users_count', {
        defaultValue: 'Online users',
      })}
    >
      <Box
        component="span"
        sx={{
          bgcolor: theme.palette.success.main,
          borderRadius: '50%',
          boxShadow: `0 0 0 3px ${alpha(theme.palette.success.main, 0.14)}`,
          height: 6,
          width: 6,
        }}
      />
      {t('group:dashboard.online_users_count_value', {
        count: onlineUserCount,
        defaultValue: '{{count}} online',
      })}
    </Box>
  );
});

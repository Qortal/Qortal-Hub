import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Paper, Typography, useTheme } from '@mui/material';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';

type Payload = { text1?: string };

type AppInfo = { name?: string; tabId?: string };

type PendingRequest = {
  requestId: string;
  appInfo: AppInfo;
  payload: Payload;
};

const defaultPayload: Payload = {
  text1: 'Allow this app to send you Hub notifications?',
};

function sendResponse(requestId: string, result: { accepted: boolean }) {
  window.postMessage(
    {
      action: 'NOTIFICATION_PERMISSION_RESPONSE',
      requestId,
      result,
    },
    window.location.origin
  );
}

export function NotificationPermissionSlideDown() {
  const { t } = useTranslation('question');
  const theme = useTheme();
  const [pending, setPending] = useState<PendingRequest | null>(null);

  useEffect(() => {
    const listener = (e: CustomEvent<PendingRequest>) => {
      const { requestId, appInfo, payload } = e.detail || {};
      if (requestId && appInfo) {
        setPending({ requestId, appInfo, payload: payload || defaultPayload });
      }
    };
    subscribeToEvent('show-notification-permission', listener);
    return () => unsubscribeFromEvent('show-notification-permission', listener);
  }, []);

  const handleAllow = () => {
    if (!pending) return;
    sendResponse(pending.requestId, { accepted: true });
    setPending(null);
  };

  const handleDontAllow = () => {
    if (!pending) return;
    sendResponse(pending.requestId, { accepted: false });
    setPending(null);
  };

  if (!pending) return null;

  const { appInfo, payload } = pending;
  const text1 = payload?.text1 ?? defaultPayload.text1;

  const isDark = theme.palette.mode === 'dark';
  const iconBg = isDark
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(0, 0, 0, 0.04)';

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: theme.zIndex.modal + 10,
        borderRadius: 0,
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        borderBottom: `1px solid ${theme.palette.divider}`,
        borderLeft: `1px solid ${theme.palette.divider}`,
        borderRight: `1px solid ${theme.palette.divider}`,
        overflow: 'hidden',
        animation: 'slideDown 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        '@keyframes slideDown': {
          from: { transform: 'translateY(-100%)', opacity: 0 },
          to: { transform: 'translateY(0)', opacity: 1 },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          p: 2.5,
          maxWidth: 400,
          mx: 'auto',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: '12px',
              bgcolor: iconBg,
              flexShrink: 0,
            }}
          >
            <NotificationsActiveIcon
              sx={{
                color: theme.palette.primary.main,
                fontSize: 26,
              }}
            />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="subtitle1"
              fontWeight={700}
              sx={{ lineHeight: 1.3, mb: 0.5 }}
            >
              {t('permission.notification_title', {
                appName: appInfo?.name || 'App',
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ lineHeight: 1.5 }}
            >
              {text1}
            </Typography>
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            gap: 1.5,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <Button
            size="medium"
            variant="text"
            onClick={handleDontAllow}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              color: 'text.secondary',
              '&:hover': {
                bgcolor: isDark
                  ? 'rgba(255, 255, 255, 0.06)'
                  : 'rgba(0, 0, 0, 0.04)',
              },
            }}
          >
            {t('permission.notification_dont_allow', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
          <Button
            size="medium"
            variant="contained"
            onClick={handleAllow}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              px: 2.5,
              borderRadius: 2,
              boxShadow: 1,
              '&:hover': {
                boxShadow: 2,
              },
            }}
          >
            {t('permission.notification_allow', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}

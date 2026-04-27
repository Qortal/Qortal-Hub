import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import { Box, Button, Paper, Typography, alpha, useTheme } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';

const TIMEOUT_MS = 60_000;
const TIMEOUT_S = TIMEOUT_MS / 1000;

type PendingRequest = {
  requestId: string;
  appInfo: { name?: string };
  payload?: { text1?: string };
  expiresAt: number;
};

function sendResponse(requestId: string, accepted: boolean) {
  window.postMessage(
    {
      action: 'NOTIFICATION_PERMISSION_RESPONSE',
      requestId,
      result: { accepted },
    },
    window.location.origin
  );
}

export function NotificationPermissionSlideDown() {
  const { t } = useTranslation('question');
  const theme = useTheme();
  const [queue, setQueue] = useState<PendingRequest[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_S);
  const autoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const listener = (event: CustomEvent<Omit<PendingRequest, 'expiresAt'>>) => {
      const { requestId, appInfo, payload } = event.detail || {};
      if (!requestId || !appInfo) return;
      setQueue((prev) => [
        ...prev,
        {
          requestId,
          appInfo,
          payload,
          expiresAt: Date.now() + TIMEOUT_MS,
        },
      ]);
    };
    subscribeToEvent('show-notification-permission', listener as any);
    return () =>
      unsubscribeFromEvent('show-notification-permission', listener as any);
  }, []);

  useEffect(() => {
    if (autoTimeoutRef.current) clearTimeout(autoTimeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);

    const current = queue[0];
    if (!current) return;

    const remaining = Math.max(0, current.expiresAt - Date.now());
    setSecondsLeft(Math.ceil(remaining / 1000));
    autoTimeoutRef.current = setTimeout(() => {
      sendResponse(current.requestId, false);
      setQueue((prev) => prev.slice(1));
    }, remaining);
    intervalRef.current = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000)));
    }, 500);

    return () => {
      if (autoTimeoutRef.current) clearTimeout(autoTimeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [queue]);

  const current = queue[0];
  if (!current) return null;

  const dismissCurrent = (accepted: boolean) => {
    sendResponse(current.requestId, accepted);
    setQueue((prev) => prev.slice(1));
  };

  const progress = secondsLeft / TIMEOUT_S;

  return (
    <Paper
      elevation={0}
      sx={{
        bgcolor: '#111820',
        border: `1px solid ${alpha('#A9BCD8', 0.18)}`,
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        borderRadius: 0,
        boxShadow: `0 18px 44px ${alpha('#000', 0.42)}`,
        left: '50%',
        maxWidth: 520,
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        transform: 'translateX(-50%)',
        width: 'min(calc(100vw - 32px), 520px)',
        zIndex: theme.zIndex.modal + 10,
      }}
    >
      <Box
        sx={{
          bgcolor: theme.palette.primary.main,
          bottom: 0,
          height: 3,
          left: 0,
          opacity: 0.72,
          position: 'absolute',
          transition: 'width 0.5s linear',
          width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
        }}
      />
      <Box sx={{ display: 'flex', gap: 2, p: 2.25 }}>
        <Box
          sx={{
            alignItems: 'center',
            bgcolor: alpha(theme.palette.primary.main, 0.16),
            borderRadius: '12px',
            color: theme.palette.primary.light,
            display: 'flex',
            flexShrink: 0,
            height: 42,
            justifyContent: 'center',
            width: 42,
          }}
        >
          <NotificationsActiveIcon sx={{ fontSize: 24 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.98rem', fontWeight: 650, mb: 0.5 }}>
            {t('permission.notification_title', {
              appName: current.appInfo?.name || 'App',
              defaultValue: '{{appName}} notifications',
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.84rem',
              lineHeight: 1.45,
            }}
          >
            {current.payload?.text1 ||
              t('permission.notification', {
                defaultValue: 'Allow this app to send you Hub notifications?',
                postProcess: 'capitalizeFirstChar',
              })}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              justifyContent: 'flex-end',
              mt: 1.7,
            }}
          >
            <Button
              onClick={() => dismissCurrent(false)}
              sx={{ color: 'text.secondary', fontWeight: 600 }}
            >
              {t('permission.notification_dont_allow', {
                defaultValue: "Don't allow",
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
            <Button
              onClick={() => dismissCurrent(true)}
              sx={{ fontWeight: 600 }}
              variant="contained"
            >
              {t('permission.notification_allow', {
                defaultValue: 'Allow',
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </Box>
        </Box>
        <Typography
          sx={{
            color: alpha(theme.palette.text.secondary, 0.62),
            fontSize: '0.75rem',
            fontWeight: 600,
            pt: 0.25,
          }}
        >
          {secondsLeft}s
        </Typography>
      </Box>
    </Paper>
  );
}

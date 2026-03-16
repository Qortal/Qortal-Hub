import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Paper, Typography, useTheme } from '@mui/material';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';

const TIMEOUT_MS = 60_000;
const TIMEOUT_S = TIMEOUT_MS / 1000;

type Payload = { text1?: string };

type AppInfo = { name?: string; tabId?: string };

type PendingRequest = {
  requestId: string;
  appInfo: AppInfo;
  payload: Payload;
  /** Wall-clock time when get.ts will auto-deny this request. */
  expiresAt: number;
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
  // Queue: index 0 is the currently displayed request.
  const [queue, setQueue] = useState<PendingRequest[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_S);
  const autoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Listen for new requests and append to queue.
  useEffect(() => {
    const listener = (e: CustomEvent<Omit<PendingRequest, 'expiresAt'>>) => {
      const { requestId, appInfo, payload } = e.detail || {};
      if (!requestId || !appInfo) return;
      setQueue((prev) => [
        ...prev,
        {
          requestId,
          appInfo,
          payload: payload || defaultPayload,
          expiresAt: Date.now() + TIMEOUT_MS,
        },
      ]);
    };
    subscribeToEvent('show-notification-permission', listener as any);
    return () =>
      unsubscribeFromEvent('show-notification-permission', listener as any);
  }, []);

  // Whenever the front of the queue changes, start its own countdown using
  // the remaining time from its original expiresAt.
  useEffect(() => {
    if (autoTimeoutRef.current) clearTimeout(autoTimeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);

    const current = queue[0];
    if (!current) return;

    const remaining = Math.max(0, current.expiresAt - Date.now());
    const remainingS = Math.ceil(remaining / 1000);
    setSecondsLeft(remainingS);

    // Auto-deny when its time runs out.
    autoTimeoutRef.current = setTimeout(() => {
      sendResponse(current.requestId, { accepted: false });
      setQueue((prev) => prev.slice(1));
    }, remaining);

    // Tick the countdown display.
    intervalRef.current = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000)));
    }, 500);

    return () => {
      if (autoTimeoutRef.current) clearTimeout(autoTimeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [queue[0]?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismissCurrent = (accepted: boolean) => {
    const current = queue[0];
    if (!current) return;
    sendResponse(current.requestId, { accepted });
    setQueue((prev) => prev.slice(1));
  };

  const current = queue[0];
  if (!current) return null;

  const { appInfo, payload } = current;
  const text1 = payload?.text1 ?? defaultPayload.text1;

  const isDark = theme.palette.mode === 'dark';
  const iconBg = isDark
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(0, 0, 0, 0.04)';

  const progress = secondsLeft / TIMEOUT_S;

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
      {/* Countdown progress bar */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 3,
          width: `${progress * 100}%`,
          bgcolor: theme.palette.primary.main,
          opacity: 0.5,
          transition: 'width 0.5s linear',
        }}
      />
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
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
            <Typography
              variant="caption"
              color="text.disabled"
              sx={{ alignSelf: 'flex-start', pt: 0.25 }}
            >
              {secondsLeft}s
            </Typography>
            {queue.length > 1 && (
              <Typography variant="caption" color="text.disabled">
                +{queue.length - 1} more
              </Typography>
            )}
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
            onClick={() => dismissCurrent(false)}
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
            onClick={() => dismissCurrent(true)}
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

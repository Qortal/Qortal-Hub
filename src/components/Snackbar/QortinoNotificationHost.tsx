import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Box, IconButton, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS } from '../Group/qortinoLookDebug';
import {
  DEFAULT_QORTINO_INLET_DEBUG_SETTINGS,
  type QortinoInletDebugSettings,
} from './qortinoInletDebug';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';

type NotificationType = 'error' | 'info' | 'success' | 'warning';

type NotificationInfo = {
  compact?: boolean;
  dismissible?: boolean;
  duration?: number | null;
  message?: string;
  sourceId?: string;
  type?: string;
} | null;

type QortinoNotificationHostProps = {
  info: NotificationInfo;
  open: boolean;
  setInfo: (nextInfo: NotificationInfo) => void;
  setOpen: (nextOpen: boolean) => void;
};

type NotificationPayload = {
  compact?: boolean;
  dismissible?: boolean;
  duration?: number | null;
  message?: string;
  sourceId?: string;
  type?: string;
};

const DEFAULT_NOTIFICATION_DURATION_MS = 5200;
const ERROR_NOTIFICATION_DURATION_MS = 7200;

const QORTINO_INLET_LOOK = DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS;
const QORTINO_INLET_BAR_START_PX = 12;

type QortinoInletHeadGeometry = {
  faceHeight: number;
  faceLeft: number;
  faceTop: number;
  faceWidth: number;
  headHeight: number;
  headOffsetX: number;
  headOffsetY: number;
  headWidth: number;
  shellBorderRadius: string;
  stageHeight: number;
  stageWidth: number;
};

const getQortinoInletShellBorderRadius = (roundness: number) => {
  const clampPercent = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(value)));

  const topX = clampPercent(46 * roundness, 34, 56);
  const topY = clampPercent(48 * roundness, 36, 58);
  const bottomX = clampPercent(42 * roundness, 30, 52);
  const bottomY = clampPercent(40 * roundness, 28, 50);

  return `${topX}% ${topX}% ${bottomX}% ${bottomX}% / ${topY}% ${topY}% ${bottomY}% ${bottomY}%`;
};

const getQortinoInletHeadGeometry = (
  debugSettings: QortinoInletDebugSettings
): QortinoInletHeadGeometry => {
  const headScale = 0.92 + (QORTINO_INLET_LOOK.bodyScale - 0.95) * 0.08;
  const headWidth = Math.round(
    64 * headScale * debugSettings.headWidthScale
  );
  const headHeight = Math.round(
    61 * headScale * debugSettings.headHeightScale
  );
  const faceWidth = Math.round(
    45 * headScale * debugSettings.faceWidthScale
  );
  const faceHeight = Math.round(
    31 * headScale * debugSettings.faceHeightScale
  );
  const faceLeft = Math.round((headWidth - faceWidth) / 2);
  const faceTop = Math.round((headHeight - faceHeight) / 2 + 2);

  return {
    faceHeight,
    faceLeft,
    faceTop,
    faceWidth,
    headHeight,
    headOffsetX: debugSettings.offsetX,
    headOffsetY: debugSettings.offsetY,
    headWidth,
    shellBorderRadius: getQortinoInletShellBorderRadius(
      debugSettings.shellRoundness
    ),
    stageHeight: headHeight + 5,
    stageWidth: headWidth + 8,
  };
};

const normalizeNotificationType = (value?: string): NotificationType => {
  if (value === 'success' || value === 'warning' || value === 'error') {
    return value;
  }

  return 'info';
};

const normalizeNotificationMessage = (value?: string) => {
  const trimmed = value?.trim();

  if (!trimmed) return '';

  if (/^saving file success!?$/i.test(trimmed)) return 'File saved';
  if (/^successfully sent notification\.?$/i.test(trimmed)) {
    return 'Notification sent';
  }
  if (/^successfully requested to join group\./i.test(trimmed)) {
    return 'Join request sent';
  }
  if (/^failed to join the group$/i.test(trimmed)) return 'Unable to join group';
  if (/^opened$/i.test(trimmed)) return 'App opened';
  if (/^loading announcements$/i.test(trimmed)) return 'Loading announcements...';
  if (/^loading chat\.\.\. please wait\.?$/i.test(trimmed)) {
    return 'Loading chat...';
  }
  if (/^setting up group\.\.\. please wait\.?$/i.test(trimmed)) {
    return 'Setting up group...';
  }

  return trimmed;
};

const getNotificationPalette = (type: NotificationType) => {
  switch (type) {
    case 'success':
      return {
        accent: '#A6C8B0',
        tint: 'rgba(98, 145, 118, 0.12)',
      };
    case 'warning':
      return {
        accent: '#C9B08A',
        tint: 'rgba(140, 106, 62, 0.12)',
      };
    case 'error':
      return {
        accent: '#CFA2A6',
        tint: 'rgba(132, 74, 78, 0.14)',
      };
    default:
      return {
        accent: '#9EB8E6',
        tint: 'rgba(81, 111, 156, 0.12)',
      };
  }
};

const QortinoNotificationHead = ({
  accent,
  geometry,
  isDarkMode,
}: {
  accent: string;
  geometry: QortinoInletHeadGeometry;
  isDarkMode: boolean;
}) => {
  const eyeSize = 5;
  const eyeOffset = 9;

  return (
    <Box
      sx={{
        height: `${geometry.stageHeight}px`,
        left: `${geometry.headOffsetX}px`,
        pointerEvents: 'none',
        position: 'absolute',
        top: `${-4 + geometry.headOffsetY}px`,
        width: `${geometry.stageWidth}px`,
        zIndex: 3,
      }}
    >
      <motion.div
        animate={{ y: [0, -1.5, 0] }}
        transition={{
          duration: 4.9,
          ease: 'easeInOut',
          repeat: Infinity,
          repeatType: 'mirror',
        }}
        style={{ height: '100%', position: 'relative', width: '100%' }}
      >
        <Box
          sx={{
            background: `radial-gradient(ellipse at center, ${alpha(
              '#02050A',
              isDarkMode ? 0.52 : 0.2
            )} 0%, ${alpha('#02050A', 0)} 72%)`,
            bottom: 2,
            filter: 'blur(7px)',
            height: '9px',
            left: '11px',
            position: 'absolute',
            width: `${Math.round(geometry.headWidth * 0.6)}px`,
            zIndex: 0,
          }}
        />
        <Box
          sx={{
            background: `radial-gradient(circle at 28% 18%, ${alpha(
              '#D6E5FF',
              isDarkMode ? 0.11 : 0.06
            )} 0%, ${alpha('#D6E5FF', 0)} 34%), linear-gradient(180deg, ${alpha(
              '#262E3D',
              0.98
            )} 0%, ${alpha('#151A24', 0.99)} 60%, ${alpha('#0E131B', 1)} 100%)`,
            border: `1px solid ${alpha('#CDDCFF', isDarkMode ? 0.08 : 0.12)}`,
            borderRadius: geometry.shellBorderRadius,
            boxShadow: `0 16px 24px ${alpha(
              '#000000',
              isDarkMode ? 0.34 : 0.16
            )}, inset 0 1px 0 ${alpha('#FFFFFF', 0.03)}, inset 0 -1px 0 ${alpha(
              '#000000',
              0.26
            )}`,
            height: `${geometry.headHeight}px`,
            left: '2px',
            position: 'absolute',
            top: '1px',
            width: `${geometry.headWidth}px`,
            zIndex: 2,
            '&::before': {
              background: `linear-gradient(180deg, ${alpha('#F3F7FF', 0.11)} 0%, transparent 100%)`,
              borderRadius: 'inherit',
              content: '""',
              inset: '1px 1px auto 1px',
              height: '43%',
              pointerEvents: 'none',
              position: 'absolute',
            },
            '&::after': {
              background: `linear-gradient(180deg, transparent 0%, ${alpha(
                '#E9F1FF',
                0.025
              )} 100%)`,
              borderRadius: '0 0 16px 16px',
              bottom: '4px',
              content: '""',
              height: '10px',
              left: '13px',
              pointerEvents: 'none',
              position: 'absolute',
              right: '13px',
            },
          }}
        />
        <Box
          sx={{
            backdropFilter: 'blur(10px)',
            background: `linear-gradient(180deg, ${alpha('#101824', 0.76)} 0%, ${alpha(
              '#090D13',
              0.9
            )} 100%)`,
            border: `1px solid ${alpha(accent, 0.09)}`,
            borderRadius: '17px',
            boxShadow: `inset 0 1px 0 ${alpha('#FFFFFF', 0.04)}, inset 0 -8px 14px ${alpha(
              '#000000',
              0.18
            )}`,
            height: `${geometry.faceHeight}px`,
            left: `${geometry.faceLeft + 2}px`,
            position: 'absolute',
            top: `${geometry.faceTop + 1}px`,
            width: `${geometry.faceWidth}px`,
            zIndex: 3,
          }}
        />
        <Box
          sx={{
            backgroundColor: '#EAF4FF',
            borderRadius: '999px',
            boxShadow: `0 0 6px ${alpha(accent, 0.08)}`,
            height: `${eyeSize}px`,
            left: `${geometry.faceLeft + 2 + Math.round(geometry.faceWidth / 2) - eyeOffset - Math.round(eyeSize / 2)}px`,
            position: 'absolute',
            top: `${geometry.faceTop + 10}px`,
            width: `${eyeSize}px`,
            zIndex: 4,
          }}
        />
        <Box
          sx={{
            backgroundColor: '#EAF4FF',
            borderRadius: '999px',
            boxShadow: `0 0 6px ${alpha(accent, 0.08)}`,
            height: `${eyeSize}px`,
            left: `${geometry.faceLeft + 2 + Math.round(geometry.faceWidth / 2) + eyeOffset - Math.round(eyeSize / 2)}px`,
            position: 'absolute',
            top: `${geometry.faceTop + 10}px`,
            width: `${eyeSize}px`,
            zIndex: 4,
          }}
        />
        <Box
          sx={{
            borderBottom: `2px solid ${alpha('#EAF4FF', 0.72)}`,
            borderRadius: '0 0 999px 999px',
            height: '6px',
            left: `${geometry.faceLeft + 2 + Math.round(geometry.faceWidth / 2) - 11}px`,
            position: 'absolute',
            top: `${geometry.faceTop + 21}px`,
            width: '22px',
            zIndex: 4,
          }}
        />
      </motion.div>
    </Box>
  );
};

export const QortinoNotificationHost = ({
  info,
  open,
  setInfo,
  setOpen,
}: QortinoNotificationHostProps) => {
  const theme = useTheme();
  const infoRef = useRef<NotificationInfo>(info);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inletDebugSettings: QortinoInletDebugSettings =
    DEFAULT_QORTINO_INLET_DEBUG_SETTINGS;

  useEffect(() => {
    infoRef.current = info;
  }, [info]);

  const closeNotification = useCallback(() => {
    setOpen(false);
    setInfo(null);
  }, [setInfo, setOpen]);

  useEffect(() => {
    if (!open) {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    const duration = info?.duration;
    if (duration === null) return;

    const resolvedDuration =
      typeof duration === 'number'
        ? duration
        : normalizeNotificationType(info?.type) === 'error'
          ? ERROR_NOTIFICATION_DURATION_MS
          : DEFAULT_NOTIFICATION_DURATION_MS;

    timeoutRef.current = window.setTimeout(() => {
      closeNotification();
    }, resolvedDuration);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [closeNotification, info?.duration, info?.type, open]);

  useEffect(() => {
    const handleOpen = (
      event: CustomEvent<{
        compact?: boolean;
        data?: NotificationPayload;
        dismissible?: boolean;
        duration?: number | null;
        message?: string;
        sourceId?: string;
        type?: string;
      }>
    ) => {
      const payload = event.detail?.data ?? event.detail ?? {};
      const message = normalizeNotificationMessage(payload.message);

      if (!message) return;

      setInfo({
        compact: payload.compact === true,
        dismissible: payload.dismissible !== false,
        duration:
          payload.duration === undefined
            ? undefined
            : payload.duration,
        message,
        sourceId: payload.sourceId,
        type: normalizeNotificationType(payload.type),
      });
      setOpen(true);
    };

    const handleClose = (
      event: CustomEvent<{
        data?: { sourceId?: string };
        sourceId?: string;
      }>
    ) => {
      const payload = event.detail?.data ?? event.detail ?? {};
      const sourceId = payload.sourceId;

      if (
        sourceId &&
        (infoRef.current?.sourceId == null || infoRef.current?.sourceId !== sourceId)
      ) {
        return;
      }

      closeNotification();
    };

    subscribeToEvent('openGlobalSnackBar', handleOpen);
    subscribeToEvent('closeGlobalSnackBar', handleClose);

    return () => {
      unsubscribeFromEvent('openGlobalSnackBar', handleOpen);
      unsubscribeFromEvent('closeGlobalSnackBar', handleClose);
    };
  }, [closeNotification, setInfo, setOpen]);

  const message = useMemo(
    () => normalizeNotificationMessage(info?.message),
    [info?.message]
  );
  const notificationType = normalizeNotificationType(info?.type);
  const palette = getNotificationPalette(notificationType);
  const isDismissible = info?.dismissible !== false;
  const isDarkMode = theme.palette.mode === 'dark';
  const inletGeometry = useMemo(
    () => getQortinoInletHeadGeometry(inletDebugSettings),
    [inletDebugSettings]
  );
  const maxTextWidthCh = useMemo(() => {
    const ceiling = info?.compact === true ? 26 : 40;
    const floor = info?.compact === true ? 13 : 16;
    const dynamic = Math.ceil(message.length * 0.74);
    return `${Math.min(ceiling, Math.max(floor, dynamic))}ch`;
  }, [info?.compact, message.length]);

  if (!open || !message) return null;

  return (
    <Box
      sx={{
        bottom: { xs: 14, sm: 22 },
        left: '50%',
        maxWidth: 'calc(100vw - 20px)',
        pointerEvents: 'none',
        position: 'fixed',
        transform: 'translateX(-50%)',
        width: 'fit-content',
        zIndex: 2400,
      }}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={`${notificationType}:${message}`}
          initial={{ opacity: 0, y: 14, scale: 0.986 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.99 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          style={{ pointerEvents: 'auto', position: 'relative', width: 'fit-content' }}
        >
          <Box
            role={notificationType === 'error' ? 'alert' : 'status'}
            aria-live={notificationType === 'error' ? 'assertive' : 'polite'}
            sx={{
              minHeight: 56,
              position: 'relative',
              width: 'fit-content',
            }}
          >
            <Box
              sx={{
                background: `radial-gradient(ellipse at center, ${alpha(
                  '#05070C',
                  isDarkMode ? 0.28 : 0.12
                )} 0%, ${alpha('#05070C', 0)} 72%)`,
                bottom: -7,
                filter: 'blur(14px)',
                height: '13px',
                left: '50%',
                position: 'absolute',
                transform: 'translateX(-50%)',
                width: 'calc(100% - 20px)',
                zIndex: 0,
              }}
            />
            <Box
              sx={{
                background: `linear-gradient(90deg, ${alpha('#F3F8FF', 0.7)} 0%, ${alpha(
                  '#D9E7FF',
                  0.28
                )} 36%, ${alpha('#FFFFFF', 0.12)} 74%, ${alpha('#FFFFFF', 0)} 100%)`,
                borderRadius: '999px',
                height: '1px',
                left: `${QORTINO_INLET_BAR_START_PX + 10}px`,
                pointerEvents: 'none',
                position: 'absolute',
                right: '12px',
                top: '1px',
                zIndex: 2,
              }}
            />
            <Box
              sx={{
                background: `radial-gradient(ellipse at center, ${alpha(
                  '#05070C',
                  isDarkMode ? 0.34 : 0.15
                )} 0%, ${alpha('#05070C', 0)} 74%)`,
                filter: 'blur(6px)',
                height: '12px',
                left: `${QORTINO_INLET_BAR_START_PX + 7 + inletGeometry.headOffsetX}px`,
                position: 'absolute',
                top: `${28 + inletGeometry.headOffsetY}px`,
                width: '36px',
                zIndex: 1,
              }}
            />
            <Box
              sx={{
                background: `linear-gradient(90deg, ${alpha(
                  '#05070C',
                  isDarkMode ? 0.34 : 0.14
                )} 0%, ${alpha('#05070C', 0.08)} 72%, transparent 100%)`,
                borderRadius: '9px',
                boxShadow: `inset 12px 0 18px ${alpha('#000000', 0.22)}`,
                height: '25px',
                left: `${QORTINO_INLET_BAR_START_PX + 6 + inletGeometry.headOffsetX}px`,
                pointerEvents: 'none',
                position: 'absolute',
                top: `${13 + inletGeometry.headOffsetY}px`,
                width: `${Math.round(inletGeometry.headWidth * 0.56)}px`,
                zIndex: 2,
              }}
            />
            <Box
              sx={{
                background: `linear-gradient(180deg, ${alpha(
                  '#252D3C',
                  0.66
                )} 0%, ${alpha('#171C26', 0.86)} 100%)`,
                border: `1px solid ${alpha('#D6E5FF', isDarkMode ? 0.05 : 0.08)}`,
                borderRadius: '10px',
                boxShadow: `0 8px 16px ${alpha('#000000', isDarkMode ? 0.18 : 0.1)}`,
                height: '29px',
                left: `${QORTINO_INLET_BAR_START_PX + 6 + inletGeometry.headOffsetX}px`,
                pointerEvents: 'none',
                position: 'absolute',
                top: `${9 + inletGeometry.headOffsetY}px`,
                width: `${Math.round(inletGeometry.headWidth * 0.46)}px`,
                zIndex: 1,
              }}
            />
            <Box
              sx={{
                background: `linear-gradient(180deg, ${alpha(
                  '#262E3D',
                  0.82
                )} 0%, ${alpha('#171C26', 0.94)} 58%, ${alpha('#121823', 0.96)} 100%)`,
                backdropFilter: 'blur(16px)',
                border: `1px solid ${alpha('#D6E5FF', isDarkMode ? 0.1 : 0.14)}`,
                borderRadius: '13px',
                boxShadow: `0 14px 26px ${alpha(
                  '#000000',
                  isDarkMode ? 0.24 : 0.1
                )}, inset 0 1px 0 ${alpha('#FFFFFF', 0.03)}`,
                display: 'flex',
                marginLeft: `${QORTINO_INLET_BAR_START_PX}px`,
                maxWidth: 'min(500px, calc(100vw - 20px))',
                minHeight: '43px',
                minWidth: 'min(184px, calc(100vw - 20px))',
                overflow: 'hidden',
                paddingBottom: '7px',
                paddingLeft: `${inletGeometry.stageWidth - QORTINO_INLET_BAR_START_PX + 10 + Math.max(0, inletGeometry.headOffsetX)}px`,
                paddingRight: isDismissible ? '28px' : '11px',
                paddingTop: '7px',
                position: 'relative',
                width: 'fit-content',
                '&::before': {
                  background: `linear-gradient(180deg, ${alpha('#FFFFFF', 0.02)} 0%, transparent 100%)`,
                  content: '""',
                  inset: 0,
                  position: 'absolute',
                },
                '&::after': {
                  background: `radial-gradient(circle at 0% 50%, ${alpha(
                    palette.accent,
                    0.12
                  )} 0%, ${palette.tint} 26%, transparent 66%)`,
                  content: '""',
                  inset: 0,
                  pointerEvents: 'none',
                  position: 'absolute',
                },
              }}
            >
              <Typography
                sx={{
                  alignItems: 'center',
                  color: alpha('#FBFDFF', 0.98),
                  display: 'flex',
                  fontFamily: 'Inter',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  letterSpacing: '-0.012em',
                  lineHeight: 1.36,
                  maxWidth: maxTextWidthCh,
                  minHeight: '21px',
                  position: 'relative',
                  textWrap: 'pretty',
                  zIndex: 1,
                }}
              >
                {message}
              </Typography>
              {isDismissible ? (
                <IconButton
                  aria-label="Dismiss notification"
                  onClick={closeNotification}
                  size="small"
                  sx={{
                    color: alpha('#F1F5FF', 0.72),
                    position: 'absolute',
                    right: 2,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    zIndex: 1,
                    '&:hover': {
                      backgroundColor: alpha('#FFFFFF', 0.04),
                      color: alpha('#F1F5FF', 0.86),
                    },
                  }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              ) : null}
            </Box>
            <QortinoNotificationHead
              accent={palette.accent}
              geometry={inletGeometry}
              isDarkMode={isDarkMode}
            />
          </Box>
        </motion.div>
      </AnimatePresence>
    </Box>
  );
};

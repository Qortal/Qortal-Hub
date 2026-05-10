import { Mail } from '@mui/icons-material';
import { ButtonBase, Tooltip, useTheme } from '@mui/material';
import { useAtom, useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isNotificationSeenInAppFromKeyTimes,
  notificationSeenInAppKeyTimesAtom,
  paymentNotificationsAtom,
  qMailLastEnteredTimestampAtom,
} from '../atoms/global';
import { executeEvent } from '../utils/events';

function toTimestampMs(value) {
  if (value == null || typeof value !== 'number') return null;
  return value < 1e12 ? value * 1000 : value;
}

export const QMailStatus = ({
  compact = false,
  buttonSx = undefined,
  iconSx = undefined,
  tooltipPlacement = undefined,
}: {
  compact?: boolean;
  buttonSx?: any;
  iconSx?: any;
  tooltipPlacement?: 'bottom' | 'left' | 'right' | 'top';
}) => {
  const { t } = useTranslation(['core']);
  const theme = useTheme();
  const [, setLastEnteredTimestamp] = useAtom(qMailLastEnteredTimestampAtom);
  const notifications = useAtomValue(paymentNotificationsAtom);
  const seenInAppKeyTimes = useAtomValue(notificationSeenInAppKeyTimesAtom);

  const hasNewMail = useMemo(() => {
    return (notifications ?? []).some((notification) => {
      const isQMail =
        notification?.event === 'RESOURCE_PUBLISHED' &&
        (notification?.notificationId === 'q-mail-notification' ||
          notification?.appName === 'Q-Mail');
      if (!isQMail) return false;
      const timestamp = toTimestampMs(
        notification?.data?.created ??
          notification?.data?.timestamp ??
          notification?.timestamp
      );
      if (timestamp == null) return false;
      return !isNotificationSeenInAppFromKeyTimes(
        notification,
        seenInAppKeyTimes
      );
    });
  }, [notifications, seenInAppKeyTimes]);

  return (
    <ButtonBase
      onClick={() => {
        executeEvent('addTab', {
          data: {
            name: 'Q-Mail',
            navigateIfAlreadyOpen: true,
            service: 'APP',
          },
        });
        executeEvent('open-apps-mode', {});
        setLastEnteredTimestamp(Date.now());
      }}
      sx={{
        position: 'relative',
        ...(compact && {
          alignItems: 'center',
          borderRadius: 1,
          display: 'flex',
          height: 32,
          justifyContent: 'center',
          width: 32,
        }),
        ...(buttonSx || {}),
      }}
    >
      {hasNewMail && (
        <span
          style={{
            backgroundColor: theme.palette.other.unread,
            borderRadius: '50%',
            height: compact ? '10px' : '15px',
            outline: '1px solid white',
            position: 'absolute',
            right: compact ? 4 : -7,
            top: compact ? 4 : -7,
            width: compact ? '10px' : '15px',
            zIndex: 1,
          }}
        />
      )}
      <Tooltip
        arrow
        placement={tooltipPlacement || (compact ? 'bottom' : 'left')}
        title={
          <span
            style={{
              color: theme.palette.text.primary,
              fontSize: '14px',
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            {t('core:q_apps.q_mail', {
              postProcess: 'capitalizeFirstChar',
            })}
          </span>
        }
        slotProps={{
          arrow: { sx: { color: theme.palette.background.paper } },
          tooltip: {
            sx: {
              backgroundColor: theme.palette.background.paper,
              color: theme.palette.text.primary,
            },
          },
        }}
      >
        <Mail
          sx={{
            color: theme.palette.text.secondary,
            fontSize: compact ? 20 : undefined,
            ...(iconSx || {}),
          }}
        />
      </Tooltip>
    </ButtonBase>
  );
};

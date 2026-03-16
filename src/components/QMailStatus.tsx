import { useMemo } from 'react';
import {
  getNotificationSeenKey,
  getNotificationSeenPrefixKey,
  notificationSeenInAppKeysRecordAtom,
  paymentNotificationsAtom,
  qMailLastEnteredTimestampAtom,
  userInfoAtom,
} from '../atoms/global';
import { ButtonBase, Tooltip, useTheme } from '@mui/material';
import { executeEvent } from '../utils/events';
import { Mail } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue } from 'jotai';

export const QMailStatus = ({ compact = false }: { compact?: boolean }) => {
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();

  const [lastEnteredTimestamp, setLastEnteredTimestamp] = useAtom(
    qMailLastEnteredTimestampAtom
  );
  const notifications = useAtomValue(paymentNotificationsAtom);
  const seenInAppRecord = useAtomValue(notificationSeenInAppKeysRecordAtom);
  console.log('seenInAppRecord', seenInAppRecord);
  const address = useAtomValue(userInfoAtom)?.address;
  console.log('address100', address);
  const qMailNotifications = useMemo(
    () =>
      (notifications ?? []).filter(
        (n) =>
          n?.event === 'RESOURCE_PUBLISHED' &&
          (n?.notificationId === 'q-mail-notification' ||
            n?.appName === 'Q-Mail')
      ),
    [notifications]
  );

  const hasNewMail = useMemo(() => {
    const getNotificationTimestamp = (n) => {
      const raw = n?.data?.created ?? n?.data?.timestamp ?? n?.timestamp;
      const v = raw != null && typeof raw === 'number' ? raw : null;
      if (v == null) return null;
      return v < 1e12 ? v * 1000 : v;
    };
    const record: Record<
      string,
      Record<string, number>
    > = typeof seenInAppRecord === 'string'
      ? (() => {
          try {
            return JSON.parse(seenInAppRecord);
          } catch {
            return {};
          }
        })()
      : (seenInAppRecord ?? {});
    const byAddress = (address && record[address]) ?? {};
    const isUnseen = (n) => {
      if (
        n?.notificationId !== 'q-mail-notification' &&
        n?.appName !== 'Q-Mail'
      ) {
        return false;
      }
      const createdTs = getNotificationTimestamp(n);
      console.log('createdTs', createdTs);
      if (createdTs == null) return false;
      const key = getNotificationSeenKey(n);
      const prefixKey = getNotificationSeenPrefixKey(n);
      const seenTs = Math.max(
        (byAddress[key] as number) ?? 0,
        (byAddress[prefixKey] as number) ?? 0
      );
      console.log('seenTs', seenTs, createdTs);
      return createdTs > seenTs;
    };
    return qMailNotifications.filter(isUnseen).length > 0;
  }, [qMailNotifications, seenInAppRecord, address]);

  const button = (
    <ButtonBase
      onClick={() => {
        executeEvent('addTab', { data: { service: 'APP', name: 'Q-Mail' } });
        executeEvent('open-apps-mode', {});
        setLastEnteredTimestamp(Date.now());
      }}
      style={{
        position: 'relative',
        ...(compact && {
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }),
      }}
    >
      {hasNewMail && (
        <div
          style={{
            backgroundColor: theme.palette.other.unread,
            borderRadius: '50%',
            height: compact ? '10px' : '15px',
            outline: '1px solid white',
            position: 'absolute',
            ...(compact ? { right: 4, top: 4 } : { right: -7, top: -7 }),
            width: compact ? '10px' : '15px',
            zIndex: 1,
          }}
        />
      )}
      <Tooltip
        title={
          <span
            style={{
              color: theme.palette.text.primary,
              fontSize: '14px',
              fontWeight: 700,
              textTransform: 'uppercase',
            }}
          >
            {t('core:q_apps.q_mail', {
              postProcess: 'capitalizeFirstChar',
            })}
          </span>
        }
        placement={compact ? 'bottom' : 'left'}
        arrow
        sx={{ fontSize: compact ? '20' : '24' }}
        slotProps={{
          tooltip: {
            sx: {
              color: theme.palette.text.primary,
              backgroundColor: theme.palette.background.paper,
            },
          },
          arrow: {
            sx: {
              color: theme.palette.text.primary,
            },
          },
        }}
      >
        <Mail
          sx={{
            color: theme.palette.text.secondary,
            fontSize: compact ? 20 : undefined,
          }}
        />
      </Tooltip>
    </ButtonBase>
  );

  if (compact) {
    return (
      <div
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {button}
      </div>
    );
  }
  return button;
};

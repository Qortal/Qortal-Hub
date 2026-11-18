import AppsIcon from '@mui/icons-material/Apps';
import CloseIcon from '@mui/icons-material/Close';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  Avatar,
  Box,
  ButtonBase,
  Card,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  MenuItem,
  Popover,
  Switch,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../App';
import {
  customWebsocketSubscriptionsAtom,
  isNotificationSeenInAppFromKeyTimes,
  lastPaymentSeenTimestampAtom,
  notificationSeenInAppKeyTimesAtom,
  notificationSeenInAppKeysAtom,
  paymentNotificationsAtom,
  reticulumEnabledAtom,
} from '../atoms/global';
import LogoSelected from '../assets/svgs/LogoSelected.svg';
import {
  getAppsWithNotificationPermission,
  getNotificationOsPushDisabledMap,
  getNotificationPermissionKey,
  setNotificationOsPushDisabled,
  setPermission,
} from '../qortal/qortal-requests';
import { openQortalLink } from '../utils/qortalLink/openQortalLink';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../utils/events';
import { openQChatTab } from '../utils/openQChatTab';
import { setPendingNotificationNav } from '../utils/notificationClickBuffer';
import { formatDate } from '../utils/time';
import { QCHAT_MENTION_NOTIFICATION_APP_NAME } from '../utils/qChatMentionNotifications';
import { ReticulumUnreadCountBadge } from './common/ReticulumUnreadCountBadge';

const RESOURCE_EVENT = 'RESOURCE_PUBLISHED';

const isQChatMentionNotification = (notification) =>
  notification?.appName === QCHAT_MENTION_NOTIFICATION_APP_NAME &&
  notification?.data?.qChatMention === true;

const isReticulumDmMissedCallNotification = (notification) =>
  notification?.data?.reticulumDmMissedCall === true;

const isReticulumCalendarNotification = (notification) =>
  notification?.data?.reticulumCalendarReminder === true;

function toTimestampMs(value) {
  if (value == null || typeof value !== 'number') return null;
  return value < 1e12 ? value * 1000 : value;
}

function getNotificationTimestamp(notification) {
  return toTimestampMs(
    notification?.data?.created ??
      notification?.data?.timestamp ??
      notification?.timestamp
  );
}

function getNotificationMessage(messageObj, currentLang, fallback) {
  if (!messageObj || typeof messageObj !== 'object') return fallback;
  const lang = (currentLang || 'en').split('-')[0];
  return (
    messageObj[lang]?.trim() ||
    messageObj.en?.trim() ||
    Object.values(messageObj).find((value: any) => value?.trim()) ||
    fallback
  );
}

export const GeneralNotifications = ({
  tooltipPlacement = 'left',
  compact = false,
  buttonSx = undefined,
  iconSx = undefined,
  badgeOutlineColor = undefined,
}) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'hub' | 'q-apps'>(
    'hub'
  );
  const [settingsApps, setSettingsApps] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [osPushDisabledMap, setOsPushDisabledMap] = useState<
    Record<string, boolean>
  >({});
  const reticulumEnabled = useAtomValue(reticulumEnabledAtom);
  const notifications = useAtomValue(paymentNotificationsAtom);
  const setNotifications = useSetAtom(paymentNotificationsAtom);
  const customSubscriptions = useAtomValue(customWebsocketSubscriptionsAtom);
  const setCustomSubscriptions = useSetAtom(customWebsocketSubscriptionsAtom);
  const lastSeenTimestamp = useAtomValue(lastPaymentSeenTimestampAtom);
  const setLastSeenTimestamp = useSetAtom(lastPaymentSeenTimestampAtom);
  const seenInAppKeyTimes = useAtomValue(notificationSeenInAppKeyTimesAtom);
  const setSeenKeys = useSetAtom(notificationSeenInAppKeysAtom);
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const { t, i18n } = useTranslation(['core']);

  useEffect(() => {
    const handler = (event) => {
      const detail = event.detail;
      if (detail?.address && Array.isArray(detail?.keys)) {
        setSeenKeys({ address: detail.address, keys: detail.keys });
      }
    };
    subscribeToEvent('notification-seen-in-app-updated', handler);
    return () =>
      unsubscribeFromEvent('notification-seen-in-app-updated', handler);
  }, [setSeenKeys]);

  const resourceNotifications = useMemo(
    () =>
      (notifications ?? []).filter(
        (item) =>
          item?.event === RESOURCE_EVENT ||
          (reticulumEnabled &&
            (isQChatMentionNotification(item) ||
              isReticulumDmMissedCallNotification(item) ||
              isReticulumCalendarNotification(item)))
      ),
    [notifications, reticulumEnabled]
  );
  const unseenCount = useMemo(() => {
    return resourceNotifications.reduce((count, notification) => {
      const timestamp = getNotificationTimestamp(notification);
      if (timestamp == null) return count;
      if (isNotificationSeenInAppFromKeyTimes(notification, seenInAppKeyTimes))
        return count;
      if (lastSeenTimestamp && timestamp <= lastSeenTimestamp) return count;
      return (
        count +
        (isQChatMentionNotification(notification)
          ? Math.max(1, Number(notification?.data?.mentionCount) || 1)
          : 1)
      );
    }, 0);
  }, [resourceNotifications, seenInAppKeyTimes, lastSeenTimestamp]);
  const hasAnyNotifications = resourceNotifications.length > 0;

  const hasNewNotifications = unseenCount > 0;
  const notificationsLabel = t('message.generic.notifications', {
    defaultValue: 'Notifications',
  });
  const notificationsAriaLabel = hasNewNotifications
    ? `${notificationsLabel}, ${unseenCount} unread`
    : `${notificationsLabel}, no unread notifications`;

  const openSettings = () => {
    setSettingsSection('hub');
    setSettingsOpen(true);
    setSettingsLoading(true);
    Promise.all([
      getAppsWithNotificationPermission(),
      getNotificationOsPushDisabledMap(),
    ])
      .then(([apps, disabledMap]) => {
        setSettingsApps(
          apps.filter(
            (appName) => appName !== QCHAT_MENTION_NOTIFICATION_APP_NAME
          )
        );
        setOsPushDisabledMap(disabledMap || {});
      })
      .finally(() => setSettingsLoading(false));
  };

  return (
    <>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          overflow: 'visible',
          position: 'relative',
        }}
      >
        <ButtonBase
          aria-label={notificationsAriaLabel}
          onClick={(event) => {
            event.stopPropagation();
            setAnchorEl(event.currentTarget);
          }}
          sx={{
            ...(buttonSx || {}),
          }}
        >
          <Tooltip
            arrow
            placement={tooltipPlacement}
            title={
              <span
                style={{
                  color: theme.palette.text.primary,
                  fontSize: '14px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}
              >
                {notificationsLabel}
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
            <NotificationsRoundedIcon
              sx={{
                color: theme.palette.text.secondary,
                fontSize: compact ? 20 : undefined,
                ...(iconSx || {}),
              }}
            />
          </Tooltip>
        </ButtonBase>
        {hasNewNotifications && (
          <ReticulumUnreadCountBadge
            count={unseenCount}
            fontSize={9}
            outlineColor={badgeOutlineColor || theme.palette.background.surface}
            size={15}
            sx={{
              position: 'absolute',
              right: -5,
              top: -4,
              zIndex: 2,
            }}
          />
        )}
      </Box>

      <Popover
        anchorEl={anchorEl}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        onClose={() => {
          if (hasNewNotifications) setLastSeenTimestamp(Date.now());
          setAnchorEl(null);
        }}
        open={!!anchorEl}
        slotProps={{
          paper: {
            sx: isDarkMode
              ? {
                  background: '#111820',
                  backgroundImage: 'none',
                  border: `1px solid ${alpha('#A9BCD8', 0.18)}`,
                  borderRadius: '16px',
                  boxShadow: `0 22px 46px ${alpha('#000', 0.44)}`,
                  mt: 1,
                  overflow: 'hidden',
                }
              : {
                  background: theme.palette.background.paper,
                  backgroundImage: 'none',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '16px',
                  boxShadow: `0 16px 40px ${alpha('#1E3248', 0.1)}`,
                  mt: 1,
                  overflow: 'hidden',
                },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      >
        <Box
          sx={{
            alignItems: hasAnyNotifications ? 'stretch' : 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: hasAnyNotifications ? 1 : 1.2,
            maxHeight: '60vh',
            overflow: 'auto',
            ...(hasAnyNotifications
              ? { pb: 1, pl: 1, pr: 1, pt: 5.5 }
              : { p: '18px 20px' }),
            position: 'relative',
            width: 360,
          }}
        >
          <IconButton
            aria-label="Notification settings"
            onClick={(event) => {
              event.stopPropagation();
              openSettings();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            size="small"
            sx={{
              color: theme.palette.text.secondary,
              pointerEvents: 'auto',
              position: 'absolute',
              right: 4,
              top: 4,
              zIndex: 2,
            }}
          >
            <SettingsIcon fontSize="small" />
          </IconButton>

          {!hasAnyNotifications && (
            <>
              <NotificationsRoundedIcon
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.82),
                  fontSize: 22,
                  mt: 2,
                }}
              />
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: '0.96rem',
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                {t('message.generic.no_app_notifications', {
                  defaultValue: 'No app notifications yet',
                })}
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.76),
                  fontSize: '0.78rem',
                  lineHeight: 1.5,
                  maxWidth: 250,
                  textAlign: 'center',
                }}
              >
                {t('message.generic.app_notifications_hint', {
                  defaultValue: 'Q-App notifications will appear here',
                })}
              </Typography>
            </>
          )}

          {resourceNotifications.map((notification, index) => {
            const isQMail =
              notification?.notificationId === 'q-mail-notification' ||
              notification?.appName === 'Q-Mail';
            const isQChatMention = isQChatMentionNotification(notification);
            const isMissedDmCall =
              isReticulumDmMissedCallNotification(notification);
            const isCalendarReminder =
              isReticulumCalendarNotification(notification);
            const timestamp = getNotificationTimestamp(notification);
            const unseen =
              timestamp != null &&
              (!lastSeenTimestamp || timestamp > lastSeenTimestamp) &&
              !isNotificationSeenInAppFromKeyTimes(
                notification,
                seenInAppKeyTimes
              );

            return (
              <MenuItem
                key={
                  notification?.data?.identifier ||
                  notification?.data?.created ||
                  index
                }
                onClick={() => {
                  if (isQChatMention) {
                    setNotifications((current) =>
                      current.filter(
                        (item) =>
                          !(
                            isQChatMentionNotification(item) &&
                            Number(item?.data?.groupId) ===
                              Number(notification?.data?.groupId)
                          )
                      )
                    );
                    setAnchorEl(null);
                    setPendingNotificationNav({ eventName: 'openGroupMessage', detail: { channelId: notification?.data?.channelId, eventId: notification?.data?.eventId, from: notification?.data?.groupId } });
                    openQChatTab();
                    executeEvent('openGroupMessage', {
                      channelId: notification?.data?.channelId,
                      eventId: notification?.data?.eventId,
                      from: notification?.data?.groupId,
                    });
                    return;
                  }
                  if (isMissedDmCall) {
                    setNotifications((current) =>
                      current.filter(
                        (item) =>
                          item?.data?.reticulumDmCallId !==
                          notification?.data?.reticulumDmCallId
                      )
                    );
                    setAnchorEl(null);
                    setPendingNotificationNav({ eventName: 'openDirectMessageInternal', detail: { address: notification?.data?.from, name: notification?.data?.name } });
                    openQChatTab();
                    executeEvent('openDirectMessageInternal', {
                      address: notification?.data?.from,
                      name: notification?.data?.name,
                    });
                    return;
                  }
                  if (isCalendarReminder) {
                    setNotifications((current) =>
                      current.filter(
                        (item) =>
                          item?.notificationId !== notification?.notificationId
                      )
                    );
                    setAnchorEl(null);
                    setPendingNotificationNav({ eventName: 'openGroupMessage', detail: { from: notification?.data?.groupId, eventId: notification?.data?.eventId, occurrenceStart: notification?.data?.occurrenceStart, timezone: notification?.data?.timezone, openCalendar: true } });
                    openQChatTab();
                    executeEvent('openGroupMessage', {
                      from: notification?.data?.groupId,
                      eventId: notification?.data?.eventId,
                      occurrenceStart: notification?.data?.occurrenceStart,
                      timezone: notification?.data?.timezone,
                      openCalendar: true,
                    });
                    return;
                  }
                  if (hasNewNotifications) setLastSeenTimestamp(Date.now());
                  setAnchorEl(null);
                  const link = notification?.link;
                  if (!link) return;
                  // Any kind of qortal:// link; an app that is open shows
                  // the link's page.
                  void openQortalLink(link, { navigateIfAlreadyOpen: true });
                }}
                sx={{
                  borderRadius: '12px',
                  display: 'block',
                  p: 0,
                  whiteSpace: 'normal',
                  '&:hover': {
                    bgcolor: isDarkMode
                      ? alpha('#FFFFFF', 0.045)
                      : alpha(theme.palette.primary.main, 0.06),
                  },
                }}
              >
                <Card
                  elevation={0}
                  sx={{
                    bgcolor: unseen
                      ? isDarkMode
                        ? alpha(theme.palette.other.unread, 0.11)
                        : alpha(theme.palette.other.unread, 0.12)
                      : isDarkMode
                        ? alpha('#FFFFFF', 0.025)
                        : theme.palette.action.hover,
                    border: `1px solid ${
                      unseen
                        ? alpha(theme.palette.other.unread, 0.36)
                        : isDarkMode
                          ? alpha('#A9BCD8', 0.12)
                          : alpha(theme.palette.divider, 0.95)
                    }`,
                    borderRadius: '12px',
                    display: 'flex',
                    gap: 1.2,
                    p: 1.35,
                  }}
                >
                  <Avatar
                    alt={
                      isQChatMention
                        ? notification?.data?.groupName
                        : notification?.appName || 'App'
                    }
                    src={
                      isQChatMention
                        ? undefined
                        : `${getBaseApiReact()}${
                            notification?.image ||
                            `/arbitrary/THUMBNAIL/${notification?.appName || 'Q-Mail'}/qortal_avatar?async=true`
                          }`
                    }
                    sx={{
                      bgcolor: isDarkMode
                        ? alpha('#FFFFFF', 0.06)
                        : alpha(theme.palette.primary.main, 0.08),
                      height: 34,
                      width: 34,
                      '& img': { objectFit: 'contain' },
                    }}
                  >
                    {isQMail ? (
                      <MailOutlineIcon
                        sx={{
                          color: theme.palette.primary.main,
                          fontSize: 18,
                        }}
                      />
                    ) : (
                      <img
                        alt="app-icon"
                        src={LogoSelected}
                        style={{ height: 'auto', width: 20 }}
                      />
                    )}
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: 1,
                        justifyContent: 'space-between',
                      }}
                    >
                      <Typography
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '0.86rem',
                          fontWeight: 650,
                        }}
                      >
                        {isQChatMention
                          ? notification?.data?.groupName
                          : notification?.appName || 'Q-App'}
                      </Typography>
                      {timestamp && (
                        <Typography
                          sx={{
                            color: alpha(theme.palette.text.secondary, 0.72),
                            fontSize: '0.72rem',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatDate(timestamp)}
                        </Typography>
                      )}
                    </Box>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.secondary, 0.92),
                        fontSize: '0.8rem',
                        lineHeight: 1.45,
                        mt: 0.35,
                        wordBreak: 'break-word',
                      }}
                    >
                      {getNotificationMessage(
                        notification?.message,
                        i18n.language,
                        t('message.generic.new_notification', {
                          defaultValue: 'New notification',
                        })
                      )}
                    </Typography>
                  </Box>
                </Card>
              </MenuItem>
            );
          })}
        </Box>
      </Popover>

      <Dialog
        fullWidth
        maxWidth="sm"
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen}
        PaperProps={{
          sx: isDarkMode
            ? {
                background: '#121821',
                backgroundImage: 'none',
                border: `1px solid ${alpha('#A9BCD8', 0.18)}`,
                borderRadius: '18px',
                boxShadow: `0 26px 56px ${alpha('#000', 0.46)}`,
                overflow: 'hidden',
              }
            : {
                background: theme.palette.background.paper,
                backgroundImage: 'none',
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: '18px',
                boxShadow: `0 20px 48px ${alpha('#1E3248', 0.12)}`,
                overflow: 'hidden',
              },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            borderBottom: `1px solid ${
              isDarkMode ? alpha('#A9BCD8', 0.1) : theme.palette.divider
            }`,
            color: theme.palette.text.primary,
            display: 'flex',
            fontSize: '1.08rem',
            fontWeight: 650,
            justifyContent: 'space-between',
            px: 3,
            py: 2.35,
          }}
        >
          {t('message.generic.notification_settings', {
            defaultValue: 'Notification settings',
          })}
          <IconButton
            onClick={() => setSettingsOpen(false)}
            size="small"
            sx={{
              color: alpha(theme.palette.text.secondary, 0.92),
              '&:hover': {
                backgroundColor: isDarkMode
                  ? alpha('#FFFFFF', 0.05)
                  : alpha(theme.palette.action.active, 0.06),
                color: theme.palette.text.primary,
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent
          sx={{
            display: 'grid',
            gap: 1.9,
            px: 3,
            pb: 2.9,
            '&&': {
              pt: 3.1,
            },
          }}
        >
          <Box
            sx={{
              color: alpha(theme.palette.text.secondary, 0.82),
              fontSize: '0.84rem',
              lineHeight: 1.52,
            }}
          >
            {settingsSection === 'hub'
              ? t('message.generic.hub_notification_settings_desc', {
                  defaultValue:
                    'Choose which Hub features appear in your notification panel.',
                })
              : t('message.generic.notification_settings_desc', {
                  defaultValue:
                    'Choose which apps can send desktop alerts while keeping in-Hub activity visible.',
                })}
          </Box>
          <Box
            role="tablist"
            sx={{
              backgroundColor: isDarkMode
                ? alpha('#05080D', 0.5)
                : alpha(theme.palette.action.active, 0.055),
              border: `1px solid ${
                isDarkMode ? alpha('#A9BCD8', 0.12) : theme.palette.divider
              }`,
              borderRadius: '11px',
              display: 'grid',
              gap: 0.5,
              gridTemplateColumns: '1fr 1fr',
              p: 0.5,
            }}
          >
            {(
              [
                ['hub', 'Hub'],
                ['q-apps', 'Q-Apps'],
              ] as const
            ).map(([value, label]) => {
              const selected = settingsSection === value;
              return (
                <ButtonBase
                  aria-selected={selected}
                  key={value}
                  onClick={() => setSettingsSection(value)}
                  role="tab"
                  sx={{
                    backgroundColor: selected
                      ? isDarkMode
                        ? alpha(theme.palette.primary.main, 0.2)
                        : alpha(theme.palette.primary.main, 0.12)
                      : 'transparent',
                    border: `1px solid ${
                      selected
                        ? alpha(theme.palette.primary.main, 0.34)
                        : 'transparent'
                    }`,
                    borderRadius: '8px',
                    color: selected
                      ? theme.palette.text.primary
                      : theme.palette.text.secondary,
                    fontSize: '0.84rem',
                    fontWeight: selected ? 650 : 550,
                    minHeight: 36,
                    transition:
                      'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
                    '&:hover': {
                      backgroundColor: selected
                        ? isDarkMode
                          ? alpha(theme.palette.primary.main, 0.24)
                          : alpha(theme.palette.primary.main, 0.15)
                        : alpha(theme.palette.action.active, 0.06),
                    },
                  }}
                >
                  {label}
                </ButtonBase>
              );
            })}
          </Box>
          <List disablePadding sx={{ display: 'grid', gap: 1.2 }}>
            {settingsLoading ? (
              <Typography
                sx={{ color: alpha(theme.palette.text.secondary, 0.82) }}
              >
                {t('message.generic.loading', { defaultValue: 'Loading...' })}
              </Typography>
            ) : settingsSection === 'hub' ? (
              <Typography
                sx={{ color: alpha(theme.palette.text.secondary, 0.82) }}
              >
                {t('message.generic.no_notification_apps', {
                  defaultValue: 'No Q-Apps have notification permission yet.',
                })}
              </Typography>
            ) : (
              <>
                {settingsApps.length === 0 ? (
                  <Box
                    sx={{
                      alignItems: 'center',
                      border: `1px dashed ${
                        isDarkMode
                          ? alpha('#A9BCD8', 0.14)
                          : theme.palette.divider
                      }`,
                      borderRadius: '14px',
                      color: alpha(theme.palette.text.secondary, 0.8),
                      display: 'flex',
                      fontSize: '0.82rem',
                      justifyContent: 'center',
                      minHeight: 82,
                      px: 2,
                      textAlign: 'center',
                    }}
                  >
                    {t('message.generic.no_notification_apps', {
                      defaultValue:
                        'No Q-Apps have notification permission yet.',
                    })}
                  </Box>
                ) : (
                  settingsApps.map((appName) => (
                    <Box
                      key={appName}
                      sx={{
                        alignItems: 'center',
                        backgroundColor: isDarkMode
                          ? alpha('#FFFFFF', 0.026)
                          : theme.palette.action.hover,
                        border: `1px solid ${
                          isDarkMode
                            ? alpha('#A9BCD8', 0.12)
                            : theme.palette.divider
                        }`,
                        borderRadius: '14px',
                        display: 'flex',
                        gap: 2,
                        justifyContent: 'space-between',
                        px: 1.7,
                        py: 1.55,
                      }}
                    >
                      <Box
                        sx={{ alignItems: 'center', display: 'flex', gap: 1.2 }}
                      >
                        <Box
                          sx={{
                            alignItems: 'center',
                            backgroundColor: alpha(
                              theme.palette.primary.main,
                              0.12
                            ),
                            border: `1px solid ${alpha(theme.palette.primary.main, 0.22)}`,
                            borderRadius: '10px',
                            color: alpha(theme.palette.primary.light, 0.96),
                            display: 'inline-flex',
                            height: 34,
                            justifyContent: 'center',
                            width: 34,
                          }}
                        >
                          <AppsIcon sx={{ fontSize: 18 }} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            sx={{
                              color: theme.palette.text.primary,
                              fontSize: '0.92rem',
                              fontWeight: 600,
                            }}
                          >
                            {appName}
                          </Typography>
                          <Typography
                            sx={{
                              color: alpha(theme.palette.text.secondary, 0.76),
                              fontSize: '0.76rem',
                              lineHeight: 1.45,
                              mt: 0.3,
                            }}
                          >
                            {t('message.generic.disable_os_push_desc', {
                              defaultValue:
                                'Mute desktop alerts for this app while keeping in-Hub activity visible.',
                            })}
                          </Typography>
                        </Box>
                      </Box>
                      <Box
                        sx={{ alignItems: 'center', display: 'flex', gap: 1.2 }}
                      >
                        <Typography
                          sx={{
                            color: alpha(theme.palette.text.secondary, 0.82),
                            fontSize: '0.78rem',
                            fontWeight: 500,
                          }}
                        >
                          {t('message.generic.disable_os_push', {
                            defaultValue: 'Disable OS push',
                          })}
                        </Typography>
                        <Switch
                          checked={osPushDisabledMap[appName] === true}
                          onChange={async (_, checked) => {
                            await setNotificationOsPushDisabled(
                              appName,
                              checked
                            );
                            setOsPushDisabledMap((prev) => ({
                              ...prev,
                              [appName]: checked,
                            }));
                          }}
                          size="small"
                        />
                        <ButtonBase
                          onClick={async () => {
                            const notificationIds = (customSubscriptions ?? [])
                              .filter(
                                (sub) =>
                                  sub?.event === RESOURCE_EVENT &&
                                  sub?.appName === appName
                              )
                              .map((sub) => sub?.notificationId)
                              .filter(Boolean);
                            await setPermission(
                              getNotificationPermissionKey(appName),
                              false
                            );
                            setCustomSubscriptions((prev) =>
                              (prev ?? []).filter(
                                (sub) =>
                                  !(
                                    sub?.event === RESOURCE_EVENT &&
                                    sub?.appName === appName
                                  )
                              )
                            );
                            if (notificationIds.length) {
                              executeEvent(
                                'custom-ws-unsubscribe',
                                notificationIds
                              );
                            }
                            executeEvent(
                              'notifications-websocket-reconnect',
                              undefined
                            );
                            setSettingsApps((prev) =>
                              prev.filter((name) => name !== appName)
                            );
                          }}
                          sx={{
                            borderRadius: '10px',
                            color: theme.palette.error.light,
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            px: 1.1,
                            py: 0.6,
                            '&:hover': {
                              backgroundColor: alpha(
                                theme.palette.error.main,
                                0.08
                              ),
                            },
                          }}
                        >
                          {t('message.generic.revoke_permission', {
                            defaultValue: 'Revoke',
                          })}
                        </ButtonBase>
                      </Box>
                    </Box>
                  ))
                )}
              </>
            )}
          </List>
        </DialogContent>
      </Dialog>
    </>
  );
};

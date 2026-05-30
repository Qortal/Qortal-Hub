import AppsIcon from '@mui/icons-material/Apps';
import CloseIcon from '@mui/icons-material/Close';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
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
} from '../atoms/global';
import LogoSelected from '../assets/svgs/LogoSelected.svg';
import {
  getAppsWithNotificationPermission,
  getNotificationOsPushDisabledMap,
  getNotificationPermissionKey,
  setNotificationOsPushDisabled,
  setPermission,
} from '../qortal/qortal-requests';
import { extractComponents } from './Chat/MessageDisplay';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../utils/events';
import { formatDate } from '../utils/time';

const RESOURCE_EVENT = 'RESOURCE_PUBLISHED';

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
}) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsApps, setSettingsApps] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [osPushDisabledMap, setOsPushDisabledMap] = useState<
    Record<string, boolean>
  >({});
  const notifications = useAtomValue(paymentNotificationsAtom);
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
      (notifications ?? []).filter((item) => item?.event === RESOURCE_EVENT),
    [notifications]
  );
  const unseenCount = useMemo(() => {
    return resourceNotifications.filter((notification) => {
      const timestamp = getNotificationTimestamp(notification);
      if (timestamp == null) return false;
      if (isNotificationSeenInAppFromKeyTimes(notification, seenInAppKeyTimes))
        return false;
      return !lastSeenTimestamp || timestamp > lastSeenTimestamp;
    }).length;
  }, [resourceNotifications, seenInAppKeyTimes, lastSeenTimestamp]);

  const hasNewNotifications = unseenCount > 0;
  const NotificationIcon = hasNewNotifications
    ? NotificationsActiveRoundedIcon
    : NotificationsRoundedIcon;

  const openSettings = () => {
    setSettingsOpen(true);
    setSettingsLoading(true);
    Promise.all([
      getAppsWithNotificationPermission(),
      getNotificationOsPushDisabledMap(),
    ])
      .then(([apps, disabledMap]) => {
        setSettingsApps(apps);
        setOsPushDisabledMap(disabledMap || {});
      })
      .finally(() => setSettingsLoading(false));
  };

  return (
    <>
      <ButtonBase
        aria-label="Notifications"
        onClick={(event) => {
          event.stopPropagation();
          setAnchorEl(event.currentTarget);
        }}
        sx={{
          position: 'relative',
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
              {t('message.generic.notifications', {
                defaultValue: 'Notifications',
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
          <NotificationIcon
            sx={{
              color: hasNewNotifications
                ? theme.palette.other.unread
                : theme.palette.text.secondary,
              fontSize: compact ? 20 : undefined,
              ...(iconSx || {}),
            }}
          />
        </Tooltip>
        {hasNewNotifications && (
          <Box
            component="span"
            sx={{
              bgcolor: theme.palette.other.unread,
              borderRadius: '7px',
              color: '#fff',
              fontSize: '0.6rem',
              fontWeight: 700,
              height: 14,
              lineHeight: '14px',
              minWidth: 14,
              pointerEvents: 'none',
              position: 'absolute',
              px: '3px',
              right: compact ? 0 : -5,
              textAlign: 'center',
              top: compact ? 0 : -5,
            }}
          >
            {unseenCount > 99 ? '99+' : unseenCount}
          </Box>
        )}
      </ButtonBase>

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
            alignItems: resourceNotifications.length ? 'stretch' : 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: resourceNotifications.length ? 1 : 1.2,
            maxHeight: '60vh',
            overflow: 'auto',
            ...(resourceNotifications.length
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

          {!resourceNotifications.length && (
            <>
              <NotificationIcon
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
                  if (hasNewNotifications) setLastSeenTimestamp(Date.now());
                  setAnchorEl(null);
                  const link = notification?.link;
                  if (!link) return;
                  const data = extractComponents(link);
                  if (!data) return;
                  executeEvent('addTab', {
                    data: { ...data, navigateIfAlreadyOpen: true },
                  });
                  executeEvent('open-apps-mode', {});
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
                    alt={notification?.appName || 'App'}
                    src={`${getBaseApiReact()}${
                      notification?.image ||
                      `/arbitrary/THUMBNAIL/${notification?.appName || 'Q-Mail'}/qortal_avatar?async=true`
                    }`}
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
                        {notification?.appName || 'Q-App'}
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
            {t('message.generic.notification_settings_desc', {
              defaultValue:
                'Choose which apps can send desktop alerts while keeping in-Hub activity visible.',
            })}
          </Box>
          {settingsLoading ? (
            <Typography
              sx={{ color: alpha(theme.palette.text.secondary, 0.82) }}
            >
              {t('message.generic.loading', { defaultValue: 'Loading...' })}
            </Typography>
          ) : settingsApps.length === 0 ? (
            <Box
              sx={{
                color: alpha(theme.palette.text.secondary, 0.82),
                fontSize: '0.92rem',
                lineHeight: 1.55,
                pt: 0.1,
              }}
            >
              {t('message.generic.no_notification_apps', {
                defaultValue: 'No apps have notification permission yet.',
              })}
            </Box>
          ) : (
            <List disablePadding sx={{ display: 'grid', gap: 1.2 }}>
              {settingsApps.map((appName) => (
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
                  <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.2 }}>
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
                  <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.2 }}>
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
                        await setNotificationOsPushDisabled(appName, checked);
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
              ))}
            </List>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

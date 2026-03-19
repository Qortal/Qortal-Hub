import { useEffect, useMemo, useState } from 'react';
import {
  alpha,
  Avatar,
  Box,
  ButtonBase,
  Card,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  MenuItem,
  Popover,
  Switch,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import SettingsIcon from '@mui/icons-material/Settings';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import AppsIcon from '@mui/icons-material/Apps';
import CloseIcon from '@mui/icons-material/Close';
import { formatDate } from '../utils/time';
import { useHandlePaymentNotification } from '../hooks/useHandlePaymentNotification';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../utils/events';
import { useTranslation } from 'react-i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  paymentNotificationsAtom,
  lastPaymentSeenTimestampAtom,
  notificationSeenInAppKeysAtom,
  customWebsocketSubscriptionsAtom,
  getNotificationSeenKey,
  getNotificationSeenPrefixKey,
} from '../atoms/global';
import {
  getAppsWithNotificationPermission,
  getNotificationPermissionKey,
  getNotificationOsPushDisabledMap,
  setNotificationOsPushDisabled,
  setPermission,
} from '../qortal/qortal-requests';
import { checkDifference } from '../background/background';
import { getBaseApiReact } from '../App';
import LogoSelected from '../assets/svgs/LogoSelected.svg';
import { extractComponents } from './Chat/MessageDisplay';
import { Spacer } from '../common/Spacer';

const PAYMENT_EVENT = 'PAYMENT_RECEIVED';
const RESOURCE_EVENT = 'RESOURCE_PUBLISHED';

function getGroupKey(notification) {
  if (notification?.event === PAYMENT_EVENT) return PAYMENT_EVENT;
  if (notification?.event === RESOURCE_EVENT) {
    const appName = notification?.appName ?? 'Publishes';
    const appService = notification?.appService ?? 'APP';
    return `${RESOURCE_EVENT}-${appName}-${appService}`;
  }
  return notification?.event || 'other';
}

function getGroupLabel(notification) {
  if (notification?.event === PAYMENT_EVENT) return 'Payments';
  if (
    notification?.event === RESOURCE_EVENT &&
    notification?.notificationId === 'q-mail-notification'
  ) {
    return notification?.appName || 'Q-Mail';
  }
  if (notification?.event === RESOURCE_EVENT)
    return notification?.appName || 'Publishes';
  return notification?.event || 'Other';
}

/** Normalize to ms (server may send seconds). */
function toTimestampMs(v) {
  if (v == null || typeof v !== 'number') return v ?? null;
  return v < 1e12 ? v * 1000 : v;
}

function getNotificationTimestamp(notification) {
  const raw =
    notification?.data?.created ??
    notification?.data?.timestamp ??
    notification?.timestamp;
  return toTimestampMs(raw);
}

function isNotificationUnseen(notification, lastEnteredTimestampPayment) {
  const ts = getNotificationTimestamp(notification);
  if (ts == null || !checkDifference(ts)) return false;
  if (!lastEnteredTimestampPayment) return true;
  return ts > lastEnteredTimestampPayment;
}

function isNotificationSeenInApp(notification, seenInAppKeysSet) {
  if (!seenInAppKeysSet || !seenInAppKeysSet.size) return false;
  const key = getNotificationSeenKey(notification);
  const prefixKey = getNotificationSeenPrefixKey(notification);
  return seenInAppKeysSet.has(key) || seenInAppKeysSet.has(prefixKey);
}

/** Pick message in current language, else en, else first available. Reactive when lang/fallback change. */
function getNotificationMessageReactive(
  messageObj: Record<string, string> | undefined,
  currentLang: string,
  fallback: string
): string {
  if (!messageObj || typeof messageObj !== 'object') return fallback;
  const lang = (currentLang || 'en').split('-')[0];
  const current = messageObj[lang];
  if (typeof current === 'string' && current.trim()) return current.trim();
  const en = messageObj.en;
  if (typeof en === 'string' && en.trim()) return en.trim();
  const first = Object.values(messageObj).find(
    (v) => typeof v === 'string' && (v as string).trim()
  );
  return typeof first === 'string' ? (first as string).trim() : fallback;
}

export const GeneralNotifications = ({
  address,
  tooltipPlacement = 'left',
}: {
  address: string;
  tooltipPlacement?:
    | 'left'
    | 'right'
    | 'top'
    | 'bottom'
    | 'top-start'
    | 'top-end'
    | 'bottom-start'
    | 'bottom-end'
    | 'left-start'
    | 'left-end'
    | 'right-start'
    | 'right-end';
}) => {
  const [anchorEl, setAnchorEl] = useState(null);

  const notifications = useAtomValue(paymentNotificationsAtom);
  const lastEnteredTimestampPayment = useAtomValue(
    lastPaymentSeenTimestampAtom
  );
  const seenInAppKeys = useAtomValue(notificationSeenInAppKeysAtom);
  const setSeenInAppKeys = useSetAtom(notificationSeenInAppKeysAtom);
  const customSubscriptions = useAtomValue(customWebsocketSubscriptionsAtom);
  const setCustomSubscriptions = useSetAtom(customWebsocketSubscriptionsAtom);
  const [notificationSettingsModalOpen, setNotificationSettingsModalOpen] =
    useState(false);
  const [notificationSettingsApps, setNotificationSettingsApps] = useState<
    string[]
  >([]);
  const [notificationOsPushDisabledMap, setNotificationOsPushDisabledMap] =
    useState<Record<string, boolean>>({});
  const [notificationSettingsLoading, setNotificationSettingsLoading] =
    useState(false);

  const seenInAppKeysSet = useMemo(
    () => (Array.isArray(seenInAppKeys) ? new Set(seenInAppKeys) : new Set()),
    [seenInAppKeys]
  );

  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail;
      if (
        detail &&
        typeof detail === 'object' &&
        'address' in detail &&
        'keys' in detail
      ) {
        setSeenInAppKeys({ address: detail.address, keys: detail.keys });
      } else if (Array.isArray(detail)) {
        setSeenInAppKeys(detail);
      }
    };
    subscribeToEvent('notification-seen-in-app-updated', handler);
    return () =>
      unsubscribeFromEvent('notification-seen-in-app-updated', handler);
  }, [setSeenInAppKeys]);

  const {
    getNameOrAddressOfSenderMiddle,
    setLastEnteredTimestampPayment,
    nameAddressOfSender,
  } = useHandlePaymentNotification(address);

  const latestTimestamp = useMemo(() => {
    if (!notifications.length) return null;
    return getNotificationTimestamp(notifications[0]);
  }, [notifications]);

  const unseenCount = useMemo(() => {
    const isUnseen = (n) => {
      const ts = getNotificationTimestamp(n);
      const unseenByTimestamp = !lastEnteredTimestampPayment
        ? ts != null && checkDifference(ts)
        : ts != null && checkDifference(ts) && ts > lastEnteredTimestampPayment;
      if (!unseenByTimestamp) return false;
      return !isNotificationSeenInApp(n, seenInAppKeysSet);
    };

    return notifications.filter(isUnseen).length;
  }, [notifications, lastEnteredTimestampPayment, seenInAppKeysSet]);

  const hasNewNotifications = unseenCount > 0;

  const groups = useMemo(() => {
    const map = new Map();
    for (const n of notifications) {
      const key = getGroupKey(n);
      if (!map.has(key)) {
        map.set(key, { key, label: getGroupLabel(n), items: [] });
      }
      map.get(key).items.push(n);
    }
    return Array.from(map.values());
  }, [notifications]);

  const [expandedGroup, setExpandedGroup] = useState(null);

  const handlePopupClick = (event) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setExpandedGroup(null);
  };

  const { t, i18n } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const theme = useTheme();

  return (
    <>
      <ButtonBase
        onClick={(e) => {
          handlePopupClick(e);
        }}
        sx={{
          position: 'relative',
          minWidth: 32,
          minHeight: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
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
              {t('core:message.generic.notifications')}
            </span>
          }
          placement={tooltipPlacement}
          arrow
          sx={{ fontSize: '24' }}
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
          <NotificationsIcon
            sx={{
              color: hasNewNotifications
                ? theme.palette.other.unread
                : theme.palette.text.secondary,
            }}
          />
        </Tooltip>
        {hasNewNotifications && unseenCount > 0 && (
          <Box
            component="span"
            sx={{
              position: 'absolute',
              top: 1,
              right: 1,
              minWidth: 14,
              height: 14,
              borderRadius: '7px',
              bgcolor: theme.palette.other.unread,
              color: '#fff',
              fontSize: '0.6rem',
              fontWeight: 700,
              lineHeight: '14px',
              px: '3px',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            {unseenCount > 99 ? '99+' : unseenCount}
          </Box>
        )}
      </ButtonBase>

      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => {
          if (hasNewNotifications) {
            setLastEnteredTimestampPayment(Date.now());
          }
          setAnchorEl(null);
        }}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <Box
          sx={{
            alignItems: notifications.length > 0 ? 'flex-start' : 'center',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '60vh',
            maxWidth: '100%',
            overflow: 'auto',
            padding: 2,
            position: 'relative',
            width: 420,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              position: 'absolute',
              top: 8,
              right: 8,
            }}
          >
            <IconButton
              size="small"
              onClick={() => {
                setNotificationSettingsModalOpen(true);
                setNotificationSettingsLoading(true);
                Promise.all([
                  getAppsWithNotificationPermission(),
                  getNotificationOsPushDisabledMap(),
                ])
                  .then(([apps, disabledMap]) => {
                    setNotificationSettingsApps(apps);
                    setNotificationOsPushDisabledMap(disabledMap || {});
                  })
                  .finally(() => setNotificationSettingsLoading(false));
              }}
              sx={{ color: theme.palette.text.secondary }}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Box>
          <Spacer height="20px" />
          {notifications.length === 0 && (
            <Typography sx={{ userSelect: 'none' }}>
              {t('core:message.generic.no_notifications')}
            </Typography>
          )}

          {groups.map((group) => {
            const isExpanded = expandedGroup === group.key;
            const isPayment = group.key === PAYMENT_EVENT;
            const groupUnseenCount = group.items.filter(
              (n) =>
                isNotificationUnseen(n, lastEnteredTimestampPayment) &&
                !isNotificationSeenInApp(n, seenInAppKeysSet)
            ).length;

            return (
              <Box key={group.key} sx={{ width: '100%' }}>
                <ListItemButton
                  onClick={() =>
                    setExpandedGroup(isExpanded ? null : group.key)
                  }
                  sx={{
                    borderRadius: 1.5,
                    py: 1.25,
                    px: 1.5,
                    '&:hover': { backgroundColor: 'action.hover' },
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 1.5,
                      width: '100%',
                    }}
                  >
                    {isPayment ? (
                      <AccountBalanceWalletIcon
                        sx={{ color: theme.palette.text.primary, fontSize: 22 }}
                      />
                    ) : group?.label === 'Q-Mail' ? (
                      <MailOutlineIcon
                        sx={{ color: theme.palette.text.primary, fontSize: 22 }}
                      />
                    ) : (
                      <AppsIcon
                        sx={{ color: theme.palette.text.primary, fontSize: 22 }}
                      />
                    )}
                    <Typography
                      sx={{ flex: 1, fontWeight: 600, fontSize: '0.9375rem' }}
                    >
                      {group.label}
                    </Typography>
                    {groupUnseenCount > 0 && (
                      <Typography
                        sx={{
                          color: theme.palette.other.unread,
                          fontSize: '0.8125rem',
                          fontWeight: 700,
                        }}
                      >
                        {groupUnseenCount}
                      </Typography>
                    )}
                    <Typography
                      sx={{
                        color: 'text.secondary',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        minWidth: 24,
                        textAlign: 'right',
                      }}
                    >
                      {group.items.length}
                    </Typography>
                    {isExpanded ? (
                      <ExpandLess sx={{ color: 'text.secondary' }} />
                    ) : (
                      <ExpandMore sx={{ color: 'text.secondary' }} />
                    )}
                  </Box>
                </ListItemButton>

                <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                  <List
                    disablePadding
                    sx={{
                      pl: 0.5,
                      pr: 0.5,
                      pb: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                    }}
                  >
                    {group.items.map((data) => {
                      const tx = data.data;
                      const eventTypePublish = data?.event === RESOURCE_EVENT;
                      const eventTypePayment = data?.event === PAYMENT_EVENT;
                      const itemKey =
                        tx?.identifier ||
                        tx?.timestamp ||
                        tx?.created ||
                        `${data.event}-${group.items.indexOf(data)}`;
                      const isItemUnseen =
                        isNotificationUnseen(
                          data,
                          lastEnteredTimestampPayment
                        ) && !isNotificationSeenInApp(data, seenInAppKeysSet);

                      if (eventTypePublish) {
                        return (
                          <MenuItem
                            key={itemKey}
                            sx={{
                              alignItems: 'stretch',
                              display: 'flex',
                              flexDirection: 'column',
                              textWrap: 'auto',
                              width: '100%',
                              p: 0,
                              borderRadius: 1.5,
                              overflow: 'hidden',
                              '&:hover': {
                                backgroundColor: 'action.hover',
                              },
                            }}
                            onClick={() => {
                              if (hasNewNotifications) {
                                setLastEnteredTimestampPayment(Date.now());
                              }
                              setAnchorEl(null);
                              if (data?.link) {
                                const res = extractComponents(data.link);
                                if (res) {
                                  const { service, name, identifier, path } =
                                    res;
                                  executeEvent('addTab', {
                                    data: {
                                      service,
                                      name,
                                      identifier,
                                      path,
                                      navigateIfAlreadyOpen: true,
                                    },
                                  });
                                  executeEvent('open-apps-mode', {});
                                }
                              }
                            }}
                          >
                            <Card
                              elevation={0}
                              sx={{
                                backgroundColor:
                                  theme.palette.background.default,
                                border: `1px solid ${theme.palette.divider}`,
                                borderLeft: isItemUnseen
                                  ? `3px solid ${theme.palette.other.unread}`
                                  : undefined,
                                borderRadius: 1.5,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 1,
                                padding: 1.5,
                                width: '100%',
                                transition: 'border-color 0.15s ease',
                                ...(isItemUnseen && {
                                  bgcolor: alpha(
                                    theme.palette.other.unread,
                                    0.12
                                  ),
                                }),
                              }}
                            >
                              <Box
                                sx={{
                                  alignItems: 'center',
                                  display: 'flex',
                                  gap: 1,
                                  justifyContent: 'space-between',
                                }}
                              >
                                <Avatar
                                  sx={{
                                    height: 32,
                                    width: 32,
                                    bgcolor: theme.palette.background.paper,
                                    '& img': { objectFit: 'contain' },
                                  }}
                                  alt={data?.appName}
                                  src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${data?.appName || 'Q-Mail'}/qortal_avatar?async=true`}
                                >
                                  <img
                                    style={{ width: 20, height: 'auto' }}
                                    src={LogoSelected}
                                    alt="app-icon"
                                  />
                                </Avatar>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: 'text.secondary',
                                    fontWeight: 500,
                                  }}
                                >
                                  {formatDate(tx?.created ?? tx?.timestamp)}
                                </Typography>
                              </Box>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 500,
                                  lineHeight: 1.4,
                                  wordBreak: 'break-word',
                                  whiteSpace: 'normal',
                                }}
                              >
                                {getNotificationMessageReactive(
                                  data?.message,
                                  i18n.language ?? 'en',
                                  t('core:message.generic.new_notification')
                                )}
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontSize: '0.8125rem',
                                }}
                              >
                                {tx?.name ||
                                  nameAddressOfSender.current[tx?.sender] ||
                                  getNameOrAddressOfSenderMiddle(tx?.sender)}
                              </Typography>
                            </Card>
                          </MenuItem>
                        );
                      }
                      if (eventTypePayment) {
                        return (
                          <MenuItem
                            key={itemKey}
                            sx={{
                              alignItems: 'stretch',
                              display: 'flex',
                              flexDirection: 'column',
                              textWrap: 'auto',
                              width: '100%',
                              p: 0,
                              borderRadius: 1.5,
                              overflow: 'hidden',
                              '&:hover': {
                                backgroundColor: 'action.hover',
                              },
                            }}
                            onClick={() => {
                              if (hasNewNotifications) {
                                setLastEnteredTimestampPayment(Date.now());
                              }
                              setAnchorEl(null);
                              executeEvent('openWalletsApp', {});
                            }}
                          >
                            <Card
                              elevation={0}
                              sx={{
                                backgroundColor:
                                  theme.palette.background.default,
                                border: `1px solid ${theme.palette.divider}`,
                                borderLeft: isItemUnseen
                                  ? `3px solid ${theme.palette.other.unread}`
                                  : undefined,
                                borderRadius: 1.5,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 1,
                                padding: 1.5,
                                width: '100%',
                                transition: 'border-color 0.15s ease',
                                ...(isItemUnseen && {
                                  bgcolor: alpha(
                                    theme.palette.other.unread,
                                    0.12
                                  ),
                                }),
                              }}
                            >
                              <Box
                                sx={{
                                  alignItems: 'center',
                                  display: 'flex',
                                  gap: 1,
                                  justifyContent: 'space-between',
                                }}
                              >
                                <AccountBalanceWalletIcon
                                  sx={{
                                    color: theme.palette.primary.main,
                                    fontSize: 22,
                                  }}
                                />
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: 'text.secondary',
                                    fontWeight: 500,
                                  }}
                                >
                                  {formatDate(tx?.created ?? tx?.timestamp)}
                                </Typography>
                              </Box>
                              <Typography
                                variant="body2"
                                sx={{ fontWeight: 600, lineHeight: 1.4 }}
                              >
                                {tx?.amount} QORT
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontSize: '0.8125rem',
                                }}
                              >
                                {nameAddressOfSender.current[tx?.sender] ||
                                  getNameOrAddressOfSenderMiddle(tx?.sender)}
                              </Typography>
                            </Card>
                          </MenuItem>
                        );
                      }
                      return null;
                    })}
                  </List>
                </Collapse>
              </Box>
            );
          })}
        </Box>
      </Popover>

      <Dialog
        open={notificationSettingsModalOpen}
        onClose={() => setNotificationSettingsModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pr: 1,
          }}
        >
          {t('core:message.generic.notification_settings', {
            defaultValue: 'Notification settings',
          })}
          <IconButton
            aria-label="close"
            onClick={() => setNotificationSettingsModalOpen(false)}
            size="small"
            sx={{ ml: 1 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {notificationSettingsLoading ? (
            <Typography color="text.secondary">
              {t('core:message.generic.loading', {
                defaultValue: 'Loading...',
              })}
            </Typography>
          ) : notificationSettingsApps.length === 0 ? (
            <Typography color="text.secondary">
              {t('core:message.generic.no_notification_apps', {
                defaultValue: 'No apps have notification permission yet.',
              })}
            </Typography>
          ) : (
            <List disablePadding>
              {notificationSettingsApps.map((appName) => {
                const osPushDisabled =
                  notificationOsPushDisabledMap[appName] === true;
                return (
                  <Box
                    key={appName}
                    sx={{
                      alignItems: 'center',
                      borderBottom: 1,
                      borderColor: 'divider',
                      display: 'flex',
                      justifyContent: 'space-between',
                      py: 1.5,
                      gap: 2,
                    }}
                  >
                    <Typography sx={{ fontWeight: 500 }}>{appName}</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography
                        variant="body2"
                        sx={{ color: 'text.secondary' }}
                      >
                        {t('core:message.generic.disable_os_push', {
                          defaultValue: 'Disable OS push',
                        })}
                      </Typography>
                      <Switch
                        checked={osPushDisabled}
                        onChange={async (_, checked) => {
                          await setNotificationOsPushDisabled(appName, checked);
                          setNotificationOsPushDisabledMap((prev) => ({
                            ...prev,
                            [appName]: checked,
                          }));
                        }}
                        size="small"
                      />
                    </Box>
                    <ButtonBase
                      sx={{
                        color: 'error.main',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                      }}
                      onClick={async () => {
                        const toRemove = (customSubscriptions ?? []).filter(
                          (s) =>
                            s?.event === 'RESOURCE_PUBLISHED' &&
                            s?.appName === appName
                        );
                        const notificationIds = toRemove
                          .map((s) => s?.notificationId ?? '')
                          .filter(Boolean);
                        await setPermission(
                          getNotificationPermissionKey(appName),
                          false
                        );
                        setCustomSubscriptions((prev) =>
                          (prev ?? []).filter(
                            (s) =>
                              !(
                                s?.event === 'RESOURCE_PUBLISHED' &&
                                s?.appName === appName
                              )
                          )
                        );
                        if (notificationIds.length > 0) {
                          executeEvent(
                            'custom-ws-unsubscribe',
                            notificationIds
                          );
                        }
                        executeEvent(
                          'notifications-websocket-reconnect',
                          undefined
                        );
                        setNotificationSettingsApps((prev) =>
                          prev.filter((a) => a !== appName)
                        );
                        setNotificationOsPushDisabledMap((prev) => {
                          const next = { ...prev };
                          delete next[appName];
                          return next;
                        });
                      }}
                    >
                      {t('core:message.generic.revoke_permission', {
                        defaultValue: 'Revoke permission',
                      })}
                    </ButtonBase>
                  </Box>
                );
              })}
            </List>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

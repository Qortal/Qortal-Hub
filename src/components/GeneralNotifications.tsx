import { useEffect, useMemo, useState } from 'react';
import {
  alpha,
  Avatar,
  Box,
  ButtonBase,
  Card,
  Collapse,
  List,
  ListItemButton,
  MenuItem,
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import AppsIcon from '@mui/icons-material/Apps';
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
  getNotificationSeenKey,
  getNotificationSeenPrefixKey,
} from '../atoms/global';
import { checkDifference } from '../background/background';
import { getBaseApiReact } from '../App';
import LogoSelected from '../assets/svgs/LogoSelected.svg';
import { extractComponents } from './Chat/MessageDisplay';

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
    notification?.data?.timestamp ??
    notification?.data?.created ??
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

  const seenInAppKeysSet = useMemo(
    () => (Array.isArray(seenInAppKeys) ? new Set(seenInAppKeys) : new Set()),
    [seenInAppKeys]
  );

  useEffect(() => {
    const handler = (e) => setSeenInAppKeys(e.detail ?? []);
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
        : ts != null &&
          checkDifference(ts) &&
          ts > lastEnteredTimestampPayment;
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

  const { t } = useTranslation([
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
              {t('core:payment_notification')}
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
            width: 420,
          }}
        >
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
                        ) &&
                        !isNotificationSeenInApp(data, seenInAppKeysSet);

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
                              setAnchorEl(null);
                              if (data?.link) {
                                const res = extractComponents(data.link);
                                if (res) {
                                  const { service, name, identifier, path } =
                                    res;
                                  executeEvent('addTab', {
                                    data: { service, name, identifier, path },
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
                                sx={{ fontWeight: 500, lineHeight: 1.4 }}
                              >
                                {data?.message?.en ?? 'New notification'}
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
                                  {formatDate(tx?.timestamp)}
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
    </>
  );
};

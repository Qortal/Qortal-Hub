import {
  Box,
  CircularProgress,
  Divider,
  Typography,
  useTheme,
} from '@mui/material';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  managedSubscriptionsAtom,
  managedSubscriptionsLoadingAtom,
  mySubscriptionsAtom,
  subscriptionsLoadingAtom,
} from '../../atoms/global';
import {
  clearMemberGroupsPolling,
  triggerMemberGroupsFetch,
} from '../../subscriptions/useInitializeMySubscriptions';
import { executeEvent } from '../../utils/events';

// Re-export for backwards-compat (callers like useAppReset import these).
export { clearMemberGroupsPolling, triggerMemberGroupsFetch };

function useFormatTimeUntil() {
  const { t } = useTranslation(['group']);
  return (ts: number): string => {
    const diff = ts - Date.now();
    if (diff <= 0) return t('group:subscription.time_soon');
    const mins = Math.floor(diff / 60_000);
    if (mins < 60)
      return t('group:subscription.time_in_mins', { count: mins });
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 24)
      return t('group:subscription.time_in_hours', { count: hours });
    const days = Math.floor(diff / 86_400_000);
    if (days < 30)
      return t('group:subscription.time_in_days', { count: days });
    const months = Math.floor(days / 30);
    return t('group:subscription.time_in_months', { count: months });
  };
}

export type SubscribedToActivityProps = {
  compact?: boolean;
  onPaymentCountChange?: (count: number) => void;
};

export function SubscribedToActivity({
  compact = false,
  onPaymentCountChange,
}: SubscribedToActivityProps) {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const formatTimeUntil = useFormatTimeUntil();

  // Read subscription data from global atoms (populated by useInitializeMySubscriptions in the title bar).
  const mySubscriptions = useAtomValue(mySubscriptionsAtom);
  const managedSubscriptions = useAtomValue(managedSubscriptionsAtom);
  const loading = useAtomValue(subscriptionsLoadingAtom);
  const managedLoading = useAtomValue(managedSubscriptionsLoadingAtom);

  const totalManagedActions = useMemo(
    () =>
      managedSubscriptions.reduce(
        (sum, entry) => sum + (entry.actions?.totalActions ?? 0),
        0
      ),
    [managedSubscriptions]
  );

  const totalNeedingPayment = mySubscriptions.filter(
    (s) => s.status === 'payment-needed'
  ).length;

  useEffect(() => {
    if (!loading && !managedLoading) {
      onPaymentCountChange?.(totalNeedingPayment + totalManagedActions);
    }
  }, [
    totalNeedingPayment,
    totalManagedActions,
    loading,
    managedLoading,
    onPaymentCountChange,
  ]);

  if (loading || managedLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: compact ? 120 : 200,
        }}
      >
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (mySubscriptions.length === 0 && managedSubscriptions.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: compact ? 120 : 200,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {t('group:subscription.no_active')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <Typography
        variant="caption"
        sx={{
          color: 'text.disabled',
          alignSelf: 'flex-end',
          mb: '2px',
        }}
      >
        {t('group:subscription.auto_refresh')}
      </Typography>
      {totalNeedingPayment > 0 && (
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            px: '10px',
            py: '5px',
            mb: '4px',
            borderRadius: '6px',
            bgcolor: theme.palette.background.default,
            border: `1px solid ${theme.palette.warning.main}44`,
            alignSelf: 'flex-start',
          }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: theme.palette.warning.main,
              flexShrink: 0,
            }}
          />
          <Typography
            variant="caption"
            sx={{
              color: theme.palette.warning.main,
              fontWeight: 600,
              lineHeight: 1,
              fontSize: '14px',
            }}
          >
            {t('group:subscription.needs_payment', {
              count: totalNeedingPayment,
            })}
          </Typography>
        </Box>
      )}

      {mySubscriptions.map((sub) => {
        const needsPayment = sub.status === 'payment-needed';
        const statusColor = needsPayment
          ? theme.palette.warning.main
          : theme.palette.success.main;

        return (
          <Box
            key={sub.id}
            onClick={() => {
              executeEvent('addTab', {
                data: { service: 'APP', name: 'Subscriptions', path: sub.link },
              });
              executeEvent('open-apps-mode', {});
            }}
            sx={{
              alignItems: 'center',
              bgcolor: theme.palette.background.default,
              border: `1px solid ${theme.palette.divider}`,
              borderLeft: `3px solid ${statusColor}`,
              borderRadius: '10px',
              cursor: 'pointer',
              display: 'flex',
              gap: '12px',
              padding: '12px 14px',
              transition: 'background-color 0.15s ease',
              '&:hover': { bgcolor: theme.palette.action.hover },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {sub.title}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: theme.palette.text.secondary,
                  display: 'block',
                  mt: '2px',
                }}
              >
                {t('group:subscription.by_owner', { name: sub.ownerName })}
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: theme.palette.text.disabled, display: 'block' }}
              >
                {sub.priceQort} QORT / {sub.billingInterval}
                {!needsPayment && sub.nextPaymentDue != null && (
                  <> · {t('group:subscription.expires', { when: formatTimeUntil(sub.nextPaymentDue) })}</>
                )}
              </Typography>
            </Box>

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                flexShrink: 0,
              }}
            >
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: statusColor,
                }}
              />
              <Typography
                variant="caption"
                sx={{
                  color: statusColor,
                  fontWeight: 600,
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {needsPayment
                  ? t('group:subscription.status_due')
                  : t('group:subscription.status_active')}
              </Typography>
            </Box>
          </Box>
        );
      })}

      {managedSubscriptions.length > 0 && (
        <>
          {mySubscriptions.length > 0 && <Divider sx={{ my: '6px' }} />}

          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              px: '10px',
              py: '5px',
              mb: '2px',
              borderRadius: '6px',
              bgcolor: theme.palette.background.default,
              border: `1px solid ${theme.palette.divider}`,
              alignSelf: 'flex-start',
            }}
          >
            {totalManagedActions > 0 && (
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: theme.palette.warning.main,
                  flexShrink: 0,
                }}
              />
            )}
            <Typography
              variant="caption"
              sx={{
                color:
                  totalManagedActions > 0
                    ? theme.palette.warning.main
                    : theme.palette.text.secondary,
                fontWeight: 600,
                lineHeight: 1,
                fontSize: '14px',
              }}
            >
              {totalManagedActions > 0
                ? t('group:subscription.actions_needed', {
                    count: totalManagedActions,
                  })
                : t('group:subscription.managed_subscriptions')}
            </Typography>
          </Box>

          {managedSubscriptions.map((entry) => {
            const { group, actions } = entry;
            const hasActions = actions.totalActions > 0;
            const accentColor = hasActions
              ? theme.palette.warning.main
              : theme.palette.info.main;

            return (
              <Box
                key={entry.groupId}
                onClick={() => {
                  executeEvent('addTab', {
                    data: {
                      service: 'APP',
                      name: 'Subscriptions',
                      path: entry.url,
                    },
                  });
                  executeEvent('open-apps-mode', {});
                }}
                sx={{
                  alignItems: 'center',
                  bgcolor: theme.palette.background.default,
                  border: `1px solid ${theme.palette.divider}`,
                  borderLeft: `3px solid ${accentColor}`,
                  borderRadius: '10px',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: '12px',
                  padding: '12px 14px',
                  transition: 'background-color 0.15s ease',
                  '&:hover': { bgcolor: theme.palette.action.hover },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: theme.palette.text.primary,
                      fontWeight: 600,
                      fontSize: '0.9rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {group.groupName}
                  </Typography>
                  {group.description && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: theme.palette.text.secondary,
                        display: 'block',
                        mt: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {group.description as string}
                    </Typography>
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      color: theme.palette.text.disabled,
                      display: 'block',
                    }}
                  >
                    {t('group:subscription.member', {
                      count: group.memberCount,
                    })}
                    {actions.pendingJoinRequests > 0 && (
                      <>
                        {' '}
                        · {t('group:subscription.pending_join_request', {
                          count: actions.pendingJoinRequests,
                        })}
                      </>
                    )}
                    {actions.needsReEncryption && (
                      <> · {t('group:subscription.re_encryption_needed')}</>
                    )}
                  </Typography>
                </Box>

                {hasActions && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      flexShrink: 0,
                    }}
                  >
                    <Box
                      sx={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        bgcolor: accentColor,
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        color: accentColor,
                        fontWeight: 600,
                        fontSize: '0.72rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {t('group:subscription.actions_needed', {
                        count: actions.totalActions,
                      })}
                    </Typography>
                  </Box>
                )}
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}

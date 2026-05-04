import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ListAltRoundedIcon from '@mui/icons-material/ListAltRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import {
  Box,
  ButtonBase,
  CircularProgress,
  Divider,
  Popover,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useAtomValue } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  managedSubscriptionsAtom,
  managedSubscriptionsLoadingAtom,
  mySubscriptionsAtom,
  subscriptionsLoadingAtom,
} from '../../atoms/global';
import { useInitializeMySubscriptions } from '../../subscriptions/useInitializeMySubscriptions';
import { executeEvent } from '../../utils/events';

type SubscriptionsStatusProps = {
  buttonSx?: any;
  compact?: boolean;
  iconSx?: any;
  tooltipPlacement?: 'bottom' | 'left' | 'right' | 'top';
};

export function SubscriptionsStatus({
  buttonSx,
  compact = false,
  iconSx,
  tooltipPlacement = 'bottom',
}: SubscriptionsStatusProps) {
  useInitializeMySubscriptions();

  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const { t } = useTranslation(['group']);

  const formatTimeUntil = useCallback(
    (timestamp: number | null | undefined) => {
      if (!timestamp) return '';
      const diff = timestamp - Date.now();
      if (diff <= 0) return t('group:subscription.relative_soon');
      const minutes = Math.floor(diff / 60_000);
      if (minutes < 60) {
        return t('group:subscription.relative_in_minutes', { count: minutes });
      }
      const hours = Math.floor(diff / 3_600_000);
      if (hours < 24) {
        return t('group:subscription.relative_in_hours', { count: hours });
      }
      const days = Math.floor(diff / 86_400_000);
      if (days < 30) {
        return t('group:subscription.relative_in_days', { count: days });
      }
      const months = Math.floor(days / 30);
      return t('group:subscription.relative_in_months', { count: months });
    },
    [t]
  );

  const openSubscriptionTab = useCallback(
    (path?: string) => {
      executeEvent('addTab', {
        data: {
          name: t('group:subscription.tab_subscriptions'),
          navigateIfAlreadyOpen: true,
          path,
          service: 'APP',
        },
      });
      executeEvent('open-apps-mode', {});
    },
    [t]
  );

  const openSubWireTab = useCallback(() => {
    executeEvent('addTab', {
      data: {
        name: t('group:subscription.tab_subwire'),
        navigateIfAlreadyOpen: true,
        service: 'APP',
      },
    });
    executeEvent('open-apps-mode', {});
  }, [t]);

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const mySubscriptions = useAtomValue(mySubscriptionsAtom);
  const managedSubscriptions = useAtomValue(managedSubscriptionsAtom);
  const subscriptionsLoading = useAtomValue(subscriptionsLoadingAtom);
  const managedLoading = useAtomValue(managedSubscriptionsLoadingAtom);
  const isLoading = subscriptionsLoading || managedLoading;

  const paymentNeededSubscriptions = useMemo(
    () =>
      (mySubscriptions ?? []).filter(
        (subscription: any) => subscription?.status === 'payment-needed'
      ),
    [mySubscriptions]
  );
  const activeSubscriptions = useMemo(
    () =>
      (mySubscriptions ?? []).filter(
        (subscription: any) => subscription?.status === 'active'
      ),
    [mySubscriptions]
  );
  const managedActionSubscriptions = useMemo(
    () =>
      (managedSubscriptions ?? []).filter(
        (entry: any) => (entry?.actions?.totalActions ?? 0) > 0
      ),
    [managedSubscriptions]
  );
  const managedQuietSubscriptions = useMemo(
    () =>
      (managedSubscriptions ?? []).filter(
        (entry: any) => (entry?.actions?.totalActions ?? 0) === 0
      ),
    [managedSubscriptions]
  );

  const totalActions =
    paymentNeededSubscriptions.length +
    managedActionSubscriptions.reduce(
      (sum: number, entry: any) => sum + (entry?.actions?.totalActions ?? 0),
      0
    );
  const hasContent =
    paymentNeededSubscriptions.length > 0 ||
    activeSubscriptions.length > 0 ||
    managedActionSubscriptions.length > 0 ||
    managedQuietSubscriptions.length > 0;

  const subscriptionsTitle = t('group:subscription.subscriptions', {
    postProcess: 'capitalizeFirstChar',
  });
  const tooltipLabel =
    totalActions > 0
      ? t('group:subscription.tooltip_actions_needed', {
          count: totalActions,
          title: subscriptionsTitle,
        })
      : subscriptionsTitle;

  const panelBorderColor = isDarkMode
    ? alpha('#A9BCD8', 0.18)
    : theme.palette.divider;
  const itemBorderColor = isDarkMode
    ? alpha('#A9BCD8', 0.13)
    : alpha(theme.palette.divider, 0.92);
  const itemBackground = isDarkMode
    ? alpha('#FFFFFF', 0.032)
    : theme.palette.action.hover;
  const itemHoverBackground = isDarkMode
    ? alpha('#FFFFFF', 0.055)
    : alpha(theme.palette.primary.main, 0.07);
  const itemHoverBorderColor = isDarkMode
    ? alpha('#A9BCD8', 0.22)
    : alpha(theme.palette.divider, 1);

  const panelLinkColor = isDarkMode
    ? theme.palette.primary.light
    : theme.palette.primary.main;
  const panelLinkHoverColor = isDarkMode
    ? theme.palette.primary.main
    : theme.palette.primary.dark;

  const headerIconColor = isDarkMode
    ? theme.palette.primary.light
    : theme.palette.primary.main;

  const sectionTitleSx = {
    color: theme.palette.text.primary,
    fontSize: '0.78rem',
    fontWeight: 700,
    letterSpacing: '0.01em',
  } as const;

  const renderSubscriptionRow = (subscription: any, tone: 'active' | 'due') => {
    const statusColor =
      tone === 'due' ? theme.palette.warning.main : theme.palette.success.main;
    const dueText = formatTimeUntil(subscription?.nextPaymentDue);

    return (
      <ButtonBase
        key={subscription?.id}
        onClick={() => {
          setAnchorEl(null);
          openSubscriptionTab(subscription?.link);
        }}
        sx={{
          alignItems: 'center',
          backgroundColor: itemBackground,
          border: `1px solid ${itemBorderColor}`,
          borderLeft: `3px solid ${alpha(statusColor, 0.86)}`,
          borderRadius: '12px',
          display: 'flex',
          gap: 1.25,
          p: 1.35,
          textAlign: 'left',
          width: '100%',
          '&:hover': {
            backgroundColor: itemHoverBackground,
            borderColor: itemHoverBorderColor,
          },
        }}
      >
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.86rem',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subscription?.title ||
              t('group:subscription.row_fallback_title', {
                postProcess: 'capitalizeFirstChar',
              })}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.74rem',
              lineHeight: 1.45,
              mt: 0.25,
            }}
          >
            {subscription?.ownerName
              ? t('group:subscription.by_creator', {
                  name: subscription.ownerName,
                })
              : t('group:subscription.creator_fallback')}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.68),
              fontSize: '0.72rem',
              lineHeight: 1.45,
            }}
          >
            {t('group:subscription.price_line', {
              price: subscription?.priceQort,
              interval: subscription?.billingInterval,
            })}
            {tone === 'active' && dueText
              ? t('group:subscription.expires_suffix', { time: dueText })
              : ''}
          </Typography>
        </Box>
        <Box
          sx={{
            alignItems: 'center',
            color: statusColor,
            display: 'flex',
            flexShrink: 0,
            fontSize: '0.68rem',
            fontWeight: 800,
            gap: 0.55,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <Box
            sx={{
              bgcolor: statusColor,
              borderRadius: '50%',
              height: 7,
              width: 7,
            }}
          />
          {tone === 'due'
            ? t('group:subscription.status_due')
            : t('group:subscription.status_active')}
        </Box>
      </ButtonBase>
    );
  };

  const renderManagedRow = (entry: any, hasAction: boolean) => {
    const accentColor = hasAction
      ? theme.palette.warning.main
      : theme.palette.info.main;
    const actionCount = entry?.actions?.totalActions ?? 0;
    const pendingJoinRequests = entry?.actions?.pendingJoinRequests ?? 0;
    const needsReEncryption = !!entry?.actions?.needsReEncryption;

    return (
      <ButtonBase
        key={entry?.groupId}
        onClick={() => {
          setAnchorEl(null);
          openSubscriptionTab(entry?.url);
        }}
        sx={{
          alignItems: 'center',
          backgroundColor: itemBackground,
          border: `1px solid ${itemBorderColor}`,
          borderLeft: `3px solid ${alpha(accentColor, 0.86)}`,
          borderRadius: '12px',
          display: 'flex',
          gap: 1.25,
          p: 1.35,
          textAlign: 'left',
          width: '100%',
          '&:hover': {
            backgroundColor: itemHoverBackground,
            borderColor: itemHoverBorderColor,
          },
        }}
      >
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.86rem',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {entry?.group?.groupName ||
              t('group:subscription.managed_fallback', {
                postProcess: 'capitalizeFirstChar',
              })}
          </Typography>
          {entry?.group?.description ? (
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.9),
                fontSize: '0.74rem',
                lineHeight: 1.45,
                mt: 0.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.group.description}
            </Typography>
          ) : null}
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.68),
              fontSize: '0.72rem',
              lineHeight: 1.45,
            }}
          >
            {t('group:subscription.members', {
              count: entry?.group?.memberCount ?? 0,
            })}
            {pendingJoinRequests > 0
              ? t('group:subscription.join_requests_suffix', {
                  count: pendingJoinRequests,
                })
              : ''}
            {needsReEncryption
              ? t('group:subscription.re_encryption_suffix')
              : ''}
          </Typography>
        </Box>
        {hasAction ? (
          <Box
            sx={{
              alignItems: 'center',
              color: accentColor,
              display: 'flex',
              flexShrink: 0,
              fontSize: '0.68rem',
              fontWeight: 800,
              gap: 0.55,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            <Box
              sx={{
                bgcolor: accentColor,
                borderRadius: '50%',
                height: 7,
                width: 7,
              }}
            />
            {t('group:subscription.actions_badge', { count: actionCount })}
          </Box>
        ) : null}
      </ButtonBase>
    );
  };

  return (
    <>
      <ButtonBase
        aria-label={tooltipLabel}
        onClick={(event) => {
          event.stopPropagation();
          setAnchorEl(event.currentTarget);
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
              {tooltipLabel}
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
          <ListAltRoundedIcon
            sx={{
              color:
                totalActions > 0
                  ? theme.palette.warning.main
                  : theme.palette.text.secondary,
              fontSize: compact ? 17 : 19,
              ...(iconSx || {}),
            }}
          />
        </Tooltip>
        {totalActions > 0 ? (
          <Box
            component="span"
            sx={{
              bgcolor: theme.palette.warning.main,
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
            {totalActions > 99 ? '99+' : totalActions}
          </Box>
        ) : null}
      </ButtonBase>

      <Popover
        anchorEl={anchorEl}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        onClose={() => setAnchorEl(null)}
        open={!!anchorEl}
        slotProps={{
          paper: {
            sx: isDarkMode
              ? {
                  background: '#111820',
                  backgroundImage: 'none',
                  border: `1px solid ${panelBorderColor}`,
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
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
            maxHeight: '64vh',
            overflow: 'auto',
            p: 1.35,
            width: 390,
          }}
        >
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
            <ListAltRoundedIcon
              sx={{ color: headerIconColor, fontSize: 18 }}
            />
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: '0.95rem',
                fontWeight: 700,
              }}
            >
              {subscriptionsTitle}
            </Typography>
          </Box>

          {isLoading && !hasContent ? (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                justifyContent: 'center',
                minHeight: 150,
              }}
            >
              <CircularProgress size={22} />
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.82),
                  fontSize: '0.78rem',
                }}
              >
                {t('group:subscription.loading', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          ) : hasContent ? (
            <>
              {(paymentNeededSubscriptions.length > 0 ||
                managedActionSubscriptions.length > 0) && (
                <Box sx={{ display: 'grid', gap: 0.75 }}>
                  <Typography sx={sectionTitleSx}>
                    {t('group:subscription.section_needs_action', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  {paymentNeededSubscriptions.map((subscription: any) =>
                    renderSubscriptionRow(subscription, 'due')
                  )}
                  {managedActionSubscriptions.map((entry: any) =>
                    renderManagedRow(entry, true)
                  )}
                </Box>
              )}

              {(activeSubscriptions.length > 0 ||
                managedQuietSubscriptions.length > 0) && (
                <Box sx={{ display: 'grid', gap: 0.75 }}>
                  <Typography sx={sectionTitleSx}>
                    {t('group:subscription.section_active', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  {activeSubscriptions.map((subscription: any) =>
                    renderSubscriptionRow(subscription, 'active')
                  )}
                  {managedQuietSubscriptions.map((entry: any) =>
                    renderManagedRow(entry, false)
                  )}
                </Box>
              )}

              <Divider sx={{ borderColor: panelBorderColor }} />
              <ButtonBase
                onClick={() => {
                  setAnchorEl(null);
                  openSubscriptionTab();
                }}
                sx={{
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                  color: panelLinkColor,
                  display: 'inline-flex',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  gap: 0.45,
                  px: 0.2,
                  py: 0.35,
                  '&:hover': { color: panelLinkHoverColor },
                }}
              >
                {t('group:subscription.open_subscriptions', {
                  postProcess: 'capitalizeFirstChar',
                })}
                <OpenInNewRoundedIcon sx={{ fontSize: '0.9rem' }} />
              </ButtonBase>
            </>
          ) : (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 165,
                px: 2,
                py: 2.5,
                textAlign: 'center',
              }}
            >
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: '0.92rem',
                  fontWeight: 700,
                }}
              >
                {t('group:subscription.empty_title')}
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.78),
                  fontSize: '0.78rem',
                  lineHeight: 1.52,
                  maxWidth: 280,
                  mt: 0.65,
                }}
              >
                {t('group:subscription.empty_body')}
              </Typography>
              <ButtonBase
                onClick={() => {
                  setAnchorEl(null);
                  openSubWireTab();
                }}
                sx={{
                  alignItems: 'center',
                  color: panelLinkColor,
                  display: 'inline-flex',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  gap: 0.25,
                  mt: 1.35,
                  '&:hover': { color: panelLinkHoverColor },
                }}
              >
                {t('group:subscription.open_subwire', {
                  postProcess: 'capitalizeFirstChar',
                })}
                <ChevronRightRoundedIcon sx={{ fontSize: '1rem' }} />
              </ButtonBase>
            </Box>
          )}
        </Box>
      </Popover>
    </>
  );
}

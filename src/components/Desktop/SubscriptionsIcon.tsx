import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import CardMembershipIcon from '@mui/icons-material/CardMembership';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  managedSubscriptionsAtom,
  mySubscriptionsAtom,
} from '../../atoms/global';
import { useInitializeMySubscriptions } from '../../subscriptions/useInitializeMySubscriptions';
import { executeEvent } from '../../utils/events';
import { titleBarIconButtonProps } from './CustomTitleBar';

export type SubscriptionsIconProps = {
  /** sx object applied to the IconButton (e.g. navIconSx from the title bar). */
  navIconSx?: object;
  /** Default icon colour when there are no pending actions. */
  controlColor?: string;
};

/**
 * Title-bar subscriptions icon.
 * Initialises subscription data (member-groups poll + derived subscriptions),
 * shows a warning-coloured badge with the action count when actions are pending,
 * and opens the Subscriptions app on click.
 */
export function SubscriptionsIcon({
  navIconSx = {},
  controlColor,
}: SubscriptionsIconProps) {
  useInitializeMySubscriptions();

  const theme = useTheme();
  const { t } = useTranslation(['group']);

  const mySubscriptions = useAtomValue(mySubscriptionsAtom);
  const managedSubscriptions = useAtomValue(managedSubscriptionsAtom);

  const totalNeedingPayment = mySubscriptions.filter(
    (s) => s.status === 'payment-needed'
  ).length;

  const totalManagedActions = managedSubscriptions.reduce(
    (sum: number, entry: any) => sum + (entry.actions?.totalActions ?? 0),
    0
  );

  const totalActions = totalNeedingPayment + totalManagedActions;
  const hasActions = totalActions > 0;
  const iconColor = hasActions
    ? theme.palette.warning.main
    : (controlColor ?? theme.palette.text.secondary);

  const tooltipLabel = hasActions
    ? `${t('group:subscription.subscriptions', { postProcess: 'capitalizeFirstChar' })} · ${t('group:subscription.actions_needed', { count: totalActions })}`
    : t('group:subscription.subscriptions', {
        postProcess: 'capitalizeFirstChar',
        defaultValue: 'Subscriptions',
      });

  return (
    <Tooltip
      title={
        <span
          style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase' }}
        >
          {tooltipLabel}
        </span>
      }
      placement="bottom"
      arrow
      slotProps={{
        tooltip: {
          sx: {
            color: theme.palette.text.primary,
            backgroundColor: theme.palette.background.paper,
          },
        },
        arrow: {
          sx: { color: theme.palette.text.primary },
        },
      }}
    >
      <IconButton
        {...titleBarIconButtonProps}
        size="small"
        onClick={() => {
          executeEvent('addTab', {
            data: { service: 'APP', name: 'Subscriptions' },
          });
          executeEvent('open-apps-mode', {});
        }}
        sx={{ ...navIconSx, color: iconColor, position: 'relative' }}
        aria-label={tooltipLabel}
      >
        <CardMembershipIcon sx={{ fontSize: 20 }} />
        {hasActions && (
          <Box
            component="span"
            sx={{
              position: 'absolute',
              top: 1,
              right: 1,
              minWidth: 14,
              height: 14,
              borderRadius: '7px',
              bgcolor: theme.palette.warning.main,
              color: '#fff',
              fontSize: '0.6rem',
              fontWeight: 700,
              lineHeight: '14px',
              px: '3px',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            {totalActions > 99 ? '99+' : totalActions}
          </Box>
        )}
      </IconButton>
    </Tooltip>
  );
}

/**
 * The account's newest QORT payments, sent and received (User search's
 * list, read the same way), 10 at a time. The other account of each
 * payment opens in the Explorer.
 */
import { useState } from 'react';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import CallMadeRoundedIcon from '@mui/icons-material/CallMadeRounded';
import CallReceivedRoundedIcon from '@mui/icons-material/CallReceivedRounded';
import { useTranslation } from 'react-i18next';
import { shortAddress } from '../../../lib/explorer/addresses';
import {
  formatCount,
  formatDayTime,
  formatQort,
} from '../../../lib/explorer/format';
import {
  primaryNameRead,
  type RecentPayments as Payments,
  type TxRow,
} from '../../../lib/explorer/reads';
import {
  qortUnits,
  unitsToQort,
  visibleName,
} from '../../../lib/explorer/rules';
import {
  useExplorer,
  useExplorerRead,
  type ReadState,
} from '../ExplorerContext';
import { ExplorerAvatar } from '../ExplorerSearchField';
import {
  cap,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
} from '../parts';

const PAGE = 10;

function Counterparty({ address }: { address: string }) {
  const { openAccount } = useExplorer();
  const name = useExplorerRead(primaryNameRead(address)).data ?? null;
  return (
    <ButtonBase
      onClick={() => openAccount(address, { fromExplorer: true })}
      sx={(theme) => ({
        alignItems: 'center',
        borderRadius: '8px',
        color: theme.palette.primary.main,
        display: 'inline-flex',
        gap: 0.75,
        justifyContent: 'flex-start',
        maxWidth: '100%',
        minHeight: 32,
        minWidth: 0,
        px: 0.5,
        '&:hover': { backgroundColor: theme.palette.action.hover },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
        },
      })}
    >
      <ExplorerAvatar name={name} size={22} />
      <Box
        component="bdi"
        dir="auto"
        sx={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name ? visibleName(name) : shortAddress(address)}
      </Box>
    </ButtonBase>
  );
}

function PaymentRow({ payment, owner }: { payment: TxRow; owner: string }) {
  const { t, i18n } = useTranslation(['explorer']);
  const sent = payment.creatorAddress === owner;
  const other = sent ? payment.recipient : payment.creatorAddress;
  const amount = formatQort(
    unitsToQort(qortUnits(payment.amount)),
    i18n.language
  );
  const Icon = sent ? CallMadeRoundedIcon : CallReceivedRoundedIcon;
  return (
    <Box
      component="li"
      sx={(theme) => ({
        alignItems: 'center',
        borderTop: `1px solid ${theme.palette.divider}`,
        display: 'grid',
        gap: 1,
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        py: 0.75,
        '&:first-of-type': { borderTop: 'none' },
      })}
    >
      <Icon
        aria-hidden
        sx={(theme) => ({
          color: sent
            ? theme.palette.other.danger
            : theme.palette.other.positive,
          fontSize: 18,
        })}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box
          sx={{ alignItems: 'center', display: 'flex', gap: 0.5, minWidth: 0 }}
        >
          <Box component="span" sx={visuallyHidden}>
            {sent
              ? t('explorer:payments.sent_to', cap)
              : t('explorer:payments.received_from', cap)}
          </Box>
          {other && other !== owner ? (
            <Counterparty address={other} />
          ) : (
            <Typography component="span" variant="body2">
              {t('explorer:payments.to_itself', cap)}
            </Typography>
          )}
        </Box>
        <Typography
          component="span"
          variant="body2"
          sx={(theme) => ({
            color: mutedText(theme),
            fontSize: '0.78rem',
            px: 0.5,
          })}
        >
          {formatDayTime(payment.timestamp, i18n.language)}
        </Typography>
      </Box>
      <Typography
        component="span"
        sx={(theme) => ({
          color: sent
            ? theme.palette.other.danger
            : theme.palette.other.positive,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          whiteSpace: 'nowrap',
        })}
      >
        {sent ? '−' : '+'}
        {amount} QORT
      </Typography>
    </Box>
  );
}

export function RecentPayments({
  owner,
  read,
}: {
  owner: string;
  read: ReadState<Payments>;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const [shown, setShown] = useState(PAGE);
  const rows = read.data?.rows ?? [];
  return (
    <Section
      id="explorer-payments"
      title={t('core:account_lookup.payments_title', cap)}
    >
      <Box sx={panelSx}>
        {read.status === 'error' ? (
          <ReadError
            message={t('explorer:payments.failed', cap)}
            onRetry={read.retry}
          />
        ) : !read.data ? (
          <LoadingLine label={t('core:loading.generic', cap)} />
        ) : rows.length === 0 ? (
          <Typography variant="body2">
            {t('core:message.generic.no_payments', cap)}
          </Typography>
        ) : (
          <>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {rows.slice(0, shown).map((payment) => (
                <PaymentRow
                  key={payment.signature}
                  payment={payment}
                  owner={owner}
                />
              ))}
            </Box>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                justifyContent: 'space-between',
                mt: 1,
              }}
            >
              <Typography
                variant="body2"
                sx={(theme) => ({ color: mutedText(theme) })}
              >
                {t('explorer:payments.shown', {
                  shown: formatCount(
                    Math.min(shown, rows.length),
                    i18n.language
                  ),
                  total: formatCount(rows.length, i18n.language),
                  ...cap,
                })}
                {read.data.full
                  ? ` ${t('explorer:payments.newest_only', cap)}`
                  : null}
              </Typography>
              {shown < rows.length ? (
                <Button size="small" onClick={() => setShown((n) => n + PAGE)}>
                  {t('explorer:payments.show_more', cap)}
                </Button>
              ) : null}
            </Box>
          </>
        )}
      </Box>
    </Section>
  );
}

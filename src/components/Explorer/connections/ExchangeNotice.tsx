/**
 * QORT an account sent to exchanges, or got from them (from
 * Q-Mintership+'s ExchangeNotice), at the top of Connections: a line for
 * each exchange and way, opening to the payments behind it. Read exactly,
 * by sender and recipient (exchangePaymentsRead, 100 a read, up to 1,000
 * a way); on a node without that read, from the payments the Connections
 * lists read, saying so. On an exchange's own account it says whose it
 * is. Evidence, not a verdict.
 */
import type { ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';
import CurrencyExchangeRoundedIcon from '@mui/icons-material/CurrencyExchangeRounded';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { exchangePaymentsRead } from '../../../lib/explorer/connectionReads';
import {
  exchangeFlowsFrom,
  exchangeName,
  exchangeSentence,
  type ExchangeFlow,
} from '../../../lib/explorer/exchanges';
import type { Finding } from '../../../lib/explorer/findings';
import { useExplorerRead, useStepState } from '../ExplorerContext';
import { cap, isolate, mutedText, ReadError } from '../parts';
import { TxSentence } from '../transactions/TxSentence';
import { EvidenceList, evidenceWords } from './ConnectionRow';

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box
      component="section"
      aria-label={title}
      sx={(theme) => ({
        backgroundColor: alpha(theme.palette.warning.main, 0.08),
        border: `1px solid ${alpha(theme.palette.warning.main, 0.4)}`,
        borderRadius: '12px',
        display: 'flex',
        gap: 1.5,
        minWidth: 0,
        p: 1.5,
      })}
    >
      <CurrencyExchangeRoundedIcon
        aria-hidden
        sx={(theme) => ({ color: theme.palette.warning.main, mt: 0.25 })}
      />
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          minWidth: 0,
        }}
      >
        <Typography component="h3" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {children}
      </Box>
    </Box>
  );
}

function FlowLine({ flow, address }: { flow: ExchangeFlow; address: string }) {
  const { t, i18n } = useTranslation(['explorer']);
  const key = `exchange:${flow.direction}:${flow.address}`;
  const [open, setOpen] = useStepState<boolean>(`conn:${key}`, false);
  const words = evidenceWords('payments', flow.rows.length, t, i18n.language);
  return (
    <Box
      component="li"
      sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}
    >
      <Box
        sx={{
          alignItems: 'center',
          columnGap: 1,
          display: 'flex',
          flexWrap: 'wrap',
          minWidth: 0,
        }}
      >
        <Typography
          component="span"
          sx={{ flex: '1 1 260px', minWidth: 0, overflowWrap: 'anywhere' }}
        >
          <TxSentence sentence={exchangeSentence(flow)} />
        </Typography>
        <Button
          size="small"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          aria-label={t('explorer:connections.evidence.show_with', {
            words,
            name: flow.exchange,
            ...cap,
          })}
        >
          {open
            ? t('explorer:connections.exchange.hide', cap)
            : t('explorer:connections.exchange.show', cap)}
        </Button>
      </Box>
      {open ? (
        <EvidenceList
          txs={flow.rows}
          viewpoint={address}
          stepKey={`conn:${key}`}
          label={t('explorer:connections.evidence.list_with', {
            words,
            name: flow.exchange,
            ...cap,
          })}
        />
      ) : null}
    </Box>
  );
}

export function ExchangeNotice({
  address,
  recorded,
  paymentsShort,
}: {
  address: string;
  /** What the Connections lists recorded: the payments to use on a node without the exact read. */
  recorded: readonly Finding[];
  /** Its payments list stopped short: payments found from it may have older ones. */
  paymentsShort: boolean;
}) {
  const { t } = useTranslation(['explorer']);
  const own = exchangeName(address);
  const read = useExplorerRead(own ? null : exchangePaymentsRead(address));
  if (own)
    return (
      <Frame title={t('explorer:connections.exchange.own_title', cap)}>
        <Typography variant="body2">
          {t('explorer:connections.exchange.own', {
            exchange: isolate(own),
            ...cap,
          })}
        </Typography>
      </Frame>
    );
  if (read.status === 'error' && read.data === undefined)
    return (
      <ReadError
        message={t('explorer:connections.failed.exchanges', cap)}
        onRetry={read.retry}
      />
    );
  if (read.data === undefined) return null;
  // The exact read, or what the lists found on a node that can't answer it.
  const exact = read.data !== null;
  const flows = read.data ?? exchangeFlowsFrom(recorded, paymentsShort);
  if (!flows.length) return null;
  const sent = flows.some((flow) => flow.direction === 'sent');
  return (
    <Frame
      title={
        sent
          ? t('explorer:connections.exchange.sent_title', cap)
          : t('explorer:connections.exchange.received_title', cap)
      }
    >
      <Box
        component="ul"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          listStyle: 'none',
          m: 0,
          minWidth: 0,
          p: 0,
        }}
      >
        {flows.map((flow) => (
          <FlowLine
            key={`${flow.direction}:${flow.address}`}
            flow={flow}
            address={address}
          />
        ))}
      </Box>
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {exact
          ? t('explorer:connections.exchange.exact_note', cap)
          : t('explorer:connections.exchange.from_lists', cap)}
      </Typography>
    </Frame>
  );
}

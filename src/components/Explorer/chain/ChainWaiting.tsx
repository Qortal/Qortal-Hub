/**
 * What waits for a block, of the kinds picked: the node's own list (up to
 * 20, newest first; read when the list opens and again on Refresh, never
 * polled), apart from the confirmed ones and said as waiting. Shown with the
 * latest blocks only. While it reads, a line says so; nothing shows when
 * none waits; a failed read says so, with Retry, never "none waiting". The
 * node gives at most 20, so a full answer says it shows the newest 20.
 * Retry goes once pressed (and so may this whole section): `beforeRetry`
 * puts the keyboard somewhere that stays.
 */
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { chainWaitingRead } from '../../../lib/explorer/chainTx';
import { formatCount } from '../../../lib/explorer/format';
import { useExplorerRead } from '../ExplorerContext';
import { cap, mutedText, panelSx, ReadError, Section } from '../parts';
import { TxList } from '../transactions/TxListRow';

export function ChainWaiting({
  types,
  beforeRetry,
}: {
  types: readonly string[];
  beforeRetry?: () => void;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const waiting = useExplorerRead(chainWaitingRead(types));
  if (waiting.status === 'error')
    return (
      <Box sx={panelSx}>
        <ReadError
          message={t('explorer:chain.waiting.failed', cap)}
          onRetry={() => {
            beforeRetry?.();
            waiting.retry();
          }}
        />
      </Box>
    );
  if (!waiting.data)
    return (
      <Typography
        role="status"
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme) })}
      >
        {t('explorer:chain.waiting.loading', cap)}
      </Typography>
    );
  const { rows, full } = waiting.data;
  if (!rows.length) return null;
  const title = t(
    full ? 'explorer:chain.waiting.title_more' : 'explorer:chain.waiting.title',
    { n: formatCount(rows.length, i18n.language), ...cap }
  );
  return (
    <Section id="explorer-chain-waiting" title={title}>
      <Box sx={panelSx}>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme), mb: 1 })}
        >
          {t('explorer:chain.waiting.note', cap)}
        </Typography>
        <TxList rows={rows} viewpoint={null} label={title} />
      </Box>
    </Section>
  );
}

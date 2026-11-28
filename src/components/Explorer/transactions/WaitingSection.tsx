/**
 * "Sent by this account, waiting to be confirmed": what it sent that isn't
 * in a block yet (the node's list, by its public key; read when the tab
 * opens, never polled), of the kind picked, apart from its confirmed
 * transactions. One already in the confirmed list (it got into a block
 * between the two reads) shows only there. While it reads, a line says so;
 * nothing shows when none waits; a failed read says so, with Retry. The
 * node gives at most WAITING_LIMIT, so a full answer reads "at least".
 * What others sent to it can't be found until it is in a block (Core
 * records who a transaction involves only then), and it says so.
 */
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { WAITING_LIMIT, waitingRead } from '../../../lib/explorer/reads';
import { filterMatches, type TxFilter } from '../../../lib/explorer/txFamilies';
import { useExplorerRead } from '../ExplorerContext';
import { cap, mutedText, panelSx, ReadError, Section } from '../parts';
import { TxList } from './TxListRow';

export function WaitingSection({
  address,
  publicKey,
  filter,
  confirmed,
}: {
  address: string;
  publicKey: string;
  filter: TxFilter;
  /** Signatures in the confirmed list on screen: left out here. */
  confirmed: ReadonlySet<string>;
}) {
  const { t } = useTranslation(['explorer']);
  const waiting = useExplorerRead(waitingRead(address, publicKey));
  if (waiting.status === 'error')
    return (
      <Box sx={panelSx}>
        <ReadError
          message={t('explorer:transactions.waiting_failed', cap)}
          onRetry={waiting.retry}
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
        {t('explorer:transactions.waiting_loading', cap)}
      </Typography>
    );
  const rows = waiting.data.filter(
    (tx) => filterMatches(filter, tx.type) && !confirmed.has(tx.signature)
  );
  if (!rows.length) return null;
  // The node stopped at its most: there may be more than it gave.
  const full = waiting.data.length >= WAITING_LIMIT;
  return (
    <Section
      id="explorer-waiting"
      title={t(
        full
          ? 'explorer:transactions.waiting_title_more'
          : 'explorer:transactions.waiting_title',
        { n: rows.length, ...cap }
      )}
    >
      <Box sx={panelSx}>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme), mb: 1 })}
        >
          {t('explorer:transactions.waiting_note', cap)}
        </Typography>
        <TxList rows={rows} viewpoint={address} />
      </Box>
    </Section>
  );
}

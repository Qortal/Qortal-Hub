/**
 * A name's own history, beside it on the Names tab: the account's
 * transactions about that name, newest first, each as a sentence told from
 * the account's side ("Sold the name “Maple” to Second for 5 QORT"), with
 * when and in which block. The newest 4 show; "Show all" shows the rest,
 * kept by the history step. The rows come from the account's one list of
 * name transactions (the Transactions tab's Names kind); nothing is read
 * here.
 *
 * While that list loads, a quiet placeholder; when it couldn't be read, or
 * stopped short and names nothing about this name, nothing here: the tab
 * says it once, over the names, with what to do.
 */
import { Box, Button, Skeleton, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatCount } from '../../../lib/explorer/format';
import type { TxRow } from '../../../lib/explorer/reads';
import { visibleName } from '../../../lib/explorer/rules';
import { useStepState } from '../ExplorerContext';
import { cap, isolate, mutedText } from '../parts';
import { OutcomeNote, txWhen } from '../transactions/TxListRow';
import { TxSentence } from '../transactions/TxSentence';
import { useTxWords } from '../transactions/txLook';

/** Entries shown before "Show all". */
export const HISTORY_SHOWN = 4;

export type HistoryStatus = 'loading' | 'failed' | 'ready';

/** One name transaction as a sentence told from `viewpoint`, with when and in which block. */
export function HistoryRow({
  tx,
  viewpoint,
}: {
  tx: TxRow;
  viewpoint: string | null;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const words = useTxWords(tx, viewpoint);
  return (
    <Box
      component="li"
      sx={(theme) => ({
        borderTop: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        py: 0.75,
        '&:first-of-type': { borderTop: 0, pt: 0 },
      })}
    >
      <Typography
        component="span"
        sx={{ fontSize: '0.92rem', lineHeight: 1.4, overflowWrap: 'anywhere' }}
      >
        <TxSentence sentence={words.sentence} />
        <OutcomeNote outcome={words.outcome} />
      </Typography>
      <Typography
        component="span"
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme), fontSize: '0.8rem' })}
      >
        {txWhen(tx, t, i18n.language)}
      </Typography>
    </Box>
  );
}

export function NameHistoryList({
  name,
  txs,
  address,
  status,
  capped,
}: {
  name: string;
  /** Its transactions about this name, newest first. */
  txs: readonly TxRow[];
  address: string;
  status: HistoryStatus;
  /** The list of its name transactions stopped short of its oldest. */
  capped: boolean;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const [all, setAll] = useStepState(`nameHistoryAll:${name}`, false);
  const shownName = isolate(visibleName(name));
  const label = (count: number | null) => (
    <Typography
      variant="body2"
      sx={(theme) => ({ color: mutedText(theme), fontWeight: 600 })}
    >
      {count
        ? t('explorer:names.history_count', {
            n: formatCount(count, i18n.language),
            ...cap,
          })
        : t('explorer:names.history', cap)}
    </Typography>
  );
  if (status === 'failed') return null;
  if (status === 'loading')
    return (
      <Box sx={{ minWidth: 0 }}>
        {label(null)}
        <Skeleton variant="text" width="80%" aria-hidden />
        <Skeleton variant="text" width="45%" aria-hidden />
      </Box>
    );
  if (!txs.length && capped) return null;
  if (!txs.length)
    return (
      <Box sx={{ minWidth: 0 }}>
        {label(null)}
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:names.history_none', cap)}
        </Typography>
      </Box>
    );
  const shown = all ? txs : txs.slice(0, HISTORY_SHOWN);
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}
    >
      {label(txs.length)}
      <Box
        component="ul"
        aria-label={t('explorer:names.history_of', { name: shownName, ...cap })}
        sx={{ listStyle: 'none', m: 0, minWidth: 0, p: 0 }}
      >
        {shown.map((tx) => (
          <HistoryRow key={tx.signature} tx={tx} viewpoint={address} />
        ))}
      </Box>
      {txs.length > shown.length ? (
        <Button
          size="small"
          onClick={() => setAll(true)}
          aria-label={t('explorer:names.show_all_of', {
            count: txs.length,
            name: shownName,
            ...cap,
          })}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('explorer:tx.show_all', { count: txs.length, ...cap })}
        </Button>
      ) : null}
    </Box>
  );
}

/**
 * The start page's "The whole chain": the newest few of the chain's
 * confirmed transactions (every kind but messages, in the latest 1,000
 * blocks), read when the start page shows, once; nothing polls.
 * "Transactions on Qortal" opens the whole list on the tip read here, so
 * its first page is the one shown here. A failed read says so with Retry,
 * never "no transactions"; Retry goes once pressed, so the keyboard goes to
 * "Transactions on Qortal", which stays.
 */
import { useRef } from 'react';
import { Box, Button, Typography } from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import {
  CHAIN_TYPES,
  chainPageRead,
  LATEST_BLOCKS,
  rangeFor,
} from '../../../lib/explorer/chainTx';
import { formatCount } from '../../../lib/explorer/format';
import { useExplorer, useExplorerRead } from '../ExplorerContext';
import { cap, LoadingLine, panelSx, ReadError, Section } from '../parts';
import { TxList } from '../transactions/TxListRow';
import { usePinnedTip } from './usePinnedTip';

/** How many the start page shows. */
export const START_ROWS = 5;

export function ChainLatest() {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const { openChain } = useExplorer();
  const openRef = useRef<HTMLButtonElement>(null);
  // Kept while the start page shows: each showing reads the newest.
  const tip = usePinnedTip(null, { renew: false });
  const page = useExplorerRead(
    tip.pinned === null
      ? null
      : chainPageRead(
          CHAIN_TYPES,
          rangeFor(LATEST_BLOCKS, tip.pinned),
          'newest',
          0
        )
  );

  let body;
  if (tip.failed || page.status === 'error')
    body = (
      <ReadError
        message={t('explorer:chain.start.failed', cap)}
        onRetry={() => {
          openRef.current?.focus();
          (tip.failed ?? page.retry)();
        }}
      />
    );
  else if (!page.data)
    body = <LoadingLine label={t('core:loading.generic', cap)} />;
  else if (!page.data.rows.length && !page.data.full)
    body = (
      <Typography role="status" variant="body2">
        {t('explorer:chain.start.none', {
          count: LATEST_BLOCKS.blocks,
          blocks: formatCount(LATEST_BLOCKS.blocks, i18n.language),
        })}
      </Typography>
    );
  else
    body = (
      <TxList
        rows={page.data.rows.slice(0, START_ROWS)}
        viewpoint={null}
        label={t('explorer:chain.start.list', cap)}
      />
    );

  return (
    <Section id="explorer-chain" title={t('explorer:chain.start.title', cap)}>
      <Box sx={panelSx}>
        {body}
        <Button
          ref={openRef}
          size="small"
          endIcon={<ChevronRightRoundedIcon />}
          onClick={() =>
            openChain(tip.pinned === null ? {} : { tip: tip.pinned })
          }
          sx={{ mt: 1 }}
        >
          {t('explorer:chain.title', cap)}
        </Button>
      </Box>
    </Section>
  );
}

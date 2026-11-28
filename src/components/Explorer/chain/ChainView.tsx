/**
 * Transactions on Qortal, a step of the window: every confirmed transaction
 * of the kinds picked (every kind but messages unless one is picked: PR 2's
 * kinds and types) in a range of blocks, newest or oldest first, 20 a page,
 * and what waits for a block apart (with the latest blocks only). Each row
 * is a sentence told from no one's side, its accounts and names links that
 * open them as steps of the window, and it opens to its details and its own
 * page.
 *
 * The blocks hang off the tip read when the list first showed (or the one
 * it was opened with), pinned with the step, so the rows don't move while
 * they are paged and Back shows the same blocks; the window's Refresh pins
 * a newer tip deliberately. A block past a tip taken from a kept answer
 * (maybe minutes old: the start page's, the window's cache) is never refused
 * on its word: the chain's newest block is read again first, and only a
 * block past that is refused, with that height. What is picked, the tip and
 * how many pages show belong to the history step (useStepState). Where a
 * Retry goes once pressed, the keyboard waits on the step's heading.
 * Read-only, and nothing polls.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  CHAIN_FAMILIES,
  chainListKey,
  chainTypes,
  cleanBlocks,
  cleanChainFilter,
  cleanOrder,
  LATEST_BLOCKS,
  rangeFor,
  startsPastTip,
  type BlocksChoice,
  type ChainOrder,
} from '../../../lib/explorer/chainTx';
import { formatCount } from '../../../lib/explorer/format';
import {
  ALL_TRANSACTIONS,
  type TxFilter,
} from '../../../lib/explorer/txFamilies';
import { useStepState } from '../ExplorerContext';
import { cap, LoadingLine, mutedText, panelSx, ReadError } from '../parts';
import { TxFilterBar } from '../transactions/TxFilterBar';
import { CHAIN_STATE } from './chainStep';
import { ChainRangeBar } from './ChainRangeBar';
import { ChainResults } from './ChainResults';
import { ChainWaiting } from './ChainWaiting';
import { usePinnedTip } from './usePinnedTip';

export function ChainView() {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const [storedFilter, setFilter] = useStepState<TxFilter>(
    CHAIN_STATE.filter,
    ALL_TRANSACTIONS
  );
  const filter = cleanChainFilter(storedFilter);
  const [storedBlocks, setBlocks] = useStepState<BlocksChoice>(
    CHAIN_STATE.blocks,
    LATEST_BLOCKS
  );
  const blocks = cleanBlocks(storedBlocks);
  const [storedOrder, setOrder] = useStepState<ChainOrder>(
    CHAIN_STATE.order,
    'newest'
  );
  const order = cleanOrder(storedOrder);
  const tip = usePinnedTip(CHAIN_STATE.tip, { renew: true });
  const { kind, type } = filter;
  const types = useMemo(() => chainTypes({ kind, type }), [kind, type]);

  // A Retry goes once pressed: the keyboard waits on the step's heading.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = () => titleRef.current?.focus();
  const retryHere = (retry: () => void) => () => {
    focusTitle();
    retry();
  };
  // More blocks, asked for by a button that then goes: the list it opens takes the keyboard.
  const [focusList, setFocusList] = useState(false);

  // A block past a tip taken from a kept answer: read the newest before refusing it.
  const past = tip.pinned !== null && startsPastTip(blocks, tip.pinned);
  const { checked, renewing, renewFailed, renew } = tip;
  useEffect(() => {
    if (past && !checked && !renewing && !renewFailed) renew();
  }, [past, checked, renewing, renewFailed, renew]);

  let body;
  if (tip.pinned === null)
    body = (
      <Box sx={panelSx}>
        {tip.failed ? (
          <ReadError
            message={t('explorer:chain.tip.failed', cap)}
            onRetry={retryHere(tip.failed)}
          />
        ) : (
          <LoadingLine label={t('core:loading.generic', cap)} />
        )}
      </Box>
    );
  else if (past && !checked)
    body = (
      <Box sx={panelSx}>
        {renewFailed ? (
          <ReadError
            message={t('explorer:chain.tip.failed', cap)}
            onRetry={retryHere(renewFailed)}
          />
        ) : (
          <LoadingLine label={t('core:loading.generic', cap)} />
        )}
      </Box>
    );
  else if (past)
    // Nothing is searched past the tip: an empty answer there would read as "none".
    body = (
      <Box sx={panelSx}>
        <Typography role="status" sx={{ fontWeight: 600 }}>
          {t('explorer:chain.blocks.past_tip', {
            tip: formatCount(tip.pinned, language),
          })}
        </Typography>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme), mt: 0.5 })}
        >
          {t('explorer:chain.past_tip_hint', cap)}
        </Typography>
      </Box>
    );
  else {
    const range = rangeFor(blocks, tip.pinned);
    body = (
      <>
        {blocks.kind === 'latest' ? (
          <ChainWaiting types={types} beforeRetry={focusTitle} />
        ) : null}
        <ChainResults
          // One list per mount: what it read, what it shows and where the keyboard goes start afresh.
          key={chainListKey(types, range, order)}
          types={types}
          range={range}
          order={order}
          filter={filter}
          takeFocus={focusList}
          onFocusTaken={() => setFocusList(false)}
          wider={
            blocks.kind === 'latest' && blocks.blocks === 1000
              ? {
                  blocks: 10_000,
                  look: () => {
                    setFocusList(true);
                    setBlocks({ kind: 'latest', blocks: 10_000 });
                  },
                }
              : undefined
          }
        />
      </>
    );
  }

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 0 }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          minWidth: 0,
        }}
      >
        <Typography
          ref={titleRef}
          tabIndex={-1}
          component="h2"
          sx={{
            fontSize: { xs: '1.15rem', sm: '1.3rem' },
            fontWeight: 700,
            '&:focus': { outline: 'none' },
          }}
        >
          {t('explorer:chain.title', cap)}
        </Typography>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:chain.intro', cap)}
        </Typography>
      </Box>
      <TxFilterBar
        filter={filter}
        onChange={setFilter}
        families={CHAIN_FAMILIES}
      />
      <ChainRangeBar
        blocks={blocks}
        onBlocks={setBlocks}
        order={order}
        onOrder={setOrder}
        tip={tip.pinned}
        readNewest={tip.readNewest}
        pinChecked={tip.pinChecked}
      />
      {tip.pinned !== null && blocks.kind === 'latest' ? (
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:chain.tip.pinned', {
            tip: formatCount(tip.pinned, language),
          })}
        </Typography>
      ) : null}
      {renewFailed && tip.pinned !== null && !past ? (
        <Box sx={panelSx}>
          <ReadError
            message={t('explorer:chain.tip.renew_failed', {
              tip: formatCount(tip.pinned, language),
            })}
            onRetry={retryHere(renewFailed)}
          />
        </Box>
      ) : null}
      {body}
    </Box>
  );
}

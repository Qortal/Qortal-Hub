/**
 * The confirmed transactions of one list (its types, blocks and order), 20
 * a page. Each page is its own read (lib/explorer/chainTx.ts); "Show older"
 * ("Show newer", oldest first) reads the next one, up to 50 pages (1,000
 * rows), and puts the keyboard on the first row it added. The line under
 * the list says what it holds: "The newest 40 in blocks …", "All 37 in
 * blocks …", "The only one in block …"; "no transactions" only from an empty
 * answer of the search, then offering more blocks when there are more to
 * look in; and never "all" once a row came on two pages (another may have
 * been passed over). The first page failing says so with Retry; a later
 * page failing keeps the rows above it, with Retry. Where a button goes
 * once pressed (Retry, more blocks), the keyboard goes to the first row the
 * read brings, the line that says what came, or the Retry of a read that
 * failed again.
 *
 * One list per mount (ChainView keys it by the list): another kind, range,
 * order or tip starts afresh. How many pages show belongs to the history
 * step (useStepState), counted for one list, so Back shows the same rows,
 * read again only if the window's cache let them go.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  CHAIN_MAX_PAGES,
  CHAIN_MAX_ROWS,
  CHAIN_PAGE,
  chainCoverage,
  chainListKey,
  chainPageRead,
  joinPages,
  rangeEnd,
  type BlockRange,
  type ChainOrder,
} from '../../../lib/explorer/chainTx';
import { formatCount } from '../../../lib/explorer/format';
import type { TxFilter } from '../../../lib/explorer/txFamilies';
import { useExplorerReads, useStepState } from '../ExplorerContext';
import {
  cap,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
} from '../parts';
import { typeTitle } from '../transactions/sentenceText';
import { TxList } from '../transactions/TxListRow';
import { CHAIN_STATE, type ChainShown } from './chainStep';

/**
 * Whether the keyboard may be moved to what a read brought: it is in this
 * list, or on nothing chosen (the page, or the window around the list, where
 * the window puts it when the control that had it went). Never off anything
 * outside the list it went to meanwhile: another control, a menu's item, the
 * step's heading.
 */
function keyboardFree(panel: HTMLElement | null): boolean {
  const active = document.activeElement as HTMLElement | null;
  return (
    !active ||
    active === document.body ||
    Boolean(panel && (panel.contains(active) || active.contains(panel)))
  );
}

export function ChainResults({
  types,
  range,
  order,
  filter,
  wider,
  takeFocus = false,
  onFocusTaken,
}: {
  types: readonly string[];
  range: BlockRange;
  order: ChainOrder;
  filter: TxFilter;
  /** Look in more of the latest blocks: offered when none were found in these. */
  wider?: { blocks: number; look: () => void };
  /** Opened by a button that went (more blocks): the keyboard goes to what it brings. */
  takeFocus?: boolean;
  onFocusTaken?: () => void;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const listKey = chainListKey(types, range, order);
  const [stored, setShown] = useStepState<ChainShown | null>(
    CHAIN_STATE.shown,
    null
  );
  const pages =
    stored?.list === listKey && Number.isSafeInteger(stored.pages)
      ? Math.min(Math.max(stored.pages, 1), CHAIN_MAX_PAGES)
      : 1;
  const specs = useMemo(
    () =>
      Array.from({ length: pages }, (_, index) =>
        chainPageRead(types, range, order, index * CHAIN_PAGE)
      ),
    // The list's key stands for its types, range and order.
    [listKey, pages]
  );
  // One page at a time, in order: a later page waits for the ones above it.
  const reads = useExplorerReads(specs, { concurrency: 1 });
  const list = joinPages(
    specs.map((spec) => spec.key),
    reads.data,
    reads.failed
  );

  // After Show older, a Retry or more blocks: the keyboard goes to the first
  // row the read added (or the line, when none came), or to the Retry of a
  // read that failed (once); never off a control it was put on meanwhile.
  const panel = useRef<HTMLDivElement>(null);
  const listBox = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  const focusFrom = useRef<number | null>(takeFocus ? 0 : null);
  useEffect(() => {
    if (takeFocus) onFocusTaken?.();
  }, []);
  const lastPending = useRef(list.pending);
  useEffect(() => {
    const was = lastPending.current;
    lastPending.current = list.pending;
    const from = focusFrom.current;
    if (from === null || list.pending === 'loading') return;
    if (list.pending === 'failed') {
      if (was !== 'failed' && keyboardFree(panel.current))
        errorBox.current?.querySelector<HTMLElement>('button')?.focus();
      return;
    }
    focusFrom.current = null;
    if (!keyboardFree(panel.current)) return;
    const rows =
      listBox.current?.querySelectorAll<HTMLElement>('[data-tx-row]');
    (rows?.[from] ?? lineRef.current)?.focus();
  });
  const retryFrom = (from: number) => () => {
    if (focusFrom.current === null) focusFrom.current = from;
    reads.retry();
  };

  const showOlder = () => {
    if (list.pending !== null || list.done || pages >= CHAIN_MAX_PAGES) return;
    focusFrom.current = list.rows.length;
    setShown({ list: listKey, pages: pages + 1 });
  };

  const title = filter.type
    ? typeTitle(filter.type, t, true)
    : filter.kind === 'all'
      ? t('explorer:chain.list_all', cap)
      : t(`explorer:tx_family.${filter.kind}`, cap);

  const count = list.rows.length;
  const oneBlock = range.limit === 1;
  const where = oneBlock
    ? { block: formatCount(range.start, language) }
    : {
        from: formatCount(range.start, language),
        to: formatCount(rangeEnd(range), language),
      };
  const at = oneBlock ? '_block' : '';
  const coverage = chainCoverage(count, list.done, order, list.repeated);
  const line =
    coverage === 'none'
      ? t(
          `explorer:chain.cover.${filter.kind === 'all' ? 'none_all' : 'none_kind'}${at}`,
          where
        )
      : coverage === 'only'
        ? t(`explorer:chain.cover.only${at}`, where)
        : t(`explorer:chain.cover.${coverage}${at}`, {
            count,
            shown: formatCount(count, language),
            ...where,
          });
  // At its most while the node has more: it says so, and how to see others.
  const ceiling =
    !list.done && list.pending === null && pages >= CHAIN_MAX_PAGES;
  const more =
    !list.done &&
    list.pending !== 'failed' &&
    (list.pending === 'loading' || pages < CHAIN_MAX_PAGES);

  let body;
  if (list.read === 0 && list.pending === 'failed')
    body = (
      <Box ref={errorBox}>
        <ReadError
          message={t('explorer:chain.failed', cap)}
          onRetry={retryFrom(0)}
        />
      </Box>
    );
  else if (list.read === 0)
    body = <LoadingLine label={t('core:loading.generic', cap)} />;
  else if (!count && list.done)
    body = (
      <>
        <Typography
          ref={lineRef}
          tabIndex={-1}
          role="status"
          variant="body2"
          sx={{ '&:focus': { outline: 'none' } }}
        >
          {line}
        </Typography>
        {wider ? (
          <Button
            size="small"
            variant="outlined"
            onClick={wider.look}
            sx={{ mt: 1 }}
          >
            {t('explorer:chain.wider', {
              count: wider.blocks,
              blocks: formatCount(wider.blocks, language),
              ...cap,
            })}
          </Button>
        ) : null}
      </>
    );
  else
    body = (
      <>
        <Box ref={listBox}>
          <TxList rows={list.rows} viewpoint={null} label={title} />
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
            ref={lineRef}
            tabIndex={-1}
            role="status"
            variant="body2"
            sx={(theme) => ({
              color: mutedText(theme),
              flex: '1 1 240px',
              '&:focus': { outline: 'none' },
            })}
          >
            {line}
            {ceiling
              ? ` ${t('explorer:chain.ceiling', {
                  max: formatCount(CHAIN_MAX_ROWS, language),
                })}`
              : null}
          </Typography>
          {more ? (
            <Button
              size="small"
              variant="outlined"
              // Not `disabled`: the keyboard stays on it while the page reads.
              aria-disabled={list.pending === 'loading' || undefined}
              onClick={showOlder}
            >
              {list.pending === 'loading'
                ? t('core:loading.generic', cap)
                : t(
                    order === 'oldest'
                      ? 'explorer:chain.show_newer'
                      : 'explorer:chain.show_older',
                    cap
                  )}
            </Button>
          ) : null}
        </Box>
        {list.pending === 'failed' ? (
          <Box ref={errorBox} sx={{ mt: 1 }}>
            <ReadError
              message={t(
                order === 'oldest'
                  ? 'explorer:chain.more_failed_newer'
                  : 'explorer:chain.more_failed_older',
                cap
              )}
              onRetry={retryFrom(count)}
            />
          </Box>
        ) : null}
      </>
    );

  return (
    <Section id="explorer-chain-list" title={title}>
      <Box ref={panel} sx={panelSx}>
        {body}
      </Box>
    </Section>
  );
}

/**
 * Which blocks a list covers, and in which order: the latest 1,000 or
 * 10,000 blocks (up to the tip the list pinned), or from a block typed in,
 * for as many blocks as picked (just that one, up to 10,000), applied with
 * Show; newest or oldest first. What is typed is checked first: a block
 * number as people write it (grouped as Hub shows numbers in their
 * language). A block past the pinned tip (which may be minutes old) is
 * checked against the chain's newest block, read again: shown once the
 * chain has it (that tip then pinned), refused only with that fresh height.
 * The block typed and how many blocks belong to the step until shown, so
 * Back keeps them. Side by side where they fit, stacked in a narrow window.
 */
import { useState, type FormEvent } from 'react';
import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  FROM_SPAN,
  FROM_SPANS,
  LATEST_SPANS,
  parseBlockNumber,
  type BlocksChoice,
  type ChainOrder,
  type FromSpan,
} from '../../../lib/explorer/chainTx';
import { formatCount } from '../../../lib/explorer/format';
import { useStepState } from '../ExplorerContext';
import { cap } from '../parts';
import { CHAIN_STATE, cleanDraft, type FromDraft } from './chainStep';

/** The block number the message for one that can't be read shows as an example. */
const EXAMPLE_BLOCK = 2_700_000;

const ROW_SX = {
  alignItems: 'flex-start',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 1.5,
  minWidth: 0,
  // A narrow window: one field a line, each as wide as the window.
  '@container (max-width: 480px)': {
    '& > *': { flexBasis: '100%', maxWidth: 'none' },
  },
} as const;

const FIELD_SX = { flex: '1 1 200px', maxWidth: 320, minWidth: 0 } as const;

const SELECT_PROPS = { inputLabel: { shrink: true } } as const;

export function ChainRangeBar({
  blocks,
  onBlocks,
  order,
  onOrder,
  tip,
  readNewest,
  pinChecked,
}: {
  blocks: BlocksChoice;
  onBlocks: (blocks: BlocksChoice) => void;
  order: ChainOrder;
  onOrder: (order: ChainOrder) => void;
  /** The tip the list pinned, the last block a range can start at; null while unknown. */
  tip: number | null;
  /** The chain's newest block, read now (usePinnedTip). */
  readNewest: () => Promise<number | null | undefined>;
  /** Pin the newest block just read. */
  pinChecked: (tip: number) => void;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  // "From a block…" picked, before Show: the list on screen stays as it is.
  const [kept, setDraft] = useStepState<FromDraft | null>(
    CHAIN_STATE.draft,
    null
  );
  const draft = cleanDraft(kept);
  const fromOn = draft !== null || blocks.kind === 'from';
  const start = draft
    ? draft.start
    : blocks.kind === 'from'
      ? String(blocks.start)
      : '';
  const span: FromSpan = draft
    ? draft.span
    : blocks.kind === 'from'
      ? blocks.span
      : FROM_SPAN;
  const [problem, setProblem] = useState<string | null>(null);
  // The chain's newest block is being read for a block typed past the pinned tip.
  const [checking, setChecking] = useState(false);

  const chooseBlocks = (value: string) => {
    setProblem(null);
    if (value === 'from') {
      setDraft({ start, span });
      return;
    }
    const latest = LATEST_SPANS.find((n) => String(n) === value);
    if (!latest) return;
    setDraft(null);
    onBlocks({ kind: 'latest', blocks: latest });
  };

  const apply = async (event: FormEvent) => {
    event.preventDefault();
    if (checking) return;
    const n = parseBlockNumber(start);
    if (n === null) {
      setProblem(
        String(
          t('explorer:chain.blocks.bad', {
            plain: String(EXAMPLE_BLOCK),
            grouped: formatCount(EXAMPLE_BLOCK, language),
          })
        )
      );
      return;
    }
    if (tip === null || n > tip) {
      // The tip pinned may be minutes old: the chain's newest decides.
      setProblem(null);
      setChecking(true);
      const newest = await readNewest();
      // The list went meanwhile: nothing more to do here.
      if (newest === undefined) return;
      setChecking(false);
      if (newest === null) {
        setProblem(String(t('explorer:chain.tip.failed', cap)));
        return;
      }
      if (n > newest) {
        setProblem(
          String(
            t('explorer:chain.blocks.past_tip', {
              tip: formatCount(newest, language),
            })
          )
        );
        return;
      }
      pinChecked(newest);
    }
    setProblem(null);
    setDraft(null);
    onBlocks({ kind: 'from', start: n, span });
  };

  const blocksValue = fromOn
    ? 'from'
    : blocks.kind === 'latest'
      ? String(blocks.blocks)
      : 'from';

  return (
    <Box
      sx={{
        containerType: 'inline-size',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        minWidth: 0,
      }}
    >
      <Box sx={ROW_SX}>
        <TextField
          select
          size="small"
          label={t('explorer:chain.blocks.label', cap)}
          value={blocksValue}
          onChange={(event) => chooseBlocks(event.target.value)}
          slotProps={SELECT_PROPS}
          sx={FIELD_SX}
        >
          {LATEST_SPANS.map((n) => (
            <MenuItem key={n} value={String(n)}>
              {t('explorer:chain.blocks.latest', {
                count: n,
                blocks: formatCount(n, language),
                ...cap,
              })}
            </MenuItem>
          ))}
          <MenuItem value="from">
            {t('explorer:chain.blocks.from', cap)}
          </MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label={t('explorer:chain.order.label', cap)}
          value={order}
          onChange={(event) =>
            onOrder(event.target.value === 'oldest' ? 'oldest' : 'newest')
          }
          slotProps={SELECT_PROPS}
          sx={FIELD_SX}
        >
          <MenuItem value="newest">
            {t('explorer:chain.order.newest', cap)}
          </MenuItem>
          <MenuItem value="oldest">
            {t('explorer:chain.order.oldest', cap)}
          </MenuItem>
        </TextField>
      </Box>
      {fromOn ? (
        <Box
          component="form"
          onSubmit={(event) => void apply(event)}
          noValidate
          aria-label={t('explorer:chain.blocks.from', cap)}
          sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}
        >
          <Box sx={ROW_SX}>
            <TextField
              size="small"
              label={t('explorer:chain.blocks.from_field', cap)}
              value={start}
              error={problem !== null}
              onChange={(event) =>
                setDraft({ start: event.target.value, span })
              }
              slotProps={{
                htmlInput: {
                  autoComplete: 'off',
                  inputMode: 'numeric',
                  spellCheck: false,
                },
                inputLabel: { shrink: true },
              }}
              sx={FIELD_SX}
            />
            <TextField
              select
              size="small"
              label={t('explorer:chain.blocks.span', cap)}
              value={String(span)}
              onChange={(event) =>
                setDraft({
                  start,
                  span:
                    FROM_SPANS.find((n) => String(n) === event.target.value) ??
                    FROM_SPAN,
                })
              }
              slotProps={SELECT_PROPS}
              sx={FIELD_SX}
            >
              {FROM_SPANS.map((n) => (
                <MenuItem key={n} value={String(n)}>
                  {n === 1
                    ? t('explorer:chain.blocks.one_block', cap)
                    : t('explorer:chain.blocks.span_blocks', {
                        count: n,
                        blocks: formatCount(n, language),
                        ...cap,
                      })}
                </MenuItem>
              ))}
            </TextField>
            <Button
              type="submit"
              variant="outlined"
              aria-disabled={checking || undefined}
              sx={{ flex: '0 0 auto', minHeight: 40 }}
            >
              {t('explorer:chain.blocks.show', cap)}
            </Button>
          </Box>
          {problem ? (
            <Typography
              role="alert"
              variant="body2"
              sx={(theme) => ({ color: theme.palette.error.main })}
            >
              {problem}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

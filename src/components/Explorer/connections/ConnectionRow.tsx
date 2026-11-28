/**
 * One connection (from Q-Mintership+'s ConnectionRow): the other account
 * (its picture and name, opening it in the Explorer as a step of the
 * trail), plain tags under it ("its sponsor", "now level 0"), what
 * happened in a sentence, when, and on the right the evidence toggle ("4
 * payments") that opens the transactions behind it, each as the
 * Transactions tab's row (its sentence, fields, the accounts in it and its
 * raw answer). The sentence's own links are left out of the Tab order:
 * the name above and the opened rows have them.
 *
 * Whether a row is open belongs to the history step, so Back shows the
 * tab as it was left.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { isAtAddress, shortAddress } from '../../../lib/explorer/addresses';
import {
  formatCount,
  formatDay,
  formatSpan,
} from '../../../lib/explorer/format';
import type { EvidenceKind } from '../../../lib/explorer/findings';
import { newestFirst } from '../../../lib/explorer/money';
import { txRead, type TxRow } from '../../../lib/explorer/reads';
import { visibleName } from '../../../lib/explorer/rules';
import type { TxSentenceSpec } from '../../../lib/explorer/txWords';
import {
  useExplorer,
  useExplorerReads,
  useNearScreen,
  useStepState,
} from '../ExplorerContext';
import { ExplorerAvatar } from '../ExplorerSearchField';
import { cap, LoadingLine, mutedText, ReadError } from '../parts';
import { TxList } from '../transactions/TxListRow';
import { TxSentence, useAccountName } from '../transactions/TxSentence';
import { useExchangeName } from '../useExplorerAccess';

/** Evidence rows shown before "Show all". */
export const EVIDENCE_ROWS = 20;

export const ROW_LIST_SX = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  listStyle: 'none',
  m: 0,
  minWidth: 0,
  p: 0,
} as const;

export interface When {
  height: number;
  timestamp: number;
  firstHeight?: number;
  firstTimestamp?: number;
}

/**
 * "12 Mar 2025 · block 1,371,641", or "Mar – May 2025 · blocks
 * 1,364,500–2,100,000"; the date alone when the block isn't known.
 */
export function whenText(when: When, t: TFunction, language: string): string {
  const spread =
    when.firstHeight !== undefined && when.firstHeight !== when.height;
  if (spread)
    return String(
      t('explorer:connections.when_span', {
        span: formatSpan(
          when.firstTimestamp ?? when.timestamp,
          when.timestamp,
          language
        ),
        first: formatCount(when.firstHeight as number, language),
        last: formatCount(when.height, language),
      })
    );
  // No block known (a Q-Asset trade): its day, or the months it covers.
  if (!when.height)
    return formatSpan(
      when.firstTimestamp ?? when.timestamp,
      when.timestamp,
      language
    );
  return String(
    t('explorer:connections.when_one', {
      date: formatDay(when.timestamp, language),
      block: formatCount(when.height, language),
    })
  );
}

/** "block 1,371,641", or "blocks 1,364,500–2,100,000" (when the sentence has the dates). */
export function blocksText(
  first: number,
  last: number,
  t: TFunction,
  language: string
): string {
  return first === last
    ? String(
        t('explorer:connections.block', { block: formatCount(last, language) })
      )
    : String(
        t('explorer:connections.blocks', {
          first: formatCount(first, language),
          last: formatCount(last, language),
        })
      );
}

/** "4 payments", "2 transactions". */
export function evidenceWords(
  kind: EvidenceKind,
  count: number,
  t: TFunction,
  language: string
): string {
  return String(
    t(`explorer:connections.evidence.${kind}`, {
      count,
      shown: formatCount(count, language),
    })
  );
}

/** How an account shows: its name, else an exchange's name (for a viewer who sees them), else its short address. */
export function useAccountLabel(
  address: string | null,
  near: boolean
): { name: string | null | undefined; label: string } {
  const name = useAccountName(address, near);
  const exchange = useExchangeName(address);
  if (!address) return { name: null, label: '' };
  return {
    name,
    label: name ? visibleName(name) : (exchange ?? shortAddress(address)),
  };
}

/** The other account of a row: its picture and name, opening it as a step of the trail. */
export function PersonButton({
  address,
  near,
  secondary,
}: {
  address: string;
  near: boolean;
  /** Plain words under the name. */
  secondary?: ReactNode;
}) {
  const { t } = useTranslation(['explorer']);
  const { openAccount } = useExplorer();
  const at = isAtAddress(address);
  const { name, label } = useAccountLabel(address, near);
  return (
    <ButtonBase
      onClick={() => openAccount(address, { fromExplorer: true })}
      sx={(theme) => ({
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderRadius: '10px',
        display: 'flex',
        gap: 1,
        justifyContent: 'flex-start',
        maxWidth: '100%',
        minHeight: 40,
        ml: -0.75,
        px: 0.75,
        textAlign: 'left',
        '&:hover': { backgroundColor: theme.palette.action.hover },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
        },
      })}
    >
      <ExplorerAvatar name={name ?? null} size={30} />
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box
          component="bdi"
          dir="auto"
          sx={(theme) => ({
            color: theme.palette.primary.main,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          })}
        >
          {at ? t('explorer:connections.at_label', { address: label }) : label}
        </Box>
        {secondary ? (
          <Typography
            component="span"
            variant="body2"
            sx={(theme) => ({ color: mutedText(theme), fontSize: '0.78rem' })}
          >
            {secondary}
          </Typography>
        ) : null}
      </Box>
    </ButtonBase>
  );
}

/** The transactions behind a connection, newest first: the first 20, then "Show all". */
export function EvidenceList({
  txs,
  viewpoint,
  label,
  stepKey,
}: {
  txs: readonly TxRow[];
  viewpoint: string;
  label: string;
  /** What keeps "Show all" for the history step. */
  stepKey: string;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const [all, setAll] = useStepState<boolean>(`${stepKey}:all`, false);
  const shown = all ? txs : txs.slice(0, EVIDENCE_ROWS);
  return (
    <Box
      sx={(theme) => ({
        borderLeft: `2px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        minWidth: 0,
        mt: 0.5,
        pl: 0.5,
      })}
    >
      <TxList rows={shown} viewpoint={viewpoint} label={label} />
      {txs.length > shown.length ? (
        <Button
          size="small"
          onClick={() => setAll(true)}
          sx={{ alignSelf: 'flex-start', ml: 1 }}
        >
          {t('explorer:connections.show_all', {
            count: txs.length,
            shown: formatCount(txs.length, i18n.language),
            ...cap,
          })}
        </Button>
      ) : null}
    </Box>
  );
}

/**
 * The transactions behind a connection that are read only when it opens
 * (a Q-Asset trade's two orders), by their signatures, 4 at a time. A
 * failed read says so, with Retry, beside what was read.
 */
export function EvidenceBySignatures({
  signatures,
  viewpoint,
  label,
  stepKey,
}: {
  signatures: readonly string[];
  viewpoint: string;
  label: string;
  stepKey: string;
}) {
  const { t } = useTranslation(['explorer']);
  const joined = signatures.join(',');
  const specs = useMemo(
    () =>
      (joined ? joined.split(',') : []).map((signature) => txRead(signature)),
    [joined]
  );
  const reads = useExplorerReads(specs, { concurrency: 4 });
  const rows = specs
    .map((spec) => reads.data.get(spec.key))
    .filter((row): row is TxRow => Boolean(row))
    .sort(newestFirst);
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}
    >
      {rows.length ? (
        <EvidenceList
          txs={rows}
          viewpoint={viewpoint}
          label={label}
          stepKey={stepKey}
        />
      ) : null}
      {reads.loading ? (
        <LoadingLine label={t('explorer:connections.evidence.loading', cap)} />
      ) : null}
      {reads.failed.length ? (
        <ReadError
          message={t('explorer:connections.failed.evidence', cap)}
          onRetry={reads.retry}
        />
      ) : null}
    </Box>
  );
}

export interface ConnectionRowProps {
  /** The account whose page this is: the evidence is told from its side. */
  address: string;
  /** What the row keeps open in the history step. */
  rowKey: string;
  /** The other account; null for a row about several accounts or one that couldn't be read. */
  other: string | null;
  sentence: TxSentenceSpec;
  /** "12 Mar 2025 · block 1,371,641". */
  when: string;
  /** Plain words under the name: "its sponsor", "now level 0". */
  tags?: ReadonlyArray<string | null | false | undefined>;
  /** The transactions behind it, or their signatures to read when it opens. */
  evidence?: {
    kind: EvidenceKind;
    txs: readonly TxRow[];
    signatures?: readonly string[];
  };
  /** Payments one way: the sentence's amounts take the way's colour. */
  flow?: 'in' | 'out';
}

export function ConnectionRow({
  address,
  rowKey,
  other,
  sentence,
  when,
  tags,
  evidence,
  flow,
}: ConnectionRowProps) {
  const { t, i18n } = useTranslation(['explorer']);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const near = useNearScreen(node);
  const [open, setOpen] = useStepState<boolean>(`conn:${rowKey}`, false);
  const id = useId();
  const { label } = useAccountLabel(other, near);
  const shownTags = (tags ?? []).filter((tag): tag is string => Boolean(tag));
  const evidenceCount = evidence
    ? (evidence.signatures?.length ?? evidence.txs.length)
    : 0;
  const words = evidence
    ? evidenceWords(evidence.kind, evidenceCount, t, i18n.language)
    : null;
  const listLabel = String(
    other
      ? t('explorer:connections.evidence.list_with', {
          words: words ?? '',
          name: label,
          ...cap,
        })
      : t('explorer:connections.evidence.list', { words: words ?? '', ...cap })
  );
  return (
    <Box
      component="li"
      ref={setNode}
      sx={(theme) => ({
        backgroundColor: theme.palette.background.elevated,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        minWidth: 0,
        px: 1.5,
        py: 1.25,
      })}
    >
      {other ? (
        <PersonButton
          address={other}
          near={near}
          secondary={shownTags.length ? shownTags.join(' · ') : undefined}
        />
      ) : shownTags.length ? (
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {shownTags.join(' · ')}
        </Typography>
      ) : null}
      <Box
        sx={{
          alignItems: 'flex-end',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'space-between',
          minWidth: 0,
        }}
      >
        <Typography
          component="div"
          data-direction={flow}
          sx={(theme) => ({
            flex: '1 1 260px',
            fontSize: '0.95rem',
            lineHeight: 1.45,
            minWidth: 0,
            overflowWrap: 'anywhere',
            '&[data-direction="in"] strong': {
              color: theme.palette.other.positive,
            },
            '&[data-direction="out"] strong': {
              color: theme.palette.other.danger,
            },
          })}
        >
          <TxSentence sentence={sentence} mode="quiet" near={near} />
          {when ? (
            <Box
              component="span"
              sx={(theme) => ({
                color: mutedText(theme),
                display: 'inline-block',
                fontSize: '0.8rem',
                ml: 0.75,
              })}
            >
              <span aria-hidden>· </span>
              {when}
            </Box>
          ) : null}
        </Typography>
        {evidence && words ? (
          <Button
            size="small"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            aria-label={
              other
                ? t('explorer:connections.evidence.show_with', {
                    words,
                    name: label,
                    ...cap,
                  })
                : t('explorer:connections.evidence.show', { words, ...cap })
            }
            endIcon={
              <ExpandMoreRoundedIcon
                sx={{
                  transform: open ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s',
                }}
              />
            }
            sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            {words}
          </Button>
        ) : null}
      </Box>
      {evidence && open ? (
        <Box id={id} sx={{ minWidth: 0 }}>
          {evidence.signatures ? (
            <EvidenceBySignatures
              signatures={evidence.signatures}
              viewpoint={address}
              stepKey={`conn:${rowKey}`}
              label={listLabel}
            />
          ) : (
            <EvidenceList
              txs={evidence.txs}
              viewpoint={address}
              stepKey={`conn:${rowKey}`}
              label={listLabel}
            />
          )}
        </Box>
      ) : null}
    </Box>
  );
}

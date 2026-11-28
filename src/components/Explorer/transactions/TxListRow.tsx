/**
 * One transaction in a list: its family's icon (with the way it went), the
 * sentence, when and in which block, over one button that opens it to its
 * details: the type, its fields, the accounts involved, its raw API answer
 * and "Open transaction". A press anywhere on the row opens it, except on
 * an account or a transaction in the sentence: those are links (TxSentence
 * quiet), left out of the Tab order, since the opened details have the
 * same links for the keyboard. The button is named by the row's words,
 * which screen readers read once, as the button.
 *
 * Names in the sentence are read once the row nears the screen, so a long
 * list doesn't read every account's name at once; until then accounts show
 * by their short address.
 */
import { memo, useId, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  formatAgo,
  formatCount,
  formatDayTime,
} from '../../../lib/explorer/format';
import type { TxRow } from '../../../lib/explorer/reads';
import { makerOf, type TxOutcome } from '../../../lib/explorer/txWords';
import { useExplorer, useNearScreen } from '../ExplorerContext';
import { cap, mutedText, ReadError } from '../parts';
import { RawAnswer } from './RawJson';
import { typeTitle } from './sentenceText';
import { TxFields, TxPeople } from './TxDetails';
import { TxSentence } from './TxSentence';
import { flowColor, TxIcon, useTxWords } from './txLook';

// A list shows up to a thousand rows: each row's parts are styled once.
const Head = styled('div')(({ theme }) => ({
  alignItems: 'flex-start',
  borderRadius: 10,
  color: theme.palette.text.primary,
  display: 'flex',
  gap: theme.spacing(1.5),
  minHeight: 56,
  padding: theme.spacing(1, 1.25),
  position: 'relative',
  // The words let presses through to the button under them, except on their links.
  '& > :not(button)': { pointerEvents: 'none', position: 'relative' },
  '&:hover': { backgroundColor: theme.palette.action.hover },
  '& [data-chevron]': { transition: 'transform 0.15s' },
  '&[data-open] [data-chevron]': { transform: 'rotate(180deg)' },
  // Incoming amounts green, outgoing red; the arrow and its word say it too.
  '&[data-direction="in"] strong': { color: flowColor(theme, 'in') },
  '&[data-direction="out"] strong': { color: flowColor(theme, 'out') },
}));

const RowButton = styled('button')(({ theme }) => ({
  background: 'none',
  border: 0,
  borderRadius: 10,
  cursor: 'pointer',
  font: 'inherit',
  inset: 0,
  margin: 0,
  padding: 0,
  position: 'absolute',
  width: '100%',
  WebkitTapHighlightColor: 'transparent',
  '&:focus-visible': {
    outline: `2px solid ${theme.palette.primary.main}`,
    outlineOffset: -2,
  },
}));

const Lines = styled('span')({ display: 'block', flex: 1, minWidth: 0 });

const SentenceLine = styled('span')({
  display: 'block',
  fontSize: '0.95rem',
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
});

const WhenLine = styled('span')(({ theme }) => ({
  color: mutedText(theme),
  display: 'block',
  fontSize: '0.8rem',
  marginTop: 2,
}));

/** When it happened and in which block, or that it waits for one. */
export function txWhen(tx: TxRow, t: TFunction, language: string): string {
  if (typeof tx.blockHeight !== 'number')
    return String(
      t('explorer:tx.when_waiting', {
        ago: formatAgo(tx.timestamp, language),
        ...cap,
      })
    );
  return String(
    t('explorer:tx.when_block', {
      time: formatDayTime(tx.timestamp, language),
      block: formatCount(tx.blockHeight, language),
    })
  );
}

/** How its group approval ended, after the sentence. */
const Note = styled('span')(({ theme }) => ({
  color: mutedText(theme),
  marginInlineStart: theme.spacing(0.5),
}));

export function OutcomeNote({ outcome }: { outcome: TxOutcome | null }) {
  const { t } = useTranslation(['explorer']);
  if (!outcome) return null;
  return <Note>{t(`explorer:tx.outcome.${outcome}`)}</Note>;
}

function RowDetails({
  tx,
  words,
  panelId,
}: {
  tx: TxRow;
  words: ReturnType<typeof useTxWords>;
  panelId: string;
}) {
  const { t } = useTranslation(['explorer']);
  const { openTransaction } = useExplorer();
  const title = typeTitle(tx.type, t, true);
  return (
    <Box
      id={panelId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        minWidth: 0,
        pb: 1.5,
        pl: { xs: 1.25, sm: 7 },
        pr: { xs: 1.25, sm: 1.5 },
        pt: 0.5,
      }}
    >
      <Typography
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme), fontWeight: 600 })}
      >
        {title}
      </Typography>
      <TxFields
        fields={words.fields}
        label={t('explorer:tx.details_of', {
          type: typeTitle(tx.type, t),
          ...cap,
        })}
      />
      {words.privsFailed ? (
        <ReadError
          message={t('explorer:tx.privs_failed', cap)}
          onRetry={words.privsFailed}
        />
      ) : null}
      <TxPeople addresses={words.participants} maker={makerOf(tx)} />
      <RawAnswer
        tx={tx}
        before={
          <Button
            size="small"
            variant="outlined"
            endIcon={<OpenInNewRoundedIcon />}
            onClick={() => openTransaction(tx.signature)}
          >
            {t('explorer:tx.open', cap)}
          </Button>
        }
      />
    </Box>
  );
}

const Chevron = styled('span')(({ theme }) => ({
  alignItems: 'center',
  color: mutedText(theme),
  display: 'flex',
  height: 34,
}));

const Row = styled('div')({ minWidth: 0 });

/** One row; memoized, so a list that grows by a page renders only the new rows. */
export const TxListRow = memo(function TxListRow({
  tx,
  viewpoint,
}: {
  tx: TxRow;
  /** The account whose list this is: sentences are told from it ("Sent", "Received"). */
  viewpoint: string | null;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const [open, setOpen] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const near = useNearScreen(node);
  const words = useTxWords(tx, viewpoint, near);
  const id = useId();
  const flow =
    words.direction === 'in' || words.direction === 'out'
      ? words.direction
      : null;
  return (
    <Row ref={setNode}>
      <Head
        data-direction={flow ?? undefined}
        data-open={open ? '' : undefined}
      >
        <RowButton
          type="button"
          data-tx-row=""
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-controls={open ? `${id}-panel` : undefined}
          aria-labelledby={`${id}-mark ${id}-words`}
        />
        <span id={`${id}-mark`} aria-hidden>
          <TxIcon type={tx.type} flow={flow} />
        </span>
        <Lines id={`${id}-words`} aria-hidden>
          <SentenceLine>
            <TxSentence sentence={words.sentence} mode="quiet" near={near} />
            <OutcomeNote outcome={words.outcome} />
          </SentenceLine>
          <WhenLine>{txWhen(tx, t, i18n.language)}</WhenLine>
        </Lines>
        <Chevron aria-hidden>
          <ExpandMoreRoundedIcon data-chevron="" fontSize="small" />
        </Chevron>
      </Head>
      {open ? (
        <RowDetails tx={tx} words={words} panelId={`${id}-panel`} />
      ) : null}
    </Row>
  );
});

/** Rows as a list, in the order given. */
export function TxList({
  rows,
  viewpoint,
  label,
}: {
  rows: readonly TxRow[];
  viewpoint: string | null;
  label?: string;
}) {
  return (
    <Box
      component="ul"
      aria-label={label}
      sx={(theme) => ({
        listStyle: 'none',
        m: 0,
        p: 0,
        '& > li + li': { borderTop: `1px solid ${theme.palette.divider}` },
      })}
    >
      {rows.map((tx) => (
        <li key={tx.signature}>
          <TxListRow tx={tx} viewpoint={viewpoint} />
        </li>
      ))}
    </Box>
  );
}

/**
 * A transaction's raw API answer, easy to read: Core's JSON in its own
 * layout, keys, strings, numbers and true/false/null each in a colour of
 * the theme, every other line faintly striped, a long value wrapping under
 * itself, one line per row (so a selection copies as lines). Copy copies
 * the text exactly as JSON.stringify lays it out. A long answer scrolls
 * inside its box, which takes focus so a keyboard can scroll it.
 *
 * RawAnswer is the toggle it sits behind (in a list row's details and on a
 * transaction's own page): closed at first, and nothing is laid out until
 * it opens. It shows what may show (lib/explorer/rawTx.ts: no message
 * content, nothing that identifies an encrypted resource).
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useTranslation } from 'react-i18next';
import { jsonLines, jsonText } from '../../../lib/explorer/jsonLines';
import { rawForDisplay } from '../../../lib/explorer/rawTx';
import type { TxRow } from '../../../lib/explorer/reads';
import { cap, CopyButton, mutedText } from '../parts';

function RawJson({ value, label }: { value: unknown; label: string }) {
  const { t } = useTranslation(['explorer']);
  const lines = useMemo(() => jsonLines(value), [value]);
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme), flex: 1, minWidth: 0 })}
        >
          {t('explorer:tx.raw_caption', cap)}
        </Typography>
        <CopyButton
          value={jsonText(lines)}
          label={t('explorer:tx.raw_copy', cap)}
          copiedMessage={t('explorer:tx.raw_copied', cap)}
        />
      </Box>
      <Box
        component="pre"
        role="region"
        tabIndex={0}
        aria-label={label}
        sx={(theme) => ({
          backgroundColor: theme.palette.background.default,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '10px',
          color: 'text.secondary',
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          lineHeight: 1.55,
          m: 0,
          maxHeight: 'min(480px, 60vh)',
          overflow: 'auto',
          py: 1,
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
          '& > span': { display: 'flex', minWidth: 0, px: 1.5 },
          '& > span:nth-of-type(even)': {
            backgroundColor: alpha(theme.palette.text.primary, 0.04),
          },
          '& [data-i]': { flexShrink: 0 },
          '& [data-v]': {
            minWidth: 0,
            overflowWrap: 'anywhere',
            whiteSpace: 'pre-wrap',
          },
          '& [data-k="key"]': { color: theme.palette.primary.main },
          '& [data-k="string"]': { color: theme.palette.other.positive },
          '& [data-k="number"]': { color: theme.palette.other.minting },
          '& [data-k="boolean"], & [data-k="null"]': {
            color: theme.palette.error.main,
          },
        })}
      >
        {lines.map((line, i) => (
          <span key={i}>
            <span data-i="" style={{ width: `${line.depth * 2}ch` }} />
            <span data-v="">
              {line.parts.map((part, j) =>
                part.kind === 'punct' ? (
                  part.text
                ) : (
                  <span key={j} data-k={part.kind}>
                    {part.text}
                  </span>
                )
              )}
            </span>
          </span>
        ))}
      </Box>
    </Box>
  );
}

/**
 * "Raw API answer", opening to the transaction's answer under the row of
 * buttons it sits in; `before` goes first in that row.
 */
export function RawAnswer({ tx, before }: { tx: TxRow; before?: ReactNode }) {
  const { t } = useTranslation(['explorer']);
  const [open, setOpen] = useState(false);
  const id = useId();
  const notShown = t('explorer:tx.not_shown');
  const shown = useMemo(
    () => (open ? rawForDisplay(tx, notShown) : null),
    [open, tx, notShown]
  );
  const label = t('explorer:tx.raw', cap);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Box
        sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        {before}
        <Button
          size="small"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          endIcon={
            <ExpandMoreRoundedIcon
              sx={{
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s',
              }}
            />
          }
        >
          {label}
        </Button>
      </Box>
      {shown ? (
        <Box id={id}>
          <RawJson value={shown} label={label} />
        </Box>
      ) : null}
    </Box>
  );
}

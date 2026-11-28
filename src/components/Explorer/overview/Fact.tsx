/**
 * One of At a glance's facts, on a tile: its label (with an (i) saying how
 * it was worked out, when it has one), its value and a line under it; and
 * a fact whose read failed, with what couldn't load and Retry.
 */
import { type ReactNode } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { mutedText, ReadError, tileSx } from '../parts';

export function Fact({
  label,
  value,
  detail,
  info,
  wide = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  /** What the figure covers, on hover and focus of an (i) beside the label. */
  info?: string;
  wide?: boolean;
}) {
  return (
    <Box
      sx={(theme) => ({
        ...tileSx(theme),
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        ...(wide ? { gridColumn: '1 / -1' } : {}),
      })}
    >
      <Typography
        component="dt"
        variant="body2"
        sx={(theme) => ({
          alignItems: 'center',
          color: mutedText(theme),
          display: 'flex',
          gap: 0.5,
        })}
      >
        {label}
        {info ? (
          <Tooltip title={info}>
            <Box
              component="span"
              tabIndex={0}
              role="img"
              aria-label={info}
              sx={{
                display: 'inline-flex',
                '&:focus-visible': { outline: '2px solid' },
              }}
            >
              <InfoOutlinedIcon sx={{ fontSize: 15 }} />
            </Box>
          </Tooltip>
        ) : null}
      </Typography>
      <Typography
        component="dd"
        sx={{
          fontSize: '1.1rem',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          m: 0,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Typography>
      {detail ? (
        <Typography
          component="dd"
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme), m: 0 })}
        >
          {detail}
        </Typography>
      ) : null}
    </Box>
  );
}

/** A fact whose read failed: what couldn't load, and Retry, across the row. */
export function FactError({
  label,
  message,
  onRetry,
}: {
  label: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Fact
      wide
      label={label}
      value={<ReadError message={message} onRetry={onRetry} />}
    />
  );
}

/** A fact's value said in words, not a figure (normal weight, muted). */
export function FactWords({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        color: mutedText(theme),
        fontSize: '0.95rem',
        fontWeight: 500,
      })}
    >
      {children}
    </Box>
  );
}

import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { GROUP_ACTIVITY_BLUE } from '../groupActivityColorSystem';

const BLOCK_HEIGHT_TAIL_DIGITS = 4;

function getBlockHeightParts(value?: string | null) {
  const rawValue = `${value || ''}`.trim();
  const digits = rawValue.replace(/\D/g, '');

  if (digits.length <= BLOCK_HEIGHT_TAIL_DIGITS) {
    return {
      canHighlightTail: false,
      fullValue: rawValue,
      prefix: '',
      tail: rawValue,
    };
  }

  return {
    canHighlightTail: true,
    fullValue: digits,
    prefix: digits.slice(0, -BLOCK_HEIGHT_TAIL_DIGITS),
    tail: digits.slice(-BLOCK_HEIGHT_TAIL_DIGITS),
  };
}

export function BlockHeightValue({ theme, value }) {
  const parts = getBlockHeightParts(value);

  return (
    <Box
      aria-label={`Node height ${parts.fullValue || value}`}
      component="span"
      title={parts.fullValue ? `Full height: ${parts.fullValue}` : undefined}
      sx={{
        alignItems: 'center',
        color: alpha(theme.palette.text.primary, 0.88),
        display: 'inline-flex',
        fontFamily:
          '"IBM Plex Mono","SFMono-Regular","Cascadia Mono","Fira Code","Consolas",monospace',
        fontSize: '0.9rem',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 700,
        gap: '6px',
        justifySelf: 'end',
        letterSpacing: '0.028em',
        lineHeight: 1,
        maxWidth: '100%',
        minWidth: 0,
        overflow: 'hidden',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}
    >
      {parts.canHighlightTail ? (
        <>
          <Box
            component="span"
            sx={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {parts.prefix}
          </Box>
          <Box
            component="span"
            sx={{
              backgroundColor: alpha(
                GROUP_ACTIVITY_BLUE.primary,
                theme.palette.mode === 'dark' ? 0.18 : 0.12
              ),
              border: `1px solid ${alpha(
                GROUP_ACTIVITY_BLUE.gradientTop,
                theme.palette.mode === 'dark' ? 0.42 : 0.34
              )}`,
              borderRadius: '6px',
              boxShadow:
                theme.palette.mode === 'dark'
                  ? `0 0 0 1px ${alpha(GROUP_ACTIVITY_BLUE.primary, 0.08)}`
                  : 'none',
              color:
                theme.palette.mode === 'dark'
                  ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.96)
                  : alpha(GROUP_ACTIVITY_BLUE.pressed, 0.94),
              display: 'inline-flex',
              justifyContent: 'center',
              letterSpacing: '0.05em',
              minWidth: '5ch',
              px: '7px',
              py: '4px',
            }}
          >
            {parts.tail}
          </Box>
        </>
      ) : (
        parts.tail
      )}
    </Box>
  );
}

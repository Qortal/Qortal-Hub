import { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Tooltip, alpha, useTheme } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { useTranslation } from 'react-i18next';
import { splitCode } from './widgetGuide';

const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/** A guide text: its `backtick` parts as code. */
export const GuideText = ({ text }: { text: string }) => {
  const theme = useTheme();
  return (
    <>
      {splitCode(text).map((piece, index) =>
        piece.code ? (
          <Box
            component="code"
            key={index}
            sx={{
              backgroundColor: alpha(theme.palette.text.primary, 0.08),
              borderRadius: '5px',
              fontFamily: MONO,
              fontSize: '0.88em',
              overflowWrap: 'anywhere',
              px: '5px',
              py: '1px',
            }}
          >
            {piece.text}
          </Box>
        ) : (
          <span key={index}>{piece.text}</span>
        )
      )}
    </>
  );
};

/**
 * Writes `text` to the clipboard. 'copied' for a moment after it worked,
 * 'failed' when the clipboard refused it.
 */
export const useCopy = () => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), 2000);
  };
  return { state, copy };
};

/** A code block, with a button that copies it. */
export const GuideCode = ({ code }: { code: string }) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const { state, copy } = useCopy();
  const label =
    state === 'copied'
      ? t('core:action.copied', { postProcess: 'capitalizeFirstChar' })
      : state === 'failed'
        ? t('core:widget_guide.copy_failed', {
            postProcess: 'capitalizeFirstChar',
          })
        : t('core:action.copy_code', { postProcess: 'capitalizeFirstChar' });

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        component="pre"
        sx={{
          backgroundColor: alpha(theme.palette.text.primary, 0.05),
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '12px',
          fontFamily: MONO,
          fontSize: '12.5px',
          lineHeight: 1.6,
          m: 0,
          overflowX: 'auto',
          p: 2,
          pr: 6,
          tabSize: 2,
        }}
      >
        <code>{code}</code>
      </Box>
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          onClick={() => copy(code)}
          size="small"
          sx={{
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            position: 'absolute',
            right: 8,
            top: 8,
          }}
        >
          {state === 'copied' ? (
            <CheckRoundedIcon fontSize="inherit" />
          ) : (
            <ContentCopyRoundedIcon fontSize="inherit" />
          )}
        </IconButton>
      </Tooltip>
    </Box>
  );
};

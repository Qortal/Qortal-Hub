import {
  Box,
  ButtonBase,
  Typography,
  useTheme,
  type SxProps,
  type Theme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QUIP_TYPE_MS_PER_CHAR } from './qortinoQuips';
import type { ActiveQortinoQuip } from './useQortinoQuips';

/** Where Qortino's mouth is, from the bubble's bottom-left corner. */
export type QortinoMouthOffset = { x: number; y: number };

type Props = {
  quip: ActiveQortinoQuip | null;
  mouth: QortinoMouthOffset;
  /** The words are still coming: Qortino's mouth moves meanwhile. */
  onTypingChange: (typing: boolean) => void;
  /** Opens Qortino; none where Qortino AI can't run (the browser build). */
  onTap?: () => void;
};

const PUFF_DOTS = [0, 1, 2];
/** The bubble starts growing once the puff is half way. */
const BUBBLE_DELAY_S = 0.16;
const TYPE_DELAY_MS = 280;

/** The words, typed out; the rest of the line already holds its place. */
function TypedText({
  text,
  instant,
  onTypingChange,
}: {
  text: string;
  instant: boolean;
  onTypingChange: (typing: boolean) => void;
}) {
  const [shown, setShown] = useState(instant ? text.length : 0);

  useEffect(() => {
    if (instant) {
      setShown(text.length);
      return;
    }
    // A new line in the same bubble (a giggle, his answer) starts empty.
    setShown(0);
    // Long lines type two letters at a time, so none takes over ~2.6 s.
    const step = text.length > 100 ? 2 : 1;
    let count = 0;
    let interval: number | null = null;
    const start = window.setTimeout(() => {
      onTypingChange(true);
      interval = window.setInterval(() => {
        count = Math.min(text.length, count + step);
        setShown(count);
        if (count >= text.length && interval != null) {
          window.clearInterval(interval);
          interval = null;
          onTypingChange(false);
        }
      }, QUIP_TYPE_MS_PER_CHAR);
    }, TYPE_DELAY_MS);
    return () => {
      window.clearTimeout(start);
      if (interval != null) window.clearInterval(interval);
      onTypingChange(false);
    };
  }, [instant, onTypingChange, text]);

  return (
    <>
      {text.slice(0, shown)}
      <Box component="span" aria-hidden sx={{ opacity: 0 }}>
        {text.slice(shown)}
      </Box>
    </>
  );
}

/**
 * Something Qortino says on Home: a little puff leaves his mouth and the
 * bubble grows out of it, the words type out while his mouth moves, and
 * when he is done the bubble shrinks back the way it came. Tapping it opens
 * Qortino.
 */
export function QortinoSpeechPopup({
  quip,
  mouth,
  onTypingChange,
  onTap,
}: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation(['core']);
  const reduceMotion = Boolean(useReducedMotion());
  const surface = isDark
    ? 'linear-gradient(180deg, rgba(31,36,45,0.92) 0%, rgba(19,23,29,0.97) 100%)'
    : 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(243,247,252,0.97) 100%)';

  const bubbleSx: SxProps<Theme> = {
    alignItems: 'flex-start',
    background: surface,
    border: `1px solid ${alpha(isDark ? '#8DB8FF' : '#6E8FB8', isDark ? 0.22 : 0.3)}`,
    borderRadius: '15px',
    boxShadow: `0 14px 26px ${alpha('#000', isDark ? 0.24 : 0.1)}, 0 0 18px ${alpha('#8DB8FF', isDark ? 0.12 : 0.1)}`,
    display: 'flex',
    justifyContent: 'flex-start',
    maxWidth: { xs: 'calc(100% - 4px)', sm: '214px' },
    minWidth: 0,
    p: 0.9,
    position: 'relative',
    textAlign: 'left',
    '&::after': {
      background: surface,
      bottom: '12px',
      clipPath: 'polygon(0 55%, 100% 0, 100% 100%)',
      content: '""',
      height: '14px',
      left: '-9px',
      position: 'absolute',
      width: '10px',
    },
  };

  const words = quip ? (
    <Typography
      component="span"
      sx={{
        color: alpha(theme.palette.text.primary, 0.94),
        display: '-webkit-box',
        fontSize: '0.73rem',
        fontWeight: 600,
        letterSpacing: '-0.015em',
        lineHeight: 1.4,
        overflow: 'hidden',
        overflowWrap: 'anywhere',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 4,
      }}
    >
      <TypedText
        instant={reduceMotion}
        onTypingChange={onTypingChange}
        text={quip.text}
      />
    </Typography>
  ) : null;

  return (
    <AnimatePresence>
      {quip ? (
        <motion.div
          key={quip.id}
          style={{ minWidth: 0, position: 'relative', width: '100%' }}
        >
          {reduceMotion
            ? null
            : PUFF_DOTS.map((dot) => (
                <motion.span
                  key={dot}
                  aria-hidden
                  initial={{ opacity: 0, scale: 0.4, x: mouth.x, y: mouth.y }}
                  animate={{
                    opacity: [0, 0.95, 0],
                    scale: [0.4, 1, 0.6],
                    x: [mouth.x, mouth.x * 0.45, -6],
                    y: [mouth.y, mouth.y * 0.5 - 6, -14],
                  }}
                  transition={{
                    delay: dot * 0.06,
                    duration: 0.36,
                    ease: 'easeOut',
                  }}
                  style={{
                    background: alpha('#8DB8FF', 0.9),
                    borderRadius: '50%',
                    bottom: 0,
                    boxShadow: `0 0 8px ${alpha('#8DB8FF', 0.7)}`,
                    height: 7 - dot * 1.5,
                    left: 0,
                    pointerEvents: 'none',
                    position: 'absolute',
                    width: 7 - dot * 1.5,
                  }}
                />
              ))}
          <motion.div
            initial={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.12, x: mouth.x * 0.5, y: 10 }
            }
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={
              reduceMotion
                ? { opacity: 0, transition: { duration: 0.2 } }
                : {
                    opacity: 0,
                    scale: 0.16,
                    x: mouth.x * 0.5,
                    y: 10,
                    transition: { duration: 0.28, ease: [0.5, 0, 0.9, 0.4] },
                  }
            }
            transition={
              reduceMotion
                ? { duration: 0.2 }
                : {
                    delay: BUBBLE_DELAY_S,
                    type: 'spring',
                    stiffness: 420,
                    damping: 22,
                    mass: 0.7,
                  }
            }
            style={{ transformOrigin: '0% 85%' }}
          >
            {onTap ? (
              <ButtonBase
                aria-label={`${quip.text} ${t('core:qortino_workspace.quip_open_hint')}`}
                onClick={onTap}
                sx={bubbleSx}
              >
                {words}
              </ButtonBase>
            ) : (
              // Nothing to open where Qortino AI can't run: just his words.
              <Box sx={bubbleSx}>{words}</Box>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

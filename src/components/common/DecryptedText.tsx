import { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';

type DecryptedTextProps = {
  text: string;
  animateOn?: 'hover';
  active?: boolean;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  revealDirection?: 'start' | 'end';
  useOriginalCharsOnly?: boolean;
};

const getScrambledChar = (
  pool: string[],
  fallback: string,
  index: number,
  step: number
) => {
  if (!pool.length) return fallback;
  return pool[(index + step) % pool.length] ?? fallback;
};

export const DecryptedText = ({
  text,
  animateOn = 'hover',
  active = false,
  speed = 35,
  maxIterations = 12,
  sequential = true,
  revealDirection = 'start',
  useOriginalCharsOnly = true,
}: DecryptedTextProps) => {
  const [displayText, setDisplayText] = useState(text);
  const timeoutRef = useRef<number | null>(null);
  const stepRef = useRef(0);

  const charPool = useMemo(
    () => Array.from(new Set(text.split('').filter((char) => char.trim()))),
    [text]
  );

  useEffect(() => {
    setDisplayText(text);

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [text]);

  useEffect(() => {
    if (animateOn !== 'hover') return;

    if (active) {
      runAnimation();
      return;
    }

    stopAnimation();
  }, [active, animateOn]);

  const stopAnimation = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    stepRef.current = 0;
    setDisplayText(text);
  };

  const runAnimation = () => {
    stopAnimation();

    const tick = () => {
      const step = stepRef.current;
      const progress = sequential
        ? Math.min(text.length, Math.ceil(((step + 1) / maxIterations) * text.length))
        : 0;

      const chars = text.split('').map((char, index) => {
        if (char === ' ') return char;

        const revealed =
          revealDirection === 'start'
            ? index < progress
            : index >= text.length - progress;

        if (revealed || step >= maxIterations - 1) {
          return char;
        }

        return useOriginalCharsOnly
          ? getScrambledChar(charPool, char, index, step)
          : getScrambledChar(
              'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
              char,
              index,
              step
            );
      });

      setDisplayText(chars.join(''));

      if (step < maxIterations - 1) {
        stepRef.current += 1;
        timeoutRef.current = window.setTimeout(tick, speed);
        return;
      }

      timeoutRef.current = null;
      stepRef.current = 0;
      setDisplayText(text);
    };

    tick();
  };

  return (
    <Box
      component="span"
      sx={{
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        width: '100%',
      }}
    >
      {displayText}
    </Box>
  );
};

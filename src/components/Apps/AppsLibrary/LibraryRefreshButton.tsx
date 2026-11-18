import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { alpha, keyframes } from '@mui/material/styles';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useTranslation } from 'react-i18next';
import {
  REFRESH_DONE_MS,
  REFRESH_PULSE_MS,
  REFRESH_TURN_MS,
} from './libraryLayout';
import {
  cap,
  INSTANT_TOOLTIP,
  libraryAccent,
  libraryFocusRing,
  libraryMuted,
  REDUCED_MOTION,
  usePrefersReducedMotion,
  visuallyHiddenSx,
} from './libraryStyles';

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const popIn = keyframes`
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
`;

type Phase = 'idle' | 'busy' | 'done';

interface LibraryRefreshButtonProps {
  /** The button's name; it stays the same while it turns. */
  label: string;
  onRefresh: () => unknown | Promise<unknown>;
}

/**
 * Reloads the library. The icon turns while the node answers and stops only
 * at the end of a full turn, so it always comes to rest level and always
 * makes at least one turn, however fast the node is. A check then shows for
 * a moment, and screen readers hear that the library was refreshed.
 */
export const LibraryRefreshButton = ({
  label,
  onRefresh,
}: LibraryRefreshButtonProps) => {
  const { t } = useTranslation(['core']);
  const reduce = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [announce, setAnnounce] = useState('');
  const busyRef = useRef(false);
  const settledRef = useRef(false);
  const fallbackRef = useRef<number | undefined>(undefined);
  const doneRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(fallbackRef.current);
      window.clearTimeout(doneRef.current);
    };
  }, []);

  const finish = useCallback(() => {
    window.clearTimeout(fallbackRef.current);
    if (!mountedRef.current || !busyRef.current) return;
    busyRef.current = false;
    settledRef.current = false;
    setPhase('done');
    setAnnounce(t('core:launcher.library.refreshed', cap));
    doneRef.current = window.setTimeout(() => {
      if (mountedRef.current) setPhase('idle');
    }, REFRESH_DONE_MS);
  }, [t]);

  const handleClick = async () => {
    // A click while it turns does nothing.
    if (busyRef.current) return;
    busyRef.current = true;
    settledRef.current = false;
    window.clearTimeout(doneRef.current);
    setAnnounce('');
    setPhase('busy');
    try {
      await Promise.resolve(onRefresh());
    } catch {
      // The list keeps what it has.
    }
    if (!mountedRef.current) return;
    settledRef.current = true;
    // A hidden panel (or a test) sends no animation events.
    fallbackRef.current = window.setTimeout(finish, REFRESH_TURN_MS + 400);
  };

  const handleIteration = () => {
    if (settledRef.current) finish();
  };

  const isBusy = phase === 'busy';
  const tooltip =
    phase === 'busy'
      ? t('core:launcher.library.refreshing', cap)
      : phase === 'done'
        ? t('core:launcher.library.refreshed', cap)
        : label;

  return (
    <>
      <Tooltip {...INSTANT_TOOLTIP} describeChild title={tooltip}>
        <IconButton
          aria-busy={isBusy}
          aria-disabled={isBusy}
          aria-label={label}
          disableRipple
          onClick={handleClick}
          sx={(theme) => ({
            backgroundColor: alpha(theme.palette.background.paper, 0.72),
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '12px',
            color: isBusy ? libraryAccent(theme) : libraryMuted(theme),
            flexShrink: 0,
            height: 36,
            transition: 'background-color 160ms, color 300ms',
            width: 36,
            '&:hover': {
              backgroundColor: theme.palette.background.paper,
              color: isBusy ? libraryAccent(theme) : theme.palette.text.primary,
            },
            '&.Mui-focusVisible': libraryFocusRing(theme, 2),
          })}
        >
          {phase === 'done' ? (
            <CheckRoundedIcon
              data-refresh-phase="done"
              sx={(theme) => ({
                animation: `${popIn} 150ms ease-out`,
                color: theme.palette.success.main,
                fontSize: 20,
                [REDUCED_MOTION]: { animation: 'none' },
              })}
            />
          ) : (
            <RefreshRoundedIcon
              data-motion={isBusy ? (reduce ? 'pulse' : 'spin') : undefined}
              data-refresh-phase={phase}
              onAnimationIteration={handleIteration}
              sx={{
                animation: isBusy
                  ? reduce
                    ? `${pulse} ${REFRESH_PULSE_MS}ms ease-in-out infinite`
                    : `${spin} ${REFRESH_TURN_MS}ms cubic-bezier(0.45, 0.05, 0.35, 1) infinite`
                  : 'none',
                fontSize: 20,
              }}
            />
          )}
        </IconButton>
      </Tooltip>
      <Box component="span" role="status" sx={visuallyHiddenSx}>
        {announce}
      </Box>
    </>
  );
};

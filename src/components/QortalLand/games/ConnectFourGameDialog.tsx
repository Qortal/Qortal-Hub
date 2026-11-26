import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import SportsEsportsRoundedIcon from '@mui/icons-material/SportsEsportsRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useMediaQuery,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
  connectFourDropRow,
  getConnectFourWinningCells,
  type ConnectFourMove,
  type ConnectFourOutcome,
  type ConnectFourSeat,
  type ConnectFourState,
} from './connectFour';
import { GameSessionChat, type GameChatMessage } from './GameSessionChat';
import { GameInvitationSentDialog } from './GameInvitationSentDialog';
import { friendlyGameStatus } from './gameDialogText';
import {
  gameModalActionsSx,
  gameModalDangerButtonSx,
  gameModalDividerSx,
  gameModalPaperSx,
  gameModalPrimaryButtonSx,
  gameModalSecondaryButtonSx,
} from './gameModalStyles';

export type ConnectFourGamePhase =
  | 'idle'
  | 'opening'
  | 'waiting'
  | 'incoming'
  | 'starting'
  | 'active'
  | 'finishing'
  | 'reconnecting'
  | 'finished'
  | 'session-idle'
  | 'round-waiting'
  | 'round-incoming';

export type ConnectFourGameView = {
  matchId: string;
  roundId: string;
  requesterAddress: string;
  recipientAddress: string;
  requesterNonce: string;
  recipientNonce?: string;
  requesterName?: string;
  recipientName?: string;
  phase: ConnectFourGamePhase;
  localSeat?: ConnectFourSeat;
  startingSeat?: ConnectFourSeat;
  state?: ConnectFourState;
  stateHash?: string;
  moves: ConnectFourMove[];
  pendingMoveId?: string;
  pendingSince?: number;
  lastRoundTripMs?: number;
  expiresAt?: number;
  reconnectDeadline?: number;
  outcome?: ConnectFourOutcome;
  error?: string;
  chatMessages: GameChatMessage[];
  remoteTypingUntil?: number;
  sessionClosed?: boolean;
};

type Props = {
  address: string;
  match: ConnectFourGameView | null;
  now: number;
  transportReady: boolean;
  onClose: () => void;
  onPlayColumn: (column: number) => Promise<boolean>;
  onRematch: () => void;
  onResign: () => void;
  onRespond: (accepted: boolean) => void;
  onSendChat: (text: string) => boolean;
  onTyping: (active: boolean) => void;
  resolvePlayerName?: (address: string) => string;
};

const SOUND_KEY = 'qortalland.connectFour.soundMuted';
const PLAYER_COLORS: Record<ConnectFourSeat, string> = {
  1: '#ffd24f',
  2: '#ff5876',
};

const shortAddress = (value: string): string =>
  value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;

const playerInitial = (name: string): string =>
  (
    name
      .trim()
      .replace(/^Q(?=[A-Z0-9])/, '')
      .charAt(0) || '?'
  ).toUpperCase();

const outcomeText = (
  outcome: ConnectFourOutcome | undefined,
  localSeat?: ConnectFourSeat
): string => {
  if (!outcome) return 'Game ended';
  if (outcome.type === 'draw') return 'Draw game';
  if (outcome.type === 'abandoned') return 'Game abandoned';
  if (outcome.type === 'protocol-error') return 'Game ended safely';
  return outcome.winner === localSeat ? 'You won!' : 'You lost';
};

const availableSpaces = (state: ConnectFourState, column: number): number => {
  let count = 0;
  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    if (state.board[row * CONNECT_FOUR_COLUMNS + column] === 0) count += 1;
  }
  return count;
};

const lastMoveRow = (
  state: ConnectFourState,
  move?: ConnectFourMove
): number | null => {
  if (!move) return null;
  let occupied = 0;
  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    if (state.board[row * CONNECT_FOUR_COLUMNS + move.column] !== 0)
      occupied += 1;
  }
  return occupied > 0 ? occupied - 1 : null;
};

const readMuted = (): boolean => {
  try {
    return window.localStorage.getItem(SOUND_KEY) === 'true';
  } catch {
    return false;
  }
};

export function ConnectFourGameDialog({
  address,
  match,
  now,
  transportReady,
  onClose,
  onPlayColumn,
  onRematch,
  onResign,
  onRespond,
  onSendChat,
  onTyping,
  resolvePlayerName,
}: Props) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [focusedColumn, setFocusedColumn] = useState<number | null>(null);
  const [shakeNonce, setShakeNonce] = useState(0);
  const [muted, setMuted] = useState(readMuted);
  const [resignConfirmationOpen, setResignConfirmationOpen] = useState(false);
  const [boardWidth, setBoardWidth] = useState<number | null>(null);
  const boardAreaRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusedColumnRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousPlyRef = useRef(0);
  const previousTurnRef = useRef(false);
  const previousInviteRef = useRef('');
  const originalTitleRef = useRef<string | null>(null);

  const localSeat = match?.localSeat;
  const opponentAddress = match
    ? match.requesterAddress === address
      ? match.recipientAddress
      : match.requesterAddress
    : '';
  const opponentName = match
    ? match.requesterAddress === address
      ? resolvePlayerName?.(match.recipientAddress) ||
        match.recipientName ||
        shortAddress(match.recipientAddress)
      : resolvePlayerName?.(match.requesterAddress) ||
        match.requesterName ||
        shortAddress(match.requesterAddress)
    : '';
  const requesterLabel = match
    ? resolvePlayerName?.(match.requesterAddress) ||
      match.requesterName ||
      shortAddress(match.requesterAddress)
    : '';
  const state = match?.state;
  const localTurn = Boolean(
    match?.phase === 'active' &&
    state &&
    localSeat &&
    state.nextSeat === localSeat &&
    !match.pendingMoveId
  );
  const winningCells = useMemo(
    () => new Set(state ? getConnectFourWinningCells(state) : []),
    [state]
  );
  const lastMove = match?.moves.at(-1);
  const lastRow = state ? lastMoveRow(state, lastMove) : null;
  const previewRow =
    state && focusedColumn !== null && localTurn
      ? connectFourDropRow(state, focusedColumn)
      : null;
  const canShowBoard = Boolean(
    match &&
    state &&
    ['active', 'finishing', 'reconnecting', 'finished'].includes(match.phase)
  );
  const canShowChat = Boolean(match && state);

  const playSound = useCallback(
    (kind: 'drop' | 'turn' | 'invalid' | 'win' | 'loss') => {
      if (muted) return;
      try {
        const AudioContextClass = window.AudioContext;
        const context = audioContextRef.current || new AudioContextClass();
        audioContextRef.current = context;
        const notes =
          kind === 'win'
            ? [523, 659, 784]
            : kind === 'loss'
              ? [330, 277]
              : [kind === 'drop' ? 210 : kind === 'turn' ? 660 : 120];
        notes.forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const startsAt = context.currentTime + index * 0.1;
          oscillator.type = kind === 'invalid' ? 'square' : 'sine';
          oscillator.frequency.setValueAtTime(frequency, startsAt);
          gain.gain.setValueAtTime(0.0001, startsAt);
          gain.gain.exponentialRampToValueAtTime(
            kind === 'invalid' ? 0.035 : 0.055,
            startsAt + 0.012
          );
          gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + 0.13);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(startsAt);
          oscillator.stop(startsAt + 0.14);
        });
      } catch {
        // Audio feedback is optional and must never affect gameplay.
      }
    },
    [muted]
  );

  useEffect(() => {
    const ply = state?.ply || 0;
    if (ply > previousPlyRef.current) playSound('drop');
    previousPlyRef.current = ply;
  }, [playSound, state?.ply]);

  useEffect(() => {
    if (match?.phase === 'finished' && match.outcome) {
      const won =
        'winner' in match.outcome && match.outcome.winner === localSeat;
      playSound(won ? 'win' : match.outcome.type === 'draw' ? 'turn' : 'loss');
    }
  }, [localSeat, match?.outcome, match?.phase, playSound]);

  useEffect(() => {
    if (localTurn && !previousTurnRef.current && (state?.ply || 0) > 0) {
      playSound('turn');
      if (document.hidden) {
        if (originalTitleRef.current === null)
          originalTitleRef.current = document.title;
        document.title = '● Your turn — Qonnect Four';
        try {
          if (
            'Notification' in window &&
            Notification.permission === 'granted'
          ) {
            new Notification('Your turn in Qonnect Four', {
              body: `${opponentName} has moved.`,
              silent: true,
            });
          }
        } catch {
          // Window-title feedback remains available when notifications are blocked.
        }
      }
    }
    previousTurnRef.current = localTurn;
    if (!localTurn && originalTitleRef.current !== null) {
      document.title = originalTitleRef.current;
      originalTitleRef.current = null;
    }
  }, [localTurn, opponentName, playSound, state?.ply]);

  useEffect(() => {
    const incomingId = match?.phase === 'incoming' ? match.matchId : '';
    if (incomingId && previousInviteRef.current !== incomingId) {
      playSound('turn');
      if (document.hidden) {
        if (originalTitleRef.current === null)
          originalTitleRef.current = document.title;
        document.title = '● Qonnect Four invitation';
        try {
          if (
            'Notification' in window &&
            Notification.permission === 'granted'
          ) {
            new Notification('Qonnect Four invitation', {
              body: `${requesterLabel} invited you to play.`,
              silent: true,
            });
          }
        } catch {
          // The modal and window title remain available when notifications are blocked.
        }
      }
    }
    previousInviteRef.current = incomingId;
    if (!incomingId && !localTurn && originalTitleRef.current !== null) {
      document.title = originalTitleRef.current;
      originalTitleRef.current = null;
    }
  }, [localTurn, match?.matchId, match?.phase, playSound, requesterLabel]);

  useEffect(
    () => () => {
      if (originalTitleRef.current !== null)
        document.title = originalTitleRef.current;
      void audioContextRef.current?.close().catch(() => {});
    },
    []
  );

  useEffect(() => {
    setFocusedColumn(null);
    focusedColumnRef.current = null;
    previousPlyRef.current = match?.state?.ply || 0;
    previousTurnRef.current = false;
  }, [match?.matchId]);

  useEffect(() => {
    focusedColumnRef.current = focusedColumn;
  }, [focusedColumn]);

  useEffect(() => {
    const boardArea = boardAreaRef.current;
    if (!boardArea || !canShowBoard) {
      setBoardWidth(null);
      return;
    }
    const fitBoard = (width: number, height: number) => {
      const next = Math.floor(
        Math.min(width, height * (CONNECT_FOUR_COLUMNS / CONNECT_FOUR_ROWS))
      );
      setBoardWidth(next > 0 ? next : null);
    };
    const measure = () => {
      const bounds = boardArea.getBoundingClientRect();
      fitBoard(bounds.width, bounds.height);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) fitBoard(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(boardArea);
    return () => observer.disconnect();
  }, [canShowBoard]);

  const toggleMuted = useCallback(() => {
    setMuted((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(SOUND_KEY, String(next));
      } catch {
        // Keep the in-memory preference when storage is unavailable.
      }
      return next;
    });
  }, []);

  const attemptColumn = useCallback(
    async (column: number) => {
      if (!state || !localTurn) return;
      if (connectFourDropRow(state, column) === null) {
        setShakeNonce((value) => value + 1);
        playSound('invalid');
        return;
      }
      const played = await onPlayColumn(column);
      if (!played) {
        setShakeNonce((value) => value + 1);
        playSound('invalid');
      }
    },
    [localTurn, onPlayColumn, playSound, state]
  );

  useEffect(() => {
    if (!localTurn) return;
    const initialColumn = focusedColumnRef.current ?? 3;
    const focusColumn = (column: number) => {
      const bounded = Math.max(0, Math.min(CONNECT_FOUR_COLUMNS - 1, column));
      focusedColumnRef.current = bounded;
      setFocusedColumn(bounded);
      columnRefs.current[bounded]?.focus();
    };
    const focusFrame = window.requestAnimationFrame(() =>
      focusColumn(initialColumn)
    );
    const handleGameKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.matches('input,textarea,[contenteditable="true"]')) return;
      const current = focusedColumnRef.current ?? 3;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        focusColumn(current - 1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        focusColumn(current + 1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        focusColumn(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        focusColumn(CONNECT_FOUR_COLUMNS - 1);
        return;
      }
      if (/^[1-7]$/.test(event.key)) {
        event.preventDefault();
        const column = Number(event.key) - 1;
        focusColumn(column);
        void attemptColumn(column);
        return;
      }
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        !target?.getAttribute('aria-label')?.startsWith('Play column')
      ) {
        event.preventDefault();
        void attemptColumn(current);
      }
    };
    window.addEventListener('keydown', handleGameKey);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleGameKey);
    };
  }, [attemptColumn, localTurn]);

  const liveMessage = match
    ? match.phase === 'reconnecting'
      ? `Connection interrupted. Reconnecting for ${Math.max(0, Math.ceil(((match.reconnectDeadline || now) - now) / 1000))} seconds.`
      : match.phase === 'finished'
        ? outcomeText(match.outcome, localSeat)
        : localTurn
          ? 'Your turn.'
          : match.phase === 'active'
            ? `${opponentName}'s turn.`
            : ''
    : '';
  const resultAnnouncement = match?.outcome
    ? match.outcome.type === 'draw'
      ? 'Draw'
      : 'winner' in match.outcome
        ? match.outcome.winner === localSeat
          ? 'You won!'
          : 'You lost!'
        : 'Game over'
    : '';
  const resultSubtitle = match?.outcome
    ? match.outcome.type === 'draw'
      ? 'Want another round?'
      : 'winner' in match.outcome && match.outcome.winner === localSeat
        ? 'Best out of 3?'
        : 'Better luck next time.'
    : '';

  if (match?.phase === 'opening') return null;

  if (match?.phase === 'waiting') {
    return (
      <GameInvitationSentDialog
        expiresAt={match.expiresAt}
        gameTitle="Qonnect Four"
        now={now}
        onCancel={onClose}
        opponentName={opponentName}
      />
    );
  }

  return (
    <>
      <Dialog
        open={Boolean(match && match.phase !== 'session-idle')}
        disableEscapeKeyDown={Boolean(match && match.phase !== 'finished')}
        onClose={(_event, reason) => {
          if (
            !match ||
            reason === 'backdropClick' ||
            match.phase !== 'finished'
          )
            return;
          onClose();
        }}
        maxWidth={false}
        sx={{
          '& .MuiDialog-container': {
            alignItems: 'center',
            boxSizing: 'border-box',
            pb: '12px',
            pt: { xs: '72px', md: '92px' },
          },
        }}
        PaperProps={{
          sx: {
            ...(canShowBoard
              ? {
                  background: '#071421',
                  border: `1px solid ${alpha('#1aced6', 0.48)}`,
                  borderRadius: '7px',
                }
              : gameModalPaperSx),
            color: '#f4f6f8',
            display: 'flex',
            height: canShowBoard
              ? { xs: 'calc(100dvh - 84px)', md: 'calc(100dvh - 104px)' }
              : 'auto',
            m: 0,
            maxHeight: {
              xs: 'calc(100dvh - 84px)',
              md: 'calc(100dvh - 104px)',
            },
            overflow: 'hidden',
            width: canShowBoard
              ? 'min(1320px, calc(100vw - 28px))'
              : gameModalPaperSx.width,
          },
        }}
      >
        {match && (
          <>
            <DialogTitle
              sx={{
                flex: '0 0 auto',
                px: canShowBoard
                  ? { xs: 2.5, md: '34px' }
                  : { xs: 2.5, sm: '26px' },
                pb: canShowBoard ? '12px' : '14px',
                pt: canShowBoard
                  ? { xs: 2.5, md: '30px' }
                  : { xs: 2.25, sm: '24px' },
              }}
            >
              <Box sx={{ alignItems: 'center', display: 'flex' }}>
                <SportsEsportsRoundedIcon
                  sx={{ color: '#22d8e4', height: 18, mr: '10px', width: 18 }}
                />
                <Typography
                  component="div"
                  sx={{
                    fontSize: canShowBoard ? 21 : 19,
                    fontWeight: 700,
                    letterSpacing: '-0.015em',
                    lineHeight: '26px',
                  }}
                >
                  Qonnect Four
                </Typography>
                <Box sx={{ flex: 1 }} />
                {canShowBoard && (
                  <Tooltip
                    title={muted ? 'Turn game sounds on' : 'Mute game sounds'}
                  >
                    <IconButton
                      aria-label={
                        muted ? 'Turn game sounds on' : 'Mute game sounds'
                      }
                      onClick={toggleMuted}
                      size="small"
                      sx={{ color: '#8d99a8' }}
                    >
                      {muted ? (
                        <VolumeOffRoundedIcon fontSize="small" />
                      ) : (
                        <VolumeUpRoundedIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
              {liveMessage && (canShowBoard || match.phase !== 'finished') && (
                <Typography
                  aria-live="polite"
                  sx={{
                    color: ['active', 'reconnecting'].includes(match.phase)
                      ? '#22d8e4'
                      : '#f4f6f8',
                    fontSize: 18,
                    fontWeight: 700,
                    lineHeight: '22px',
                    mt: '9px',
                  }}
                >
                  {liveMessage.replace(/\.$/, '')}
                </Typography>
              )}
              {!canShowBoard && <Box aria-hidden sx={gameModalDividerSx} />}
            </DialogTitle>

            <DialogContent
              sx={{
                alignContent: canShowBoard ? undefined : 'center',
                alignItems: canShowBoard ? undefined : 'center',
                display: 'grid',
                flex: '1 1 auto',
                gap: '24px',
                gridTemplateColumns: canShowChat
                  ? { xs: '1fr', lg: 'minmax(0, 1fr) clamp(300px, 27%, 380px)' }
                  : '1fr',
                gridTemplateRows: {
                  xs: 'auto',
                  lg: canShowBoard ? 'minmax(0, 1fr)' : 'auto',
                },
                justifyItems: canShowBoard ? undefined : 'center',
                minHeight: 0,
                overflowX: 'hidden',
                overflowY: { xs: 'auto', lg: 'hidden' },
                px: canShowBoard
                  ? { xs: 2.5, md: '34px' }
                  : { xs: 2.5, sm: '26px' },
                pb: canShowBoard ? '10px !important' : '20px !important',
                pt: canShowBoard ? '0 !important' : '4px !important',
              }}
            >
              <Box
                aria-live="polite"
                sx={{
                  height: 0,
                  overflow: 'hidden',
                  position: 'absolute',
                  width: 0,
                }}
              >
                {liveMessage}
              </Box>
              <Box
                sx={{
                  height: canShowBoard ? '100%' : 'auto',
                  minHeight: 0,
                  minWidth: 0,
                  textAlign: canShowBoard ? undefined : 'center',
                  width: canShowBoard ? '100%' : '100%',
                }}
              >
                {match.phase === 'opening' && (
                  <Stack alignItems="center" spacing={2} sx={{ py: 1 }}>
                    <Typography sx={{ fontSize: 17, fontWeight: 750 }}>
                      Preparing the game...
                    </Typography>
                    <Typography
                      sx={{ color: alpha('#fff', 0.62), fontSize: 13 }}
                    >
                      Getting everything ready for {opponentName}.
                    </Typography>
                    <LinearProgress />
                  </Stack>
                )}

                {match.phase === 'waiting' && (
                  <Stack alignItems="center" spacing={2} sx={{ py: 1 }}>
                    <Typography sx={{ fontSize: 17, fontWeight: 750 }}>
                      Invitation sent
                    </Typography>
                    <Typography sx={{ color: alpha('#fff', 0.7) }}>
                      Waiting for {opponentName} to respond…
                    </Typography>
                    <Typography variant="caption">
                      The invitation expires automatically after 60 seconds.
                    </Typography>
                    <LinearProgress />
                  </Stack>
                )}

                {match.phase === 'round-waiting' && (
                  <Stack alignItems="center" spacing={2} sx={{ py: 1 }}>
                    <Typography sx={{ fontSize: 17, fontWeight: 750 }}>
                      Rematch requested
                    </Typography>
                    <Typography sx={{ color: alpha('#fff', 0.7) }}>
                      Waiting for {opponentName} to accept another game…
                    </Typography>
                    <LinearProgress />
                  </Stack>
                )}

                {(match.phase === 'incoming' ||
                  match.phase === 'round-incoming') && (
                  <Stack alignItems="center" spacing={2} sx={{ py: 1 }}>
                    <Box
                      sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          background: `linear-gradient(135deg,${alpha('#2cf8ff', 0.42)},${alpha('#9d6cff', 0.5)})`,
                          border: `1px solid ${alpha('#fff', 0.28)}`,
                          borderRadius: '50%',
                          display: 'flex',
                          fontSize: 20,
                          fontWeight: 900,
                          height: 52,
                          justifyContent: 'center',
                          width: 52,
                        }}
                      >
                        {playerInitial(requesterLabel)}
                      </Box>
                      <Box>
                        <Typography sx={{ fontSize: 17, fontWeight: 800 }}>
                          {requesterLabel}
                        </Typography>
                        <Typography
                          sx={{ color: alpha('#fff', 0.62), fontSize: 12 }}
                        >
                          {shortAddress(match.requesterAddress)}
                        </Typography>
                      </Box>
                    </Box>
                    <Typography>
                      {match.phase === 'round-incoming'
                        ? 'Would like to play another Qonnect Four game.'
                        : 'Invited you to a private Qonnect Four game.'}
                    </Typography>
                    {match.phase === 'incoming' && (
                      <Typography
                        sx={{ color: '#9ffcff', fontSize: 13, fontWeight: 750 }}
                      >
                        Expires in{' '}
                        {Math.max(
                          0,
                          Math.ceil(((match.expiresAt || now) - now) / 1000)
                        )}{' '}
                        seconds
                      </Typography>
                    )}
                  </Stack>
                )}

                {match.phase === 'starting' && (
                  <Stack alignItems="center" spacing={2} sx={{ py: 1 }}>
                    <Typography sx={{ fontSize: 17, fontWeight: 750 }}>
                      Starting Qonnect Four...
                    </Typography>
                    <LinearProgress />
                  </Stack>
                )}

                {canShowBoard && state && localSeat && (
                  <Box
                    sx={{
                      backgroundColor: 'rgba(5, 18, 31, 0.38)',
                      border: `1px solid ${alpha('#63869d', 0.28)}`,
                      borderRadius: '8px',
                      display: 'grid',
                      gridTemplateRows: '54px minmax(0, 1fr) 54px',
                      height: '100%',
                      minHeight: 0,
                      minWidth: 0,
                      overflow: 'hidden',
                      p: '20px 28px 18px',
                      position: 'relative',
                    }}
                  >
                    {match.phase === 'reconnecting' && (
                      <Typography
                        sx={{
                          border: 0,
                          clip: 'rect(0 0 0 0)',
                          height: 1,
                          margin: -1,
                          overflow: 'hidden',
                          padding: 0,
                          position: 'absolute',
                          whiteSpace: 'nowrap',
                          width: 1,
                        }}
                      >
                        Game paused
                      </Typography>
                    )}
                    <Stack
                      alignItems="center"
                      direction="row"
                      spacing={1.25}
                      sx={{ minWidth: 0 }}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          backgroundColor: alpha(
                            PLAYER_COLORS[localSeat === 1 ? 2 : 1],
                            0.2
                          ),
                          border: `2px solid ${PLAYER_COLORS[localSeat === 1 ? 2 : 1]}`,
                          borderRadius: '50%',
                          display: 'flex',
                          flex: '0 0 auto',
                          fontSize: 12,
                          fontWeight: 800,
                          height: 30,
                          justifyContent: 'center',
                          width: 30,
                        }}
                      >
                        {playerInitial(opponentName)}
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          noWrap
                          sx={{
                            fontSize: 15,
                            fontWeight: 700,
                            lineHeight: '19px',
                          }}
                        >
                          {opponentName}
                        </Typography>
                        <Typography
                          sx={{
                            color: '#8d99a8',
                            fontSize: 12,
                            lineHeight: '16px',
                          }}
                        >
                          {localSeat === 1 ? 'Coral' : 'Gold'}
                        </Typography>
                      </Box>
                    </Stack>

                    {match.phase === 'reconnecting' && (
                      <Alert
                        severity="warning"
                        sx={{
                          '& .MuiAlert-message': { width: '100%' },
                          left: '50%',
                          position: 'absolute',
                          top: 72,
                          transform: 'translateX(-50%)',
                          width: 'min(92%, 620px)',
                          zIndex: 5,
                        }}
                      >
                        <Typography sx={{ fontSize: 13, fontWeight: 800 }}>
                          Connection interrupted — reconnecting (
                          {Math.max(
                            0,
                            Math.ceil(
                              ((match.reconnectDeadline || now) - now) / 1000
                            )
                          )}
                          s)
                        </Typography>
                        <Typography sx={{ fontSize: 11 }}>
                          The board is paused and will resume only if both
                          states match.
                        </Typography>
                      </Alert>
                    )}

                    <Box
                      ref={boardAreaRef}
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        justifyContent: 'center',
                        minHeight: 0,
                        minWidth: 0,
                        overflow: 'hidden',
                      }}
                    >
                      <Box
                        key={shakeNonce}
                        sx={{
                          '@keyframes qlBoardShake': {
                            '0%,100%': { transform: 'translateX(0)' },
                            '25%': { transform: 'translateX(-5px)' },
                            '75%': { transform: 'translateX(5px)' },
                          },
                          '@keyframes qlPieceDrop': {
                            from: {
                              opacity: 0.2,
                              transform: 'translateY(-280%) scale(.88)',
                            },
                            to: {
                              opacity: 1,
                              transform: 'translateY(0) scale(1)',
                            },
                          },
                          '@keyframes qlWinPulse': {
                            '0%,100%': {
                              boxShadow:
                                '0 0 0 2px rgba(255,255,255,.6),0 0 12px rgba(255,255,255,.25)',
                            },
                            '50%': {
                              boxShadow:
                                '0 0 0 4px #fff,0 0 26px rgba(255,255,255,.85)',
                            },
                          },
                          animation:
                            shakeNonce && !reducedMotion
                              ? 'qlBoardShake 220ms ease-out'
                              : 'none',
                          aspectRatio: `${CONNECT_FOUR_COLUMNS} / ${CONNECT_FOUR_ROWS}`,
                          background: 'linear-gradient(150deg,#1670ca,#0d3f89)',
                          border: `1px solid ${alpha('#75c9ff', 0.46)}`,
                          borderRadius: 2.5,
                          boxShadow: `inset 0 3px 14px ${alpha('#fff', 0.09)},0 12px 30px ${alpha('#000', 0.35)}`,
                          boxSizing: 'border-box',
                          maxWidth: '100%',
                          p: 1,
                          position: 'relative',
                          width: boardWidth ? `${boardWidth}px` : '100%',
                        }}
                      >
                        <Box
                          role="grid"
                          aria-label="Qonnect Four board"
                          sx={{
                            display: 'grid',
                            gap: { xs: 0.45, sm: 0.7 },
                            gridTemplateColumns: 'repeat(7,1fr)',
                          }}
                        >
                          {Array.from(
                            {
                              length: CONNECT_FOUR_COLUMNS * CONNECT_FOUR_ROWS,
                            },
                            (_, displayIndex) => {
                              const displayRow = Math.floor(
                                displayIndex / CONNECT_FOUR_COLUMNS
                              );
                              const column =
                                displayIndex % CONNECT_FOUR_COLUMNS;
                              const internalRow =
                                CONNECT_FOUR_ROWS - 1 - displayRow;
                              const internalIndex =
                                internalRow * CONNECT_FOUR_COLUMNS + column;
                              const cell = state.board[internalIndex] || 0;
                              const isLast =
                                lastMove?.column === column &&
                                lastRow === internalRow;
                              const isPending =
                                isLast &&
                                lastMove?.messageId === match.pendingMoveId;
                              const isWinner = winningCells.has(internalIndex);
                              const isPreview =
                                !cell &&
                                focusedColumn === column &&
                                previewRow === internalRow;
                              const renderedSeat = (cell ||
                                (isPreview ? localSeat : 0)) as
                                | 0
                                | ConnectFourSeat;
                              const spaces = availableSpaces(state, column);
                              return (
                                <Box
                                  aria-label={`Column ${column + 1}, row ${displayRow + 1}, ${cell ? `${cell === localSeat ? 'your' : 'opponent'} piece` : 'empty'}`}
                                  key={displayIndex}
                                  role="gridcell"
                                  sx={{
                                    aspectRatio: '1',
                                    backgroundColor: '#071426',
                                    border: `2px solid ${alpha('#fff', 0.14)}`,
                                    borderRadius: '50%',
                                    boxShadow: `inset 0 4px 10px ${alpha('#000', 0.75)}`,
                                    overflow: 'visible',
                                    position: 'relative',
                                  }}
                                >
                                  {renderedSeat !== 0 && (
                                    <Box
                                      sx={{
                                        animation: reducedMotion
                                          ? 'none'
                                          : isWinner
                                            ? 'qlWinPulse 900ms ease-in-out infinite'
                                            : isLast && !isPreview
                                              ? 'qlPieceDrop 430ms cubic-bezier(.22,.78,.24,1.1)'
                                              : 'none',
                                        backgroundColor:
                                          PLAYER_COLORS[renderedSeat],
                                        backgroundImage:
                                          renderedSeat === 1
                                            ? 'repeating-linear-gradient(45deg,rgba(255,255,255,.2) 0 3px,transparent 3px 8px)'
                                            : 'radial-gradient(circle at 35% 35%,rgba(255,255,255,.32) 0 2px,transparent 3px)',
                                        border: `2px solid ${alpha('#fff', isPreview ? 0.36 : 0.64)}`,
                                        borderRadius: '50%',
                                        boxShadow: isLast
                                          ? `0 0 0 3px ${alpha('#2cf8ff', 0.8)},0 0 15px ${alpha('#2cf8ff', 0.45)}`
                                          : `inset 0 -5px 9px ${alpha('#000', 0.24)}`,
                                        inset: 3,
                                        opacity: isPreview
                                          ? 0.36
                                          : isPending
                                            ? 0.76
                                            : 1,
                                        position: 'absolute',
                                      }}
                                    />
                                  )}
                                  {isPending && (
                                    <Box
                                      aria-hidden
                                      sx={{
                                        border: '2px dashed #fff',
                                        borderRadius: '50%',
                                        inset: 0,
                                        position: 'absolute',
                                        animation: 'spin 900ms linear infinite',
                                        '@keyframes spin': {
                                          to: { transform: 'rotate(360deg)' },
                                        },
                                      }}
                                    />
                                  )}
                                  {displayRow === 0 && (
                                    <Box
                                      aria-disabled={!localTurn}
                                      aria-label={`Play column ${column + 1}, ${spaces} ${spaces === 1 ? 'space' : 'spaces'} available`}
                                      component="button"
                                      disabled={!localTurn}
                                      onBlur={() =>
                                        setFocusedColumn((value) =>
                                          value === column ? null : value
                                        )
                                      }
                                      onClick={() => void attemptColumn(column)}
                                      onFocus={() => setFocusedColumn(column)}
                                      onMouseEnter={() =>
                                        setFocusedColumn(column)
                                      }
                                      onMouseLeave={() =>
                                        setFocusedColumn((value) =>
                                          value === column &&
                                          document.activeElement !==
                                            columnRefs.current[column]
                                            ? null
                                            : value
                                        )
                                      }
                                      ref={(
                                        element: HTMLButtonElement | null
                                      ) => {
                                        columnRefs.current[column] = element;
                                      }}
                                      sx={{
                                        background: 'transparent',
                                        border: 0,
                                        borderRadius: 2,
                                        bottom: {
                                          xs: `calc(-${(CONNECT_FOUR_ROWS - 1) * 100}% - ${(CONNECT_FOUR_ROWS - 1) * 3.6}px)`,
                                          sm: `calc(-${(CONNECT_FOUR_ROWS - 1) * 100}% - ${(CONNECT_FOUR_ROWS - 1) * 5.6}px)`,
                                        },
                                        cursor: localTurn
                                          ? 'pointer'
                                          : 'default',
                                        left: -3,
                                        outline: 'none',
                                        position: 'absolute',
                                        right: -3,
                                        top: -3,
                                        zIndex: 3,
                                        '&:focus-visible': {
                                          boxShadow:
                                            '0 0 0 3px #fff,0 0 0 6px #2cf8ff',
                                        },
                                      }}
                                    />
                                  )}
                                </Box>
                              );
                            }
                          )}
                        </Box>
                      </Box>
                    </Box>

                    <Typography
                      aria-live="polite"
                      data-testid="connect-four-board-status"
                      noWrap
                      sx={{
                        border: 0,
                        clip: 'rect(0 0 0 0)',
                        height: 1,
                        lineHeight: '15px',
                        margin: -1,
                        minHeight: '15px',
                        overflow: 'hidden',
                        padding: 0,
                        position: 'absolute',
                        whiteSpace: 'nowrap',
                        width: 1,
                      }}
                    >
                      {match.pendingMoveId
                        ? 'Move placed — waiting for confirmation…'
                        : state.ply === 0
                          ? 'The starting player was selected fairly from both players’ private nonces.'
                          : '\u00a0'}
                    </Typography>
                    <Stack
                      alignItems="center"
                      direction="row"
                      spacing={1.25}
                      sx={{ minWidth: 0 }}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          backgroundColor: alpha(PLAYER_COLORS[localSeat], 0.2),
                          border: `2px solid ${PLAYER_COLORS[localSeat]}`,
                          borderRadius: '50%',
                          display: 'flex',
                          flex: '0 0 auto',
                          fontSize: 12,
                          fontWeight: 800,
                          height: 30,
                          justifyContent: 'center',
                          width: 30,
                        }}
                      >
                        {playerInitial('You')}
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          noWrap
                          sx={{
                            fontSize: 15,
                            fontWeight: 700,
                            lineHeight: '19px',
                          }}
                        >
                          You
                        </Typography>
                        <Typography
                          sx={{
                            color: '#8d99a8',
                            fontSize: 12,
                            lineHeight: '16px',
                          }}
                        >
                          {localSeat === 1 ? 'Gold' : 'Coral'}
                        </Typography>
                      </Box>
                    </Stack>
                    {match.outcome && (
                      <Box
                        aria-live="assertive"
                        role="status"
                        sx={{
                          '@keyframes connectFourResultReveal': {
                            '0%': {
                              opacity: 0,
                              transform: 'translate(-50%, -44%) scale(0.86)',
                            },
                            '65%': {
                              opacity: 1,
                              transform: 'translate(-50%, -50%) scale(1.04)',
                            },
                            '100%': {
                              opacity: 1,
                              transform: 'translate(-50%, -50%) scale(1)',
                            },
                          },
                          animation:
                            'connectFourResultReveal 620ms ease-out both',
                          backgroundColor: alpha('#071421', 0.92),
                          border: `1px solid ${alpha('#22d8e4', 0.58)}`,
                          borderRadius: '10px',
                          boxShadow: `0 0 24px ${alpha('#22d8e4', 0.2)}`,
                          left: '50%',
                          px: 3,
                          py: 1.4,
                          position: 'absolute',
                          top: '50%',
                          transform: 'translate(-50%, -50%)',
                          zIndex: 4,
                        }}
                      >
                        <Typography
                          sx={{
                            color: '#f4f6f8',
                            fontSize: 24,
                            fontWeight: 700,
                            lineHeight: 1.2,
                            textAlign: 'center',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {resultAnnouncement}
                        </Typography>
                        <Typography
                          sx={{
                            color: '#8d99a8',
                            fontSize: 13,
                            fontWeight: 500,
                            mt: 0.5,
                            textAlign: 'center',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {resultSubtitle}
                        </Typography>
                        <Typography
                          sx={{
                            border: 0,
                            clip: 'rect(0 0 0 0)',
                            height: 1,
                            margin: -1,
                            overflow: 'hidden',
                            padding: 0,
                            position: 'absolute',
                            whiteSpace: 'nowrap',
                            width: 1,
                          }}
                        >
                          {state.ply} moves against {opponentName}
                        </Typography>
                      </Box>
                    )}
                    {match.error && (
                      <Alert
                        severity="error"
                        sx={{
                          bottom: 60,
                          left: '50%',
                          position: 'absolute',
                          transform: 'translateX(-50%)',
                          width: 'min(92%, 620px)',
                          zIndex: 5,
                        }}
                      >
                        {friendlyGameStatus(match.error)}
                      </Alert>
                    )}
                  </Box>
                )}

                {match.phase === 'finished' && !state && (
                  <Stack alignItems="center" spacing={0.75}>
                    <Typography
                      sx={{
                        fontSize: 18,
                        fontWeight: 700,
                        textAlign: 'center',
                      }}
                    >
                      Game ended
                    </Typography>
                    {match.error && (
                      <Typography
                        sx={{
                          color: '#8d99a8',
                          fontSize: 14,
                          fontWeight: 500,
                          textAlign: 'center',
                        }}
                      >
                        {friendlyGameStatus(match.error)}
                      </Typography>
                    )}
                  </Stack>
                )}
              </Box>
              {canShowChat && (
                <GameSessionChat
                  address={address}
                  disabled={
                    !transportReady ||
                    match.phase === 'reconnecting' ||
                    match.sessionClosed === true
                  }
                  messages={match.chatMessages}
                  onSend={onSendChat}
                  onTyping={onTyping}
                  opponentName={opponentName}
                  remoteTyping={Boolean(
                    match.remoteTypingUntil && match.remoteTypingUntil > now
                  )}
                  variant="chess"
                />
              )}
            </DialogContent>

            <DialogActions
              sx={
                canShowBoard
                  ? {
                      flex: '0 0 auto',
                      minHeight: 42,
                      px: { xs: 2.5, md: '34px' },
                      pb: '14px',
                      pt: 0,
                    }
                  : gameModalActionsSx
              }
            >
              {(match.phase === 'incoming' ||
                match.phase === 'round-incoming') && (
                <>
                  <Button
                    onClick={() => onRespond(false)}
                    sx={gameModalSecondaryButtonSx}
                  >
                    Decline
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => onRespond(true)}
                    sx={gameModalPrimaryButtonSx}
                  >
                    Accept
                  </Button>
                </>
              )}
              {(match.phase === 'opening' ||
                match.phase === 'waiting' ||
                match.phase === 'round-waiting') && (
                <Button onClick={onClose} sx={gameModalSecondaryButtonSx}>
                  Cancel
                </Button>
              )}
              {match.phase === 'active' && (
                <Button
                  onClick={() => setResignConfirmationOpen(true)}
                  sx={{
                    background: 'transparent',
                    color: '#ff4e4e',
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    p: 1,
                  }}
                >
                  RESIGN
                </Button>
              )}
              {match.phase === 'finished' && (
                <>
                  {state && opponentAddress && (
                    <Button
                      aria-label="Play again"
                      disabled={!transportReady || match.sessionClosed === true}
                      startIcon={<ReplayRoundedIcon />}
                      onClick={onRematch}
                      variant="contained"
                      sx={{
                        '@keyframes connectFourRematchPulse': {
                          '0%, 100%': {
                            boxShadow: `0 0 0 0 ${alpha('#22d8e4', 0.08)}`,
                          },
                          '50%': {
                            boxShadow: `0 0 14px 3px ${alpha('#22d8e4', 0.32)}`,
                          },
                        },
                        animation:
                          'connectFourRematchPulse 1.8s ease-in-out infinite',
                      }}
                    >
                      Rematch
                    </Button>
                  )}
                  <Button
                    onClick={onClose}
                    sx={canShowBoard ? undefined : gameModalSecondaryButtonSx}
                  >
                    Close
                  </Button>
                </>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
      <Dialog
        open={resignConfirmationOpen}
        onClose={() => setResignConfirmationOpen(false)}
        aria-labelledby="connect-four-resign-title"
        PaperProps={{ sx: gameModalPaperSx }}
      >
        <DialogTitle
          id="connect-four-resign-title"
          sx={{
            px: { xs: 2.5, sm: '26px' },
            pb: '14px',
            pt: { xs: 2.25, sm: '24px' },
          }}
        >
          <Typography sx={{ fontSize: 19, fontWeight: 700 }}>
            Resign this game?
          </Typography>
          <Box aria-hidden sx={gameModalDividerSx} />
        </DialogTitle>
        <DialogActions sx={gameModalActionsSx}>
          <Button
            onClick={() => setResignConfirmationOpen(false)}
            sx={gameModalSecondaryButtonSx}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            sx={gameModalDangerButtonSx}
            onClick={() => {
              setResignConfirmationOpen(false);
              onResign();
            }}
          >
            Resign
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

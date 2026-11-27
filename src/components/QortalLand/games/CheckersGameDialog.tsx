import SportsEsportsRoundedIcon from '@mui/icons-material/SportsEsportsRounded';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
  alpha,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import {
  checkersPieceSeat,
  getCheckersLegalMoves,
  isCheckersKing,
  type CheckersMove,
  type CheckersOutcome,
  type CheckersPiece,
  type CheckersState,
} from './checkers';
import { GameSessionChat } from './GameSessionChat';
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
import type { QortalLandGameMatchView } from './useQortalLandGame';

type Props = {
  address: string;
  match: QortalLandGameMatchView | null;
  now: number;
  transportReady: boolean;
  onClose: () => void;
  onPlayMove: (from: number, path: number[]) => Promise<boolean>;
  onRematch: () => void;
  onResign: () => void;
  onRespond: (accepted: boolean) => void;
  onSendChat: (text: string) => boolean;
  onTyping: (active: boolean) => void;
  resolvePlayerName?: (address: string) => string;
};

const shortAddress = (value: string) =>
  value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;

const outcomeText = (
  outcome: CheckersOutcome | undefined,
  localSeat?: 1 | 2
) => {
  if (!outcome) return 'Game ended';
  if (outcome.type === 'draw') return 'Draw game';
  if (outcome.type === 'abandoned') return 'Game abandoned';
  if (outcome.type === 'protocol-error') return 'Game ended safely';
  return outcome.winner === localSeat ? 'You won!' : 'You lost!';
};

function CheckersPlayerRow({ color, name }: { color: string; name: string }) {
  return (
    <Stack
      alignItems="center"
      direction="row"
      spacing={1.25}
      sx={{ minWidth: 0 }}
    >
      <Box
        sx={{
          backgroundColor: color,
          border: `2px solid ${alpha('#fff', 0.72)}`,
          borderRadius: '50%',
          boxShadow: `0 1px 5px ${alpha('#000', 0.42)}`,
          flex: '0 0 auto',
          height: 19,
          width: 19,
        }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography
          noWrap
          sx={{ fontSize: 15, fontWeight: 700, lineHeight: '19px' }}
        >
          {name}
        </Typography>
        <Typography sx={{ color: '#8d99a8', fontSize: 12, lineHeight: '16px' }}>
          {color === '#eab72f' ? 'Gold' : 'Coral'}
        </Typography>
      </Box>
    </Stack>
  );
}

export function CheckersGameDialog({
  address,
  match,
  now,
  transportReady,
  onClose,
  onPlayMove,
  onRematch,
  onResign,
  onRespond,
  onSendChat,
  onTyping,
  resolvePlayerName,
}: Props) {
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null);
  const [selectedPath, setSelectedPath] = useState<number[]>([]);
  const [selectionHint, setSelectionHint] = useState('');
  const [resignConfirmationOpen, setResignConfirmationOpen] = useState(false);
  const state = match?.state as CheckersState | undefined;
  const localSeat = match?.localSeat;
  const opponentAddress = match
    ? match.requesterAddress === address
      ? match.recipientAddress
      : match.requesterAddress
    : '';
  const opponentName = opponentAddress
    ? resolvePlayerName?.(opponentAddress) ||
      (match?.requesterAddress === opponentAddress
        ? match.requesterName
        : match?.recipientName) ||
      shortAddress(opponentAddress)
    : '';
  const localTurn = Boolean(
    match?.phase === 'active' &&
    state &&
    localSeat &&
    state.nextSeat === localSeat &&
    !match.pendingMoveId
  );
  const legalMoves = useMemo(
    () =>
      state && localSeat && localTurn
        ? getCheckersLegalMoves(state, localSeat)
        : [],
    [localSeat, localTurn, state]
  );
  const movablePieces = useMemo(
    () => new Set(legalMoves.map((move) => move.from)),
    [legalMoves]
  );
  const candidates =
    selectedFrom === null
      ? []
      : legalMoves.filter(
          (move) =>
            move.from === selectedFrom &&
            selectedPath.every((square, index) => move.path[index] === square)
        );
  const nextSquares = new Set(
    candidates
      .map((move) => move.path[selectedPath.length])
      .filter((value) => value !== undefined)
  );
  const capturedSquares = useMemo(() => {
    if (selectedFrom === null || !selectedPath.length) return new Set<number>();
    const result = new Set<number>();
    let from = selectedFrom;
    selectedPath.forEach((to) => {
      if (Math.abs(Math.floor(to / 8) - Math.floor(from / 8)) === 2)
        result.add((from + to) / 2);
      from = to;
    });
    return result;
  }, [selectedFrom, selectedPath]);
  const previewPosition = selectedPath.at(-1);
  const previewPiece = useMemo<CheckersPiece>(() => {
    if (selectedFrom === null || previewPosition === undefined || !state)
      return 0;
    const piece = state.board[selectedFrom];
    if (piece === 1 && Math.floor(previewPosition / 8) === 0) return 3;
    if (piece === 2 && Math.floor(previewPosition / 8) === 7) return 4;
    return piece;
  }, [previewPosition, selectedFrom, state]);

  useEffect(() => {
    setSelectedFrom(null);
    setSelectedPath([]);
    setSelectionHint('');
  }, [state?.ply, localTurn]);

  if (!match) return null;
  const expiresIn = Math.max(
    0,
    Math.ceil(((match.expiresAt || now) - now) / 1000)
  );
  const reconnectIn = Math.max(
    0,
    Math.ceil(((match.reconnectDeadline || now) - now) / 1000)
  );
  const canShowBoard = Boolean(
    state &&
    ['active', 'finishing', 'reconnecting', 'finished'].includes(match.phase)
  );
  const canShowChat = Boolean(state);
  const hasCapture = legalMoves.some((move) => move.captured.length > 0);
  const displayIndexes =
    localSeat === 2
      ? Array.from({ length: 64 }, (_, index) => 63 - index)
      : Array.from({ length: 64 }, (_, index) => index);

  const selectSquare = async (index: number) => {
    if (!localTurn || !state || !localSeat) return;
    const ownPiece = checkersPieceSeat(state.board[index]) === localSeat;
    if (selectedPath.length === 0 && ownPiece) {
      if (index === selectedFrom) {
        setSelectedFrom(null);
        setSelectionHint('');
      } else if (movablePieces.has(index)) {
        setSelectedFrom(index);
        setSelectionHint('');
      } else {
        setSelectionHint(
          hasCapture
            ? 'A highlighted piece must make the available capture.'
            : 'That piece has no legal move right now.'
        );
      }
      return;
    }
    if (!nextSquares.has(index)) {
      setSelectedFrom(movablePieces.has(index) ? index : null);
      setSelectedPath([]);
      setSelectionHint('');
      return;
    }
    const path = [...selectedPath, index];
    const matching = candidates.filter(
      (move) => move.path[path.length - 1] === index
    );
    const complete = matching.find((move) => move.path.length === path.length);
    const continues = matching.some((move) => move.path.length > path.length);
    if (complete && !continues) {
      setSelectedFrom(null);
      setSelectedPath([]);
      setSelectionHint('');
      await onPlayMove(selectedFrom, path);
    } else {
      setSelectedPath(path);
    }
  };

  const resolvedOutcome = (match.outcome || state?.outcome) as
    | CheckersOutcome
    | undefined;
  const turnStatus = resolvedOutcome
    ? outcomeText(resolvedOutcome, localSeat)
    : match.phase === 'reconnecting'
      ? `Reconnecting (${reconnectIn}s)`
      : match.phase === 'finishing'
        ? 'Finishing game...'
        : localTurn
          ? 'Your turn'
          : state
            ? `${opponentName}'s turn`
            : '';
  const resultAnnouncement = resolvedOutcome
    ? resolvedOutcome.type === 'draw'
      ? 'Draw'
      : 'winner' in resolvedOutcome
        ? resolvedOutcome.winner === localSeat
          ? 'You won!'
          : 'You lost!'
        : 'Game over'
    : '';
  const resultSubtitle = resolvedOutcome
    ? resolvedOutcome.type === 'draw'
      ? 'Want another round?'
      : 'winner' in resolvedOutcome && resolvedOutcome.winner === localSeat
        ? 'Best out of 3?'
        : 'Better luck next time.'
    : '';
  const localColor = localSeat === 1 ? '#eab72f' : '#d93659';
  const opponentColor = localSeat === 1 ? '#d93659' : '#eab72f';

  if (match.phase === 'waiting') {
    return (
      <GameInvitationSentDialog
        expiresAt={match.expiresAt}
        gameTitle="Checkers"
        now={now}
        onCancel={onClose}
        opponentName={opponentName}
      />
    );
  }

  return (
    <>
      <Dialog
        open={match.phase !== 'session-idle'}
        disableEscapeKeyDown={match.phase !== 'finished'}
        onClose={(_, reason) => {
          if (reason !== 'backdropClick' && match.phase === 'finished')
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
              sx={{
                fontSize: canShowBoard ? 21 : 19,
                fontWeight: 700,
                letterSpacing: '-0.015em',
                lineHeight: '26px',
              }}
            >
              Checkers
            </Typography>
          </Box>
          {turnStatus && (canShowBoard || match.phase !== 'finished') && (
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
              {turnStatus}
            </Typography>
          )}
          {!canShowBoard && <Box aria-hidden sx={gameModalDividerSx} />}
        </DialogTitle>
        <DialogContent
          sx={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            justifyContent: canShowBoard ? undefined : 'center',
            minHeight: 0,
            overflow: 'hidden',
            px: canShowBoard
              ? { xs: 2.5, md: '34px' }
              : { xs: 2.5, sm: '26px' },
            pb: canShowBoard ? '10px !important' : '20px !important',
            pt: canShowBoard ? '0 !important' : '4px !important',
          }}
        >
          {match.error && canShowBoard && (
            <Alert severity="warning" sx={{ flex: '0 0 auto', mb: 1 }}>
              {friendlyGameStatus(match.error)}
            </Alert>
          )}
          {!canShowBoard && (
            <Box
              sx={{
                alignSelf: 'center',
                minHeight: 0,
                overflowY: 'auto',
                py: 1,
                textAlign: 'center',
                width: '100%',
              }}
            >
              {match.phase === 'opening' && (
                <>
                  <Typography>Preparing the Checkers game…</Typography>
                  <LinearProgress sx={{ mt: 2 }} />
                </>
              )}
              {match.phase === 'waiting' && (
                <>
                  <Typography>
                    Waiting for {opponentName || 'the other player'} to respond…
                  </Typography>
                  <LinearProgress sx={{ mt: 2 }} />
                </>
              )}
              {match.phase === 'round-waiting' && (
                <>
                  <Typography>
                    Waiting for {opponentName} to accept Checkers…
                  </Typography>
                  <LinearProgress sx={{ mt: 2 }} />
                </>
              )}
              {(match.phase === 'incoming' ||
                match.phase === 'round-incoming') && (
                <Stack alignItems="center" spacing={1.5}>
                  <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
                    {match.phase === 'round-incoming'
                      ? `${opponentName} would like to play Checkers.`
                      : `${resolvePlayerName?.(match.requesterAddress) || match.requesterName || shortAddress(match.requesterAddress)} invited you to Checkers.`}
                  </Typography>
                  {match.phase === 'incoming' && (
                    <Typography
                      sx={{ color: alpha('#fff', 0.6), fontSize: 13 }}
                    >
                      Invitation expires in {expiresIn}s
                    </Typography>
                  )}
                </Stack>
              )}
              {match.phase === 'starting' && (
                <>
                  <Typography>Starting Checkers…</Typography>
                  <LinearProgress sx={{ mt: 2 }} />
                </>
              )}
              {match.phase === 'finished' && (
                <Stack alignItems="center" spacing={0.75}>
                  <Typography
                    sx={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }}
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
          )}
          {canShowBoard && state && (
            <Box
              sx={{
                display: 'grid',
                flex: 1,
                gap: '24px',
                gridTemplateColumns: canShowChat
                  ? { xs: '1fr', lg: 'minmax(0, 1fr) clamp(300px, 27%, 380px)' }
                  : '1fr',
                minHeight: 0,
                overflowX: 'hidden',
                overflowY: { xs: 'auto', lg: 'hidden' },
                pb: 0.5,
              }}
            >
              <Box
                sx={{
                  backgroundColor: 'rgba(5, 18, 31, 0.38)',
                  border: `1px solid ${alpha('#63869d', 0.28)}`,
                  borderRadius: '8px',
                  display: 'grid',
                  gridTemplateRows: '54px minmax(0, 1fr) 54px',
                  minHeight: 0,
                  minWidth: 0,
                  overflow: 'hidden',
                  p: '20px 28px 18px',
                  position: 'relative',
                }}
              >
                <CheckersPlayerRow color={opponentColor} name={opponentName} />
                <Typography
                  aria-live="polite"
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
                  {selectionHint ||
                    (hasCapture
                      ? 'Capture required'
                      : match.pendingMoveId
                        ? 'Confirming move…'
                        : selectedFrom !== null
                          ? 'Choose a highlighted square or another piece'
                          : 'Select a piece')}
                </Typography>
                <Box
                  sx={{
                    alignItems: 'center',
                    containerType: 'size',
                    display: 'flex',
                    justifyContent: 'center',
                    minHeight: 0,
                    minWidth: 0,
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    aria-label="Checkers board"
                    role="grid"
                    sx={{
                      aspectRatio: '1 / 1',
                      contain: 'layout paint',
                      display: 'grid',
                      flex: '0 0 auto',
                      gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
                      gridTemplateRows: 'repeat(8, minmax(0, 1fr))',
                      maxHeight: 640,
                      maxWidth: 640,
                      overflow: 'hidden',
                      width: 'min(100%, 100cqh, 640px)',
                    }}
                  >
                    {displayIndexes.map((index, displayIndex) => {
                      const piece =
                        index === previewPosition
                          ? previewPiece
                          : index === selectedFrom && selectedPath.length > 0
                            ? 0
                            : state.board[index];
                      const dark =
                        (Math.floor(index / 8) + (index % 8)) % 2 === 1;
                      const selected =
                        index === selectedFrom || selectedPath.includes(index);
                      const destination = nextSquares.has(index);
                      const movable = movablePieces.has(index);
                      const seat = checkersPieceSeat(piece);
                      const ownPiece = seat === localSeat;
                      return (
                        <Box
                          component="button"
                          type="button"
                          role="gridcell"
                          aria-selected={selected}
                          aria-label={`Row ${Math.floor(displayIndex / 8) + 1}, column ${(displayIndex % 8) + 1}${piece ? `, ${seat === localSeat ? 'your' : 'opponent'} ${isCheckersKing(piece) ? 'king' : 'piece'}` : ', empty'}`}
                          disabled={
                            !dark || !localTurn || (!ownPiece && !destination)
                          }
                          key={index}
                          onClick={() => void selectSquare(index)}
                          sx={{
                            alignItems: 'center',
                            background: dark ? '#6e4429' : '#e6c495',
                            border: 0,
                            cursor:
                              movable || destination ? 'pointer' : 'default',
                            display: 'flex',
                            height: '100%',
                            justifyContent: 'center',
                            minHeight: 0,
                            minWidth: 0,
                            padding: '7%',
                            position: 'relative',
                            width: '100%',
                            ...(selected
                              ? { boxShadow: 'inset 0 0 0 4px #2cf8ff' }
                              : {}),
                            ...(destination
                              ? {
                                  '&::after': {
                                    background: alpha('#2cf8ff', 0.7),
                                    borderRadius: '50%',
                                    content: '""',
                                    height: '24%',
                                    position: 'absolute',
                                    width: '24%',
                                  },
                                }
                              : {}),
                          }}
                        >
                          {piece !== 0 && !capturedSquares.has(index) && (
                            <Box
                              sx={{
                                alignItems: 'center',
                                background:
                                  seat === 1
                                    ? 'radial-gradient(circle at 35% 30%, #ffe989, #eab72f)'
                                    : 'radial-gradient(circle at 35% 30%, #ff8198, #d93659)',
                                border: `3px solid ${seat === 1 ? '#fff1a8' : '#ff9caf'}`,
                                borderRadius: '50%',
                                boxShadow: `0 4px 8px ${alpha('#000', 0.45)}`,
                                color: '#4b2b12',
                                display: 'flex',
                                fontSize: 'clamp(12px, 2vw, 26px)',
                                fontWeight: 900,
                                height: '84%',
                                justifyContent: 'center',
                                width: '84%',
                                ...(movable
                                  ? {
                                      outline: `2px solid ${alpha('#2cf8ff', 0.8)}`,
                                      outlineOffset: 2,
                                    }
                                  : {}),
                              }}
                            >
                              {isCheckersKing(piece) ? '♛' : ''}
                            </Box>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
                <CheckersPlayerRow color={localColor} name="You" />
                {resolvedOutcome && (
                  <Box
                    aria-live="assertive"
                    role="status"
                    sx={{
                      '@keyframes checkersResultReveal': {
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
                      animation: 'checkersResultReveal 620ms ease-out both',
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
                  </Box>
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
                  opponentName={opponentName}
                  remoteTyping={Boolean(
                    match.remoteTypingUntil && match.remoteTypingUntil > now
                  )}
                  onSend={onSendChat}
                  onTyping={onTyping}
                  variant="chess"
                />
              )}
            </Box>
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
          {(match.phase === 'incoming' || match.phase === 'round-incoming') && (
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
          {['opening', 'waiting', 'round-waiting'].includes(match.phase) && (
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
              <Button
                onClick={onClose}
                sx={canShowBoard ? undefined : gameModalSecondaryButtonSx}
              >
                Leave
              </Button>
              {state && !match.sessionClosed && (
                <Button
                  variant="contained"
                  onClick={onRematch}
                  sx={{
                    '@keyframes checkersRematchPulse': {
                      '0%, 100%': {
                        boxShadow: `0 0 0 0 ${alpha('#22d8e4', 0.08)}`,
                      },
                      '50%': {
                        boxShadow: `0 0 14px 3px ${alpha('#22d8e4', 0.32)}`,
                      },
                    },
                    animation: 'checkersRematchPulse 1.8s ease-in-out infinite',
                  }}
                >
                  Rematch
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>
      <Dialog
        open={resignConfirmationOpen}
        onClose={() => setResignConfirmationOpen(false)}
        aria-labelledby="checkers-resign-title"
        PaperProps={{ sx: gameModalPaperSx }}
      >
        <DialogTitle
          id="checkers-resign-title"
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

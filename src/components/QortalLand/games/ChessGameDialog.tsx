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
import chessPieceSprite from '../../../assets/chess/cburnett-chess-pieces.svg';
import {
  chessPieceKind,
  chessPieceSeat,
  getChessLegalMoves,
  isChessInCheck,
  otherChessSeat,
  type ChessMove,
  type ChessOutcome,
  type ChessPiece,
  type ChessPromotion,
  type ChessSeat,
  type ChessState,
} from './chess';
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
  onPlayMove: (
    from: number,
    to: number,
    promotion?: ChessPromotion
  ) => Promise<boolean>;
  onRematch: () => void;
  onResign: () => void;
  onRespond: (accepted: boolean) => void;
  onSendChat: (text: string) => boolean;
  onTyping: (active: boolean) => void;
  resolvePlayerName?: (address: string) => string;
};

const PIECE_SPRITE_COLUMN: Record<number, number> = {
  6: 0,
  5: 1,
  3: 2,
  2: 3,
  4: 4,
  1: 5,
};

const ChessPieceGraphic = ({
  color,
  kind,
  size = '88%',
}: {
  color: 'white' | 'black';
  kind: number;
  size?: number | string;
}) => {
  const column = PIECE_SPRITE_COLUMN[kind];
  if (column === undefined) return null;
  return (
    <Box
      aria-hidden="true"
      sx={{
        backgroundImage: `url(${chessPieceSprite})`,
        backgroundPosition: `${column * 20}% ${color === 'white' ? 0 : 100}%`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '600% 200%',
        filter:
          color === 'black'
            ? 'drop-shadow(0 0 1px rgba(211, 231, 244, 0.9)) drop-shadow(0 0 0.5px rgba(211, 231, 244, 0.75))'
            : 'none',
        height: size,
        pointerEvents: 'none',
        width: size,
      }}
    />
  );
};
const shortAddress = (value: string) =>
  value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
const pieceColor = (state: ChessState, piece: ChessPiece) => {
  const seat = chessPieceSeat(piece);
  if (!seat) return null;
  return seat === state.whiteSeat ? 'white' : 'black';
};

const INITIAL_PIECE_COUNTS: Record<number, number> = {
  1: 8,
  2: 2,
  3: 2,
  4: 2,
  5: 1,
};
const PIECE_NAMES: Record<number, string> = {
  1: 'pawn',
  2: 'knight',
  3: 'bishop',
  4: 'rook',
  5: 'queen',
};
const PIECE_VALUES: Record<number, number> = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9 };
const MATERIAL_ORDER = [5, 4, 3, 2, 1] as const;

type CapturedPieces = Record<number, number>;

const emptyCapturedPieces = (): CapturedPieces => ({
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
});

const capturedBySeat = (
  state: ChessState,
  moves: ChessMove[],
  capturer: ChessSeat
): CapturedPieces => {
  if (state.ply === 0) return emptyCapturedPieces();
  const capturedSeat = otherChessSeat(capturer);
  const expected: CapturedPieces = { ...INITIAL_PIECE_COUNTS };
  for (const move of moves) {
    if (!move.promotion) continue;
    const movingSeat =
      move.ply % 2 === 1 ? state.whiteSeat : otherChessSeat(state.whiteSeat);
    if (movingSeat !== capturedSeat) continue;
    expected[1] = Math.max(0, expected[1] - 1);
    expected[move.promotion] = (expected[move.promotion] || 0) + 1;
  }
  const current = emptyCapturedPieces();
  for (const piece of state.board) {
    if (chessPieceSeat(piece) === capturedSeat) {
      const kind = chessPieceKind(piece);
      if (kind <= 5) current[kind] += 1;
    }
  }
  return MATERIAL_ORDER.reduce<CapturedPieces>((result, kind) => {
    result[kind] = Math.max(0, (expected[kind] || 0) - current[kind]);
    return result;
  }, emptyCapturedPieces());
};

const capturedValue = (pieces: CapturedPieces) =>
  MATERIAL_ORDER.reduce(
    (total, kind) => total + pieces[kind] * PIECE_VALUES[kind],
    0
  );

const capturedLabel = (pieces: CapturedPieces) => {
  const labels = MATERIAL_ORDER.flatMap((kind) => {
    const count = pieces[kind];
    if (!count) return [];
    return [`${count} ${PIECE_NAMES[kind]}${count === 1 ? '' : 's'}`];
  });
  return labels.length
    ? `Captured: ${labels.join(', ')}`
    : 'No pieces captured';
};

const PlayerRow = ({
  captured,
  color,
  material,
  name,
}: {
  captured: CapturedPieces;
  color: 'white' | 'black';
  material: number;
  name: string;
}) => {
  const capturedColor = color === 'white' ? 'black' : 'white';
  const hasCaptures = MATERIAL_ORDER.some((kind) => captured[kind] > 0);
  const materialLabel =
    material > 0
      ? `Material advantage: plus ${material}`
      : material < 0
        ? `Material disadvantage: minus ${Math.abs(material)}`
        : 'Material is equal: zero';
  return (
    <Box
      aria-label={`${name}, ${color}. ${capturedLabel(captured)}. ${materialLabel}`}
      sx={{
        alignItems: 'center',
        columnGap: { xs: 1, sm: '18px' },
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(120px, 1fr) minmax(0, auto) 34px',
          sm: 'minmax(150px, 1fr) auto 44px',
        },
        minHeight: 54,
      }}
    >
      <Box
        sx={{ alignItems: 'center', display: 'flex', gap: 1.25, minWidth: 0 }}
      >
        <Box
          aria-hidden="true"
          sx={{
            backgroundColor: color === 'white' ? '#f5f1df' : '#09111d',
            border: `2px solid ${alpha('#fff', 0.25)}`,
            borderRadius: '50%',
            flex: '0 0 auto',
            height: 20,
            width: 20,
          }}
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            noWrap
            sx={{
              color: '#f4f6f8',
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              lineHeight: '21px',
            }}
          >
            {name}
          </Typography>
          <Typography
            sx={{
              color: '#8d99a8',
              fontSize: 13,
              fontWeight: 500,
              lineHeight: '17px',
              mt: '2px',
              textTransform: 'capitalize',
            }}
          >
            {color}
          </Typography>
        </Box>
      </Box>
      <Box
        aria-label={capturedLabel(captured)}
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '7px',
          justifyContent: 'flex-end',
          minWidth: { xs: 0, sm: 120 },
        }}
      >
        {hasCaptures &&
          MATERIAL_ORDER.flatMap((kind) =>
            Array.from({ length: captured[kind] }, (_, index) => (
              <Box
                key={`${kind}-${index}`}
                sx={{ height: 20, opacity: 0.62, width: 20 }}
              >
                <ChessPieceGraphic
                  color={capturedColor}
                  kind={kind}
                  size={20}
                />
              </Box>
            ))
          )}
      </Box>
      <Typography
        aria-label={materialLabel}
        sx={{
          color: material > 0 ? '#22d8e4' : '#8d99a8',
          fontSize: 17,
          fontWeight: material > 0 ? 700 : 600,
          textAlign: 'right',
        }}
      >
        {material > 0 ? `+${material}` : material === 0 ? '0' : material}
      </Typography>
    </Box>
  );
};

export function ChessGameDialog({
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
  const [selectionHint, setSelectionHint] = useState('');
  const [promotion, setPromotion] = useState<{
    from: number;
    to: number;
    options: ChessPromotion[];
  } | null>(null);
  const [resignConfirmationOpen, setResignConfirmationOpen] = useState(false);
  const state = match?.state as ChessState | undefined;
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
        ? getChessLegalMoves(state, localSeat)
        : [],
    [localSeat, localTurn, state]
  );
  const movablePieces = useMemo(
    () => new Set(legalMoves.map((move) => move.from)),
    [legalMoves]
  );
  const selectedMoves =
    selectedFrom === null
      ? []
      : legalMoves.filter((move) => move.from === selectedFrom);
  const destinations = new Set(selectedMoves.map((move) => move.to));

  useEffect(() => {
    setSelectedFrom(null);
    setSelectionHint('');
    setPromotion(null);
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
  const localIsWhite = Boolean(state && localSeat === state.whiteSeat);
  const displayIndexes = localIsWhite
    ? Array.from({ length: 64 }, (_, index) => index)
    : Array.from({ length: 64 }, (_, index) => 63 - index);
  const checkedSeat =
    state && isChessInCheck(state, state.nextSeat) ? state.nextSeat : null;
  const opponentSeat = localSeat ? otherChessSeat(localSeat) : undefined;
  const localColor = localIsWhite ? 'white' : 'black';
  const opponentColor = localIsWhite ? 'black' : 'white';
  const chessMoves = match.moves as ChessMove[];
  const localCaptured =
    state && localSeat
      ? capturedBySeat(state, chessMoves, localSeat)
      : emptyCapturedPieces();
  const opponentCaptured =
    state && opponentSeat
      ? capturedBySeat(state, chessMoves, opponentSeat)
      : emptyCapturedPieces();
  const materialDifference =
    capturedValue(localCaptured) - capturedValue(opponentCaptured);
  const visibleChat = canShowChat;
  const resolvedOutcome = (match.outcome || state?.outcome) as
    | ChessOutcome
    | undefined;
  const resultStatus = (() => {
    if (!resolvedOutcome) return 'Game ended';
    if (resolvedOutcome.type === 'draw') return 'Draw';
    if (resolvedOutcome.type === 'abandoned') return 'Game abandoned';
    if (resolvedOutcome.type === 'protocol-error') return 'Game ended safely';
    if (resolvedOutcome.type === 'resigned') {
      return resolvedOutcome.winner === localSeat
        ? `${opponentName} resigned`
        : 'You resigned';
    }
    return resolvedOutcome.winner === localSeat
      ? 'Checkmate · You won'
      : `Checkmate · ${opponentName} wins`;
  })();
  const turnStatus = resolvedOutcome
    ? resultStatus
    : match.phase === 'finished'
      ? 'Game ended'
      : match.phase === 'finishing'
        ? 'Finishing game...'
        : match.phase === 'reconnecting'
          ? `Reconnecting (${reconnectIn}s)`
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

  const selectSquare = async (index: number) => {
    if (!localTurn || !state || !localSeat || promotion) return;
    const ownPiece = chessPieceSeat(state.board[index]) === localSeat;
    if (ownPiece) {
      if (index === selectedFrom) {
        setSelectedFrom(null);
        setSelectionHint('');
      } else if (movablePieces.has(index)) {
        setSelectedFrom(index);
        setSelectionHint('');
      } else {
        setSelectionHint(
          'That piece has no legal move. It may be blocked or protecting your king.'
        );
      }
      return;
    }
    if (selectedFrom === null || !destinations.has(index)) {
      setSelectedFrom(null);
      setSelectionHint('');
      return;
    }
    const candidates = selectedMoves.filter((move) => move.to === index);
    const promotions = candidates.flatMap((move) =>
      move.promotion ? [move.promotion] : []
    );
    if (promotions.length) {
      setPromotion({ from: selectedFrom, to: index, options: promotions });
      return;
    }
    setSelectedFrom(null);
    await onPlayMove(selectedFrom, index);
  };

  if (match.phase === 'waiting') {
    return (
      <GameInvitationSentDialog
        expiresAt={match.expiresAt}
        gameTitle="Chess"
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
              Chess
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
                  <Typography>Preparing the Chess game...</Typography>
                  <LinearProgress sx={{ mt: 2 }} />
                </>
              )}
              {match.phase === 'waiting' && (
                <>
                  <Typography>
                    Waiting for {opponentName || 'the other player'} to
                    respond...
                  </Typography>
                  <LinearProgress sx={{ mt: 2 }} />
                </>
              )}
              {match.phase === 'round-waiting' && (
                <>
                  <Typography>
                    Waiting for {opponentName} to accept Chess...
                  </Typography>
                  <LinearProgress sx={{ mt: 2 }} />
                </>
              )}
              {(match.phase === 'incoming' ||
                match.phase === 'round-incoming') && (
                <Stack alignItems="center" spacing={1.5}>
                  <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
                    {match.phase === 'round-incoming'
                      ? `${opponentName} would like to play Chess.`
                      : `${resolvePlayerName?.(match.requesterAddress) || match.requesterName || shortAddress(match.requesterAddress)} invited you to Chess.`}
                  </Typography>
                  {match.phase === 'incoming' && (
                    <Typography sx={{ color: '#8d99a8', fontSize: 13 }}>
                      Invitation expires in {expiresIn}s
                    </Typography>
                  )}
                </Stack>
              )}
              {match.phase === 'starting' && (
                <>
                  <Typography>Starting Chess...</Typography>
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
                gridTemplateColumns: visibleChat
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
                <PlayerRow
                  captured={opponentCaptured}
                  color={opponentColor}
                  material={-materialDifference}
                  name={opponentName}
                />
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
                  {promotion
                    ? 'Choose a promotion piece'
                    : selectionHint ||
                      (checkedSeat
                        ? localTurn
                          ? 'Your king is in check'
                          : 'Check'
                        : match.pendingMoveId
                          ? 'Confirming move'
                          : selectedFrom !== null
                            ? 'Choose a highlighted square or another piece'
                            : '')}
                </Typography>
                {promotion && (
                  <Stack
                    direction="row"
                    justifyContent="center"
                    spacing={1}
                    sx={{
                      backgroundColor: alpha('#071421', 0.96),
                      border: `1px solid ${alpha('#22d8e4', 0.38)}`,
                      borderRadius: 1.5,
                      left: '50%',
                      p: 1,
                      position: 'absolute',
                      top: 70,
                      transform: 'translateX(-50%)',
                      zIndex: 3,
                    }}
                  >
                    {promotion.options.map((kind) => (
                      <Button
                        key={kind}
                        aria-label={`Promote to ${kind === 5 ? 'queen' : kind === 4 ? 'rook' : kind === 3 ? 'bishop' : 'knight'}`}
                        onClick={() => {
                          const pending = promotion;
                          setPromotion(null);
                          setSelectedFrom(null);
                          void onPlayMove(pending.from, pending.to, kind);
                        }}
                        variant={kind === 5 ? 'contained' : 'outlined'}
                        sx={{ minWidth: 42, p: 0.5 }}
                      >
                        <ChessPieceGraphic
                          color={localIsWhite ? 'white' : 'black'}
                          kind={kind}
                          size={32}
                        />
                      </Button>
                    ))}
                    <Button onClick={() => setPromotion(null)} size="small">
                      Cancel
                    </Button>
                  </Stack>
                )}
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
                    aria-label="Chess board"
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
                      const piece = state.board[index];
                      const seat = chessPieceSeat(piece);
                      const selected = index === selectedFrom;
                      const destination = destinations.has(index);
                      const ownPiece = seat === localSeat;
                      const checkedKing =
                        checkedSeat === seat && chessPieceKind(piece) === 6;
                      const darkSquare =
                        (Math.floor(index / 8) + (index % 8)) % 2 === 1;
                      const coordinateColor = darkSquare
                        ? '#f4f6f8'
                        : '#779556';
                      return (
                        <Box
                          component="button"
                          type="button"
                          role="gridcell"
                          aria-selected={selected}
                          aria-label={`Row ${Math.floor(displayIndex / 8) + 1}, column ${(displayIndex % 8) + 1}${piece ? `, ${ownPiece ? 'your' : 'opponent'} ${['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][chessPieceKind(piece)]}` : ', empty'}`}
                          disabled={
                            !localTurn ||
                            (!ownPiece && !destination) ||
                            Boolean(promotion)
                          }
                          key={index}
                          onClick={() => void selectSquare(index)}
                          sx={{
                            alignItems: 'center',
                            background: darkSquare ? '#779556' : '#ebecd0',
                            border: 0,
                            boxShadow: checkedKing
                              ? 'inset 0 0 0 5px #ff3f64'
                              : selected
                                ? 'inset 0 0 0 4px #2cf8ff'
                                : 'none',
                            color: '#111827',
                            cursor:
                              ownPiece || destination ? 'pointer' : 'default',
                            display: 'flex',
                            height: '100%',
                            justifyContent: 'center',
                            minHeight: 0,
                            minWidth: 0,
                            overflow: 'hidden',
                            padding: 0,
                            position: 'relative',
                            width: '100%',
                            ...(destination
                              ? {
                                  '&::after': {
                                    background: piece
                                      ? alpha('#2cf8ff', 0.42)
                                      : alpha('#168b72', 0.7),
                                    border: piece ? '4px solid #2cf8ff' : 0,
                                    borderRadius: '50%',
                                    content: '""',
                                    height: piece ? '84%' : '24%',
                                    position: 'absolute',
                                    width: piece ? '84%' : '24%',
                                  },
                                }
                              : {}),
                          }}
                        >
                          {piece ? (
                            <Box
                              sx={{
                                alignItems: 'center',
                                display: 'flex',
                                height: '100%',
                                justifyContent: 'center',
                                position: 'relative',
                                width: '100%',
                                zIndex: 1,
                              }}
                            >
                              <ChessPieceGraphic
                                color={pieceColor(state, piece) || 'black'}
                                kind={chessPieceKind(piece)}
                              />
                            </Box>
                          ) : null}
                          {displayIndex % 8 === 0 && (
                            <Typography
                              aria-hidden
                              sx={{
                                color: coordinateColor,
                                fontSize: 'clamp(7px, 1.1cqh, 11px)',
                                fontWeight: 800,
                                left: 3,
                                lineHeight: 1,
                                position: 'absolute',
                                top: 3,
                                zIndex: 2,
                              }}
                            >
                              {8 - Math.floor(index / 8)}
                            </Typography>
                          )}
                          {Math.floor(displayIndex / 8) === 7 && (
                            <Typography
                              aria-hidden
                              sx={{
                                bottom: 2,
                                color: coordinateColor,
                                fontSize: 'clamp(7px, 1.1cqh, 11px)',
                                fontWeight: 800,
                                lineHeight: 1,
                                position: 'absolute',
                                right: 3,
                                zIndex: 2,
                              }}
                            >
                              {'abcdefgh'[index % 8]}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
                <PlayerRow
                  captured={localCaptured}
                  color={localColor}
                  material={materialDifference}
                  name="You"
                />
                {resolvedOutcome && (
                  <Box
                    aria-live="assertive"
                    role="status"
                    sx={{
                      '@keyframes chessResultReveal': {
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
                      animation: 'chessResultReveal 620ms ease-out both',
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
              {visibleChat && (
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
                    '@keyframes chessRematchPulse': {
                      '0%, 100%': {
                        boxShadow: `0 0 0 0 ${alpha('#22d8e4', 0.08)}`,
                      },
                      '50%': {
                        boxShadow: `0 0 14px 3px ${alpha('#22d8e4', 0.32)}`,
                      },
                    },
                    animation: 'chessRematchPulse 1.8s ease-in-out infinite',
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
        aria-labelledby="chess-resign-title"
        PaperProps={{ sx: gameModalPaperSx }}
      >
        <DialogTitle
          id="chess-resign-title"
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

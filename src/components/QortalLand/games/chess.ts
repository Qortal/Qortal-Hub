export const CHESS_SIZE = 8;
export const CHESS_RULES_VERSION = 1;
export const CHESS_MAX_PLIES = 600;

export type ChessSeat = 1 | 2;
export type ChessPiece =
  | -6
  | -5
  | -4
  | -3
  | -2
  | -1
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6;
export type ChessPromotion = 2 | 3 | 4 | 5;
export type ChessOutcome =
  | { type: 'win'; winner: ChessSeat }
  | { type: 'draw' }
  | { type: 'resigned'; winner: ChessSeat }
  | { type: 'abandoned' }
  | { type: 'protocol-error' };

export type ChessState = {
  board: ChessPiece[];
  nextSeat: ChessSeat;
  whiteSeat: ChessSeat;
  ply: number;
  halfmoveClock: number;
  castlingRights: [boolean, boolean, boolean, boolean];
  enPassant: number | null;
  outcome: ChessOutcome | null;
};

export type ChessMove = {
  messageId: string;
  ply: number;
  from: number;
  to: number;
  promotion?: ChessPromotion;
  previousStateHash: string;
  resultingStateHash: string;
};

export type ChessMoveOption = {
  from: number;
  to: number;
  promotion?: ChessPromotion;
};

const rowOf = (index: number) => Math.floor(index / 8);
const columnOf = (index: number) => index % 8;
const indexOf = (row: number, column: number) => row * 8 + column;
const inside = (row: number, column: number) =>
  row >= 0 && row < 8 && column >= 0 && column < 8;
export const otherChessSeat = (seat: ChessSeat): ChessSeat =>
  seat === 1 ? 2 : 1;
export const chessPieceSeat = (piece: ChessPiece): ChessSeat | null =>
  piece > 0 ? 1 : piece < 0 ? 2 : null;
export const chessPieceKind = (piece: ChessPiece): number => Math.abs(piece);
const pieceFor = (seat: ChessSeat, kind: number): ChessPiece =>
  (seat === 1 ? kind : -kind) as ChessPiece;
const forward = (state: ChessState, seat: ChessSeat) =>
  seat === state.whiteSeat ? -1 : 1;
const homeRow = (state: ChessState, seat: ChessSeat) =>
  seat === state.whiteSeat ? 7 : 0;
const pawnRow = (state: ChessState, seat: ChessSeat) =>
  seat === state.whiteSeat ? 6 : 1;
const promotionRow = (state: ChessState, seat: ChessSeat) =>
  seat === state.whiteSeat ? 0 : 7;
const rightIndex = (seat: ChessSeat, kingSide: boolean) =>
  (seat === 1 ? 0 : 2) + (kingSide ? 0 : 1);

export const createChessState = (whiteSeat: ChessSeat): ChessState => {
  const blackSeat = otherChessSeat(whiteSeat);
  const board = Array.from({ length: 64 }, () => 0 as ChessPiece);
  const backRank = [4, 2, 3, 5, 6, 3, 2, 4];
  backRank.forEach((kind, column) => {
    board[indexOf(0, column)] = pieceFor(blackSeat, kind);
    board[indexOf(1, column)] = pieceFor(blackSeat, 1);
    board[indexOf(6, column)] = pieceFor(whiteSeat, 1);
    board[indexOf(7, column)] = pieceFor(whiteSeat, kind);
  });
  return {
    board,
    nextSeat: whiteSeat,
    whiteSeat,
    ply: 0,
    halfmoveClock: 0,
    castlingRights: [true, true, true, true],
    enPassant: null,
    outcome: null,
  };
};

const rayAttacks = (
  state: ChessState,
  from: number,
  target: number,
  directions: ReadonlyArray<readonly [number, number]>
) => {
  for (const [dy, dx] of directions) {
    let row = rowOf(from) + dy;
    let column = columnOf(from) + dx;
    while (inside(row, column)) {
      const square = indexOf(row, column);
      if (square === target) return true;
      if (state.board[square]) break;
      row += dy;
      column += dx;
    }
  }
  return false;
};

export const isChessSquareAttacked = (
  state: ChessState,
  square: number,
  bySeat: ChessSeat
): boolean => {
  for (let from = 0; from < 64; from += 1) {
    const piece = state.board[from];
    if (chessPieceSeat(piece) !== bySeat) continue;
    const kind = chessPieceKind(piece);
    const dy = rowOf(square) - rowOf(from);
    const dx = columnOf(square) - columnOf(from);
    if (kind === 1 && dy === forward(state, bySeat) && Math.abs(dx) === 1)
      return true;
    if (
      kind === 2 &&
      [
        [1, 2],
        [2, 1],
      ].some(([a, b]) => Math.abs(dy) === a && Math.abs(dx) === b)
    )
      return true;
    if (
      kind === 3 &&
      rayAttacks(state, from, square, [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ])
    )
      return true;
    if (
      kind === 4 &&
      rayAttacks(state, from, square, [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ])
    )
      return true;
    if (
      kind === 5 &&
      rayAttacks(state, from, square, [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ])
    )
      return true;
    if (kind === 6 && Math.max(Math.abs(dy), Math.abs(dx)) === 1) return true;
  }
  return false;
};

export const isChessInCheck = (state: ChessState, seat: ChessSeat): boolean => {
  const king = state.board.findIndex((piece) => piece === pieceFor(seat, 6));
  return king < 0 || isChessSquareAttacked(state, king, otherChessSeat(seat));
};

const addDestination = (
  state: ChessState,
  seat: ChessSeat,
  moves: ChessMoveOption[],
  from: number,
  to: number
) => {
  const target = state.board[to];
  if (chessPieceSeat(target) === seat || chessPieceKind(target) === 6)
    return false;
  moves.push({ from, to });
  return target === 0;
};

const pseudoMoves = (state: ChessState, seat: ChessSeat): ChessMoveOption[] => {
  const moves: ChessMoveOption[] = [];
  for (let from = 0; from < 64; from += 1) {
    const piece = state.board[from];
    if (chessPieceSeat(piece) !== seat) continue;
    const kind = chessPieceKind(piece);
    const row = rowOf(from);
    const column = columnOf(from);
    if (kind === 1) {
      const direction = forward(state, seat);
      const oneRow = row + direction;
      if (inside(oneRow, column) && !state.board[indexOf(oneRow, column)]) {
        const to = indexOf(oneRow, column);
        if (oneRow === promotionRow(state, seat)) {
          ([5, 4, 3, 2] as ChessPromotion[]).forEach((promotion) =>
            moves.push({ from, to, promotion })
          );
        } else {
          moves.push({ from, to });
          const twoRow = row + direction * 2;
          if (
            row === pawnRow(state, seat) &&
            !state.board[indexOf(twoRow, column)]
          )
            moves.push({ from, to: indexOf(twoRow, column) });
        }
      }
      for (const dx of [-1, 1]) {
        const captureRow = row + direction;
        const captureColumn = column + dx;
        if (!inside(captureRow, captureColumn)) continue;
        const to = indexOf(captureRow, captureColumn);
        const targetSeat = chessPieceSeat(state.board[to]);
        if (targetSeat !== otherChessSeat(seat) && to !== state.enPassant)
          continue;
        if (chessPieceKind(state.board[to]) === 6) continue;
        if (captureRow === promotionRow(state, seat))
          ([5, 4, 3, 2] as ChessPromotion[]).forEach((promotion) =>
            moves.push({ from, to, promotion })
          );
        else moves.push({ from, to });
      }
      continue;
    }
    if (kind === 2 || kind === 6) {
      const offsets =
        kind === 2
          ? [
              [-2, -1],
              [-2, 1],
              [-1, -2],
              [-1, 2],
              [1, -2],
              [1, 2],
              [2, -1],
              [2, 1],
            ]
          : [
              [-1, -1],
              [-1, 0],
              [-1, 1],
              [0, -1],
              [0, 1],
              [1, -1],
              [1, 0],
              [1, 1],
            ];
      offsets.forEach(([dy, dx]) => {
        const toRow = row + dy;
        const toColumn = column + dx;
        if (inside(toRow, toColumn))
          addDestination(state, seat, moves, from, indexOf(toRow, toColumn));
      });
      if (
        kind === 6 &&
        row === homeRow(state, seat) &&
        column === 4 &&
        !isChessInCheck(state, seat)
      ) {
        for (const kingSide of [true, false]) {
          if (!state.castlingRights[rightIndex(seat, kingSide)]) continue;
          const rookColumn = kingSide ? 7 : 0;
          const between = kingSide ? [5, 6] : [1, 2, 3];
          const crossed = kingSide ? [5, 6] : [3, 2];
          if (
            state.board[indexOf(row, rookColumn)] === pieceFor(seat, 4) &&
            between.every((value) => !state.board[indexOf(row, value)]) &&
            crossed.every(
              (value) =>
                !isChessSquareAttacked(
                  state,
                  indexOf(row, value),
                  otherChessSeat(seat)
                )
            )
          )
            moves.push({ from, to: indexOf(row, kingSide ? 6 : 2) });
        }
      }
      continue;
    }
    const directions =
      kind === 3
        ? [
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
          ]
        : kind === 4
          ? [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ]
          : [
              [-1, -1],
              [-1, 1],
              [1, -1],
              [1, 1],
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ];
    for (const [dy, dx] of directions) {
      let toRow = row + dy;
      let toColumn = column + dx;
      while (inside(toRow, toColumn)) {
        if (!addDestination(state, seat, moves, from, indexOf(toRow, toColumn)))
          break;
        toRow += dy;
        toColumn += dx;
      }
    }
  }
  return moves;
};

const applyUnchecked = (
  state: ChessState,
  seat: ChessSeat,
  move: ChessMoveOption
): ChessState => {
  const board = [...state.board];
  const piece = board[move.from];
  const kind = chessPieceKind(piece);
  const captured = board[move.to];
  board[move.from] = 0;
  if (kind === 1 && move.to === state.enPassant && captured === 0) {
    board[move.to - forward(state, seat) * 8] = 0;
  }
  board[move.to] = move.promotion ? pieceFor(seat, move.promotion) : piece;
  if (kind === 6 && Math.abs(columnOf(move.to) - columnOf(move.from)) === 2) {
    const kingSide = columnOf(move.to) === 6;
    const row = rowOf(move.from);
    const rookFrom = indexOf(row, kingSide ? 7 : 0);
    const rookTo = indexOf(row, kingSide ? 5 : 3);
    board[rookTo] = board[rookFrom];
    board[rookFrom] = 0;
  }
  const castlingRights = [
    ...state.castlingRights,
  ] as ChessState['castlingRights'];
  if (kind === 6) {
    castlingRights[rightIndex(seat, true)] = false;
    castlingRights[rightIndex(seat, false)] = false;
  }
  for (const checkedSeat of [1, 2] as ChessSeat[]) {
    const row = homeRow(state, checkedSeat);
    if (move.from === indexOf(row, 7) || move.to === indexOf(row, 7))
      castlingRights[rightIndex(checkedSeat, true)] = false;
    if (move.from === indexOf(row, 0) || move.to === indexOf(row, 0))
      castlingRights[rightIndex(checkedSeat, false)] = false;
  }
  const enPassant =
    kind === 1 && Math.abs(rowOf(move.to) - rowOf(move.from)) === 2
      ? (move.from + move.to) / 2
      : null;
  return {
    ...state,
    board,
    nextSeat: otherChessSeat(seat),
    ply: state.ply + 1,
    halfmoveClock:
      kind === 1 ||
      captured !== 0 ||
      (kind === 1 && move.to === state.enPassant)
        ? 0
        : state.halfmoveClock + 1,
    castlingRights,
    enPassant,
    outcome: null,
  };
};

export const getChessLegalMoves = (
  state: ChessState,
  seat: ChessSeat = state.nextSeat
): ChessMoveOption[] => {
  if (state.outcome) return [];
  return pseudoMoves(state, seat).filter(
    (move) => !isChessInCheck(applyUnchecked(state, seat, move), seat)
  );
};

const insufficientMaterial = (board: ChessPiece[]) => {
  const pieces = board.filter((piece) => piece && chessPieceKind(piece) !== 6);
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && [2, 3].includes(chessPieceKind(pieces[0])))
    return true;
  if (pieces.every((piece) => chessPieceKind(piece) === 3)) {
    const bishopColors = board.flatMap((piece, index) =>
      chessPieceKind(piece) === 3 ? [(rowOf(index) + columnOf(index)) % 2] : []
    );
    return new Set(bishopColors).size === 1;
  }
  return false;
};

export const applyChessMove = (
  state: ChessState,
  seat: ChessSeat,
  from: number,
  to: number,
  promotion?: ChessPromotion
): ChessState => {
  if (state.outcome) throw new Error('Chess match has already finished');
  if (state.nextSeat !== seat) throw new Error("It is not this player's turn");
  const move = getChessLegalMoves(state, seat).find(
    (candidate) =>
      candidate.from === from &&
      candidate.to === to &&
      candidate.promotion === promotion
  );
  if (!move) throw new Error('Illegal Chess move');
  const next = applyUnchecked(state, seat, move);
  const opponent = otherChessSeat(seat);
  if (getChessLegalMoves(next, opponent).length === 0) {
    next.outcome = isChessInCheck(next, opponent)
      ? { type: 'win', winner: seat }
      : { type: 'draw' };
  } else if (
    next.halfmoveClock >= 100 ||
    insufficientMaterial(next.board) ||
    next.ply >= CHESS_MAX_PLIES
  ) {
    next.outcome = { type: 'draw' };
  }
  return next;
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const decodeHex = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('Invalid hexadecimal game seed');
  }
  return new Uint8Array(
    normalized.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []
  );
};

export const hashChessState = async (state: ChessState): Promise<string> => {
  const canonical = JSON.stringify({
    board: state.board,
    castlingRights: state.castlingRights,
    enPassant: state.enPassant,
    game: 'chess',
    halfmoveClock: state.halfmoveClock,
    nextSeat: state.nextSeat,
    outcome: state.outcome,
    ply: state.ply,
    protocolVersion: 2,
    rulesVersion: CHESS_RULES_VERSION,
    whiteSeat: state.whiteSeat,
  });
  return hex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
    )
  );
};

export const deriveChessStartingSeat = async (
  roundId: string,
  requesterNonce: string,
  recipientNonce: string
): Promise<ChessSeat> => {
  const parts = [
    new TextEncoder().encode('qortalland-game:v2:chess:'),
    decodeHex(roundId),
    decodeHex(requesterNonce),
    decodeHex(recipientNonce),
  ];
  const input = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0)
  );
  let offset = 0;
  parts.forEach((part) => {
    input.set(part, offset);
    offset += part.length;
  });
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return (digest.at(-1)! & 1) === 0 ? 1 : 2;
};

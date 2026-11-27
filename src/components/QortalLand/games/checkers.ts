export const CHECKERS_SIZE = 8;
export const CHECKERS_RULES_VERSION = 1;
export const CHECKERS_MAX_PLIES = 200;
export const CHECKERS_DRAW_QUIET_PLIES = 80;

export type CheckersSeat = 1 | 2;
export type CheckersPiece = 0 | 1 | 2 | 3 | 4;
export type CheckersOutcome =
  | { type: 'win'; winner: CheckersSeat }
  | { type: 'draw' }
  | { type: 'resigned'; winner: CheckersSeat }
  | { type: 'abandoned' }
  | { type: 'protocol-error' };

export type CheckersState = {
  board: CheckersPiece[];
  nextSeat: CheckersSeat;
  ply: number;
  quietPly: number;
  outcome: CheckersOutcome | null;
};

export type CheckersMove = {
  messageId: string;
  ply: number;
  from: number;
  path: number[];
  previousStateHash: string;
  resultingStateHash: string;
};

export type CheckersMoveOption = {
  from: number;
  path: number[];
  captured: number[];
};

const rowOf = (index: number): number => Math.floor(index / CHECKERS_SIZE);
const columnOf = (index: number): number => index % CHECKERS_SIZE;
const indexOf = (row: number, column: number): number =>
  row * CHECKERS_SIZE + column;
const inside = (row: number, column: number): boolean =>
  row >= 0 && row < 8 && column >= 0 && column < 8;

export const otherCheckersSeat = (seat: CheckersSeat): CheckersSeat =>
  seat === 1 ? 2 : 1;
export const checkersPieceSeat = (piece: CheckersPiece): CheckersSeat | null =>
  piece === 1 || piece === 3 ? 1 : piece === 2 || piece === 4 ? 2 : null;
export const isCheckersKing = (piece: CheckersPiece): boolean =>
  piece === 3 || piece === 4;

const directions = (
  piece: CheckersPiece
): ReadonlyArray<readonly [number, number]> => {
  if (isCheckersKing(piece))
    return [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
  return checkersPieceSeat(piece) === 1
    ? [
        [-1, -1],
        [-1, 1],
      ]
    : [
        [1, -1],
        [1, 1],
      ];
};

const kingRow = (seat: CheckersSeat): number => (seat === 1 ? 0 : 7);
const crowned = (piece: CheckersPiece, destination: number): CheckersPiece => {
  const seat = checkersPieceSeat(piece);
  if (!seat || isCheckersKing(piece) || rowOf(destination) !== kingRow(seat))
    return piece;
  return seat === 1 ? 3 : 4;
};

export const createCheckersState = (
  startingSeat: CheckersSeat
): CheckersState => {
  const board = Array.from({ length: 64 }, () => 0 as CheckersPiece);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      if ((row + column) % 2 === 1) board[indexOf(row, column)] = 2;
    }
  }
  for (let row = 5; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      if ((row + column) % 2 === 1) board[indexOf(row, column)] = 1;
    }
  }
  return { board, nextSeat: startingSeat, ply: 0, quietPly: 0, outcome: null };
};

const captureSequences = (
  board: CheckersPiece[],
  from: number,
  piece: CheckersPiece,
  path: number[] = [],
  captured: number[] = [],
  origin: number = from
): CheckersMoveOption[] => {
  const seat = checkersPieceSeat(piece);
  if (!seat) return [];
  const results: CheckersMoveOption[] = [];
  for (const [dy, dx] of directions(piece)) {
    const middleRow = rowOf(from) + dy;
    const middleColumn = columnOf(from) + dx;
    const landingRow = rowOf(from) + dy * 2;
    const landingColumn = columnOf(from) + dx * 2;
    if (!inside(landingRow, landingColumn) || !inside(middleRow, middleColumn))
      continue;
    const middle = indexOf(middleRow, middleColumn);
    const landing = indexOf(landingRow, landingColumn);
    if (
      !board[middle] ||
      checkersPieceSeat(board[middle]) === seat ||
      board[landing]
    )
      continue;
    const nextBoard = [...board];
    nextBoard[from] = 0;
    nextBoard[middle] = 0;
    const nextPiece = crowned(piece, landing);
    nextBoard[landing] = nextPiece;
    const nextPath = [...path, landing];
    const nextCaptured = [...captured, middle];
    // In American/English draughts, crowning ends the capture turn.
    const continuations =
      nextPiece !== piece
        ? []
        : captureSequences(
            nextBoard,
            landing,
            nextPiece,
            nextPath,
            nextCaptured,
            origin
          );
    if (continuations.length) results.push(...continuations);
    else results.push({ from: origin, path: nextPath, captured: nextCaptured });
  }
  return results;
};

export const getCheckersLegalMoves = (
  state: CheckersState,
  seat: CheckersSeat = state.nextSeat
): CheckersMoveOption[] => {
  if (state.outcome) return [];
  const captures: CheckersMoveOption[] = [];
  for (let from = 0; from < 64; from += 1) {
    const piece = state.board[from];
    if (checkersPieceSeat(piece) !== seat) continue;
    captures.push(...captureSequences(state.board, from, piece));
  }
  if (captures.length) return captures;
  const moves: CheckersMoveOption[] = [];
  for (let from = 0; from < 64; from += 1) {
    const piece = state.board[from];
    if (checkersPieceSeat(piece) !== seat) continue;
    for (const [dy, dx] of directions(piece)) {
      const row = rowOf(from) + dy;
      const column = columnOf(from) + dx;
      if (!inside(row, column)) continue;
      const destination = indexOf(row, column);
      if (!state.board[destination])
        moves.push({ from, path: [destination], captured: [] });
    }
  }
  return moves;
};

export const applyCheckersMove = (
  state: CheckersState,
  seat: CheckersSeat,
  from: number,
  path: number[]
): CheckersState => {
  if (state.outcome) throw new Error('Checkers match has already finished');
  if (state.nextSeat !== seat) throw new Error("It is not this player's turn");
  const option = getCheckersLegalMoves(state, seat).find(
    (candidate) =>
      candidate.from === from &&
      candidate.path.length === path.length &&
      candidate.path.every((value, index) => value === path[index])
  );
  if (!option) throw new Error('Illegal Checkers move');
  const board = [...state.board];
  let piece = board[from];
  board[from] = 0;
  option.captured.forEach((index) => {
    board[index] = 0;
  });
  const destination = path[path.length - 1];
  const promoted = crowned(piece, destination) !== piece;
  piece = crowned(piece, destination);
  board[destination] = piece;
  const nextSeat = otherCheckersSeat(seat);
  const next: CheckersState = {
    board,
    nextSeat,
    ply: state.ply + 1,
    quietPly: option.captured.length || promoted ? 0 : state.quietPly + 1,
    outcome: null,
  };
  if (
    !board.some((value) => checkersPieceSeat(value) === nextSeat) ||
    getCheckersLegalMoves(next, nextSeat).length === 0
  ) {
    next.outcome = { type: 'win', winner: seat };
  } else if (
    next.quietPly >= CHECKERS_DRAW_QUIET_PLIES ||
    next.ply >= CHECKERS_MAX_PLIES
  ) {
    next.outcome = { type: 'draw' };
  }
  return next;
};

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const decodeHex = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2)
    throw new Error('Invalid hexadecimal game seed');
  return new Uint8Array(
    normalized.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []
  );
};

export const hashCheckersState = async (
  state: CheckersState
): Promise<string> => {
  const canonical = JSON.stringify({
    board: state.board,
    game: 'checkers',
    nextSeat: state.nextSeat,
    outcome: state.outcome,
    ply: state.ply,
    protocolVersion: 2,
    quietPly: state.quietPly,
    rulesVersion: CHECKERS_RULES_VERSION,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical)
  );
  return hex(new Uint8Array(digest));
};

export const deriveCheckersStartingSeat = async (
  roundId: string,
  requesterNonceHex: string,
  recipientNonceHex: string
): Promise<CheckersSeat> => {
  const parts = [
    new TextEncoder().encode('qortalland-game:v2:checkers:'),
    decodeHex(roundId),
    decodeHex(requesterNonceHex),
    decodeHex(recipientNonceHex),
  ];
  const input = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0)
  );
  let offset = 0;
  parts.forEach((part) => {
    input.set(part, offset);
    offset += part.length;
  });
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return (digest[digest.length - 1] & 1) === 0 ? 1 : 2;
};

export const CONNECT_FOUR_COLUMNS = 7;
export const CONNECT_FOUR_ROWS = 6;
export const CONNECT_FOUR_RULES_VERSION = 1;

export type ConnectFourSeat = 1 | 2;
export type ConnectFourCell = 0 | ConnectFourSeat;
export type ConnectFourOutcome =
  | { type: 'win'; winner: ConnectFourSeat }
  | { type: 'draw' }
  | { type: 'resigned'; winner: ConnectFourSeat }
  | { type: 'abandoned' }
  | { type: 'protocol-error' };

export type ConnectFourState = {
  board: ConnectFourCell[];
  nextSeat: ConnectFourSeat;
  ply: number;
  outcome: ConnectFourOutcome | null;
};

export type ConnectFourMove = {
  messageId: string;
  ply: number;
  column: number;
  previousStateHash: string;
  resultingStateHash: string;
};

export const otherConnectFourSeat = (seat: ConnectFourSeat): ConnectFourSeat =>
  seat === 1 ? 2 : 1;

export const createConnectFourState = (
  startingSeat: ConnectFourSeat
): ConnectFourState => ({
  board: Array.from(
    { length: CONNECT_FOUR_COLUMNS * CONNECT_FOUR_ROWS },
    () => 0 as ConnectFourCell
  ),
  nextSeat: startingSeat,
  ply: 0,
  outcome: null,
});

export const connectFourCellIndex = (column: number, row: number): number =>
  row * CONNECT_FOUR_COLUMNS + column;

const isBoardCoordinate = (column: number, row: number): boolean =>
  Number.isInteger(column) &&
  Number.isInteger(row) &&
  column >= 0 &&
  column < CONNECT_FOUR_COLUMNS &&
  row >= 0 &&
  row < CONNECT_FOUR_ROWS;

export const getConnectFourCell = (
  state: ConnectFourState,
  column: number,
  row: number
): ConnectFourCell => {
  if (!isBoardCoordinate(column, row)) return 0;
  return state.board[connectFourCellIndex(column, row)] ?? 0;
};

export const connectFourDropRow = (
  state: ConnectFourState,
  column: number
): number | null => {
  if (
    !Number.isInteger(column) ||
    column < 0 ||
    column >= CONNECT_FOUR_COLUMNS
  ) {
    return null;
  }
  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    if (getConnectFourCell(state, column, row) === 0) return row;
  }
  return null;
};

const hasConnectFourLine = (
  state: ConnectFourState,
  column: number,
  row: number,
  seat: ConnectFourSeat,
  dx: number,
  dy: number
): boolean => {
  let count = 1;
  for (const direction of [-1, 1] as const) {
    let x = column + dx * direction;
    let y = row + dy * direction;
    while (
      isBoardCoordinate(x, y) &&
      getConnectFourCell(state, x, y) === seat
    ) {
      count += 1;
      x += dx * direction;
      y += dy * direction;
    }
  }
  return count >= 4;
};

export const getConnectFourWinningCells = (
  state: ConnectFourState
): number[] => {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const;
  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    for (let column = 0; column < CONNECT_FOUR_COLUMNS; column += 1) {
      const seat = getConnectFourCell(state, column, row);
      if (!seat) continue;
      for (const [dx, dy] of directions) {
        const cells: number[] = [];
        for (let offset = 0; offset < 4; offset += 1) {
          const x = column + dx * offset;
          const y = row + dy * offset;
          if (
            !isBoardCoordinate(x, y) ||
            getConnectFourCell(state, x, y) !== seat
          ) {
            cells.length = 0;
            break;
          }
          cells.push(connectFourCellIndex(x, y));
        }
        if (cells.length === 4) return cells;
      }
    }
  }
  return [];
};

export const applyConnectFourMove = (
  state: ConnectFourState,
  seat: ConnectFourSeat,
  column: number
): ConnectFourState => {
  if (state.outcome) throw new Error('Qonnect Four match has already finished');
  if (state.nextSeat !== seat) throw new Error("It is not this player's turn");
  const row = connectFourDropRow(state, column);
  if (row === null) throw new Error('Qonnect Four column is not playable');

  const board = [...state.board];
  board[connectFourCellIndex(column, row)] = seat;
  const next: ConnectFourState = {
    board,
    nextSeat: otherConnectFourSeat(seat),
    ply: state.ply + 1,
    outcome: null,
  };
  const won = (
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ] as const
  ).some(([dx, dy]) => hasConnectFourLine(next, column, row, seat, dx, dy));
  if (won) next.outcome = { type: 'win', winner: seat };
  else if (next.ply === CONNECT_FOUR_COLUMNS * CONNECT_FOUR_ROWS) {
    next.outcome = { type: 'draw' };
  }
  return next;
};

const canonicalConnectFourState = (state: ConnectFourState): string =>
  JSON.stringify({
    board: state.board,
    game: 'connect-four',
    nextSeat: state.nextSeat,
    outcome: state.outcome,
    ply: state.ply,
    protocolVersion: 2,
    rulesVersion: CONNECT_FOUR_RULES_VERSION,
  });

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export const hashConnectFourState = async (
  state: ConnectFourState
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalConnectFourState(state))
  );
  return hex(new Uint8Array(digest));
};

const decodeHex = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('Invalid hexadecimal game seed');
  }
  return new Uint8Array(
    normalized.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []
  );
};

export const deriveConnectFourStartingSeat = async (
  matchId: string,
  requesterNonceHex: string,
  recipientNonceHex: string
): Promise<ConnectFourSeat> => {
  const prefix = new TextEncoder().encode('qortalland-game:v2:connect-four:');
  const match = decodeHex(matchId);
  const requester = decodeHex(requesterNonceHex);
  const recipient = decodeHex(recipientNonceHex);
  const input = new Uint8Array(
    prefix.length + match.length + requester.length + recipient.length
  );
  input.set(prefix, 0);
  input.set(match, prefix.length);
  input.set(requester, prefix.length + match.length);
  input.set(recipient, prefix.length + match.length + requester.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return (digest[digest.length - 1] & 1) === 0 ? 1 : 2;
};

export const connectFourTranscriptHash = async (
  moves: ConnectFourMove[]
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify(
        moves.map((move) => ({
          column: move.column,
          messageId: move.messageId,
          ply: move.ply,
          previousStateHash: move.previousStateHash,
          resultingStateHash: move.resultingStateHash,
        }))
      )
    )
  );
  return hex(new Uint8Array(digest));
};

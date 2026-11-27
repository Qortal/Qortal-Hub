import { describe, expect, it } from 'vitest';
import {
  applyChessMove,
  createChessState,
  deriveChessStartingSeat,
  getChessLegalMoves,
  hashChessState,
  isChessInCheck,
  type ChessState,
} from './chess';

const empty = (): ChessState => ({
  board: Array(64).fill(0),
  nextSeat: 1,
  whiteSeat: 1,
  ply: 0,
  halfmoveClock: 0,
  castlingRights: [false, false, false, false],
  enPassant: null,
  outcome: null,
});

describe('Chess rules', () => {
  it('starts with twenty legal white moves', () => {
    expect(getChessLegalMoves(createChessState(1))).toHaveLength(20);
  });

  it('matches the standard initial-position move tree through three plies', () => {
    const countPositions = (state: ChessState, depth: number): number => {
      if (depth === 0) return 1;
      return getChessLegalMoves(state).reduce(
        (total, move) =>
          total +
          countPositions(
            applyChessMove(
              state,
              state.nextSeat,
              move.from,
              move.to,
              move.promotion
            ),
            depth - 1
          ),
        0
      );
    };

    expect(countPositions(createChessState(1), 3)).toBe(8_902);
  });

  it('rejects moves that expose the king', () => {
    const state = empty();
    state.board[60] = 6;
    state.board[52] = 4;
    state.board[4] = -4;
    state.board[0] = -6;
    expect(
      getChessLegalMoves(state).some(
        (move) => move.from === 52 && move.to === 51
      )
    ).toBe(false);
  });

  it('detects checkmate', () => {
    let state = createChessState(1);
    state = applyChessMove(state, 1, 53, 45); // f3
    state = applyChessMove(state, 2, 12, 28); // e5
    state = applyChessMove(state, 1, 54, 38); // g4
    state = applyChessMove(state, 2, 3, 39); // Qh4#
    expect(state.outcome).toEqual({ type: 'win', winner: 2 });
  });

  it('supports castling through unattacked empty squares', () => {
    const state = empty();
    state.castlingRights = [true, false, false, false];
    state.board[60] = 6;
    state.board[63] = 4;
    state.board[4] = -6;
    expect(getChessLegalMoves(state)).toContainEqual({ from: 60, to: 62 });
    const next = applyChessMove(state, 1, 60, 62);
    expect(next.board[62]).toBe(6);
    expect(next.board[61]).toBe(4);
  });

  it('does not allow castling through an attacked square', () => {
    const state = empty();
    state.castlingRights = [true, false, false, false];
    state.board[60] = 6;
    state.board[63] = 4;
    state.board[0] = -6;
    state.board[5] = -4;
    expect(getChessLegalMoves(state)).not.toContainEqual({ from: 60, to: 62 });
  });

  it('supports en passant', () => {
    let state = empty();
    state.board[60] = 6;
    state.board[4] = -6;
    state.board[28] = 1;
    state.board[11] = -1;
    state.nextSeat = 2;
    state = applyChessMove(state, 2, 11, 27);
    expect(state.enPassant).toBe(19);
    state = applyChessMove(state, 1, 28, 19);
    expect(state.board[19]).toBe(1);
    expect(state.board[27]).toBe(0);
  });

  it('rejects en passant when moving the pawn would expose its king', () => {
    const state = empty();
    state.board[60] = 6;
    state.board[28] = 1;
    state.board[4] = -4;
    state.board[0] = -6;
    state.board[27] = -1;
    state.enPassant = 19;
    expect(getChessLegalMoves(state)).not.toContainEqual({ from: 28, to: 19 });
  });

  it('requires and applies promotion', () => {
    const state = empty();
    state.board[60] = 6;
    state.board[4] = -6;
    state.board[8] = 1;
    expect(() => applyChessMove(state, 1, 8, 0)).toThrow('Illegal Chess move');
    expect(applyChessMove(state, 1, 8, 0, 5).board[0]).toBe(5);
  });

  it('detects attacked kings', () => {
    const state = empty();
    state.board[60] = 6;
    state.board[4] = -6;
    state.board[12] = -4;
    expect(isChessInCheck(state, 1)).toBe(true);
  });

  it('permanently removes castling rights after a rook returns home', () => {
    let state = empty();
    state.castlingRights = [true, false, false, false];
    state.board[60] = 6;
    state.board[63] = 4;
    state.board[0] = -6;
    state = applyChessMove(state, 1, 63, 55);
    state = applyChessMove(state, 2, 0, 1);
    state = applyChessMove(state, 1, 55, 63);
    state = applyChessMove(state, 2, 1, 0);
    expect(getChessLegalMoves(state)).not.toContainEqual({ from: 60, to: 62 });
  });

  it('assigns White and the opening move to either derived seat', () => {
    const state = createChessState(2);
    expect(state.whiteSeat).toBe(2);
    expect(state.nextSeat).toBe(2);
    expect(state.board[60]).toBe(-6);
    expect(getChessLegalMoves(state)).toHaveLength(20);
  });

  it('detects stalemate as a draw', () => {
    const state = empty();
    state.board[0] = -6;
    state.board[18] = 6;
    state.board[17] = 5;
    state.nextSeat = 1;
    const next = applyChessMove(state, 1, 17, 10);
    expect(next.outcome).toEqual({ type: 'draw' });
  });

  it('matches the Python initial-state hash fixture', async () => {
    expect(await hashChessState(createChessState(2))).toBe(
      'cc48133f2305d376d6d48e9e858239ae9ea6db7af7692c607d68b0af8a70a8bb'
    );
  });

  it('rejects malformed round seeds', async () => {
    await expect(
      deriveChessStartingSeat('not-a-uuid', '11'.repeat(16), '22'.repeat(16))
    ).rejects.toThrow('Invalid hexadecimal game seed');
  });
});

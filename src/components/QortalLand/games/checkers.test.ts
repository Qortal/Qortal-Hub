import { describe, expect, it } from 'vitest';
import {
  applyCheckersMove,
  createCheckersState,
  getCheckersLegalMoves,
  hashCheckersState,
  type CheckersState,
} from './checkers';

const emptyState = (): CheckersState => ({
  board: Array(64).fill(0),
  nextSeat: 1,
  ply: 0,
  quietPly: 0,
  outcome: null,
});

describe('Checkers rules', () => {
  it('creates twelve pieces per player on playable squares', () => {
    const state = createCheckersState(1);
    expect(state.board.filter((piece) => piece === 1)).toHaveLength(12);
    expect(state.board.filter((piece) => piece === 2)).toHaveLength(12);
    expect(getCheckersLegalMoves(state)).toHaveLength(7);
  });

  it('requires captures when one is available', () => {
    const state = emptyState();
    state.board[42] = 1;
    state.board[33] = 2;
    state.board[46] = 1;
    expect(getCheckersLegalMoves(state)).toEqual([
      { from: 42, path: [24], captured: [33] },
    ]);
  });

  it('requires a complete chained capture', () => {
    const state = emptyState();
    state.board[42] = 1;
    state.board[33] = 2;
    state.board[17] = 2;
    const moves = getCheckersLegalMoves(state);
    expect(moves).toEqual([{ from: 42, path: [24, 10], captured: [33, 17] }]);
    expect(() => applyCheckersMove(state, 1, 42, [24])).toThrow(
      'Illegal Checkers move'
    );
    const next = applyCheckersMove(state, 1, 42, [24, 10]);
    expect(next.board[10]).toBe(1);
    expect(next.board[33]).toBe(0);
    expect(next.board[17]).toBe(0);
  });

  it('crowns a man and ends its capture turn on the king row', () => {
    const state = emptyState();
    state.board[17] = 1;
    state.board[10] = 2;
    state.board[12] = 2;
    const next = applyCheckersMove(state, 1, 17, [3]);
    expect(next.board[3]).toBe(3);
  });

  it('allows kings to move and capture backward', () => {
    const state = emptyState();
    state.board[26] = 3;
    state.board[35] = 2;
    expect(getCheckersLegalMoves(state)).toContainEqual({
      from: 26,
      path: [44],
      captured: [35],
    });
    const next = applyCheckersMove(state, 1, 26, [44]);
    expect(next.board[44]).toBe(3);
    expect(next.board[35]).toBe(0);
  });

  it('rejects moving out of turn', () => {
    expect(() =>
      applyCheckersMove(createCheckersState(2), 1, 40, [33])
    ).toThrow('not this player');
  });

  it('draws after eighty quiet plies', () => {
    const state = emptyState();
    state.board[42] = 3;
    state.board[21] = 4;
    state.quietPly = 79;
    const next = applyCheckersMove(state, 1, 42, [33]);
    expect(next.outcome).toEqual({ type: 'draw' });
  });

  it('ends when the opponent has no legal move', () => {
    const state = emptyState();
    state.board[10] = 1;
    state.board[56] = 2;
    const next = applyCheckersMove(state, 1, 10, [3]);
    expect(next.outcome).toEqual({ type: 'win', winner: 1 });
  });

  it('hashes identical states deterministically', async () => {
    const state = createCheckersState(2);
    expect(await hashCheckersState(state)).toBe(
      await hashCheckersState({ ...state, board: [...state.board] })
    );
  });

  it('matches the Python initial-state hash fixture', async () => {
    expect(await hashCheckersState(createCheckersState(1))).toBe(
      'd8f380b461ea12fe5c662de0ba7c5707de3afdf36ec1f9d4222719b6b22cad7e'
    );
  });
});

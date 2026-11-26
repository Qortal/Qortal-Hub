import { describe, expect, it } from 'vitest';
import {
  applyConnectFourMove,
  connectFourDropRow,
  createConnectFourState,
  deriveConnectFourStartingSeat,
  getConnectFourWinningCells,
  hashConnectFourState,
  type ConnectFourSeat,
  type ConnectFourState,
} from './connectFour';

const play = (columns: number[]): ConnectFourState => {
  let state = createConnectFourState(1);
  for (const column of columns) {
    state = applyConnectFourMove(state, state.nextSeat, column);
  }
  return state;
};

describe('Qonnect Four rules', () => {
  it('drops pieces from the bottom and rejects a full column', () => {
    const state = play([0, 0, 0, 0, 0, 0]);
    expect(connectFourDropRow(state, 0)).toBeNull();
    expect(() => applyConnectFourMove(state, state.nextSeat, 0)).toThrow(
      'not playable'
    );
  });

  it.each([
    ['horizontal', [0, 0, 1, 1, 2, 2, 3]],
    ['vertical', [0, 1, 0, 1, 0, 1, 0]],
    ['ascending diagonal', [0, 1, 1, 2, 4, 2, 2, 3, 4, 3, 5, 3, 3]],
    ['descending diagonal', [3, 2, 2, 1, 5, 1, 1, 0, 5, 0, 6, 0, 0]],
  ])('detects a %s win', (_name, columns) => {
    const state = play(columns as number[]);
    expect(state.outcome).toEqual({ type: 'win', winner: 1 });
    expect(getConnectFourWinningCells(state)).toHaveLength(4);
  });

  it('returns no winning cells before a win', () => {
    expect(getConnectFourWinningCells(play([0, 1, 2]))).toEqual([]);
  });

  it('rejects moves from the wrong seat', () => {
    expect(() => applyConnectFourMove(createConnectFourState(1), 2, 0)).toThrow(
      'not this player'
    );
  });

  it('detects a full-board draw', () => {
    const state = play([
      1, 2, 4, 4, 4, 3, 2, 2, 5, 2, 5, 1, 1, 6, 6, 2, 3, 3, 0, 1, 4, 3, 0, 3, 2,
      0, 1, 6, 0, 1, 3, 0, 6, 5, 5, 5, 5, 0, 4, 6, 6, 4,
    ]);
    expect(state.ply).toBe(42);
    expect(state.outcome).toEqual({ type: 'draw' });
  });

  it('hashes equivalent states identically and changed states differently', async () => {
    const a = play([0, 1, 0]);
    const b = play([0, 1, 0]);
    const c = play([0, 1, 2]);
    await expect(hashConnectFourState(a)).resolves.toBe(
      await hashConnectFourState(b)
    );
    await expect(hashConnectFourState(c)).resolves.not.toBe(
      await hashConnectFourState(a)
    );
  });

  it('matches the Python initial-state hash fixture', async () => {
    await expect(hashConnectFourState(createConnectFourState(1))).resolves.toBe(
      'c095c107701a8a8137e036b8e917173b93663115cde740dd29500c600ca77aaf'
    );
  });

  it('derives a deterministic valid starting seat', async () => {
    const args = [
      '00112233-4455-6677-8899-aabbccddeeff',
      '00112233445566778899aabbccddeeff',
      'ffeeddccbbaa99887766554433221100',
    ] as const;
    const first = await deriveConnectFourStartingSeat(...args);
    expect([1, 2]).toContain(first as ConnectFourSeat);
    await expect(deriveConnectFourStartingSeat(...args)).resolves.toBe(first);
  });
});

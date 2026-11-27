import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createCheckersState, type CheckersState } from './checkers';
import { CheckersGameDialog } from './CheckersGameDialog';
import type { QortalLandGameMatchView } from './useQortalLandGame';

const matchWith = (state: CheckersState): QortalLandGameMatchView => ({
  game: 'checkers',
  matchId: crypto.randomUUID(),
  roundId: crypto.randomUUID(),
  requesterAddress: 'Q-local',
  recipientAddress: 'Q-remote',
  requesterNonce: '11'.repeat(16),
  phase: 'active',
  localSeat: 1,
  startingSeat: 1,
  state,
  stateHash: '00'.repeat(32),
  moves: [],
  chatMessages: [],
});

const renderGame = (
  state = createCheckersState(1),
  onPlayMove = vi.fn().mockResolvedValue(true),
  matchOverrides: Partial<QortalLandGameMatchView> = {}
) => {
  render(
    <CheckersGameDialog
      address="Q-local"
      match={{ ...matchWith(state), ...matchOverrides }}
      now={Date.now()}
      transportReady
      onClose={vi.fn()}
      onPlayMove={onPlayMove}
      onRematch={vi.fn()}
      onResign={vi.fn()}
      onRespond={vi.fn()}
      onSendChat={() => true}
      onTyping={vi.fn()}
      resolvePlayerName={() => 'Opponent'}
    />
  );
  return onPlayMove;
};

describe('Checkers game dialog', () => {
  it('shows immediate feedback while opening the private game link', () => {
    renderGame(createCheckersState(1), vi.fn(), {
      phase: 'opening',
      state: undefined,
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText('Preparing the Checkers game…')
    ).toBeInTheDocument();
  });

  it('renders an accessible 64-square board and plays a selected move', async () => {
    const play = renderGame();
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 6, column 1, your piece/i })
    );
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 5, column 2, empty/i })
    );
    await waitFor(() => expect(play).toHaveBeenCalledWith(40, [33]));
  });

  it('switches to another legal piece before choosing a destination', async () => {
    const play = renderGame();
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 6, column 1, your piece/i })
    );
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 6, column 3, your piece/i })
    );
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 5, column 4, empty/i })
    );
    await waitFor(() => expect(play).toHaveBeenCalledWith(42, [35]));
  });

  it('explains why a different piece cannot move during a mandatory capture', () => {
    const state: CheckersState = {
      board: Array(64).fill(0),
      nextSeat: 1,
      ply: 0,
      quietPly: 0,
      outcome: null,
    };
    state.board[42] = 1;
    state.board[33] = 2;
    state.board[46] = 1;
    renderGame(state);
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 6, column 7, your piece/i })
    );
    expect(
      screen.getByText('A highlighted piece must make the available capture.')
    ).toBeInTheDocument();
  });

  it('announces when a capture is mandatory', () => {
    const state: CheckersState = {
      board: Array(64).fill(0),
      nextSeat: 1,
      ply: 0,
      quietPly: 0,
      outcome: null,
    };
    state.board[42] = 1;
    state.board[33] = 2;
    renderGame(state);
    expect(screen.getByText('Capture required')).toBeInTheDocument();
  });

  it('previews and completes every landing in a chained jump', async () => {
    const state: CheckersState = {
      board: Array(64).fill(0),
      nextSeat: 1,
      ply: 0,
      quietPly: 0,
      outcome: null,
    };
    state.board[42] = 1;
    state.board[33] = 2;
    state.board[17] = 2;
    const play = renderGame(state);
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 6, column 3, your piece/i })
    );
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 4, column 1, empty/i })
    );
    expect(
      screen.getByRole('gridcell', { name: /Row 6, column 3, empty/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('gridcell', { name: /Row 4, column 1, your piece/i })
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 2, column 3, empty/i })
    );
    await waitFor(() => expect(play).toHaveBeenCalledWith(42, [24, 10]));
  });

  it('keeps private chat available after the game ends', () => {
    const state = createCheckersState(1);
    state.outcome = { type: 'win', winner: 1 };
    renderGame(state, vi.fn().mockResolvedValue(true), {
      phase: 'finished',
      outcome: state.outcome,
    });

    expect(
      screen.getByRole('textbox', { name: 'Game chat message' })
    ).toBeEnabled();
  });
});

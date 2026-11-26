import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChessState, type ChessState } from './chess';
import { ChessGameDialog } from './ChessGameDialog';
import type { QortalLandGameMatchView } from './useQortalLandGame';

const matchWith = (state: ChessState): QortalLandGameMatchView => ({
  game: 'chess',
  matchId: crypto.randomUUID(),
  roundId: crypto.randomUUID(),
  requesterAddress: 'Q-local',
  recipientAddress: 'Q-remote',
  requesterNonce: '11'.repeat(16),
  phase: 'active',
  localSeat: 1,
  startingSeat: state.whiteSeat,
  state,
  stateHash: '00'.repeat(32),
  moves: [],
  chatMessages: [],
});

const renderGame = (
  state = createChessState(1),
  onPlayMove = vi.fn().mockResolvedValue(true),
  onResign = vi.fn(),
  matchOverrides: Partial<QortalLandGameMatchView> = {}
) => {
  render(
    <ChessGameDialog
      address="Q-local"
      match={{ ...matchWith(state), ...matchOverrides }}
      now={Date.now()}
      transportReady
      onClose={vi.fn()}
      onPlayMove={onPlayMove}
      onRematch={vi.fn()}
      onResign={onResign}
      onRespond={vi.fn()}
      onSendChat={() => true}
      onTyping={vi.fn()}
      resolvePlayerName={() => 'Opponent'}
    />
  );
  return { onPlayMove, onResign };
};

describe('Chess game dialog', () => {
  it('shows immediate feedback while opening the private game link', () => {
    renderGame(createChessState(1), vi.fn(), vi.fn(), {
      phase: 'opening',
      state: undefined,
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Preparing the Chess game...')).toBeInTheDocument();
  });

  it('renders an accessible board and submits a legal move', async () => {
    const { onPlayMove: play } = renderGame();
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 7, column 5, your pawn/i })
    );
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 5, column 5, empty/i })
    );
    await waitFor(() => expect(play).toHaveBeenCalledWith(52, 36));
  });

  it('allows switching to another movable piece', async () => {
    const { onPlayMove: play } = renderGame();
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 7, column 5, your pawn/i })
    );
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 7, column 4, your pawn/i })
    );
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 6, column 4, empty/i })
    );
    await waitFor(() => expect(play).toHaveBeenCalledWith(51, 43));
  });

  it('asks which piece to use for promotion', async () => {
    const state: ChessState = {
      board: Array(64).fill(0),
      nextSeat: 1,
      whiteSeat: 1,
      ply: 0,
      halfmoveClock: 0,
      castlingRights: [false, false, false, false],
      enPassant: null,
      outcome: null,
    };
    state.board[60] = 6;
    state.board[7] = -6;
    state.board[8] = 1;
    const { onPlayMove: play } = renderGame(state);
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 2, column 1, your pawn/i })
    );
    fireEvent.click(
      screen.getByRole('gridcell', { name: /Row 1, column 1, empty/i })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Promote to queen' }));
    await waitFor(() => expect(play).toHaveBeenCalledWith(8, 0, 5));
  });

  it('shows captured pieces and raw material difference in the player rows', () => {
    const state = createChessState(1);
    state.board[11] = 0;
    state.ply = 1;
    renderGame(state);
    expect(
      screen.getByLabelText(
        /You, white\. Captured: 1 pawn\. Material advantage: plus 1/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        /Opponent, black\. No pieces captured\. Material disadvantage: minus 1/i
      )
    ).toBeInTheDocument();
  });

  it('requires the in-game confirmation before resigning', () => {
    const onResign = vi.fn();
    renderGame(createChessState(1), vi.fn().mockResolvedValue(true), onResign);
    fireEvent.click(screen.getByRole('button', { name: 'RESIGN' }));
    expect(onResign).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('dialog', {
      name: 'Resign this game?',
    });
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Resign' })
    );
    expect(onResign).toHaveBeenCalledTimes(1);
  });

  it('keeps private chat available after the game ends', () => {
    const state = createChessState(1);
    state.outcome = { type: 'win', winner: 1 };
    renderGame(state, vi.fn().mockResolvedValue(true), vi.fn(), {
      phase: 'finished',
      outcome: state.outcome,
    });

    expect(
      screen.getByRole('textbox', { name: 'Game chat message' })
    ).toBeEnabled();
  });
});

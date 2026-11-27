import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createConnectFourState, type ConnectFourState } from './connectFour';
import {
  ConnectFourGameDialog,
  type ConnectFourGameView,
} from './ConnectFourGameDialog';
import { canSignQortalLandGameHandshake } from './useQortalLandGame';

const address = 'Qlocal1111111111111111111111111111111';
const opponent = 'Qremote111111111111111111111111111111';

const match = (
  state: ConnectFourState = createConnectFourState(1)
): ConnectFourGameView => ({
  matchId: '00112233-4455-6677-8899-aabbccddeeff',
  roundId: '00112233-4455-6677-8899-aabbccddeeff',
  requesterAddress: address,
  recipientAddress: opponent,
  requesterNonce: '11'.repeat(16),
  recipientNonce: '22'.repeat(16),
  requesterName: 'You',
  recipientName: 'Rival',
  phase: 'active',
  localSeat: 1,
  startingSeat: 1,
  state,
  stateHash: 'aa'.repeat(32),
  moves: [],
  chatMessages: [],
});

const renderGame = (
  current: ConnectFourGameView,
  overrides: Partial<React.ComponentProps<typeof ConnectFourGameDialog>> = {}
) => {
  const onPlayColumn = vi.fn(async () => true);
  const props: React.ComponentProps<typeof ConnectFourGameDialog> = {
    address,
    match: current,
    now: Date.now(),
    transportReady: true,
    onClose: vi.fn(),
    onPlayColumn,
    onRematch: vi.fn(),
    onResign: vi.fn(),
    onRespond: vi.fn(),
    onSendChat: vi.fn(() => true),
    onTyping: vi.fn(),
    ...overrides,
  };
  render(<ConnectFourGameDialog {...props} />);
  return { ...props, onPlayColumn };
};

describe('Qonnect Four game dialog', () => {
  it('only signs reconnect handshakes for the current round', () => {
    const current = match();
    const publicKey = 'public-key';
    const fields = {
      type: 'QORTAL_LAND_GAME_RESUME_REQUEST',
      matchId: current.matchId,
      roundId: current.roundId,
      requesterAddress: address,
      signerPublicKey: publicKey,
      lastAcknowledgedPly: 0,
    };
    expect(
      canSignQortalLandGameHandshake(fields, current, address, publicKey)
    ).toBe(true);
    expect(
      canSignQortalLandGameHandshake(
        { ...fields, roundId: crypto.randomUUID() },
        current,
        address,
        publicKey
      )
    ).toBe(false);
  });

  it('offers keyboard-accessible columns and submits the selected column', async () => {
    const { onPlayColumn } = renderGame(match());
    const column = screen.getByRole('button', {
      name: 'Play column 4, 6 spaces available',
    });

    fireEvent.focus(column);
    fireEvent.click(column);

    await waitFor(() => expect(onPlayColumn).toHaveBeenCalledWith(3));
    expect(screen.getByText('Your turn')).toBeTruthy();
    expect(
      screen.getByRole('grid', { name: 'Qonnect Four board' })
    ).toBeTruthy();
  });

  it('moves the active column with arrows even when the board was not focused', async () => {
    const { onPlayColumn } = renderGame(match());

    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'Play column 4, 6 spaces available'
      )
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Play column 5, 6 spaces available'
    );
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(onPlayColumn).toHaveBeenCalledWith(4));
  });

  it('does not submit a full column', () => {
    const state = createConnectFourState(1);
    for (let row = 0; row < 6; row += 1)
      state.board[row * 7] = row % 2 === 0 ? 1 : 2;
    const { onPlayColumn } = renderGame(match(state));

    fireEvent.click(
      screen.getByRole('button', { name: 'Play column 1, 0 spaces available' })
    );

    expect(onPlayColumn).not.toHaveBeenCalled();
  });

  it('keeps the board visible and paused while reconnecting', () => {
    renderGame({
      ...match(),
      phase: 'reconnecting',
      reconnectDeadline: Date.now() + 18_000,
    });

    expect(screen.getByText('Game paused')).toBeTruthy();
    expect(
      screen.getByText(/Connection interrupted — reconnecting/)
    ).toBeTruthy();
    expect(
      screen.getByRole('grid', { name: 'Qonnect Four board' })
    ).toBeTruthy();
  });

  it('reserves a fixed status line while a move is awaiting acknowledgement', () => {
    const current = match({ ...createConnectFourState(2), ply: 1 });
    renderGame({ ...current, pendingMoveId: crypto.randomUUID() });

    const status = screen.getByTestId('connect-four-board-status');
    expect(status).toHaveTextContent('Move placed — waiting for confirmation…');
    expect(status).toHaveStyle({ lineHeight: '15px', minHeight: '15px' });
  });

  it('shows the final summary and offers a rematch', () => {
    const onRematch = vi.fn();
    const finished = match({
      ...createConnectFourState(2),
      ply: 7,
      outcome: { type: 'win', winner: 1 },
    });
    renderGame(
      {
        ...finished,
        phase: 'finished',
        outcome: finished.state?.outcome || undefined,
      },
      { onRematch }
    );

    expect(screen.getAllByText('You won!').length).toBeGreaterThan(0);
    expect(screen.getByText(/7 moves against Rival/)).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'Game chat message' })
    ).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Play again/i }));
    expect(onRematch).toHaveBeenCalledOnce();
  });

  it('disables chat and rematch after the reusable session has closed', () => {
    const finished = match({
      ...createConnectFourState(2),
      outcome: { type: 'draw' },
    });
    renderGame({
      ...finished,
      phase: 'finished',
      outcome: { type: 'draw' },
      sessionClosed: true,
    });

    expect(screen.getByRole('button', { name: /Play again/i })).toBeDisabled();
    expect(
      screen.getByRole('textbox', { name: 'Game chat message' })
    ).toBeDisabled();
  });

  it('sends temporary chat and reports typing without triggering a move', async () => {
    const onSendChat = vi.fn(() => true);
    const onTyping = vi.fn();
    const { onPlayColumn } = renderGame(match(), { onSendChat, onTyping });
    const input = screen.getByRole('textbox', { name: 'Game chat message' });

    fireEvent.change(input, { target: { value: 'Good luck 🙂' } });
    expect(onTyping).toHaveBeenCalledWith(true);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSendChat).toHaveBeenCalledWith('Good luck 🙂');
    expect(onTyping).toHaveBeenCalledWith(false);
    expect(onPlayColumn).not.toHaveBeenCalled();
  });
});

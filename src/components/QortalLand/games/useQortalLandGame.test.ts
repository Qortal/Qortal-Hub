import { describe, expect, it } from 'vitest';
import {
  canSignQortalLandGameHandshake,
  isRetryableQortalLandGameTransportError,
  seatForIncomingQortalLandGameMove,
} from './useQortalLandGame';

const routeFields = {
  sourceSessionId: 'source-session',
  targetSessionId: 'target-session',
  sourceDestinationHash: '11'.repeat(16),
  targetDestinationHash: '22'.repeat(16),
};

const match = {
  matchId: '00112233-4455-6677-8899-aabbccddeeff',
  requesterAddress: 'Q-requester',
  recipientAddress: 'Q-recipient',
  requesterSessionId: routeFields.sourceSessionId,
  recipientSessionId: routeFields.targetSessionId,
  requesterDestinationHash: routeFields.sourceDestinationHash,
  recipientDestinationHash: routeFields.targetDestinationHash,
  requesterNonce: '11'.repeat(16),
  phase: 'opening' as const,
  moves: [],
};

describe('Qortal Land game handshake signing guard', () => {
  it('allows the locally challenged outgoing invitation', () => {
    expect(
      canSignQortalLandGameHandshake(
        {
          type: 'QORTAL_LAND_GAME_INVITE',
          matchId: match.matchId,
          requesterAddress: match.requesterAddress,
          recipientAddress: match.recipientAddress,
          ...routeFields,
          signerPublicKey: 'public-key',
          requesterNonce: match.requesterNonce,
          protocolVersion: 2,
          game: 'connect-four',
          gameVersion: 1,
          rulesVersion: 1,
        },
        match,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(true);
  });

  it('binds a Checkers signature request to a Checkers challenge', () => {
    const checkersMatch = { ...match, game: 'checkers' as const };
    const fields = {
      type: 'QORTAL_LAND_GAME_INVITE',
      matchId: match.matchId,
      requesterAddress: match.requesterAddress,
      recipientAddress: match.recipientAddress,
      ...routeFields,
      signerPublicKey: 'public-key',
      requesterNonce: match.requesterNonce,
      protocolVersion: 2,
      game: 'checkers',
      gameVersion: 1,
      rulesVersion: 1,
    };
    expect(
      canSignQortalLandGameHandshake(
        fields,
        checkersMatch,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(true);
    expect(
      canSignQortalLandGameHandshake(
        { ...fields, game: 'connect-four' },
        checkersMatch,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
  });

  it('binds a Chess signature request to a Chess challenge', () => {
    const chessMatch = { ...match, game: 'chess' as const };
    const fields = {
      type: 'QORTAL_LAND_GAME_INVITE',
      matchId: match.matchId,
      requesterAddress: match.requesterAddress,
      recipientAddress: match.recipientAddress,
      ...routeFields,
      signerPublicKey: 'public-key',
      requesterNonce: match.requesterNonce,
      protocolVersion: 2,
      game: 'chess',
      gameVersion: 1,
      rulesVersion: 1,
    };
    expect(
      canSignQortalLandGameHandshake(
        fields,
        chessMatch,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(true);
    expect(
      canSignQortalLandGameHandshake(
        { ...fields, game: 'checkers' },
        chessMatch,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
  });

  it("enforces the current game's move limit on resume signatures", () => {
    const fields = {
      type: 'QORTAL_LAND_GAME_RESUME_REQUEST',
      matchId: match.matchId,
      roundId: match.matchId,
      requesterAddress: match.requesterAddress,
      signerPublicKey: 'public-key',
      lastAcknowledgedPly: 43,
      ...routeFields,
    };
    expect(
      canSignQortalLandGameHandshake(
        fields,
        { ...match, game: 'connect-four' as const, roundId: match.matchId },
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
    expect(
      canSignQortalLandGameHandshake(
        { ...fields, lastAcknowledgedPly: 600 },
        { ...match, game: 'chess' as const, roundId: match.matchId },
        match.requesterAddress,
        'public-key'
      )
    ).toBe(true);
    expect(
      canSignQortalLandGameHandshake(
        { ...fields, lastAcknowledgedPly: 601 },
        { ...match, game: 'chess' as const, roundId: match.matchId },
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
  });

  it('rejects a changed match, recipient, or signer key', () => {
    const fields = {
      type: 'QORTAL_LAND_GAME_INVITE',
      matchId: match.matchId,
      requesterAddress: match.requesterAddress,
      recipientAddress: match.recipientAddress,
      ...routeFields,
      signerPublicKey: 'public-key',
      requesterNonce: match.requesterNonce,
      protocolVersion: 2,
      game: 'connect-four',
      gameVersion: 1,
      rulesVersion: 1,
    };
    expect(
      canSignQortalLandGameHandshake(
        { ...fields, matchId: 'other' },
        match,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
    expect(
      canSignQortalLandGameHandshake(
        { ...fields, recipientAddress: 'Q-other' },
        match,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
    expect(
      canSignQortalLandGameHandshake(
        { ...fields, signerPublicKey: 'other' },
        match,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
    expect(
      canSignQortalLandGameHandshake(
        { ...fields, targetSessionId: 'other-session' },
        match,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
    expect(
      canSignQortalLandGameHandshake(
        { ...fields, targetDestinationHash: '33'.repeat(16) },
        match,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
  });

  it('allows only local busy/superseded declines without replacing the active match', () => {
    expect(
      canSignQortalLandGameHandshake(
        {
          type: 'QORTAL_LAND_GAME_DECLINE',
          matchId: 'crossed-match',
          responderAddress: match.requesterAddress,
          signerPublicKey: 'public-key',
          reason: 'busy',
        },
        match,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(true);
    expect(
      canSignQortalLandGameHandshake(
        {
          type: 'QORTAL_LAND_GAME_DECLINE',
          matchId: 'crossed-match',
          responderAddress: 'Q-other',
          signerPublicKey: 'public-key',
          reason: 'busy',
        },
        match,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
  });

  it('signs confirmation only after the verified recipient nonce is known', () => {
    const fields = {
      type: 'QORTAL_LAND_GAME_CONFIRM',
      matchId: match.matchId,
      requesterAddress: match.requesterAddress,
      requesterNonce: match.requesterNonce,
      recipientNonce: '22'.repeat(16),
      signerPublicKey: 'public-key',
    };
    expect(
      canSignQortalLandGameHandshake(
        fields,
        match,
        match.requesterAddress,
        'public-key'
      )
    ).toBe(false);
    expect(
      canSignQortalLandGameHandshake(
        fields,
        { ...match, recipientNonce: fields.recipientNonce },
        match.requesterAddress,
        'public-key'
      )
    ).toBe(true);
  });
});

describe('Qortal Land temporary game transport failures', () => {
  it('recognizes the Reticulum channel backpressure errors', () => {
    expect(
      isRetryableQortalLandGameTransportError(
        "('Link is not ready',)",
        'active'
      )
    ).toBe(true);
    expect(
      isRetryableQortalLandGameTransportError(
        "('Outlet did not transmit packet',)",
        'active'
      )
    ).toBe(true);
    expect(
      isRetryableQortalLandGameTransportError('channel_send_failed', 'active')
    ).toBe(true);
  });

  it('replays a sync move using the turn encoded by the verified state', () => {
    const state = { nextSeat: 1 } as Parameters<
      typeof seatForIncomingQortalLandGameMove
    >[1];
    expect(seatForIncomingQortalLandGameMove('MOVE', state, 1)).toBe(2);
    expect(seatForIncomingQortalLandGameMove('SYNC_MOVE', state, 1)).toBe(1);
  });

  it('only treats an inactive match as temporary while reconnecting', () => {
    expect(
      isRetryableQortalLandGameTransportError(
        'match_not_active',
        'reconnecting'
      )
    ).toBe(true);
    expect(
      isRetryableQortalLandGameTransportError('match_not_active', 'active')
    ).toBe(false);
  });

  it('does not hide genuine command or protocol errors', () => {
    expect(
      isRetryableQortalLandGameTransportError('state_hash_mismatch', 'active')
    ).toBe(false);
    expect(
      isRetryableQortalLandGameTransportError('invalid_move', 'active')
    ).toBe(false);
  });
});

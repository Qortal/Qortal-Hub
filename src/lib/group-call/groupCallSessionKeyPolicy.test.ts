import { describe, expect, it } from 'vitest';
import {
  getSessionUpdatedKeyRecoveryAction,
  resolveDesignatedRootForSessionKey,
  shouldAcceptIncomingRoomKeySenderRelaxed,
  shouldAllowSimultaneousJoinKeyFallback,
} from './groupCallSessionKeyPolicy';

describe('groupCallSessionKeyPolicy', () => {
  it('prefers recovery when a non-root peer receives session-updated', () => {
    expect(
      getSessionUpdatedKeyRecoveryAction({
        myAddress: 'Qme',
        isLocalRoot: false,
        hasOwnedRoomKey: false,
        designatedRoot: 'Qroot',
        otherParticipantCount: 1,
        nowMs: 10_000,
        authoritySettleUntilMs: 9_000,
        pendingVerifiedKeyCount: 0,
        lastRemoteDecodeAtMs: 0,
        decryptFailureStreak: 0,
      })
    ).toBe('request-recovery');
  });

  it('accepts the remote root key while awaiting authoritative delivery', () => {
    expect(
      shouldAcceptIncomingRoomKeySenderRelaxed({
        currentRoot: 'Qme',
        senderAddress: 'Qroot',
        senderInRoster: true,
        awaitingAuthoritativeKey: true,
        myAddress: 'Qme',
        trustedRemoteRoot: 'Qroot',
        designatedRoot: null,
        participantCount: 2,
      })
    ).toBe(true);
  });

  it('blocks simultaneous-join minting while remote media is still recent', () => {
    expect(
      shouldAllowSimultaneousJoinKeyFallback({
        myAddress: 'Qroot',
        designatedRoot: 'Qroot',
        otherParticipantCount: 0,
        trustedRemoteRoot: null,
        conflictingRemoteRoot: null,
        nowMs: 10_000,
        authoritySettleUntilMs: 9_000,
        lastRemoteDecodeAtMs: 9_500,
      })
    ).toBe(false);
  });

  it('prefers the topology root over digest winner for session key authority', () => {
    expect(
      resolveDesignatedRootForSessionKey({
        rosterAddresses: ['Qa', 'Qb'],
        electionDigests: new Map([
          ['Qa', 'ff'],
          ['Qb', '00'],
        ]),
        topologyRootForwarder: 'Qa',
      })
    ).toBe('Qa');
  });
});

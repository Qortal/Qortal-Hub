import { describe, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl';
import {
  deriveAddressFromPublicKey,
  encodeBytesBase58,
  PresenceManager,
  RETICULUM_OVERLAY_MAX_NEIGHBORS,
  RETICULUM_VERIFIED_PEER_LINK_CLOSE_GRACE_MS,
} from './presence';

function promoteVerifiedPeers(
  manager: PresenceManager,
  count: number,
  startAt: number = 0
): string[] {
  const hashes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const suffix = String(i + startAt).padStart(2, '0');
    const hash = `peer-${suffix}`;
    hashes.push(hash);
    (manager as any).promoteVerifiedReticulumPeer(
      hash,
      `Q-address-${suffix}`,
      1_000 + i + startAt
    );
  }
  return hashes;
}

describe('PresenceManager Reticulum overlay mesh slots', () => {
  it('skips exact duplicate envelopes before signature verification', async () => {
    const manager = new PresenceManager();
    const verify = vi.fn(async () => true);
    (manager as any).verifyPool = { verify };

    const keyPair = nacl.sign.keyPair();
    const publicKey = encodeBytesBase58(keyPair.publicKey);
    const address = deriveAddressFromPublicKey(publicKey);
    const envelope = {
      id: 'duplicate-heartbeat',
      type: 'PRESENCE_HEARTBEAT',
      senderAddress: address,
      timestamp: Date.now(),
      payload: {
        address,
        publicKey,
        sessionId: 'duplicate-session',
        status: 'online',
      },
      signature: 'sig',
    };

    await expect(
      manager.handleEnvelope(envelope, {
        kind: 'reticulum',
        destinationHash: 'origin-hash',
      })
    ).resolves.toBe(true);
    await expect(
      manager.handleEnvelope(envelope, {
        kind: 'reticulum',
        destinationHash: 'forwarder-hash',
        viaDestinationHash: 'origin-hash',
      })
    ).resolves.toBe(false);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(manager.isAddressOnline(address)).toBe(true);
  });

  it('does not let an older offline envelope remove a newer live session', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_001);
    const manager = new PresenceManager();
    const address = 'Q-session-order';
    const sessionId = 'session-order';
    const publicKey = 'pk-session-order';

    const newerHeartbeat = {
      id: 'heartbeat-newer',
      type: 'PRESENCE_HEARTBEAT',
      senderAddress: address,
      timestamp: 2_000,
      payload: {
        address,
        publicKey,
        sessionId,
        status: 'online',
      },
      signature: 'sig',
    };
    const olderOffline = {
      id: 'offline-older',
      type: 'PRESENCE_OFFLINE',
      senderAddress: address,
      timestamp: 1_999,
      payload: {
        address,
        publicKey,
        sessionId,
        status: 'offline',
      },
      signature: 'sig',
    };

    expect(
      (manager as any).applyVerifiedPresenceEnvelope(newerHeartbeat, { kind: 'local' }, 2_000)
    ).toBe(true);
    expect(manager.isAddressOnline(address)).toBe(true);

    expect(
      (manager as any).applyVerifiedPresenceEnvelope(olderOffline, { kind: 'local' }, 2_001)
    ).toBe(false);
    expect(manager.isAddressOnline(address)).toBe(true);
    vi.useRealTimers();
  });

  it('latches verified overlay identity on first envelope; later messages do not churn mesh', () => {
    const manager = new PresenceManager();
    (manager as any).promoteVerifiedReticulumPeer('peer-hash', 'Q-first', 1000);
    expect(
      manager.getReticulumVerifiedPeers().find((p) => p.destinationHash === 'peer-hash')?.address
    ).toBe('Q-first');
    const neighbors1 = manager.getReticulumVerifiedNeighborHashes();
    (manager as any).promoteVerifiedReticulumPeer('peer-hash', 'Q-second', 2000);
    expect(
      manager.getReticulumVerifiedPeers().find((p) => p.destinationHash === 'peer-hash')?.address
    ).toBe('Q-first');
    expect(manager.getReticulumVerifiedNeighborHashes()).toEqual(neighbors1);
  });

  it('admits a fanned-out presence origin as verified Qortal overlay traffic', () => {
    const manager = new PresenceManager();
    const now = Date.now();
    const envelope = {
      id: 'forwarded-heartbeat',
      type: 'PRESENCE_HEARTBEAT',
      senderAddress: 'Q-forwarded',
      timestamp: now,
      payload: {
        address: 'Q-forwarded',
        publicKey: 'pk-forwarded',
        sessionId: 'sid-forwarded',
        status: 'online',
      },
      signature: 'sig-forwarded',
    };

    expect(
      (manager as any).applyVerifiedPresenceEnvelope(
        envelope,
        {
          kind: 'reticulum',
          destinationHash: 'origin-hash',
          viaDestinationHash: 'forwarder-hash',
          overlayHopsRemaining: 2,
        },
        now
      )
    ).toBe(true);

    expect(manager.isAddressOnline('Q-forwarded')).toBe(true);
    expect(manager.getReticulumVerifiedPeers()).toEqual([
      {
        destinationHash: 'origin-hash',
        address: 'Q-forwarded',
        lastSeen: now,
      },
    ]);
    expect(manager.getReticulumVerifiedNeighborHashes()).toEqual(['origin-hash']);
  });

  it('verifies an overlay peer from non-presence Qortal traffic without relatching', () => {
    const manager = new PresenceManager();
    const verifiedEvents: unknown[] = [];
    manager.on('reticulum-peer-verified', (event) => verifiedEvents.push(event));

    manager.noteReticulumCandidateDiscovered('origin-hash', 'announce', 1_000);
    manager.markReticulumOverlayPeerVerified('origin-hash', 'group_signal', undefined, 2_000);

    expect(manager.getReticulumVerifiedPeers()).toEqual([
      {
        destinationHash: 'origin-hash',
        address: '',
        lastSeen: 2_000,
      },
    ]);
    expect(manager.getReticulumVerifiedNeighborHashes()).toEqual(['origin-hash']);
    expect(verifiedEvents).toHaveLength(1);

    manager.markReticulumOverlayPeerVerified('origin-hash', 'call_signal', undefined, 3_000);

    expect(manager.getReticulumVerifiedPeers()).toEqual([
      {
        destinationHash: 'origin-hash',
        address: '',
        lastSeen: 3_000,
      },
    ]);
    expect(verifiedEvents).toHaveLength(1);
  });

  it('allows a fanned-out presence proof to verify an announce-backed candidate', () => {
    const manager = new PresenceManager();
    const now = Date.now();
    manager.noteReticulumCandidateDiscovered('origin-hash', 'announce', now);
    const envelope = {
      id: 'announce-backed-heartbeat',
      type: 'PRESENCE_HEARTBEAT',
      senderAddress: 'Q-announced',
      timestamp: now + 1,
      payload: {
        address: 'Q-announced',
        publicKey: 'pk-announced',
        sessionId: 'sid-announced',
        status: 'online',
      },
      signature: 'sig-announced',
    };

    expect(
      (manager as any).applyVerifiedPresenceEnvelope(
        envelope,
        {
          kind: 'reticulum',
          destinationHash: 'origin-hash',
          viaDestinationHash: 'forwarder-hash',
          overlayHopsRemaining: 2,
        },
        now + 1
      )
    ).toBe(true);

    expect(manager.getReticulumVerifiedPeers()).toEqual([
      {
        destinationHash: 'origin-hash',
        address: 'Q-announced',
        lastSeen: now + 1,
      },
    ]);
    expect(manager.getReticulumVerifiedNeighborHashes()).toEqual(['origin-hash']);
  });

  it('keeps admitted verified peers stable after presence cleanup', () => {
    const manager = new PresenceManager();
    const hashes = promoteVerifiedPeers(manager, RETICULUM_OVERLAY_MAX_NEIGHBORS + 2);

    expect(manager.getReticulumVerifiedNeighborHashes()).toEqual(
      hashes.slice(0, RETICULUM_OVERLAY_MAX_NEIGHBORS)
    );

    manager.cleanupExpired();

    expect(manager.getReticulumVerifiedNeighborHashes()).toEqual(
      hashes.slice(0, RETICULUM_OVERLAY_MAX_NEIGHBORS)
    );
    expect(manager.getReticulumVerifiedPeers().map((peer) => peer.destinationHash)).toEqual(
      hashes
    );
  });

  it('retains a recently closed verified slot long enough to recover without churn', () => {
    const manager = new PresenceManager();
    const hashes = promoteVerifiedPeers(manager, RETICULUM_OVERLAY_MAX_NEIGHBORS + 1);

    vi.useFakeTimers();
    vi.setSystemTime(9_999);
    manager.noteReticulumOverlayLinkClosed(hashes[0], 'closed');

    expect(manager.getReticulumVerifiedPeers().map((peer) => peer.destinationHash)).toEqual(
      hashes
    );
    expect(manager.getReticulumVerifiedNeighborHashes()).toEqual(
      hashes.slice(0, RETICULUM_OVERLAY_MAX_NEIGHBORS)
    );

    vi.useRealTimers();
  });

  it('releases a closed verified slot after the grace window expires', () => {
    const manager = new PresenceManager();
    const hashes = promoteVerifiedPeers(manager, RETICULUM_OVERLAY_MAX_NEIGHBORS + 1);

    vi.useFakeTimers();
    vi.setSystemTime(9_999);
    manager.noteReticulumOverlayLinkClosed(hashes[0], 'closed');
    vi.setSystemTime(9_999 + RETICULUM_VERIFIED_PEER_LINK_CLOSE_GRACE_MS + 1);

    expect(manager.getReticulumVerifiedPeers().map((peer) => peer.destinationHash)).toEqual(
      hashes.slice(1)
    );
    expect(manager.getReticulumVerifiedNeighborHashes()).toEqual([
      ...hashes.slice(1, RETICULUM_OVERLAY_MAX_NEIGHBORS),
      hashes[RETICULUM_OVERLAY_MAX_NEIGHBORS],
    ]);

    vi.useRealTimers();
  });

  it('clears close-grace retention as soon as the peer is re-verified', () => {
    const manager = new PresenceManager();
    const hashes = promoteVerifiedPeers(manager, RETICULUM_OVERLAY_MAX_NEIGHBORS + 1);

    vi.useFakeTimers();
    vi.setSystemTime(9_999);
    manager.noteReticulumOverlayLinkClosed(hashes[0], 'closed');
    vi.setSystemTime(10_100);
    (manager as any).promoteVerifiedReticulumPeer(hashes[0], 'Q-address-00', 10_100);
    vi.setSystemTime(10_100 + RETICULUM_VERIFIED_PEER_LINK_CLOSE_GRACE_MS + 1);

    expect(manager.getReticulumVerifiedPeers().map((peer) => peer.destinationHash)).toEqual(
      hashes
    );
    expect(manager.getReticulumVerifiedNeighborHashes()).toEqual(
      hashes.slice(0, RETICULUM_OVERLAY_MAX_NEIGHBORS)
    );

    vi.useRealTimers();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
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

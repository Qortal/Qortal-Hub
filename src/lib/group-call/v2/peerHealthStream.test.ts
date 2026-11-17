/**
 * Tests for PeerHealthStream — the TTL-based peer health evidence system.
 *
 * Regression guards for the sticky-latch bug class:
 *  - Evidence MUST expire (no sticky latch)
 *  - Arriving packets MUST retire degradation evidence
 *  - Hard TTL MUST override evidence renewal
 */

import { test, expect } from 'vitest';
import { PeerHealthStream, EVIDENCE_TTL_PATH_TIMEOUT_MS } from './peerHealthStream';
import type { TransportEvidence } from './spec';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(
  kind: TransportEvidence['kind'],
  sourceAddr: string,
  nowMs: number,
  ttlMs?: number
): TransportEvidence {
  return {
    kind,
    sourceAddr,
    observedAtMs: nowMs,
    expiresAtMs: nowMs + (ttlMs ?? EVIDENCE_TTL_PATH_TIMEOUT_MS),
  };
}

// ---------------------------------------------------------------------------
// TTL expiry
// ---------------------------------------------------------------------------

test('PeerHealthStream: evidence expires and peer returns to healthy', async () => {
  let now = 0;
  const stream = new PeerHealthStream(() => now);

  stream.ingestEvidence(makeEvidence('path-timeout', 'peer-A', 0, 100));

  now = 50;
  expect(stream.getPeerHealth('peer-A')?.level).toBe('recovering');

  now = 200;
  // After expiry — no active evidence.
  expect(stream.getPeerHealth('peer-A')?.level).toBe('healthy');

  stream.dispose();
});

// ---------------------------------------------------------------------------
// Fresh packet arrival retires degradation evidence
// ---------------------------------------------------------------------------

test('PeerHealthStream: packet arrival retires degradation evidence immediately', () => {
  let now = 0;
  const stream = new PeerHealthStream(() => now);

  stream.ingestEvidence(makeEvidence('bridge-pressure', 'peer-A', 0, 10_000));
  now = 100;
  expect(stream.getPeerHealth('peer-A')?.level).not.toBe('healthy');

  // Packet arrives.
  stream.onStreamPacketReceived({ sourceAddr: 'peer-A', streamEpoch: 0, joinGeneration: 1 }, 42);

  now = 101;
  const health = stream.getPeerHealth('peer-A');
  expect(health?.freshLocalMediaConfirmed).toBe(true);
  expect(health?.level).toBe('healthy');

  stream.dispose();
});

// ---------------------------------------------------------------------------
// Listener notifications
// ---------------------------------------------------------------------------

test('PeerHealthStream: fires listener on health change', () => {
  let now = 0;
  const stream = new PeerHealthStream(() => now);
  const changes: string[] = [];

  stream.onPeerHealthChange((snap) => changes.push(`${snap.sourceAddr}:${snap.level}`));

  stream.ingestEvidence(makeEvidence('path-timeout', 'peer-A', 0, 100));
  expect(changes.length).toBeGreaterThanOrEqual(1);
  expect(changes[changes.length - 1]).toContain('peer-A');

  stream.dispose();
});

// ---------------------------------------------------------------------------
// Multiple peers are independent
// ---------------------------------------------------------------------------

test('PeerHealthStream: peer health is independent per sourceAddr', () => {
  let now = 0;
  const stream = new PeerHealthStream(() => now);

  stream.ingestEvidence(makeEvidence('bridge-pressure', 'peer-A', 0, 5_000));
  stream.ingestEvidence(makeEvidence('path-timeout', 'peer-B', 0, 5_000));
  stream.markHealthy('peer-C', 'test');

  now = 100;
  const a = stream.getPeerHealth('peer-A');
  const b = stream.getPeerHealth('peer-B');
  const c = stream.getPeerHealth('peer-C');

  expect(a?.level).not.toBe('healthy');
  expect(b?.level).not.toBe('healthy');
  expect(c?.level).toBe('healthy');

  stream.dispose();
});

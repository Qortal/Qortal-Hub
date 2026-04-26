/**
 * Tests for ReceivePolicyEngine — the explicit FSM at the heart of the v2 architecture.
 *
 * These tests are regression guards for the specific failure modes documented in
 * regressionFixtures.ts. They run without any browser APIs (no WebCodecs, no AudioDecoder).
 */

import { test, expect } from 'vitest';
import {
  ReceivePolicyEngine,
  DEFAULT_POLICY_CONFIG,
} from './receivePolicyEngine';
import type { PolicyTickInput } from './receivePolicyEngine';
import type { StreamIdentity, PeerHealthSnapshot } from './spec';

const STREAM_ID: StreamIdentity = {
  sourceAddr: 'peer-A',
  streamEpoch: 0,
  joinGeneration: 1,
};

function makePeerHealth(level: PeerHealthSnapshot['level'], freshMedia = true): PeerHealthSnapshot {
  return {
    sourceAddr: 'peer-A',
    level,
    evidenceExpiresAtMs: performance.now() + 10_000,
    observedAtMs: performance.now(),
    freshLocalMediaConfirmed: freshMedia,
  };
}

function makeInput(overrides: Partial<PolicyTickInput> = {}): PolicyTickInput {
  return {
    nowMs: performance.now(),
    streamId: STREAM_ID,
    jitterDepth: 4,
    opusBufferedMs: 80,
    pcmBufferedMs: 80,
    lastPushAgeMs: 10,
    lastGapFrames: 0,
    peerHealth: makePeerHealth('healthy'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// coldStart → steady
// ---------------------------------------------------------------------------

test('coldStart: holds playout until jitter fills to startThreshold', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID);
  expect(policy.state).toBe('coldStart');

  const out1 = policy.tick(makeInput({ jitterDepth: 3, opusBufferedMs: 60 }));
  expect(out1.holdPlayout).toBe(true);
  expect(policy.state).toBe('coldStart');

  const out2 = policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  expect(out2.holdPlayout).toBe(false);
  expect(policy.state).toBe('steady');
});

// ---------------------------------------------------------------------------
// steady → backlogDrain
// ---------------------------------------------------------------------------

test('steady: transitions to backlogDrain when opus > target * 1.0', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, { targetBufferMs: 120 });

  // Get to steady first.
  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  expect(policy.state).toBe('steady');

  // Push Opus above target.
  const out = policy.tick(makeInput({ jitterDepth: 10, opusBufferedMs: 125 }));
  expect(policy.state).toBe('backlogDrain');
  expect(out.aggressiveDrain).toBe(true);
  expect(out.maxDecodePerTick).toBeGreaterThanOrEqual(8);
});

test('steady: transitions to backlogDrain when pcm is thin but opus reserve exists', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    targetBufferMs: 120,
    pcmDeficitDrainThreshold: 0.65,
    pcmDeficitOpusMinRatio: 0.35,
  });

  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  expect(policy.state).toBe('steady');

  const out = policy.tick(
    makeInput({
      jitterDepth: 5,
      opusBufferedMs: 50,
      pcmBufferedMs: 70,
    })
  );
  expect(policy.state).toBe('backlogDrain');
  expect(out.aggressiveDrain).toBe(true);
});

test('steady: does NOT enter backlogDrain while decoded pcm latency is already high', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    targetBufferMs: 120,
    decodedPcmLatencyResumeRatio: 1.35,
  });

  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  expect(policy.state).toBe('steady');

  policy.tick(
    makeInput({
      jitterDepth: 10,
      opusBufferedMs: 140,
      pcmBufferedMs: 190,
    })
  );
  expect(policy.state).toBe('steady');
});

// ---------------------------------------------------------------------------
// backlogDrain → steady (core fix for call-63 trap)
// ---------------------------------------------------------------------------

test('backlogDrain: exits to steady when opus drained and pcm non-empty', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    targetBufferMs: 120,
    backlogDrainExitRatio: 0.45,
    backlogDrainExitMinPcmMs: 20,
    backlogDrainExitTargetFloorRatio: 0.6,
  });

  // Reach backlogDrain.
  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 })); // steady
  policy.tick(makeInput({ jitterDepth: 10, opusBufferedMs: 125 })); // backlogDrain
  expect(policy.state).toBe('backlogDrain');

  // Drain: opus falls below exit ratio, PCM healthy.
  const out = policy.tick(makeInput({
    jitterDepth: 2,
    opusBufferedMs: 50,  // < 120 * 0.45 = 54
    pcmBufferedMs: 80,   // >= max(20, 120 * 0.6)
  }));
  expect(policy.state).toBe('steady');
  expect(out.holdPlayout).toBe(false);
});

test('backlogDrain: does NOT exit when opus drained but pcm still empty', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    targetBufferMs: 120,
    backlogDrainExitMinPcmMs: 20,
    backlogDrainExitTargetFloorRatio: 0.6,
  });
  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  policy.tick(makeInput({ jitterDepth: 10, opusBufferedMs: 125 }));

  // Opus drained but PCM empty — NOT the call-63 scenario where we were stuck.
  // We can exit once PCM has at least some content.
  const out = policy.tick(makeInput({
    opusBufferedMs: 40,
    pcmBufferedMs: 0,  // Still empty
  }));
  // Should still be in backlogDrain, waiting for PCM.
  expect(policy.state).toBe('backlogDrain');
  expect(out.holdPlayout).toBe(false); // We DON'T hold playout in backlogDrain!
  expect(out.aggressiveDrain).toBe(true);
});

test('backlogDrain: does NOT exit while pcm is below target-relative floor', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    targetBufferMs: 120,
    backlogDrainExitMinPcmMs: 20,
    backlogDrainExitTargetFloorRatio: 0.6,
  });
  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  policy.tick(makeInput({ jitterDepth: 10, opusBufferedMs: 125 }));

  policy.tick(
    makeInput({
      opusBufferedMs: 40,
      pcmBufferedMs: 60,
    })
  );
  expect(policy.state).toBe('backlogDrain');
});

test('backlogDrain: exits when decoded pcm latency ceiling is exceeded', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    targetBufferMs: 120,
    decodedPcmLatencyCeilingRatio: 1.8,
  });
  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  policy.tick(makeInput({ jitterDepth: 10, opusBufferedMs: 125 }));
  expect(policy.state).toBe('backlogDrain');

  policy.tick(
    makeInput({
      opusBufferedMs: 140,
      pcmBufferedMs: 220,
    })
  );
  expect(policy.state).toBe('steady');
});

test('steady: delays backlogDrain re-entry briefly after a latency-cap exit', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    targetBufferMs: 120,
    backlogDrainReentryCooldownMs: 120,
  });
  const nowBase = performance.now();

  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80, nowMs: nowBase }));
  policy.tick(makeInput({ jitterDepth: 10, opusBufferedMs: 140, nowMs: nowBase + 20 }));
  expect(policy.state).toBe('backlogDrain');

  policy.tick(
    makeInput({
      nowMs: nowBase + 40,
      opusBufferedMs: 140,
      pcmBufferedMs: 220,
    })
  );
  expect(policy.state).toBe('steady');

  policy.tick(
    makeInput({
      nowMs: nowBase + 80,
      jitterDepth: 10,
      opusBufferedMs: 140,
      pcmBufferedMs: 80,
    })
  );
  expect(policy.state).toBe('steady');

  policy.tick(
    makeInput({
      nowMs: nowBase + 170,
      jitterDepth: 10,
      opusBufferedMs: 140,
      pcmBufferedMs: 80,
    })
  );
  expect(policy.state).toBe('backlogDrain');
});

// ---------------------------------------------------------------------------
// transportDegraded TTL (core fix for sticky-latch bug)
// ---------------------------------------------------------------------------

test('transportDegraded: exits via hard TTL even if evidence is continuously renewed', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    targetBufferMs: 120,
    transportDegradedHardTtlMs: 100, // Short for testing
  });

  // Reach steady.
  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  expect(policy.state).toBe('steady');

  // Inject degraded health (no fresh media).
  const nowBase = performance.now();
  policy.tick(makeInput({
    peerHealth: makePeerHealth('degraded', false),
    nowMs: nowBase,
  }));
  expect(policy.state).toBe('transportDegraded');

  // Keep renewing evidence BUT do NOT confirm fresh media — should still exit at hard TTL.
  const outBefore = policy.tick(makeInput({
    peerHealth: makePeerHealth('degraded', false),
    nowMs: nowBase + 50,
  }));
  expect(policy.state).toBe('transportDegraded');

  // Hard TTL expires.
  const outAfter = policy.tick(makeInput({
    peerHealth: makePeerHealth('degraded', false),
    nowMs: nowBase + 110,  // > 100ms hard TTL
    opusBufferedMs: 30,    // No backlog, should go to steady
    pcmBufferedMs: 60,
  }));
  // Must have exited transportDegraded.
  expect(policy.state).not.toBe('transportDegraded');
  void outBefore; void outAfter;
});

test('transportDegraded: exits immediately when freshLocalMediaConfirmed', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    targetBufferMs: 120,
    transportDegradedHardTtlMs: 30_000,
  });

  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  const nowBase = performance.now();
  policy.tick(makeInput({
    peerHealth: makePeerHealth('degraded', false),
    nowMs: nowBase,
  }));
  expect(policy.state).toBe('transportDegraded');

  // Fresh media confirmed — should exit immediately without waiting for TTL.
  policy.tick(makeInput({
    peerHealth: makePeerHealth('healthy', true),
    nowMs: nowBase + 500,
    opusBufferedMs: 40,
    pcmBufferedMs: 60,
  }));
  expect(policy.state).toBe('steady');
});

// ---------------------------------------------------------------------------
// missingMedia transitions
// ---------------------------------------------------------------------------

test('missingMedia: transitions from steady when no packets for threshold', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    missingMediaThresholdMs: 500,
  });
  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  expect(policy.state).toBe('steady');

  const out = policy.tick(makeInput({ lastPushAgeMs: 600 }));
  expect(policy.state).toBe('missingMedia');
  expect(out.holdPlayout).toBe(true);
  expect(out.maxDecodePerTick).toBe(0);
});

test('missingMedia: restarts from coldStart when packets resume', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID, {
    missingMediaThresholdMs: 500,
  });
  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  policy.tick(makeInput({ lastPushAgeMs: 600 }));
  expect(policy.state).toBe('missingMedia');

  policy.tick(makeInput({ lastPushAgeMs: 10 }));
  expect(policy.state).toBe('coldStart');
});

// ---------------------------------------------------------------------------
// Seq-wrap safety (modulo arithmetic in ReceiveEngine)
// ---------------------------------------------------------------------------

test('ReceivePolicyEngine reset clears all state', () => {
  const policy = new ReceivePolicyEngine(STREAM_ID);
  policy.tick(makeInput({ jitterDepth: 4, opusBufferedMs: 80 }));
  expect(policy.state).toBe('steady');

  policy.reset();
  expect(policy.state).toBe('coldStart');
  expect(policy.getTransitionHistory()).toHaveLength(0);
});

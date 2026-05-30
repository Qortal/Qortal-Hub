import { describe, expect, it } from 'vitest';
import {
  choosePendingDecryptDropCandidate,
  computePendingDecryptPreOverloadClampMax,
  computePendingDecryptOverloadMax,
  computePendingDecryptLimits,
  computeRequestedBurstMaxFromSignals,
  shouldTreatPendingDecryptAsForwarder,
  shouldBypassDecryptWorkerOnHotQueue,
  shouldSyncDecodeForSmallSession,
  shouldPreemptivelyThrottlePendingDecrypt,
  GLOBAL_MAX_BURST_MAX,
  PENDING_DECRYPT_BURST_NOMINAL_BASE,
  PENDING_DECRYPT_BURST_TTL_MS,
  PENDING_DECRYPT_MAX,
  PENDING_DECRYPT_OVERLOAD_FORWARDER_MAX,
  PENDING_DECRYPT_OVERLOAD_MAX,
  PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MAX,
  PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MULTI_MAX,
  PENDING_DECRYPT_OVERLOAD_TTL_MS,
  PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_CLAMP_MAX,
  PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_SUSTAINED_DEPTH,
  PENDING_DECRYPT_PRE_OVERLOAD_TTL_MS,
  PENDING_DECRYPT_RECOVERY_MAX,
  PENDING_DECRYPT_RECOVERY_TTL_MS,
  PENDING_DECRYPT_TTL_MS,
  slewBurstMaxTowardRequested,
} from './pendingDecryptLimits';

describe('computePendingDecryptLimits', () => {
  it('uses steady-state limits when no recovery or burst window', () => {
    const now = 10_000;
    expect(computePendingDecryptLimits(now, 0, 0, PENDING_DECRYPT_BURST_NOMINAL_BASE)).toEqual(
      { max: PENDING_DECRYPT_MAX, ttlMs: PENDING_DECRYPT_TTL_MS }
    );
  });

  it('prefers burst limits over global recovery when both are active', () => {
    const now = 5_000;
    const globalUntil = 20_000;
    const burstUntil = 8_000;
    expect(
      computePendingDecryptLimits(now, globalUntil, burstUntil, PENDING_DECRYPT_BURST_NOMINAL_BASE)
    ).toEqual({
      max: PENDING_DECRYPT_BURST_NOMINAL_BASE,
      ttlMs: PENDING_DECRYPT_BURST_TTL_MS,
    });
  });

  it('uses recovery limits after burst expires but global recovery remains', () => {
    const now = 10_000;
    const globalUntil = 20_000;
    const burstUntil = 5_000;
    expect(
      computePendingDecryptLimits(now, globalUntil, burstUntil, PENDING_DECRYPT_BURST_NOMINAL_BASE)
    ).toEqual({
      max: PENDING_DECRYPT_RECOVERY_MAX,
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
    });
  });

  it('uses recovery limits when global recovery active and no burst', () => {
    const now = 10_000;
    const globalUntil = 20_000;
    expect(computePendingDecryptLimits(now, globalUntil, 0, PENDING_DECRYPT_BURST_NOMINAL_BASE)).toEqual({
      max: PENDING_DECRYPT_RECOVERY_MAX,
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
    });
  });

  it('treats boundary at exactly globalRecoveryUntilMs as steady state', () => {
    const t = 10_000;
    expect(computePendingDecryptLimits(t, t, 0, PENDING_DECRYPT_BURST_NOMINAL_BASE)).toEqual({
      max: PENDING_DECRYPT_MAX,
      ttlMs: PENDING_DECRYPT_TTL_MS,
    });
  });

  it('treats boundary at exactly decryptBurstUntilMs as recovery or steady', () => {
    const t = 10_000;
    expect(computePendingDecryptLimits(t, 0, t, PENDING_DECRYPT_BURST_NOMINAL_BASE)).toEqual({
      max: PENDING_DECRYPT_MAX,
      ttlMs: PENDING_DECRYPT_TTL_MS,
    });
  });

  it('clamps dynamic burst max to global ceiling', () => {
    const now = 10_000;
    expect(
      computePendingDecryptLimits(now, 0, 20_000, GLOBAL_MAX_BURST_MAX + 1_000)
    ).toEqual({
      max: GLOBAL_MAX_BURST_MAX,
      ttlMs: PENDING_DECRYPT_BURST_TTL_MS,
    });
  });

  it('uses dynamic burst limits while decrypt overload is active', () => {
    const now = 10_000;
    expect(
      computePendingDecryptLimits(now, 0, 0, PENDING_DECRYPT_BURST_NOMINAL_BASE, true)
    ).toEqual({
      max: PENDING_DECRYPT_OVERLOAD_MAX,
      ttlMs: PENDING_DECRYPT_OVERLOAD_TTL_MS,
    });
    expect(
      computePendingDecryptLimits(
        now,
        0,
        0,
        GLOBAL_MAX_BURST_MAX,
        true,
        PENDING_DECRYPT_OVERLOAD_FORWARDER_MAX
      )
    ).toEqual({
      max: PENDING_DECRYPT_OVERLOAD_FORWARDER_MAX,
      ttlMs: PENDING_DECRYPT_OVERLOAD_TTL_MS,
    });
  });

  it('scales steady/recovery/burst/overload caps linearly with pool size', () => {
    const now = 10_000;

    expect(
      computePendingDecryptLimits(
        now,
        0,
        0,
        PENDING_DECRYPT_BURST_NOMINAL_BASE,
        false,
        PENDING_DECRYPT_OVERLOAD_MAX,
        false,
        4
      )
    ).toEqual({ max: PENDING_DECRYPT_MAX * 4, ttlMs: PENDING_DECRYPT_TTL_MS });

    expect(
      computePendingDecryptLimits(
        now,
        20_000,
        0,
        PENDING_DECRYPT_BURST_NOMINAL_BASE,
        false,
        PENDING_DECRYPT_OVERLOAD_MAX,
        false,
        3
      )
    ).toEqual({
      max: PENDING_DECRYPT_RECOVERY_MAX * 3,
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
    });

    // Overload max is clamped by `min(overloadMax * mult, max(PENDING_MAX * mult, burst))`.
    // With a small effectiveBurstMax the cap follows overloadMax * mult.
    const overload2Small = computePendingDecryptLimits(
      now,
      0,
      0,
      /* effectiveBurstMax */ 0,
      true,
      PENDING_DECRYPT_OVERLOAD_MAX,
      false,
      2
    );
    expect(overload2Small.ttlMs).toBe(PENDING_DECRYPT_OVERLOAD_TTL_MS);
    expect(overload2Small.max).toBe(PENDING_DECRYPT_MAX * 2);
  });

  it('clamps the pool-size multiplier at 4×', () => {
    const now = 10_000;
    const capAt4 = computePendingDecryptLimits(
      now,
      0,
      0,
      PENDING_DECRYPT_BURST_NOMINAL_BASE,
      false,
      PENDING_DECRYPT_OVERLOAD_MAX,
      false,
      4
    );
    const capAt16 = computePendingDecryptLimits(
      now,
      0,
      0,
      PENDING_DECRYPT_BURST_NOMINAL_BASE,
      false,
      PENDING_DECRYPT_OVERLOAD_MAX,
      false,
      16
    );
    expect(capAt16.max).toBe(capAt4.max);
  });

  it('treats undefined/NaN poolSize as 1× and never shrinks caps below the defaults', () => {
    const now = 10_000;
    const baseline = computePendingDecryptLimits(
      now,
      0,
      0,
      PENDING_DECRYPT_BURST_NOMINAL_BASE
    );
    const degenerate = computePendingDecryptLimits(
      now,
      0,
      0,
      PENDING_DECRYPT_BURST_NOMINAL_BASE,
      false,
      PENDING_DECRYPT_OVERLOAD_MAX,
      false,
      Number.NaN
    );
    expect(degenerate.max).toBeGreaterThanOrEqual(baseline.max);
  });

  it('uses a short TTL while pre-overload shedding is active', () => {
    const now = 10_000;
    expect(
      computePendingDecryptLimits(
        now,
        0,
        20_000,
        PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_CLAMP_MAX,
        false,
        PENDING_DECRYPT_OVERLOAD_MAX,
        true
      )
    ).toEqual({
      max: PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_CLAMP_MAX,
      ttlMs: PENDING_DECRYPT_PRE_OVERLOAD_TTL_MS,
    });
  });
});

describe('choosePendingDecryptDropCandidate', () => {
  it('drops the oldest job from an overrepresented ingress', () => {
    expect(
      choosePendingDecryptDropCandidate(
        [
          { id: 1, startedAt: 100, ingressPeerAddress: 'root' },
          { id: 2, startedAt: 200, ingressPeerAddress: 'root' },
          { id: 3, startedAt: 50, ingressPeerAddress: 'peer-b' },
        ],
        'peer-c',
        3
      )
    ).toBe(1);
  });

  it('drops from the incoming ingress when it is already at fair share', () => {
    expect(
      choosePendingDecryptDropCandidate(
        [
          { id: 1, startedAt: 100, ingressPeerAddress: 'peer-a' },
          { id: 2, startedAt: 200, ingressPeerAddress: 'peer-b' },
          { id: 3, startedAt: 50, ingressPeerAddress: 'peer-b' },
        ],
        'peer-b',
        3
      )
    ).toBe(3);
  });

  it('falls back to oldest overall when no ingress is over fair share', () => {
    expect(
      choosePendingDecryptDropCandidate(
        [
          { id: 1, startedAt: 100, ingressPeerAddress: 'peer-a' },
          { id: 2, startedAt: 50, ingressPeerAddress: 'peer-b' },
        ],
        'peer-c',
        4
      )
    ).toBe(2);
  });
});

describe('computeRequestedBurstMaxFromSignals', () => {
  it('returns at least nominal base and at most global max', () => {
    const r = computeRequestedBurstMaxFromSignals({
      peerCount: 50,
      ingressPacketsPerSec: 200,
      peakDepthRecent: 500,
    });
    expect(r).toBeGreaterThanOrEqual(PENDING_DECRYPT_BURST_NOMINAL_BASE);
    expect(r).toBeLessThanOrEqual(GLOBAL_MAX_BURST_MAX);
  });

  it('adds forwarder boost when isForwarder is true', () => {
    // Signals above nominal floor but below GLOBAL cap so +24 is visible (not swallowed by floor/cap).
    const base = computeRequestedBurstMaxFromSignals({
      peerCount: 10,
      ingressPacketsPerSec: 0,
      peakDepthRecent: 127,
      isForwarder: false,
    });
    const boosted = computeRequestedBurstMaxFromSignals({
      peerCount: 10,
      ingressPacketsPerSec: 0,
      peakDepthRecent: 127,
      isForwarder: true,
    });
    expect(boosted - base).toBe(24);
  });
});

describe('computePendingDecryptOverloadMax', () => {
  it('keeps the hard clamp for forwarders and long-task pressure', () => {
    expect(
      computePendingDecryptOverloadMax({
        isForwarder: true,
        longTaskPressure: false,
        activeSourceCount: 2,
      })
    ).toBe(PENDING_DECRYPT_OVERLOAD_FORWARDER_MAX);
    expect(
      computePendingDecryptOverloadMax({
        isForwarder: false,
        longTaskPressure: true,
        activeSourceCount: 1,
      })
    ).toBe(PENDING_DECRYPT_OVERLOAD_MAX);
  });

  it('softens the clamp for healthy non-forwarders', () => {
    expect(
      computePendingDecryptOverloadMax({
        isForwarder: false,
        longTaskPressure: false,
        activeSourceCount: 1,
      })
    ).toBe(PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MAX);
    expect(
      computePendingDecryptOverloadMax({
        isForwarder: false,
        longTaskPressure: false,
        activeSourceCount: 2,
      })
    ).toBe(PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MULTI_MAX);
  });
});

describe('shouldPreemptivelyThrottlePendingDecrypt', () => {
  it('enters pre-overload for bursty multi-source forwarder depth growth', () => {
    expect(
      shouldPreemptivelyThrottlePendingDecrypt({
        pendingDepth: 96,
        previousDepth: 80,
        isForwarder: true,
        participantCount: 3,
        activeSourceCount: 2,
        longTaskPressure: false,
      })
    ).toBe(true);
  });

  it('enters earlier for bursty multi-source participant depth growth', () => {
    expect(
      shouldPreemptivelyThrottlePendingDecrypt({
        pendingDepth: 80,
        previousDepth: 72,
        isForwarder: false,
        participantCount: 3,
        activeSourceCount: 2,
        longTaskPressure: false,
      })
    ).toBe(true);
  });

  it('stays in participant pre-overload once multi-source depth is already high', () => {
    expect(
      shouldPreemptivelyThrottlePendingDecrypt({
        pendingDepth: PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_SUSTAINED_DEPTH,
        previousDepth:
          PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_SUSTAINED_DEPTH - 2,
        isForwarder: false,
        participantCount: 3,
        activeSourceCount: 2,
        longTaskPressure: false,
      })
    ).toBe(true);
  });

  it('stays off for stable one-on-one depth or flat growth', () => {
    expect(
      shouldPreemptivelyThrottlePendingDecrypt({
        pendingDepth: 96,
        previousDepth: 90,
        isForwarder: true,
        participantCount: 2,
        activeSourceCount: 1,
        longTaskPressure: false,
      })
    ).toBe(false);
    expect(
      shouldPreemptivelyThrottlePendingDecrypt({
        pendingDepth: 80,
        previousDepth: 72,
        isForwarder: true,
        participantCount: 3,
        activeSourceCount: 2,
        longTaskPressure: false,
      })
    ).toBe(false);
  });
});

describe('computePendingDecryptPreOverloadClampMax', () => {
  it('keeps forwarders on a milder pre-overload clamp than the burst ceiling', () => {
    expect(
      computePendingDecryptPreOverloadClampMax({
        isForwarder: true,
        activeSourceCount: 2,
      })
    ).toBe(PENDING_DECRYPT_OVERLOAD_FORWARDER_MAX + 16);
  });

  it('uses the softer participant caps outside the forwarder path', () => {
    expect(
      computePendingDecryptPreOverloadClampMax({
        isForwarder: false,
        activeSourceCount: 1,
      })
    ).toBe(PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MAX);
    expect(
      computePendingDecryptPreOverloadClampMax({
        isForwarder: false,
        activeSourceCount: 2,
      })
    ).toBe(PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_CLAMP_MAX);
  });
});

describe('shouldTreatPendingDecryptAsForwarder', () => {
  it('stays off for one-on-one forwarder roles with a single active source', () => {
    expect(
      shouldTreatPendingDecryptAsForwarder({
        isForwarderRole: true,
        participantCount: 2,
        activeSourceCount: 1,
      })
    ).toBe(false);
  });

  it('stays on for actual fanout forwarders', () => {
    expect(
      shouldTreatPendingDecryptAsForwarder({
        isForwarderRole: true,
        participantCount: 3,
        activeSourceCount: 1,
      })
    ).toBe(true);
    expect(
      shouldTreatPendingDecryptAsForwarder({
        isForwarderRole: true,
        participantCount: 2,
        activeSourceCount: 2,
      })
    ).toBe(true);
  });
});

describe('shouldBypassDecryptWorkerOnHotQueue', () => {
  it('allows a healthy single-source participant to bypass near the cap', () => {
    expect(
      shouldBypassDecryptWorkerOnHotQueue({
        pendingDepth: 202,
        pendingMax: 208,
        overloadActive: true,
        longTaskPressure: false,
        isForwarder: false,
        activeSourceCount: 1,
        applyQueueDepth: 0,
      })
    ).toBe(true);
  });

  it('stays off for forwarders, multi-source, or when apply is already backlogged', () => {
    expect(
      shouldBypassDecryptWorkerOnHotQueue({
        pendingDepth: 202,
        pendingMax: 208,
        overloadActive: true,
        longTaskPressure: false,
        isForwarder: true,
        activeSourceCount: 1,
        applyQueueDepth: 0,
      })
    ).toBe(false);
    expect(
      shouldBypassDecryptWorkerOnHotQueue({
        pendingDepth: 202,
        pendingMax: 208,
        overloadActive: true,
        longTaskPressure: false,
        isForwarder: false,
        activeSourceCount: 2,
        applyQueueDepth: 0,
      })
    ).toBe(false);
    expect(
      shouldBypassDecryptWorkerOnHotQueue({
        pendingDepth: 202,
        pendingMax: 208,
        overloadActive: true,
        longTaskPressure: false,
        isForwarder: false,
        activeSourceCount: 1,
        applyQueueDepth: 8,
      })
    ).toBe(false);
  });

  it('allows a one-on-one forwarder-role peer to use the participant bypass path', () => {
    expect(
      shouldBypassDecryptWorkerOnHotQueue({
        pendingDepth: 202,
        pendingMax: 208,
        overloadActive: true,
        longTaskPressure: false,
        isForwarder: shouldTreatPendingDecryptAsForwarder({
          isForwarderRole: true,
          participantCount: 2,
          activeSourceCount: 1,
        }),
        activeSourceCount: 1,
        applyQueueDepth: 0,
      })
    ).toBe(true);
  });
});

describe('shouldSyncDecodeForSmallSession', () => {
  it('sync-decodes the 1:1 single-source non-forwarder happy path', () => {
    expect(
      shouldSyncDecodeForSmallSession({
        participantCount: 2,
        activeSourceCount: 1,
        isForwarder: false,
        longTaskPressure: false,
      })
    ).toBe(true);
  });

  it('sync-decodes when the call is effectively silent (activeSourceCount === 0)', () => {
    expect(
      shouldSyncDecodeForSmallSession({
        participantCount: 2,
        activeSourceCount: 0,
        isForwarder: false,
        longTaskPressure: false,
      })
    ).toBe(true);
  });

  it('keeps the worker pool online for fanout forwarders', () => {
    expect(
      shouldSyncDecodeForSmallSession({
        participantCount: 2,
        activeSourceCount: 1,
        isForwarder: true,
        longTaskPressure: false,
      })
    ).toBe(false);
  });

  it('composes with shouldTreatPendingDecryptAsForwarder so a root-forwarder in a 1:1 call takes the sync path (regression: call 59)', () => {
    // Kenny was role=root-forwarder in a 1:1 call; the raw `isFanoutForwarderRole` bit
    // is true for that role, but in a 1:1 there is no actual fanout work so the
    // effective forwarder bit (what the overload clamp / bypass paths use) is false.
    // This chain must yield `sync-decode = true` for both endpoints; otherwise only the
    // standby-forwarder peer benefits and the root-forwarder peer keeps drowning in the
    // async-worker pipeline.
    const effectiveForwarderForRoot = shouldTreatPendingDecryptAsForwarder({
      isForwarderRole: true,
      participantCount: 2,
      activeSourceCount: 1,
    });
    expect(effectiveForwarderForRoot).toBe(false);
    expect(
      shouldSyncDecodeForSmallSession({
        participantCount: 2,
        activeSourceCount: 1,
        isForwarder: effectiveForwarderForRoot,
        longTaskPressure: false,
      })
    ).toBe(true);

    const effectiveForwarderForStandby = shouldTreatPendingDecryptAsForwarder({
      isForwarderRole: false,
      participantCount: 2,
      activeSourceCount: 1,
    });
    expect(effectiveForwarderForStandby).toBe(false);
    expect(
      shouldSyncDecodeForSmallSession({
        participantCount: 2,
        activeSourceCount: 1,
        isForwarder: effectiveForwarderForStandby,
        longTaskPressure: false,
      })
    ).toBe(true);
  });

  it('defers to the async worker when the main thread is long-task pressured', () => {
    expect(
      shouldSyncDecodeForSmallSession({
        participantCount: 2,
        activeSourceCount: 1,
        isForwarder: false,
        longTaskPressure: true,
      })
    ).toBe(false);
  });

  it('keeps the worker pool online as soon as a 3rd participant joins', () => {
    expect(
      shouldSyncDecodeForSmallSession({
        participantCount: 3,
        activeSourceCount: 1,
        isForwarder: false,
        longTaskPressure: false,
      })
    ).toBe(false);
  });

  it('keeps the worker pool online once a second source becomes active', () => {
    expect(
      shouldSyncDecodeForSmallSession({
        participantCount: 2,
        activeSourceCount: 2,
        isForwarder: false,
        longTaskPressure: false,
      })
    ).toBe(false);
  });

  it('treats fractional / negative inputs defensively (floors both counts at 0)', () => {
    expect(
      shouldSyncDecodeForSmallSession({
        participantCount: -1,
        activeSourceCount: 0.5,
        isForwarder: false,
        longTaskPressure: false,
      })
    ).toBe(true);
  });
});

describe('slewBurstMaxTowardRequested', () => {
  it('ramps downward immediately to requested', () => {
    expect(slewBurstMaxTowardRequested(320, 200, 1000)).toBe(200);
  });

  it('limits upward steps per second', () => {
    expect(slewBurstMaxTowardRequested(320, 400, 1000)).toBe(320 + 48);
  });
});

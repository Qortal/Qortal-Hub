import { describe, expect, it } from 'vitest';
import {
  computePendingDecryptPreOverloadClampMax,
  computePendingDecryptOverloadMax,
  computePendingDecryptLimits,
  computeRequestedBurstMaxFromSignals,
  shouldTreatPendingDecryptAsForwarder,
  shouldBypassDecryptWorkerOnHotQueue,
  shouldPreemptivelyThrottlePendingDecrypt,
  GLOBAL_MAX_BURST_MAX,
  PENDING_DECRYPT_BURST_NOMINAL_BASE,
  PENDING_DECRYPT_BURST_TTL_MS,
  PENDING_DECRYPT_MAX,
  PENDING_DECRYPT_OVERLOAD_FORWARDER_MAX,
  PENDING_DECRYPT_OVERLOAD_MAX,
  PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MAX,
  PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MULTI_MAX,
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
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
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
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
    });
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
    ).toBe(PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MULTI_MAX + 16);
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

describe('slewBurstMaxTowardRequested', () => {
  it('ramps downward immediately to requested', () => {
    expect(slewBurstMaxTowardRequested(320, 200, 1000)).toBe(200);
  });

  it('limits upward steps per second', () => {
    expect(slewBurstMaxTowardRequested(320, 400, 1000)).toBe(320 + 48);
  });
});

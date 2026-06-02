import { describe, expect, it } from 'vitest';
import {
  buildOpusSendPressureTiers,
  computeOpusSendPressureMaxTierIndex,
  createOpusSendPressureControllerState,
  isReticulumSendPressureSignal,
  isReticulumSendPressureSignalForwarder,
  OPUS_SEND_PRESSURE_ENTER_MS,
  OPUS_SEND_PRESSURE_EXIT_MS,
  OPUS_SEND_PRESSURE_MIN_BITRATE,
  OPUS_SEND_PRESSURE_STEP_UP_COOLDOWN_MS,
  tickOpusSendPressureController,
} from './opusSendPressure';

describe('buildOpusSendPressureTiers', () => {
  it('anchors on nominal and enforces floor', () => {
    const tiers = buildOpusSendPressureTiers(24_000);
    expect(tiers[0]).toBe(24_000);
    expect(tiers[tiers.length - 1]).toBeGreaterThanOrEqual(
      OPUS_SEND_PRESSURE_MIN_BITRATE
    );
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]!).toBeLessThan(tiers[i - 1]!);
    }
  });
});

describe('isReticulumSendPressureSignal', () => {
  it('matches main-process bridge thresholds', () => {
    expect(
      isReticulumSendPressureSignal({
        bridgeQueuedFrames: 8,
        decodedQueueDepth: 0,
        queuePressureDropsLast5s: 0,
      })
    ).toBe(true);
    expect(
      isReticulumSendPressureSignal({
        bridgeQueuedFrames: 0,
        decodedQueueDepth: 12,
        queuePressureDropsLast5s: 0,
      })
    ).toBe(true);
    expect(
      isReticulumSendPressureSignal({
        bridgeQueuedFrames: 0,
        decodedQueueDepth: 0,
        queuePressureDropsLast5s: 6,
      })
    ).toBe(true);
    expect(
      isReticulumSendPressureSignal({
        bridgeWaitingForDrain: true,
        bridgeQueuedFrames: 0,
        decodedQueueDepth: 0,
        queuePressureDropsLast5s: 0,
      })
    ).toBe(true);
    expect(
      isReticulumSendPressureSignal({
        bridgeQueuedFrames: 0,
        decodedQueueDepth: 0,
        queuePressureDropsLast5s: 0,
        pendingFrames: 12,
      })
    ).toBe(true);
  });
});

describe('isReticulumSendPressureSignalForwarder', () => {
  it('enters pressure earlier than participant thresholds', () => {
    expect(
      isReticulumSendPressureSignal({
        bridgeQueuedFrames: 7,
        decodedQueueDepth: 0,
        queuePressureDropsLast5s: 0,
      })
    ).toBe(false);
    expect(
      isReticulumSendPressureSignalForwarder({
        bridgeQueuedFrames: 7,
        decodedQueueDepth: 0,
        queuePressureDropsLast5s: 0,
      })
    ).toBe(true);
  });
});

describe('tickOpusSendPressureController', () => {
  const tiers = buildOpusSendPressureTiers(24_000);
  const tick = OPUS_SEND_PRESSURE_ENTER_MS / 4;

  it('steps down one tier after fast sustained pressure', () => {
    const state = createOpusSendPressureControllerState();
    let t = 1000;
    let last = tiers[0]!;
    for (let i = 0; i < 8; i++) {
      const r = tickOpusSendPressureController(
        state,
        tiers,
        tick,
        (t += tick),
        true
      );
      if (r.tierChanged) {
        expect(r.targetBitrate).toBeLessThan(last);
        return;
      }
      last = r.targetBitrate;
    }
    throw new Error('expected tier change');
  });

  it('steps up after slow clean window', () => {
    const state = createOpusSendPressureControllerState();
    state.tierIndex = Math.min(1, tiers.length - 1);
    const t0 = 10_000;
    const r = tickOpusSendPressureController(
      state,
      tiers,
      OPUS_SEND_PRESSURE_EXIT_MS,
      t0,
      false
    );
    expect(r.tierChanged).toBe(true);
    expect(state.tierIndex).toBe(0);
  });

  it('respects step-up cooldown between tier increases', () => {
    const state = createOpusSendPressureControllerState();
    state.tierIndex = 1;
    state.lastStepUpAtMs = 10_000;
    const beforeCooldown = tickOpusSendPressureController(
      state,
      tiers,
      OPUS_SEND_PRESSURE_EXIT_MS,
      10_000 + OPUS_SEND_PRESSURE_STEP_UP_COOLDOWN_MS - 1,
      false
    );
    expect(beforeCooldown.tierChanged).toBe(false);
    const afterCooldown = tickOpusSendPressureController(
      state,
      tiers,
      OPUS_SEND_PRESSURE_EXIT_MS,
      10_000 + OPUS_SEND_PRESSURE_STEP_UP_COOLDOWN_MS,
      false
    );
    expect(afterCooldown.tierChanged).toBe(true);
    expect(state.tierIndex).toBe(0);
  });

  it('caps participants at mild pressure while receive-path shedding', () => {
    expect(
      computeOpusSendPressureMaxTierIndex({
        receivingShedding: true,
        isForwarder: false,
        decryptOverloadActive: true,
        pressureSnapshot: {
          bridgeQueuedFrames: 12,
          decodedQueueDepth: 14,
          queuePressureDropsLast5s: 9,
          pendingFrames: 18,
        },
      })
    ).toBe(1);
  });

  it('lets forwarders step down harder when shedding and bridge pressure is active', () => {
    expect(
      computeOpusSendPressureMaxTierIndex({
        receivingShedding: true,
        isForwarder: true,
        decryptOverloadActive: false,
        pressureSnapshot: {
          bridgeQueuedFrames: 7,
          decodedQueueDepth: 10,
          queuePressureDropsLast5s: 5,
          pendingFrames: 10,
        },
      })
    ).toBe(2);
  });

  it('allows the deepest cap only for overloaded forwarders under severe queue pressure', () => {
    expect(
      computeOpusSendPressureMaxTierIndex({
        receivingShedding: true,
        isForwarder: true,
        decryptOverloadActive: true,
        pressureSnapshot: {
          bridgeWaitingForDrain: true,
          bridgeQueuedFrames: 12,
          decodedQueueDepth: 15,
          queuePressureDropsLast5s: 10,
          pendingFrames: 20,
        },
      })
    ).toBe(3);
  });

  it('enforces the computed cap while pressure persists', () => {
    const state = createOpusSendPressureControllerState();
    let now = 1000;
    for (let i = 0; i < 24; i++) {
      tickOpusSendPressureController(
        state,
        tiers,
        tick,
        (now += tick),
        true,
        { maxTierIndex: 2 }
      );
    }
    expect(state.tierIndex).toBe(2);
  });
});

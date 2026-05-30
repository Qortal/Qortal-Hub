import { describe, expect, it } from 'vitest';

import {
  RETICULUM_AUDIO_FALLBACK_LOCAL_SEND_RECENT_MS_DEFAULT,
  RETICULUM_AUDIO_FALLBACK_PEER_RX_LOSS_TOLERANCE_MS_DEFAULT,
  RETICULUM_AUDIO_FALLBACK_REACTIVATION_COOLDOWN_MS_DEFAULT,
  RETICULUM_AUDIO_FALLBACK_REMOTE_RX_MISSING_MS_DEFAULT,
  isInReticulumFallbackReactivationCooldown,
  shouldActivateReticulumPeerRxFallback,
} from './reticulum-audio-link-fallback-policy';

describe('shouldActivateReticulumPeerRxFallback', () => {
  it('returns false when peer has received recently', () => {
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: true,
        peerRxAgeMs: 500,
        outboundPacketAgeMs: 1_000,
      })
    ).toBe(false);
  });

  it('returns false when we have not sent anything recently', () => {
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: 8_000,
        outboundPacketAgeMs:
          RETICULUM_AUDIO_FALLBACK_LOCAL_SEND_RECENT_MS_DEFAULT + 1,
      })
    ).toBe(false);
  });

  it('returns false when we have never sent (Infinity)', () => {
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: 10_000,
        outboundPacketAgeMs: Number.POSITIVE_INFINITY,
      })
    ).toBe(false);
  });

  it('returns false when peer rx age is below the missing threshold', () => {
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs:
          RETICULUM_AUDIO_FALLBACK_REMOTE_RX_MISSING_MS_DEFAULT - 1,
        outboundPacketAgeMs: 500,
      })
    ).toBe(false);
  });

  it('returns false during natural speech silence: our last send is older than peer rx age', () => {
    // Quiet listener scenario from phil-kenny-one-on-one-61: we stopped sending 7 s ago
    // while the other person was talking; peer's heartbeat says "haven't received from
    // you in 7.1 s" (≥ 6 s missing threshold). This is not a fallback trigger because
    // the old peer-rx age is fully explained by our silence.
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: 7_100,
        outboundPacketAgeMs: 7_000,
      })
    ).toBe(false);
  });

  it('returns false when our send arrived within tolerance of peer rx age', () => {
    // We sent 5 s ago, peer reports rx 5.5 s ago. Delta 500 ms < 2 s tolerance → path OK.
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: 5_500,
        outboundPacketAgeMs: 5_000,
      })
    ).toBe(false);
  });

  it('returns true when we sent recently but peer rx age is well beyond tolerance', () => {
    // We sent 500 ms ago, peer says last rx was 8 s ago. Our recent packet clearly did
    // not arrive → genuine packet-path loss.
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: 8_000,
        outboundPacketAgeMs: 500,
      })
    ).toBe(true);
  });

  it('returns true when peer rx age is unknown but packetRxRecent=false and we sent recently', () => {
    // Peer omitted the age field. Trust their recent=false bit and our own send recency.
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: undefined,
        outboundPacketAgeMs: 500,
      })
    ).toBe(true);
  });

  it('boundary: delta exactly equals tolerance → no fallback (treat as silence)', () => {
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: 8_000,
        outboundPacketAgeMs:
          8_000 - RETICULUM_AUDIO_FALLBACK_PEER_RX_LOSS_TOLERANCE_MS_DEFAULT,
      })
    ).toBe(false);
  });

  it('boundary: delta one ms past tolerance → fallback fires', () => {
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: 8_000,
        outboundPacketAgeMs:
          8_000 -
          RETICULUM_AUDIO_FALLBACK_PEER_RX_LOSS_TOLERANCE_MS_DEFAULT -
          1,
      })
    ).toBe(true);
  });

  it('respects caller-provided threshold overrides', () => {
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: 5_000,
        outboundPacketAgeMs: 500,
        remoteRxMissingMs: 10_000,
      })
    ).toBe(false);

    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: 5_000,
        outboundPacketAgeMs: 500,
        peerRxLossToleranceMs: 10_000,
      })
    ).toBe(false);
  });

  it('reproduces the call-61 quiet-listener case as false (regression)', () => {
    // From phil-kenny-one-on-one-61: Kenny (root-forwarder, mostly listening) oscillated
    // because every 5 s heartbeat caught him mid-silence. Representative inputs: we sent
    // our last packet 6.5 s ago (end of Kenny's last utterance), Phil reports recent=false
    // with rx age 6.6 s (Phil last received Kenny's audio at roughly the same moment).
    expect(
      shouldActivateReticulumPeerRxFallback({
        peerRxRecent: false,
        peerRxAgeMs: 6_600,
        outboundPacketAgeMs: 6_500,
      })
    ).toBe(false);
  });
});

describe('isInReticulumFallbackReactivationCooldown', () => {
  it('returns false when we have never been in fallback', () => {
    expect(
      isInReticulumFallbackReactivationCooldown({
        packetFallbackLastExitAtMs: 0,
        nowMs: 1_000_000,
      })
    ).toBe(false);
  });

  it('returns true just after exiting fallback', () => {
    expect(
      isInReticulumFallbackReactivationCooldown({
        packetFallbackLastExitAtMs: 1_000_000,
        nowMs: 1_000_100,
      })
    ).toBe(true);
  });

  it('returns false after cooldown elapses', () => {
    expect(
      isInReticulumFallbackReactivationCooldown({
        packetFallbackLastExitAtMs: 1_000_000,
        nowMs:
          1_000_000 +
          RETICULUM_AUDIO_FALLBACK_REACTIVATION_COOLDOWN_MS_DEFAULT,
      })
    ).toBe(false);
  });

  it('boundary: one ms before cooldown end → still in cooldown', () => {
    expect(
      isInReticulumFallbackReactivationCooldown({
        packetFallbackLastExitAtMs: 1_000_000,
        nowMs:
          1_000_000 +
          RETICULUM_AUDIO_FALLBACK_REACTIVATION_COOLDOWN_MS_DEFAULT -
          1,
      })
    ).toBe(true);
  });

  it('honours caller-provided cooldown override', () => {
    expect(
      isInReticulumFallbackReactivationCooldown({
        packetFallbackLastExitAtMs: 1_000_000,
        nowMs: 1_005_000,
        cooldownMs: 10_000,
      })
    ).toBe(true);

    expect(
      isInReticulumFallbackReactivationCooldown({
        packetFallbackLastExitAtMs: 1_000_000,
        nowMs: 1_005_000,
        cooldownMs: 2_000,
      })
    ).toBe(false);
  });
});

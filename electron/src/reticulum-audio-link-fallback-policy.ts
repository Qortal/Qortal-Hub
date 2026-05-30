/**
 * Pure decision helpers for Reticulum audio packet↔link transport fallback.
 *
 * Extracted from `group-call.ts` so the silence-guard and reactivation-cooldown semantics
 * can be tested in isolation. The logic deliberately keeps no state: callers pass in the
 * relevant wall timestamps / peer-reported ages and receive a boolean decision.
 *
 * Background (phil-kenny-one-on-one-61): the original peer-rx-report handler flipped
 * Kenny to link-fallback every time Phil's heartbeat reported `packetRxRecent=false`,
 * even when Kenny was simply quiet for a few seconds. Each flip churned the routeKey,
 * dropped in-flight frames in the bridge queue, and starved both sides of audio.
 * We now only flip when:
 *   1. Peer explicitly reports no recent rx (packetRxRecent === false)
 *   2. We have been sending recently (so we actually expected the peer to receive us)
 *   3. The peer's `packetRxAgeMs` is genuinely older than our last outbound send by
 *      more than a path-latency tolerance — meaning our recent send never arrived.
 *
 * Plus a reactivation cooldown so exiting fallback is not immediately followed by
 * re-entry on the next 5 s heartbeat.
 */

/** Peer said they haven't received us recently (within their own rx-recent threshold). */
export const RETICULUM_AUDIO_FALLBACK_REMOTE_RX_MISSING_MS_DEFAULT = 6_000;
/** Haven't sent locally in this long → we have no opinion on packet path health. */
export const RETICULUM_AUDIO_FALLBACK_LOCAL_SEND_RECENT_MS_DEFAULT = 12_000;
/**
 * Peer's rx-age must exceed our own outbound-age by at least this much before we count
 * it as "our recent send failed to arrive" (vs "we simply weren't sending"). Covers
 * one-way path latency and heartbeat sampling jitter.
 */
export const RETICULUM_AUDIO_FALLBACK_PEER_RX_LOSS_TOLERANCE_MS_DEFAULT = 2_000;
/**
 * Don't re-activate fallback within this window after leaving it; prevents the
 * packet↔link oscillation observed in call 61 (8 flips in 41 s).
 */
export const RETICULUM_AUDIO_FALLBACK_REACTIVATION_COOLDOWN_MS_DEFAULT = 15_000;

export interface ReticulumAudioPeerRxFallbackInput {
  /** `wire.packetRxRecent` from the peer's heartbeat (`false` means "not recently received"). */
  peerRxRecent: boolean | undefined;
  /** `wire.packetRxAgeMs` from the peer's heartbeat (ms since peer's last rx). `undefined` or `-1` when unknown. */
  peerRxAgeMs: number | undefined;
  /** Ms since our last outbound packet to this peer. `Infinity` when we have never sent. */
  outboundPacketAgeMs: number;
  remoteRxMissingMs?: number;
  localSendRecentMs?: number;
  peerRxLossToleranceMs?: number;
}

export interface ReticulumAudioReactivationCooldownInput {
  /** Wall time of last `deactivateReticulumAudioLinkFallback`. `0` when we have never been in fallback. */
  packetFallbackLastExitAtMs: number;
  nowMs: number;
  cooldownMs?: number;
}

/**
 * Decide whether a peer's rx-report warrants flipping us to link-fallback.
 *
 * Returns `true` iff ALL of the following hold:
 *   - peer explicitly says `packetRxRecent === false`
 *   - our last outbound is within the "we were sending recently" window
 *   - peer's last-rx age exceeds the remote-rx-missing threshold
 *   - peer's last-rx age is newer than our last outbound by more than the tolerance
 *     (i.e. the peer really is missing a packet we sent, not just the silence after
 *     we stopped sending).
 */
export function shouldActivateReticulumPeerRxFallback(
  input: ReticulumAudioPeerRxFallbackInput
): boolean {
  if (input.peerRxRecent !== false) return false;
  const remoteRxMissingMs =
    input.remoteRxMissingMs ??
    RETICULUM_AUDIO_FALLBACK_REMOTE_RX_MISSING_MS_DEFAULT;
  const localSendRecentMs =
    input.localSendRecentMs ??
    RETICULUM_AUDIO_FALLBACK_LOCAL_SEND_RECENT_MS_DEFAULT;
  const peerRxLossToleranceMs =
    input.peerRxLossToleranceMs ??
    RETICULUM_AUDIO_FALLBACK_PEER_RX_LOSS_TOLERANCE_MS_DEFAULT;
  if (!Number.isFinite(input.outboundPacketAgeMs)) return false;
  if (input.outboundPacketAgeMs > localSendRecentMs) return false;
  const peerRxAgeMs =
    typeof input.peerRxAgeMs === 'number' ? input.peerRxAgeMs : -1;
  if (peerRxAgeMs >= 0 && peerRxAgeMs < remoteRxMissingMs) return false;
  if (peerRxAgeMs >= 0) {
    const expectedMaxOutboundAgeMs = peerRxAgeMs - peerRxLossToleranceMs;
    if (input.outboundPacketAgeMs >= expectedMaxOutboundAgeMs) return false;
  }
  return true;
}

/** `true` while we are still inside the post-exit cooldown and must not re-enter fallback. */
export function isInReticulumFallbackReactivationCooldown(
  input: ReticulumAudioReactivationCooldownInput
): boolean {
  if (input.packetFallbackLastExitAtMs <= 0) return false;
  const cooldownMs =
    input.cooldownMs ??
    RETICULUM_AUDIO_FALLBACK_REACTIVATION_COOLDOWN_MS_DEFAULT;
  return input.nowMs - input.packetFallbackLastExitAtMs < cooldownMs;
}

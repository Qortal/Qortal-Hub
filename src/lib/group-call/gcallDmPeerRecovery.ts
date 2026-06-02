/**
 * Single-peer recovery profile (aligns with `useGroupVoiceCall` peer recovery maps).
 */

export const DM_ADAPTIVE_RECOVERY_SCORE_THRESHOLD = 3;
export const DM_ADAPTIVE_RECOVERY_COOLDOWN_MS = 12_000;
export const DM_ADAPTIVE_RECOVERY_REENTRY_COOLDOWN_MS = 300;

export interface DmPeerRecoveryState {
  peerRecoveryProfile: Map<string, 'low-latency' | 'recovery'>;
  peerInstabilityScore: Map<string, number>;
  globalRecoveryUntilMs: number;
  peerRecoveryEnteredAt: Map<string, number>;
  peerRecoveryStableSince: Map<string, number>;
  peerRecoveryReentryBlockedUntil: Map<string, number>;
}

export function createDmPeerRecoveryState(): DmPeerRecoveryState {
  return {
    peerRecoveryProfile: new Map(),
    peerInstabilityScore: new Map(),
    globalRecoveryUntilMs: 0,
    peerRecoveryEnteredAt: new Map(),
    peerRecoveryStableSince: new Map(),
    peerRecoveryReentryBlockedUntil: new Map(),
  };
}

export function dmRecomputeAdaptiveNetworkMode(
  state: DmPeerRecoveryState,
  setMode: (m: 'low-latency' | 'recovery') => void,
  nowMs = Date.now()
): void {
  const hasRecoveryPeer = [...state.peerRecoveryProfile.values()].some(
    (p) => p === 'recovery'
  );
  const mode: 'low-latency' | 'recovery' =
    hasRecoveryPeer || nowMs < state.globalRecoveryUntilMs
      ? 'recovery'
      : 'low-latency';
  setMode(mode);
}

export function dmMarkPeerUnstable(
  state: DmPeerRecoveryState,
  address: string,
  severity = 1,
  nowMs = Date.now()
): void {
  const prev = state.peerInstabilityScore.get(address) ?? 0;
  const next = Math.min(10, prev + Math.max(1, Math.floor(severity)));
  state.peerInstabilityScore.set(address, next);
  if (next >= DM_ADAPTIVE_RECOVERY_SCORE_THRESHOLD) {
    const reentryBlockedUntil =
      state.peerRecoveryReentryBlockedUntil.get(address) ?? 0;
    if (
      reentryBlockedUntil > nowMs &&
      state.peerRecoveryProfile.get(address) !== 'recovery'
    ) {
      return;
    }
    if (state.peerRecoveryProfile.get(address) !== 'recovery') {
      state.peerRecoveryEnteredAt.set(address, nowMs);
    }
    state.peerRecoveryStableSince.delete(address);
    state.peerRecoveryProfile.set(address, 'recovery');
    state.globalRecoveryUntilMs = Math.max(
      state.globalRecoveryUntilMs,
      nowMs + DM_ADAPTIVE_RECOVERY_COOLDOWN_MS
    );
  }
}

export function dmMarkPeerStable(
  state: DmPeerRecoveryState,
  address: string,
  opts?: { allowRecoveryExit?: boolean; nowMs?: number }
): void {
  const nowMs = opts?.nowMs ?? Date.now();
  const prev = state.peerInstabilityScore.get(address) ?? 0;
  const next = Math.max(0, prev - 1);
  state.peerInstabilityScore.set(address, next);
  if (
    next === 0 &&
    state.peerRecoveryProfile.get(address) === 'recovery' &&
    (opts?.allowRecoveryExit || nowMs >= state.globalRecoveryUntilMs)
  ) {
    state.peerRecoveryProfile.set(address, 'low-latency');
    state.peerRecoveryEnteredAt.delete(address);
    state.peerRecoveryStableSince.delete(address);
    state.peerRecoveryReentryBlockedUntil.set(
      address,
      nowMs + DM_ADAPTIVE_RECOVERY_REENTRY_COOLDOWN_MS
    );
    if (
      ![...state.peerRecoveryProfile.values()].some((p) => p === 'recovery')
    ) {
      state.globalRecoveryUntilMs = Math.min(
        state.globalRecoveryUntilMs,
        nowMs
      );
    }
  }
}

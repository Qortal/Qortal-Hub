import type { GroupCallMetricsSnapshot } from './router';

export type GroupCallLocalConnectionHintLevel = 'warning' | 'severe';

export interface GroupCallLocalConnectionHint {
  level: GroupCallLocalConnectionHintLevel;
  headline: string;
  detail: string;
}

const TIP =
  'Try a wired connection, move closer to Wi‑Fi, or turn off VPN if audio is poor.';

/**
 * Maps live group-call metrics to a coarse stress level for the **local** client only.
 * Used with time-based hysteresis in useGroupVoiceCall — not shown on remote peers.
 */
export function rawConnectionStressLevel(
  m: GroupCallMetricsSnapshot
): 0 | 1 | 2 {
  const recovery = m.adaptiveNetworkMode === 'recovery';
  const relay = m.relayDwellFraction;
  const outside = m.playoutOutsideTargetFraction;
  const buf = m.avgPcmBufferedMs;

  const severePlayback = outside >= 0.82 && buf >= 260;
  const severeRelay = relay >= 0.22;
  const severeRecoveryRelay = recovery && relay >= 0.12;

  if (severePlayback || severeRelay || severeRecoveryRelay) return 2;

  const warnDc = m.dcTransportReady === false;
  const warnRelay = relay >= 0.06;
  const warnRecovery = recovery;
  const warnPlayback = outside >= 0.38 && buf >= 170;

  if (warnDc || warnRelay || warnRecovery || warnPlayback) return 1;

  return 0;
}

export function groupCallLocalConnectionHintFromLevel(
  level: 1 | 2
): GroupCallLocalConnectionHint {
  if (level === 2) {
    return {
      level: 'severe',
      headline: 'Voice connection is unstable',
      detail:
        'Audio may be delayed or choppy while the app catches up. ' + TIP,
    };
  }
  return {
    level: 'warning',
    headline: 'Voice connection quality is reduced',
    detail: TIP,
  };
}

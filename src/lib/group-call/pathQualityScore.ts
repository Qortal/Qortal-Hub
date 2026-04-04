/**
 * Provisional v1 path quality score for Reticulum packet paths (session/window aggregates).
 * Weights are tunable; keep field names stable for diagnostics.
 *
 * When the bridge exposes per-peer path counters, emit `pathQualityPeerCoverage: 'per_peer'`
 * and populate per-peer scores; until then diagnostics use the session aggregate only.
 */
export const PATH_QUALITY_PEER_COVERAGE_SESSION = 'session_aggregate' as const;

import type { GroupCallWindowMetrics } from './router';

export const PATH_QUALITY_V1_ALPHA = 0.15;
export const PATH_QUALITY_V1_BETA = 0.1;
export const PATH_QUALITY_V1_GAMMA = 0;

export interface PathQualityScoreV1Breakdown {
  successRatio: number;
  timeoutRatio: number;
  staleRatio: number;
  pathQualityScoreV1: number;
  pathQualityScoreEmaV1: number;
  alpha: number;
  beta: number;
  gamma: number;
}

export function ratiosFromPathWindowFields(w: Pick<
  GroupCallWindowMetrics,
  | 'reticulumAudioPacketPathResolutions'
  | 'reticulumAudioPacketPathRequests'
  | 'reticulumAudioPacketPathTimeouts'
  | 'reticulumAudioPacketFreshSends'
  | 'reticulumAudioPacketStaleSends'
>): { successRatio: number; timeoutRatio: number; staleRatio: number } {
  const req = Math.max(1, w.reticulumAudioPacketPathRequests);
  const successRatio = Math.min(
    1,
    w.reticulumAudioPacketPathResolutions / req
  );
  const timeoutRatio = Math.min(
    1,
    w.reticulumAudioPacketPathTimeouts / req
  );
  const sendDenom = Math.max(
    1,
    w.reticulumAudioPacketFreshSends + w.reticulumAudioPacketStaleSends
  );
  const staleRatio = Math.min(
    1,
    w.reticulumAudioPacketStaleSends / sendDenom
  );
  return { successRatio, timeoutRatio, staleRatio };
}

export function computePathQualityScoreV1(
  w: Pick<
    GroupCallWindowMetrics,
    | 'reticulumAudioPacketPathResolutions'
    | 'reticulumAudioPacketPathRequests'
    | 'reticulumAudioPacketPathTimeouts'
    | 'reticulumAudioPacketFreshSends'
    | 'reticulumAudioPacketStaleSends'
  >,
  emaPrev: number | null,
  opts?: {
    alpha?: number;
    beta?: number;
    gamma?: number;
    lambdaEma?: number;
  }
): PathQualityScoreV1Breakdown {
  const alpha = opts?.alpha ?? PATH_QUALITY_V1_ALPHA;
  const beta = opts?.beta ?? PATH_QUALITY_V1_BETA;
  const gamma = opts?.gamma ?? PATH_QUALITY_V1_GAMMA;
  const lambdaEma = opts?.lambdaEma ?? 0.25;

  const { successRatio, timeoutRatio, staleRatio } =
    ratiosFromPathWindowFields(w);
  const raw =
    successRatio -
    alpha * timeoutRatio -
    beta * staleRatio +
    gamma * 0;
  const pathQualityScoreV1 = Math.max(0, Math.min(1, raw));
  const pathQualityScoreEmaV1 =
    emaPrev === null
      ? pathQualityScoreV1
      : lambdaEma * pathQualityScoreV1 + (1 - lambdaEma) * emaPrev;

  return {
    successRatio,
    timeoutRatio,
    staleRatio,
    pathQualityScoreV1,
    pathQualityScoreEmaV1,
    alpha,
    beta,
    gamma,
  };
}

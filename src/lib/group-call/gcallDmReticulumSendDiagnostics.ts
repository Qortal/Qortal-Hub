/**
 * Ingest Reticulum `sendAudio` IPC results into {@link GroupCallPerformanceTracker},
 * aligned with `useGroupVoiceCall` `ingestReticulumAudioSendDiagnostics` (without group-only diag hooks).
 */

import type { GroupCallPerformanceTracker } from './router';

export type GcReticulumAudioSendResult = {
  success?: boolean;
  error?: string;
  diagnostics?: {
    transport?: string;
    pendingFrames?: number;
    queuePressureDrops?: number;
    staleDrops?: number;
    linkUnreadyDrops?: number;
    packetSendFailures?: number;
    targetAddress?: string;
    routeKey?: string;
    bridge?: {
      bridgeQueuedFrames?: number;
      bridgeWaitingForDrain?: boolean;
      decodedQueueDepth?: number;
      binaryOutQueueDepth?: number;
      queuePressureDropsLast5s?: number;
      staleDropsLast5s?: number;
      queuePressureDrops?: number;
      staleDrops?: number;
      packetSendFailures?: number;
      packetPathRequests?: number;
      packetPathResolutions?: number;
      packetPathTimeouts?: number;
      packetFreshSends?: number;
      packetStaleSends?: number;
      packetUnknownSends?: number;
    };
  };
};

export type LastReticulumAudioTotals = {
  queuePressureDrops: number;
  staleDrops: number;
  packetSendFailures: number;
  packetPathRequests: number;
  packetPathResolutions: number;
  packetPathTimeouts: number;
  packetFreshSends: number;
  packetStaleSends: number;
  packetUnknownSends: number;
};

export function createInitialReticulumAudioTotals(): LastReticulumAudioTotals {
  return {
    queuePressureDrops: 0,
    staleDrops: 0,
    packetSendFailures: 0,
    packetPathRequests: 0,
    packetPathResolutions: 0,
    packetPathTimeouts: 0,
    packetFreshSends: 0,
    packetStaleSends: 0,
    packetUnknownSends: 0,
  };
}

export function ingestDmReticulumSendResultIntoMetrics(
  metrics: GroupCallPerformanceTracker,
  lastTotalsRef: { current: LastReticulumAudioTotals },
  peerAddress: string,
  res: GcReticulumAudioSendResult
): void {
  const diagnostics = res?.diagnostics;
  if (diagnostics) {
    metrics.setReticulumAudioQueueDepths({
      pendingFrames: diagnostics.pendingFrames,
      bridgeQueuedFrames: diagnostics.bridge?.bridgeQueuedFrames,
      bridgeWaitingForDrain: diagnostics.bridge?.bridgeWaitingForDrain,
      decodedQueueDepth: diagnostics.bridge?.decodedQueueDepth,
      binaryOutQueueDepth: diagnostics.bridge?.binaryOutQueueDepth,
      queuePressureDropsLast5s: diagnostics.bridge?.queuePressureDropsLast5s,
      staleDropsLast5s: diagnostics.bridge?.staleDropsLast5s,
      packetPathRequests: diagnostics.bridge?.packetPathRequests,
      packetPathResolutions: diagnostics.bridge?.packetPathResolutions,
      packetPathTimeouts: diagnostics.bridge?.packetPathTimeouts,
      packetFreshSends: diagnostics.bridge?.packetFreshSends,
      packetStaleSends: diagnostics.bridge?.packetStaleSends,
      packetUnknownSends: diagnostics.bridge?.packetUnknownSends,
    });
    if (diagnostics.bridge) {
      const last = lastTotalsRef.current;
      const b = diagnostics.bridge;
      const queuePressureDelta = Math.max(
        0,
        (b.queuePressureDrops ?? 0) - last.queuePressureDrops
      );
      const staleDelta = Math.max(0, (b.staleDrops ?? 0) - last.staleDrops);
      const packetFailureDelta = Math.max(
        0,
        (b.packetSendFailures ?? 0) - last.packetSendFailures
      );
      const packetPathRequestDelta = Math.max(
        0,
        (b.packetPathRequests ?? 0) - last.packetPathRequests
      );
      const packetPathResolutionDelta = Math.max(
        0,
        (b.packetPathResolutions ?? 0) - last.packetPathResolutions
      );
      const packetPathTimeoutDelta = Math.max(
        0,
        (b.packetPathTimeouts ?? 0) - last.packetPathTimeouts
      );
      const packetFreshSendDelta = Math.max(
        0,
        (b.packetFreshSends ?? 0) - last.packetFreshSends
      );
      const packetStaleSendDelta = Math.max(
        0,
        (b.packetStaleSends ?? 0) - last.packetStaleSends
      );
      const packetUnknownSendDelta = Math.max(
        0,
        (b.packetUnknownSends ?? 0) - last.packetUnknownSends
      );
      if (queuePressureDelta > 0) {
        metrics.recordReticulumAudioQueuePressureDrop(queuePressureDelta);
      }
      if (staleDelta > 0) {
        metrics.recordReticulumAudioStaleDrop(staleDelta);
      }
      if (packetFailureDelta > 0) {
        metrics.recordReticulumAudioPacketSendFailure(packetFailureDelta);
      }
      metrics.recordReticulumAudioPacketPathActivity({
        requests: packetPathRequestDelta,
        resolutions: packetPathResolutionDelta,
        timeouts: packetPathTimeoutDelta,
        freshSends: packetFreshSendDelta,
        staleSends: packetStaleSendDelta,
        unknownSends: packetUnknownSendDelta,
      });
      lastTotalsRef.current = {
        queuePressureDrops: b.queuePressureDrops ?? 0,
        staleDrops: b.staleDrops ?? 0,
        packetSendFailures: b.packetSendFailures ?? 0,
        packetPathRequests: b.packetPathRequests ?? 0,
        packetPathResolutions: b.packetPathResolutions ?? 0,
        packetPathTimeouts: b.packetPathTimeouts ?? 0,
        packetFreshSends: b.packetFreshSends ?? 0,
        packetStaleSends: b.packetStaleSends ?? 0,
        packetUnknownSends: b.packetUnknownSends ?? 0,
      };
    } else {
      if ((diagnostics.queuePressureDrops ?? 0) > 0) {
        metrics.recordReticulumAudioQueuePressureDrop(
          diagnostics.queuePressureDrops ?? 0
        );
      }
      if ((diagnostics.staleDrops ?? 0) > 0) {
        metrics.recordReticulumAudioStaleDrop(diagnostics.staleDrops ?? 0);
      }
      if ((diagnostics.packetSendFailures ?? 0) > 0) {
        metrics.recordReticulumAudioPacketSendFailure(
          diagnostics.packetSendFailures ?? 0
        );
      }
    }
    if ((diagnostics.linkUnreadyDrops ?? 0) > 0) {
      metrics.recordReticulumAudioLinkUnreadyDrop(
        diagnostics.linkUnreadyDrops ?? 0
      );
    }
    const outboundTransport = diagnostics.transport;
    if (outboundTransport === 'link' || outboundTransport === 'packet') {
      metrics.recordReticulumAudioOutboundTransport(outboundTransport);
    }
  }
  if (!res?.success) {
    metrics.recordRelayIpcFailure(1);
  }
}

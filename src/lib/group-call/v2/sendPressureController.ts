/**
 * Group Call V2 — SendPressureController
 *
 * Manages outbound send pressure (bitrate caps, ingress pacing) as a
 * separate concern from local playout recovery.
 *
 * Key design principle (from the architecture plan):
 *   "Split sender relief / bitrate caps into a separate SendPressureController
 *    so local playout recovery cannot get trapped by stale transport or
 *    send-pressure state."
 *
 * In the legacy architecture, send pressure and playout recovery share state:
 * when the transport is congested, the system lowers Opus bitrate AND
 * activates recovery playout mode. This means playout recovery stays active
 * as long as send pressure is active, even if local media has fully recovered.
 *
 * In v2, send pressure is ONLY about managing outbound congestion. It has no
 * visibility into local playout state, and the ReceivePolicyEngine has no
 * visibility into send pressure.
 */

import type {
  IReticulumSessionController,
  SendPressureRequest,
  IDiagnosticsRecorder,
} from './spec';
import { NullDiagnosticsRecorder } from './diagnosticsContract';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SendPressureConfig {
  /** Minimum Opus bitrate in bps (floor during pressure). */
  minBitrateCapBps: number;
  /** Normal Opus bitrate in bps (no pressure). */
  normalBitrateCapBps: number;
  /**
   * Ladder of bitrate steps (descending). The controller steps down through
   * these as pressure signals accumulate.
   */
  bitrateSteps: number[];
  /**
   * How long to hold a bitrate step before relaxing (ms). Prevents oscillation.
   */
  stepHoldMs: number;
  /**
   * How long to hold ingress pacing before releasing (ms).
   */
  ingressPacingMaxMs: number;
}

export const DEFAULT_SEND_PRESSURE_CONFIG: SendPressureConfig = {
  minBitrateCapBps: 24_000,
  normalBitrateCapBps: 32_000,
  bitrateSteps: [32_000, 28_000, 24_000],
  stepHoldMs: 10_000,
  ingressPacingMaxMs: 10_000,
};

// ---------------------------------------------------------------------------
// Pressure signals
// ---------------------------------------------------------------------------

export type SendPressureSignal =
  | 'bridge-queue-high'
  | 'packet-path-timeout'
  | 'loss-rate-high'
  | 'relay-pressure'
  | 'recovered';

// ---------------------------------------------------------------------------
// SendPressureController
// ---------------------------------------------------------------------------

export class SendPressureController {
  private _currentStepIdx = 0;
  private _stepEnteredAtMs = 0;
  private _ingressPacingUntilMs = 0;
  private _lastSentRequest: SendPressureRequest | null = null;
  private readonly _config: SendPressureConfig;
  private readonly _diag: IDiagnosticsRecorder;

  constructor(
    private readonly _sessionController: IReticulumSessionController,
    config: Partial<SendPressureConfig> = {},
    diag?: IDiagnosticsRecorder
  ) {
    this._config = { ...DEFAULT_SEND_PRESSURE_CONFIG, ...config };
    this._diag = diag ?? new NullDiagnosticsRecorder();
  }

  // -------------------------------------------------------------------------
  // Signal ingestion
  // -------------------------------------------------------------------------

  /**
   * Ingest a send pressure signal. Steps down the bitrate ladder if the
   * pressure warrants it, or relaxes if the signal is 'recovered'.
   */
  ingestSignal(signal: SendPressureSignal, nowMs: number): void {
    const prevStep = this._currentStepIdx;

    switch (signal) {
      case 'recovered': {
        // Relax one step after holding period, not all the way immediately.
        if (
          this._currentStepIdx > 0 &&
          nowMs - this._stepEnteredAtMs >= this._config.stepHoldMs
        ) {
          this._currentStepIdx--;
          this._stepEnteredAtMs = nowMs;
        }
        // Clear ingress pacing.
        this._ingressPacingUntilMs = 0;
        break;
      }

      case 'bridge-queue-high':
      case 'packet-path-timeout':
      case 'relay-pressure': {
        // Step down if not already at the floor.
        const maxStep = this._config.bitrateSteps.length - 1;
        if (this._currentStepIdx < maxStep) {
          this._currentStepIdx++;
          this._stepEnteredAtMs = nowMs;
        }
        break;
      }

      case 'loss-rate-high': {
        // Loss rate warrants ingress pacing in addition to bitrate step.
        const maxStep = this._config.bitrateSteps.length - 1;
        if (this._currentStepIdx < maxStep) {
          this._currentStepIdx++;
          this._stepEnteredAtMs = nowMs;
        }
        this._ingressPacingUntilMs = Math.max(
          this._ingressPacingUntilMs,
          nowMs + this._config.ingressPacingMaxMs
        );
        break;
      }
    }

    // Only emit a new request if something changed.
    const newBitrate = this._config.bitrateSteps[this._currentStepIdx];
    const prevBitrate = this._lastSentRequest?.bitrateCapBps ?? this._config.normalBitrateCapBps;
    const ingressPacing = nowMs < this._ingressPacingUntilMs;

    if (newBitrate !== prevBitrate || ingressPacing !== (this._lastSentRequest?.ingressPacing ?? false)) {
      const request: SendPressureRequest = {
        bitrateCapBps: newBitrate,
        ingressPacing,
        requestedAtMs: nowMs,
        reason: `signal:${signal},step:${this._currentStepIdx}`,
      };
      this._lastSentRequest = request;
      this._sessionController.requestSendPressure(request);
      this._diag.recordSendPressure(request);
    }

    void prevStep;
  }

  /**
   * Periodic tick — release pressure that has expired.
   */
  tick(nowMs: number): void {
    if (
      this._currentStepIdx > 0 &&
      nowMs - this._stepEnteredAtMs >= this._config.stepHoldMs * 2
    ) {
      // Auto-release after 2× hold period with no signals.
      this.ingestSignal('recovered', nowMs);
    }

    // Auto-release ingress pacing.
    if (this._ingressPacingUntilMs > 0 && nowMs >= this._ingressPacingUntilMs) {
      this._ingressPacingUntilMs = 0;
      const request: SendPressureRequest = {
        bitrateCapBps: this._config.bitrateSteps[this._currentStepIdx],
        ingressPacing: false,
        requestedAtMs: nowMs,
        reason: 'ingress-pacing-auto-released',
      };
      this._lastSentRequest = request;
      this._sessionController.requestSendPressure(request);
    }
  }

  getCurrentBitrateCapBps(): number {
    return this._config.bitrateSteps[this._currentStepIdx];
  }

  isIngressPacingActive(nowMs: number): boolean {
    return nowMs < this._ingressPacingUntilMs;
  }

  reset(): void {
    this._currentStepIdx = 0;
    this._stepEnteredAtMs = 0;
    this._ingressPacingUntilMs = 0;
    this._lastSentRequest = null;
  }
}

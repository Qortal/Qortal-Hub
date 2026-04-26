/**
 * Group Call V2 — ReceivePolicyEngine
 *
 * Explicit per-stream FSM that replaces the heuristic mesh currently embedded in:
 *  - `useGroupVoiceCall.ts` (N=1 logic, adaptive mode, starvation handling)
 *  - `gcallN1PlayoutGate.ts` (tier/burst caps, rebuild logic)
 *  - `gcallPlayoutStarvation.ts` (severity classification)
 *  - `gcallPlayoutPolicy.ts` (buffer-enforce active)
 *
 * FSM states and transitions:
 *
 *  coldStart ──(buffer >= startThreshold)──► steady
 *             ──(no packets > missingThreshold)──► missingMedia
 *
 *  steady ──(transport degraded evidence)──► transportDegraded
 *         ──(opus > target * backlogRatio)──► backlogDrain
 *         ──(seq gap detected)──► lossRecovery
 *         ──(no packets > missingThreshold)──► missingMedia
 *
 *  transportDegraded ──(evidence TTL expires && freshMedia)──► backlogDrain
 *                    ──(no packets > missingThreshold)──► missingMedia
 *                    // CANNOT stay here forever — TTL-gated
 *
 *  backlogDrain ──(opus < target * 0.5 && pcm >= target * 0.3)──► steady
 *               ──(transport evidence renewed)──► transportDegraded
 *
 *  lossRecovery ──(gap filled OR plc applied)──► steady
 *               ──(persistent loss > lossRecoveryTimeoutMs)──► steady
 *
 *  missingMedia ──(packet arrives)──► coldStart
 *
 * Core invariants:
 *  1. `transportDegraded` always carries a TTL. Expiry → `backlogDrain`.
 *  2. `backlogDrain` drains the Opus backlog at max rate. It does NOT wait
 *     for PCM to reach a "rebuild" threshold before releasing — that is the
 *     mechanism that caused the call-63 trap.
 *  3. The FSM does NOT know about send pressure. SendPressureController is
 *     separate and does not feed back into these transitions.
 *  4. All seq comparisons use modulo-safe arithmetic.
 */

import type {
  StreamIdentity,
  ReceiveState,
  ReceiveStateTransition,
  ReceivePolicyOutput,
  PeerHealthSnapshot,
  IDiagnosticsRecorder,
} from './spec';
import { streamKey } from './spec';
import { NullDiagnosticsRecorder } from './diagnosticsContract';

// ---------------------------------------------------------------------------
// Policy configuration
// ---------------------------------------------------------------------------

export interface ReceivePolicyConfig {
  /** Frames needed before exiting coldStart. */
  startThresholdFrames: number;
  /** Target PCM buffer depth in ms. */
  targetBufferMs: number;
  /** Temporary target increase applied just after startup/media resume. */
  startupExtraBufferMs: number;
  /** How long startup warmup stays active after startup/media resume. */
  startupWarmupMs: number;
  /** Max decode frames per tick in steady state. */
  steadyMaxDecodePerTick: number;
  /** Max decode frames per tick during startup warmup. */
  startupMaxDecodePerTick: number;
  /** Max decode frames per tick in backlogDrain (higher = faster drain). */
  drainMaxDecodePerTick: number;
  /**
   * If Opus buffered > target * this ratio, transition to backlogDrain.
   * Default 1.0 (as motivated by GCALL_N1_SEVERE_RELEASE_OPUS_OVERFLOW_EXIT_RATIO).
   */
  backlogDrainTriggerRatio: number;
  /**
   * If playable PCM is still low but some Opus reserve exists, transition to
   * backlogDrain even without a full Opus overflow.
   */
  pcmDeficitDrainThreshold: number;
  /** Minimum Opus reserve ratio required for the PCM-deficit drain trigger. */
  pcmDeficitOpusMinRatio: number;
  /**
   * More aggressive PCM-deficit trigger used during startup warmup so shallow
   * reserve enters recovery sooner.
   */
  startupPcmDeficitDrainThreshold: number;
  /** Lower Opus reserve floor used during startup warmup. */
  startupPcmDeficitOpusMinRatio: number;
  /**
   * Exit backlogDrain when Opus buffered < target * this ratio AND pcm is healthy.
   * Default 0.5.
   */
  backlogDrainExitRatio: number;
  /**
   * Minimum PCM buffer for backlogDrain exit (ms). Much lower than legacy
   * GCALL_N1_SEVERE_RELEASE_EXIT_PCM_MS because the FSM doesn't wait for PCM
   * to reach a high threshold — it just needs to be non-empty.
   */
  backlogDrainExitMinPcmMs: number;
  /** Relative PCM floor for backlogDrain exit. */
  backlogDrainExitTargetFloorRatio: number;
  /** Exit backlogDrain when decoded PCM reserve grows beyond this ratio. */
  decodedPcmLatencyCeilingRatio: number;
  /** Only allow backlogDrain entry once decoded PCM falls below this ratio. */
  decodedPcmLatencyResumeRatio: number;
  /** Minimum time after leaving backlogDrain before re-entering it. */
  backlogDrainReentryCooldownMs: number;
  /**
   * No-packet timeout before transitioning to missingMedia (ms).
   * Default 2000ms.
   */
  missingMediaThresholdMs: number;
  /**
   * How long to stay in lossRecovery before returning to steady (ms).
   */
  lossRecoveryTimeoutMs: number;
  /**
   * Maximum time to stay in transportDegraded even if evidence is renewed (ms).
   * This is the hard TTL cap that prevents indefinite degraded mode.
   * Default 8000ms.
   */
  transportDegradedHardTtlMs: number;
  /** PCM target increase in transportDegraded state (ms). */
  transportDegradedExtraBufferMs: number;
  /** Extra target buffer while steady-state spike recovery is active. */
  steadyStateRecoveryExtraBufferMs: number;
  /** How long steady-state spike recovery stays active once armed. */
  steadyStateRecoveryHoldMs: number;
  /** Thin-PCM floor that arms steady-state spike recovery. */
  steadyStateRecoveryLowPcmMs: number;
  /** Consecutive thin-PCM ticks required to arm steady-state spike recovery. */
  steadyStateRecoveryLowPcmTicks: number;
  /** Only arm steady-state spike recovery while packet activity is recent. */
  steadyStateRecoveryRecentPacketAgeMs: number;
  /** Immediate spike trigger for steady-state recovery. */
  steadyStateRecoverySpikeGapMs: number;
  /** Arrival-gap evidence stays relevant for this long. */
  steadyStateRecoverySpikeWindowMs: number;
  /** Fresh concealment events can arm steady-state recovery immediately. */
  steadyStateRecoveryConcealmentFrames: number;
  /** Longer hold applied when a real post-spike gap arms recovery. */
  steadyStateRecoveryPostSpikeHoldMs: number;
  /** Under steady-state instability, keep draining until at least this PCM reserve is rebuilt. */
  steadyStateRecoveryExitMinPcmMs: number;
  /** Under steady-state instability, enter drain sooner while reserve is still shallow. */
  steadyStateRecoveryPcmDeficitDrainThreshold: number;
}

export const DEFAULT_POLICY_CONFIG: ReceivePolicyConfig = {
  startThresholdFrames: 4,
  targetBufferMs: 120,
  startupExtraBufferMs: 80,
  startupWarmupMs: 6_000,
  steadyMaxDecodePerTick: 3,
  startupMaxDecodePerTick: 8,
  drainMaxDecodePerTick: 9,
  backlogDrainTriggerRatio: 1.0,
  pcmDeficitDrainThreshold: 0.65,
  pcmDeficitOpusMinRatio: 0.35,
  startupPcmDeficitDrainThreshold: 0.9,
  startupPcmDeficitOpusMinRatio: 0.15,
  backlogDrainExitRatio: 0.45,
  backlogDrainExitMinPcmMs: 20,
  backlogDrainExitTargetFloorRatio: 0.6,
  decodedPcmLatencyCeilingRatio: 1.8,
  decodedPcmLatencyResumeRatio: 1.35,
  backlogDrainReentryCooldownMs: 120,
  missingMediaThresholdMs: 2_000,
  lossRecoveryTimeoutMs: 500,
  transportDegradedHardTtlMs: 8_000,
  transportDegradedExtraBufferMs: 40,
  steadyStateRecoveryExtraBufferMs: 60,
  steadyStateRecoveryHoldMs: 3_000,
  steadyStateRecoveryLowPcmMs: 18,
  steadyStateRecoveryLowPcmTicks: 3,
  steadyStateRecoveryRecentPacketAgeMs: 300,
  steadyStateRecoverySpikeGapMs: 180,
  steadyStateRecoverySpikeWindowMs: 4_000,
  steadyStateRecoveryConcealmentFrames: 1,
  steadyStateRecoveryPostSpikeHoldMs: 5_000,
  steadyStateRecoveryExitMinPcmMs: 96,
  steadyStateRecoveryPcmDeficitDrainThreshold: 0.9,
};

export const DEFAULT_DECODED_PCM_LATENCY_MIN_EXTRA_MS = 80;
export const DEFAULT_DECODED_PCM_LATENCY_RESUME_MIN_EXTRA_MS = 40;

export function computeDecodedPcmLatencyCeilingMs(
  targetBufferMs: number,
  decodedPcmLatencyCeilingRatio: number,
  minExtraMs: number = DEFAULT_DECODED_PCM_LATENCY_MIN_EXTRA_MS
): number {
  return Math.max(
    targetBufferMs * decodedPcmLatencyCeilingRatio,
    targetBufferMs + minExtraMs
  );
}

export function computeDecodedPcmLatencyResumeMs(
  targetBufferMs: number,
  decodedPcmLatencyResumeRatio: number,
  minExtraMs: number = DEFAULT_DECODED_PCM_LATENCY_RESUME_MIN_EXTRA_MS
): number {
  return Math.max(
    targetBufferMs * decodedPcmLatencyResumeRatio,
    targetBufferMs + minExtraMs
  );
}

// ---------------------------------------------------------------------------
// FSM state data
// ---------------------------------------------------------------------------

interface FsmStateData {
  enteredAtMs: number;
  /** For transportDegraded: when to force-exit regardless of evidence renewal. */
  hardExpiryMs?: number;
}

// ---------------------------------------------------------------------------
// ReceivePolicyEngine
// ---------------------------------------------------------------------------

export interface PolicyTickInput {
  readonly nowMs: number;
  readonly streamId: StreamIdentity;
  /** Frames currently in the jitter buffer. */
  readonly jitterDepth: number;
  /** Opus-buffered milliseconds (jitter buffer depth in ms). */
  readonly opusBufferedMs: number;
  /** PCM ring fill in ms. */
  readonly pcmBufferedMs: number;
  /** Age of the most recent packet push (ms). */
  readonly lastPushAgeMs: number;
  /** Seq gap count from the last jitter buffer pop (0 if no gap). */
  readonly lastGapFrames: number;
  /** Cumulative concealment frames generated by the receive engine. */
  readonly totalConcealmentFrames: number;
  /** Most recent inter-arrival gap seen on this source, if still fresh. */
  readonly recentArrivalGapMs: number;
  /** Current peer health from the control plane. */
  readonly peerHealth: PeerHealthSnapshot | null;
}

export class ReceivePolicyEngine {
  private _state: ReceiveState = 'coldStart';
  private _stateData: FsmStateData = { enteredAtMs: 0 };
  private readonly _key: string;
  private readonly _diag: IDiagnosticsRecorder;
  private _config: ReceivePolicyConfig;
  private _lastTransition: ReceiveStateTransition | null = null;
  private _transitionHistory: ReceiveStateTransition[] = [];
  private _backlogDrainReentryBlockedUntilMs = 0;
  private _startupWarmupUntilMs = 0;
  private _steadyStateRecoveryUntilMs = 0;
  private _consecutiveThinPcmTicks = 0;
  private _lastObservedConcealmentFrames = 0;

  constructor(
    readonly streamId: StreamIdentity,
    config: Partial<ReceivePolicyConfig> = {},
    diag?: IDiagnosticsRecorder
  ) {
    this._key = streamKey(streamId);
    this._config = { ...DEFAULT_POLICY_CONFIG, ...config };
    this._diag = diag ?? new NullDiagnosticsRecorder();
    this._stateData = { enteredAtMs: performance.now() };
  }

  get state(): ReceiveState {
    return this._state;
  }

  reconfigure(config: Partial<ReceivePolicyConfig>): void {
    this._config = { ...this._config, ...config };
  }

  // -------------------------------------------------------------------------
  // Main tick — evaluate transitions and produce policy output
  // -------------------------------------------------------------------------

  tick(input: PolicyTickInput): ReceivePolicyOutput {
    const prevState = this._state;
    this._evaluateTransitions(input);
    const output = this._buildOutput(input);

    if (this._state !== prevState) {
      const transition: ReceiveStateTransition = {
        fromState: prevState,
        toState: this._state,
        reason: this._lastTransition?.reason ?? 'unknown',
        atMs: input.nowMs,
        streamKey: this._key,
      };
      this._diag.recordStateTransition(transition, {
        maxDecodePerTick: output.maxDecodePerTick,
        targetBufferMs: output.targetBufferMs,
      });
      this._transitionHistory.push(transition);
      if (this._transitionHistory.length > 100) {
        this._transitionHistory.shift();
      }
    }

    return output;
  }

  // -------------------------------------------------------------------------
  // Transition logic
  // -------------------------------------------------------------------------

  private _evaluateTransitions(input: PolicyTickInput): void {
    const { nowMs, opusBufferedMs, pcmBufferedMs, lastPushAgeMs, jitterDepth, lastGapFrames } = input;
    const cfg = this._config;
    this._observeSteadyStateRecovery(input);
    const effectiveTargetBufferMs = this._effectiveTargetBufferMs(nowMs);
    const backlogDrainResumePcmCeiling = computeDecodedPcmLatencyResumeMs(
      effectiveTargetBufferMs,
      cfg.decodedPcmLatencyResumeRatio
    );
    const backlogDrainExitPcmCeiling = computeDecodedPcmLatencyCeilingMs(
      cfg.targetBufferMs,
      cfg.decodedPcmLatencyCeilingRatio
    );
    const backlogDrainReentryBlocked =
      nowMs < this._backlogDrainReentryBlockedUntilMs;
    const pcmDeficitDrainThreshold = this._effectivePcmDeficitDrainThreshold(nowMs);
    const pcmDeficitOpusMinRatio = this._effectivePcmDeficitOpusMinRatio(nowMs);

    // Missing media check applies from any state.
    const sourceGone = lastPushAgeMs > cfg.missingMediaThresholdMs;

    switch (this._state) {
      case 'coldStart': {
        if (sourceGone) {
          this._transition('missingMedia', nowMs, 'no-packets-during-coldstart');
          break;
        }
        if (jitterDepth >= cfg.startThresholdFrames) {
          this._transition('steady', nowMs, 'jitter-filled-to-start-threshold');
        }
        break;
      }

      case 'steady': {
        if (sourceGone) {
          this._transition('missingMedia', nowMs, 'no-packets-steady');
          break;
        }
        // Transport degradation signal from control plane should win over
        // buffer-growth policy so genuine control-plane trouble is classified
        // correctly instead of being masked as a local backlog drain.
        if (
          input.peerHealth &&
          (input.peerHealth.level === 'degraded' || input.peerHealth.level === 'recovering') &&
          !input.peerHealth.freshLocalMediaConfirmed
        ) {
          this._transition('transportDegraded', nowMs, `peer-health:${input.peerHealth.level}`);
          break;
        }
        if (
          !backlogDrainReentryBlocked &&
          pcmBufferedMs < backlogDrainResumePcmCeiling &&
          pcmBufferedMs < effectiveTargetBufferMs * pcmDeficitDrainThreshold &&
          opusBufferedMs >= effectiveTargetBufferMs * pcmDeficitOpusMinRatio
        ) {
          this._transition(
            'backlogDrain',
            nowMs,
            `pcm-deficit:pcm=${pcmBufferedMs.toFixed(0)}ms,opus=${opusBufferedMs.toFixed(0)}ms`
          );
          break;
        }
        // Backlog: more Opus than a full target = drain it.
        if (
          !backlogDrainReentryBlocked &&
          pcmBufferedMs < backlogDrainResumePcmCeiling &&
          opusBufferedMs >= effectiveTargetBufferMs * cfg.backlogDrainTriggerRatio
        ) {
          this._transition('backlogDrain', nowMs, `opus-overflow:${opusBufferedMs.toFixed(0)}ms>=${effectiveTargetBufferMs}ms`);
          break;
        }
        // Loss recovery.
        if (lastGapFrames > 0) {
          this._transition(
            'lossRecovery',
            nowMs,
            lastGapFrames <= 8
              ? `gap:${lastGapFrames}-frames`
              : `gap-large:${lastGapFrames}-frames`
          );
          break;
        }
        break;
      }

      case 'transportDegraded': {
        if (sourceGone) {
          this._transition('missingMedia', nowMs, 'no-packets-transport-degraded');
          break;
        }
        const enteredMs = this._stateData.enteredAtMs;
        const hardExpiry = this._stateData.hardExpiryMs ?? (enteredMs + cfg.transportDegradedHardTtlMs);

        // Hard TTL: even if evidence keeps being renewed, force exit.
        const hardTtlExpired = nowMs >= hardExpiry;

        // Evidence TTL: health recovered + fresh local media contradicts degradation.
        const evidenceExpired =
          input.peerHealth === null ||
          input.peerHealth.level === 'healthy' ||
          input.peerHealth.freshLocalMediaConfirmed;

        if (hardTtlExpired || evidenceExpired) {
          // Transition to backlogDrain if there's a backlog, else steady.
          if (
            pcmBufferedMs < backlogDrainResumePcmCeiling &&
            opusBufferedMs >= effectiveTargetBufferMs * 0.5
          ) {
            this._transition('backlogDrain', nowMs,
              hardTtlExpired ? 'transport-degraded-hard-ttl' : 'transport-evidence-expired-backlog');
          } else {
            this._transition('steady', nowMs,
              hardTtlExpired ? 'transport-degraded-hard-ttl' : 'transport-evidence-expired');
          }
        }
        break;
      }

      case 'backlogDrain': {
        if (sourceGone) {
          this._transition('missingMedia', nowMs, 'no-packets-backlog-drain');
          break;
        }
        // Re-enter transportDegraded if new strong degradation evidence arrives.
        if (
          input.peerHealth &&
          input.peerHealth.level === 'degraded' &&
          !input.peerHealth.freshLocalMediaConfirmed
        ) {
          this._transition('transportDegraded', nowMs, `peer-health-renewed:${input.peerHealth.level}`);
          break;
        }
        if (pcmBufferedMs >= backlogDrainExitPcmCeiling) {
          this._transition(
            'steady',
            nowMs,
            `pcm-latency-cap:pcm=${pcmBufferedMs.toFixed(0)}ms`
          );
          break;
        }
        // Exit when backlog is drained and PCM has enough content.
        const exitPcmFloor = this._effectiveBacklogDrainExitPcmFloor(nowMs);
        if (
          opusBufferedMs < cfg.targetBufferMs * cfg.backlogDrainExitRatio &&
          pcmBufferedMs >= exitPcmFloor
        ) {
          this._transition('steady', nowMs,
            `backlog-drained:opus=${opusBufferedMs.toFixed(0)}ms,pcm=${pcmBufferedMs.toFixed(0)}ms`);
        }
        break;
      }

      case 'lossRecovery': {
        if (sourceGone) {
          this._transition('missingMedia', nowMs, 'no-packets-loss-recovery');
          break;
        }
        const elapsed = nowMs - this._stateData.enteredAtMs;
        // Return to steady after timeout or when gap is resolved.
        if (elapsed >= cfg.lossRecoveryTimeoutMs || lastGapFrames === 0) {
          // If there's a backlog, go to drain first.
          if (
            pcmBufferedMs < backlogDrainResumePcmCeiling &&
            opusBufferedMs >= effectiveTargetBufferMs * cfg.backlogDrainTriggerRatio
          ) {
            this._transition('backlogDrain', nowMs, 'loss-recovered-backlog');
          } else {
            this._transition('steady', nowMs, elapsed >= cfg.lossRecoveryTimeoutMs
              ? 'loss-recovery-timeout' : 'loss-recovered');
          }
        }
        break;
      }

      case 'missingMedia': {
        // Any packet arrival restarts from coldStart.
        if (lastPushAgeMs < cfg.missingMediaThresholdMs / 2) {
          this._transition('coldStart', nowMs, 'packets-resumed');
        }
        break;
      }
    }
  }

  private _transition(to: ReceiveState, nowMs: number, reason: string): void {
    const fromState = this._state;
    if (fromState === 'backlogDrain' && to === 'steady') {
      this._backlogDrainReentryBlockedUntilMs =
        nowMs + this._config.backlogDrainReentryCooldownMs;
    }
    if (
      (fromState === 'coldStart' || fromState === 'missingMedia') &&
      (to === 'steady' || to === 'backlogDrain')
    ) {
      this._armStartupWarmup(nowMs);
    }
    if (fromState === 'missingMedia' && to === 'coldStart') {
      this._armStartupWarmup(nowMs);
    }
    const hardExpiry = to === 'transportDegraded'
      ? nowMs + this._config.transportDegradedHardTtlMs
      : undefined;
    this._state = to;
    this._stateData = { enteredAtMs: nowMs, hardExpiryMs: hardExpiry };
    this._lastTransition = {
      fromState: this._lastTransition?.toState ?? 'coldStart',
      toState: to,
      reason,
      atMs: nowMs,
      streamKey: this._key,
    };
  }

  // -------------------------------------------------------------------------
  // Output builder
  // -------------------------------------------------------------------------

  private _buildOutput(input: PolicyTickInput): ReceivePolicyOutput {
    const cfg = this._config;
    const startupWarmup = this._isStartupWarmupActive(input.nowMs);
    const steadyStateRecovery = this._isSteadyStateRecoveryActive(input.nowMs);
    const effectiveTargetBufferMs = this._effectiveTargetBufferMs(input.nowMs);
    switch (this._state) {
      case 'coldStart':
        return {
          state: 'coldStart',
          maxDecodePerTick: startupWarmup || steadyStateRecovery
            ? Math.max(cfg.steadyMaxDecodePerTick, cfg.startupMaxDecodePerTick)
            : cfg.steadyMaxDecodePerTick,
          targetBufferMs: effectiveTargetBufferMs,
          holdPlayout: true,
          aggressiveDrain: false,
          enableConcealment: false,
        };

      case 'steady':
        return {
          state: 'steady',
          maxDecodePerTick: startupWarmup || steadyStateRecovery
            ? Math.max(cfg.steadyMaxDecodePerTick, cfg.startupMaxDecodePerTick)
            : cfg.steadyMaxDecodePerTick,
          targetBufferMs: effectiveTargetBufferMs,
          holdPlayout: false,
          aggressiveDrain: false,
          enableConcealment: true,
        };

      case 'transportDegraded':
        return {
          state: 'transportDegraded',
          maxDecodePerTick: startupWarmup || steadyStateRecovery
            ? Math.max(cfg.steadyMaxDecodePerTick, cfg.startupMaxDecodePerTick)
            : cfg.steadyMaxDecodePerTick,
          targetBufferMs: effectiveTargetBufferMs + cfg.transportDegradedExtraBufferMs,
          holdPlayout: false,
          aggressiveDrain: false,
          enableConcealment: true,
        };

      case 'backlogDrain':
        return {
          state: 'backlogDrain',
          maxDecodePerTick: cfg.drainMaxDecodePerTick,
          targetBufferMs: effectiveTargetBufferMs,
          holdPlayout: false,
          aggressiveDrain: true,
          enableConcealment: false,
        };

      case 'lossRecovery':
        return {
          state: 'lossRecovery',
          maxDecodePerTick: startupWarmup || steadyStateRecovery
            ? Math.max(cfg.steadyMaxDecodePerTick, cfg.startupMaxDecodePerTick)
            : cfg.steadyMaxDecodePerTick,
          targetBufferMs: effectiveTargetBufferMs,
          holdPlayout: false,
          aggressiveDrain: false,
          enableConcealment: true,
        };

      case 'missingMedia':
        return {
          state: 'missingMedia',
          maxDecodePerTick: 0,
          targetBufferMs: effectiveTargetBufferMs,
          holdPlayout: true,
          aggressiveDrain: false,
          enableConcealment: false,
        };
    }
  }

  private _armStartupWarmup(nowMs: number): void {
    this._startupWarmupUntilMs = Math.max(
      this._startupWarmupUntilMs,
      nowMs + this._config.startupWarmupMs
    );
  }

  private _isStartupWarmupActive(nowMs: number): boolean {
    return nowMs < this._startupWarmupUntilMs;
  }

  private _armSteadyStateRecovery(
    nowMs: number,
    holdMs = this._config.steadyStateRecoveryHoldMs
  ): void {
    this._steadyStateRecoveryUntilMs = Math.max(
      this._steadyStateRecoveryUntilMs,
      nowMs + holdMs
    );
  }

  private _isSteadyStateRecoveryActive(nowMs: number): boolean {
    return nowMs < this._steadyStateRecoveryUntilMs;
  }

  private _effectiveTargetBufferMs(nowMs: number): number {
    let targetBufferMs = this._config.targetBufferMs;
    if (this._isStartupWarmupActive(nowMs)) {
      targetBufferMs += this._config.startupExtraBufferMs;
    }
    if (this._isSteadyStateRecoveryActive(nowMs)) {
      targetBufferMs += this._config.steadyStateRecoveryExtraBufferMs;
    }
    return targetBufferMs;
  }

  private _effectivePcmDeficitDrainThreshold(nowMs: number): number {
    if (this._isSteadyStateRecoveryActive(nowMs)) {
      return Math.max(
        this._config.pcmDeficitDrainThreshold,
        this._config.steadyStateRecoveryPcmDeficitDrainThreshold
      );
    }
    return this._isStartupWarmupActive(nowMs)
      ? Math.max(
          this._config.pcmDeficitDrainThreshold,
          this._config.startupPcmDeficitDrainThreshold
        )
      : this._config.pcmDeficitDrainThreshold;
  }

  private _effectivePcmDeficitOpusMinRatio(nowMs: number): number {
    return this._isStartupWarmupActive(nowMs)
      ? Math.min(
          this._config.pcmDeficitOpusMinRatio,
          this._config.startupPcmDeficitOpusMinRatio
        )
      : this._config.pcmDeficitOpusMinRatio;
  }

  private _effectiveBacklogDrainExitPcmFloor(nowMs: number): number {
    const baseFloor = Math.max(
      this._config.backlogDrainExitMinPcmMs,
      this._config.targetBufferMs * this._config.backlogDrainExitTargetFloorRatio
    );
    if (this._isSteadyStateRecoveryActive(nowMs)) {
      return Math.max(baseFloor, this._config.steadyStateRecoveryExitMinPcmMs);
    }
    return baseFloor;
  }

  private _observeSteadyStateRecovery(input: PolicyTickInput): void {
    const { nowMs, pcmBufferedMs, lastPushAgeMs, totalConcealmentFrames, recentArrivalGapMs } = input;
    if (
      this._state !== 'steady' ||
      this._isStartupWarmupActive(nowMs)
    ) {
      this._consecutiveThinPcmTicks = 0;
      this._lastObservedConcealmentFrames = totalConcealmentFrames;
      return;
    }

    const recentPacketActivity =
      lastPushAgeMs <= this._config.steadyStateRecoveryRecentPacketAgeMs;
    const concealmentDelta = Math.max(
      0,
      totalConcealmentFrames - this._lastObservedConcealmentFrames
    );
    this._lastObservedConcealmentFrames = totalConcealmentFrames;
    const thinPcm =
      pcmBufferedMs <= Math.max(
        this._config.steadyStateRecoveryLowPcmMs,
        this._config.targetBufferMs * 0.18
      );
    const recentSpike =
      recentArrivalGapMs >= this._config.steadyStateRecoverySpikeGapMs;

    if (recentPacketActivity && recentSpike) {
      this._armSteadyStateRecovery(
        nowMs,
        this._config.steadyStateRecoveryPostSpikeHoldMs
      );
      this._consecutiveThinPcmTicks = Math.max(
        this._consecutiveThinPcmTicks,
        this._config.steadyStateRecoveryLowPcmTicks - 1
      );
      return;
    }

    if (
      recentPacketActivity &&
      concealmentDelta >= this._config.steadyStateRecoveryConcealmentFrames
    ) {
      this._armSteadyStateRecovery(nowMs);
      this._consecutiveThinPcmTicks = Math.max(
        this._consecutiveThinPcmTicks,
        this._config.steadyStateRecoveryLowPcmTicks - 1
      );
      return;
    }

    if (recentPacketActivity && thinPcm) {
      this._consecutiveThinPcmTicks += 1;
      if (
        this._consecutiveThinPcmTicks >=
        this._config.steadyStateRecoveryLowPcmTicks
      ) {
        this._armSteadyStateRecovery(nowMs);
      }
      return;
    }

    if (
      pcmBufferedMs >=
      Math.max(
        this._config.steadyStateRecoveryLowPcmMs + 8,
        this._config.targetBufferMs * 0.28
      )
    ) {
      this._consecutiveThinPcmTicks = 0;
    } else if (!recentPacketActivity) {
      this._consecutiveThinPcmTicks = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  getTransitionHistory(): readonly ReceiveStateTransition[] {
    return this._transitionHistory;
  }

  reset(): void {
    this._state = 'coldStart';
    this._stateData = { enteredAtMs: performance.now() };
    this._lastTransition = null;
    this._transitionHistory = [];
    this._startupWarmupUntilMs = 0;
    this._backlogDrainReentryBlockedUntilMs = 0;
    this._steadyStateRecoveryUntilMs = 0;
    this._consecutiveThinPcmTicks = 0;
    this._lastObservedConcealmentFrames = 0;
  }
}

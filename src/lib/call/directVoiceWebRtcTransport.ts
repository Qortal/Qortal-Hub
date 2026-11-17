export type DirectVoiceRtcSignal =
  | {
      kind: 'description';
      generation: string;
      description: RTCSessionDescriptionInit;
    }
  | {
      kind: 'ice';
      generation: string;
      candidate: RTCIceCandidateInit | null;
    }
  | {
      kind: 'ice-candidates';
      generation: string;
      candidates: RTCIceCandidateInit[];
    }
  | {
      kind: 'ice-refresh-request';
      generation: string;
    };

export type DirectVoiceRtcState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'recovering'
  | 'closed';

type DirectVoiceWebRtcTransportOptions = {
  offerer: boolean;
  getIceServers: () => Promise<RTCIceServer[]>;
  localStream: MediaStream;
  onSignal: (signal: DirectVoiceRtcSignal) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onState?: (state: DirectVoiceRtcState) => void;
  onDiagnostic?: (stage: string, detail: Record<string, unknown>) => void;
};

const ICE_DISCONNECT_GRACE_MS = 3_000;
const ICE_RESTART_MIN_INTERVAL_MS = 6_000;
const ICE_RESTART_MAX_ATTEMPTS = 2;
const ICE_RESTART_COOLDOWN_MS = 30_000;
const ICE_SERVER_REFRESH_INTERVAL_MS = 750;
const ICE_SERVER_REFRESH_WINDOW_MS = 12_000;
// The authenticated Reticulum control path has a much higher per-bundle cost
// than a conventional WebSocket signaler. Coalesce candidates discovered near
// each other while still sending the SDP immediately, so negotiation is not
// delayed and candidates are never assumed to be embedded in that SDP.
const LOCAL_ICE_CANDIDATE_BATCH_MS = 75;
const MAX_PENDING_ICE_CANDIDATES = 128;

function nextGeneration(): string {
  return crypto.randomUUID();
}

/**
 * Native WebRTC audio for a direct call. Signaling is supplied by the caller
 * and transported separately over the authenticated direct Reticulum link.
 * This class never logs SDP, candidates, tracks, or packet contents.
 */
export class DirectVoiceWebRtcTransport {
  private pc: RTCPeerConnection | null = null;
  private generation = '';
  private state: DirectVoiceRtcState = 'idle';
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private earlyCandidatesByGeneration = new Map<
    string,
    RTCIceCandidateInit[]
  >();
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private lastRestartAt = 0;
  private remoteAudioTrackSeen = false;
  private closed = false;
  private configuredIceServerCount = 0;
  private configuredIceServerUrls: string[] = [];
  private localCandidateCounts = new Map<string, number>();
  private remoteCandidateCounts = new Map<string, number>();
  private iceServerRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private iceServerRefreshDeadline = 0;
  private iceServerRefreshInFlight = false;
  private lateIceRestartIssued = false;
  private iceRefreshRequestSent = false;
  private pendingIceRefreshRequest = false;
  private pendingLateIceRestart = false;
  private localDescriptionSignalPending = false;
  private bufferedLocalCandidates: Array<{
    generation: string;
    candidate: RTCIceCandidateInit;
  }> = [];
  private localCandidateBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private operationChain: Promise<void> = Promise.resolve();
  private retiredGenerations = new Set<string>();

  constructor(private readonly options: DirectVoiceWebRtcTransportOptions) {}

  getState(): DirectVoiceRtcState {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === 'open' && this.pc?.connectionState === 'connected';
  }

  async start(): Promise<void> {
    if (this.closed || this.pc) return;
    this.generation = this.options.offerer ? nextGeneration() : '';
    await this.createPeerConnection();
    if (!this.options.offerer || !this.pc) return;
    await this.sendOffer(false);
  }

  setMuted(muted: boolean): void {
    for (const track of this.options.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  async replaceLocalStream(stream: MediaStream): Promise<void> {
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const nextTrack = stream.getAudioTracks()[0] ?? null;
    if (!nextTrack) throw new Error('native-webrtc-microphone-track-missing');
    const previousStream = this.options.localStream;
    const sender = this.pc
      ?.getSenders()
      .find((entry) => entry.track?.kind === 'audio');
    if (!sender) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('native-webrtc-audio-sender-missing');
    }
    await sender.replaceTrack(nextTrack);
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('native-webrtc-track-replacement-cancelled');
    }
    this.options.localStream = stream;
    previousStream.getTracks().forEach((track) => track.stop());
  }

  async handleSignal(signal: DirectVoiceRtcSignal): Promise<void> {
    return this.enqueueOperation(() => this.handleSignalInternal(signal));
  }

  private async handleSignalInternal(
    signal: DirectVoiceRtcSignal
  ): Promise<void> {
    if (this.closed) return;
    if (!this.pc) await this.createPeerConnection();
    let pc = this.pc;
    if (!pc) return;

    if (signal.kind === 'ice-refresh-request') {
      if (
        !this.options.offerer ||
        !signal.generation ||
        signal.generation !== this.generation ||
        this.isOpen()
      ) {
        return;
      }
      await this.refreshIceServersOnce();
      await this.requestLateIceRestart('peer-refresh-request');
      return;
    }

    if (signal.kind === 'description') {
      const description = signal.description;
      if (description.type !== 'offer' && description.type !== 'answer') return;
      if (description.type === 'offer') {
        if (this.options.offerer) return;
        if (!signal.generation) return;
        if (this.retiredGenerations.has(signal.generation)) return;
        if (pc.signalingState === 'closed' || pc.connectionState === 'failed') {
          this.releasePeerConnection();
          await this.createPeerConnection();
          pc = this.pc;
          if (!pc) return;
        }
        if (this.generation && this.generation !== signal.generation) {
          this.retireGeneration(this.generation);
          this.pendingCandidates = [];
        }
        this.generation = signal.generation;
        this.pendingCandidates.push(
          ...(this.earlyCandidatesByGeneration.get(signal.generation) ?? [])
        );
        this.earlyCandidatesByGeneration.clear();
        await pc.setRemoteDescription(description);
        await this.flushPendingCandidates();
        const answer = await pc.createAnswer();
        await this.setLocalDescriptionAndSignal(pc, answer);
        return;
      }
      if (!this.options.offerer || signal.generation !== this.generation)
        return;
      await pc.setRemoteDescription(description);
      await this.flushPendingCandidates();
      if (this.pendingLateIceRestart) {
        this.pendingLateIceRestart = false;
        await this.requestLateIceRestart('answer-applied');
      }
      return;
    }

    if (!signal.generation) return;
    const candidates =
      signal.kind === 'ice-candidates'
        ? Array.isArray(signal.candidates)
          ? signal.candidates
              .filter(
                (candidate): candidate is RTCIceCandidateInit =>
                  !!candidate && typeof candidate === 'object'
              )
              .slice(-MAX_PENDING_ICE_CANDIDATES)
          : []
        : signal.candidate
          ? [signal.candidate]
          : [];
    if (candidates.length === 0) return;
    if (signal.generation !== this.generation) {
      if (this.retiredGenerations.has(signal.generation)) return;
      // Direct Reticulum frames are independently delivered, so a candidate
      // may legitimately beat its offer. Buffer a bounded number by ICE
      // generation on the answerer instead of silently losing it.
      if (!this.options.offerer) {
        const queued =
          this.earlyCandidatesByGeneration.get(signal.generation) ?? [];
        const total = [...this.earlyCandidatesByGeneration.values()].reduce(
          (sum, candidates) => sum + candidates.length,
          0
        );
        const available = Math.max(0, MAX_PENDING_ICE_CANDIDATES - total);
        if (available > 0) {
          queued.push(...candidates.slice(0, available));
          this.earlyCandidatesByGeneration.set(signal.generation, queued);
          while (this.earlyCandidatesByGeneration.size > 4) {
            const oldest = this.earlyCandidatesByGeneration.keys().next().value;
            if (typeof oldest !== 'string') break;
            this.earlyCandidatesByGeneration.delete(oldest);
          }
        }
      }
      return;
    }
    for (const candidate of candidates) {
      if (!pc.remoteDescription) {
        if (this.pendingCandidates.length >= MAX_PENDING_ICE_CANDIDATES) {
          this.pendingCandidates.shift();
        }
        this.pendingCandidates.push(candidate);
        continue;
      }
      try {
        this.recordRemoteCandidate(candidate);
        await pc.addIceCandidate(candidate);
      } catch {
        // A delayed candidate from an earlier ICE restart must not prevent
        // the remaining candidates in this authenticated batch from applying.
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearDisconnectTimer();
    this.clearIceServerRefreshTimer();
    this.pendingCandidates = [];
    this.earlyCandidatesByGeneration.clear();
    this.retiredGenerations.clear();
    this.clearLocalCandidateBatch();
    this.pendingIceRefreshRequest = false;
    this.releasePeerConnection();
    this.setState('closed');
  }

  private async createPeerConnection(): Promise<void> {
    if (this.pc || this.closed) return;
    let iceServers: RTCIceServer[] = [];
    try {
      iceServers = await this.options.getIceServers();
    } catch {
      iceServers = [];
    }
    if (this.closed) return;
    this.configuredIceServerCount = iceServers.length;
    this.configuredIceServerUrls = iceServers.flatMap((server) =>
      Array.isArray(server.urls) ? server.urls : [server.urls]
    );
    this.localCandidateCounts.clear();
    this.remoteCandidateCounts.clear();
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    this.emitDiagnostic('peer-connection-created', {
      role: this.options.offerer ? 'offerer' : 'answerer',
      iceServerCount: iceServers.length,
    });
    if (iceServers.length === 0) this.scheduleIceServerRefresh();
    this.setState('connecting');
    for (const track of this.options.localStream.getAudioTracks()) {
      pc.addTrack(track, this.options.localStream);
    }
    pc.ontrack = (event) => {
      if (this.closed || event.track.kind !== 'audio') return;
      this.remoteAudioTrackSeen = true;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.options.onRemoteStream(stream);
      this.handleConnectionState();
    };
    pc.onicecandidate = (event) => {
      // End-of-candidates carries no address and costs another signed,
      // fragmented Reticulum signal, so it is intentionally omitted.
      if (!event.candidate) {
        this.emitDiagnostic('local-candidate-gathering-complete', {
          candidates: this.candidateCountSnapshot(this.localCandidateCounts),
        });
        void this.emitCandidatePairSnapshot(pc, 'gathering-complete');
        return;
      }
      this.incrementCandidateCount(
        this.localCandidateCounts,
        event.candidate.type,
        event.candidate.protocol
      );
      if (!this.generation || this.closed) return;
      const candidate = event.candidate.toJSON();
      if (this.localDescriptionSignalPending) {
        if (this.bufferedLocalCandidates.length < MAX_PENDING_ICE_CANDIDATES) {
          this.bufferedLocalCandidates.push({
            generation: this.generation,
            candidate,
          });
        }
        return;
      }
      this.queueLocalCandidate(this.generation, candidate);
    };
    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc || this.closed) return;
      this.emitDiagnostic('ice-state', {
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
      });
      if (
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed' ||
        pc.iceConnectionState === 'failed'
      ) {
        void this.emitCandidatePairSnapshot(pc, `ice-${pc.iceConnectionState}`);
      }
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc || this.closed) return;
      this.emitDiagnostic('connection-state', {
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
      });
      this.handleConnectionState();
    };
  }

  private async sendOffer(iceRestart: boolean): Promise<void> {
    const pc = this.pc;
    if (!pc || this.closed || !this.options.offerer) return;
    if (iceRestart) {
      this.retireGeneration(this.generation);
      this.generation = nextGeneration();
      this.pendingCandidates = [];
    }
    const offer = await pc.createOffer({ iceRestart });
    await this.setLocalDescriptionAndSignal(pc, offer);
  }

  private handleConnectionState(): void {
    const state = this.pc?.connectionState;
    if (state === 'connected') {
      this.restartAttempts = 0;
      this.clearDisconnectTimer();
      this.clearIceServerRefreshTimer();
      this.setState(this.remoteAudioTrackSeen ? 'open' : 'connecting');
      return;
    }
    if (state === 'failed' || state === 'disconnected') {
      this.scheduleRecovery();
    }
  }

  private scheduleRecovery(): void {
    if (this.closed || this.disconnectTimer) return;
    this.setState('recovering');
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null;
      void this.tryRestart();
    }, ICE_DISCONNECT_GRACE_MS);
  }

  private async tryRestart(): Promise<void> {
    if (this.closed || this.isOpen()) return;
    if (!this.options.offerer) {
      this.setState('connecting');
      return;
    }
    const now = Date.now();
    if (this.restartAttempts >= ICE_RESTART_MAX_ATTEMPTS) {
      const cooldownRemaining =
        ICE_RESTART_COOLDOWN_MS - (now - this.lastRestartAt);
      if (cooldownRemaining > 0) {
        this.setState('connecting');
        this.disconnectTimer = setTimeout(() => {
          this.disconnectTimer = null;
          this.restartAttempts = 0;
          void this.tryRestart();
        }, cooldownRemaining);
        return;
      }
      this.restartAttempts = 0;
    }
    const retryAfter = ICE_RESTART_MIN_INTERVAL_MS - (now - this.lastRestartAt);
    if (retryAfter > 0) {
      this.disconnectTimer = setTimeout(() => {
        this.disconnectTimer = null;
        void this.tryRestart();
      }, retryAfter);
      return;
    }
    this.restartAttempts += 1;
    this.lastRestartAt = now;
    try {
      if (!this.pc || this.pc.connectionState === 'failed') {
        this.releasePeerConnection();
        this.retireGeneration(this.generation);
        this.generation = nextGeneration();
        await this.createPeerConnection();
        if (!this.pc) return;
        await this.sendOffer(false);
      } else {
        await this.sendOffer(true);
      }
      // Sending a restart offer does not guarantee that the peer received it
      // or that ICE became connected again. A connection already in the
      // `disconnected` state may not emit another state-change event, so arm a
      // watchdog here instead of relying on one. A successful reconnect clears
      // this timer in handleConnectionState(); otherwise tryRestart() performs
      // the next bounded attempt after the minimum restart interval.
      if (!this.closed && !this.isOpen()) {
        this.scheduleRecovery();
      }
    } catch {
      // A transient createOffer/setLocalDescription failure must not leave the
      // transport permanently stuck in "connecting". Keep Reticulum active and
      // schedule another bounded WebRTC recovery attempt.
      this.scheduleRecovery();
    }
  }

  private releasePeerConnection(): void {
    const pc = this.pc;
    this.pc = null;
    this.remoteAudioTrackSeen = false;
    this.localDescriptionSignalPending = false;
    this.clearLocalCandidateBatch();
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Best effort during transport replacement/teardown.
      }
    }
  }

  private async setLocalDescriptionAndSignal(
    pc: RTCPeerConnection,
    description: RTCSessionDescriptionInit
  ): Promise<void> {
    const generation = this.generation;
    let descriptionSignaled = false;
    this.localDescriptionSignalPending = true;
    this.clearLocalCandidateBatch();
    try {
      await pc.setLocalDescription(description);
      if (
        !pc.localDescription ||
        this.closed ||
        this.pc !== pc ||
        this.generation !== generation
      ) {
        return;
      }
      // SDP must enter the reliable signaling channel before the candidates
      // it describes. Some browsers emit candidates synchronously while
      // setLocalDescription() is pending.
      this.options.onSignal({
        kind: 'description',
        generation,
        description: pc.localDescription.toJSON(),
      });
      descriptionSignaled = true;
      this.emitDiagnostic('local-description-signaled', {
        type: description.type,
        gatheringState: pc.iceGatheringState,
        bufferedCandidateCount: this.bufferedLocalCandidates.length,
      });
      if (description.type === 'answer' && this.pendingIceRefreshRequest) {
        this.pendingIceRefreshRequest = false;
        this.sendIceRefreshRequest();
      }
    } finally {
      this.localDescriptionSignalPending = false;
      // Never infer candidate delivery from onicecandidate firing. Flush every
      // gathered candidate after the SDP has entered the ordered signaling
      // path. WebRTC accepts harmless SDP/trickle overlap, while preserving
      // every candidate avoids losing a route that was not in the SDP sent.
      if (descriptionSignaled) this.flushLocalCandidateBatch();
      else this.clearLocalCandidateBatch();
    }
  }

  private queueLocalCandidate(
    generation: string,
    candidate: RTCIceCandidateInit
  ): void {
    if (this.closed || generation !== this.generation) return;
    if (this.bufferedLocalCandidates.length >= MAX_PENDING_ICE_CANDIDATES) {
      this.bufferedLocalCandidates.shift();
    }
    this.bufferedLocalCandidates.push({ generation, candidate });
    if (this.localDescriptionSignalPending || this.localCandidateBatchTimer) {
      return;
    }
    this.localCandidateBatchTimer = setTimeout(() => {
      this.localCandidateBatchTimer = null;
      this.flushLocalCandidateBatch();
    }, LOCAL_ICE_CANDIDATE_BATCH_MS);
  }

  private flushLocalCandidateBatch(): void {
    if (this.localCandidateBatchTimer) {
      clearTimeout(this.localCandidateBatchTimer);
      this.localCandidateBatchTimer = null;
    }
    if (this.closed || this.bufferedLocalCandidates.length === 0) return;
    const generation = this.generation;
    const candidates = this.bufferedLocalCandidates
      .splice(0)
      .filter((entry) => entry.generation === generation)
      .map((entry) => entry.candidate);
    if (candidates.length === 0) return;
    this.options.onSignal({ kind: 'ice-candidates', generation, candidates });
  }

  private scheduleIceServerRefresh(): void {
    if (
      this.closed ||
      this.isOpen() ||
      this.configuredIceServerCount > 0 ||
      this.iceServerRefreshTimer ||
      this.iceServerRefreshInFlight
    ) {
      return;
    }
    if (this.iceServerRefreshDeadline === 0) {
      this.iceServerRefreshDeadline = Date.now() + ICE_SERVER_REFRESH_WINDOW_MS;
    }
    if (Date.now() >= this.iceServerRefreshDeadline) {
      this.emitDiagnostic('ice-server-refresh-expired', {});
      return;
    }
    this.iceServerRefreshTimer = setTimeout(() => {
      this.iceServerRefreshTimer = null;
      void this.refreshIceServersOnce();
    }, ICE_SERVER_REFRESH_INTERVAL_MS);
  }

  private async refreshIceServersOnce(): Promise<boolean> {
    if (
      this.closed ||
      this.isOpen() ||
      this.configuredIceServerCount > 0 ||
      this.iceServerRefreshInFlight
    ) {
      return this.configuredIceServerCount > 0;
    }
    this.iceServerRefreshInFlight = true;
    let iceServers: RTCIceServer[] = [];
    try {
      iceServers = await this.options.getIceServers();
    } catch {
      iceServers = [];
    } finally {
      this.iceServerRefreshInFlight = false;
    }
    if (this.closed || this.isOpen()) return false;
    if (iceServers.length === 0) {
      this.scheduleIceServerRefresh();
      return false;
    }
    const pc = this.pc;
    if (!pc) return false;
    try {
      pc.setConfiguration({ ...pc.getConfiguration(), iceServers });
    } catch (error) {
      this.emitDiagnostic('ice-server-refresh-apply-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.scheduleIceServerRefresh();
      return false;
    }
    this.configuredIceServerCount = iceServers.length;
    this.configuredIceServerUrls = iceServers.flatMap((server) =>
      Array.isArray(server.urls) ? server.urls : [server.urls]
    );
    this.clearIceServerRefreshTimer();
    this.emitDiagnostic('ice-servers-refreshed', {
      role: this.options.offerer ? 'offerer' : 'answerer',
      iceServerCount: iceServers.length,
    });

    if (this.options.offerer) {
      try {
        await this.requestLateIceRestart('late-ice-servers');
      } catch (error) {
        // A failed proactive restart must not surface as an unhandled timer
        // rejection. Reticulum remains active and the normal ICE failure
        // watchdog can still perform its bounded recovery attempts.
        this.emitDiagnostic('ice-restart-request-failed', {
          reason: 'late-ice-servers',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (this.generation) {
      if (this.localDescriptionSignalPending) {
        this.pendingIceRefreshRequest = true;
      } else if (pc.localDescription) {
        this.sendIceRefreshRequest();
      }
    }
    return true;
  }

  private async requestLateIceRestart(reason: string): Promise<void> {
    const pc = this.pc;
    if (
      !pc ||
      this.closed ||
      !this.options.offerer ||
      this.isOpen() ||
      this.lateIceRestartIssued
    ) {
      return;
    }
    if (pc.signalingState && pc.signalingState !== 'stable') {
      this.pendingLateIceRestart = true;
      return;
    }
    this.lateIceRestartIssued = true;
    this.pendingLateIceRestart = false;
    this.emitDiagnostic('ice-restart-requested', { reason });
    try {
      await this.sendOffer(true);
    } catch (error) {
      // Do not consume the one proactive restart when negotiation itself
      // failed. The normal bounded recovery path retries without spinning.
      this.lateIceRestartIssued = false;
      this.scheduleRecovery();
      throw error;
    }
  }

  private sendIceRefreshRequest(): void {
    if (
      this.closed ||
      this.options.offerer ||
      this.iceRefreshRequestSent ||
      !this.generation
    ) {
      return;
    }
    this.iceRefreshRequestSent = true;
    this.emitDiagnostic('ice-refresh-request-sent', {});
    this.options.onSignal({
      kind: 'ice-refresh-request',
      generation: this.generation,
    });
  }

  private clearIceServerRefreshTimer(): void {
    if (this.iceServerRefreshTimer) {
      clearTimeout(this.iceServerRefreshTimer);
      this.iceServerRefreshTimer = null;
    }
    this.iceServerRefreshDeadline = 0;
  }

  private async flushPendingCandidates(): Promise<void> {
    const pc = this.pc;
    if (!pc || !pc.remoteDescription) return;
    const pending = this.pendingCandidates.splice(0);
    for (const candidate of pending) {
      try {
        this.recordRemoteCandidate(candidate);
        await pc.addIceCandidate(candidate);
      } catch {
        // A stale candidate must not abort the rest of negotiation.
      }
    }
  }

  private clearLocalCandidateBatch(): void {
    if (this.localCandidateBatchTimer) {
      clearTimeout(this.localCandidateBatchTimer);
      this.localCandidateBatchTimer = null;
    }
    this.bufferedLocalCandidates = [];
  }

  private enqueueOperation(operation: () => Promise<void>): Promise<void> {
    const next = this.operationChain.then(async () => {
      if (this.closed) return;
      await operation();
    });
    this.operationChain = next.catch(() => {});
    return next;
  }

  private retireGeneration(generation: string): void {
    if (!generation) return;
    this.retiredGenerations.delete(generation);
    this.retiredGenerations.add(generation);
    while (this.retiredGenerations.size > 16) {
      const oldest = this.retiredGenerations.values().next().value;
      if (typeof oldest !== 'string') break;
      this.retiredGenerations.delete(oldest);
    }
  }

  private recordRemoteCandidate(candidate: RTCIceCandidateInit): void {
    const line = String(candidate.candidate || '');
    const type = /\btyp\s+([a-z0-9-]+)/i.exec(line)?.[1] ?? 'unknown';
    const protocol = /^candidate:\S+\s+\d+\s+([a-z0-9-]+)/i.exec(line)?.[1];
    this.incrementCandidateCount(this.remoteCandidateCounts, type, protocol);
  }

  private incrementCandidateCount(
    target: Map<string, number>,
    type?: string | null,
    protocol?: string | null
  ): void {
    const key = `${String(type || 'unknown').toLowerCase()}/${String(
      protocol || 'unknown'
    ).toLowerCase()}`;
    target.set(key, (target.get(key) ?? 0) + 1);
  }

  private candidateCountSnapshot(
    source: Map<string, number>
  ): Record<string, number> {
    return Object.fromEntries(
      [...source.entries()].sort(([a], [b]) => a.localeCompare(b))
    );
  }

  private async emitCandidatePairSnapshot(
    pc: RTCPeerConnection,
    reason: string
  ): Promise<void> {
    if (typeof pc.getStats !== 'function') return;
    try {
      const report = await pc.getStats();
      if (this.pc !== pc || this.closed) return;
      const entries = new Map<string, Record<string, unknown>>();
      let selectedPair: Record<string, unknown> | null = null;
      let nominatedPair: Record<string, unknown> | null = null;
      report.forEach((raw) => {
        const stat = raw as unknown as Record<string, unknown>;
        const id = typeof stat.id === 'string' ? stat.id : '';
        if (id) entries.set(id, stat);
        if (
          stat.type === 'candidate-pair' &&
          stat.state === 'succeeded' &&
          (stat.nominated === true || stat.selected === true)
        ) {
          nominatedPair = stat;
        }
      });
      for (const stat of entries.values()) {
        if (stat.type !== 'transport') continue;
        const pairId = stat.selectedCandidatePairId;
        if (typeof pairId === 'string') {
          selectedPair = entries.get(pairId) ?? null;
          if (selectedPair) break;
        }
      }
      selectedPair ??= nominatedPair;
      const summarizeCandidate = (
        id: unknown
      ): Record<string, unknown> | null => {
        if (typeof id !== 'string') return null;
        const stat = entries.get(id);
        if (!stat) return null;
        const sourceServerIndex =
          typeof stat.url === 'string'
            ? this.configuredIceServerUrls.indexOf(stat.url)
            : -1;
        return {
          candidateType: stat.candidateType ?? 'unknown',
          protocol: stat.protocol ?? 'unknown',
          relayProtocol: stat.relayProtocol ?? null,
          networkType: stat.networkType ?? null,
          sourceServerIndex: sourceServerIndex >= 0 ? sourceServerIndex : null,
        };
      };
      this.emitDiagnostic('candidate-pair', {
        reason,
        iceServerCount: this.configuredIceServerCount,
        localCandidates: this.candidateCountSnapshot(this.localCandidateCounts),
        remoteCandidates: this.candidateCountSnapshot(
          this.remoteCandidateCounts
        ),
        selected: selectedPair
          ? {
              local: summarizeCandidate(selectedPair.localCandidateId),
              remote: summarizeCandidate(selectedPair.remoteCandidateId),
            }
          : null,
      });
    } catch (error) {
      this.emitDiagnostic('candidate-pair-stats-failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private emitDiagnostic(stage: string, detail: Record<string, unknown>): void {
    this.options.onDiagnostic?.(stage, detail);
  }

  private clearDisconnectTimer(): void {
    if (!this.disconnectTimer) return;
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  private setState(state: DirectVoiceRtcState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onState?.(state);
  }
}

export type GroupCallRtcSignal =
  | { type: 'capability'; version: 1 }
  | { type: 'reconnect'; generation?: string }
  | {
      type: 'offer' | 'answer';
      generation?: string;
      description: RTCSessionDescriptionInit;
    }
  | {
      type: 'candidate';
      generation?: string;
      candidate: RTCIceCandidateInit | null;
    }
  | {
      type: 'candidates';
      generation?: string;
      candidates: RTCIceCandidateInit[];
    };

export interface GroupCallWebRtcDataChannelTransportOptions {
  peerAddress: string;
  offerer: boolean;
  iceServers: RTCIceServer[];
  onSignal: (signal: GroupCallRtcSignal) => void | Promise<void>;
  onPacket: (packet: ArrayBuffer) => void;
  onState: (state: RTCPeerConnectionState | 'open' | 'closed') => void;
}

const DISCONNECT_GRACE_MS = 8_000;
const NEGOTIATION_RETRY_MS = 6_000;
const MAX_PENDING_ICE_CANDIDATES = 128;
const LOCAL_ICE_CANDIDATE_BATCH_MS = 75;

function nextRtcGeneration(): string {
  return crypto.randomUUID();
}

/** One encrypted-packet DataChannel connection for one topology edge. */
export class GroupCallWebRtcDataChannelTransport {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private pendingLocalCandidates: Array<{
    generation: string;
    candidate: RTCIceCandidateInit;
  }> = [];
  private earlyCandidatesByGeneration = new Map<
    string,
    RTCIceCandidateInit[]
  >();
  private localCandidateTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private closed = false;
  private lastOfferAt = 0;
  private operationChain: Promise<void> = Promise.resolve();
  private signalChain: Promise<void> = Promise.resolve();
  private localDescriptionSignalPending = false;
  private signaledLocalDescriptionGeneration = '';
  private generation = '';
  private retiredGenerations = new Set<string>();
  private iceServers: RTCIceServer[];

  constructor(
    private readonly options: GroupCallWebRtcDataChannelTransportOptions
  ) {
    this.iceServers = options.iceServers.map((server) => ({ ...server }));
  }

  async start(negotiate = false): Promise<void> {
    return this.enqueueOperation(() => this.startInternal(negotiate));
  }

  async enableNegotiation(): Promise<void> {
    return this.enqueueOperation(() => this.enableNegotiationInternal());
  }

  async handleSignal(signal: GroupCallRtcSignal): Promise<void> {
    return this.enqueueOperation(() => this.handleSignalInternal(signal));
  }

  async restartIce(): Promise<void> {
    return this.enqueueOperation(() => this.restartIceInternal());
  }

  async requestRecovery(): Promise<void> {
    return this.enqueueOperation(async () => {
      if (this.options.offerer) await this.restartIceInternal();
      else
        await this.sendSignal({
          type: 'reconnect',
          generation: this.generation || undefined,
        });
    });
  }

  async updateIceServers(iceServers: RTCIceServer[]): Promise<void> {
    return this.enqueueOperation(async () => {
      const next = iceServers.map((server) => ({ ...server }));
      const currentKey = JSON.stringify(this.iceServers);
      const nextKey = JSON.stringify(next);
      if (currentKey === nextKey) return;
      this.iceServers = next;
      const pc = this.pc;
      if (!pc || this.isOpen()) return;
      try {
        pc.setConfiguration({ ...pc.getConfiguration(), iceServers: next });
      } catch {
        this.replacePeerConnectionForRemoteRestart();
      }
      if (this.options.offerer) {
        if (this.pc === pc && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setLocalDescription({ type: 'rollback' });
          } catch {
            this.replacePeerConnectionForRemoteRestart();
          }
        }
        await this.createAndSendOffer(this.pc === pc);
      } else
        await this.sendSignal({
          type: 'reconnect',
          generation: this.generation || undefined,
        });
    });
  }

  private async startInternal(negotiate = false): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.createPeerConnection();
    if (negotiate && this.options.offerer) await this.createAndSendOffer(false);
  }

  private async enableNegotiationInternal(): Promise<void> {
    if (!this.started) await this.startInternal(false);
    if (this.options.offerer && this.pc) {
      if (
        this.pc.signalingState === 'have-local-offer' &&
        Date.now() - this.lastOfferAt >= NEGOTIATION_RETRY_MS
      ) {
        await this.resendPendingOffer();
        return;
      }
      if (this.pc.signalingState !== 'stable') return;
      if (!this.pc.localDescription) {
        await this.createAndSendOffer(false);
      }
    }
  }

  isOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  send(packet: Uint8Array): boolean {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') return false;
    if (channel.bufferedAmount > 256 * 1024) return false;
    try {
      channel.send(packet as Uint8Array<ArrayBuffer>);
      return true;
    } catch {
      return false;
    }
  }

  private async handleSignalInternal(
    signal: GroupCallRtcSignal
  ): Promise<void> {
    if (!this.started) await this.startInternal(false);
    if (signal.type === 'capability') return;
    if (signal.type === 'reconnect') {
      if (
        signal.generation &&
        this.generation &&
        signal.generation !== this.generation
      ) {
        return;
      }
      await this.restartIceInternal();
      return;
    }
    const pc = this.pc ?? this.createPeerConnection();
    if (signal.type === 'offer') {
      const incomingGeneration = signal.generation || 'legacy';
      if (this.options.offerer) return;
      if (this.retiredGenerations.has(incomingGeneration)) return;
      if (this.generation && this.generation !== incomingGeneration) {
        this.retireGeneration(this.generation);
        this.pendingCandidates = [];
        this.signaledLocalDescriptionGeneration = '';
      }
      this.generation = incomingGeneration;
      this.pendingCandidates.push(
        ...(this.earlyCandidatesByGeneration.get(incomingGeneration) ?? [])
      );
      this.earlyCandidatesByGeneration.clear();
      let answerPc = pc;
      try {
        await answerPc.setRemoteDescription(signal.description);
      } catch (error) {
        if (!this.isIncompatibleReplacementOffer(error, answerPc)) throw error;
        answerPc = this.replacePeerConnectionForRemoteRestart(true);
        await answerPc.setRemoteDescription(signal.description);
      }
      await this.flushCandidates();
      const answer = await answerPc.createAnswer();
      await this.setLocalDescriptionAndSignal(answerPc, answer, 'answer');
      return;
    }
    if (signal.type === 'answer') {
      if (
        !this.options.offerer ||
        (signal.generation && signal.generation !== this.generation)
      ) {
        return;
      }
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(signal.description);
        await this.flushCandidates();
      }
      return;
    }
    if (signal.type !== 'candidate' && signal.type !== 'candidates') return;
    const candidates =
      signal.type === 'candidates'
        ? Array.isArray(signal.candidates)
          ? signal.candidates
              .filter(
                (candidate): candidate is RTCIceCandidateInit =>
                  !!candidate && typeof candidate === 'object'
              )
              .slice(-MAX_PENDING_ICE_CANDIDATES)
          : []
        : signal.candidate === null ||
            !signal.candidate ||
            typeof signal.candidate !== 'object'
          ? []
          : [signal.candidate];
    if (candidates.length === 0) return;
    const candidateGeneration = signal.generation || this.generation;
    if (!candidateGeneration) return;
    if (candidateGeneration !== this.generation) {
      if (this.retiredGenerations.has(candidateGeneration)) return;
      if (!this.options.offerer) {
        const queued =
          this.earlyCandidatesByGeneration.get(candidateGeneration) ?? [];
        const total = [...this.earlyCandidatesByGeneration.values()].reduce(
          (sum, entries) => sum + entries.length,
          0
        );
        const available = Math.max(0, MAX_PENDING_ICE_CANDIDATES - total);
        if (available > 0) {
          queued.push(...candidates.slice(0, available));
          this.earlyCandidatesByGeneration.set(candidateGeneration, queued);
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
      } else {
        await this.addIceCandidateSafely(pc, candidate);
      }
    }
  }

  private async restartIceInternal(): Promise<void> {
    if (
      !this.options.offerer ||
      !this.pc ||
      this.pc.signalingState !== 'stable'
    )
      return;
    await this.createAndSendOffer(true);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.started = false;
    this.clearDisconnectTimer();
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onmessage = null;
      try {
        channel.close();
      } catch {
        // Already closed by Chromium.
      }
    }
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.onicecandidate = null;
      pc.ondatachannel = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Already closed by Chromium.
      }
    }
    this.pendingCandidates = [];
    this.earlyCandidatesByGeneration.clear();
    this.retiredGenerations.clear();
    this.clearLocalCandidateBatch();
    this.options.onState('closed');
  }

  private createPeerConnection(): RTCPeerConnection {
    if (this.closed) throw new Error('WebRTC group transport is closed');
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    pc.onicecandidate = (event) => {
      const candidate = event.candidate?.toJSON();
      if (candidate) {
        this.queueLocalCandidate(this.generation, candidate);
      } else {
        this.flushLocalCandidateBatch();
      }
    };
    pc.ondatachannel = (event) => this.attachChannel(event.channel);
    pc.onconnectionstatechange = () => {
      this.options.onState(pc.connectionState);
      if (pc.connectionState === 'connected') {
        this.clearDisconnectTimer();
      } else if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'disconnected'
      ) {
        this.clearDisconnectTimer();
        this.disconnectTimer = setTimeout(
          () => {
            this.disconnectTimer = null;
            void this.requestRecovery();
          },
          pc.connectionState === 'failed' ? 0 : DISCONNECT_GRACE_MS
        );
      }
    };
    if (this.options.offerer) {
      this.attachChannel(
        pc.createDataChannel('qortal-group-audio', {
          ordered: false,
          maxRetransmits: 1,
        })
      );
    }
    return pc;
  }

  private attachChannel(channel: RTCDataChannel): void {
    if (this.channel && this.channel !== channel) {
      try {
        this.channel.close();
      } catch {
        // Already closed by Chromium.
      }
    }
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 64 * 1024;
    channel.onopen = () => this.options.onState('open');
    channel.onclose = () => this.options.onState('closed');
    channel.onerror = () => {
      // A DataChannel error is commonly followed by a useful connection-state
      // transition. Do not tear down an otherwise connected peer here; send()
      // will fall back until Chromium either recovers or closes the channel.
      this.options.onState(this.pc?.connectionState ?? 'disconnected');
    };
    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.options.onPacket(event.data);
      } else if (event.data instanceof Blob) {
        void event.data
          .arrayBuffer()
          .then(this.options.onPacket)
          .catch(() => {
            // A closing channel can invalidate an in-flight Blob conversion.
          });
      }
    };
  }

  private async createAndSendOffer(iceRestart: boolean): Promise<void> {
    const pc = this.pc ?? this.createPeerConnection();
    this.retireGeneration(this.generation);
    this.generation = nextRtcGeneration();
    this.signaledLocalDescriptionGeneration = '';
    this.pendingCandidates = [];
    this.clearLocalCandidateBatch();
    const offer = await pc.createOffer({ iceRestart });
    if (this.closed || this.pc !== pc) return;
    await this.setLocalDescriptionAndSignal(pc, offer, 'offer');
  }

  private async setLocalDescriptionAndSignal(
    pc: RTCPeerConnection,
    description: RTCSessionDescriptionInit,
    type: 'offer' | 'answer'
  ): Promise<void> {
    const generation = this.generation;
    let descriptionSignaled = false;
    this.localDescriptionSignalPending = true;
    try {
      await pc.setLocalDescription(description);
      if (this.closed || this.pc !== pc || this.generation !== generation) {
        return;
      }
      if (type === 'offer') this.lastOfferAt = Date.now();
      await this.sendSignal({
        type,
        generation,
        description: pc.localDescription ?? description,
      });
      this.signaledLocalDescriptionGeneration = generation;
      descriptionSignaled = true;
    } finally {
      this.localDescriptionSignalPending = false;
      if (descriptionSignaled) this.flushLocalCandidateBatch();
      else this.clearLocalCandidateBatch();
    }
  }

  private async resendPendingOffer(): Promise<void> {
    const pc = this.pc;
    const description = pc?.localDescription;
    if (
      !pc ||
      pc.signalingState !== 'have-local-offer' ||
      description?.type !== 'offer'
    ) {
      return;
    }
    this.lastOfferAt = Date.now();
    await this.sendSignal({
      type: 'offer',
      generation: this.generation || undefined,
      description,
    });
    this.signaledLocalDescriptionGeneration = this.generation;
  }

  private isIncompatibleReplacementOffer(
    error: unknown,
    pc: RTCPeerConnection
  ): boolean {
    if (!pc.remoteDescription) return false;
    const detail = error instanceof Error ? error.message : String(error);
    return detail.includes('order of m-lines in subsequent offer');
  }

  /**
   * A peer can recreate its RTCPeerConnection after an ICE failure while its
   * account, call session, and topology edge remain unchanged. Chromium will
   * reject that new connection's SDP when its media layout differs from the
   * previous connection. Replace only the local WebRTC edge and keep the
   * Reticulum call/session alive so negotiation can recover in place.
   */
  private replacePeerConnectionForRemoteRestart(
    preservePendingCandidates = false
  ): RTCPeerConnection {
    this.clearDisconnectTimer();
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onmessage = null;
      try {
        channel.close();
      } catch {
        // Already closed by Chromium.
      }
    }
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.onicecandidate = null;
      pc.ondatachannel = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Already closed by Chromium.
      }
    }
    if (!preservePendingCandidates) {
      this.pendingCandidates = [];
      this.earlyCandidatesByGeneration.clear();
    }
    this.clearLocalCandidateBatch();
    this.signaledLocalDescriptionGeneration = '';
    this.options.onState('connecting');
    return this.createPeerConnection();
  }

  private queueLocalCandidate(
    generation: string,
    candidate: RTCIceCandidateInit
  ): void {
    if (this.closed || !generation) return;
    if (
      !this.localDescriptionSignalPending &&
      generation !== this.signaledLocalDescriptionGeneration
    ) {
      return;
    }
    if (this.pendingLocalCandidates.length >= MAX_PENDING_ICE_CANDIDATES) {
      this.pendingLocalCandidates.shift();
    }
    this.pendingLocalCandidates.push({ generation, candidate });
    if (this.localCandidateTimer) return;
    this.localCandidateTimer = setTimeout(() => {
      this.localCandidateTimer = null;
      this.flushLocalCandidateBatch();
    }, LOCAL_ICE_CANDIDATE_BATCH_MS);
  }

  private flushLocalCandidateBatch(): void {
    if (this.localDescriptionSignalPending) return;
    if (this.closed || this.pendingLocalCandidates.length === 0) return;
    if (this.localCandidateTimer) {
      clearTimeout(this.localCandidateTimer);
      this.localCandidateTimer = null;
    }
    const entries = this.pendingLocalCandidates.splice(0);
    const byGeneration = new Map<string, RTCIceCandidateInit[]>();
    for (const entry of entries) {
      const candidates = byGeneration.get(entry.generation) ?? [];
      candidates.push(entry.candidate);
      byGeneration.set(entry.generation, candidates);
    }
    for (const [generation, candidates] of byGeneration) {
      if (generation !== this.generation) continue;
      void this.sendSignal({ type: 'candidates', generation, candidates });
    }
  }

  private clearLocalCandidateBatch(): void {
    if (this.localCandidateTimer) {
      clearTimeout(this.localCandidateTimer);
      this.localCandidateTimer = null;
    }
    this.pendingLocalCandidates = [];
  }

  private async flushCandidates(): Promise<void> {
    const pc = this.pc;
    if (!pc?.remoteDescription) return;
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      await this.addIceCandidateSafely(pc, candidate);
    }
  }

  private async addIceCandidateSafely(
    pc: RTCPeerConnection,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // A stale candidate must not abort the rest of a valid batch.
    }
  }

  private sendSignal(signal: GroupCallRtcSignal): Promise<void> {
    const next = this.signalChain.then(async () => {
      if (this.closed) return;
      if (
        'generation' in signal &&
        signal.generation &&
        signal.generation !== this.generation
      ) {
        return;
      }
      await this.options.onSignal(signal);
    });
    this.signalChain = next.catch(() => {});
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

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  /**
   * SDP and ICE state transitions must be serialized. Reticulum verifies each
   * signal asynchronously, so candidates, retries, and topology maintenance
   * can otherwise enter RTCPeerConnection concurrently.
   */
  private enqueueOperation(operation: () => Promise<void>): Promise<void> {
    const next = this.operationChain.then(async () => {
      if (this.closed) return;
      await operation();
    });
    this.operationChain = next.catch(() => {});
    return next;
  }
}

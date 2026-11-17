export type DirectScreenShareRtcSignal =
  | {
      kind: 'screen-description';
      generation: string;
      description: RTCSessionDescriptionInit;
    }
  | {
      kind: 'screen-ice';
      generation: string;
      candidate: RTCIceCandidateInit;
    }
  | {
      kind: 'screen-stop';
      generation: string;
    };

export type DirectScreenShareRtcState =
  | 'connecting'
  | 'open'
  | 'failed'
  | 'closed';

type DirectScreenShareWebRtcTransportOptions = {
  generation: string;
  sender: boolean;
  localStream?: MediaStream;
  getIceServers: () => Promise<RTCIceServer[]>;
  onSignal: (
    signal: DirectScreenShareRtcSignal
  ) => boolean | void | Promise<boolean | void>;
  onRemoteStream: (stream: MediaStream) => void;
  onState: (state: DirectScreenShareRtcState) => void;
};

const SCREEN_DISCONNECT_GRACE_MS = 3_000;
const SCREEN_NEGOTIATION_TIMEOUT_MS = 20_000;
const SCREEN_ICE_SERVER_LOOKUP_TIMEOUT_MS = 3_000;
const SCREEN_ICE_RESTART_DELAY_MS = 1_500;
const SCREEN_ICE_RESTART_TIMEOUT_MS = 12_000;
const SCREEN_ICE_RESTART_MAX_ATTEMPTS = 2;
const MAX_PENDING_CANDIDATES = 128;

/**
 * An isolated video-only WebRTC edge for one active DM screen share.
 *
 * Voice remains on its existing native-audio/Reticulum transport. Keeping a
 * separate peer connection means screen capture, SDP negotiation, or video
 * failure can never renegotiate or tear down an otherwise healthy call.
 */
export class DirectScreenShareWebRtcTransport {
  private pc: RTCPeerConnection | null = null;
  private pcCreationPromise: Promise<RTCPeerConnection> | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private negotiationTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private remoteVideoTrackSeen = false;
  private closed = false;

  constructor(
    private readonly options: DirectScreenShareWebRtcTransportOptions
  ) {}

  getGeneration(): string {
    return this.options.generation;
  }

  isSender(): boolean {
    return this.options.sender;
  }

  async startSender(): Promise<void> {
    if (!this.options.sender || this.closed || this.pc) return;
    const stream = this.options.localStream;
    const videoTrack = stream?.getVideoTracks()[0];
    if (!stream || !videoTrack) {
      throw new Error('screen-share-video-track-missing');
    }
    const pc = await this.createPeerConnection();
    pc.addTrack(videoTrack, stream);
    const offer = await pc.createOffer();
    if (this.closed || this.pc !== pc) return;
    await pc.setLocalDescription(offer);
    if (!pc.localDescription || this.closed || this.pc !== pc) return;
    const sent = await this.options.onSignal({
      kind: 'screen-description',
      generation: this.options.generation,
      description: pc.localDescription.toJSON(),
    });
    if (sent === false) throw new Error('screen-share-offer-send-failed');
  }

  async handleSignal(signal: DirectScreenShareRtcSignal): Promise<void> {
    if (this.closed || signal.generation !== this.options.generation) return;
    if (signal.kind === 'screen-stop') {
      this.close();
      return;
    }
    const pc = this.pc ?? (await this.createPeerConnection());
    if (signal.kind === 'screen-description') {
      if (signal.description.type === 'offer') {
        if (this.options.sender) return;
        this.clearDisconnectTimer();
        this.clearNegotiationTimer();
        await pc.setRemoteDescription(signal.description);
        await this.flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (!pc.localDescription || this.closed || this.pc !== pc) return;
        const sent = await this.options.onSignal({
          kind: 'screen-description',
          generation: this.options.generation,
          description: pc.localDescription.toJSON(),
        });
        if (sent === false && !this.closed) {
          throw new Error('screen-share-answer-send-failed');
        }
        this.armNegotiationTimer(SCREEN_ICE_RESTART_TIMEOUT_MS);
        return;
      }
      if (
        signal.description.type === 'answer' &&
        this.options.sender &&
        pc.signalingState === 'have-local-offer'
      ) {
        await pc.setRemoteDescription(signal.description);
        await this.flushCandidates();
      }
      return;
    }
    if (!pc.remoteDescription) {
      if (this.pendingCandidates.length >= MAX_PENDING_CANDIDATES) {
        this.pendingCandidates.shift();
      }
      this.pendingCandidates.push(signal.candidate);
      return;
    }
    await this.addIceCandidateSafely(pc, signal.candidate);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearDisconnectTimer();
    this.clearNegotiationTimer();
    this.clearRestartTimer();
    this.pendingCandidates = [];
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Best effort during call teardown.
      }
    }
    this.options.onState('closed');
  }

  private async createPeerConnection(): Promise<RTCPeerConnection> {
    if (this.pc) return this.pc;
    if (this.pcCreationPromise) return this.pcCreationPromise;
    if (this.closed) throw new Error('screen-share-transport-closed');

    const creation = this.initializePeerConnection();
    this.pcCreationPromise = creation;
    try {
      return await creation;
    } finally {
      if (this.pcCreationPromise === creation) {
        this.pcCreationPromise = null;
      }
    }
  }

  private async initializePeerConnection(): Promise<RTCPeerConnection> {
    const iceServers = await this.lookupIceServers();
    if (this.closed) throw new Error('screen-share-transport-closed');
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    this.options.onState('connecting');
    this.armNegotiationTimer(SCREEN_NEGOTIATION_TIMEOUT_MS);
    pc.onicecandidate = (event) => {
      if (!event.candidate || this.closed) return;
      void Promise.resolve(
        this.options.onSignal({
          kind: 'screen-ice',
          generation: this.options.generation,
          candidate: event.candidate.toJSON(),
        })
      ).catch(() => {
        // A later candidate or the negotiated route may still succeed.
      });
    };
    pc.ontrack = (event) => {
      if (this.closed || event.track.kind !== 'video') return;
      this.remoteVideoTrackSeen = true;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.options.onRemoteStream(stream);
      this.handleConnectionState();
    };
    pc.onconnectionstatechange = () => this.handleConnectionState();
    return pc;
  }

  private handleConnectionState(): void {
    const state = this.pc?.connectionState;
    if (state === 'connected') {
      this.restartAttempts = 0;
      this.clearDisconnectTimer();
      this.clearNegotiationTimer();
      this.clearRestartTimer();
      if (this.options.sender || this.remoteVideoTrackSeen) {
        this.options.onState('open');
      }
      return;
    }
    if (state !== 'failed' && state !== 'disconnected') return;
    this.scheduleRecovery(
      state === 'failed' ? SCREEN_ICE_RESTART_DELAY_MS : SCREEN_DISCONNECT_GRACE_MS
    );
  }

  private async flushCandidates(): Promise<void> {
    const pc = this.pc;
    if (!pc?.remoteDescription) return;
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      await this.addIceCandidateSafely(pc, candidate);
    }
  }

  private scheduleRecovery(delayMs: number): void {
    if (this.closed || this.restartTimer || this.disconnectTimer) return;
    const timer = setTimeout(() => {
      if (this.restartTimer === timer) this.restartTimer = null;
      if (this.disconnectTimer === timer) this.disconnectTimer = null;
      if (this.closed || this.pc?.connectionState === 'connected') return;
      if (!this.options.sender) {
        // The sender owns ICE restarts. Keep the receiver alive long enough to
        // accept its replacement offer instead of racing it with teardown.
        this.armReceiverRecoveryDeadline();
        return;
      }
      void this.restartSenderIce();
    }, delayMs);
    if (delayMs === SCREEN_DISCONNECT_GRACE_MS) {
      this.disconnectTimer = timer;
    } else {
      this.restartTimer = timer;
    }
  }

  private armReceiverRecoveryDeadline(): void {
    if (this.closed || this.disconnectTimer) return;
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null;
      if (this.closed || this.pc?.connectionState === 'connected') return;
      this.options.onState('failed');
    }, SCREEN_ICE_RESTART_TIMEOUT_MS);
  }

  private async restartSenderIce(): Promise<void> {
    const pc = this.pc;
    if (this.closed || !this.options.sender || !pc) return;
    if (pc.connectionState === 'connected') return;
    if (this.restartAttempts >= SCREEN_ICE_RESTART_MAX_ATTEMPTS) {
      this.options.onState('failed');
      return;
    }
    this.restartAttempts += 1;
    this.options.onState('connecting');
    try {
      const iceServers = await this.lookupIceServers();
      if (this.closed || this.pc !== pc) return;
      try {
        pc.setConfiguration({ iceServers });
      } catch {
        // An ICE restart can still succeed with the existing configuration.
      }
      const offer = await pc.createOffer({ iceRestart: true });
      if (this.closed || this.pc !== pc) return;
      await pc.setLocalDescription(offer);
      if (!pc.localDescription || this.closed || this.pc !== pc) return;
      const sent = await this.options.onSignal({
        kind: 'screen-description',
        generation: this.options.generation,
        description: pc.localDescription.toJSON(),
      });
      if (sent === false) throw new Error('screen-share-restart-send-failed');
      this.armNegotiationTimer(SCREEN_ICE_RESTART_TIMEOUT_MS);
    } catch {
      if (this.closed || this.pc !== pc) return;
      this.scheduleRecovery(SCREEN_ICE_RESTART_DELAY_MS);
    }
  }

  private armNegotiationTimer(timeoutMs: number): void {
    this.clearNegotiationTimer();
    this.negotiationTimer = setTimeout(() => {
      this.negotiationTimer = null;
      if (this.closed || this.pc?.connectionState === 'connected') return;
      if (this.options.sender) {
        this.scheduleRecovery(SCREEN_ICE_RESTART_DELAY_MS);
      } else {
        this.armReceiverRecoveryDeadline();
      }
    }, timeoutMs);
  }

  private async lookupIceServers(): Promise<RTCIceServer[]> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        this.options.getIceServers(),
        new Promise<RTCIceServer[]>((resolve) => {
          timer = setTimeout(
            () => resolve([]),
            SCREEN_ICE_SERVER_LOOKUP_TIMEOUT_MS
          );
        }),
      ]);
    } catch {
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async addIceCandidateSafely(
    pc: RTCPeerConnection,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // Candidates can arrive after an ICE restart and carry the previous
      // username fragment. They are unusable, but must not end the share.
    }
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private clearNegotiationTimer(): void {
    if (this.negotiationTimer) clearTimeout(this.negotiationTimer);
    this.negotiationTimer = null;
  }
}

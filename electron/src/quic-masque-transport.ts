import {
  PrivateChannelError,
  type PrivateTransport,
  type PrivateTransportContext,
  type PrivateTransportEvent,
  type PrivateTransportMessage,
} from './private-channel-manager';
import type { PrivateChannelBootstrapProvider } from './private-channel-bootstrap';
import {
  PrivateTransportSidecar,
  PrivateTransportSidecarError,
  type PrivateTransportSidecarEvent,
} from './private-transport-sidecar';

export type TrustedRelayConfig = Readonly<{
  protocolVersion?: number;
  relayIdentity?: string;
  ticketIdentity?: string;
  ticketKeyId?: string;
  accessMode?: 'public' | 'groups';
  allowedGroupIds?: number[];
  preparedRelay?: string;
  relayAddress: string;
  relayServerName: string;
  relayCertSha256: string;
  /** Same-host fallback, protected by the advertised certificate pin. */
  localFallbackAddress?: string;
}>;
export type TrustedRelayProvider = (
  excludedRelayAddresses?: ReadonlySet<string>
) => Promise<TrustedRelayConfig>;

const RECOVERY_DELAYS_MS = [0, 500, 2_000] as const;
const FAILED_RELAY_COOLDOWN_MS = 60_000;

const MAX_RELIABLE_BINARY_BYTES = 1024 * 1024;
const MAX_DATAGRAM_BINARY_BYTES = 1024;

export class QuicMasqueTransport implements PrivateTransport {
  private sessionId: string | null = null;
  private context: PrivateTransportContext | null = null;
  private activeRelayAddress: string | null = null;
  private lastAttemptedRelayAddress: string | null = null;
  private recoveryPromise: Promise<string> | null = null;
  private readonly failedRelayAddresses = new Map<string, number>();
  private closed = false;
  private readonly onSidecarEvent = (event: PrivateTransportSidecarEvent) =>
    this.handleSidecarEvent(event);
  private readonly onSidecarDeath = () => {
    if (!this.closed && this.sessionId) {
      void this.recover('TRANSPORT_CLOSED');
    }
  };

  constructor(
    private readonly emit: (event: PrivateTransportEvent) => void,
    private readonly sidecar: PrivateTransportSidecar,
    private readonly relay: TrustedRelayConfig | TrustedRelayProvider,
    private readonly bootstrapProvider: PrivateChannelBootstrapProvider
  ) {
    sidecar.on('event', this.onSidecarEvent);
    sidecar.on('death', this.onSidecarDeath);
  }

  async open(context: PrivateTransportContext): Promise<void> {
    if (this.closed) throw new PrivateChannelError('TRANSPORT_CLOSED');
    this.context = context;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await this.connect(context);
          break;
        } catch (error) {
          if (
            attempt >= 2 ||
            !this.lastAttemptedRelayAddress ||
            !isRecoverableTransportError(error) ||
            this.closed
          )
            throw error;
          if (this.lastAttemptedRelayAddress)
            this.failedRelayAddresses.set(
              this.lastAttemptedRelayAddress,
              Date.now()
            );
        }
      }
    } catch (error) {
      throw translateSidecarError(error);
    }
  }

  async sendReliable(message: PrivateTransportMessage): Promise<void> {
    const encoded = encodeApplicationData(message.data);
    if (encoded.length > MAX_RELIABLE_BINARY_BYTES) {
      throw new PrivateChannelError('MESSAGE_TOO_LARGE_FOR_TRANSPORT');
    }
    try {
      const sessionId = await this.requireSession();
      await this.sidecar.sendPrivateReliable(
        sessionId,
        message.messageId,
        encoded,
        message.streamKey,
        message.endStream
      );
    } catch (error) {
      if (isRecoverableTransportError(error)) {
        try {
          const replacementSessionId = await this.recover(errorCode(error));
          await this.sidecar.sendPrivateReliable(
            replacementSessionId,
            message.messageId,
            encoded,
            message.streamKey,
            message.endStream
          );
          return;
        } catch (recoveryError) {
          throw translateSidecarError(recoveryError);
        }
      }
      throw translateSidecarError(error);
    }
  }

  async sendDatagram(message: PrivateTransportMessage): Promise<void> {
    const encoded = encodeApplicationData(message.data);
    if (encoded.length > MAX_DATAGRAM_BINARY_BYTES) {
      throw new PrivateChannelError('MESSAGE_TOO_LARGE_FOR_TRANSPORT');
    }
    try {
      const sessionId = await this.requireSession();
      await this.sidecar.sendPrivateDatagram(
        sessionId,
        message.messageId,
        encoded
      );
    } catch (error) {
      if (isRecoverableTransportError(error)) {
        try {
          // Datagram delivery is intentionally best-effort. Recover the path,
          // but do not replay a stale real-time packet on the replacement.
          await this.recover(errorCode(error));
          return;
        } catch (recoveryError) {
          throw translateSidecarError(recoveryError);
        }
      }
      throw translateSidecarError(error);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.context = null;
    this.recoveryPromise = null;
    const sessionId = this.sessionId;
    this.sessionId = null;
    this.sidecar.off('event', this.onSidecarEvent);
    this.sidecar.off('death', this.onSidecarDeath);
    if (sessionId)
      await this.sidecar.closePrivateSession(sessionId).catch(() => undefined);
  }

  private async requireSession(): Promise<string> {
    if (this.recoveryPromise) await this.recoveryPromise;
    if (this.closed || !this.sessionId)
      throw new PrivateChannelError('TRANSPORT_CLOSED');
    return this.sessionId;
  }

  private handleSidecarEvent(event: PrivateTransportSidecarEvent): void {
    if (event.sessionId !== this.sessionId || this.closed) return;
    if (event.event === 'error') {
      if (isRecoverableCode(event.code)) {
        void this.recover(event.code ?? 'TRANSPORT_CLOSED');
        return;
      }
      this.emit({ kind: 'error', code: event.code ?? 'TRANSPORT_ERROR' });
      return;
    }
    if (!event.messageId) {
      this.emit({ kind: 'error', code: 'PROTOCOL_MISMATCH' });
      return;
    }
    try {
      this.emit({
        kind: 'message',
        lane: event.event === 'datagram' ? 'datagram' : 'reliable',
        messageId: event.messageId,
        data: decodeApplicationData(event.data),
      });
    } catch {
      this.emit({ kind: 'error', code: 'PROTOCOL_MISMATCH' });
    }
  }

  private async connect(context: PrivateTransportContext): Promise<void> {
    this.lastAttemptedRelayAddress = null;
    let [relay, bootstrap] = await Promise.all([
      this.resolveRelay(),
      this.bootstrapProvider.getBootstrap(context),
    ]);
    // Discovery/authentication can outlast a short-lived backend credential.
    // Refresh before sending it; a real backend rejection remains terminal.
    if (bootstrap.expiresAt < Date.now() + 5_000)
      bootstrap = await this.bootstrapProvider.getBootstrap(context);
    const openAt = (relayAddress: string) =>
      this.sidecar.openPrivateSession({
        preparedRelay: relay.preparedRelay,
        relayAddress,
        relayServerName: relay.relayServerName,
        relayCertSha256: relay.relayCertSha256,
        backendAddress: bootstrap.backendTransportEndpoint,
        backendServerName: bootstrap.backendTransportServerName,
        backendCertSha256: bootstrap.backendTransportCertSha256,
        logicalSessionId: bootstrap.logicalSessionId,
        attachToken: bootstrap.attachToken,
        nonce: bootstrap.nonce,
        purpose: context.purpose,
        ownerBindingHash: bootstrap.ownerBindingHash,
      });
    let opened;
    this.lastAttemptedRelayAddress = relay.relayAddress;
    try {
      opened = await openAt(relay.relayAddress);
    } catch (error) {
      if (
        !(error instanceof PrivateTransportSidecarError) ||
        error.code !== 'MASQUE_TUNNEL_FAILED' ||
        !relay.localFallbackAddress ||
        relay.localFallbackAddress === relay.relayAddress
      )
        throw error;
      opened = await openAt(relay.localFallbackAddress);
    }
    if (this.closed) {
      await this.sidecar
        .closePrivateSession(opened.sessionId)
        .catch(() => undefined);
      throw new PrivateChannelError('TRANSPORT_CLOSED');
    }
    this.sessionId = opened.sessionId;
    this.activeRelayAddress = relay.relayAddress;
  }

  private resolveRelay(): Promise<TrustedRelayConfig> {
    const now = Date.now();
    for (const [address, failedAt] of this.failedRelayAddresses) {
      if (now - failedAt >= FAILED_RELAY_COOLDOWN_MS)
        this.failedRelayAddresses.delete(address);
    }
    const excluded = new Set(this.failedRelayAddresses.keys());
    return typeof this.relay === 'function'
      ? this.relay(excluded)
      : Promise.resolve(this.relay);
  }

  private recover(_reason: string): Promise<string> {
    if (this.closed)
      return Promise.reject(new PrivateChannelError('TRANSPORT_CLOSED'));
    if (this.recoveryPromise) return this.recoveryPromise;
    const context = this.context;
    if (!context)
      return Promise.reject(new PrivateChannelError('TRANSPORT_CLOSED'));
    if (this.activeRelayAddress)
      this.failedRelayAddresses.set(this.activeRelayAddress, Date.now());
    const oldSessionId = this.sessionId;
    this.sessionId = null;
    this.activeRelayAddress = null;
    if (oldSessionId)
      void this.sidecar
        .closePrivateSession(oldSessionId)
        .catch(() => undefined);
    const recovery = (async (): Promise<string> => {
      let lastError: unknown = new PrivateChannelError('TRANSPORT_CLOSED');
      for (const delayMs of RECOVERY_DELAYS_MS) {
        if (delayMs) await delay(delayMs);
        if (this.closed) throw new PrivateChannelError('TRANSPORT_CLOSED');
        try {
          await this.connect(context);
          if (!this.sessionId)
            throw new PrivateChannelError('TRANSPORT_CLOSED');
          return this.sessionId;
        } catch (error) {
          lastError = error;
          if (this.lastAttemptedRelayAddress)
            this.failedRelayAddresses.set(
              this.lastAttemptedRelayAddress,
              Date.now()
            );
          this.sessionId = null;
          this.activeRelayAddress = null;
          if (!isRecoverableTransportError(error)) break;
        }
      }
      throw lastError;
    })();
    this.recoveryPromise = recovery;
    void recovery
      .catch((error) => {
        if (!this.closed)
          this.emit({ kind: 'error', code: translateSidecarError(error).code });
      })
      .finally(() => {
        if (this.recoveryPromise === recovery) this.recoveryPromise = null;
      });
    return recovery;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error: unknown): string {
  return error instanceof PrivateTransportSidecarError ||
    error instanceof PrivateChannelError
    ? error.code
    : error instanceof Error
      ? error.message
      : 'TRANSPORT_ERROR';
}

function isRecoverableCode(code: string | undefined): boolean {
  return (
    code === 'RELAY_CONNECT_FAILED' ||
    code === 'RELAY_CONNECTION_CLOSED' ||
    code === 'RELAY_TARGET_DENIED' ||
    code === 'RELAY_FULL' ||
    code === 'RELAY_AUTH_REQUIRED' ||
    code === 'RELAY_ACCESS_DENIED' ||
    code === 'RELAY_MEMBERSHIP_UNAVAILABLE' ||
    code === 'INNER_QUIC_FAILED' ||
    code === 'TRANSPORT_CLOSED' ||
    code === 'MASQUE_TUNNEL_FAILED' ||
    code === 'SIDECAR_EXITED' ||
    code === 'SIDECAR_NOT_RUNNING' ||
    code === 'SIDECAR_REQUEST_TIMEOUT' ||
    code === 'SIDECAR_WRITE_FAILED' ||
    code === 'MASQUE_RELAY_UNAVAILABLE' ||
    code === 'BOOTSTRAP_FAILED'
  );
}

function isRecoverableTransportError(error: unknown): boolean {
  return isRecoverableCode(errorCode(error));
}

function encodeApplicationData(value: unknown): Buffer {
  if (value instanceof ArrayBuffer)
    return Buffer.concat([Buffer.from([1]), Buffer.from(value)]);
  if (ArrayBuffer.isView(value)) {
    return Buffer.concat([
      Buffer.from([1]),
      Buffer.from(value.buffer, value.byteOffset, value.byteLength),
    ]);
  }
  try {
    return Buffer.concat([
      Buffer.from([0]),
      Buffer.from(JSON.stringify(value ?? null), 'utf8'),
    ]);
  } catch {
    throw new PrivateChannelError('INVALID_MESSAGE');
  }
}

function decodeApplicationData(value: Buffer): unknown {
  if (value.length < 1) throw new Error('missing application encoding');
  if (value[0] === 1) return new Uint8Array(value.subarray(1));
  if (value[0] === 0) return JSON.parse(value.subarray(1).toString('utf8'));
  throw new Error('unsupported application encoding');
}

function translateSidecarError(error: unknown): PrivateChannelError {
  const code =
    error instanceof PrivateTransportSidecarError ||
    error instanceof PrivateChannelError
      ? error.code
      : error instanceof Error && error.message === 'MASQUE_RELAY_UNAVAILABLE'
        ? error.message
        : 'TRANSPORT_ERROR';
  const allowed = new Set([
    'STREAM_LIMIT_REACHED',
    'RELIABLE_STREAM_FAILED',
    'RELIABLE_SEND_NOT_STARTED',
    'RELIABLE_STREAMS_UNSUPPORTED',
    'TRANSPORT_ALREADY_ATTACHED',
    'RELAY_NO_ELIGIBLE_RELAY',
    'RELAY_ACCESS_DENIED',
    'RELAY_PROOF_INVALID',
    'RELAY_MEMBERSHIP_UNAVAILABLE',
    'RELAY_TARGET_DENIED',
    'RELAY_FULL',
    'RELAY_AUTH_REQUIRED',
    'RELAY_CONNECTION_CLOSED',
    'RELAY_CONNECT_FAILED',
    'BACKEND_IDENTITY_MISMATCH',
    'MASQUE_TUNNEL_FAILED',
    'MASQUE_RELAY_UNAVAILABLE',
    'INNER_QUIC_FAILED',
    'SESSION_ATTACH_FAILED',
    'ATTACH_TOKEN_REJECTED',
    'DATAGRAM_UNSUPPORTED',
    'TRANSPORT_CLOSED',
    'PROTOCOL_MISMATCH',
    'FRAME_TOO_LARGE',
  ]);
  return new PrivateChannelError(allowed.has(code) ? code : 'TRANSPORT_ERROR');
}

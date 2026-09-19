import type { PrivateChannelBootstrapProvider } from './private-channel-bootstrap';
import type { PrivateTransportContext } from './private-channel-manager';
import {
  MAX_MOQ_OBJECT_BYTES,
  MAX_MOQ_RELIABLE_OBJECT_BYTES,
  PrivateTransportSidecar,
  PrivateTransportSidecarError,
  type PrivateTransportSidecarEvent,
} from './private-transport-sidecar';
import type {
  TrustedRelayConfig,
  TrustedRelayProvider,
} from './quic-masque-transport';
import type { QAppReticulumOwner } from './qapp-reticulum-manager';

const MOQ_NAME = /^[A-Za-z0-9._-]{1,128}$/;
const RECOVERY_DELAYS_MS = [0, 500, 2_000] as const;
const FAILED_RELAY_COOLDOWN_MS = 60_000;

function validNamespace(namespace: readonly string[]): boolean {
  return (
    namespace.length >= 1 &&
    namespace.length <= 8 &&
    namespace.every((component) => MOQ_NAME.test(component)) &&
    namespace.reduce((total, component) => total + component.length, 0) <= 512
  );
}

export type MoqOpenContext = Readonly<{
  owner: QAppReticulumOwner;
  rnsConnectionId: string;
  publicationNamespace: readonly string[];
  publicationTrack: string | readonly string[];
}>;

export type MoqTransportEvent =
  | Readonly<{
      kind: 'object';
      subscriptionId: string;
      namespace: readonly string[];
      trackName: string;
      groupId: number;
      objectId: number;
      payload: Uint8Array;
    }>
  | Readonly<{ kind: 'error'; code: string; subscriptionId?: string }>;

/**
 * Main-process-only generic MOQT transport. Payload meaning and protection are
 * deliberately outside this layer; endpoints and sockets remain private.
 */
export class MoqMasqueTransport {
  private moqSessionId: string | null = null;
  private context: MoqOpenContext | null = null;
  private activeRelayAddress: string | null = null;
  private lastAttemptedRelayAddress: string | null = null;
  private recoveryPromise: Promise<string> | null = null;
  private readonly failedRelayAddresses = new Map<string, number>();
  private readonly subscriptions = new Map<
    string,
    { namespace: readonly string[]; trackName: string }
  >();
  private closed = false;
  private readonly onSidecarEvent = (event: PrivateTransportSidecarEvent) =>
    this.handleSidecarEvent(event);
  private readonly onSidecarDeath = () => {
    if (!this.closed && this.moqSessionId) {
      void this.recover('MOQ_TRANSPORT_CLOSED');
    }
  };

  constructor(
    private readonly emit: (event: MoqTransportEvent) => void,
    private readonly sidecar: PrivateTransportSidecar,
    private readonly relay: TrustedRelayConfig | TrustedRelayProvider,
    private readonly bootstrapProvider: PrivateChannelBootstrapProvider
  ) {
    sidecar.on('event', this.onSidecarEvent);
    sidecar.on('death', this.onSidecarDeath);
  }

  async open(context: MoqOpenContext): Promise<void> {
    if (this.closed || this.moqSessionId) {
      throw new PrivateTransportSidecarError('MOQ_SESSION_CLOSED');
    }
    if (
      !validNamespace(context.publicationNamespace) ||
      !(
        typeof context.publicationTrack === 'string'
          ? [context.publicationTrack]
          : context.publicationTrack
      ).every((track) => MOQ_NAME.test(track))
    ) {
      throw new PrivateTransportSidecarError('INVALID_MOQ_CONFIG');
    }
    this.context = context;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.connect(context);
        break;
      } catch (error) {
        if (
          attempt >= 2 ||
          !this.lastAttemptedRelayAddress ||
          !isRecoverableMoqError(error) ||
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
  }

  private async connect(context: MoqOpenContext): Promise<void> {
    this.lastAttemptedRelayAddress = null;
    const relayPromise = this.resolveRelay();
    const bootstrapContext: PrivateTransportContext = {
      channelId: 'trusted-moq-transport',
      rnsConnectionId: context.rnsConnectionId,
      purpose: 'realtime',
      generation: 1,
      owner: context.owner,
    };
    let [relay, bootstrap] = await Promise.all([
      relayPromise,
      this.bootstrapProvider.getBootstrap(bootstrapContext),
    ]);
    if (bootstrap.expiresAt < Date.now() + 5_000)
      bootstrap = await this.bootstrapProvider.getBootstrap(bootstrapContext);
    if (
      bootstrap.applicationProtocol !== 'moqt-18' ||
      bootstrap.supportedFeatures.moqt !== true ||
      bootstrap.supportedFeatures.moqtReliableGroups !== true
    ) {
      throw new PrivateTransportSidecarError('UNSUPPORTED_MOQ_TRANSPORT');
    }
    this.lastAttemptedRelayAddress = relay.relayAddress;
    const openAt = (relayAddress: string) =>
      this.sidecar.openMoqSession({
        preparedRelay: relay.preparedRelay,
        relayAddress,
        relayServerName: relay.relayServerName,
        relayCertSha256: relay.relayCertSha256,
        backendAddress: bootstrap.backendTransportEndpoint,
        backendServerName: bootstrap.backendTransportServerName,
        backendCertSha256: bootstrap.backendTransportCertSha256,
        logicalSessionId: bootstrap.logicalSessionId,
        attachToken: bootstrap.attachToken,
        publicationNamespace: context.publicationNamespace,
        publicationTrack: context.publicationTrack,
      });
    let opened;
    try {
      opened = await openAt(relay.relayAddress);
    } catch (error) {
      if (
        !(error instanceof PrivateTransportSidecarError) ||
        error.code !== 'MASQUE_TUNNEL_FAILED' ||
        !relay.localFallbackAddress ||
        relay.localFallbackAddress === relay.relayAddress
      ) {
        throw error;
      }
      opened = await openAt(relay.localFallbackAddress);
    }
    if (this.closed) {
      await this.sidecar
        .closeMoqSession(opened.moqSessionId)
        .catch(() => undefined);
      throw new PrivateTransportSidecarError('MOQ_SESSION_CLOSED');
    }
    this.moqSessionId = opened.moqSessionId;
    this.activeRelayAddress = relay.relayAddress;
    try {
      for (const [subscriptionId, subscription] of this.subscriptions) {
        await this.sidecar.subscribeMoqTrack(
          opened.moqSessionId,
          subscriptionId,
          subscription.namespace,
          subscription.trackName
        );
      }
    } catch (error) {
      this.moqSessionId = null;
      this.activeRelayAddress = null;
      await this.sidecar
        .closeMoqSession(opened.moqSessionId)
        .catch(() => undefined);
      throw error;
    }
  }

  async subscribe(
    subscriptionId: string,
    namespace: readonly string[],
    trackName: string
  ): Promise<void> {
    if (
      !MOQ_NAME.test(subscriptionId) ||
      !validNamespace(namespace) ||
      !MOQ_NAME.test(trackName)
    ) {
      throw new PrivateTransportSidecarError('INVALID_MOQ_SUBSCRIPTION');
    }
    const subscription = { namespace: [...namespace], trackName };
    this.subscriptions.set(subscriptionId, subscription);
    try {
      const sessionId = await this.requireSession();
      await this.sidecar.subscribeMoqTrack(
        sessionId,
        subscriptionId,
        namespace,
        trackName
      );
    } catch (error) {
      if (isRecoverableMoqError(error)) {
        try {
          // Recovery restores the subscription recorded above.
          await this.recover(errorCode(error));
          return;
        } catch (recoveryError) {
          this.subscriptions.delete(subscriptionId);
          throw recoveryError;
        }
      }
      this.subscriptions.delete(subscriptionId);
      throw error;
    }
  }

  async publish(
    payload: Uint8Array,
    trackName?: string,
    batch?: readonly Uint8Array[],
    delivery?: {
      priority: number;
      maxQueueAgeMillis: number;
      groupId?: number;
      objectId?: number;
    }
  ): Promise<void> {
    const limit =
      delivery?.groupId !== undefined
        ? MAX_MOQ_RELIABLE_OBJECT_BYTES
        : MAX_MOQ_OBJECT_BYTES;
    if (payload.byteLength < 1 || payload.byteLength > limit) {
      throw new PrivateTransportSidecarError('MOQ_OBJECT_TOO_LARGE');
    }
    try {
      const sessionId = await this.requireSession();
      if (batch)
        await this.sidecar.publishMoqObject(
          sessionId,
          payload,
          trackName,
          batch,
          delivery
        );
      else await this.sidecar.publishMoqObject(sessionId, payload);
    } catch (error) {
      if (isRecoverableMoqError(error)) {
        // A media object is stale by the time a replacement path opens. Drop
        // this object after recovery instead of creating an audible late frame.
        await this.recover(errorCode(error));
        throw new PrivateTransportSidecarError('MOQ_SEND_FAILED');
      }
      throw error;
    }
  }

  async metrics(): Promise<Record<string, number>> {
    try {
      return await this.sidecar.moqSessionMetrics(await this.requireSession());
    } catch (error) {
      if (isRecoverableMoqError(error)) {
        const replacementSessionId = await this.recover(errorCode(error));
        return this.sidecar.moqSessionMetrics(replacementSessionId);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.context = null;
    this.recoveryPromise = null;
    this.subscriptions.clear();
    const moqSessionId = this.moqSessionId;
    this.moqSessionId = null;
    this.sidecar.off('event', this.onSidecarEvent);
    this.sidecar.off('death', this.onSidecarDeath);
    if (moqSessionId) {
      await this.sidecar.closeMoqSession(moqSessionId).catch(() => undefined);
    }
  }

  private async resolveRelay(): Promise<TrustedRelayConfig> {
    const now = Date.now();
    for (const [address, failedAt] of this.failedRelayAddresses) {
      if (now - failedAt >= FAILED_RELAY_COOLDOWN_MS)
        this.failedRelayAddresses.delete(address);
    }
    const excluded = new Set(this.failedRelayAddresses.keys());
    return typeof this.relay === 'function' ? this.relay(excluded) : this.relay;
  }

  private async requireSession(): Promise<string> {
    if (this.recoveryPromise) await this.recoveryPromise;
    if (this.closed || !this.moqSessionId) {
      throw new PrivateTransportSidecarError('MOQ_SESSION_CLOSED');
    }
    return this.moqSessionId;
  }

  private handleSidecarEvent(event: PrivateTransportSidecarEvent): void {
    if (event.sessionId !== this.moqSessionId || this.closed) return;
    if (event.event === 'error') {
      if (isRecoverableMoqCode(event.code)) {
        void this.recover(event.code ?? 'MOQ_TRANSPORT_CLOSED');
        return;
      }
      this.emit({
        kind: 'error',
        code: event.code ?? 'MOQ_TRANSPORT_ERROR',
        subscriptionId: event.subscriptionId,
      });
      return;
    }
    if (
      event.event !== 'object' ||
      !event.subscriptionId ||
      !event.namespace ||
      !validNamespace(event.namespace) ||
      !event.trackName ||
      !MOQ_NAME.test(event.trackName) ||
      typeof event.groupId !== 'number' ||
      typeof event.objectId !== 'number' ||
      !Number.isSafeInteger(event.groupId) ||
      !Number.isSafeInteger(event.objectId) ||
      event.data.length < 1 ||
      event.data.length > MAX_MOQ_RELIABLE_OBJECT_BYTES
    ) {
      this.emit({ kind: 'error', code: 'MOQ_PROTOCOL_MISMATCH' });
      return;
    }
    this.emit({
      kind: 'object',
      subscriptionId: event.subscriptionId,
      namespace: [...event.namespace],
      trackName: event.trackName,
      groupId: event.groupId,
      objectId: event.objectId,
      payload: new Uint8Array(event.data),
    });
  }

  private recover(_reason: string): Promise<string> {
    if (this.closed)
      return Promise.reject(
        new PrivateTransportSidecarError('MOQ_SESSION_CLOSED')
      );
    if (this.recoveryPromise) return this.recoveryPromise;
    const context = this.context;
    if (!context)
      return Promise.reject(
        new PrivateTransportSidecarError('MOQ_SESSION_CLOSED')
      );
    if (this.activeRelayAddress)
      this.failedRelayAddresses.set(this.activeRelayAddress, Date.now());
    const oldSessionId = this.moqSessionId;
    this.moqSessionId = null;
    this.activeRelayAddress = null;
    if (oldSessionId)
      void this.sidecar.closeMoqSession(oldSessionId).catch(() => undefined);
    const recovery = (async (): Promise<string> => {
      let lastError: unknown = new PrivateTransportSidecarError(
        'MOQ_TRANSPORT_CLOSED'
      );
      for (const delayMs of RECOVERY_DELAYS_MS) {
        if (delayMs) await delay(delayMs);
        if (this.closed)
          throw new PrivateTransportSidecarError('MOQ_SESSION_CLOSED');
        try {
          await this.connect(context);
          if (!this.moqSessionId)
            throw new PrivateTransportSidecarError('MOQ_SESSION_CLOSED');
          return this.moqSessionId;
        } catch (error) {
          lastError = error;
          if (this.lastAttemptedRelayAddress)
            this.failedRelayAddresses.set(
              this.lastAttemptedRelayAddress,
              Date.now()
            );
          this.moqSessionId = null;
          this.activeRelayAddress = null;
          if (!isRecoverableMoqError(error)) break;
        }
      }
      throw lastError;
    })();
    this.recoveryPromise = recovery;
    void recovery
      .catch((error) => {
        if (!this.closed) this.emit({ kind: 'error', code: errorCode(error) });
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
  return error instanceof PrivateTransportSidecarError
    ? error.code
    : error instanceof Error && /^[A-Z0-9_]{3,64}$/.test(error.message)
      ? error.message
      : 'MOQ_TRANSPORT_ERROR';
}

function isRecoverableMoqCode(code: string | undefined): boolean {
  return (
    code === 'RELAY_CONNECT_FAILED' ||
    code === 'RELAY_CONNECTION_CLOSED' ||
    code === 'RELAY_TARGET_DENIED' ||
    code === 'RELAY_FULL' ||
    code === 'RELAY_AUTH_REQUIRED' ||
    code === 'RELAY_ACCESS_DENIED' ||
    code === 'RELAY_MEMBERSHIP_UNAVAILABLE' ||
    code === 'MOQ_TRANSPORT_CLOSED' ||
    code === 'MOQ_QUIC_FAILED' ||
    code === 'MOQ_SESSION_CLOSED' ||
    code === 'MOQ_READ_FAILED' ||
    code === 'MOQ_SEND_FAILED' ||
    code === 'MASQUE_TUNNEL_FAILED' ||
    code === 'MASQUE_RELAY_UNAVAILABLE' ||
    code === 'SIDECAR_EXITED' ||
    code === 'SIDECAR_NOT_RUNNING' ||
    code === 'SIDECAR_REQUEST_TIMEOUT' ||
    code === 'SIDECAR_WRITE_FAILED' ||
    code === 'BOOTSTRAP_FAILED'
  );
}

function isRecoverableMoqError(error: unknown): boolean {
  return isRecoverableMoqCode(errorCode(error));
}

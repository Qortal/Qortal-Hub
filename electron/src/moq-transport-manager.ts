import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type {
  QAppReticulumConnectionOwnership,
  QAppReticulumOwner,
} from './qapp-reticulum-manager';
import { privateChannelOwnerKey } from './private-channel-manager';
import type { MoqOpenContext, MoqTransportEvent } from './moq-masque-transport';

export const QAPP_MOQ_LIMITS = Object.freeze({
  maxSessionsPerOwner: 2,
  maxSessionsGlobal: 16,
  maxSubscriptionsPerSession: 128,
  maxPublicationTracks: 8,
  maxBatchObjects: 8,
  maxQueuedBytesPerTrack: 16 * 1024,
  maxObjectBytes: 1024,
  maxReliableObjectBytes: 1024 * 1024,
  maxQueuedBytesPerSession: 2 * 1024 * 1024 + 64 * 1024,
});

const MOQ_NAME = /^[A-Za-z0-9._-]{1,128}$/;

export class QAppMoqError extends Error {
  constructor(
    public readonly code: string,
    message = code
  ) {
    super(message);
  }
}

export type MoqDeliveryPolicy = Readonly<{
  priority: number;
  maxQueueAgeMillis: number;
  groupId?: number;
  objectId?: number;
}>;

export interface ManagedMoqTransport {
  open(context: MoqOpenContext): Promise<void>;
  subscribe(
    subscriptionId: string,
    namespace: readonly string[],
    trackName: string
  ): Promise<void>;
  publish(
    payload: Uint8Array,
    trackName?: string,
    batch?: readonly Uint8Array[],
    delivery?: MoqDeliveryPolicy
  ): Promise<void>;
  metrics(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

export type ManagedMoqTransportFactory = (
  emit: (event: MoqTransportEvent) => void
) => ManagedMoqTransport;

type SessionRecord = {
  sessionId: string;
  ownerKey: string;
  owner: QAppReticulumOwner;
  rnsConnectionId: string;
  state: 'OPENING' | 'OPEN' | 'CLOSED';
  transport: ManagedMoqTransport;
  subscriptions: Set<string>;
  queuedBytes: number;
  publicationTracks: readonly string[];
  queuedByTrack: Map<string, number>;
  generation: number;
};

export class QAppMoqTransportManager extends EventEmitter {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionsByOwner = new Map<string, Set<string>>();

  constructor(
    private readonly getRnsConnectionOwnership: (
      owner: QAppReticulumOwner,
      connectionId: string
    ) => QAppReticulumConnectionOwnership,
    private readonly transportFactory: ManagedMoqTransportFactory
  ) {
    super();
  }

  async open(
    owner: QAppReticulumOwner,
    rnsConnectionIdValue: unknown,
    publicationNamespaceValue: unknown,
    publicationTrackValue: unknown
  ) {
    const ownerKey = validatedOwnerKey(owner);
    const rnsConnectionId = requireNonemptyString(
      rnsConnectionIdValue,
      'INVALID_RNS_CONNECTION'
    );
    const ownership = this.getRnsConnectionOwnership(owner, rnsConnectionId);
    if (ownership === 'missing')
      throw new QAppMoqError('INVALID_RNS_CONNECTION');
    if (ownership !== 'owned')
      throw new QAppMoqError('RNS_CONNECTION_NOT_OWNED');
    const publicationNamespace = requireNamespace(
      publicationNamespaceValue,
      'INVALID_MOQ_CONFIG'
    );
    const trackValues = Array.isArray(publicationTrackValue)
      ? publicationTrackValue
      : [publicationTrackValue];
    if (
      !trackValues.length ||
      trackValues.length > QAPP_MOQ_LIMITS.maxPublicationTracks
    )
      throw new QAppMoqError('INVALID_MOQ_CONFIG');
    const publicationTracks = trackValues.map((value) =>
      requireName(value, 'INVALID_MOQ_CONFIG')
    );
    if (new Set(publicationTracks).size !== publicationTracks.length)
      throw new QAppMoqError('INVALID_MOQ_CONFIG');
    const publicationTrack = Array.isArray(publicationTrackValue)
      ? publicationTracks
      : publicationTracks[0];
    if (
      (this.sessionsByOwner.get(ownerKey)?.size ?? 0) >=
        QAPP_MOQ_LIMITS.maxSessionsPerOwner ||
      this.sessions.size >= QAPP_MOQ_LIMITS.maxSessionsGlobal
    ) {
      throw new QAppMoqError('MOQ_SESSION_LIMIT');
    }

    const sessionId = `qapp-moq-${randomUUID()}`;
    const generation = 1;
    const transport = this.transportFactory((event) =>
      this.handleTransportEvent(sessionId, generation, event)
    );
    const session: SessionRecord = {
      sessionId,
      ownerKey,
      owner,
      rnsConnectionId,
      state: 'OPENING',
      transport,
      subscriptions: new Set(),
      queuedBytes: 0,
      publicationTracks,
      queuedByTrack: new Map(),
      generation,
    };
    this.sessions.set(sessionId, session);
    const owned = this.sessionsByOwner.get(ownerKey) ?? new Set<string>();
    owned.add(sessionId);
    this.sessionsByOwner.set(ownerKey, owned);
    try {
      await transport.open({
        owner,
        rnsConnectionId,
        publicationNamespace,
        publicationTrack,
      });
      if (this.sessions.get(sessionId) !== session)
        throw new QAppMoqError('MOQ_SESSION_CLOSED');
      session.state = 'OPEN';
      this.emitState(session, 'OPEN');
      return {
        sessionId,
        state: 'OPEN' as const,
        publicationNamespace,
        publicationTrack,
        limits: QAPP_MOQ_LIMITS,
      };
    } catch (error) {
      this.remove(session);
      void transport.close().catch(() => undefined);
      throw normalizeError(error, 'MOQ_SESSION_OPEN_FAILED');
    }
  }

  async subscribe(
    owner: QAppReticulumOwner,
    sessionIdValue: unknown,
    subscriptionIdValue: unknown,
    namespaceValue: unknown,
    trackNameValue: unknown
  ) {
    const session = this.requireOwned(owner, sessionIdValue);
    const subscriptionId = requireName(
      subscriptionIdValue,
      'INVALID_MOQ_SUBSCRIPTION'
    );
    const namespace = requireNamespace(
      namespaceValue,
      'INVALID_MOQ_SUBSCRIPTION'
    );
    const trackName = requireName(trackNameValue, 'INVALID_MOQ_SUBSCRIPTION');
    if (
      !session.subscriptions.has(subscriptionId) &&
      session.subscriptions.size >= QAPP_MOQ_LIMITS.maxSubscriptionsPerSession
    ) {
      throw new QAppMoqError('MOQ_SUBSCRIPTION_LIMIT');
    }
    try {
      await session.transport.subscribe(subscriptionId, namespace, trackName);
      session.subscriptions.add(subscriptionId);
      return { sessionId: session.sessionId, subscriptionId, subscribed: true };
    } catch (error) {
      throw normalizeError(error, 'MOQ_SUBSCRIBE_FAILED');
    }
  }

  async publish(
    owner: QAppReticulumOwner,
    sessionIdValue: unknown,
    payloadValue: unknown
  ) {
    const session = this.requireOwned(owner, sessionIdValue);
    const batchRequest =
      payloadValue &&
      typeof payloadValue === 'object' &&
      'objects' in payloadValue
        ? (payloadValue as {
            objects: unknown;
            trackName: unknown;
            delivery?: unknown;
          })
        : null;
    const track = batchRequest
      ? requireName(batchRequest.trackName, 'INVALID_MOQ_CONFIG')
      : session.publicationTracks[0];
    if (!session.publicationTracks.includes(track))
      throw new QAppMoqError('INVALID_MOQ_CONFIG');
    if (
      batchRequest &&
      (!Array.isArray(batchRequest.objects) ||
        !batchRequest.objects.length ||
        batchRequest.objects.length > QAPP_MOQ_LIMITS.maxBatchObjects)
    )
      throw new QAppMoqError('MOQ_OBJECT_TOO_LARGE');
    const delivery = batchRequest?.delivery as MoqDeliveryPolicy | undefined;
    const reliable =
      delivery?.groupId !== undefined || delivery?.objectId !== undefined;
    if (
      reliable &&
      (!Number.isSafeInteger(delivery?.groupId) ||
        delivery!.groupId! < 0 ||
        !Number.isSafeInteger(delivery?.objectId) ||
        delivery!.objectId! < 0 ||
        !Array.isArray(batchRequest?.objects) ||
        batchRequest.objects.length !== 1)
    )
      throw new QAppMoqError('INVALID_MOQ_CONFIG');
    const limit = reliable
      ? QAPP_MOQ_LIMITS.maxReliableObjectBytes
      : QAPP_MOQ_LIMITS.maxObjectBytes;
    const objects = batchRequest
      ? (batchRequest.objects as unknown[]).map((value) =>
          requirePayload(value, limit)
        )
      : [requirePayload(payloadValue)];
    if (
      delivery !== undefined &&
      (!delivery ||
        typeof delivery !== 'object' ||
        !Number.isInteger(delivery.priority) ||
        delivery.priority < 0 ||
        delivery.priority > 2 ||
        !Number.isInteger(delivery.maxQueueAgeMillis) ||
        delivery.maxQueueAgeMillis < 10 ||
        delivery.maxQueueAgeMillis > 2000)
    )
      throw new QAppMoqError('INVALID_MOQ_CONFIG');
    const bytes = objects.reduce((sum, payload) => sum + payload.byteLength, 0);
    if (
      session.queuedBytes + bytes > QAPP_MOQ_LIMITS.maxQueuedBytesPerSession ||
      (session.queuedByTrack.get(track) ?? 0) + bytes >
        (reliable
          ? QAPP_MOQ_LIMITS.maxReliableObjectBytes
          : QAPP_MOQ_LIMITS.maxQueuedBytesPerTrack)
    ) {
      throw new QAppMoqError('MOQ_QUEUE_LIMIT');
    }
    session.queuedBytes += bytes;
    session.queuedByTrack.set(
      track,
      (session.queuedByTrack.get(track) ?? 0) + bytes
    );
    try {
      if (batchRequest)
        await session.transport.publish(objects[0], track, objects, delivery);
      else await session.transport.publish(objects[0]);
      return {
        sessionId: session.sessionId,
        accepted: true as const,
        bytes,
      };
    } catch (error) {
      throw normalizeError(error, 'MOQ_SEND_FAILED');
    } finally {
      session.queuedBytes = Math.max(0, session.queuedBytes - bytes);
      session.queuedByTrack.set(
        track,
        Math.max(0, (session.queuedByTrack.get(track) ?? 0) - bytes)
      );
    }
  }

  async metrics(owner: QAppReticulumOwner, sessionIdValue: unknown) {
    const session = this.requireOwned(owner, sessionIdValue);
    try {
      return await session.transport.metrics();
    } catch (error) {
      throw normalizeError(error, 'MOQ_METRICS_FAILED');
    }
  }

  async close(owner: QAppReticulumOwner, sessionIdValue: unknown) {
    const session = this.requireOwned(owner, sessionIdValue);
    this.remove(session);
    try {
      await session.transport.close();
    } catch {
      // The Q-App handle is closed even if native teardown has already happened.
    }
    this.emitState(session, 'CLOSED');
    return { sessionId: session.sessionId, state: 'CLOSED' as const };
  }

  async cleanupOwner(owner: QAppReticulumOwner): Promise<void> {
    const ownerKey = validatedOwnerKey(owner);
    const sessions = [...(this.sessionsByOwner.get(ownerKey) ?? [])]
      .map((id) => this.sessions.get(id))
      .filter((session): session is SessionRecord => Boolean(session));
    await Promise.allSettled(
      sessions.map((session) => this.terminate(session))
    );
  }

  async cleanupRnsConnection(
    owner: QAppReticulumOwner,
    rnsConnectionId: string
  ): Promise<void> {
    const ownerKey = validatedOwnerKey(owner);
    const sessions = [...(this.sessionsByOwner.get(ownerKey) ?? [])]
      .map((id) => this.sessions.get(id))
      .filter(
        (session): session is SessionRecord =>
          Boolean(session) && session?.rnsConnectionId === rnsConnectionId
      );
    await Promise.allSettled(
      sessions.map((session) => this.terminate(session))
    );
  }

  destroy(): void {
    for (const session of this.sessions.values()) {
      void session.transport.close().catch(() => undefined);
    }
    this.sessions.clear();
    this.sessionsByOwner.clear();
    this.removeAllListeners();
  }

  private requireOwned(
    owner: QAppReticulumOwner,
    sessionIdValue: unknown
  ): SessionRecord {
    const ownerKey = validatedOwnerKey(owner);
    const sessionId =
      typeof sessionIdValue === 'string' ? sessionIdValue.trim() : '';
    if (!sessionId.startsWith('qapp-moq-'))
      throw new QAppMoqError('INVALID_MOQ_SESSION');
    const session = this.sessions.get(sessionId);
    if (!session) throw new QAppMoqError('MOQ_SESSION_CLOSED');
    if (session.ownerKey !== ownerKey)
      throw new QAppMoqError('MOQ_SESSION_NOT_OWNED');
    if (session.state !== 'OPEN') throw new QAppMoqError('MOQ_SESSION_CLOSED');
    return session;
  }

  private handleTransportEvent(
    sessionId: string,
    generation: number,
    event: MoqTransportEvent
  ): void {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.generation !== generation ||
      session.state !== 'OPEN'
    )
      return;
    if (event.kind === 'object') {
      if (
        !session.subscriptions.has(event.subscriptionId) ||
        event.payload.byteLength < 1 ||
        event.payload.byteLength > QAPP_MOQ_LIMITS.maxObjectBytes
      ) {
        this.fail(session, 'MOQ_PROTOCOL_MISMATCH');
        return;
      }
      this.emit('event', {
        ownerKey: session.ownerKey,
        action: 'MOQ_OBJECT',
        sessionId,
        subscriptionId: event.subscriptionId,
        namespace: [...event.namespace],
        trackName: event.trackName,
        groupId: event.groupId,
        objectId: event.objectId,
        payload: Uint8Array.from(event.payload),
      });
      return;
    }
    this.emit('event', {
      ownerKey: session.ownerKey,
      action: 'MOQ_ERROR',
      sessionId,
      subscriptionId: event.subscriptionId,
      code: event.code,
    });
    if (!event.subscriptionId) this.fail(session, event.code, false);
  }

  private fail(session: SessionRecord, code: string, emitError = true): void {
    if (this.sessions.get(session.sessionId) !== session) return;
    if (emitError) {
      this.emit('event', {
        ownerKey: session.ownerKey,
        action: 'MOQ_ERROR',
        sessionId: session.sessionId,
        code,
      });
    }
    this.remove(session);
    this.emitState(session, 'CLOSED');
    void session.transport.close().catch(() => undefined);
  }

  private remove(session: SessionRecord): void {
    session.state = 'CLOSED';
    this.sessions.delete(session.sessionId);
    const owned = this.sessionsByOwner.get(session.ownerKey);
    owned?.delete(session.sessionId);
    if (owned?.size === 0) this.sessionsByOwner.delete(session.ownerKey);
  }

  private async terminate(session: SessionRecord): Promise<void> {
    if (this.sessions.get(session.sessionId) !== session) return;
    this.remove(session);
    await session.transport.close().catch(() => undefined);
    this.emitState(session, 'CLOSED');
  }

  private emitState(session: SessionRecord, state: 'OPEN' | 'CLOSED'): void {
    this.emit('event', {
      ownerKey: session.ownerKey,
      action: 'MOQ_STATE',
      sessionId: session.sessionId,
      state,
    });
  }
}

function validatedOwnerKey(owner: QAppReticulumOwner): string {
  try {
    return privateChannelOwnerKey(owner);
  } catch {
    throw new QAppMoqError('PERMISSION_DENIED');
  }
}

function requireNonemptyString(value: unknown, code: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > 256) throw new QAppMoqError(code);
  return result;
}

function requireName(value: unknown, code: string): string {
  if (typeof value !== 'string' || !MOQ_NAME.test(value))
    throw new QAppMoqError(code);
  return value;
}

function requireNamespace(value: unknown, code: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 8 ||
    !value.every((component) =>
      typeof component === 'string' ? MOQ_NAME.test(component) : false
    ) ||
    value.reduce<number>((total, component) => total + component.length, 0) >
      512
  ) {
    throw new QAppMoqError(code);
  }
  return [...value];
}

function requirePayload(
  value: unknown,
  limit: number = QAPP_MOQ_LIMITS.maxObjectBytes
): Uint8Array {
  if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer))
    throw new QAppMoqError('INVALID_MOQ_OBJECT');
  if (value.byteLength < 1 || value.byteLength > limit) {
    throw new QAppMoqError('MOQ_OBJECT_TOO_LARGE');
  }
  return value instanceof Uint8Array
    ? Uint8Array.from(value)
    : new Uint8Array(value.slice(0));
}

function normalizeError(error: unknown, fallback: string): QAppMoqError {
  if (error instanceof QAppMoqError) return error;
  const propertyCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{3,64}$/.test(error.code)
      ? error.code
      : '';
  const messageCode =
    error instanceof Error && /^[A-Z0-9_]{3,64}$/.test(error.message)
      ? error.message
      : '';
  const code = propertyCode || messageCode || fallback;
  return new QAppMoqError(code);
}

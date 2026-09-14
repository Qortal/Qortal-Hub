import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export type QAppReticulumState =
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'CLOSING'
  | 'CLOSED'
  | 'ERROR';

export type QAppReticulumOwner = {
  tabId: string;
  name: string;
  service: string;
};

export type QAppReticulumConnectionOwnership =
  | 'owned'
  | 'not-owned'
  | 'missing';

export type QAppReticulumNativeEvent = {
  managerKey: string;
  connectionId?: string;
  kind: 'message' | 'state';
  state?: QAppReticulumState;
  payloadBase64?: string;
  encoding?: 'json' | 'base64';
  reason?: string;
};

export interface QAppReticulumTransport {
  invoke(
    action: string,
    payload: Record<string, unknown>
  ): Promise<{
    ok: boolean;
    payload?: Record<string, unknown>;
    code?: string;
  }>;
  onEvent(listener: (event: QAppReticulumNativeEvent) => void): () => void;
}

export class QAppReticulumError extends Error {
  constructor(
    public readonly code: string,
    message = code
  ) {
    super(message);
  }
}

type LogicalConnection = {
  connectionId: string;
  ownerKey: string;
  managerKey: string;
  destination: string;
  state: QAppReticulumState;
};

const DESTINATION_PATTERN = /^[0-9a-f]{32}$/;
const MAX_RPC_REQUEST_BYTES = 256 * 1024;
const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;
const MAX_REALTIME_MESSAGE_BYTES = 256 * 1024;
const MAX_PENDING_RPC_REQUESTS_PER_OWNER = 8;
const MAX_PENDING_RPC_REQUESTS_GLOBAL = 64;
const MAX_CONNECTIONS_PER_OWNER = 8;
const MAX_CONNECTIONS_GLOBAL = 64;

function ownerKey(owner: QAppReticulumOwner): string {
  return `${owner.tabId}\u0000${owner.service}\u0000${owner.name}`;
}

function encodePayload(
  payload: unknown,
  limit: number
): {
  payloadBase64: string;
  encoding: 'json' | 'base64';
} {
  const bytes =
    payload instanceof Uint8Array
      ? Buffer.from(payload)
      : Buffer.from(JSON.stringify(payload ?? null), 'utf8');
  if (bytes.byteLength > limit) {
    throw new QAppReticulumError('RNS_MESSAGE_TOO_LARGE');
  }
  return {
    payloadBase64: bytes.toString('base64'),
    encoding: payload instanceof Uint8Array ? 'base64' : 'json',
  };
}

function decodePayload(payload: Record<string, unknown>): unknown {
  const encoded = String(payload.payloadBase64 ?? '');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength > MAX_RPC_RESPONSE_BYTES) {
    throw new QAppReticulumError('RNS_RESPONSE_TOO_LARGE');
  }
  return payload.encoding === 'base64'
    ? new Uint8Array(bytes)
    : JSON.parse(bytes.toString('utf8'));
}

export class QAppReticulumManager extends EventEmitter {
  private readonly connections = new Map<string, LogicalConnection>();
  private readonly connectionsByOwner = new Map<string, Set<string>>();
  private readonly pendingRequestsByOwner = new Map<string, number>();
  private pendingRequestCount = 0;
  private readonly detachTransport: () => void;

  constructor(private readonly transport: QAppReticulumTransport) {
    super();
    this.detachTransport = transport.onEvent((event) =>
      this.handleTransportEvent(event)
    );
  }

  async request(
    owner: QAppReticulumOwner,
    options: {
      destination: string;
      path: string;
      payload?: unknown;
      timeoutMs?: number;
      maxResponseBytes?: number;
      requestId?: string;
      /** Main-process binding for reserved RPCs on an owned logical session. */
      connectionId?: string;
    }
  ): Promise<unknown> {
    const destination = this.validateDestination(options.destination);
    if (options.connectionId) {
      const connection = this.requireOwned(owner, options.connectionId);
      if (connection.destination !== destination) {
        throw new QAppReticulumError('RNS_PERMISSION_DENIED');
      }
    }
    const path = String(options.path ?? '').trim();
    if (!path.startsWith('/') || path.length > 512) {
      throw new QAppReticulumError(
        'RNS_PROTOCOL_ERROR',
        'Invalid request path'
      );
    }
    const key = ownerKey(owner);
    const pending = this.pendingRequestsByOwner.get(key) ?? 0;
    if (
      pending >= MAX_PENDING_RPC_REQUESTS_PER_OWNER ||
      this.pendingRequestCount >= MAX_PENDING_RPC_REQUESTS_GLOBAL
    ) {
      throw new QAppReticulumError('RNS_SEND_QUEUE_FULL');
    }
    this.pendingRequestsByOwner.set(key, pending + 1);
    this.pendingRequestCount += 1;
    try {
      const encoded = encodePayload(options.payload, MAX_RPC_REQUEST_BYTES);
      const result = await this.transport.invoke('qapp_rns_request', {
        managerKey: this.managerKey(owner, destination),
        destination,
        path,
        ...encoded,
        timeoutMs: Math.min(
          Math.max(options.timeoutMs ?? 30_000, 1_000),
          120_000
        ),
        maxResponseBytes: Math.min(
          Math.max(options.maxResponseBytes ?? MAX_RPC_RESPONSE_BYTES, 1),
          MAX_RPC_RESPONSE_BYTES
        ),
        requestId: String(options.requestId ?? randomUUID()),
        logicalConnectionId: options.connectionId,
      });
      if (!result.ok || !result.payload) {
        throw new QAppReticulumError(result.code ?? 'RNS_REQUEST_TIMEOUT');
      }
      return decodePayload(result.payload);
    } finally {
      this.releasePendingRequest(key);
    }
  }

  async connect(
    owner: QAppReticulumOwner,
    destinationValue: string
  ): Promise<{ connectionId: string; state: QAppReticulumState }> {
    const destination = this.validateDestination(destinationValue);
    const connectionId = `rns-${randomUUID()}`;
    const key = ownerKey(owner);
    if (
      (this.connectionsByOwner.get(key)?.size ?? 0) >=
        MAX_CONNECTIONS_PER_OWNER ||
      this.connections.size >= MAX_CONNECTIONS_GLOBAL
    ) {
      throw new QAppReticulumError('RNS_SEND_QUEUE_FULL');
    }
    const connection: LogicalConnection = {
      connectionId,
      ownerKey: key,
      managerKey: this.managerKey(owner, destination),
      destination,
      state: 'CONNECTING',
    };
    this.connections.set(connectionId, connection);
    const owned = this.connectionsByOwner.get(key) ?? new Set<string>();
    owned.add(connectionId);
    this.connectionsByOwner.set(key, owned);
    let result: Awaited<ReturnType<QAppReticulumTransport['invoke']>>;
    try {
      result = await this.transport.invoke('qapp_rns_connect', {
        managerKey: connection.managerKey,
        connectionId,
        destination,
      });
    } catch (error) {
      this.removeConnection(connection);
      throw error;
    }
    if (!result.ok) {
      this.removeConnection(connection);
      throw new QAppReticulumError(
        result.code ?? 'RNS_DESTINATION_UNREACHABLE'
      );
    }
    if (this.connections.get(connectionId) !== connection) {
      // A reload/close may have removed ownership while native setup waited.
      // Also close a late native success, never hand out a dead connection ID.
      void this.transport
        .invoke('qapp_rns_close', {
          managerKey: connection.managerKey,
          connectionId,
        })
        .catch(() => undefined);
      throw new QAppReticulumError('RNS_CONNECTION_CLOSED');
    }
    if (connection.state !== 'CONNECTING' && connection.state !== 'CONNECTED') {
      this.removeConnection(connection);
      void this.transport
        .invoke('qapp_rns_close', {
          managerKey: connection.managerKey,
          connectionId,
        })
        .catch(() => undefined);
      throw new QAppReticulumError('RNS_CONNECTION_CLOSED');
    }
    connection.state = 'CONNECTED';
    return { connectionId, state: 'CONNECTED' };
  }

  async send(
    owner: QAppReticulumOwner,
    connectionId: string,
    payload: unknown
  ): Promise<{ messageId: string }> {
    const connection = this.requireOwned(owner, connectionId);
    if (
      connection.state !== 'CONNECTED' &&
      connection.state !== 'RECONNECTING'
    ) {
      throw new QAppReticulumError('RNS_CONNECTION_CLOSED');
    }
    const encoded = encodePayload(payload, MAX_REALTIME_MESSAGE_BYTES);
    const envelopeBytes = Buffer.byteLength(
      JSON.stringify({
        connectionId,
        payloadBase64: encoded.payloadBase64,
        encoding: encoded.encoding,
      }),
      'utf8'
    );
    if (envelopeBytes > MAX_REALTIME_MESSAGE_BYTES) {
      throw new QAppReticulumError('RNS_MESSAGE_TOO_LARGE');
    }
    const result = await this.transport.invoke('qapp_rns_send', {
      managerKey: connection.managerKey,
      connectionId,
      ...encoded,
    });
    if (!result.ok) {
      throw new QAppReticulumError(result.code ?? 'RNS_SEND_QUEUE_FULL');
    }
    return { messageId: String(result.payload?.messageId ?? '') };
  }

  async close(owner: QAppReticulumOwner, connectionId: string): Promise<void> {
    const connection = this.requireOwned(owner, connectionId);
    connection.state = 'CLOSING';
    this.emit('event', {
      ownerKey: connection.ownerKey,
      connectionId,
      action: 'RNS_CONNECTION_STATE',
      state: 'CLOSING',
    });
    this.removeConnection(connection);
    await this.transport.invoke('qapp_rns_close', {
      managerKey: connection.managerKey,
      connectionId,
    });
    this.emit('event', {
      ownerKey: connection.ownerKey,
      connectionId,
      action: 'RNS_CONNECTION_STATE',
      state: 'CLOSED',
    });
  }

  async cleanupOwner(owner: QAppReticulumOwner): Promise<void> {
    const key = ownerKey(owner);
    const ids = [...(this.connectionsByOwner.get(key) ?? [])];
    await Promise.allSettled(ids.map((id) => this.close(owner, id)));
  }

  connectionOwnership(
    owner: QAppReticulumOwner,
    connectionIdValue: unknown
  ): QAppReticulumConnectionOwnership {
    const connectionId =
      typeof connectionIdValue === 'string' ? connectionIdValue : '';
    const connection = this.connections.get(connectionId);
    if (!connection) return 'missing';
    if (connection.ownerKey !== ownerKey(owner)) return 'not-owned';
    return connection.state === 'CONNECTED' ||
      connection.state === 'RECONNECTING'
      ? 'owned'
      : 'missing';
  }

  /** Electron-main-only lookup used by reserved authenticated services. */
  connectionDestination(
    owner: QAppReticulumOwner,
    connectionId: string
  ): string {
    return this.requireOwned(owner, connectionId).destination;
  }

  destroy(): void {
    this.detachTransport();
    this.connections.clear();
    this.connectionsByOwner.clear();
    this.pendingRequestsByOwner.clear();
    this.pendingRequestCount = 0;
  }

  private handleTransportEvent(event: QAppReticulumNativeEvent): void {
    const connectionId = String(event.connectionId ?? '');
    const connection = this.connections.get(connectionId);
    if (!connection || connection.managerKey !== event.managerKey) return;
    if (event.kind === 'state' && event.state) {
      connection.state = event.state;
      this.emit('event', {
        ownerKey: connection.ownerKey,
        connectionId,
        action: 'RNS_CONNECTION_STATE',
        state: event.state,
        reason: event.reason,
      });
      return;
    }
    if (event.kind === 'message' && typeof event.payloadBase64 === 'string') {
      this.emit('event', {
        ownerKey: connection.ownerKey,
        connectionId,
        action: 'RNS_MESSAGE',
        payload: decodePayload(event as unknown as Record<string, unknown>),
      });
    }
  }

  private requireOwned(
    owner: QAppReticulumOwner,
    connectionId: string
  ): LogicalConnection {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.ownerKey !== ownerKey(owner)) {
      throw new QAppReticulumError('RNS_INVALID_CONNECTION');
    }
    return connection;
  }

  private removeConnection(connection: LogicalConnection): void {
    this.connections.delete(connection.connectionId);
    const owned = this.connectionsByOwner.get(connection.ownerKey);
    owned?.delete(connection.connectionId);
    if (owned?.size === 0) this.connectionsByOwner.delete(connection.ownerKey);
  }

  private releasePendingRequest(key: string): void {
    const pending = this.pendingRequestsByOwner.get(key) ?? 0;
    if (pending <= 0) return;
    if (pending === 1) this.pendingRequestsByOwner.delete(key);
    else this.pendingRequestsByOwner.set(key, pending - 1);
    this.pendingRequestCount = Math.max(0, this.pendingRequestCount - 1);
  }

  private managerKey(owner: QAppReticulumOwner, destination: string): string {
    return `${ownerKey(owner)}\u0000${destination}`;
  }

  private validateDestination(destinationValue: string): string {
    const destination = String(destinationValue ?? '')
      .trim()
      .toLowerCase();
    if (!DESTINATION_PATTERN.test(destination)) {
      throw new QAppReticulumError('RNS_DESTINATION_UNREACHABLE');
    }
    return destination;
  }
}

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type {
  QAppReticulumConnectionOwnership,
  QAppReticulumOwner,
} from './qapp-reticulum-manager';

export type PrivateChannelPurpose = 'game' | 'file-transfer' | 'realtime';
export type PrivateChannelLane = 'reliable' | 'datagram';
export type PrivateChannelState = 'OPENING' | 'OPEN' | 'CLOSING' | 'CLOSED';

export const PRIVATE_CHANNEL_LIMITS = Object.freeze({
  // Logical channels are intentionally scarce until a real transport exists.
  maxChannelsPerOwner: 4,
  maxChannelsGlobal: 32,
  // JSON stays small; opaque binary messages have separate keyed-stream budgets.
  maxMessageBytes: 64 * 1024,
  maxBinaryMessageBytes: 1024 * 1024 - 1,
  maxQueuedBytesPerChannel: 256 * 1024,
  maxQueuedBytesPerOwner: 512 * 1024,
});

export const PRIVATE_CHANNEL_FEATURES = Object.freeze({
  reliableStreams: true,
  reliableMessages: true,
  datagrams: true,
  maxMessageBytes: PRIVATE_CHANNEL_LIMITS.maxMessageBytes,
  maxBinaryMessageBytes: PRIVATE_CHANNEL_LIMITS.maxBinaryMessageBytes,
});

export class PrivateChannelError extends Error {
  constructor(
    public readonly code: string,
    message = code
  ) {
    super(message);
  }
}

export type PrivateTransportMessage = {
  streamKey?: string;
  endStream?: boolean;
  lane: PrivateChannelLane;
  messageId: string;
  data: unknown;
};

export type PrivateTransportEvent =
  | ({ kind: 'message' } & PrivateTransportMessage)
  | { kind: 'error'; code: string; message?: string };

export type PrivateTransportContext = {
  channelId: string;
  rnsConnectionId: string;
  purpose: PrivateChannelPurpose;
  generation: number;
  owner: QAppReticulumOwner;
};

/** Transport-neutral seam for the future native QUIC/MASQUE implementation. */
export interface PrivateTransport {
  open(context: PrivateTransportContext): Promise<void>;
  sendReliable(message: PrivateTransportMessage): Promise<void>;
  sendDatagram(message: PrivateTransportMessage): Promise<void>;
  close(): Promise<void>;
}

export type PrivateTransportFactory = (
  emit: (event: PrivateTransportEvent) => void
) => PrivateTransport;

/** Step-1 transport: acknowledges sends by echoing them back in memory. */
export class MockPrivateTransport implements PrivateTransport {
  private openState = false;

  constructor(private readonly emit: (event: PrivateTransportEvent) => void) {}

  async open(_context: PrivateTransportContext): Promise<void> {
    this.openState = true;
  }

  async sendReliable(message: PrivateTransportMessage): Promise<void> {
    this.send(message);
  }

  async sendDatagram(message: PrivateTransportMessage): Promise<void> {
    this.send(message);
  }

  async close(): Promise<void> {
    this.openState = false;
  }

  private send(message: PrivateTransportMessage): void {
    if (!this.openState) throw new PrivateChannelError('CHANNEL_CLOSED');
    this.emit({ kind: 'message', ...message });
  }
}

type ChannelRecord = {
  channelId: string;
  ownerKey: string;
  rnsConnectionId: string;
  purpose: PrivateChannelPurpose;
  state: PrivateChannelState;
  createdAt: number;
  queuedBytes: number;
  generation: number;
  transport: PrivateTransport;
};

type ClosedChannel = { ownerKey: string; purpose: PrivateChannelPurpose };

const VALID_PURPOSES = new Set<PrivateChannelPurpose>([
  'game',
  'file-transfer',
  'realtime',
]);
const VALID_LANES = new Set<PrivateChannelLane>(['reliable', 'datagram']);
const MAX_MESSAGE_ID_LENGTH = 128;
const MAX_CLOSED_CHANNEL_TOMBSTONES = 256;

export function privateChannelOwnerKey(owner: QAppReticulumOwner): string {
  if (
    !owner ||
    typeof owner.tabId !== 'string' ||
    !owner.tabId ||
    owner.tabId.length > 128 ||
    typeof owner.name !== 'string' ||
    !owner.name ||
    owner.name.length > 128 ||
    owner.name !== owner.name.trim().toLowerCase() ||
    typeof owner.service !== 'string' ||
    owner.service !== owner.service.trim().toUpperCase() ||
    !/^[A-Z0-9_]{1,32}$/.test(owner.service)
  ) {
    throw new PrivateChannelError('PERMISSION_DENIED');
  }
  return `${owner.tabId}\u0000${owner.service}\u0000${owner.name}`;
}

function byteLength(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data, 'utf8');
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (
    typeof SharedArrayBuffer !== 'undefined' &&
    data instanceof SharedArrayBuffer
  ) {
    throw new PrivateChannelError('INVALID_MESSAGE');
  }
  try {
    validateJsonValue(data, new WeakSet<object>(), 0);
    const serialized = JSON.stringify(data ?? null);
    if (serialized === undefined) throw new Error('not serializable');
    return Buffer.byteLength(serialized, 'utf8');
  } catch {
    throw new PrivateChannelError('INVALID_MESSAGE');
  }
}

function validateJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number
): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (depth >= 32 || typeof value !== 'object') {
    throw new PrivateChannelError('INVALID_MESSAGE');
  }
  const object = value as object;
  const prototype = Object.getPrototypeOf(object);
  if (!Array.isArray(object) && prototype !== Object.prototype) {
    throw new PrivateChannelError('INVALID_MESSAGE');
  }
  if (ancestors.has(object)) throw new PrivateChannelError('INVALID_MESSAGE');
  ancestors.add(object);
  const children = Array.isArray(object)
    ? object
    : Object.values(object as Record<string, unknown>);
  for (const child of children) {
    validateJsonValue(child, ancestors, depth + 1);
  }
  ancestors.delete(object);
}

export class PrivateChannelManager extends EventEmitter {
  private readonly queuedBytesByStream = new Map<string, number>();
  private readonly bulkQueued = new Map<string, number>();
  private readonly channels = new Map<string, ChannelRecord>();
  private readonly channelsByOwner = new Map<string, Set<string>>();
  private readonly queuedBytesByOwner = new Map<string, number>();
  private readonly closedChannels = new Map<string, ClosedChannel>();

  constructor(
    private readonly getRnsConnectionOwnership: (
      owner: QAppReticulumOwner,
      connectionId: string
    ) => QAppReticulumConnectionOwnership,
    private readonly transportFactory: PrivateTransportFactory = (emit) =>
      new MockPrivateTransport(emit)
  ) {
    super();
  }

  async open(
    owner: QAppReticulumOwner,
    rnsConnectionIdValue: unknown,
    purposeValue: unknown
  ) {
    const key = privateChannelOwnerKey(owner);
    const rnsConnectionId =
      typeof rnsConnectionIdValue === 'string'
        ? rnsConnectionIdValue.trim()
        : '';
    if (!rnsConnectionId) {
      throw new PrivateChannelError('INVALID_RNS_CONNECTION');
    }
    const ownership = this.getRnsConnectionOwnership(owner, rnsConnectionId);
    if (ownership === 'missing') {
      throw new PrivateChannelError('INVALID_RNS_CONNECTION');
    }
    if (ownership !== 'owned') {
      throw new PrivateChannelError('RNS_CONNECTION_NOT_OWNED');
    }
    if (
      typeof purposeValue !== 'string' ||
      !VALID_PURPOSES.has(purposeValue as PrivateChannelPurpose)
    ) {
      throw new PrivateChannelError('INVALID_PURPOSE');
    }
    if (
      (this.channelsByOwner.get(key)?.size ?? 0) >=
        PRIVATE_CHANNEL_LIMITS.maxChannelsPerOwner ||
      this.channels.size >= PRIVATE_CHANNEL_LIMITS.maxChannelsGlobal
    ) {
      throw new PrivateChannelError('CHANNEL_LIMIT_REACHED');
    }

    const purpose = purposeValue as PrivateChannelPurpose;
    const channelId = `private-${randomUUID()}`;
    const generation = 1;
    const transport = this.transportFactory((event) =>
      this.handleTransportEvent(channelId, generation, event)
    );
    const channel: ChannelRecord = {
      channelId,
      ownerKey: key,
      rnsConnectionId,
      purpose,
      state: 'OPENING',
      createdAt: Date.now(),
      queuedBytes: 0,
      generation,
      transport,
    };
    this.channels.set(channelId, channel);
    const owned = this.channelsByOwner.get(key) ?? new Set<string>();
    owned.add(channelId);
    this.channelsByOwner.set(key, owned);

    try {
      await transport.open({
        channelId,
        rnsConnectionId,
        purpose,
        generation,
        owner,
      });
      if (
        this.channels.get(channelId) !== channel ||
        channel.state !== 'OPENING'
      ) {
        throw new PrivateChannelError('CHANNEL_CLOSED');
      }
      channel.state = 'OPEN';
      this.emitState(channel, 'OPEN');
      return this.safeStatus(channel);
    } catch (error) {
      this.removeChannel(channel);
      void transport.close().catch(() => undefined);
      if (error instanceof PrivateChannelError) throw error;
      throw new PrivateChannelError('CHANNEL_OPEN_FAILED');
    }
  }

  async send(
    owner: QAppReticulumOwner,
    channelIdValue: unknown,
    laneValue: unknown,
    messageIdValue: unknown,
    data: unknown,
    streamOptions?: unknown
  ): Promise<{ channelId: string; messageId: string; accepted: true }> {
    const channelId = this.validateChannelId(channelIdValue);
    const channel = this.requireOwned(owner, channelId, true);
    if (channel.state !== 'OPEN') {
      throw new PrivateChannelError('CHANNEL_CLOSED');
    }
    if (
      typeof laneValue !== 'string' ||
      !VALID_LANES.has(laneValue as PrivateChannelLane)
    ) {
      throw new PrivateChannelError('INVALID_LANE');
    }
    const messageId =
      typeof messageIdValue === 'string' ? messageIdValue.trim() : '';
    if (!messageId || messageId.length > MAX_MESSAGE_ID_LENGTH) {
      throw new PrivateChannelError('INVALID_MESSAGE_ID');
    }
    const size = byteLength(data);
    const largeBinary =
      size > PRIVATE_CHANNEL_LIMITS.maxMessageBytes &&
      (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) &&
      laneValue === 'reliable';
    if (
      size >
      (largeBinary
        ? PRIVATE_CHANNEL_LIMITS.maxBinaryMessageBytes
        : PRIVATE_CHANNEL_LIMITS.maxMessageBytes)
    ) {
      throw new PrivateChannelError('MESSAGE_TOO_LARGE');
    }
    const ownerQueued = this.queuedBytesByOwner.get(channel.ownerKey) ?? 0;
    if (
      !largeBinary &&
      (channel.queuedBytes + size >
        PRIVATE_CHANNEL_LIMITS.maxQueuedBytesPerChannel ||
        ownerQueued + size > PRIVATE_CHANNEL_LIMITS.maxQueuedBytesPerOwner)
    ) {
      throw new PrivateChannelError('QUEUE_LIMIT_REACHED');
    }

    const lane = laneValue as PrivateChannelLane;
    let streamKey: string | undefined;
    let endStream: boolean | undefined;
    if (streamOptions !== undefined) {
      const o = streamOptions as { streamKey?: unknown; endStream?: unknown };
      if (
        !o ||
        typeof o !== 'object' ||
        Array.isArray(o) ||
        lane !== 'reliable' ||
        typeof o.streamKey !== 'string' ||
        !/^[A-Za-z0-9._-]{1,96}$/.test(o.streamKey) ||
        (o.endStream !== undefined && typeof o.endStream !== 'boolean')
      )
        throw new PrivateChannelError('INVALID_STREAM_OPTIONS');
      streamKey = o.streamKey;
      endStream = o.endStream === true;
    }
    const message = { lane, messageId, data, streamKey, endStream };
    if (largeBinary) {
      if (!streamKey) throw new PrivateChannelError('INVALID_STREAM_OPTIONS');
      const budgets: Array<[string, number]> = [
        ['global', 32 * 1024 * 1024],
        [`owner:${channel.ownerKey}`, 8 * 1024 * 1024],
        [`channel:${channelId}`, 4 * 1024 * 1024],
        [`stream:${channelId}:${streamKey}`, 2 * 1024 * 1024],
      ];
      if (
        budgets.some(
          ([key, limit]) => (this.bulkQueued.get(key) ?? 0) + size > limit
        )
      )
        throw new PrivateChannelError('QUEUE_LIMIT_REACHED');
      for (const [key] of budgets)
        this.bulkQueued.set(key, (this.bulkQueued.get(key) ?? 0) + size);
      try {
        await channel.transport.sendReliable(message);
        return { channelId, messageId, accepted: true };
      } catch (error) {
        if (error instanceof PrivateChannelError) throw error;
        throw new PrivateChannelError('CHANNEL_SEND_FAILED');
      } finally {
        for (const [key] of budgets) {
          const left = (this.bulkQueued.get(key) ?? 0) - size;
          if (left > 0) this.bulkQueued.set(key, left);
          else this.bulkQueued.delete(key);
        }
      }
    }
    const queueKey = `${channelId}\0${streamKey ?? ''}`;
    const streamBytes = this.queuedBytesByStream.get(queueKey) ?? 0;
    if (streamKey && streamBytes + size > 192 * 1024)
      throw new PrivateChannelError('QUEUE_LIMIT_REACHED');
    this.queuedBytesByStream.set(queueKey, streamBytes + size);
    channel.queuedBytes += size;
    this.queuedBytesByOwner.set(channel.ownerKey, ownerQueued + size);
    try {
      if (lane === 'reliable') await channel.transport.sendReliable(message);
      else await channel.transport.sendDatagram(message);
      return { channelId, messageId, accepted: true };
    } catch (error) {
      if (error instanceof PrivateChannelError) throw error;
      throw new PrivateChannelError('CHANNEL_SEND_FAILED');
    } finally {
      const remainingStream = Math.max(
        0,
        (this.queuedBytesByStream.get(queueKey) ?? 0) - size
      );
      if (remainingStream)
        this.queuedBytesByStream.set(queueKey, remainingStream);
      else this.queuedBytesByStream.delete(queueKey);
      channel.queuedBytes = Math.max(0, channel.queuedBytes - size);
      const remaining = Math.max(
        0,
        (this.queuedBytesByOwner.get(channel.ownerKey) ?? 0) - size
      );
      if (remaining === 0) this.queuedBytesByOwner.delete(channel.ownerKey);
      else this.queuedBytesByOwner.set(channel.ownerKey, remaining);
    }
  }

  status(owner: QAppReticulumOwner, channelIdValue: unknown) {
    const channelId = this.validateChannelId(channelIdValue);
    const channel = this.requireOwned(owner, channelId, false);
    if (channel) return this.safeStatus(channel);
    const closed = this.closedChannels.get(channelId)!;
    return {
      channelId,
      state: 'CLOSED' as const,
      purpose: closed.purpose,
      features: PRIVATE_CHANNEL_FEATURES,
      queuedBytes: 0,
    };
  }

  async close(owner: QAppReticulumOwner, channelIdValue: unknown) {
    const channelId = this.validateChannelId(channelIdValue);
    const channel = this.requireOwned(owner, channelId, false);
    if (!channel) {
      return { channelId, state: 'CLOSED' as const };
    }
    channel.state = 'CLOSING';
    this.emitState(channel, 'CLOSING');
    this.removeChannel(channel);
    this.rememberClosed(channel);
    try {
      await channel.transport.close();
    } catch {
      // The logical handle is invalid even if transport teardown fails.
    }
    this.emitState(channel, 'CLOSED');
    return { channelId, state: 'CLOSED' as const };
  }

  async cleanupOwner(owner: QAppReticulumOwner): Promise<void> {
    const key = privateChannelOwnerKey(owner);
    const ids = [...(this.channelsByOwner.get(key) ?? [])];
    await Promise.allSettled(ids.map((id) => this.close(owner, id)));
  }

  async cleanupRnsConnection(
    owner: QAppReticulumOwner,
    rnsConnectionId: string
  ): Promise<void> {
    const key = privateChannelOwnerKey(owner);
    const ids = [...(this.channelsByOwner.get(key) ?? [])].filter(
      (id) => this.channels.get(id)?.rnsConnectionId === rnsConnectionId
    );
    await Promise.allSettled(ids.map((id) => this.close(owner, id)));
  }

  destroy(): void {
    for (const channel of this.channels.values()) {
      channel.state = 'CLOSED';
      void channel.transport.close().catch(() => undefined);
    }
    this.channels.clear();
    this.channelsByOwner.clear();
    this.queuedBytesByOwner.clear();
    this.closedChannels.clear();
    this.removeAllListeners();
  }

  private handleTransportEvent(
    channelId: string,
    generation: number,
    event: PrivateTransportEvent
  ): void {
    const channel = this.channels.get(channelId);
    if (
      !channel ||
      channel.state !== 'OPEN' ||
      channel.generation !== generation
    ) {
      return;
    }
    if (event.kind === 'message') {
      let size: number;
      try {
        size = byteLength(event.data);
      } catch {
        this.failTransport(channel);
        return;
      }
      if (
        size >
          (event.lane === 'reliable' &&
          (event.data instanceof ArrayBuffer || ArrayBuffer.isView(event.data))
            ? PRIVATE_CHANNEL_LIMITS.maxBinaryMessageBytes
            : PRIVATE_CHANNEL_LIMITS.maxMessageBytes) ||
        !VALID_LANES.has(event.lane) ||
        !event.messageId ||
        event.messageId.length > MAX_MESSAGE_ID_LENGTH
      ) {
        this.failTransport(channel);
        return;
      }
      this.emit('event', {
        ownerKey: channel.ownerKey,
        channelId,
        action: 'PRIVATE_CHANNEL_MESSAGE',
        lane: event.lane,
        messageId: event.messageId,
        data: event.data,
      });
      return;
    }
    this.failTransport(channel);
  }

  private emitTransportError(channel: ChannelRecord): void {
    this.emit('event', {
      ownerKey: channel.ownerKey,
      channelId: channel.channelId,
      action: 'PRIVATE_CHANNEL_ERROR',
      code: 'TRANSPORT_ERROR',
      message: 'Private channel transport error',
    });
  }

  private failTransport(channel: ChannelRecord): void {
    if (this.channels.get(channel.channelId) !== channel) return;
    this.emitTransportError(channel);
    channel.state = 'CLOSED';
    this.removeChannel(channel);
    this.rememberClosed(channel);
    this.emitState(channel, 'CLOSED');
    void channel.transport.close().catch(() => undefined);
  }

  private requireOwned(
    owner: QAppReticulumOwner,
    channelId: string,
    rejectClosed: boolean
  ): ChannelRecord | undefined {
    const key = privateChannelOwnerKey(owner);
    const channel = this.channels.get(channelId);
    if (channel) {
      if (channel.ownerKey !== key) {
        throw new PrivateChannelError('CHANNEL_NOT_OWNED');
      }
      return channel;
    }
    const closed = this.closedChannels.get(channelId);
    if (closed) {
      if (closed.ownerKey !== key) {
        throw new PrivateChannelError('CHANNEL_NOT_OWNED');
      }
      if (rejectClosed) throw new PrivateChannelError('CHANNEL_CLOSED');
      return undefined;
    }
    throw new PrivateChannelError('INVALID_CHANNEL');
  }

  private validateChannelId(value: unknown): string {
    if (typeof value !== 'string' || !value.startsWith('private-')) {
      throw new PrivateChannelError('INVALID_CHANNEL');
    }
    return value;
  }

  private safeStatus(channel: ChannelRecord) {
    return {
      channelId: channel.channelId,
      state: channel.state,
      purpose: channel.purpose,
      features: PRIVATE_CHANNEL_FEATURES,
      queuedBytes: channel.queuedBytes,
    };
  }

  private emitState(channel: ChannelRecord, state: PrivateChannelState): void {
    this.emit('event', {
      ownerKey: channel.ownerKey,
      channelId: channel.channelId,
      action: 'PRIVATE_CHANNEL_STATE',
      state,
    });
  }

  private removeChannel(channel: ChannelRecord): void {
    this.channels.delete(channel.channelId);
    const owned = this.channelsByOwner.get(channel.ownerKey);
    owned?.delete(channel.channelId);
    if (owned?.size === 0) this.channelsByOwner.delete(channel.ownerKey);
  }

  private rememberClosed(channel: ChannelRecord): void {
    this.closedChannels.set(channel.channelId, {
      ownerKey: channel.ownerKey,
      purpose: channel.purpose,
    });
    while (this.closedChannels.size > MAX_CLOSED_CHANNEL_TOMBSTONES) {
      const oldest = this.closedChannels.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.closedChannels.delete(oldest);
    }
  }
}

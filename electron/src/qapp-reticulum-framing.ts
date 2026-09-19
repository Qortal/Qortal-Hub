export const QAPP_RNS_PROTOCOL_VERSION = 1;
export const QAPP_RNS_HEADER_BYTES = 14;
export const QAPP_RNS_DEFAULT_MAX_FRAME_BYTES = 256 * 1024;

export enum QAppRnsFrameType {
  Data = 1,
  Ack = 2,
  Control = 3,
}

export type QAppRnsControlType = 'PING' | 'PONG' | 'CLOSE';

export type QAppRnsControl =
  | { type: 'PING' | 'PONG' }
  | { type: 'CLOSE'; connectionId: string };

export type QAppRnsFrame = {
  version: number;
  type: QAppRnsFrameType;
  messageId: bigint;
  payload: Buffer;
};

export class QAppRnsProtocolError extends Error {}

export function encodeQAppRnsFrame(
  type: QAppRnsFrameType,
  messageId: bigint,
  payload: Uint8Array,
  maxFrameBytes = QAPP_RNS_DEFAULT_MAX_FRAME_BYTES
): Buffer {
  if (!Object.values(QAppRnsFrameType).includes(type)) {
    throw new QAppRnsProtocolError('RNS_PROTOCOL_ERROR');
  }
  if (payload.byteLength > maxFrameBytes) {
    throw new QAppRnsProtocolError('RNS_MESSAGE_TOO_LARGE');
  }
  if (messageId < 0n || messageId > 0xffffffffffffffffn) {
    throw new QAppRnsProtocolError('RNS_PROTOCOL_ERROR');
  }
  const frame = Buffer.allocUnsafe(QAPP_RNS_HEADER_BYTES + payload.byteLength);
  frame.writeUInt8(QAPP_RNS_PROTOCOL_VERSION, 0);
  frame.writeUInt8(type, 1);
  frame.writeBigUInt64BE(messageId, 2);
  frame.writeUInt32BE(payload.byteLength, 10);
  Buffer.from(payload).copy(frame, QAPP_RNS_HEADER_BYTES);
  return frame;
}

export function encodeQAppRnsControl(
  type: QAppRnsControlType,
  connectionId?: string
): Buffer {
  if (type === 'CLOSE') {
    if (!connectionId || connectionId.length > 128) {
      throw new QAppRnsProtocolError('RNS_PROTOCOL_ERROR');
    }
    return Buffer.from(JSON.stringify({ type, connectionId }), 'utf8');
  }
  if (connectionId !== undefined) {
    throw new QAppRnsProtocolError('RNS_PROTOCOL_ERROR');
  }
  return Buffer.from(JSON.stringify({ type }), 'utf8');
}

export function decodeQAppRnsControl(payload: Uint8Array): QAppRnsControl {
  try {
    const value = JSON.parse(Buffer.from(payload).toString('utf8'));
    if (!value || typeof value !== 'object') {
      throw new Error('unsupported control');
    }
    if (value.type === 'CLOSE') {
      if (
        Object.keys(value).length !== 2 ||
        typeof value.connectionId !== 'string' ||
        value.connectionId.length < 1 ||
        value.connectionId.length > 128
      ) {
        throw new Error('unsupported control');
      }
      return { type: 'CLOSE', connectionId: value.connectionId };
    }
    if (
      Object.keys(value).length !== 1 ||
      (value.type !== 'PING' && value.type !== 'PONG')
    ) {
      throw new Error('unsupported control');
    }
    return { type: value.type };
  } catch {
    throw new QAppRnsProtocolError('RNS_PROTOCOL_ERROR');
  }
}

export class QAppRnsFrameParser {
  private buffered = Buffer.alloc(0);

  constructor(
    private readonly maxFrameBytes = QAPP_RNS_DEFAULT_MAX_FRAME_BYTES,
    private readonly maxReceiveBufferBytes = maxFrameBytes * 2
  ) {}

  push(chunk: Uint8Array): QAppRnsFrame[] {
    if (chunk.byteLength === 0) return [];
    if (
      this.buffered.byteLength + chunk.byteLength >
      this.maxReceiveBufferBytes
    ) {
      this.reset();
      throw new QAppRnsProtocolError('RNS_PROTOCOL_ERROR');
    }
    this.buffered = Buffer.concat([this.buffered, Buffer.from(chunk)]);
    const frames: QAppRnsFrame[] = [];
    while (this.buffered.byteLength >= QAPP_RNS_HEADER_BYTES) {
      const version = this.buffered.readUInt8(0);
      const type = this.buffered.readUInt8(1);
      const messageId = this.buffered.readBigUInt64BE(2);
      const payloadLength = this.buffered.readUInt32BE(10);
      if (version !== QAPP_RNS_PROTOCOL_VERSION) {
        this.reset();
        throw new QAppRnsProtocolError('RNS_PROTOCOL_ERROR');
      }
      if (
        ![
          QAppRnsFrameType.Data,
          QAppRnsFrameType.Ack,
          QAppRnsFrameType.Control,
        ].includes(type)
      ) {
        this.reset();
        throw new QAppRnsProtocolError('RNS_PROTOCOL_ERROR');
      }
      if (payloadLength > this.maxFrameBytes) {
        this.reset();
        throw new QAppRnsProtocolError('RNS_MESSAGE_TOO_LARGE');
      }
      const frameLength = QAPP_RNS_HEADER_BYTES + payloadLength;
      if (this.buffered.byteLength < frameLength) break;
      frames.push({
        version,
        type,
        messageId,
        payload: Buffer.from(
          this.buffered.subarray(QAPP_RNS_HEADER_BYTES, frameLength)
        ),
      });
      this.buffered = this.buffered.subarray(frameLength);
    }
    return frames;
  }

  reset(): void {
    this.buffered = Buffer.alloc(0);
  }

  get bufferedBytes(): number {
    return this.buffered.byteLength;
  }
}

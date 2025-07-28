import crypto from 'crypto';

export function encodeFramedMessage(
  type: number,
  payload: Buffer,
  id: number
): Buffer {
  const header = Buffer.from('QORT', 'ascii');
  const typeBuf = Buffer.alloc(4);
  typeBuf.writeUInt32BE(type);

  const hasId = Buffer.from([1]);
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32BE(id);

  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);

  const checksum = crypto
    .createHash('sha256')
    .update(payload)
    .digest()
    .subarray(0, 4);

  return Buffer.concat([
    header,
    typeBuf,
    hasId,
    idBuf,
    length,
    checksum,
    payload,
  ]);
}

export function parseMessage(buffer: Buffer) {
  const MIN_HEADER = 4 + 4 + 1 + 4; // Magic + Type + HasID + Data Length
  if (buffer.length < MIN_HEADER) return null;

  // Check magic
  const magic = buffer.subarray(0, 4).toString('ascii');
  if (magic !== 'QORT') return null;

  const type = buffer.readUInt32BE(4);
  const hasId = buffer.readUInt8(8);

  let offset = 9;
  let id = -1;

  if (hasId) {
    if (buffer.length < offset + 4) return null;
    id = buffer.readUInt32BE(offset);
    offset += 4;
  }

  // Payload size
  if (buffer.length < offset + 4) return null;
  const payloadLength = buffer.readUInt32BE(offset);
  offset += 4;

  if (payloadLength > 10 * 1024 * 1024) {
    throw new Error(`❌ Payload too large: ${payloadLength}`);
  }

  let checksum: Buffer = Buffer.alloc(0);
  if (payloadLength > 0) {
    // Need 4 bytes checksum + payload
    if (buffer.length < offset + 4 + payloadLength) return null;

    checksum = buffer.subarray(offset, offset + 4);
    offset += 4;

    const payload = buffer.subarray(offset, offset + payloadLength);

    const expectedChecksum = crypto
      .createHash('sha256')
      .update(payload)
      .digest()
      .subarray(0, 4);
    if (!checksum.equals(expectedChecksum)) {
      console.warn('❌ Invalid checksum, discarding message');
      return { discardBytes: offset + payloadLength };
    }

    offset += payloadLength;

    return {
      messageType: type,
      id,
      payload,
      totalLength: offset,
    };
  } else {
    // No payload, no checksum
    return {
      messageType: type,
      id,
      payload: Buffer.alloc(0),
      totalLength: offset,
    };
  }
}

export function resyncToMagic(buffer: Buffer): Buffer {
  const magicIndex = buffer.indexOf('QORT', 0, 'ascii');
  if (magicIndex === -1) {
    // No valid magic found, drop everything
    return Buffer.alloc(0);
  }
  // Drop garbage before magic
  return buffer.subarray(magicIndex);
}

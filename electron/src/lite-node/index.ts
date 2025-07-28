import net from 'net';
import crypto from 'crypto';
import { ed25519, x25519 } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import util from 'util';
import fs from 'fs';
import path from 'path';
const readFile = util.promisify(fs.readFile);

export const SEED_PEERS = ['127.0.0.1'];

export enum MessageType {
  HELLO = 0,
  CHALLENGE = 2,
  RESPONSE = 3,
  PING = 11,
}

const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
const heap = new Uint8Array(memory.buffer);
const initialBrk = 512 * 1024;
let brk = initialBrk;
const waitingQueue: any[] = [];

function sbrk(size: number) {
  const oldBrk = brk;
  if (brk + size > heap.length) {
    console.log('Not enough memory available, adding to waiting queue');
    return null;
  }
  brk += size;
  return oldBrk;
}

function processWaitingQueue() {
  let i = 0;
  while (i < waitingQueue.length) {
    const request = waitingQueue[i];
    const ptr = sbrk(request.size);
    if (ptr !== null) {
      request.resolve(ptr);
      waitingQueue.splice(i, 1);
    } else {
      i++;
    }
  }
}

function requestMemory(size: number) {
  return new Promise<number>((resolve, reject) => {
    const ptr = sbrk(size);
    if (ptr !== null) {
      resolve(ptr);
    } else {
      waitingQueue.push({ size, resolve, reject });
    }
  });
}

let wasmInstance: any = null;
let computeLock = false;

async function getWasmInstance(memory: WebAssembly.Memory) {
  if (wasmInstance) return wasmInstance;
  const filename = path.join(__dirname, './memory-pow.wasm.full');
  const buffer = await readFile(filename);
  const module = await WebAssembly.compile(buffer);
  wasmInstance = new WebAssembly.Instance(module, { env: { memory } });
  return wasmInstance;
}

function resyncToMagic(buffer: Buffer): Buffer {
  const magicIndex = buffer.indexOf('QORT', 0, 'ascii');
  if (magicIndex === -1) {
    // No valid magic found, drop everything
    return Buffer.alloc(0);
  }
  // Drop garbage before magic
  return buffer.subarray(magicIndex);
}

async function computePow(
  memory: WebAssembly.Memory,
  hashPtr: number,
  workBufferPtr: number,
  workBufferLength: number,
  difficulty: number
) {
  if (computeLock) throw new Error('Concurrent compute2 call detected');
  computeLock = true;
  try {
    const wasm = await getWasmInstance(memory);
    return wasm.exports.compute2(
      hashPtr,
      workBufferPtr,
      workBufferLength,
      difficulty
    );
  } finally {
    computeLock = false;
  }
}

function resetMemory() {
  brk = initialBrk;
  processWaitingQueue();
}

function parseMessage(buffer: Buffer) {
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

function createHelloPayload(): Buffer {
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigInt64BE(BigInt(Date.now()));

  const version = Buffer.from('qortal-5.0.2');
  const address = Buffer.from('lite-node');
  const versionLen = Buffer.alloc(4);
  const addressLen = Buffer.alloc(4);

  versionLen.writeUInt32BE(version.length);
  addressLen.writeUInt32BE(address.length);

  return Buffer.concat([timestamp, versionLen, version, addressLen, address]);
}

function createChallengePayload(
  publicKey: Uint8Array,
  challenge: Uint8Array
): Buffer {
  return Buffer.concat([Buffer.from(publicKey), Buffer.from(challenge)]);
}

function encodeFramedMessage(
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

function ed25519ToX25519Private(edSeed: Uint8Array): Uint8Array {
  const hash = sha512(edSeed);
  const h = new Uint8Array(hash);
  h[0] &= 248;
  h[31] &= 127;
  h[31] |= 64;
  return h.slice(0, 32);
}

function ed25519ToX25519Public(edPublicKey: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomery(edPublicKey);
}

export class LiteNodeClient {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);

  private edPrivateKey!: Uint8Array;
  private edPublicKey!: Uint8Array;
  private xPrivateKey!: Uint8Array;
  private xPublicKey!: Uint8Array;

  private theirEdPublicKey: Uint8Array | null = null;
  private theirXPublicKey: Uint8Array | null = null;
  private theirChallenge: Uint8Array | null = null;
  private ourChallenge = crypto.randomBytes(32);
  private pingInterval: NodeJS.Timeout | null = null;
  private pendingPingIds = new Set<number>();

  private alreadyResponded = false;

  private messageQueue: Buffer[] = [];
  private isSending: boolean = false;
  private nextMessageId: number = 1;

  constructor(
    private host: string,
    private port: number = 12392
  ) {}

  async init() {
    const edSeed = ed25519.utils.randomPrivateKey();
    const edPublicKey = ed25519.getPublicKey(edSeed);

    this.edPrivateKey = new Uint8Array(64);
    this.edPrivateKey.set(edSeed);
    this.edPrivateKey.set(edPublicKey, 32);
    this.edPublicKey = edPublicKey;

    this.xPrivateKey = ed25519ToX25519Private(edSeed);
    this.xPublicKey = x25519.getPublicKey(this.xPrivateKey);
  }

  private async computePoWNonceWasmSafe(
    input: Uint8Array,
    difficulty: number,
    workBufferLength = 2 * 1024 * 1024
  ): Promise<number> {
    try {
      resetMemory();

      const hash = crypto.createHash('sha256').update(input).digest();

      const hashPtr = sbrk(32);
      if (hashPtr === null)
        throw new Error('Unable to allocate memory for hash');
      const hashView = new Uint8Array(memory.buffer, hashPtr, 32);
      hashView.set(hash);

      const workBufferPtr = await requestMemory(workBufferLength);
      if (workBufferPtr === null)
        throw new Error('Unable to allocate memory for work buffer');

      const nonceValue = await computePow(
        memory,
        hashPtr,
        workBufferPtr,
        workBufferLength,
        difficulty
      );

      if (
        typeof nonceValue !== 'number' ||
        nonceValue < 0 ||
        !Number.isInteger(nonceValue)
      ) {
        throw new Error(`Invalid nonce computed: ${nonceValue}`);
      }

      return nonceValue;
    } catch (error) {
      console.error('❌ PoW nonce computation failed:', error);
      throw error;
    } finally {
      resetMemory();
    }
  }

  private async handleChallenge(payload: Buffer) {
    if (this.alreadyResponded) return;
    this.alreadyResponded = true;

    this.theirEdPublicKey = payload.subarray(0, 32);
    this.theirXPublicKey = ed25519ToX25519Public(this.theirEdPublicKey);
    this.theirChallenge = payload.subarray(32, 64);

    const sharedSecret = x25519.getSharedSecret(
      this.xPrivateKey,
      this.theirXPublicKey
    );
    const combined = Buffer.concat([
      Buffer.from(sharedSecret),
      this.theirChallenge,
    ]);
    const responseHash = crypto.createHash('sha256').update(combined).digest();
    console.log('🔐 responseHash (hex):', responseHash.toString('hex'));

    const hashPtr = sbrk(32);
    const hashView = new Uint8Array(memory.buffer, hashPtr, 32);
    hashView.set(responseHash);
    const difficulty = 2;

    const nonceValue = await this.computePoWNonceWasmSafe(
      responseHash,
      difficulty
    );

    const nonce = Buffer.alloc(4);
    nonce.writeUInt32BE(nonceValue);

    const responsePayload = Buffer.concat([nonce, responseHash]);
    console.log('📤 Sending RESPONSE with nonce:', nonceValue);
    console.log('🔐 Response hash:', responseHash.toString('hex'));
    console.log('🧠 Shared Secret:', Buffer.from(sharedSecret).toString('hex'));
    if (Buffer.isBuffer(this.theirChallenge)) {
      console.log(
        '📦 Challenge (Buffer):',
        this.theirChallenge.toString('hex')
      );
    } else if (this.theirChallenge instanceof Uint8Array) {
      console.log(
        '📦 Challenge (Uint8Array):',
        Buffer.from(this.theirChallenge).toString('hex')
      );
    } else {
      console.warn('📦 Challenge is not a valid buffer:', this.theirChallenge);
    }
    console.log('🔗 Combined:', combined.toString('hex'));
    console.log('🔐 SHA256(combined):', responseHash.toString('hex'));
    console.log('🧮 Difficulty:', difficulty);
    this.sendMessage(MessageType.RESPONSE, responsePayload);

    const testNonce = await this.computePoWNonceWasmSafe(
      responseHash,
      difficulty
    );

    if (testNonce !== nonceValue) {
      console.error('❌ Nonce mismatch on recomputation. Internal bug!');
    }
  }

  private async handleResponse(payload: Buffer) {
    this.startPinging();
  }

  private lastHandledPingIds = new Set<number>();

  private handlePing(id: number) {
    if (this.pendingPingIds.has(id)) {
      // This is a reply to our ping — success.
      this.pendingPingIds.delete(id);
      console.log('✅ Received PING reply for ID', id);
      return;
    }
    if (this.lastHandledPingIds.has(id)) {
      return; // Already replied to this ping
    }

    const reply = encodeFramedMessage(
      MessageType.PING,
      Buffer.from([0x00]), // Required non-empty payload
      id
    );
    this.messageQueue.push(reply);
    this.flushMessageQueue();

    this.lastHandledPingIds.add(id);
    console.log('🔁 Replied to PING with ID', id);

    // Optionally clean up old IDs to avoid memory leak
    if (this.lastHandledPingIds.size > 1000) {
      this.lastHandledPingIds.clear();
    }
  }
  async connect(): Promise<void> {
    await this.init();

    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(
        { host: this.host, port: this.port },
        () => {
          console.log(`✅ Connected to ${this.host}:${this.port}`);
          this.sendMessage(MessageType.HELLO, createHelloPayload());

          resolve();
        }
      );

      this.socket.on('data', (data: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, data]);

        while (true) {
          // 🛠 Resync to the next 'QORT' if there's garbage before it
          this.buffer = resyncToMagic(this.buffer);
          const parsed = parseMessage(this.buffer);
          if (!parsed) break;
          if ('discardBytes' in parsed) {
            this.buffer = this.buffer.subarray(parsed.discardBytes);
            continue;
          }

          const { messageType, payload, totalLength, id } = parsed;
          this.buffer = this.buffer.subarray(totalLength);

          switch (messageType) {
            case MessageType.HELLO:
              this.sendMessage(
                MessageType.CHALLENGE,
                createChallengePayload(this.edPublicKey, this.ourChallenge)
              );
              break;
            case MessageType.CHALLENGE:
              this.handleChallenge(payload);
              break;
            case MessageType.RESPONSE:
              this.handleResponse(payload);
              break;
            case MessageType.PING:
              this.handlePing(id);
              break;
            default:
              console.warn(`⚠️ Unhandled message type: ${messageType}`);
          }
        }
      });

      this.socket.on('error', (err) => {
        console.error('❌ Socket error:', err);
        reject(err);
      });

      this.socket.on('end', () => console.log('🔌 Disconnected'));
      this.socket.on('timeout', () => console.warn('⏳ Socket timeout'));
    });
  }

  private flushMessageQueue() {
    if (
      this.isSending ||
      !this.socket ||
      this.socket.destroyed ||
      !this.socket.writable
    )
      return;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue[0];
      const flushed = this.socket.write(message);
      if (!flushed) {
        this.isSending = true;
        this.socket.once('drain', () => {
          this.isSending = false;
          this.flushMessageQueue();
        });
        break;
      }
      this.messageQueue.shift();
    }
  }

  private sendMessage(type: MessageType, payload: Buffer, id?: number) {
    const messageId = id ?? this.nextMessageId++;
    const framed = encodeFramedMessage(type, payload, messageId);
    console.log('🔐 Response hash:', framed.toString('hex'));
    this.messageQueue.push(framed);
    this.flushMessageQueue();
  }

  startPinging(intervalMs: number = 5000) {
    if (this.pingInterval) clearInterval(this.pingInterval);

    this.pingInterval = setInterval(() => {
      if (!this.socket || this.socket.destroyed) {
        console.warn('⚠️ Skipping PING: socket not connected');
        return;
      }

      const id = this.nextMessageId++;
      this.pendingPingIds.add(id);
      const pingMessage = encodeFramedMessage(
        MessageType.PING,
        Buffer.from([0x00]),
        id
      );
      this.messageQueue.push(pingMessage);
      this.flushMessageQueue();

      console.log('📡 Sent PING with ID', id);
    }, intervalMs);
  }

  close() {
    this.socket?.end();
  }
}

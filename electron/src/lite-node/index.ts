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
}

async function loadWebAssembly(memory) {
  const importObject = {
    env: {
      memory: memory,
    },
  };

  const filename = path.join(__dirname, './memory-pow.wasm.full');

  try {
    const buffer = await readFile(filename);
    const module = await WebAssembly.compile(buffer);
    const instance = new WebAssembly.Instance(module, importObject);
    return instance;
  } catch (error) {
    console.error('Error loading WebAssembly module:', error);
    throw error;
  }
}

const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
const heap = new Uint8Array(memory.buffer);
const initialBrk = 512 * 1024;
let brk = initialBrk;
const waitingQueue = [];

function sbrk(size) {
  const oldBrk = brk;
  if (brk + size > heap.length) {
    console.log('Not enough memory available, adding to waiting queue');
    return null;
  }
  brk += size;
  return oldBrk;
}

function processWaitingQueue() {
  console.log('Processing waiting queue...');
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

function requestMemory(size) {
  return new Promise((resolve, reject) => {
    const ptr = sbrk(size);
    if (ptr !== null) {
      resolve(ptr);
    } else {
      waitingQueue.push({ size, resolve, reject });
    }
  });
}

interface WasmModule {
  exports: WasmExports;
}

interface WasmExports {
  compute2: (
    hashPtr: number,
    workBufferPtr: number,
    workBufferLength: number,
    difficulty: number
  ) => number;
}

const computePow = async (
  memory,
  hashPtr,
  workBufferPtr,
  workBufferLength,
  difficulty
) => {
  let response = null;

  await new Promise<void>((resolve) => {
    loadWebAssembly(memory).then((wasmModule: any) => {
      response = wasmModule.exports.compute2(
        hashPtr,
        workBufferPtr,
        workBufferLength,
        difficulty
      );
      resolve();
    });
  });

  return response;
};

function resetMemory() {
  brk = initialBrk;
  processWaitingQueue();
}

function parseMessage(buffer: Buffer) {
  if (buffer.length < 17) return null;
  if (buffer.subarray(0, 4).toString('ascii') !== 'QORT') return null;

  const messageType = buffer.readUInt32BE(4);
  const payloadLength = buffer.readUInt32BE(9);
  const checksum = buffer.subarray(13, 17);
  const payload = buffer.subarray(17, 17 + payloadLength);

  const expectedChecksum = crypto
    .createHash('sha256')
    .update(payload)
    .digest()
    .subarray(0, 4);
  if (!checksum.equals(expectedChecksum)) return null;

  return {
    messageType,
    payload,
    totalLength: 17 + payloadLength,
  };
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

function encodeFramedMessage(type: number, payload: Buffer): Buffer {
  const header = Buffer.from('QORT');
  const typeBuf = Buffer.alloc(4);
  typeBuf.writeUInt32BE(type);
  const hasId = Buffer.from([0]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const checksum = crypto
    .createHash('sha256')
    .update(payload)
    .digest()
    .subarray(0, 4);
  return Buffer.concat([header, typeBuf, hasId, length, checksum, payload]);
}

function ed25519ToX25519Private(edPrivateKey: Uint8Array): Uint8Array {
  const seed = edPrivateKey.slice(0, 32);
  const hash = sha512(seed);
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

  constructor(
    private host: string,
    private port: number = 12392
  ) {}

  async init() {
    const edSeed = ed25519.utils.randomPrivateKey();
    const edPublicKey = ed25519.getPublicKey(edSeed);

    const edPrivateKey = new Uint8Array(64);
    edPrivateKey.set(edSeed);
    edPrivateKey.set(edPublicKey, 32);

    this.edPrivateKey = edPrivateKey;
    this.edPublicKey = edPublicKey;

    this.xPrivateKey = ed25519ToX25519Private(this.edPrivateKey);
    this.xPublicKey = x25519.getPublicKey(this.xPrivateKey);
  }

  private async computePoWNonceWasmSafe(
    responseHash: Uint8Array,
    difficulty: number,
    workBufferLength: number = 2 * 1024 * 1024
  ): Promise<number> {
    try {
      if (responseHash.length !== 32)
        throw new Error('Invalid responseHash length');

      const hashPtr = sbrk(32);
      if (hashPtr === null)
        throw new Error('Unable to allocate memory for hash');

      const hashView = new Uint8Array(memory.buffer, hashPtr, 32);
      hashView.set(responseHash);

      const workBufferPtr = await requestMemory(workBufferLength);
      if (workBufferPtr === null)
        throw new Error('Unable to allocate memory for work buffer');

      const result = await computePow(
        memory,
        hashPtr,
        workBufferPtr,
        workBufferLength,
        difficulty
      );

      if (
        typeof result !== 'number' ||
        result < 0 ||
        !Number.isInteger(result)
      ) {
        throw new Error(`Invalid nonce computed: ${result}`);
      }

      return result;
    } catch (error) {
      console.error('❌ PoW nonce computation failed:', error);
      resetMemory();
      throw error;
    }
  }

  private async handleChallenge(payload: Buffer) {
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

    const powDifficulty = 2;
    const nonceValue = await this.computePoWNonceWasmSafe(
      responseHash,
      powDifficulty
    );
    const nonce = Buffer.alloc(4);
    nonce.writeUInt32BE(nonceValue);

    const responsePayload = Buffer.concat([nonce, responseHash]);

    console.log('🔨 PoW nonce computed:', nonceValue);
    console.log(
      '🔐 Shared secret (hex):',
      Buffer.from(sharedSecret).toString('hex')
    );

    this.sendMessage(MessageType.RESPONSE, responsePayload);
    resetMemory();
  }

  private async handleResponse(payload: Buffer) {
    console.log('payload', payload);
  }

  async connect(): Promise<void> {
    await this.init();

    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(
        { host: this.host, port: this.port },
        () => {
          console.log(`✅ Connected to ${this.host}:${this.port}`);
          const helloPayload = createHelloPayload();
          this.sendMessage(MessageType.HELLO, helloPayload);
          resolve();
        }
      );

      this.socket.on('data', (data: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (this.buffer.length >= 17) {
          const parsed = parseMessage(this.buffer);
          if (!parsed) break;

          const { messageType, payload, totalLength } = parsed;
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

  sendMessage(type: MessageType, payload: Buffer) {
    if (!this.socket) throw new Error('Socket not connected');
    const framed = encodeFramedMessage(type, payload);
    this.socket.write(framed);
  }

  close() {
    this.socket?.end();
  }
}

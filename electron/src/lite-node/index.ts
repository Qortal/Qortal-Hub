import net from 'net';
import crypto from 'crypto';
import { ed25519, x25519 } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';

export const SEED_PEERS = ['127.0.0.1'];

export enum MessageType {
  HELLO = 0,
  CHALLENGE = 2,
  RESPONSE = 3,
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

  private edPrivateKey: Uint8Array;
  private edPublicKey: Uint8Array;
  private xPrivateKey: Uint8Array;
  private xPublicKey: Uint8Array;

  private theirEdPublicKey: Uint8Array | null = null;
  private theirXPublicKey: Uint8Array | null = null;
  private theirChallenge: Uint8Array | null = null;
  private ourChallenge = crypto.randomBytes(32);

  constructor(
    private host: string,
    private port: number = 12392
  ) {
    const edSeed = ed25519.utils.randomPrivateKey(); // 32-byte seed
    const edPublicKey = ed25519.getPublicKey(edSeed);

    const edPrivateKey = new Uint8Array(64);
    edPrivateKey.set(edSeed);
    edPrivateKey.set(edPublicKey, 32);

    this.edPrivateKey = edPrivateKey;
    this.edPublicKey = edPublicKey;

    this.xPrivateKey = ed25519ToX25519Private(this.edPrivateKey);
    this.xPublicKey = x25519.getPublicKey(this.xPrivateKey);
  }

  private handleChallenge(payload: Buffer) {
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

    const nonce = Buffer.alloc(4);
    nonce.writeUInt32BE(0);
    const responsePayload = Buffer.concat([nonce, responseHash]);

    console.log(
      '🔐 Shared secret (hex):',
      Buffer.from(sharedSecret).toString('hex')
    );

    this.sendMessage(MessageType.RESPONSE, responsePayload);
  }

  connect(): Promise<void> {
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

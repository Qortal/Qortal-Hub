import net from 'net';
import crypto from 'crypto';
import { ed25519, x25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

import { MessageType } from './protocol/messageTypes';
import {
  createHelloPayload,
  createChallengePayload,
  createGetAccountBalancePayload,
  createGetAccountMessagePayload,
} from './protocol/payloads';

import {
  encodeFramedMessage,
  parseMessage,
  resyncToMagic,
} from './protocol/framing';

import { compute, queuedCompute } from './wasm/computePoW';
import {
  ed25519ToX25519Private,
  ed25519ToX25519Public,
} from './crypto/keyConversion';
import { handleAccount, handleAccountBalance } from './messages/handlers';
import { discoveredPeers } from './peers';
import { PeerManager } from './PeerManager';
import { isDevelopment } from './peerService';

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
  private nextMessageId: number = 1;
  private lastHandledPingIds = new Set<number>();
  private knownPeers: Set<string> = new Set();
  private remoteAddress?: string;

  public lastKnownBlockHeight: number | null = null;
  public lastKnownBlockTimestamp: number | null = null;

  constructor(
    private host: string,
    private port: number = 12392,
    private manager: PeerManager
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

  private handleDisconnect(reason: string) {
    const peerKey = `${this.host}:${this.port}`;
    console.warn(`🔌 Disconnected from ${peerKey} (${reason})`);
    this.manager.removePeer(peerKey);
    this.manager.updatePeerStats(peerKey, false);
    this.cleanupPendingRequests();
  }

  private async handleChallenge(payload: Buffer) {
    console.log('challenge');
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
    const nonceValue = await queuedCompute(responseHash, 2);

    const nonce = Buffer.alloc(4);
    nonce.writeUInt32BE(nonceValue);

    const responsePayload = Buffer.concat([nonce, responseHash]);
    this.sendMessage(MessageType.RESPONSE, responsePayload);
  }

  private handlePeerV2(payload: Buffer) {
    let offset = 0;

    const peerCount = payload.readInt32BE(offset);
    offset += 4;

    for (let i = 0; i < peerCount; i++) {
      if (offset >= payload.length) break;

      const addrLength = payload.readUInt8(offset);
      offset += 1;

      if (offset + addrLength > payload.length) break;

      const addrString = payload.toString('utf8', offset, offset + addrLength);
      offset += addrLength;

      if (!addrString || !addrString.includes(':')) continue;

      if (!discoveredPeers.has(addrString)) {
        discoveredPeers.add(addrString);
      }
    }

    // console.log(`✅ Total known peers: ${discoveredPeers.size}`);
  }

  private handleBlockSummaries(payload: Buffer) {
    const BLOCK_SIGNATURE_LENGTH = 128;
    const PUBLIC_KEY_LENGTH = 32;
    const INT_LENGTH = 4;
    const LONG_LENGTH = 8;

    const BLOCK_SUMMARY_V2_LENGTH =
      BLOCK_SIGNATURE_LENGTH + // signature
      PUBLIC_KEY_LENGTH + // minter public key
      INT_LENGTH + // online accounts count
      LONG_LENGTH + // timestamp
      INT_LENGTH + // transaction count
      BLOCK_SIGNATURE_LENGTH; // reference

    const blockSummaries: {
      height: number;
      signature: Buffer;
      minterPublicKey: Buffer;
      onlineAccountsCount: number;
      timestamp: number;
      transactionsCount: number;
      reference: Buffer;
    }[] = [];

    if (payload.length === 0) return blockSummaries;

    let offset = 0;

    const heightStart = payload.readInt32BE(offset);
    offset += 4;
    let currentHeight = heightStart;

    while (offset + BLOCK_SUMMARY_V2_LENGTH <= payload.length) {
      const signature = payload.subarray(
        offset,
        offset + BLOCK_SIGNATURE_LENGTH
      );
      offset += BLOCK_SIGNATURE_LENGTH;

      const minterPublicKey = payload.subarray(
        offset,
        offset + PUBLIC_KEY_LENGTH
      );
      offset += PUBLIC_KEY_LENGTH;

      const onlineAccountsCount = payload.readInt32BE(offset);
      offset += INT_LENGTH;

      const timestamp = payload.readBigInt64BE(offset);
      offset += LONG_LENGTH;

      const transactionsCount = payload.readInt32BE(offset);
      offset += INT_LENGTH;

      const reference = payload.subarray(
        offset,
        offset + BLOCK_SIGNATURE_LENGTH
      );
      offset += BLOCK_SIGNATURE_LENGTH;
      blockSummaries.push({
        height: currentHeight,
        signature,
        minterPublicKey,
        onlineAccountsCount,
        timestamp: Number(timestamp),
        transactionsCount,
        reference,
      });

      currentHeight++;
    }

    if (blockSummaries.length > 0) {
      const latestSummary = blockSummaries[blockSummaries.length - 1];

      this.lastKnownBlockHeight = latestSummary.height;
      this.lastKnownBlockTimestamp = latestSummary.timestamp;

      // Optionally: update peer stats in the manager
      this.manager.updatePeerChainTip?.(
        `${this.host}:${this.port}`,
        latestSummary.height,
        latestSummary.timestamp
      );
    }

    // TODO: Store or evaluate summaries to determine sync quality
  }

  private isValidIp(ip: string): boolean {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^[a-zA-Z0-9\-.]+$/.test(ip); // basic IPv4 or domain
  }

  private pendingRequests = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (reason?: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  private async handleResponse(_: Buffer) {
    console.log('received');
    const peerKey = `${this.host}:${this.port}`;

    this.manager.connectedClients.set(peerKey, this);
    this.manager.updatePeerStats(peerKey, true);
    this.startPinging();
    // const account = 'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP';

    // this.sendMessage(
    //   MessageType.GET_ACCOUNT_BALANCE,
    //   createGetAccountBalancePayload(account, 0)
    // );
    // this.sendMessage(
    //   MessageType.GET_ACCOUNT,
    //   createGetAccountMessagePayload(account)
    // );
    if (!isDevelopment) {
      this.handleGetPeers();
    }
  }

  private handlePing(id: number) {
    console.log('pingid', id);
    if (this.pendingPingIds.delete(id)) {
      console.log('pingid entered1', id);
      return;
    }
    if (this.lastHandledPingIds.has(id)) {
      console.log('pingid entered12', id);
      return;
    }

    this.sendMessage(MessageType.PING, Buffer.from([0x00]), id);
    this.lastHandledPingIds.add(id);
    if (this.lastHandledPingIds.size > 1000) this.lastHandledPingIds.clear();
  }

  private handleGetPeers() {
    this.sendMessage(MessageType.GET_PEERS, Buffer.from([0x00]));
  }

  private cleanupPendingRequests() {
    for (const [id, { reject, timeout }] of this.pendingRequests.entries()) {
      clearTimeout(timeout);
      reject(
        new Error(
          `❌ Disconnected before receiving response for message ID ${id}`
        )
      );
    }
    this.pendingRequests.clear();
  }

  async connect(): Promise<void> {
    await this.init();

    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(
        { host: this.host, port: this.port },
        () => {
          console.log(`✅ Connected to ${this.host}:${this.port}`);

          // ✅ Capture remote IP address
          this.remoteAddress = this.socket.remoteAddress ?? undefined;

          // ✅ Strip "::ffff:" if it's an IPv4-mapped IPv6
          if (this.remoteAddress?.startsWith('::ffff:')) {
            this.remoteAddress = this.remoteAddress.replace('::ffff:', '');
          }

          // ✅ Begin handshake
          this.sendMessage(MessageType.HELLO, createHelloPayload());

          resolve();
        }
      );

      this.socket.on('data', (data: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, data]);

        // eslint-disable-next-line no-constant-condition
        while (true) {
          this.buffer = resyncToMagic(this.buffer);
          const parsed = parseMessage(this.buffer);
          if (!parsed) break;
          if ('discardBytes' in parsed) {
            this.buffer = this.buffer.subarray(parsed.discardBytes);
            continue;
          }

          const { messageType, payload, totalLength, id } = parsed;
          this.buffer = this.buffer.subarray(totalLength);
          const request = this.pendingRequests.get(id);
          if (request) {
            clearTimeout(request.timeout);
            request.resolve(payload);
            this.pendingRequests.delete(id);
            return; // skip the switch block — handled as a response
          }
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
            case MessageType.ACCOUNT:
              handleAccount(payload);
              break;
            case MessageType.ACCOUNT_BALANCE:
              handleAccountBalance(payload);
              break;
            case MessageType.PEERS_V2:
              this.handlePeerV2(payload);
              break;
            case MessageType.BLOCK_SUMMARIES_V2:
              this.handleBlockSummaries(payload);
              break;
            case MessageType.ACTIVE_CHAT:
              this.handleBlockSummaries(payload);
              break;
            default: {
              if (messageType?.toString().includes('7')) {
                console.warn(
                  `⚠️ Unhandled message type: ${messageType}, ${this.host}`
                );
              }
            }
          }
        }
      });

      this.socket.on('error', (err) => {
        this.handleDisconnect('error');
      });

      this.socket.on('end', () => {
        this.handleDisconnect('end');
      });

      this.socket.on('timeout', () => {
        this.handleDisconnect('timeout');
      });
    });
  }

  public sendMessage(type: MessageType, payload: Buffer, id?: number) {
    const messageId = id ?? this.nextMessageId++;
    const framed = encodeFramedMessage(type, payload, messageId);
    this.messageQueue.push(framed);
    this.flushMessageQueue();
  }

  public sendRequest<T>(
    type: MessageType,
    payload: Buffer,
    timeoutMs = 5000
  ): Promise<T> {
    const messageId = this.nextMessageId++;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(
          new Error(
            `[${new Date().toLocaleTimeString()}]⏰ Timeout waiting for message ID ${messageId}`
          )
        );
      }, timeoutMs);

      this.pendingRequests.set(messageId, { resolve, reject, timeout });
      console.log(
        'type, payload, messageId',
        type,
        payload,
        messageId,
        this.host,
        this.port
      );
      this.sendMessage(type, payload, messageId);
    });
  }

  private flushMessageQueue() {
    if (!this.socket || this.socket.destroyed || !this.socket.writable) return;

    try {
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue[0];
        const flushed = this.socket.write(message);
        if (!flushed) {
          this.socket.once('drain', () => this.flushMessageQueue());
          break;
        }
        this.messageQueue.shift();
      }
    } catch (err) {
      console.error('flushMessageQueue error:', err);
      // Optionally emit an error or destroy the socket
      this.socket?.destroy(err as Error);
    }
  }

  startPinging(intervalMs: number = 20000) {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (!this.socket || this.socket.destroyed) return;
      const id = this.nextMessageId++;
      this.pendingPingIds.add(id);
      this.sendMessage(MessageType.PING, Buffer.from([0x00]), id);
    }, intervalMs);
  }

  close() {
    this.socket?.end();
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  destroy() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

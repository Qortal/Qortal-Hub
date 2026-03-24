/**
 * Group Call protocol for the Qortal Hub P2P network.
 *
 * Implements fully decentralized group voice call signaling on top of the
 * existing P2P mesh.  All GC_* messages are ephemeral (never stored to disk).
 *
 * Architecture (handled entirely in the renderer):
 *   - Adaptive topology: ≤10 members → single forwarder, 11-50 → hierarchical
 *   - WebRTC DataChannel for audio transport (Opus 20 kbps)
 *   - P2P GC_AUDIO relay as last-resort fallback
 *   - End-to-end encryption via nacl.secretbox with rotating room media key
 *
 * This module handles only the signaling layer:
 *   GC_JOIN / GC_LEAVE       — room membership
 *   GC_TOPOLOGY              — forwarder tree broadcast (with topologyEpoch)
 *   GC_AUDIO                 — P2P audio relay fallback
 *   GC_KEY / GC_KEY_ROTATE   — room media key distribution
 *   GC_RTC_OFFER/ANSWER/ICE  — WebRTC DataChannel signaling
 *
 * Security: GC_JOIN, GC_LEAVE, GC_TOPOLOGY, GC_KEY carry Ed25519 signatures.
 */

import { EventEmitter } from 'events';
import nacl from 'tweetnacl';
import { log as loggerLog, error as loggerError } from './logger';
import {
  deriveAddressFromPublicKey,
  canonicalizeForSigning,
  base58Decode,
} from './presence';
import type { P2PNetwork } from './p2p-network';
import type { PresenceManager } from './presence';

// ── Constants ─────────────────────────────────────────────────────────────────

const GC_MAX_HOPS = 3;
const GC_AUDIO_MAX_HOPS = 2;
const GC_JOIN_TTL_MS = 120_000;

// ── Wire types ────────────────────────────────────────────────────────────────

export type GroupCallMsgType =
  | 'GC_JOIN'
  | 'GC_LEAVE'
  | 'GC_TOPOLOGY'
  | 'GC_AUDIO'
  | 'GC_KEY'
  | 'GC_KEY_ROTATE'
  | 'GC_RTC_OFFER'
  | 'GC_RTC_ANSWER'
  | 'GC_RTC_ICE';

export const GC_MESSAGE_TYPES = new Set<string>([
  'GC_JOIN', 'GC_LEAVE', 'GC_TOPOLOGY', 'GC_AUDIO',
  'GC_KEY', 'GC_KEY_ROTATE', 'GC_RTC_OFFER', 'GC_RTC_ANSWER', 'GC_RTC_ICE',
]);

// ── Envelope shapes ───────────────────────────────────────────────────────────

export interface GcJoinEnvelope {
  type: 'GC_JOIN';
  roomId: string;
  chatId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcLeaveEnvelope {
  type: 'GC_LEAVE';
  roomId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface ClusterDef {
  members: string[];
  forwarder: string;
  standby: string;
}

export interface GcTopologyEnvelope {
  type: 'GC_TOPOLOGY';
  roomId: string;
  topologyEpoch: number;
  rootForwarder: string;
  standbyForwarder: string;
  clusters: ClusterDef[];
  /** Root's local ms timestamp — used for heartbeat tracking by peers. */
  lastSeen: number;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcAudioEnvelope {
  type: 'GC_AUDIO';
  roomId: string;
  toAddress: string;
  /** Base64-encoded encrypted Opus packet */
  data: string;
  hopsRemaining?: number;
}

export interface GcKeyEnvelope {
  type: 'GC_KEY';
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  /** Base64-encoded nacl.box-encrypted room media key */
  encryptedKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcKeyRotateEnvelope {
  type: 'GC_KEY_ROTATE';
  roomId: string;
  fromAddress: string;
  fromPublicKey: string;
  /** Base64-encoded encrypted room media keys — map of address → encryptedKey */
  encryptedKeys: Record<string, string>;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcRtcOfferEnvelope {
  type: 'GC_RTC_OFFER';
  roomId: string;
  fromAddress: string;
  toAddress: string;
  /** SDP offer string */
  sdp: string;
  /** Unique connection id to match answer */
  connId: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcRtcAnswerEnvelope {
  type: 'GC_RTC_ANSWER';
  roomId: string;
  fromAddress: string;
  toAddress: string;
  sdp: string;
  connId: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcRtcIceEnvelope {
  type: 'GC_RTC_ICE';
  roomId: string;
  fromAddress: string;
  toAddress: string;
  candidate: unknown;
  connId: string;
  hopsRemaining?: number;
}

export type GcEnvelope =
  | GcJoinEnvelope | GcLeaveEnvelope | GcTopologyEnvelope
  | GcAudioEnvelope | GcKeyEnvelope | GcKeyRotateEnvelope
  | GcRtcOfferEnvelope | GcRtcAnswerEnvelope | GcRtcIceEnvelope;

// ── Room state ────────────────────────────────────────────────────────────────

interface RoomParticipant {
  publicKey: string;
  joinedAt: number;
}

interface GroupRoom {
  roomId: string;
  chatId: string;
  participants: Map<string, RoomParticipant>;
  topologyEpoch: number;
  joinTimestamp?: number;
}

// ── Signature helpers ─────────────────────────────────────────────────────────

function verifySigned(
  fields: Record<string, unknown>,
  signature: string,
  fromPublicKey: string,
  fromAddress: string
): boolean {
  try {
    const derived = deriveAddressFromPublicKey(fromPublicKey);
    if (derived !== fromAddress) return false;
    const pkBytes = base58Decode(fromPublicKey);
    const sigBytes = base58Decode(signature);
    const msgBytes = canonicalizeForSigning(fields);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
  } catch {
    return false;
  }
}

// ── GroupCallManager ──────────────────────────────────────────────────────────

let _instance: GroupCallManager | null = null;

export function startGroupCallManager(
  p2p: P2PNetwork,
  presence: PresenceManager
): GroupCallManager {
  if (_instance) _instance.stop();
  _instance = new GroupCallManager(p2p, presence);
  _instance.start();
  return _instance;
}

export function stopGroupCallManager(): void {
  if (_instance) { _instance.stop(); _instance = null; }
}

export function getGroupCallManager(): GroupCallManager | null {
  return _instance;
}

export class GroupCallManager extends EventEmitter {
  private p2p: P2PNetwork;
  private presence: PresenceManager;
  private localAddresses = new Set<string>();
  private rooms = new Map<string, GroupRoom>();

  /** Track recent processed message IDs to prevent replay */
  private seenMsgIds = new Set<string>();
  private seenMsgIdTimer: ReturnType<typeof setInterval> | null = null;

  /** Cache address → nodeId learned from GC_JOIN, used as fallback in sendAudio */
  private participantNodeIds = new Map<string, string>();

  private presenceExpiredHandler: (address: string) => void;
  private onP2PMessage!: (payload: { id: string; from: string; data: unknown }) => void;
  private onPresenceUpdated: (({ address, online }: { address: string; online: boolean }) => void) | null = null;
  private presenceEvictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly PRESENCE_EVICTION_GRACE_MS = 30_000;

  constructor(p2p: P2PNetwork, presence: PresenceManager) {
    super();
    this.p2p = p2p;
    this.presence = presence;

    this.onP2PMessage = ({ id, from, data }: { id: string; from: string; data: unknown }) => {
      if (!data || typeof data !== 'object') return;
      const msg = data as Record<string, unknown>;
      if (!GC_MESSAGE_TYPES.has(msg.type as string)) return;
      if (id && this.seenMsgIds.has(id)) return;
      if (id) this.seenMsgIds.add(id);
      try {
        this.handleIncoming(msg as unknown as GcEnvelope, from);
      } catch (err) {
        loggerError('[GCall] Error handling message:', err);
      }
    };

    this.presenceExpiredHandler = (address: string) => {
      // Don't start a duplicate grace timer for the same address
      if (this.presenceEvictionTimers.has(address)) return;

      // Only act if this address is actually in an active room
      let inCall = false;
      for (const [, room] of this.rooms) {
        if (room.participants.has(address)) { inCall = true; break; }
      }
      if (!inCall) return;

      loggerLog(`[GCall] Presence offline for ${address} — starting ${GroupCallManager.PRESENCE_EVICTION_GRACE_MS}ms grace timer`);
      const timer = setTimeout(() => {
        this.presenceEvictionTimers.delete(address);
        // If the peer came back online during the grace window, skip eviction
        if (this.presence.isAddressOnline(address)) {
          loggerLog(`[GCall] ${address} recovered — skipping eviction`);
          return;
        }
        for (const [roomId, room] of this.rooms) {
          if (room.participants.has(address)) {
            loggerLog(`[GCall] Grace period expired for ${address} — evicting from ${roomId}`);
            this.handleLeave(roomId, address, true);
          }
        }
      }, GroupCallManager.PRESENCE_EVICTION_GRACE_MS);
      this.presenceEvictionTimers.set(address, timer);
    };
  }

  start(): void {
    // Listen for P2P messages
    this.onP2PMessage = this.onP2PMessage.bind(this);
    this.p2p.on('message', this.onP2PMessage);

    // Hook into presence-updated to detect abrupt disconnects (with grace period)
    // Store reference so stop() can properly remove it.
    this.onPresenceUpdated = ({ address, online }: { address: string; online: boolean }) => {
      if (!online) {
        this.presenceExpiredHandler(address);
      } else {
        // Peer came back online — cancel any pending eviction timer
        const timer = this.presenceEvictionTimers.get(address);
        if (timer !== undefined) {
          loggerLog(`[GCall] ${address} back online — cancelling eviction timer`);
          clearTimeout(timer);
          this.presenceEvictionTimers.delete(address);
        }
      }
    };
    this.presence.on('presence-updated', this.onPresenceUpdated);

    // Periodic cleanup of seen message IDs (every 2 minutes)
    this.seenMsgIdTimer = setInterval(() => {
      if (this.seenMsgIds.size > 10_000) this.seenMsgIds.clear();
    }, 120_000);
    this.seenMsgIdTimer.unref?.();

    loggerLog('[GCall] GroupCallManager started.');
  }

  stop(): void {
    if (this.onP2PMessage) this.p2p.off('message', this.onP2PMessage);
    if (this.onPresenceUpdated) this.presence.off('presence-updated', this.onPresenceUpdated);
    for (const timer of this.presenceEvictionTimers.values()) clearTimeout(timer);
    this.presenceEvictionTimers.clear();
    if (this.seenMsgIdTimer) { clearInterval(this.seenMsgIdTimer); this.seenMsgIdTimer = null; }
    this.participantNodeIds.clear();
    this.rooms.clear();
    loggerLog('[GCall] GroupCallManager stopped.');
  }

  setLocalAddresses(addresses: string[]): void {
    this.localAddresses = new Set(addresses);
    loggerLog(`[GCall] Local addresses set: ${[...addresses].join(', ')}`);
  }

  // ── Outbound ──────────────────────────────────────────────────────────────

  joinRoom(
    roomId: string,
    chatId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        roomId, chatId,
        participants: new Map(),
        topologyEpoch: 0,
        joinTimestamp: timestamp,
      };
      this.rooms.set(roomId, room);
    }
    room.participants.set(localAddress, { publicKey, joinedAt: timestamp });

    const env: GcJoinEnvelope = {
      type: 'GC_JOIN',
      roomId,
      chatId,
      fromAddress: localAddress,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      hopsRemaining: GC_MAX_HOPS,
    };
    this.p2p.send(null, env);
    loggerLog(`[GCall] Sent GC_JOIN for room ${roomId}`);
  }

  leaveRoom(
    roomId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ): void {
    const env: GcLeaveEnvelope = {
      type: 'GC_LEAVE',
      roomId,
      fromAddress: localAddress,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      hopsRemaining: GC_MAX_HOPS,
    };
    this.p2p.send(null, env);
    this.rooms.delete(roomId);
    loggerLog(`[GCall] Sent GC_LEAVE for room ${roomId}`);
  }

  broadcastTopology(
    roomId: string,
    topology: Omit<GcTopologyEnvelope, 'type' | 'roomId' | 'hopsRemaining'>,
    signature: string,
    publicKey: string,
    timestamp: number
  ): void {
    const env: GcTopologyEnvelope = {
      type: 'GC_TOPOLOGY',
      roomId,
      ...topology,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      hopsRemaining: GC_MAX_HOPS,
    };
    this.p2p.send(null, env);
    loggerLog(`[GCall] Sent GC_TOPOLOGY for room ${roomId} epoch ${topology.topologyEpoch}`);
  }

  sendAudio(roomId: string, toAddress: string, data: string): void {
    const env: GcAudioEnvelope = {
      type: 'GC_AUDIO',
      roomId,
      toAddress,
      data,
      hopsRemaining: GC_AUDIO_MAX_HOPS,
    };
    const nodeId = this.presence.getNodeIdForAddress(toAddress)
      ?? this.participantNodeIds.get(toAddress)
      ?? null;
    if (nodeId) {
      this.p2p.send(nodeId, env);
    } else {
      this.p2p.send(null, env);
    }
  }

  sendKey(
    roomId: string,
    toAddress: string,
    encryptedKey: string,
    fromAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ): void {
    const env: GcKeyEnvelope = {
      type: 'GC_KEY',
      roomId,
      toAddress,
      fromAddress,
      fromPublicKey: publicKey,
      encryptedKey,
      signature,
      timestamp,
      hopsRemaining: GC_MAX_HOPS,
    };
    const nodeId = this.presence.getNodeIdForAddress(toAddress);
    if (nodeId) {
      this.p2p.send(nodeId, env);
    } else {
      this.p2p.send(null, env);
    }
  }

  sendKeyRotate(
    roomId: string,
    encryptedKeys: Record<string, string>,
    fromAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ): void {
    const env: GcKeyRotateEnvelope = {
      type: 'GC_KEY_ROTATE',
      roomId,
      fromAddress,
      fromPublicKey: publicKey,
      encryptedKeys,
      signature,
      timestamp,
      hopsRemaining: GC_MAX_HOPS,
    };
    this.p2p.send(null, env);
  }

  sendRtcSignal(
    roomId: string,
    fromAddress: string,
    toAddress: string,
    type: 'offer' | 'answer' | 'ice',
    data: unknown,
    connId: string,
    signature?: string,
    publicKey?: string,
    timestamp?: number
  ): void {
    const nodeId = this.presence.getNodeIdForAddress(toAddress);
    const hops = GC_MAX_HOPS;

    if (type === 'offer') {
      const env: GcRtcOfferEnvelope = {
        type: 'GC_RTC_OFFER',
        roomId, fromAddress, toAddress, connId,
        sdp: data as string,
        fromPublicKey: publicKey ?? '',
        signature: signature ?? '',
        timestamp: timestamp ?? Date.now(),
        hopsRemaining: hops,
      };
      nodeId ? this.p2p.send(nodeId, env) : this.p2p.send(null, env);
    } else if (type === 'answer') {
      const env: GcRtcAnswerEnvelope = {
        type: 'GC_RTC_ANSWER',
        roomId, fromAddress, toAddress, connId,
        sdp: data as string,
        fromPublicKey: publicKey ?? '',
        signature: signature ?? '',
        timestamp: timestamp ?? Date.now(),
        hopsRemaining: hops,
      };
      nodeId ? this.p2p.send(nodeId, env) : this.p2p.send(null, env);
    } else {
      const env: GcRtcIceEnvelope = {
        type: 'GC_RTC_ICE',
        roomId, fromAddress, toAddress, connId,
        candidate: data,
        hopsRemaining: hops,
      };
      nodeId ? this.p2p.send(nodeId, env) : this.p2p.send(null, env);
    }
  }

  // ── Inbound ───────────────────────────────────────────────────────────────

  handleIncoming(env: GcEnvelope, fromNodeId?: string): void {
    if (!GC_MESSAGE_TYPES.has(env.type)) return;

    switch (env.type) {
      case 'GC_JOIN':      return this.handleJoin(env, fromNodeId);
      case 'GC_LEAVE':     return this.handleLeaveEnvelope(env);
      case 'GC_TOPOLOGY':  return this.handleTopology(env);
      case 'GC_AUDIO':     return this.handleAudio(env);
      case 'GC_KEY':       return this.handleKey(env);
      case 'GC_KEY_ROTATE': return this.handleKeyRotate(env);
      case 'GC_RTC_OFFER': return this.handleRtcOffer(env);
      case 'GC_RTC_ANSWER': return this.handleRtcAnswer(env);
      case 'GC_RTC_ICE':   return this.handleRtcIce(env);
    }
  }

  private handleJoin(env: GcJoinEnvelope, fromNodeId?: string): void {
    const ok = verifySigned(
      { type: env.type, roomId: env.roomId, chatId: env.chatId,
        fromAddress: env.fromAddress, fromPublicKey: env.fromPublicKey, timestamp: env.timestamp },
      env.signature, env.fromPublicKey, env.fromAddress
    );
    if (!ok) {
      loggerLog(`[GCall] Dropped GC_JOIN: invalid signature from ${env.fromAddress}`);
      return;
    }

    const now = Date.now();
    if (now - env.timestamp > GC_JOIN_TTL_MS) {
      loggerLog(`[GCall] Dropped GC_JOIN: expired from ${env.fromAddress}`);
      return;
    }

    // Cache the address → nodeId mapping for targeted audio delivery.
    if (fromNodeId) {
      this.participantNodeIds.set(env.fromAddress, fromNodeId);
    }

    // Update room state if we are in this room
    for (const [roomId, room] of this.rooms) {
      if (roomId === env.roomId) {
        if (!room.participants.has(env.fromAddress)) {
          room.participants.set(env.fromAddress, {
            publicKey: env.fromPublicKey,
            joinedAt: env.timestamp,
          });
        }
        break;
      }
    }

    // Forward to renderer if the local user is a target / in the room, or we are an agent
    for (const localAddr of this.localAddresses) {
      this.emit('gcall:participant-joined', {
        roomId: env.roomId,
        chatId: env.chatId,
        address: env.fromAddress,
        publicKey: env.fromPublicKey,
        timestamp: env.timestamp,
      });
      break;
    }

    // Relay
    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
    }
  }

  private handleLeaveEnvelope(env: GcLeaveEnvelope): void {
    const ok = verifySigned(
      { type: env.type, roomId: env.roomId,
        fromAddress: env.fromAddress, fromPublicKey: env.fromPublicKey, timestamp: env.timestamp },
      env.signature, env.fromPublicKey, env.fromAddress
    );
    if (!ok) {
      loggerLog(`[GCall] Dropped GC_LEAVE: invalid signature from ${env.fromAddress}`);
      return;
    }

    this.handleLeave(env.roomId, env.fromAddress, false);

    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
    }
  }

  private handleLeave(roomId: string, address: string, isAbrupt: boolean): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.participants.delete(address);
    }
    this.participantNodeIds.delete(address);
    this.emit('gcall:participant-left', { roomId, address, isAbrupt });
  }

  private handleTopology(env: GcTopologyEnvelope): void {
    const ok = verifySigned(
      { type: env.type, roomId: env.roomId, topologyEpoch: env.topologyEpoch,
        rootForwarder: env.rootForwarder, standbyForwarder: env.standbyForwarder,
        fromAddress: env.fromAddress, fromPublicKey: env.fromPublicKey, timestamp: env.timestamp },
      env.signature, env.fromPublicKey, env.fromAddress
    );
    if (!ok) {
      loggerLog(`[GCall] Dropped GC_TOPOLOGY: invalid signature from ${env.fromAddress}`);
      return;
    }

    // Update local epoch tracking
    const room = this.rooms.get(env.roomId);
    if (room) {
      if (env.topologyEpoch < room.topologyEpoch) {
        loggerLog(`[GCall] Dropped stale GC_TOPOLOGY epoch ${env.topologyEpoch} < ${room.topologyEpoch}`);
        return;
      }
      room.topologyEpoch = env.topologyEpoch;
    }

    this.emit('gcall:topology', {
      roomId: env.roomId,
      topologyEpoch: env.topologyEpoch,
      rootForwarder: env.rootForwarder,
      standbyForwarder: env.standbyForwarder,
      clusters: env.clusters,
      lastSeen: env.lastSeen,
    });

    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
    }
  }

  private handleAudio(env: GcAudioEnvelope): void {
    // Only deliver if addressed to a local address
    if (!this.localAddresses.has(env.toAddress)) {
      // Relay if we have hops remaining
      if ((env.hopsRemaining ?? 0) > 0) {
        const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
        if (nodeId) {
          this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
        }
      }
      return;
    }
    // Decode base64 → Buffer in the main process (Node Buffer.from is fast) so the
    // renderer receives raw binary over IPC instead of a base64 string, eliminating
    // atob + charCodeAt work from the renderer's main thread.
    this.emit('gcall:audio', { roomId: env.roomId, data: Buffer.from(env.data, 'base64') });
  }

  private handleKey(env: GcKeyEnvelope): void {
    if (!this.localAddresses.has(env.toAddress)) {
      if ((env.hopsRemaining ?? 0) > 0) {
        const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
        if (nodeId) {
          this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
        } else {
          this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
        }
      }
      return;
    }
    this.emit('gcall:key', {
      roomId: env.roomId,
      fromAddress: env.fromAddress,
      fromPublicKey: env.fromPublicKey,
      encryptedKey: env.encryptedKey,
    });
  }

  private handleKeyRotate(env: GcKeyRotateEnvelope): void {
    // Find if any local address is in the encryptedKeys map
    for (const localAddr of this.localAddresses) {
      if (env.encryptedKeys[localAddr]) {
        this.emit('gcall:key', {
          roomId: env.roomId,
          fromAddress: env.fromAddress,
          fromPublicKey: env.fromPublicKey,
          encryptedKey: env.encryptedKeys[localAddr],
        });
      }
    }

    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
    }
  }

  private handleRtcOffer(env: GcRtcOfferEnvelope): void {
    if (this.localAddresses.has(env.toAddress)) {
      this.emit('gcall:rtc-signal', { ...env, type: 'offer' });
      return;
    }
    if ((env.hopsRemaining ?? 0) > 0) {
      const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
      if (nodeId) {
        this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      } else {
        this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      }
    }
  }

  private handleRtcAnswer(env: GcRtcAnswerEnvelope): void {
    if (this.localAddresses.has(env.toAddress)) {
      this.emit('gcall:rtc-signal', { ...env, type: 'answer' });
      return;
    }
    if ((env.hopsRemaining ?? 0) > 0) {
      const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
      if (nodeId) {
        this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      } else {
        this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      }
    }
  }

  private handleRtcIce(env: GcRtcIceEnvelope): void {
    if (this.localAddresses.has(env.toAddress)) {
      this.emit('gcall:rtc-signal', { ...env, type: 'ice' });
      return;
    }
    if ((env.hopsRemaining ?? 0) > 0) {
      const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
      if (nodeId) {
        this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      } else {
        this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      }
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getRoomParticipants(roomId: string): Array<{ address: string; publicKey: string }> {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.participants.entries()].map(([address, p]) => ({ address, publicKey: p.publicKey }));
  }
}

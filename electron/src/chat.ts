/**
 * Chat protocol for the Qortal Hub P2P network.
 *
 * chatId conventions:
 *   DM:    [addrA, addrB].sort().join(':')  e.g. "Qaddr1:Qaddr2"
 *   Group: "group:" + groupId              e.g. "group:12345"
 *
 * Design (renderer signs, Node transports — mirrors presence.ts):
 *   - Renderer holds the private key and produces signed ChatEnvelopes.
 *   - Node process validates, stores locally, and relays via the P2P network.
 *   - Per-author sequence numbers drive sync on reconnect.
 *   - Storage: in-memory + one JSON file per chat (write-file-atomic, no
 *     native modules required).
 *   - Sync: on peer-connected, exchange CHAT_SUBSCRIBE + CHAT_SYNC_STATE.
 *
 * Validation rules applied to every incoming ChatEvent:
 *   1. Schema — all required fields present with correct types.
 *   2. eventType — must be a known value.
 *   3. chatId — correct format for DM or group.
 *   4. Timestamp — not in the future beyond skew tolerance.
 *   5. Content size — ≤ 10 KB.
 *   6. DM participant check — authorAddress must be one of the two DM parties.
 *   7. Address derivation — authorPublicKey must derive to authorAddress.
 *   8. Signature — valid Ed25519 detached signature over canonical fields.
 */

import * as nodeCrypto from 'crypto';
import * as pathMod from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import nacl from 'tweetnacl';
import { log as loggerLog, error as loggerError } from './logger';
import {
  deriveAddressFromPublicKey,
  canonicalizeForSigning,
  base58Decode,
} from './presence';
import type { P2PNetwork } from './p2p-network';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum events kept in memory and on disk per chat. Oldest trimmed. */
const CHAT_MAX_EVENTS_PER_CHAT = 1_000;

/** Maximum UTF-8 bytes for the content field. */
const CHAT_MAX_CONTENT_BYTES = 10_000;

/** Maximum events returned in a single CHAT_SYNC_RESPONSE. */
const CHAT_MAX_SYNC_EVENTS = 200;

/** Debounce window before flushing a chat file to disk. */
const CHAT_WRITE_DEBOUNCE_MS = 2_000;

/** Reject events dated this far into the future. */
const CHAT_MAX_FUTURE_SKEW_MS = 60_000;

/** Reject events older than this (30 days). */
const CHAT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

/** How long a typing indicator lives before auto-clearing. */
const CHAT_TYPING_TTL_MS = 8_000;

/** Max relay hops at the chat layer (independent of P2P hop counter). */
const CHAT_DEFAULT_HOPS = 4;

// ── Wire-level type discriminators ───────────────────────────────────────────

export type ChatNetworkType =
  | 'CHAT_EVENT'
  | 'CHAT_SUBSCRIBE'
  | 'CHAT_UNSUBSCRIBE'
  | 'CHAT_SYNC_STATE'
  | 'CHAT_SYNC_RESPONSE'
  | 'CHAT_TYPING';

export const CHAT_MESSAGE_TYPES = new Set<string>([
  'CHAT_EVENT',
  'CHAT_SUBSCRIBE',
  'CHAT_UNSUBSCRIBE',
  'CHAT_SYNC_STATE',
  'CHAT_SYNC_RESPONSE',
  'CHAT_TYPING',
]);

// ── Core event types ─────────────────────────────────────────────────────────

export type ChatEventType = 'message' | 'edit' | 'delete' | 'reaction';

/**
 * An immutable, signed chat event — the atomic unit of the protocol.
 * Everything in the chat system (messages, edits, deletes, reactions) is a
 * ChatEvent. Events are never mutated; edit/delete/reaction produce new events
 * that reference the original via `targetId`.
 */
export interface ChatEvent {
  /** UUID, assigned by the renderer and included in the signature. */
  id: string;
  /**
   * Identifies the conversation:
   *   DM:    [addrA, addrB].sort().join(':')
   *   Group: "group:" + numericGroupId
   */
  chatId: string;
  eventType: ChatEventType;
  /** Qortal address of the author. */
  authorAddress: string;
  /** Base58-encoded Ed25519 public key of the author. */
  authorPublicKey: string;
  /** Per-author monotonic counter within this chatId (starts at 1). */
  seq: number;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /**
   * Plaintext message body.
   * Empty string is valid for eventType 'delete'.
   */
  content: string;
  /** For threaded replies: id of the parent message. */
  replyTo?: string;
  /** For edit / delete / reaction: id of the target ChatEvent. */
  targetId?: string;
  /** Base58-encoded Ed25519 detached signature of the canonical signed data. */
  signature: string;
}

// ── Wire envelope types ───────────────────────────────────────────────────────

export interface ChatEventEnvelope {
  type: 'CHAT_EVENT';
  event: ChatEvent;
  /** Remaining chat-layer relay hops. Decremented on each forward; stops at 0.
   *  Not included in the event signature — envelope wrapper only. */
  hopsRemaining?: number;
}

export interface ChatSubscribeEnvelope {
  type: 'CHAT_SUBSCRIBE';
  chatId: string;
}

export interface ChatUnsubscribeEnvelope {
  type: 'CHAT_UNSUBSCRIBE';
  chatId: string;
}

export interface ChatSyncStateEnvelope {
  type: 'CHAT_SYNC_STATE';
  chatId: string;
  /** authorAddress → highest seq the sender has confirmed receiving. */
  knownSeqs: Record<string, number>;
}

export interface ChatSyncResponseEnvelope {
  type: 'CHAT_SYNC_RESPONSE';
  chatId: string;
  events: ChatEvent[];
}

export interface ChatTypingEnvelope {
  type: 'CHAT_TYPING';
  chatId: string;
  /** Qortal address of the person typing. */
  authorAddress: string;
  timestamp: number;
}

export type ChatWireEnvelope =
  | ChatEventEnvelope
  | ChatSubscribeEnvelope
  | ChatUnsubscribeEnvelope
  | ChatSyncStateEnvelope
  | ChatSyncResponseEnvelope
  | ChatTypingEnvelope;

// ── Renderer-facing summary types ─────────────────────────────────────────────

export interface ChatSummary {
  chatId: string;
  lastEvent: ChatEvent | null;
  unreadCount: number;
  updatedAt: number;
}

// ── Address derivation cache ──────────────────────────────────────────────────

const addrCache = new Map<string, string>();

function cachedDeriveAddress(pubKeyBase58: string): string {
  const hit = addrCache.get(pubKeyBase58);
  if (hit) return hit;
  const addr = deriveAddressFromPublicKey(pubKeyBase58);
  addrCache.set(pubKeyBase58, addr);
  return addr;
}

// ── Signature verification ────────────────────────────────────────────────────

/**
 * Builds the canonical signed-data object for a ChatEvent.
 * Only security-relevant fields are signed; keys are sorted alphabetically
 * so both renderer and Node produce identical bytes.
 */
function buildChatSignedData(event: ChatEvent): Record<string, unknown> {
  const base: Record<string, unknown> = {
    authorAddress: event.authorAddress,
    authorPublicKey: event.authorPublicKey,
    chatId: event.chatId,
    content: event.content,
    eventType: event.eventType,
    id: event.id,
    seq: event.seq,
    timestamp: event.timestamp,
  };
  if (event.replyTo !== undefined) base['replyTo'] = event.replyTo;
  if (event.targetId !== undefined) base['targetId'] = event.targetId;
  return base;
}

function verifyChatEventSignature(event: ChatEvent): boolean {
  try {
    const pubKeyBytes = base58Decode(event.authorPublicKey);
    const sigBytes = base58Decode(event.signature);
    const msg = canonicalizeForSigning(buildChatSignedData(event));
    return nacl.sign.detached.verify(msg, sigBytes, pubKeyBytes);
  } catch {
    return false;
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Validates that a chatId conforms to the DM or group convention.
 * DM:    two non-empty strings joined by ':', sorted lexicographically.
 * Group: "group:" followed by a decimal integer.
 */
export function validateChatId(chatId: string): ValidationResult {
  if (typeof chatId !== 'string' || chatId.length === 0) {
    return { ok: false, reason: 'chatId missing' };
  }
  if (chatId.startsWith('group:')) {
    const groupIdStr = chatId.slice(6);
    if (!/^\d+$/.test(groupIdStr) || groupIdStr.length === 0) {
      return { ok: false, reason: `invalid group chatId: ${chatId}` };
    }
    return { ok: true };
  }
  // DM: exactly two address segments separated by a single colon.
  const colonIdx = chatId.indexOf(':');
  if (colonIdx <= 0 || colonIdx === chatId.length - 1) {
    return { ok: false, reason: `invalid DM chatId (malformed): ${chatId}` };
  }
  const addrA = chatId.slice(0, colonIdx);
  const addrB = chatId.slice(colonIdx + 1);
  // No second colon allowed — would indicate a group:xxx pattern without the prefix.
  if (addrB.includes(':')) {
    return { ok: false, reason: `invalid DM chatId (extra colon): ${chatId}` };
  }
  // Addresses must be sorted to ensure both sides produce the same chatId.
  if (addrA > addrB) {
    return { ok: false, reason: `DM chatId addresses not sorted: ${chatId}` };
  }
  return { ok: true };
}

/**
 * Builds the canonical DM chatId from two Qortal addresses.
 * Sorting guarantees both parties compute the same string.
 */
export function buildDmChatId(addrA: string, addrB: string): string {
  return [addrA, addrB].sort().join(':');
}

/**
 * Builds the canonical Group chatId from a numeric Qortal group ID.
 */
export function buildGroupChatId(groupId: number): string {
  return `group:${groupId}`;
}

function validateChatEvent(event: ChatEvent, now: number): ValidationResult {
  // 1. Required field types
  if (
    typeof event.id !== 'string' || !event.id ||
    typeof event.chatId !== 'string' || !event.chatId ||
    typeof event.eventType !== 'string' ||
    typeof event.authorAddress !== 'string' || !event.authorAddress ||
    typeof event.authorPublicKey !== 'string' || !event.authorPublicKey ||
    typeof event.seq !== 'number' || !Number.isInteger(event.seq) || event.seq < 1 ||
    typeof event.timestamp !== 'number' ||
    typeof event.content !== 'string' ||
    typeof event.signature !== 'string' || !event.signature
  ) {
    return { ok: false, reason: 'missing or malformed required fields' };
  }

  // 2. Known eventType
  if (!['message', 'edit', 'delete', 'reaction'].includes(event.eventType)) {
    return { ok: false, reason: `unknown eventType: ${event.eventType}` };
  }

  // 3. chatId format
  const chatIdResult = validateChatId(event.chatId);
  if (!chatIdResult.ok) return chatIdResult;

  // 4. Timestamp bounds — we accept old messages (up to 30 days) for sync
  if (event.timestamp - now > CHAT_MAX_FUTURE_SKEW_MS) {
    return { ok: false, reason: 'timestamp too far in the future' };
  }
  if (now - event.timestamp > CHAT_MAX_AGE_MS) {
    return { ok: false, reason: 'message too old to accept' };
  }

  // 5. Content size
  if (Buffer.byteLength(event.content, 'utf8') > CHAT_MAX_CONTENT_BYTES) {
    return { ok: false, reason: 'content exceeds 10 KB limit' };
  }

  // 6. For DMs: author must be one of the two participants
  if (!event.chatId.startsWith('group:')) {
    const colonIdx = event.chatId.indexOf(':');
    const addrA = event.chatId.slice(0, colonIdx);
    const addrB = event.chatId.slice(colonIdx + 1);
    if (event.authorAddress !== addrA && event.authorAddress !== addrB) {
      return { ok: false, reason: 'author is not a participant in this DM' };
    }
  }

  // 7. Address derivation — ensures publicKey ↔ address consistency
  let derivedAddr: string;
  try {
    derivedAddr = cachedDeriveAddress(event.authorPublicKey);
  } catch {
    return { ok: false, reason: 'invalid authorPublicKey encoding' };
  }
  if (derivedAddr !== event.authorAddress) {
    return {
      ok: false,
      reason: `address mismatch: claimed=${event.authorAddress} derived=${derivedAddr}`,
    };
  }

  // 8. Signature
  if (!verifyChatEventSignature(event)) {
    return { ok: false, reason: 'invalid signature' };
  }

  return { ok: true };
}

// ── ChatStore ─────────────────────────────────────────────────────────────────

interface PersistedChatFile {
  chatId: string;
  events: ChatEvent[];
  updatedAt: number;
}

/**
 * Manages in-memory chat event storage with async persistence to JSON files.
 * One file per chatId, stored in `dataDir`.
 * Writes are debounced (2 s) and use write-file-atomic for safety.
 */
export class ChatStore {
  /** chatId → events sorted by (timestamp, seq) ascending */
  private events = new Map<string, ChatEvent[]>();
  /** chatId → authorAddress → highest accepted seq */
  private syncState = new Map<string, Map<string, number>>();
  /**
   * chatId → read watermark timestamp.
   * All events with timestamp ≤ watermark are considered read.
   */
  private readWatermarks = new Map<string, number>();

  private dataDir: string;
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private writeFileAtomic: any;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this.writeFileAtomic = require('write-file-atomic');
  }

  /** Loads all persisted chat files from disk into memory. */
  async loadFromDisk(): Promise<void> {
    try {
      await fs.promises.mkdir(this.dataDir, { recursive: true });
      const files = await fs.promises.readdir(this.dataDir);
      for (const file of files) {
        if (!file.startsWith('chat-') || !file.endsWith('.json')) continue;
        try {
          const raw = await fs.promises.readFile(
            pathMod.join(this.dataDir, file),
            'utf-8'
          );
          const data = JSON.parse(raw) as PersistedChatFile;
          if (!data.chatId || !Array.isArray(data.events)) continue;
          this.events.set(data.chatId, data.events);
          // Compute sync state in one pass over all loaded events.
          this.recomputeSyncStateForChat(data.chatId);
          loggerLog(
            `[Chat] Loaded ${data.events.length} events for chat ${data.chatId}`
          );
        } catch (err) {
          loggerError(`[Chat] Failed to load ${file}:`, err);
        }
      }
    } catch (err) {
      loggerError('[Chat] Failed to load chat store:', err);
    }
  }

  /**
   * Inserts a ChatEvent.
   * Returns `true` if the event was new and inserted, `false` if it was a duplicate.
   */
  insert(event: ChatEvent): boolean {
    let chatEvents = this.events.get(event.chatId);
    if (!chatEvents) {
      chatEvents = [];
      this.events.set(event.chatId, chatEvents);
    }
    // Dedup by event id
    if (chatEvents.some((e) => e.id === event.id)) return false;

    chatEvents.push(event);

    // Keep sorted by timestamp; use seq as tiebreaker for same-timestamp events.
    chatEvents.sort((a, b) =>
      a.timestamp !== b.timestamp ? a.timestamp - b.timestamp : a.seq - b.seq
    );

    // Trim to cap
    if (chatEvents.length > CHAT_MAX_EVENTS_PER_CHAT) {
      chatEvents.splice(0, chatEvents.length - CHAT_MAX_EVENTS_PER_CHAT);
    }

    this.updateSyncState(event.chatId, event.authorAddress);
    this.scheduleDiskWrite(event.chatId);
    return true;
  }

  /**
   * Returns up to `limit` events for a chat, ordered newest-last.
   * Optionally filters to events strictly before `beforeTimestamp`.
   */
  getEvents(chatId: string, limit = 50, beforeTimestamp?: number): ChatEvent[] {
    const all = this.events.get(chatId) ?? [];
    const filtered =
      beforeTimestamp != null
        ? all.filter((e) => e.timestamp < beforeTimestamp)
        : all;
    // Return the last `limit` entries (most recent)
    return filtered.length > limit
      ? filtered.slice(filtered.length - limit)
      : filtered.slice();
  }

  /**
   * Returns the sync state for a chat: authorAddress → highest known seq.
   * Used to exchange with peers during the sync handshake.
   */
  getSyncState(chatId: string): Record<string, number> {
    const m = this.syncState.get(chatId);
    return m ? Object.fromEntries(m.entries()) : {};
  }

  /** Returns all chatIds that have at least one stored event. */
  getKnownChatIds(): string[] {
    return Array.from(this.events.keys());
  }

  /**
   * Returns a summary for every known chat, sorted by most recently updated.
   */
  getChatSummaries(): ChatSummary[] {
    const result: ChatSummary[] = [];
    for (const [chatId, events] of this.events.entries()) {
      const lastEvent = events.length > 0 ? events[events.length - 1] : null;
      const watermark = this.readWatermarks.get(chatId) ?? 0;
      const unreadCount = events.filter((e) => e.timestamp > watermark).length;
      result.push({
        chatId,
        lastEvent,
        unreadCount,
        updatedAt: lastEvent?.timestamp ?? 0,
      });
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Computes events this node has that the requester does not.
   * Uses the requester's known seq map to find gaps.
   * Capped at CHAT_MAX_SYNC_EVENTS to avoid flooding.
   */
  getMissingEvents(
    chatId: string,
    theirSeqs: Record<string, number>
  ): ChatEvent[] {
    const all = this.events.get(chatId) ?? [];
    const missing: ChatEvent[] = [];
    for (const ev of all) {
      const theirSeq = theirSeqs[ev.authorAddress] ?? 0;
      if (ev.seq > theirSeq) {
        missing.push(ev);
        if (missing.length >= CHAT_MAX_SYNC_EVENTS) break;
      }
    }
    return missing;
  }

  /**
   * Advances the read watermark for a chat.
   * Events at or before `upToTimestamp` are considered read.
   */
  markRead(chatId: string, upToTimestamp: number): void {
    const current = this.readWatermarks.get(chatId) ?? 0;
    if (upToTimestamp > current) {
      this.readWatermarks.set(chatId, upToTimestamp);
    }
  }

  /**
   * Recomputes the highest *contiguous* seq for `authorAddress` in `chatId`
   * by scanning the events that are currently stored.
   *
   * "Contiguous" means we have every message from seq 1 (or the earliest
   * stored seq if older events were trimmed) up to N without any gaps.
   * Reporting the contiguous value — rather than the raw maximum — ensures
   * that a peer who has seq 1,2,4,5 (missing 3) tells other peers
   * "I have up to 2", so they will send seq 3,4,5 and fill the gap.
   *
   * Trim handling: if the earliest stored seq for this author is M > 1 we
   * assume seq 1…M-1 were trimmed (not missed), so we start the contiguous
   * count at M-1.  This prevents a trimmed node from endlessly requesting
   * old events that every peer has also discarded.
   */
  private updateSyncState(chatId: string, authorAddress: string): void {
    const seqs = (this.events.get(chatId) ?? [])
      .filter(e => e.authorAddress === authorAddress)
      .map(e => e.seq)
      .sort((a, b) => a - b);

    // Start just below the earliest seq we hold, treating anything before
    // it as already known (handles the trim-from-front case).
    let contiguous = seqs.length > 0 ? seqs[0] - 1 : 0;
    for (const s of seqs) {
      if (s === contiguous + 1) {
        contiguous = s;
      } else {
        break; // gap found — stop here
      }
    }

    let m = this.syncState.get(chatId);
    if (!m) {
      m = new Map<string, number>();
      this.syncState.set(chatId, m);
    }
    m.set(authorAddress, contiguous);
  }

  /**
   * Recomputes the contiguous sync state for *all* authors in a chat in a
   * single pass.  Used at load time instead of calling updateSyncState
   * once per event (which would be O(n²)).
   */
  private recomputeSyncStateForChat(chatId: string): void {
    const chatEvents = this.events.get(chatId) ?? [];

    // Group seqs by author address.
    const seqsByAuthor = new Map<string, number[]>();
    for (const ev of chatEvents) {
      let seqs = seqsByAuthor.get(ev.authorAddress);
      if (!seqs) {
        seqs = [];
        seqsByAuthor.set(ev.authorAddress, seqs);
      }
      seqs.push(ev.seq);
    }

    let m = this.syncState.get(chatId);
    if (!m) {
      m = new Map<string, number>();
      this.syncState.set(chatId, m);
    }

    for (const [authorAddress, seqs] of seqsByAuthor) {
      seqs.sort((a, b) => a - b);
      let contiguous = seqs[0] - 1; // treat anything before earliest as known
      for (const s of seqs) {
        if (s === contiguous + 1) {
          contiguous = s;
        } else {
          break;
        }
      }
      m.set(authorAddress, contiguous);
    }
  }

  private scheduleDiskWrite(chatId: string): void {
    const existing = this.writeTimers.get(chatId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.writeTimers.delete(chatId);
      this.flushToDisk(chatId).catch((err) =>
        loggerError(`[Chat] Flush error for ${chatId}:`, err)
      );
    }, CHAT_WRITE_DEBOUNCE_MS);
    timer.unref?.();
    this.writeTimers.set(chatId, timer);
  }

  private async flushToDisk(chatId: string): Promise<void> {
    const events = this.events.get(chatId);
    if (!events) return;
    const safeName = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = pathMod.join(this.dataDir, `chat-${safeName}.json`);
    const data: PersistedChatFile = { chatId, events, updatedAt: Date.now() };
    await this.writeFileAtomic(filePath, JSON.stringify(data, null, 2), {
      encoding: 'utf8',
    });
  }

  /** Cancel all pending timers and flush all dirty chats synchronously.
   *  Called on application shutdown. */
  flushAllSync(): void {
    for (const [chatId, timer] of this.writeTimers.entries()) {
      clearTimeout(timer);
      this.writeTimers.delete(chatId);
      const events = this.events.get(chatId);
      if (!events) continue;
      try {
        const safeName = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filePath = pathMod.join(this.dataDir, `chat-${safeName}.json`);
        const data: PersistedChatFile = {
          chatId,
          events,
          updatedAt: Date.now(),
        };
        this.writeFileAtomic.sync(
          filePath,
          JSON.stringify(data, null, 2),
          { encoding: 'utf8' }
        );
      } catch (err) {
        loggerError(`[Chat] Sync flush error for ${chatId}:`, err);
      }
    }
  }

  /** Cancel pending write timers (call during stop, before flushAllSync). */
  stopAllTimers(): void {
    for (const timer of this.writeTimers.values()) clearTimeout(timer);
    this.writeTimers.clear();
  }
}

// ── ChatManager ───────────────────────────────────────────────────────────────

/**
 * Manages the chat protocol layer on top of the P2P network.
 *
 * Responsibilities:
 *   - Validate and store incoming ChatEvents from the network.
 *   - Relay outgoing ChatEvents (from the local renderer) to the network.
 *   - Manage per-chat subscriptions and drive sync on peer reconnect.
 *   - Relay typing indicators (ephemeral, not stored).
 *
 * Events emitted (for IPC broadcast to renderer):
 *   'chat:event'        { event: ChatEvent }           — new message/edit/etc.
 *   'chat:typing'       { chatId, authorAddress }       — someone is typing
 *   'chat:typingStopped' { chatId, authorAddress }      — typing indicator cleared
 */
export class ChatManager extends EventEmitter {
  readonly store: ChatStore;
  private p2p: P2PNetwork;

  /** chatIds the local user is actively participating in. */
  private localSubscriptions = new Set<string>();

  /**
   * Qortal addresses of accounts logged-in on this node.
   * Used to auto-subscribe to incoming DMs addressed to these accounts.
   */
  private localAddresses = new Set<string>();

  /** nodeId → Set<chatId> — chats a remote peer has subscribed to. */
  private peerSubscriptions = new Map<string, Set<string>>();

  /** "chatId:authorAddress" → clearTimeout handle for typing indicators. */
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(p2p: P2PNetwork, store: ChatStore) {
    super();
    this.p2p = p2p;
    this.store = store;
  }

  /** Wire up P2P event listeners and begin processing messages. */
  start(): void {
    this.p2p.on('message', this.onP2PMessage);
    this.p2p.on('peer-connected', this.onPeerConnected);
    this.p2p.on('peer-disconnected', this.onPeerDisconnected);
    // Restore subscriptions from persisted chat files so sync works after restart.
    for (const chatId of this.store.getKnownChatIds()) {
      this.localSubscriptions.add(chatId);
    }
    loggerLog('[Chat] Manager started.');
  }

  /** Remove P2P listeners and cancel all timers. */
  stop(): void {
    this.p2p.off('message', this.onP2PMessage);
    this.p2p.off('peer-connected', this.onPeerConnected);
    this.p2p.off('peer-disconnected', this.onPeerDisconnected);
    for (const t of this.typingTimers.values()) clearTimeout(t);
    this.typingTimers.clear();
    this.store.stopAllTimers();
    loggerLog('[Chat] Manager stopped.');
  }

  // ── Public API (called via IPC handlers) ─────────────────────────────────

  /**
   * Register the Qortal address(es) of the locally logged-in account.
   * The manager uses this to auto-subscribe to incoming DMs.
   * Call this when the user logs in and when they log out (with []).
   */
  setLocalAddresses(addresses: string[]): void {
    this.localAddresses = new Set(addresses);
  }

  /**
   * Accept a signed ChatEventEnvelope from the local renderer.
   * Validates the event, stores it, and broadcasts it to the network.
   * Returns `false` if validation fails.
   */
  handleLocalEvent(envelope: unknown): boolean {
    const env = envelope as ChatEventEnvelope;
    if (!env || env.type !== 'CHAT_EVENT' || !env.event) {
      return false;
    }
    const event = env.event;
    const now = Date.now();
    const result = validateChatEvent(event, now);
    if (result.ok === false) {
      loggerLog(`[Chat] Rejected local event ${event?.id}: ${result.reason}`);
      return false;
    }
    // Ensure we're subscribed — we're the sender, so we're definitely a participant.
    this.localSubscriptions.add(event.chatId);

    const isNew = this.store.insert(event);
    if (isNew) {
      this.emit('chat:event', { event });
    }

    // Broadcast via hybrid routing: targeted to subscribers + fallback gossip.
    // hopsRemaining starts at CHAT_DEFAULT_HOPS and is decremented on each re-relay.
    this.broadcastChatEvent(event.chatId, { ...env, hopsRemaining: CHAT_DEFAULT_HOPS });
    return true;
  }

  /**
   * Subscribe the local user to a chat.
   * Announces the subscription to all connected peers and requests a sync
   * so any messages sent while offline are recovered.
   */
  subscribeToChat(chatId: string): void {
    const result = validateChatId(chatId);
    if (result.ok === false) {
      loggerError(`[Chat] Invalid chatId for subscribe: ${chatId}`);
      return;
    }
    if (this.localSubscriptions.has(chatId)) return; // already subscribed
    this.localSubscriptions.add(chatId);
    this.announceSubscriptionToPeers(chatId);
    loggerLog(`[Chat] Subscribed to chat: ${chatId}`);
  }

  /**
   * Unsubscribe the local user from a chat.
   * Notifies connected peers so they can stop forwarding targeted events.
   */
  unsubscribeFromChat(chatId: string): void {
    if (!this.localSubscriptions.delete(chatId)) return;
    const env: ChatUnsubscribeEnvelope = {
      type: 'CHAT_UNSUBSCRIBE',
      chatId,
    };
    for (const peer of this.p2p.getPeers()) {
      if (peer.connected) this.p2p.send(peer.id, env);
    }
    loggerLog(`[Chat] Unsubscribed from chat: ${chatId}`);
  }

  /**
   * Broadcast a typing indicator for the given chat.
   * Ephemeral — never stored, automatically expires after CHAT_TYPING_TTL_MS.
   */
  sendTyping(chatId: string, authorAddress: string): void {
    if (!this.localSubscriptions.has(chatId)) return;
    const env: ChatTypingEnvelope = {
      type: 'CHAT_TYPING',
      chatId,
      authorAddress,
      timestamp: Date.now(),
    };
    this.p2p.send(null, env);
  }

  /** Returns up to `limit` events for a chat, paginated by `beforeTimestamp`. */
  getHistory(chatId: string, limit = 50, beforeTimestamp?: number): ChatEvent[] {
    return this.store.getEvents(chatId, limit, beforeTimestamp);
  }

  /** Returns a summary of every known chat (latest event + unread count). */
  getChatSummaries(): ChatSummary[] {
    return this.store.getChatSummaries();
  }

  /** Advances the read watermark for a chat (marks messages as read). */
  markRead(chatId: string, upToTimestamp: number): void {
    this.store.markRead(chatId, upToTimestamp);
  }

  /** Returns the set of chatIds the local user is subscribed to. */
  getLocalSubscriptions(): string[] {
    return Array.from(this.localSubscriptions);
  }

  // ── P2P event handlers ────────────────────────────────────────────────────

  private onP2PMessage = ({
    from,
    via,
    data,
  }: {
    from: string;
    via?: string;
    to?: string;
    data: unknown;
  }): void => {
    if (!data || typeof data !== 'object') return;
    const type = (data as Record<string, unknown>).type;
    if (typeof type !== 'string' || !CHAT_MESSAGE_TYPES.has(type)) return;
    this.handleIncoming(from, via ?? from, data as ChatWireEnvelope);
  };

  private onPeerConnected = ({ id }: { id: string }): void => {
    // Announce all local subscriptions and request sync for each chat.
    for (const chatId of this.localSubscriptions) {
      this.p2p.send(id, {
        type: 'CHAT_SUBSCRIBE',
        chatId,
      } as ChatSubscribeEnvelope);
      this.p2p.send(id, {
        type: 'CHAT_SYNC_STATE',
        chatId,
        knownSeqs: this.store.getSyncState(chatId),
      } as ChatSyncStateEnvelope);
    }
  };

  private onPeerDisconnected = ({ id }: { id: string }): void => {
    this.peerSubscriptions.delete(id);
  };

  // ── Incoming message dispatch ─────────────────────────────────────────────

  private handleIncoming(
    fromNodeId: string,
    _viaNodeId: string,
    envelope: ChatWireEnvelope
  ): void {
    switch (envelope.type) {
      case 'CHAT_EVENT':
        this.handleChatEvent(fromNodeId, envelope);
        break;
      case 'CHAT_SUBSCRIBE':
        this.handleSubscribe(fromNodeId, envelope);
        break;
      case 'CHAT_UNSUBSCRIBE':
        this.handleUnsubscribe(fromNodeId, envelope);
        break;
      case 'CHAT_SYNC_STATE':
        this.handleSyncState(fromNodeId, envelope);
        break;
      case 'CHAT_SYNC_RESPONSE':
        this.handleSyncResponse(envelope);
        break;
      case 'CHAT_TYPING':
        this.handleTyping(envelope);
        break;
    }
  }

  private handleChatEvent(fromNodeId: string, envelope: ChatEventEnvelope): void {
    const event = envelope.event;
    if (!event || typeof event !== 'object') return;

    const now = Date.now();
    const result = validateChatEvent(event, now);
    if (result.ok === false) {
      loggerLog(`[Chat] Rejected remote event ${event?.id}: ${result.reason}`);
      return;
    }

    // Accept if subscribed or if this is a DM addressed to a local user.
    if (!this.shouldAccept(event.chatId)) return;

    // Auto-subscribe DMs for local addresses so future events are delivered.
    if (!event.chatId.startsWith('group:') && !this.localSubscriptions.has(event.chatId)) {
      this.localSubscriptions.add(event.chatId);
    }

    // store.insert returns false for duplicates — use it as the dedup gate for
    // re-relay too, so each event is only forwarded once per node.
    if (!this.store.insert(event)) return;

    this.emit('chat:event', { event });

    // Re-relay to other subscribers we know about, decrementing the hop counter.
    // excludeNodeId = fromNodeId prevents echoing back to the sender.
    const hops = envelope.hopsRemaining ?? CHAT_DEFAULT_HOPS;
    if (hops > 0) {
      this.broadcastChatEvent(
        event.chatId,
        { ...envelope, hopsRemaining: hops - 1 },
        fromNodeId
      );
    }
  }

  private handleSubscribe(
    fromNodeId: string,
    envelope: ChatSubscribeEnvelope
  ): void {
    const { chatId } = envelope;
    if (typeof chatId !== 'string' || !chatId) return;
    let subs = this.peerSubscriptions.get(fromNodeId);
    if (!subs) {
      subs = new Set<string>();
      this.peerSubscriptions.set(fromNodeId, subs);
    }
    subs.add(chatId);
  }

  private handleUnsubscribe(
    fromNodeId: string,
    envelope: ChatUnsubscribeEnvelope
  ): void {
    const { chatId } = envelope;
    this.peerSubscriptions.get(fromNodeId)?.delete(chatId);
  }

  private handleSyncState(
    fromNodeId: string,
    envelope: ChatSyncStateEnvelope
  ): void {
    const { chatId, knownSeqs } = envelope;
    if (typeof chatId !== 'string' || !chatId) return;
    if (!knownSeqs || typeof knownSeqs !== 'object') return;

    const missing = this.store.getMissingEvents(
      chatId,
      knownSeqs as Record<string, number>
    );
    if (missing.length === 0) return;

    this.p2p.send(fromNodeId, {
      type: 'CHAT_SYNC_RESPONSE',
      chatId,
      events: missing,
    } as ChatSyncResponseEnvelope);
    loggerLog(
      `[Chat] Sync: sending ${missing.length} missing events for ${chatId} to ${fromNodeId.slice(0, 8)}…`
    );
  }

  private handleSyncResponse(envelope: ChatSyncResponseEnvelope): void {
    const { chatId, events } = envelope;
    if (typeof chatId !== 'string' || !chatId || !Array.isArray(events)) return;
    if (!this.localSubscriptions.has(chatId)) return;

    let stored = 0;
    const now = Date.now();
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      // Safety: chatId in the event must match the declared chatId.
      if (event.chatId !== chatId) continue;
      const result = validateChatEvent(event, now);
      if (!result.ok) continue;
      if (this.store.insert(event)) {
        stored++;
        this.emit('chat:event', { event });
      }
    }
    if (stored > 0) {
      loggerLog(
        `[Chat] Sync: stored ${stored} recovered events for ${chatId}`
      );
    }
  }

  private handleTyping(envelope: ChatTypingEnvelope): void {
    const { chatId, authorAddress, timestamp } = envelope;
    if (!chatId || !authorAddress) return;
    if (!this.shouldAccept(chatId)) return;

    // Discard stale indicators
    if (Date.now() - timestamp > CHAT_TYPING_TTL_MS) return;

    const key = `${chatId}:${authorAddress}`;
    const existing = this.typingTimers.get(key);
    if (existing) clearTimeout(existing);

    this.emit('chat:typing', { chatId, authorAddress });

    const timer = setTimeout(() => {
      this.typingTimers.delete(key);
      this.emit('chat:typingStopped', { chatId, authorAddress });
    }, CHAT_TYPING_TTL_MS);
    timer.unref?.();
    this.typingTimers.set(key, timer);
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  /**
   * Hybrid routing: send to all known subscribers first, then gossip to up to
   * 2 random non-subscribers as a coverage fallback.
   *
   * Subscribers receive targeted point-to-point delivery.
   * The fallback ensures coverage for peers that connected recently and
   * haven't yet announced their subscriptions, and bridges any disconnected
   * sections of the network.
   *
   * excludeNodeId prevents echoing back to the peer that sent us this event.
   */
  private broadcastChatEvent(
    chatId: string,
    env: ChatEventEnvelope,
    excludeNodeId?: string
  ): void {
    const allPeers = this.p2p.getPeers().filter(p => p.connected);
    const subscriberIds = new Set<string>();

    // Step 1: targeted delivery to known subscribers
    for (const [nodeId, subs] of this.peerSubscriptions) {
      if (nodeId === excludeNodeId) continue;
      if (subs.has(chatId)) {
        this.p2p.send(nodeId, env);
        subscriberIds.add(nodeId);
      }
    }

    // Step 2: fallback gossip to up to 2 random non-subscribers
    const nonSubscribers = allPeers.filter(
      p => p.id !== excludeNodeId && !subscriberIds.has(p.id)
    );
    // Fisher-Yates shuffle for unbiased random selection
    for (let i = nonSubscribers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nonSubscribers[i], nonSubscribers[j]] = [nonSubscribers[j], nonSubscribers[i]];
    }
    for (const peer of nonSubscribers.slice(0, 2)) {
      this.p2p.send(peer.id, env);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Returns true if we should accept and store an event for this chatId.
   *   - Always true for explicitly subscribed chats.
   *   - True for DMs where one of the participants is a local address.
   *   - False for group chats where we haven't subscribed.
   */
  private shouldAccept(chatId: string): boolean {
    if (this.localSubscriptions.has(chatId)) return true;
    if (!chatId.startsWith('group:') && this.localAddresses.size > 0) {
      const colonIdx = chatId.indexOf(':');
      if (colonIdx > 0) {
        const addrA = chatId.slice(0, colonIdx);
        const addrB = chatId.slice(colonIdx + 1);
        return this.localAddresses.has(addrA) || this.localAddresses.has(addrB);
      }
    }
    return false;
  }

  /** Send CHAT_SUBSCRIBE + CHAT_SYNC_STATE to all currently connected peers. */
  private announceSubscriptionToPeers(chatId: string): void {
    const subEnv: ChatSubscribeEnvelope = { type: 'CHAT_SUBSCRIBE', chatId };
    const syncEnv: ChatSyncStateEnvelope = {
      type: 'CHAT_SYNC_STATE',
      chatId,
      knownSeqs: this.store.getSyncState(chatId),
    };
    for (const peer of this.p2p.getPeers()) {
      if (!peer.connected) continue;
      this.p2p.send(peer.id, subEnv);
      this.p2p.send(peer.id, syncEnv);
    }
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

let chatManager: ChatManager | null = null;

export function getChatManager(): ChatManager | null {
  return chatManager;
}

/**
 * Creates and starts the ChatManager.
 * `dataDir` should be a per-instance directory (e.g. path.join(userData, 'p2p-chat')).
 * Must be called after `startP2PNetwork`.
 */
export async function startChatManager(
  p2p: P2PNetwork,
  dataDir: string
): Promise<ChatManager> {
  if (chatManager) {
    chatManager.stop();
    chatManager = null;
  }
  const store = new ChatStore(dataDir);
  await store.loadFromDisk();
  chatManager = new ChatManager(p2p, store);
  chatManager.start();
  return chatManager;
}

export function stopChatManager(): void {
  if (chatManager) {
    chatManager.store.flushAllSync();
    chatManager.stop();
    chatManager = null;
  }
}

/**
 * Flush all pending disk writes synchronously.
 * Safe to call multiple times; call on 'before-quit'.
 */
export function flushChatStore(): void {
  chatManager?.store.flushAllSync();
}

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
 *   8. Signature — Ed25519 detached signature verified off the main thread (worker pool).
 */

import * as nodeCrypto from 'crypto';
import { EventEmitter } from 'events';
import { log as loggerLog, error as loggerError } from './logger';
import { deriveAddressFromPublicKey } from './presence';
import { VerifyWorkerPool } from './verify-worker-pool';
import type { P2PNetwork } from './p2p-network';
import { ChatDatabase } from './chat-db';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum UTF-8 bytes for the content field. */
const CHAT_MAX_CONTENT_BYTES = 10_000;

/** Maximum byte size for an encrypted image attachment. */
const CHAT_MAX_ATTACHMENT_BYTES = 512 * 1024;

/**
 * Qortal addresses of all authorised support agents.
 * Must be kept in sync with the renderer-side constant in SupportChat.tsx.
 * Only these addresses may write to any "support:<userAddress>" channel.
 */
export const SUPPORT_AGENT_ADDRESSES = new Set<string>([
  'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
  'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
]);

/** Reject events dated this far into the future. */
const CHAT_MAX_FUTURE_SKEW_MS = 60_000;

/** Reject events older than this (30 days). */
const CHAT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

/** How long a typing indicator lives before auto-clearing. */
const CHAT_TYPING_TTL_MS = 8_000;

/** Max relay hops at the chat layer (independent of P2P hop counter). */
const CHAT_DEFAULT_HOPS = 4;

/** Maximum number of event IDs in a single CHAT_READ batch. */
const READ_RECEIPT_MAX_BATCH = 200;

// ── Wire-level type discriminators ───────────────────────────────────────────

export type ChatNetworkType =
  | 'CHAT_EVENT'
  | 'CHAT_SUBSCRIBE'
  | 'CHAT_UNSUBSCRIBE'
  | 'CHAT_SYNC_STATE'
  | 'CHAT_SYNC_RESPONSE'
  | 'CHAT_TYPING'
  | 'CHAT_READ';

export const CHAT_MESSAGE_TYPES = new Set<string>([
  'CHAT_EVENT',
  'CHAT_SUBSCRIBE',
  'CHAT_UNSUBSCRIBE',
  'CHAT_SYNC_STATE',
  'CHAT_SYNC_RESPONSE',
  'CHAT_TYPING',
  'CHAT_READ',
]);

// ── Core event types ─────────────────────────────────────────────────────────

export type ChatEventType = 'message' | 'edit' | 'delete' | 'reaction';

/**
 * Cleartext metadata for an image attachment.
 * Included in the event signature so recipients can verify it was not tampered with.
 */
export interface AttachmentMeta {
  /** MIME type of the compressed image, e.g. "image/webp" or "image/gif". */
  mimeType: string;
  /** Original filename, if available. */
  filename?: string;
  /** Image width in pixels. */
  width?: number;
  /** Image height in pixels. */
  height?: number;
  /** Byte length of the encrypted attachment data. */
  sizeBytes: number;
}

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
  /**
   * Cleartext image attachment metadata.
   * Present on message events that carry an image.
   * Included in the event signature.
   */
  attachmentMeta?: AttachmentMeta;
  /**
   * SHA-256 hex digest of the encrypted attachment bytes.
   * Included in the event signature so the attachment blob can be verified
   * without signing the entire (potentially large) base64 string.
   */
  attachmentDataHash?: string;
  /**
   * Base64-encoded nacl.secretbox ciphertext of the compressed image.
   * Wire format: base64(nonce[24] || secretbox_output).
   * NOT included in the event signature — covered by attachmentDataHash.
   * Absent when events are loaded from history (kept in chat_attachments table).
   */
  attachmentData?: string;
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

/**
 * Read receipt — ephemeral metadata, not a signed ChatEvent.
 * Broadcasted to known subscribers only (no gossip), persisted in the
 * read_receipts table so it survives the sender going offline.
 */
export interface ChatReadEnvelope {
  type: 'CHAT_READ';
  chatId: string;
  /** Address that has seen the listed events. */
  readerAddress: string;
  /** IDs of the events that were seen, capped at READ_RECEIPT_MAX_BATCH. */
  eventIds: string[];
  timestamp: number;
}

export type ChatWireEnvelope =
  | ChatEventEnvelope
  | ChatSubscribeEnvelope
  | ChatUnsubscribeEnvelope
  | ChatSyncStateEnvelope
  | ChatSyncResponseEnvelope
  | ChatTypingEnvelope
  | ChatReadEnvelope;

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
/** Canonical signed payload for Ed25519 verification (renderer and workers must match). */
export function buildChatSignedData(event: ChatEvent): Record<string, unknown> {
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
  if (event.attachmentMeta !== undefined) base['attachmentMeta'] = event.attachmentMeta;
  if (event.attachmentDataHash !== undefined) base['attachmentDataHash'] = event.attachmentDataHash;
  return base;
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

  // Support channels:
  //   "support:queue"         — public queue where users post a knock.
  //   "support:<userAddress>" — private per-user encrypted channel.
  if (chatId === 'support:queue') return { ok: true };
  if (chatId.startsWith('support:')) {
    const addr = chatId.slice(8);
    if (!addr) return { ok: false, reason: 'support chatId missing address' };
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

/**
 * Full validation except Ed25519 (runs on main thread). Signature verified via VerifyWorkerPool.
 */
function validateChatEventSansSignature(event: ChatEvent, now: number): ValidationResult {
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

  // 2a. edit / delete / reaction must reference a target event
  if (
    (event.eventType === 'edit' ||
      event.eventType === 'delete' ||
      event.eventType === 'reaction') &&
    (typeof event.targetId !== 'string' || !event.targetId)
  ) {
    return { ok: false, reason: `${event.eventType} event requires targetId` };
  }

  // 2b. Reaction content must be a small emoji/string, not a full message body
  if (event.eventType === 'reaction') {
    const reactionBytes = Buffer.byteLength(event.content, 'utf8');
    if (reactionBytes === 0 || reactionBytes > 64) {
      return { ok: false, reason: 'reaction content must be 1–64 bytes' };
    }
  }

  // 2c. replyTo, when present, must be a non-empty string
  if (
    event.eventType === 'message' &&
    event.replyTo !== undefined &&
    (typeof event.replyTo !== 'string' || !event.replyTo)
  ) {
    return { ok: false, reason: 'replyTo must be a non-empty string when present' };
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

  // 5a. Attachment validation (when present)
  if (event.attachmentMeta !== undefined || event.attachmentData !== undefined || event.attachmentDataHash !== undefined) {
    // All three must be present together (or all absent).
    if (!event.attachmentMeta || !event.attachmentDataHash) {
      return { ok: false, reason: 'partial attachment fields: attachmentMeta and attachmentDataHash required together' };
    }
    // sizeBytes must be within limit.
    if (
      typeof event.attachmentMeta.sizeBytes !== 'number' ||
      event.attachmentMeta.sizeBytes <= 0 ||
      event.attachmentMeta.sizeBytes > CHAT_MAX_ATTACHMENT_BYTES
    ) {
      return { ok: false, reason: `attachment sizeBytes exceeds ${CHAT_MAX_ATTACHMENT_BYTES} byte limit` };
    }
    // mimeType must be a non-empty string.
    if (typeof event.attachmentMeta.mimeType !== 'string' || !event.attachmentMeta.mimeType) {
      return { ok: false, reason: 'attachment mimeType missing' };
    }
    // attachmentDataHash must be a 64-char hex string (SHA-256).
    if (typeof event.attachmentDataHash !== 'string' || !/^[0-9a-f]{64}$/.test(event.attachmentDataHash)) {
      return { ok: false, reason: 'attachmentDataHash must be a 64-char hex SHA-256' };
    }
    // If attachmentData is present, verify its hash matches attachmentDataHash.
    if (event.attachmentData !== undefined) {
      if (typeof event.attachmentData !== 'string' || !event.attachmentData) {
        return { ok: false, reason: 'attachmentData must be a non-empty string' };
      }
      const dataBytes = Buffer.from(event.attachmentData, 'base64');
      const hashHex = nodeCrypto.createHash('sha256').update(dataBytes).digest('hex');
      if (hashHex !== event.attachmentDataHash) {
        return { ok: false, reason: 'attachmentData SHA-256 does not match attachmentDataHash' };
      }
    }
  }

  // 6. For DMs: author must be one of the two participants.
  // support: chatIds look like "support:QAddr" and share the colon format but
  // are NOT DMs — participant enforcement for them lives in ChatManager.handleChatEvent.
  if (!event.chatId.startsWith('group:') && !event.chatId.startsWith('support:')) {
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

  return { ok: true };
}

// ── ChatStore (replaced by ChatDatabase) ──────────────────────────────────────
//
// ChatStore has been removed. ChatDatabase (./chat-db.ts) is the drop-in
// replacement backed by a shared SQLite database in WAL mode.

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
const CHAT_VERIFY_WORKER_COUNT = 3;
const CHAT_MAX_PENDING_VERIFY = 2048;

export class ChatManager extends EventEmitter {
  readonly store: ChatDatabase;
  private p2p: P2PNetwork;
  private verifyPool = new VerifyWorkerPool(
    'chat',
    CHAT_VERIFY_WORKER_COUNT,
    CHAT_MAX_PENDING_VERIFY
  );

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

  /**
   * Per-address timestamp of the most-recent accepted "support:queue" knock.
   * Used to enforce a cooldown per address on the queue channel to prevent spam.
   * In-memory only — resets on restart, which is acceptable for a real-time P2P node.
   */
  private queueRateLimit = new Map<string, number>();
  private readonly QUEUE_COOLDOWN_MS = 5 * 60 * 1_000; // 5 minutes

  constructor(p2p: P2PNetwork, store: ChatDatabase) {
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
    this.verifyPool.start();
    loggerLog('[Chat] Manager started.');
  }

  /** Remove P2P listeners and cancel all timers. */
  stop(): void {
    this.verifyPool.stop();
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
  async handleLocalEvent(envelope: unknown): Promise<boolean> {
    const env = envelope as ChatEventEnvelope;
    if (!env || env.type !== 'CHAT_EVENT' || !env.event) {
      return false;
    }
    const event = env.event;
    const now = Date.now();
    const result = validateChatEventSansSignature(event, now);
    if (result.ok === false) {
      loggerLog(`[Chat] Rejected local event ${event?.id}: ${result.reason}`);
      return false;
    }
    const sigOk = await this.verifyPool.verify({
      kind: 'chat',
      signedFields: buildChatSignedData(event),
      signature: event.signature,
      authorPublicKey: event.authorPublicKey,
      authorAddress: event.authorAddress,
    });
    if (!sigOk) {
      loggerLog(`[Chat] Rejected local event ${event?.id}: invalid signature`);
      return false;
    }
    // Ensure we're subscribed — we're the sender, so we're definitely a participant.
    this.localSubscriptions.add(event.chatId);

    const isNew = this.store.insert(event);
    if (isNew) {
      this.emit('chat:event', { event });
    }

    // Clear any lingering typing indicator for the local sender.
    if (event.eventType === 'message' || event.eventType === 'edit') {
      this.clearTypingIndicator(event.chatId, event.authorAddress);
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
   * Clear the support-queue rate-limit map.
   * Should be called when an agent logs out so that users who re-knock after
   * the agent re-logs in are not silently dropped by the stale cooldown.
   */
  clearQueueRateLimit(): void {
    this.queueRateLimit.clear();
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

  /**
   * Record that `readerAddress` has seen `eventIds` in `chatId`, then
   * broadcast a CHAT_READ envelope to all known subscribers.
   *
   * Read receipts are sent to subscribers only — no gossip fallback needed
   * since they carry no content and missing one is not critical.
   */
  sendReadReceipt(
    chatId: string,
    eventIds: string[],
    readerAddress: string
  ): void {
    if (!readerAddress || !chatId) return;
    if (!this.localSubscriptions.has(chatId)) return;
    if (eventIds.length === 0) return;

    const capped = eventIds.slice(0, READ_RECEIPT_MAX_BATCH);
    const now = Date.now();

    // Persist locally first.
    for (const id of capped) {
      this.store.upsertReadReceipt(chatId, id, readerAddress, now);
    }

    // Broadcast to known subscribers (targeted delivery, no gossip).
    const env: ChatReadEnvelope = {
      type: 'CHAT_READ',
      chatId,
      readerAddress,
      eventIds: capped,
      timestamp: now,
    };
    for (const [nodeId, subs] of this.peerSubscriptions) {
      if (subs.has(chatId)) {
        this.p2p.send(nodeId, env);
      }
    }

    // Emit to the local renderer immediately.
    this.emit('chat:read', { chatId, readerAddress, eventIds: capped });
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

    // Replay read receipts shortly after the initial sync handshake so the
    // reconnect hot path prioritizes message delivery over receipt fan-out.
    const replayTimer = setTimeout(() => {
      for (const peer of this.p2p.getPeers()) {
        if (peer.id === id && peer.connected) {
          this.replayReadReceiptsToPeer(id);
          break;
        }
      }
    }, 150);
    replayTimer.unref?.();
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
      case 'CHAT_READ':
        this.handleRead(envelope);
        break;
    }
  }

  private handleChatEvent(fromNodeId: string, envelope: ChatEventEnvelope): void {
    const event = envelope.event;
    if (!event || typeof event !== 'object') return;

    const now = Date.now();
    const result = validateChatEventSansSignature(event, now);
    if (result.ok === false) {
      loggerLog(`[Chat] Rejected remote event ${event?.id}: ${result.reason}`);
      return;
    }

    // Accept if subscribed or if this is a DM addressed to a local user.
    if (!this.shouldAccept(event.chatId)) return;

    // ── Support-channel enforcement ──────────────────────────────────────────

    if (event.chatId === 'support:queue') {
      const last = this.queueRateLimit.get(event.authorAddress) ?? 0;
      if (Date.now() - last < this.QUEUE_COOLDOWN_MS) return;
      this.queueRateLimit.set(event.authorAddress, Date.now());
    }

    if (event.chatId.startsWith('support:') && event.chatId !== 'support:queue') {
      const userAddr = event.chatId.slice(8);
      if (
        event.authorAddress !== userAddr &&
        !SUPPORT_AGENT_ADDRESSES.has(event.authorAddress)
      ) {
        return;
      }
    }

    void this.verifyPool
      .verify({
        kind: 'chat',
        signedFields: buildChatSignedData(event),
        signature: event.signature,
        authorPublicKey: event.authorPublicKey,
        authorAddress: event.authorAddress,
      })
      .then((sigOk) => {
        if (!sigOk) {
          loggerLog(`[Chat] Rejected remote event ${event?.id}: invalid signature`);
          return;
        }
        try {
          this.finishVerifiedChatEvent(fromNodeId, envelope, event);
        } catch (err) {
          loggerError('[Chat] Error applying verified event:', err);
        }
      });
  }

  /** After Ed25519 verify: persist, emit, relay (same ordering as legacy path). */
  private finishVerifiedChatEvent(
    fromNodeId: string,
    envelope: ChatEventEnvelope,
    event: ChatEvent
  ): void {
    if (
      !event.chatId.startsWith('group:') &&
      !event.chatId.startsWith('support:') &&
      !this.localSubscriptions.has(event.chatId)
    ) {
      this.localSubscriptions.add(event.chatId);
    }

    if (!this.store.insert(event)) return;

    this.emit('chat:event', { event });

    if (event.eventType === 'message' || event.eventType === 'edit') {
      this.clearTypingIndicator(event.chatId, event.authorAddress);
    }

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

    const now = Date.now();
    const tasks: Promise<boolean>[] = [];
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      if (event.chatId !== chatId) continue;
      const result = validateChatEventSansSignature(event, now);
      if (!result.ok) continue;

      if (
        event.chatId.startsWith('support:') &&
        event.chatId !== 'support:queue'
      ) {
        const userAddr = event.chatId.slice(8);
        if (
          event.authorAddress !== userAddr &&
          !SUPPORT_AGENT_ADDRESSES.has(event.authorAddress)
        ) {
          continue;
        }
      }

      tasks.push(
        this.verifyPool
          .verify({
            kind: 'chat',
            signedFields: buildChatSignedData(event),
            signature: event.signature,
            authorPublicKey: event.authorPublicKey,
            authorAddress: event.authorAddress,
          })
          .then((sigOk) => {
            if (!sigOk) return false;
            if (this.store.insert(event)) {
              this.emit('chat:event', { event });
              return true;
            }
            return false;
          })
      );
    }
    void Promise.all(tasks).then((results) => {
      const stored = results.filter(Boolean).length;
      if (stored > 0) {
        loggerLog(
          `[Chat] Sync: stored ${stored} recovered events for ${chatId}`
        );
      }
    });
  }

  /**
   * Immediately clear the typing indicator for `authorAddress` in `chatId`.
   * Cancels the auto-expire timer and emits `chat:typingStopped` so the
   * renderer removes the indicator without waiting for the TTL to expire.
   */
  private clearTypingIndicator(chatId: string, authorAddress: string): void {
    const key = `${chatId}:${authorAddress}`;
    const timer = this.typingTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.typingTimers.delete(key);
    this.emit('chat:typingStopped', { chatId, authorAddress });
  }

  /**
   * Handle an incoming CHAT_READ envelope.
   *
   * Validates the reader is a legitimate participant for the chat type,
   * verifies each event ID exists in local storage (prevents phantom-receipt
   * spam), persists the receipts, and emits 'chat:read' to the renderer.
   */
  private handleRead(envelope: ChatReadEnvelope): void {
    const { chatId, readerAddress, eventIds, timestamp } = envelope;
    if (!chatId || !readerAddress || !Array.isArray(eventIds) || eventIds.length === 0) return;
    if (!this.shouldAccept(chatId)) return;

    // Participant validation per chat type.
    if (chatId.startsWith('support:') && chatId !== 'support:queue') {
      const userAddr = chatId.slice(8);
      if (
        readerAddress !== userAddr &&
        !SUPPORT_AGENT_ADDRESSES.has(readerAddress)
      ) return;
    } else if (!chatId.startsWith('group:') && !chatId.startsWith('support:')) {
      // DM: readerAddress must be one of the two participants.
      const colonIdx = chatId.indexOf(':');
      if (colonIdx > 0) {
        const addrA = chatId.slice(0, colonIdx);
        const addrB = chatId.slice(colonIdx + 1);
        if (readerAddress !== addrA && readerAddress !== addrB) return;
      }
    }
    // Group chats: open membership — no per-participant check needed.

    const capped = eventIds.slice(0, READ_RECEIPT_MAX_BATCH);
    const readAt = typeof timestamp === 'number' ? timestamp : Date.now();

    // Persist only receipts for events we actually have, to prevent spam.
    const valid: string[] = [];
    for (const id of capped) {
      if (typeof id !== 'string' || !id) continue;
      if (!this.store.hasEvent(id)) continue;
      this.store.upsertReadReceipt(chatId, id, readerAddress, readAt);
      valid.push(id);
    }

    if (valid.length > 0) {
      this.emit('chat:read', { chatId, readerAddress, eventIds: valid });
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
    for (const peer of this.pickRandomPeers(nonSubscribers, 2)) {
      this.p2p.send(peer.id, env);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Returns true if we should accept and store an event for this chatId.
   *   - Always true for explicitly subscribed chats.
   *   - True for DMs where one of the participants is a local address.
   *   - True for the user's own support private channel ("support:<localAddress>").
   *   - False for group chats or support chats where we haven't subscribed.
   */
  private shouldAccept(chatId: string): boolean {
    if (this.localSubscriptions.has(chatId)) return true;

    // DM: "addrA:addrB" — accept if either address is local.
    if (
      !chatId.startsWith('group:') &&
      !chatId.startsWith('support:') &&
      this.localAddresses.size > 0
    ) {
      const colonIdx = chatId.indexOf(':');
      if (colonIdx > 0) {
        const addrA = chatId.slice(0, colonIdx);
        const addrB = chatId.slice(colonIdx + 1);
        return this.localAddresses.has(addrA) || this.localAddresses.has(addrB);
      }
    }

    // Support private channel: accept if the address in the chatId is ours.
    if (chatId.startsWith('support:') && chatId !== 'support:queue') {
      const addr = chatId.slice(8);
      return this.localAddresses.has(addr);
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

  private replayReadReceiptsToPeer(peerId: string): void {
    for (const localAddr of this.localAddresses) {
      for (const chatId of this.localSubscriptions) {
        const readIds = this.store.getReadReceiptsByReader(chatId, localAddr);
        if (readIds.length === 0) continue;
        const env: ChatReadEnvelope = {
          type: 'CHAT_READ',
          chatId,
          readerAddress: localAddr,
          eventIds: readIds.slice(0, READ_RECEIPT_MAX_BATCH),
          timestamp: Date.now(),
        };
        this.p2p.send(peerId, env);
      }
    }
  }

  private pickRandomPeers<T>(peers: T[], count: number): T[] {
    if (peers.length <= count) return peers;
    const pool = [...peers];
    const result: T[] = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
      const index = Math.floor(Math.random() * pool.length);
      const [picked] = pool.splice(index, 1);
      result.push(picked);
    }
    return result;
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

let chatManager: ChatManager | null = null;

export function getChatManager(): ChatManager | null {
  return chatManager;
}

/**
 * Creates and starts the ChatManager backed by the shared SQLite database.
 * `dbPath` must point to the shared DB file (e.g. appData/qortal-shared/chat.db).
 * All Electron instances pass the same path so they share one message store.
 * Must be called after `startP2PNetwork`.
 */
export async function startChatManager(
  p2p: P2PNetwork,
  dbPath: string
): Promise<ChatManager> {
  if (chatManager) {
    chatManager.stop();
    chatManager = null;
  }
  const store = new ChatDatabase(dbPath);
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

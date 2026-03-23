/**
 * useP2PChat — React hook for the P2P Hub chat protocol.
 *
 * Manages the full lifecycle for a single chat channel:
 *   - Subscribes to the channel and loads history on mount.
 *   - Streams incoming events via window.chat.onEvent.
 *   - Handles typing indicators (incoming display + outgoing debounce).
 *   - Folds the raw event log into RenderedMessage[] so edits, deletes,
 *     reactions, and replies are reflected automatically in the UI.
 *   - Provides sendMessage / sendEdit / sendDelete / sendReaction / sendReply.
 *   - Cleans up subscriptions on unmount.
 *
 * Signing reuses the 'signPresenceMessage' background case, which performs:
 *   1. Sort fields by key alphabetically.
 *   2. JSON.stringify the sorted object.
 *   3. UTF-8 encode.
 *   4. nacl.sign.detached(bytes, privateKey).
 *   5. Base58-encode the signature.
 * This is identical to what electron/src/chat.ts validates.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { userInfoAtom } from '../atoms/global';

// ── Constants ─────────────────────────────────────────────────────────────────

/** How often (ms) to re-send a typing indicator while the user keeps typing. */
const TYPING_DEBOUNCE_MS = 3_000;

/** Maximum messages to request when loading history. */
const HISTORY_LIMIT = 200;

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Signs a set of fields using the local user's Ed25519 key.
 * Delegates to the background process which holds the private key.
 * The signing algorithm (sorted-key canonical JSON → Ed25519 → Base58) is
 * identical to what electron/src/chat.ts verifies.
 */
async function signChatFields(
  fields: Record<string, unknown>
): Promise<string> {
  const result = await (window as any).sendMessage(
    'signPresenceMessage',
    fields,
    10_000
  );
  if (result?.error) throw new Error(String(result.error));
  if (typeof result?.signature !== 'string') {
    throw new Error('signPresenceMessage returned no signature');
  }
  return result.signature as string;
}

/**
 * Applies a single non-message event onto an already-constructed RenderedMessage,
 * mutating a shallow clone to keep renders correct.
 *
 * Author-ownership is enforced here (not server-side) because in P2P the
 * target message may not have arrived yet during validation.
 */
function applyEventToMessage(
  msg: RenderedMessage,
  event: P2PChatEvent
): RenderedMessage {
  // Clone shallowly so React detects the changed reference.
  const next: RenderedMessage = {
    ...msg,
    reactions: { ...msg.reactions },
  };

  if (event.eventType === 'edit') {
    // Only the original author may edit their own message.
    if (event.authorAddress !== msg.authorAddress) return msg;
    next.content = event.content;
    next.isEdited = true;
    next.editedAt = event.timestamp;
  } else if (event.eventType === 'delete') {
    // Only the original author may delete their own message.
    if (event.authorAddress !== msg.authorAddress) return msg;
    next.isDeleted = true;
    next.content = '';
  } else if (event.eventType === 'reaction') {
    const emoji = event.content;
    const existing = next.reactions[emoji] ?? [];
    const idx = existing.indexOf(event.authorAddress);
    if (idx === -1) {
      // Add reaction.
      next.reactions[emoji] = [...existing, event.authorAddress];
    } else {
      // Toggle off — remove this author's reaction.
      const trimmed = existing.filter((_, i) => i !== idx);
      if (trimmed.length === 0) {
        delete next.reactions[emoji];
      } else {
        next.reactions[emoji] = trimmed;
      }
    }
  }

  return next;
}

/**
 * Reduces an unordered raw event log into a sorted RenderedMessage[].
 *
 * Algorithm:
 *  1. Sort all events by (timestamp, seq) ascending.
 *  2. First pass — process message events into a Map<id, RenderedMessage> and
 *     buffer non-message events whose targetId is not yet in the map (handles
 *     P2P out-of-order delivery).
 *  3. When a message event is processed, drain any pending events buffered for
 *     its id immediately.
 *  4. Events still in the pending buffer after the first pass are silently
 *     dropped (their target message never arrived — rare race condition).
 *  5. Return the map values sorted oldest-first.
 */
function foldEvents(rawEvents: P2PChatEvent[]): RenderedMessage[] {
  const sorted = [...rawEvents].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.seq - b.seq;
  });

  const rendered = new Map<string, RenderedMessage>();
  // Non-message events whose target hasn't been seen yet.
  const pending = new Map<string, P2PChatEvent[]>();

  for (const event of sorted) {
    if (event.eventType === 'message') {
      const msg: RenderedMessage = {
        id: event.id,
        chatId: event.chatId,
        authorAddress: event.authorAddress,
        authorPublicKey: event.authorPublicKey,
        seq: event.seq,
        timestamp: event.timestamp,
        content: event.content,
        isEdited: false,
        isDeleted: false,
        replyTo: event.replyTo,
        reactions: {},
        originalEvent: event,
      };
      rendered.set(event.id, msg);

      // Drain any buffered events that referenced this message.
      const buffered = pending.get(event.id);
      if (buffered) {
        let current = msg;
        for (const bufferedEvent of buffered) {
          current = applyEventToMessage(current, bufferedEvent);
        }
        rendered.set(event.id, current);
        pending.delete(event.id);
      }
    } else {
      // edit / delete / reaction — needs a targetId.
      const targetId = event.targetId;
      if (!targetId) continue;

      const target = rendered.get(targetId);
      if (target) {
        rendered.set(targetId, applyEventToMessage(target, event));
      } else {
        // Target not seen yet — buffer and apply once it arrives.
        const buf = pending.get(targetId) ?? [];
        buf.push(event);
        pending.set(targetId, buf);
      }
    }
  }

  return [...rendered.values()].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.seq - b.seq;
  });
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseP2PChatReturn {
  /** Rendered messages for this chat, sorted oldest-first. */
  messages: RenderedMessage[];
  /** True while a send is in-flight. */
  isSending: boolean;
  /** Addresses that are currently typing (excluding the local user). */
  typingUsers: Set<string>;
  /** True once history is loaded and the channel is subscribed. */
  isReady: boolean;
  /** Send a plain-text message. */
  sendMessage: (text: string) => Promise<void>;
  /** Edit the content of a previously sent message (author-only). */
  sendEdit: (targetId: string, newContent: string) => Promise<void>;
  /** Delete a previously sent message (author-only). */
  sendDelete: (targetId: string) => Promise<void>;
  /** Toggle an emoji reaction on any message. */
  sendReaction: (targetId: string, emoji: string) => Promise<void>;
  /** Reply to a parent message. */
  sendReply: (parentId: string, text: string) => Promise<void>;
  /** Call on every keystroke; internally debounced to avoid flooding the network. */
  notifyTyping: () => void;
}

/**
 * Subscribes to `chatId`, loads history, and streams live events.
 * Safe to call before `window.chat` is available — returns empty state
 * and no-ops until both the API and `userInfo` are present.
 */
export function useP2PChat(chatId: string): UseP2PChatReturn {
  const userInfo = useAtomValue(userInfoAtom);

  const [messages, setMessages] = useState<RenderedMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [isReady, setIsReady] = useState(false);

  /** Full unfolded event log — source of truth for re-folding. */
  const rawEventsRef = useRef<P2PChatEvent[]>([]);

  /** Per-author monotonic sequence counter for messages this session sends. */
  const nextSeqRef = useRef(1);

  /** Debounce handle — prevents flooding the network with typing events. */
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Subscribe, load history, and wire live listeners ──────────────────────

  useEffect(() => {
    if (!window.chat || !userInfo?.address || !userInfo?.publicKey) return;

    let cancelled = false;
    let unsubEvent: (() => void) | null = null;
    let unsubTyping: (() => void) | null = null;

    (async () => {
      try {
        // Register our address so DMs addressed to us are auto-accepted.
        await window.chat!.setLocalAddresses([userInfo.address]);

        // Subscribe — announces to peers and requests a sync of missed events.
        await window.chat!.subscribe(chatId);

        // Pull full history (all event types).
        const history = await window.chat!.getHistory(chatId, HISTORY_LIMIT);
        if (cancelled) return;

        // Derive the starting sequence number from our own messages.
        let maxSeq = 0;
        for (const ev of history) {
          if (ev.authorAddress === userInfo.address && ev.seq > maxSeq) {
            maxSeq = ev.seq;
          }
        }
        nextSeqRef.current = maxSeq + 1;

        rawEventsRef.current = history;
        setMessages(foldEvents(history));

        // Live event stream — append new events and re-fold.
        unsubEvent = window.chat!.onEvent(({ event }) => {
          // Ignore events for other channels — each useP2PChat instance is
          // scoped to exactly one chatId.
          if (event.chatId !== chatId) return;
          if (!rawEventsRef.current.some((e) => e.id === event.id)) {
            rawEventsRef.current = [...rawEventsRef.current, event];
          }
          setMessages(foldEvents(rawEventsRef.current));

          if (
            event.authorAddress === userInfo.address &&
            event.seq >= nextSeqRef.current
          ) {
            nextSeqRef.current = event.seq + 1;
          }
        });

        // Typing indicators.
        unsubTyping = window.chat!.onTyping(({ authorAddress, active }) => {
          if (authorAddress === userInfo.address) return;
          setTypingUsers((prev) => {
            const next = new Set(prev);
            if (active) next.add(authorAddress);
            else next.delete(authorAddress);
            return next;
          });
        });

        if (!cancelled) setIsReady(true);
      } catch (err) {
        console.error('[useP2PChat] Setup failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      unsubEvent?.();
      unsubTyping?.();
      window.chat?.unsubscribe(chatId).catch(() => {});
    };
  }, [chatId, userInfo?.address, userInfo?.publicKey]);

  // ── Internal helper: build, sign, and dispatch any chat event ────────────

  const dispatchEvent = useCallback(
    async (
      fields: Omit<P2PChatEvent, 'signature'>
    ): Promise<void> => {
      const signedFields: Record<string, unknown> = {
        authorAddress: fields.authorAddress,
        authorPublicKey: fields.authorPublicKey,
        chatId: fields.chatId,
        content: fields.content,
        eventType: fields.eventType,
        id: fields.id,
        seq: fields.seq,
        timestamp: fields.timestamp,
      };
      // Include optional fields in the signed payload only when present, so
      // they match what buildChatSignedData() in electron/src/chat.ts produces.
      if (fields.targetId !== undefined) signedFields.targetId = fields.targetId;
      if (fields.replyTo !== undefined) signedFields.replyTo = fields.replyTo;

      const signature = await signChatFields(signedFields);
      const event: P2PChatEvent = { ...fields, signature };

      const result = await window.chat!.sendEvent({ type: 'CHAT_EVENT', event });
      if (!result.success) {
        console.error('[useP2PChat] sendEvent rejected:', result.error);
      }
    },
    // chatId is not a dep here — callers pass it explicitly via `fields`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── sendMessage ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!window.chat || !userInfo?.address || !userInfo?.publicKey) {
        console.warn('[useP2PChat] Cannot send: chat API or userInfo not ready');
        return;
      }

      setIsSending(true);
      try {
        const seq = nextSeqRef.current;
        nextSeqRef.current = seq + 1;

        await dispatchEvent({
          id: crypto.randomUUID(),
          chatId,
          eventType: 'message',
          authorAddress: userInfo.address,
          authorPublicKey: userInfo.publicKey,
          seq,
          timestamp: Date.now(),
          content: trimmed,
        });
      } catch (err) {
        console.error('[useP2PChat] sendMessage error:', err);
      } finally {
        setIsSending(false);
      }
    },
    [chatId, userInfo?.address, userInfo?.publicKey, dispatchEvent]
  );

  // ── sendEdit ──────────────────────────────────────────────────────────────

  const sendEdit = useCallback(
    async (targetId: string, newContent: string): Promise<void> => {
      const trimmed = newContent.trim();
      if (!trimmed || !window.chat || !userInfo?.address || !userInfo?.publicKey)
        return;

      setIsSending(true);
      try {
        const seq = nextSeqRef.current;
        nextSeqRef.current = seq + 1;

        await dispatchEvent({
          id: crypto.randomUUID(),
          chatId,
          eventType: 'edit',
          authorAddress: userInfo.address,
          authorPublicKey: userInfo.publicKey,
          seq,
          timestamp: Date.now(),
          content: trimmed,
          targetId,
        });
      } catch (err) {
        console.error('[useP2PChat] sendEdit error:', err);
      } finally {
        setIsSending(false);
      }
    },
    [chatId, userInfo?.address, userInfo?.publicKey, dispatchEvent]
  );

  // ── sendDelete ────────────────────────────────────────────────────────────

  const sendDelete = useCallback(
    async (targetId: string): Promise<void> => {
      if (!window.chat || !userInfo?.address || !userInfo?.publicKey) return;

      setIsSending(true);
      try {
        const seq = nextSeqRef.current;
        nextSeqRef.current = seq + 1;

        await dispatchEvent({
          id: crypto.randomUUID(),
          chatId,
          eventType: 'delete',
          authorAddress: userInfo.address,
          authorPublicKey: userInfo.publicKey,
          seq,
          timestamp: Date.now(),
          content: '',
          targetId,
        });
      } catch (err) {
        console.error('[useP2PChat] sendDelete error:', err);
      } finally {
        setIsSending(false);
      }
    },
    [chatId, userInfo?.address, userInfo?.publicKey, dispatchEvent]
  );

  // ── sendReaction ──────────────────────────────────────────────────────────

  const sendReaction = useCallback(
    async (targetId: string, emoji: string): Promise<void> => {
      if (!emoji || !window.chat || !userInfo?.address || !userInfo?.publicKey)
        return;

      setIsSending(true);
      try {
        const seq = nextSeqRef.current;
        nextSeqRef.current = seq + 1;

        await dispatchEvent({
          id: crypto.randomUUID(),
          chatId,
          eventType: 'reaction',
          authorAddress: userInfo.address,
          authorPublicKey: userInfo.publicKey,
          seq,
          timestamp: Date.now(),
          content: emoji,
          targetId,
        });
      } catch (err) {
        console.error('[useP2PChat] sendReaction error:', err);
      } finally {
        setIsSending(false);
      }
    },
    [chatId, userInfo?.address, userInfo?.publicKey, dispatchEvent]
  );

  // ── sendReply ─────────────────────────────────────────────────────────────

  const sendReply = useCallback(
    async (parentId: string, text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || !window.chat || !userInfo?.address || !userInfo?.publicKey)
        return;

      setIsSending(true);
      try {
        const seq = nextSeqRef.current;
        nextSeqRef.current = seq + 1;

        await dispatchEvent({
          id: crypto.randomUUID(),
          chatId,
          eventType: 'message',
          authorAddress: userInfo.address,
          authorPublicKey: userInfo.publicKey,
          seq,
          timestamp: Date.now(),
          content: trimmed,
          replyTo: parentId,
        });
      } catch (err) {
        console.error('[useP2PChat] sendReply error:', err);
      } finally {
        setIsSending(false);
      }
    },
    [chatId, userInfo?.address, userInfo?.publicKey, dispatchEvent]
  );

  // ── notifyTyping ──────────────────────────────────────────────────────────

  const notifyTyping = useCallback(() => {
    if (!window.chat || !userInfo?.address) return;
    if (typingTimerRef.current !== null) return;
    window.chat.sendTyping(chatId, userInfo.address).catch(() => {});
    typingTimerRef.current = setTimeout(() => {
      typingTimerRef.current = null;
    }, TYPING_DEBOUNCE_MS);
  }, [chatId, userInfo?.address]);

  return {
    messages,
    isSending,
    typingUsers,
    isReady,
    sendMessage,
    sendEdit,
    sendDelete,
    sendReaction,
    sendReply,
    notifyTyping,
  };
}

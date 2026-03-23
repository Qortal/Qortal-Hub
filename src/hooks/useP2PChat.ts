/**
 * useP2PChat — React hook for the P2P Hub chat protocol.
 *
 * Manages the full lifecycle for a single chat channel:
 *   - Subscribes to the channel and loads history on mount.
 *   - Streams incoming events via window.chat.onEvent.
 *   - Handles typing indicators (incoming display + outgoing debounce).
 *   - Provides sendMessage() which builds, signs, and dispatches a ChatEvent.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseP2PChatReturn {
  /** Messages for this chat, sorted oldest-first. */
  messages: P2PChatEvent[];
  /** True while a send is in-flight. */
  isSending: boolean;
  /** Addresses that are currently typing (excluding the local user). */
  typingUsers: Set<string>;
  /** True once history is loaded and the channel is subscribed. */
  isReady: boolean;
  /** Send a plain-text message. Resolves when the IPC call completes. */
  sendMessage: (text: string) => Promise<void>;
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

  const [messages, setMessages] = useState<P2PChatEvent[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [isReady, setIsReady] = useState(false);

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

        // Pull full history.
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

        setMessages(history);

        // Live event stream.
        unsubEvent = window.chat!.onEvent(({ event }) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === event.id)) return prev; // dedup
            const next = [...prev, event];
            next.sort((a, b) => {
              if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
              return a.seq - b.seq;
            });
            return next;
          });
          // Keep local seq in sync if we receive our own echoed message.
          if (
            event.authorAddress === userInfo.address &&
            event.seq >= nextSeqRef.current
          ) {
            nextSeqRef.current = event.seq + 1;
          }
        });

        // Typing indicators.
        unsubTyping = window.chat!.onTyping(({ authorAddress, active }) => {
          if (authorAddress === userInfo.address) return; // skip own indicator
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
      // Unsubscribe when component unmounts (e.g., window closed).
      window.chat?.unsubscribe(chatId).catch(() => {});
    };
  }, [chatId, userInfo?.address, userInfo?.publicKey]);

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
        const eventId = crypto.randomUUID();
        const seq = nextSeqRef.current;
        const timestamp = Date.now();

        // The fields that are signed — keys must match what electron/src/chat.ts
        // includes in buildChatSignedData() so the validator accepts the message.
        const signedFields: Record<string, unknown> = {
          authorAddress: userInfo.address,
          authorPublicKey: userInfo.publicKey,
          chatId,
          content: trimmed,
          eventType: 'message',
          id: eventId,
          seq,
          timestamp,
        };

        const signature = await signChatFields(signedFields);

        // Optimistically bump the local counter before the round-trip completes.
        nextSeqRef.current = seq + 1;

        const event: P2PChatEvent = {
          id: eventId,
          chatId,
          eventType: 'message',
          authorAddress: userInfo.address,
          authorPublicKey: userInfo.publicKey,
          seq,
          timestamp,
          content: trimmed,
          signature,
        };

        const result = await window.chat!.sendEvent({
          type: 'CHAT_EVENT',
          event,
        });

        if (!result.success) {
          console.error('[useP2PChat] sendEvent rejected:', result.error);
        }
      } catch (err) {
        console.error('[useP2PChat] sendMessage error:', err);
      } finally {
        setIsSending(false);
      }
    },
    [chatId, userInfo?.address, userInfo?.publicKey]
  );

  // ── notifyTyping ──────────────────────────────────────────────────────────

  const notifyTyping = useCallback(() => {
    if (!window.chat || !userInfo?.address) return;
    // Only send once per TYPING_DEBOUNCE_MS burst to avoid network flooding.
    if (typingTimerRef.current !== null) return;
    window.chat.sendTyping(chatId, userInfo.address).catch(() => {});
    typingTimerRef.current = setTimeout(() => {
      typingTimerRef.current = null;
    }, TYPING_DEBOUNCE_MS);
  }, [chatId, userInfo?.address]);

  return { messages, isSending, typingUsers, isReady, sendMessage, notifyTyping };
}

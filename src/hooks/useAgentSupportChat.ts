/**
 * useAgentSupportChat — agent-side support chat hook.
 *
 * Responsibilities:
 *
 *   Queue watcher
 *   - On mount, permanently subscribes to "support:queue" (never unsubscribes).
 *   - Listens to all incoming chat events via window.chat.onEvent, filtering
 *     for chatId === "support:queue".  Each knock adds a ticket (dedup by
 *     userAddress) and subscribes the agent to the user's private channel in
 *     the background so events accumulate even when the ticket is not active.
 *
 *   Active ticket
 *   - Exactly one ticket is "active" at a time (the one being viewed).
 *   - Delegates to useP2PChat(activeTicketChatId) for message folding,
 *     typing indicators, send/edit/delete/reaction/reply, and sync.
 *
 *   Encryption
 *   - All messages are encrypted/decrypted using the shared support keypair.
 *   - The ECDH secret per ticket is always ECDH(SUPPORT_PRIVATE_KEY, ticket.userPublicKey).
 *     This means the senderPublicKey passed to decryptSupportMessage is always
 *     ticket.userPublicKey — NOT the message author's key — because the secret
 *     is keyed to the user, not the sender of each individual message.
 *
 *   Close (resolve)
 *   - resolveTicket() encrypts the JSON marker {"__type":"support-close"} and
 *     sends it on the active ticket's channel.  The user-side useSupportChat
 *     hook detects this marker and shows the "Resolved" badge.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { userInfoAtom } from '../atoms/global';
import { useP2PChat } from './useP2PChat';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SupportTicket {
  /** Qortal address of the user who knocked. */
  userAddress: string;
  /** Base58 Ed25519 public key from the knock event — anchors decryption key. */
  userPublicKey: string;
  /** "support:<userAddress>" */
  chatId: string;
  /** Unix ms timestamp of the first knock from this user. */
  knockedAt: number;
  /** True once a close marker has been sent on this ticket. */
  isResolved: boolean;
  /** True while the user is blocked. Ticket is kept in memory so unblock restores it. */
  isBlocked: boolean;
}

export interface UseAgentSupportChatReturn {
  tickets: SupportTicket[];
  activeTicketChatId: string | null;
  setActiveTicket: (chatId: string | null) => void;
  /** Rendered, decrypted messages for the active ticket. */
  messages: RenderedMessage[];
  isReady: boolean;
  isSending: boolean;
  typingUsers: Set<string>;
  /** eventId → set of reader addresses (query-scoped, from useP2PChat). */
  readReceipts: Map<string, Set<string>>;
  /** Mark a list of event IDs as read by the current agent address. */
  markMessagesRead: (eventIds: string[]) => void;
  sendMessage: (text: string) => Promise<void>;
  sendEdit: (targetId: string, newContent: string) => Promise<void>;
  sendDelete: (targetId: string) => Promise<void>;
  sendReaction: (targetId: string, emoji: string) => Promise<void>;
  sendReply: (parentId: string, text: string) => Promise<void>;
  notifyTyping: () => void;
  /** Sends the support-close marker on the active ticket, then marks it resolved. */
  resolveTicket: () => Promise<void>;
  /** Addresses the agent has blocked. Persisted to appStorage. */
  blockedAddresses: Set<string>;
  /** Block a user — removes their ticket and ignores future knocks. */
  blockUser: (userAddress: string) => Promise<void>;
  /** Unblock a previously blocked address. */
  unblockUser: (userAddress: string) => Promise<void>;
}

// ── Background IPC helpers ────────────────────────────────────────────────────

async function encryptForUser(
  text: string,
  recipientPublicKey: string
): Promise<string> {
  const result = await (window as any).sendMessage(
    'encryptSupportMessage',
    { text, isAgent: true, recipientPublicKey },
    10_000
  );
  if (result?.error) throw new Error(String(result.error));
  if (typeof result?.encryptedData !== 'string') {
    throw new Error('encryptSupportMessage returned no encryptedData');
  }
  return result.encryptedData as string;
}

async function decryptFromUser(
  encryptedData: string,
  userPublicKey: string
): Promise<string | null> {
  const result = await (window as any).sendMessage(
    'decryptSupportMessage',
    { encryptedData, isAgent: true, senderPublicKey: userPublicKey },
    10_000
  );
  if (result?.error) return null;
  if (typeof result?.decryptedText !== 'string') return null;
  return result.decryptedText as string;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

const SUPPORT_QUEUE_ID = 'support:queue';
const SUPPORT_CLOSE_TYPE = 'support-close';
const BLOCKED_STORAGE_KEY = 'support:blockedAddresses';

export function useAgentSupportChat(): UseAgentSupportChatReturn {
  const userInfo = useAtomValue(userInfoAtom);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [activeTicketChatId, setActiveTicket] = useState<string | null>(null);

  /** Stable reference to tickets for use inside closures without stale state. */
  const ticketsRef = useRef<SupportTicket[]>([]);
  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  // ── Block list ────────────────────────────────────────────────────────────

  const [blockedAddresses, setBlockedAddresses] = useState<Set<string>>(new Set());

  /** Ref kept in sync so the queue onEvent closure never sees stale blocked set. */
  const blockedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    blockedRef.current = blockedAddresses;
  }, [blockedAddresses]);

  // Load persisted block list on mount.
  useEffect(() => {
    window.appStorage?.get(BLOCKED_STORAGE_KEY).then((stored: unknown) => {
      if (Array.isArray(stored) && stored.length > 0) {
        const set = new Set<string>(stored.filter((v): v is string => typeof v === 'string'));
        setBlockedAddresses(set);
      }
    }).catch(() => {});
  }, []);

  // ── Permanent queue subscription ─────────────────────────────────────────

  useEffect(() => {
    if (!window.chat || !userInfo?.address) return;

    window.chat.subscribe(SUPPORT_QUEUE_ID).catch(() => {});

    const unsub = window.chat.onEvent(({ event }) => {
      if (event.chatId !== SUPPORT_QUEUE_ID) return;

      const { authorAddress, authorPublicKey, timestamp } = event;
      if (!authorAddress || !authorPublicKey) return;

      // Silently ignore knocks from blocked addresses.
      if (blockedRef.current.has(authorAddress)) return;

      const chatId = `support:${authorAddress}`;

      // Dedup: ignore if we already have a ticket for this user.
      if (ticketsRef.current.some((t) => t.userAddress === authorAddress)) return;

      // Subscribe to the user's private channel so events accumulate.
      window.chat?.subscribe(chatId).catch(() => {});

      const ticket: SupportTicket = {
        userAddress: authorAddress,
        userPublicKey: authorPublicKey,
        chatId,
        knockedAt: timestamp,
        isResolved: false,
        isBlocked: false,
      };

      setTickets((prev) => [...prev, ticket]);

      // Auto-select the first ticket if none is active.
      setActiveTicket((prev) => prev ?? chatId);
    });

    return () => {
      unsub?.();
      // Deliberately do NOT unsubscribe from support:queue on unmount so a
      // brief remount (e.g. hot-reload) doesn't miss knocks.
      //
      // DO clear the queue rate-limit map so that re-knocks from users are
      // accepted immediately when the agent logs back in, rather than being
      // silently dropped by a stale cooldown entry.
      window.chat?.clearQueueRateLimit().catch(() => {});
    };
  }, [userInfo?.address]);

  // ── Active ticket: raw messages from useP2PChat ───────────────────────────

  const innerChatId = activeTicketChatId ?? 'support:__placeholder__';
  const inner = useP2PChat(innerChatId);

  /** Derive the active ticket object from the chatId. */
  const activeTicket = tickets.find((t) => t.chatId === activeTicketChatId) ?? null;

  // ── Decryption ────────────────────────────────────────────────────────────

  const [decryptedMessages, setDecryptedMessages] = useState<RenderedMessage[]>([]);

  /**
   * Cache: "<eventId>:<editedAt|0>" → decrypted text.
   * Per active ticket — cleared when ticket switches.
   */
  const decryptCacheRef = useRef(new Map<string, string>());

  /**
   * Cache: encryptedEmojiCiphertext → decrypted emoji character.
   * Per active ticket — cleared when ticket switches.
   */
  const reactionDecryptCacheRef = useRef(new Map<string, string>());

  // Clear both caches when the active ticket changes.
  useEffect(() => {
    decryptCacheRef.current = new Map();
    reactionDecryptCacheRef.current = new Map();
  }, [activeTicketChatId]);

  useEffect(() => {
    if (!activeTicket) {
      setDecryptedMessages([]);
      return;
    }

    const userPubKey = activeTicket.userPublicKey;
    let cancelled = false;

    const processMessages = async () => {
      const cache = decryptCacheRef.current;
      const reactionCache = reactionDecryptCacheRef.current;
      const results: RenderedMessage[] = [];

      /**
       * Decrypt the emoji keys in a reactions map and re-group addresses under
       * the plaintext emoji.  Multiple senders encrypting the same emoji each
       * produce a different ciphertext (random nonce), so we decrypt each key
       * individually and merge under the common plaintext.
       */
      const decryptReactions = async (
        reactions: Record<string, string[]>
      ): Promise<Record<string, string[]>> => {
        const out: Record<string, string[]> = {};
        for (const [encKey, addresses] of Object.entries(reactions)) {
          let emoji = reactionCache.get(encKey);
          if (emoji === undefined) {
            const dec = await decryptFromUser(encKey, userPubKey);
            emoji = dec ?? encKey; // fallback: show ciphertext rather than nothing
            reactionCache.set(encKey, emoji);
          }
          if (cancelled) return out;
          out[emoji] = [...(out[emoji] ?? []), ...addresses];
        }
        return out;
      };

      for (const msg of inner.messages) {
        if (msg.isDeleted) {
          const reactions = await decryptReactions(msg.reactions);
          if (cancelled) return;
          results.push({ ...msg, reactions });
          continue;
        }

        const cacheKey = `${msg.id}:${msg.editedAt ?? 0}`;
        const cached = cache.get(cacheKey);

        if (cached !== undefined) {
          if (cached !== '__support-close__') {
            const reactions = await decryptReactions(msg.reactions);
            if (cancelled) return;
            results.push({ ...msg, content: cached, reactions });
          }
          continue;
        }

        try {
          // Always use the ticket user's public key as the key anchor —
          // NOT msg.authorPublicKey — because the shared secret is keyed to
          // the user, not whichever account sent a given message.
          const decrypted = await decryptFromUser(msg.content, userPubKey);
          if (cancelled) return;

          if (decrypted !== null) {
            // Hide close marker from the message list (the UI shows a badge instead).
            try {
              const parsed = JSON.parse(decrypted);
              if (parsed.__type === SUPPORT_CLOSE_TYPE) {
                cache.set(cacheKey, '__support-close__');
                continue;
              }
            } catch {
              // Not JSON — treat as plain text.
            }
            const reactions = await decryptReactions(msg.reactions);
            if (cancelled) return;
            cache.set(cacheKey, decrypted);
            results.push({ ...msg, content: decrypted, reactions });
          } else {
            const reactions = await decryptReactions(msg.reactions);
            if (cancelled) return;
            cache.set(cacheKey, '[encrypted]');
            results.push({ ...msg, content: '[encrypted]', reactions });
          }
        } catch {
          if (cancelled) return;
          results.push({ ...msg, content: '[encrypted]' });
        }
      }

      if (!cancelled) setDecryptedMessages(results);
    };

    processMessages();
    return () => { cancelled = true; };
  }, [inner.messages, activeTicket]);

  // ── Encrypted send wrappers ───────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || !activeTicket) return;
      const encrypted = await encryptForUser(trimmed, activeTicket.userPublicKey);
      await inner.sendMessage(encrypted);
    },
    [inner.sendMessage, activeTicket]
  );

  const sendEdit = useCallback(
    async (targetId: string, newContent: string): Promise<void> => {
      const trimmed = newContent.trim();
      if (!trimmed || !activeTicket) return;
      const encrypted = await encryptForUser(trimmed, activeTicket.userPublicKey);
      await inner.sendEdit(targetId, encrypted);
    },
    [inner.sendEdit, activeTicket]
  );

  const sendReply = useCallback(
    async (parentId: string, text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || !activeTicket) return;
      const encrypted = await encryptForUser(trimmed, activeTicket.userPublicKey);
      await inner.sendReply(parentId, encrypted);
    },
    [inner.sendReply, activeTicket]
  );

  const sendReaction = useCallback(
    async (targetId: string, emoji: string): Promise<void> => {
      if (!emoji || !activeTicket) return;
      const encrypted = await encryptForUser(emoji, activeTicket.userPublicKey);
      await inner.sendReaction(targetId, encrypted);
    },
    [inner.sendReaction, activeTicket]
  );

  // ── Block / unblock ───────────────────────────────────────────────────────

  const blockUser = useCallback(async (userAddress: string): Promise<void> => {
    setBlockedAddresses((prev) => {
      const next = new Set(prev);
      next.add(userAddress);
      window.appStorage?.set(BLOCKED_STORAGE_KEY, [...next]).catch(() => {});
      return next;
    });
    // Mark the ticket as blocked (keep it in memory so unblock restores it),
    // then deselect if it was active.
    setTickets((prev) =>
      prev.map((t) =>
        t.userAddress === userAddress ? { ...t, isBlocked: true } : t
      )
    );
    setActiveTicket((prev) => {
      if (prev === `support:${userAddress}`) return null;
      return prev;
    });
  }, []);

  const unblockUser = useCallback(async (userAddress: string): Promise<void> => {
    setBlockedAddresses((prev) => {
      const next = new Set(prev);
      next.delete(userAddress);
      window.appStorage?.set(BLOCKED_STORAGE_KEY, [...next]).catch(() => {});
      return next;
    });
    // Restore the ticket so the conversation is visible again.
    setTickets((prev) =>
      prev.map((t) =>
        t.userAddress === userAddress ? { ...t, isBlocked: false } : t
      )
    );
  }, []);

  // ── Resolve ticket ────────────────────────────────────────────────────────

  const resolveTicket = useCallback(async (): Promise<void> => {
    if (!activeTicket) return;
    const marker = JSON.stringify({ __type: SUPPORT_CLOSE_TYPE });
    const encrypted = await encryptForUser(marker, activeTicket.userPublicKey);
    await inner.sendMessage(encrypted);
    // Mark locally so the UI reflects the resolved state immediately.
    setTickets((prev) =>
      prev.map((t) =>
        t.chatId === activeTicket.chatId ? { ...t, isResolved: true } : t
      )
    );
  }, [inner.sendMessage, activeTicket]);

  return {
    tickets,
    activeTicketChatId,
    setActiveTicket,
    messages: decryptedMessages,
    isReady: inner.isReady,
    isSending: inner.isSending,
    typingUsers: inner.typingUsers,
    readReceipts: inner.readReceipts,
    markMessagesRead: inner.markMessagesRead,
    sendMessage,
    sendEdit,
    sendDelete: inner.sendDelete,
    sendReaction,
    sendReply,
    notifyTyping: inner.notifyTyping,
    resolveTicket,
    blockedAddresses,
    blockUser,
    unblockUser,
  };
}

/**
 * useSupportChat — encrypted support chat hook.
 *
 * Wraps useP2PChat with the support-specific encryption layer:
 *
 *   - On mount: posts one unencrypted knock to "support:queue" so agents
 *     discover the user.  Immediately unsubscribes from the queue channel
 *     after posting (the user never needs to receive queue events).
 *
 *   - Subscribes to "support:<userAddress>" for the actual conversation via
 *     the underlying useP2PChat hook.
 *
 *   - Intercepts sendMessage / sendEdit / sendReply to encrypt outgoing text
 *     via the 'encryptSupportMessage' background case before passing it to
 *     the network layer.
 *
 *   - Post-processes incoming messages: each message's content is decrypted
 *     via the 'decryptSupportMessage' background case.  Results are cached by
 *     (eventId, editedAt) to avoid re-decrypting on every render.
 *
 *   - Detects the close marker { "__type": "support-close" } in decrypted
 *     content.  When the close marker is the most recent activity, isClosed
 *     is set to true.  Close-marker messages are hidden from the message list.
 *
 *   - When isClosed and the user sends a new message, a fresh knock is
 *     automatically posted to the queue before the message is dispatched,
 *     so agents are notified of the re-open request.
 *
 *   - Watches the presence of SUPPORT_ADDRESSES via useOnlineAddresses.  When
 *     any agent is online and its individual per-agent cooldown (2 min) has
 *     elapsed since the last knock sent while that agent was online, a fresh
 *     knock is posted.  When an agent goes offline their cooldown entry is
 *     cleared so their next appearance triggers an immediate re-knock.  This
 *     means a newly-logged-in agent always gets a knock within one heartbeat
 *     cycle (~25 s), regardless of when other agents last received one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { userInfoAtom } from '../atoms/global';
import { useP2PChat, UseP2PChatReturn } from './useP2PChat';
import { useOnlineAddresses } from './usePresence';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Hard-coded support agent addresses.  Exported so SupportChat.tsx and App.tsx
 * can check whether the logged-in user is an agent without importing the full
 * component tree.
 */
export const SUPPORT_ADDRESSES = [
  'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
  'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
] as const;

/**
 * Addresses for the group call test environment.
 * These same addresses are agents in the group call test.
 * For production, this list should be expanded.
 */
export const GROUP_SUPPORT_ADDRESSES = [
  'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
  'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
] as const;

const SUPPORT_QUEUE_ID = 'support:queue';

/** JSON marker sent by an agent to signal that the support ticket is resolved. */
const SUPPORT_CLOSE_TYPE = 'support-close';

// ── Background IPC helpers ────────────────────────────────────────────────────

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

async function encryptForSupport(
  text: string,
  recipientPublicKey?: string
): Promise<string> {
  const result = await (window as any).sendMessage(
    'encryptSupportMessage',
    { text, ...(recipientPublicKey ? { recipientPublicKey } : {}) },
    10_000
  );
  if (result?.error) throw new Error(String(result.error));
  if (typeof result?.encryptedData !== 'string') {
    throw new Error('encryptSupportMessage returned no encryptedData');
  }
  return result.encryptedData as string;
}

async function encryptAttachmentForSupport(
  data: string,
  recipientPublicKey?: string
): Promise<string> {
  const result = await (window as any).sendMessage(
    'encryptSupportAttachment',
    { data, ...(recipientPublicKey ? { recipientPublicKey } : {}) },
    30_000
  );
  if (result?.error) throw new Error(String(result.error));
  if (typeof result?.encryptedData !== 'string') {
    throw new Error('encryptSupportAttachment returned no encryptedData');
  }
  return result.encryptedData as string;
}

export async function decryptAttachmentFromSupport(
  data: string,
  senderPublicKey: string,
  isAgent?: boolean
): Promise<string | null> {
  const result = await (window as any).sendMessage(
    'decryptSupportAttachment',
    { data, senderPublicKey, ...(isAgent ? { isAgent } : {}) },
    30_000
  );
  if (result?.error) return null;
  if (typeof result?.decryptedData !== 'string') return null;
  return result.decryptedData as string;
}

async function decryptFromSupport(
  encryptedData: string,
  senderPublicKey: string
): Promise<string | null> {
  const result = await (window as any).sendMessage(
    'decryptSupportMessage',
    { encryptedData, senderPublicKey },
    10_000
  );
  if (result?.error) return null;
  if (typeof result?.decryptedText !== 'string') return null;
  return result.decryptedText as string;
}

// ── Return type ───────────────────────────────────────────────────────────────

export interface UseSupportChatReturn extends UseP2PChatReturn {
  /**
   * True when the most recent visible activity in the conversation is a
   * support-close marker sent by an agent.  New messages from the user reset
   * this to false (since their timestamp becomes the latest activity).
   */
  isClosed: boolean;
  /** True when at least one support agent is currently online. */
  isAgentOnline: boolean;
  /**
   * Compress, encrypt, and send an image file as an attachment.
   * Handles Compressor.js compression, encryption, SHA-256 hash, and dispatch.
   */
  sendImage: (file: File, caption?: string) => Promise<void>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSupportChat(hasStarted = false): UseSupportChatReturn {
  const userInfo = useAtomValue(userInfoAtom);
  const myAddress = userInfo?.address ?? '';

  // Keep a stable chatId — useP2PChat has its own guard so this placeholder
  // is never subscribed while userInfo is absent.
  const privateChatId = myAddress
    ? `support:${myAddress}`
    : 'support:__placeholder__';

  const inner = useP2PChat(privateChatId);

  // ── Decryption state ──────────────────────────────────────────────────────

  const [decryptedMessages, setDecryptedMessages] = useState<RenderedMessage[]>(
    []
  );
  const [isClosed, setIsClosed] = useState(false);

  /**
   * Cache: cacheKey → decrypted plaintext.
   * cacheKey = "<eventId>:<editedAt|0>" so edits bust the cache automatically.
   * A special sentinel "__support-close__" marks close-marker messages; they
   * are excluded from the rendered list.
   */
  const decryptCacheRef = useRef(new Map<string, string>());

  /**
   * Cache: encryptedEmojiCiphertext → decrypted emoji character.
   * Because nacl.secretbox uses a random nonce, the same emoji encrypted by
   * different senders produces different ciphertexts, so we cache each
   * ciphertext individually and re-group by the decrypted emoji when building
   * the reactions map.
   */
  const reactionDecryptCacheRef = useRef(new Map<string, string>());

  // ── Queue knock ───────────────────────────────────────────────────────────

  /**
   * Timestamp of the most recent knock sent this session (ms).
   * 0 means no knock has been sent yet (initial knock guard).
   */
  const lastKnockAtRef = useRef<number>(0);

  /**
   * Per-agent knock timestamp map.
   * key  : agent address (from SUPPORT_ADDRESSES)
   * value: Date.now() of the last knock sent while that agent was online.
   *
   * An absent entry means we have never sent a knock that this specific agent
   * was online to receive — so the next presence update triggers an immediate
   * re-knock regardless of the global cooldown.
   *
   * Entries are deleted when an agent goes offline so that their next
   * appearance also triggers an immediate re-knock.
   */
  const agentKnockTimesRef = useRef(new Map<string, number>());

  /** Minimum gap before re-knocking the same agent again (2 minutes). */
  const KNOCK_COOLDOWN_MS = 2 * 60 * 1_000;

  // ── Presence-based re-knock ───────────────────────────────────────────────

  const onlineAddresses = useOnlineAddresses();

  /** True when at least one support agent is currently online. */
  const isAgentOnline = useMemo(
    () => SUPPORT_ADDRESSES.some((addr) => onlineAddresses.has(addr)),
    [onlineAddresses]
  );

  /** Posts a signed "support-request" message to the public queue channel. */
  const postQueueKnock = useCallback(
    async (addr: string, pubKey: string): Promise<void> => {
      if (!window.chat) return;
      const id = crypto.randomUUID();
      // Use the current timestamp as seq — always a positive integer, always
      // increasing, and guaranteed unique per knock. The queue channel uses
      // event.id (UUID) for dedup, not seq, so this is safe.
      const timestamp = Date.now();
      const fields: Record<string, unknown> = {
        authorAddress: addr,
        authorPublicKey: pubKey,
        chatId: SUPPORT_QUEUE_ID,
        content: JSON.stringify({ type: 'support-request' }),
        eventType: 'message',
        id,
        seq: timestamp,
        timestamp,
      };
      const signature = await signChatFields(fields);
      await window.chat.sendEvent({
        type: 'CHAT_EVENT',
        event: { ...(fields as any), signature },
      });
      // Unsubscribe immediately — the user has no need to receive queue events.
      window.chat.unsubscribe(SUPPORT_QUEUE_ID).catch(() => {});
    },
    []
  );

  // Post the initial knock once the user's identity and chat API are ready.
  // Also seeds agentKnockTimesRef for every agent that is already online so
  // the presence re-knock effect does not send a duplicate immediately after.
  useEffect(() => {
    if (!hasStarted) return;
    if (!myAddress || !userInfo?.publicKey || !window.chat) return;
    if (lastKnockAtRef.current !== 0) return;

    const now = Date.now();
    lastKnockAtRef.current = now;

    // Mark currently-online agents as "just knocked" so the presence effect
    // won't fire a second knock right after this one.
    for (const agentAddr of SUPPORT_ADDRESSES) {
      if (onlineAddresses.has(agentAddr)) {
        agentKnockTimesRef.current.set(agentAddr, now);
      }
    }

    postQueueKnock(myAddress, userInfo.publicKey).catch((err) => {
      console.error('[useSupportChat] Failed to post queue knock:', err);
      // Allow retry on the next render cycle.
      lastKnockAtRef.current = 0;
      agentKnockTimesRef.current.clear();
    });
  }, [hasStarted, myAddress, userInfo?.publicKey, postQueueKnock, onlineAddresses]);

  // Re-knock on a per-agent basis whenever onlineAddresses changes (~25 s heartbeat).
  //
  // For each support agent address:
  //   - If offline → delete their map entry so their next appearance triggers
  //     an immediate re-knock (no stale cooldown carried over).
  //   - If online  → knock if we have no entry for them (never knocked while
  //     they were online) or their individual cooldown has elapsed.
  //
  // One knock is sent even if multiple agents need one — the knock goes to
  // support:queue which all subscribed agents receive simultaneously.
  useEffect(() => {
    if (!hasStarted) return;
    if (!myAddress || !userInfo?.publicKey) return;
    if (isClosed) return;
    if (lastKnockAtRef.current === 0) return; // initial knock effect handles first knock

    const now = Date.now();
    let needsKnock = false;

    for (const agentAddr of SUPPORT_ADDRESSES) {
      if (!onlineAddresses.has(agentAddr)) {
        // Agent went offline — reset so their next appearance gets an immediate knock.
        agentKnockTimesRef.current.delete(agentAddr);
      } else {
        const lastKnocked = agentKnockTimesRef.current.get(agentAddr) ?? 0;
        if (now - lastKnocked >= KNOCK_COOLDOWN_MS) {
          needsKnock = true;
        }
      }
    }

    if (!needsKnock) return;

    // Update all currently-online agents' knock times before sending so that
    // concurrent effect runs don't fire duplicate knocks.
    for (const agentAddr of SUPPORT_ADDRESSES) {
      if (onlineAddresses.has(agentAddr)) {
        agentKnockTimesRef.current.set(agentAddr, now);
      }
    }

    postQueueKnock(myAddress, userInfo!.publicKey).catch(() => {});
  }, [hasStarted, onlineAddresses, myAddress, userInfo?.publicKey, isClosed, postQueueKnock]);

  // ── Decrypt incoming messages ─────────────────────────────────────────────

  useEffect(() => {
    if (!inner.messages.length) {
      setDecryptedMessages([]);
      setIsClosed(false);
      return;
    }

    let cancelled = false;

    const processMessages = async () => {
      const cache = decryptCacheRef.current;
      const reactionCache = reactionDecryptCacheRef.current;
      const results: RenderedMessage[] = [];
      let closedAt = 0;
      let lastActivityAt = 0;

      /**
       * Decrypt the emoji keys in a reactions map and re-group addresses under
       * the plaintext emoji.  Because each sender uses a fresh nonce, the same
       * emoji from different senders produces different ciphertexts — so we
       * decrypt each key individually and merge.
       *
       * In user mode the senderPublicKey is ignored by the background case
       * (the shared secret is always ECDH(userPrivKey, SUPPORT_PUBLIC_KEY)),
       * so we can pass an empty string.
       */
      const decryptReactions = async (
        reactions: Record<string, string[]>
      ): Promise<Record<string, string[]>> => {
        const out: Record<string, string[]> = {};
        for (const [encKey, addresses] of Object.entries(reactions)) {
          let emoji = reactionCache.get(encKey);
          if (emoji === undefined) {
            const dec = await decryptFromSupport(encKey, '');
            emoji = dec ?? encKey; // fallback: show ciphertext rather than nothing
            reactionCache.set(encKey, emoji);
          }
          if (cancelled) return out;
          out[emoji] = [...(out[emoji] ?? []), ...addresses];
        }
        return out;
      };

      for (const msg of inner.messages) {
        // Deleted messages have no text content to decrypt, but may still
        // carry reactions that need to be decrypted.
        if (msg.isDeleted) {
          if (msg.timestamp > lastActivityAt) lastActivityAt = msg.timestamp;
          const reactions = await decryptReactions(msg.reactions);
          if (cancelled) return;
          results.push({ ...msg, reactions });
          continue;
        }

        const cacheKey = `${msg.id}:${msg.editedAt ?? 0}`;
        const cached = cache.get(cacheKey);

        if (cached !== undefined) {
          if (cached === '__support-close__') {
            if (msg.timestamp > closedAt) closedAt = msg.timestamp;
            // Do not push close-marker messages into the visible list.
            continue;
          }
          const reactions = await decryptReactions(msg.reactions);
          if (cancelled) return;
          if (msg.timestamp > lastActivityAt) lastActivityAt = msg.timestamp;
          results.push({ ...msg, content: cached, reactions });
          continue;
        }

        // Decrypt fresh.
        try {
          // Image-only messages have an empty content field (no encrypted caption).
          // Skip decryption to avoid the '[encrypted]' fallback.
          if (!msg.content && msg.attachmentMeta) {
            const reactions = await decryptReactions(msg.reactions);
            if (cancelled) return;
            cache.set(cacheKey, '');
            if (msg.timestamp > lastActivityAt) lastActivityAt = msg.timestamp;
            results.push({ ...msg, content: '', reactions });
            continue;
          }

          const decrypted = await decryptFromSupport(
            msg.content,
            msg.authorPublicKey
          );
          if (cancelled) return;

          if (decrypted !== null) {
            // Check for the agent-sent close marker.
            try {
              const parsed = JSON.parse(decrypted);
              if (parsed.__type === SUPPORT_CLOSE_TYPE) {
                cache.set(cacheKey, '__support-close__');
                if (msg.timestamp > closedAt) closedAt = msg.timestamp;
                continue;
              }
            } catch {
              // Not JSON — treat as plain text.
            }
            const reactions = await decryptReactions(msg.reactions);
            if (cancelled) return;
            cache.set(cacheKey, decrypted);
            if (msg.timestamp > lastActivityAt) lastActivityAt = msg.timestamp;
            results.push({ ...msg, content: decrypted, reactions });
          } else {
            // Decryption failed (wrong key or corrupted data).
            const reactions = await decryptReactions(msg.reactions);
            if (cancelled) return;
            cache.set(cacheKey, '[encrypted]');
            if (msg.timestamp > lastActivityAt) lastActivityAt = msg.timestamp;
            results.push({ ...msg, content: '[encrypted]', reactions });
          }
        } catch {
          if (cancelled) return;
          if (msg.timestamp > lastActivityAt) lastActivityAt = msg.timestamp;
          results.push({ ...msg, content: '[encrypted]' });
        }
      }

      if (!cancelled) {
        setDecryptedMessages(results);
        // isClosed: the close marker exists AND nothing happened after it.
        setIsClosed(closedAt > 0 && closedAt > lastActivityAt);
      }
    };

    processMessages();

    return () => {
      cancelled = true;
    };
  }, [inner.messages]);

  // ── Encrypted send wrappers ───────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // If the chat was closed, re-knock the queue to alert agents.
      if (isClosed && myAddress && userInfo?.publicKey) {
        postQueueKnock(myAddress, userInfo.publicKey).catch(() => {});
      }

      const encrypted = await encryptForSupport(trimmed);
      await inner.sendMessage(encrypted);
    },
    [inner.sendMessage, isClosed, myAddress, userInfo?.publicKey, postQueueKnock]
  );

  const sendEdit = useCallback(
    async (targetId: string, newContent: string): Promise<void> => {
      const trimmed = newContent.trim();
      if (!trimmed) return;
      const encrypted = await encryptForSupport(trimmed);
      await inner.sendEdit(targetId, encrypted);
    },
    [inner.sendEdit]
  );

  const sendReply = useCallback(
    async (parentId: string, text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const encrypted = await encryptForSupport(trimmed);
      await inner.sendReply(parentId, encrypted);
    },
    [inner.sendReply]
  );

  const sendReaction = useCallback(
    async (targetId: string, emoji: string): Promise<void> => {
      if (!emoji) return;
      const encrypted = await encryptForSupport(emoji);
      await inner.sendReaction(targetId, encrypted);
    },
    [inner.sendReaction]
  );

  const sendImage = useCallback(
    async (file: File, caption?: string): Promise<void> => {
      // Step 1: compress using Compressor.js (same settings as ImageUploader).
      let compressedFile: File;
      if (file.type === 'image/gif') {
        if (file.size > 512 * 1024) {
          console.error('[useSupportChat] GIF exceeds 512 KB limit');
          return;
        }
        compressedFile = file;
      } else {
        const Compressor = (await import('compressorjs')).default;
        compressedFile = await new Promise<File>((resolve, reject) => {
          new Compressor(file, {
            quality: 0.6,
            maxWidth: 1200,
            mimeType: 'image/webp',
            success(result) {
              resolve(new File([result], file.name, { type: 'image/webp' }));
            },
            error: reject,
          });
        });
      }

      // Step 2: read dimensions and raw bytes.
      const [arrayBuffer, dimensions] = await Promise.all([
        compressedFile.arrayBuffer(),
        new Promise<{ width: number; height: number }>((resolve) => {
          const url = URL.createObjectURL(compressedFile);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve({ width: 0, height: 0 });
          };
          img.src = url;
        }),
      ]);

      // Step 3: base64-encode raw image bytes.
      const rawBytes = new Uint8Array(arrayBuffer);
      let rawBinary = '';
      for (let i = 0; i < rawBytes.length; i++) {
        rawBinary += String.fromCharCode(rawBytes[i]);
      }
      const rawBase64 = btoa(rawBinary);

      // Step 4: encrypt via the support attachment case.
      const encryptedData = await encryptAttachmentForSupport(rawBase64);

      // Step 5: SHA-256 hash of the encrypted bytes for signature integrity.
      const encBytes = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));
      const hashBuf = await crypto.subtle.digest('SHA-256', encBytes);
      const hashArray = Array.from(new Uint8Array(hashBuf));
      const attachmentDataHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      // Step 6: dispatch via the underlying useP2PChat sendImageData.
      await inner.sendImageData({
        attachmentData: encryptedData,
        attachmentDataHash,
        attachmentMeta: {
          mimeType: compressedFile.type,
          filename: file.name,
          width: dimensions.width,
          height: dimensions.height,
          sizeBytes: encBytes.length,
        },
        caption: caption ? await encryptForSupport(caption) : undefined,
      });
    },
    [inner.sendImageData]
  );

  return {
    ...inner,
    messages: decryptedMessages,
    isClosed,
    isAgentOnline,
    sendMessage,
    sendEdit,
    sendReply,
    sendReaction,
    sendImage,
  };
}

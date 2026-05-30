/**
 * DM voice Reticulum wire compaction: `roomId` is `dmv:` + 18 hex chars (truncated SHA-256 of
 * canonical `direct:…` chatId). GC_JOIN JSON must stay under 383 bytes — `H` uses `d:<digest>`;
 * full chatId remains in `GroupRoom.chatId`.
 */

/** Synthetic DM voice room id prefix (short for Reticulum `R` field). */
export const DM_VOICE_ROOM_PREFIX = 'dmv:';

/** Wire `H` / signed `chatId` for compact DM voice joins (matches digest in `roomId`). */
export const DM_VOICE_JOIN_WIRE_CHAT_PREFIX = 'd:';

/**
 * Compact `chatId` for GC_JOIN wire + Ed25519 sign payload when using compact `dmv:` rooms.
 * Otherwise returns `fullDirectChatId` unchanged (group rooms).
 */
export function compactDmVoiceJoinWireChatId(
  roomId: string,
  fullDirectChatId: string
): string {
  if (!roomId.startsWith(DM_VOICE_ROOM_PREFIX)) return fullDirectChatId;
  const digest = roomId.slice(DM_VOICE_ROOM_PREFIX.length);
  if (!/^[0-9a-f]{18}$/i.test(digest)) return fullDirectChatId;
  if (!fullDirectChatId.startsWith('direct:')) return fullDirectChatId;
  return `${DM_VOICE_JOIN_WIRE_CHAT_PREFIX}${digest.toLowerCase()}`;
}

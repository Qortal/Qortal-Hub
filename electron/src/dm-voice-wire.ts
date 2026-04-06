/**
 * Keep in sync with `src/lib/call/dmVoiceWire.ts` (renderer signing + join).
 */

export const DM_VOICE_ROOM_PREFIX = 'dmv:';

export const DM_VOICE_JOIN_WIRE_CHAT_PREFIX = 'd:';

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

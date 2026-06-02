/** Canonical P2P voice call id for a 1:1 DM (must match ChatDirect). */
export function buildDirectVoiceCallChatId(
  myAddress: string,
  peerAddress: string
): string {
  return `direct:${[myAddress, peerAddress].sort().join(':')}`;
}

export function isDirectVoiceCallChatId(
  chatId: string | null | undefined
): boolean {
  return typeof chatId === 'string' && chatId.startsWith('direct:');
}

/** The other party's address given a `direct:…` chat id and the local address. */
export function peerAddressFromDirectVoiceChatId(
  chatId: string,
  myAddress: string
): string | null {
  if (!isDirectVoiceCallChatId(chatId) || !myAddress) return null;
  const body = chatId.slice('direct:'.length);
  const parts = body.split(':');
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (a === myAddress) return b;
  if (b === myAddress) return a;
  return null;
}

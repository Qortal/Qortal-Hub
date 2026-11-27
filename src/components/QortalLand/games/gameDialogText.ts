export const friendlyGameStatus = (error?: string): string => {
  const normalized = String(error || '')
    .trim()
    .toLowerCase();
  if (!normalized) return 'The game has ended.';
  if (normalized.includes('rematch') && normalized.includes('declin')) {
    return 'Rematching was declined.';
  }
  if (normalized === 'declined' || normalized.includes('invitation declined')) {
    return 'The game invitation was declined.';
  }
  if (normalized.includes('busy') || normalized.includes('game_busy')) {
    return 'The other player is currently busy.';
  }
  if (
    normalized.includes('recipient_not_verified') ||
    normalized.includes('recipient_identity_unavailable') ||
    normalized === 'unverified_peer'
  ) {
    return 'Player identity is still syncing. Try again in a moment.';
  }
  if (normalized.includes('could not be recovered')) {
    return 'The game connection was lost.';
  }
  if (normalized.includes('expired') || normalized.includes('timeout')) {
    return 'The game invitation expired.';
  }
  const natural = normalized.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!natural) return 'The game has ended.';
  const sentence = `${natural.charAt(0).toUpperCase()}${natural.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};

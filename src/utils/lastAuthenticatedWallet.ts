const LAST_AUTHENTICATED_WALLET_ADDRESS_KEY =
  'qortal:last-authenticated-wallet-address';
const LAST_AUTHENTICATED_WALLET_AUTO_SELECT_SESSION_KEY =
  'qortal:last-authenticated-wallet-auto-select-attempted';

export function getLastAuthenticatedWalletAddress(): string {
  if (typeof window === 'undefined') return '';

  try {
    return (
      window.localStorage
        .getItem(LAST_AUTHENTICATED_WALLET_ADDRESS_KEY)
        ?.trim() || ''
    );
  } catch {
    return '';
  }
}

export function saveLastAuthenticatedWalletAddress(address?: string | null) {
  if (typeof window === 'undefined') return;

  const normalizedAddress = address?.trim();
  if (!normalizedAddress) return;

  try {
    window.localStorage.setItem(
      LAST_AUTHENTICATED_WALLET_ADDRESS_KEY,
      normalizedAddress
    );
  } catch {
    // localStorage can be unavailable in restricted renderer contexts.
  }
}

export function clearLastAuthenticatedWalletAddress(address?: string | null) {
  if (typeof window === 'undefined') return;

  try {
    const storedAddress = getLastAuthenticatedWalletAddress();
    if (!address || storedAddress === address.trim()) {
      window.localStorage.removeItem(LAST_AUTHENTICATED_WALLET_ADDRESS_KEY);
    }
  } catch {
    // Ignore unavailable storage.
  }
}

export function hasAttemptedLastWalletAutoSelectThisSession(): boolean {
  if (typeof window === 'undefined') return true;

  try {
    return (
      window.sessionStorage.getItem(
        LAST_AUTHENTICATED_WALLET_AUTO_SELECT_SESSION_KEY
      ) === 'true'
    );
  } catch {
    return true;
  }
}

export function markLastWalletAutoSelectAttemptedThisSession() {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(
      LAST_AUTHENTICATED_WALLET_AUTO_SELECT_SESSION_KEY,
      'true'
    );
  } catch {
    // Ignore unavailable storage.
  }
}

/**
 * Small key/value store for Qortino's own state (install record, chats),
 * with the shape of Capacitor's Preferences that GO uses, so the shared code
 * stays the same. Kept in this computer's localStorage.
 */
const PREFIX = 'qortino:';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const Preferences = {
  async get({ key }: { key: string }): Promise<{ value: string | null }> {
    try {
      return { value: storage()?.getItem(PREFIX + key) ?? null };
    } catch {
      return { value: null };
    }
  },
  async set({ key, value }: { key: string; value: string }): Promise<void> {
    try {
      storage()?.setItem(PREFIX + key, value);
    } catch (error) {
      // Full storage: the chat goes on, it is just not saved this time.
      console.warn('[qortino] could not save', key, error);
    }
  },
  async remove({ key }: { key: string }): Promise<void> {
    try {
      storage()?.removeItem(PREFIX + key);
    } catch {
      /* nothing to remove */
    }
  },
};

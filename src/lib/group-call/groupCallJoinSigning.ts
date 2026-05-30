type ElectronGcallProxy = {
  gcallProxySignPresenceMessage?: (
    payload: Record<string, unknown>
  ) => Promise<{
    signature?: string;
    error?: string;
    message?: string;
  }>;
  gcallProxyDecryptBoxWithMyKey?: (payload: {
    ephemeralPublicKey: string;
    nonce: string;
    ciphertext: string;
  }) => Promise<{ decryptedKey?: string; error?: string; message?: string }>;
};

/**
 * The hidden audio-surface window cannot use `getData('keyPair')` / `window.sendMessage`
 * for signing: secure storage is decrypted with a per-renderer in-memory key that only
 * the main shell has after login. The Electron preload for that window exposes
 * `gcallProxySignPresenceMessage` (IPC → `executeJavaScript` in the main window).
 */
export async function signGroupCallFields(
  fields: Record<string, unknown>
): Promise<string> {
  const api = (window as Window & { electronAPI?: ElectronGcallProxy })
    .electronAPI;
  if (typeof api?.gcallProxySignPresenceMessage === 'function') {
    const result = await api.gcallProxySignPresenceMessage(fields);
    if (result?.error) {
      throw new Error(String(result.message || result.error));
    }
    if (typeof result?.signature !== 'string') {
      throw new Error('signPresenceMessage returned no signature');
    }
    return result.signature;
  }
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
 * Same constraint as {@link signGroupCallFields} for the audio-surface; falls back
 * to `sendMessage` in the main shell.
 */
export async function decryptBoxWithMyKeyForGroupCall(payload: {
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
}): Promise<{ decryptedKey?: string; error?: string }> {
  const api = (window as Window & { electronAPI?: ElectronGcallProxy })
    .electronAPI;
  if (typeof api?.gcallProxyDecryptBoxWithMyKey === 'function') {
    return api.gcallProxyDecryptBoxWithMyKey(payload);
  }
  return (await (window as any).sendMessage(
    'decryptBoxWithMyKey',
    payload,
    10_000
  )) as { decryptedKey?: string; error?: string };
}

export async function fetchLocalReticulumDestinationHash(): Promise<string | null> {
  const fn = (
    window as Window & {
      electronAPI?: {
        reticulumGetLocalDestinationHash?: () => Promise<{
          destinationHash: string | null;
        }>;
      };
    }
  ).electronAPI?.reticulumGetLocalDestinationHash;
  if (typeof fn !== 'function') return null;
  const maxAttempts = 35;
  const delayMs = 200;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const j = await fn();
      const raw = j?.destinationHash;
      if (typeof raw === 'string') {
        const normalized = raw.replace(/\s/g, '').trim().toLowerCase();
        if (/^[0-9a-f]{32}$/.test(normalized)) return normalized;
      }
    } catch {
      /* retry */
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

export async function fetchLocalReticulumIdentityPublicKeyBase64(): Promise<
  string | null
> {
  const fn = (
    window as Window & {
      electronAPI?: {
        reticulumGetLocalIdentityPublicKeyBase64?: () => Promise<{
          publicKeyBase64: string | null;
        }>;
      };
    }
  ).electronAPI?.reticulumGetLocalIdentityPublicKeyBase64;
  if (typeof fn !== 'function') return null;
  const maxAttempts = 35;
  const delayMs = 200;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const j = await fn();
      const raw = j?.publicKeyBase64;
      if (typeof raw === 'string' && raw.length >= 86) {
        try {
          const bin = atob(raw);
          if (bin.length === 64) return raw;
        } catch {
          /* invalid b64 */
        }
      }
    } catch {
      /* retry */
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

function normalizeRkBase64ForGcJoinRkSign(rk: string): string {
  return rk.replace(/=+$/u, '');
}

export async function signReticulumJoinSplit(params: {
  roomId: string;
  chatId: string;
  fromAddress: string;
  fromPublicKey: string;
  timestamp: number;
  joinGeneration: number;
  reticulumDestinationHash: string;
  reticulumIdentityPublicKeyBase64: string | null;
}): Promise<{ joinSig: string; joinRkSig?: string } | null> {
  const joinSig = await signGroupCallFields({
    type: 'GC_JOIN',
    roomId: params.roomId,
    chatId: params.chatId,
    fromAddress: params.fromAddress,
    fromPublicKey: params.fromPublicKey,
    timestamp: params.timestamp,
    joinGeneration: params.joinGeneration,
    reticulumDestinationHash: params.reticulumDestinationHash,
  }).catch(() => '');
  if (!joinSig) return null;
  if (!params.reticulumIdentityPublicKeyBase64) {
    return { joinSig };
  }
  const joinRkSig = await signGroupCallFields({
    type: 'GC_JOIN_RK',
    roomId: params.roomId,
    chatId: params.chatId,
    fromAddress: params.fromAddress,
    fromPublicKey: params.fromPublicKey,
    timestamp: params.timestamp,
    joinGeneration: params.joinGeneration,
    reticulumDestinationHash: params.reticulumDestinationHash,
    reticulumIdentityPublicKeyBase64: normalizeRkBase64ForGcJoinRkSign(
      params.reticulumIdentityPublicKeyBase64
    ),
  }).catch(() => '');
  if (!joinRkSig) return null;
  return { joinSig, joinRkSig };
}

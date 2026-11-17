/**
 * Shared helpers for call microphone / speaker selection (Chromium Web APIs).
 */

export type CallAudioDeviceLists = {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
};

export async function listAudioDevices(): Promise<CallAudioDeviceLists> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: all.filter((d) => d.kind === 'audioinput'),
    outputs: all.filter((d) => d.kind === 'audiooutput'),
  };
}

/** Ensure mic permission so enumerateDevices returns non-empty labels (best effort). */
export async function ensureMicPermissionForLabels(): Promise<void> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    /* user denied or no device — still enumerate without labels */
  }
}

export type GetUserAudioStreamResult = {
  stream: MediaStream | null;
  /** Persisted input id was invalid or overconstrained — caller should clear stored inputDeviceId */
  clearedStaleInputDevice: boolean;
};

/**
 * Opens the microphone for calls. Uses exact deviceId when provided and listed;
 * otherwise falls back to default. On OverconstrainedError / NotFoundError, retries default.
 */
export async function getUserAudioStreamForCall(
  preferredDeviceId: string | null
): Promise<GetUserAudioStreamResult> {
  let useExactId = preferredDeviceId;
  if (useExactId) {
    try {
      const { inputs } = await listAudioDevices();
      if (!inputs.some((d) => d.deviceId === useExactId)) {
        useExactId = null;
      }
    } catch {
      useExactId = null;
    }
  }

  if (!useExactId) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      return {
        stream,
        clearedStaleInputDevice: preferredDeviceId != null,
      };
    } catch (e) {
      console.error('[callAudio] getUserMedia (default) failed:', e);
      return { stream: null, clearedStaleInputDevice: preferredDeviceId != null };
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: useExactId } },
      video: false,
    });
    return { stream, clearedStaleInputDevice: false };
  } catch (e) {
    const name = e && typeof e === 'object' && 'name' in e ? (e as Error).name : '';
    if (name === 'OverconstrainedError' || name === 'NotFoundError') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return { stream, clearedStaleInputDevice: true };
      } catch (e2) {
        console.error('[callAudio] getUserMedia fallback after constraint error failed:', e2);
        return { stream: null, clearedStaleInputDevice: true };
      }
    }
    console.error('[callAudio] getUserMedia failed:', e);
    return { stream: null, clearedStaleInputDevice: false };
  }
}

export type ApplyCallAudioOutputResult = {
  /** Persisted output id invalid or setSinkId failed — caller should clear stored outputDeviceId */
  clearPersistedOutput: boolean;
};

async function resolveOutputSinkId(
  outputDeviceId: string | null
): Promise<{ sinkId: string; clearPersisted: boolean }> {
  if (!outputDeviceId) {
    return { sinkId: '', clearPersisted: false };
  }
  try {
    const { outputs } = await listAudioDevices();
    if (outputs.some((d) => d.deviceId === outputDeviceId)) {
      return { sinkId: outputDeviceId, clearPersisted: false };
    }
  } catch {
    /* fall through */
  }
  return { sinkId: '', clearPersisted: true };
}

/**
 * Route playback to the chosen sink. Empty string = OS default.
 */
export async function applyCallAudioOutput(
  outputDeviceId: string | null,
  targets: {
    audioElement?: HTMLMediaElement | null;
    audioContext?: AudioContext | null;
  }
): Promise<ApplyCallAudioOutputResult> {
  const { sinkId, clearPersisted: staleId } = await resolveOutputSinkId(outputDeviceId);
  let clearPersistedOutput = staleId;

  const ctxWithSink = (ctx: AudioContext) =>
    ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };

  if (targets.audioElement) {
    const el = targets.audioElement;
    if (typeof el.setSinkId === 'function') {
      try {
        await el.setSinkId(sinkId);
      } catch {
        clearPersistedOutput = clearPersistedOutput || !!outputDeviceId;
        try {
          await el.setSinkId('');
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (targets.audioContext) {
    const ctx = targets.audioContext;
    const setSink = ctxWithSink(ctx).setSinkId;
    if (typeof setSink === 'function') {
      try {
        await setSink.call(ctx, sinkId);
      } catch {
        clearPersistedOutput = clearPersistedOutput || !!outputDeviceId;
        try {
          await setSink.call(ctx, '');
        } catch {
          /* ignore */
        }
      }
    }
  }

  return { clearPersistedOutput };
}

import type { EarbumpTrack } from './earbumpLibraryApi';

let sharedEarbumpAudioInstance: HTMLAudioElement | null = null;
let sharedEarbumpActivityActive = false;
let sharedEarbumpTrackSnapshot: EarbumpTrack | null = null;

export const SHARED_EARBUMP_ACTIVITY_EVENT = 'qortino-earbump-activity';

export const getSharedEarbumpAudio = (): HTMLAudioElement | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  if (sharedEarbumpAudioInstance == null) {
    sharedEarbumpAudioInstance = new Audio();
    sharedEarbumpAudioInstance.preload = 'metadata';
  }

  return sharedEarbumpAudioInstance;
};

export const getSharedEarbumpTrackSnapshot = () => sharedEarbumpTrackSnapshot;

export const getSharedEarbumpActivity = () => sharedEarbumpActivityActive;

export const setSharedEarbumpTrackSnapshot = (
  track: EarbumpTrack | null
) => {
  sharedEarbumpTrackSnapshot = track ? { ...track } : null;
};

export const emitSharedEarbumpActivity = (isActive: boolean) => {
  sharedEarbumpActivityActive = isActive;

  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(SHARED_EARBUMP_ACTIVITY_EVENT, {
      detail: { isActive },
    })
  );
};

export const stopSharedEarbumpAudio = (audio: HTMLAudioElement | null) => {
  if (!audio) {
    return;
  }

  audio.pause();
  audio.removeAttribute('src');
  audio.load();
};

/** Pause playback and clear track snapshot (logout / workspace teardown). */
export const stopSharedEarbumpPlayback = (): void => {
  stopSharedEarbumpAudio(getSharedEarbumpAudio());
  setSharedEarbumpTrackSnapshot(null);
  emitSharedEarbumpActivity(false);
};

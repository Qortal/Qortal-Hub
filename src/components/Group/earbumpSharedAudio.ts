import type { EarbumpTrack } from './earbumpLibraryApi';

let sharedEarbumpAudioInstance: HTMLAudioElement | null = null;
let sharedEarbumpTrackSnapshot: EarbumpTrack | null = null;

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

export const setSharedEarbumpTrackSnapshot = (
  track: EarbumpTrack | null
) => {
  sharedEarbumpTrackSnapshot = track ? { ...track } : null;
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
};

/**
 * The Video publisher's state, in Jotai's default store so the queue and a
 * run going on survive Home being left or rebuilt (the controller writes it
 * from outside React).
 */
import { atom } from 'jotai';
import type { PublishedEntry } from './publishedHistory';
import type {
  NodeLimit,
  QueueItem,
  VideoEncoderInfo,
  VideoPublisherSettings,
  VideoRunState,
} from './videoPublisherTypes';

export const VIDEO_PUBLISHER_DEFAULT_SETTINGS: VideoPublisherSettings = {
  destination: 'qtube',
  destinationChosen: false,
  quality: '720',
  codec: null,
  // Each converted video waits to be previewed: the quality is seen
  // before anything goes up.
  reviewFirst: true,
  shared: {},
  series: {
    title: '',
    year: null,
    genre: null,
    description: '',
    poster: null,
  },
};

export const VIDEO_PUBLISHER_IDLE_RUN: VideoRunState = {
  active: false,
  context: null,
};

export const videoQueueAtom = atom<QueueItem[]>([] as QueueItem[]);

export const videoPublisherSettingsAtom = atom<VideoPublisherSettings>(
  VIDEO_PUBLISHER_DEFAULT_SETTINGS
);

export const videoRunAtom = atom<VideoRunState>(VIDEO_PUBLISHER_IDLE_RUN);

/** Whether the converter writes AV1, and the PC's threads, once known. */
export const videoEncoderAtom = atom<VideoEncoderInfo | null>(
  null as VideoEncoderInfo | null
);

/** The node's publish limit, once known. */
export const videoNodeLimitAtom = atom<NodeLimit | null>(
  null as NodeLimit | null
);

/** The signed-in account's published videos (publishedHistory). */
export const videoPublishedAtom = atom<PublishedEntry[]>(
  [] as PublishedEntry[]
);

/**
 * The cards whose details are open, and those opened by themselves (a lone
 * video): in the store, so a window that's rebuilt keeps them.
 */
export type VideoExpandedState = { open: string[]; autoOpened: string[] };

export const videoExpandedAtom = atom<VideoExpandedState>({
  open: [],
  autoOpened: [],
} as VideoExpandedState);

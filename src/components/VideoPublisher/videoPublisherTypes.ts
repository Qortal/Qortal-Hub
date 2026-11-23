import type {
  VideoCodec,
  VideoFrame,
  VideoJobOutput,
  VideoJobQuality,
  VideoProbe,
  VideoQualityId,
  VideoSource,
} from '../../../electron/src/video-tool-types';
import type {
  EpisodeKind,
  PublishedRecord,
  PublishStepKind,
  SubscreenCredit,
} from '../../lib/videoPublisher';

/** Where the queue goes. Subscreen takes a film or a whole series. */
export type VideoDestination =
  | 'qtube'
  | 'subscreen-film'
  | 'subscreen-series'
  | 'torq'
  | 'qshare'
  | 'save';

export const VIDEO_DESTINATIONS: readonly VideoDestination[] = [
  'qtube',
  'subscreen-film',
  'subscreen-series',
  'torq',
  'qshare',
  'save',
];

/** A subtitle track the item may take along: from the file, or added. */
export type SubtitleChoice = {
  /** `stream:<index>` or `file:<sourceId>`, unique within the item. */
  key: string;
  source: 'stream' | 'file';
  streamIndex?: number;
  sourceId?: string;
  /** An added file's name. */
  fileName?: string;
  label?: string;
  /** ISO 639-1, or null until the user picks one. */
  language: string | null;
  include: boolean;
  /** Blu-ray / DVD pictures: can only be burned into the video. */
  picture: boolean;
  /** A track this Hub's ffmpeg can't read (teletext, broadcast captions…). */
  unsupported?: boolean;
  /** Only the lines spoken in other languages. */
  forced?: boolean;
  /** For the hearing impaired (SDH): the lines and the sounds. */
  hearingImpaired?: boolean;
};

/** A cover: a moment of the video, or a picture the user chose. */
export type CoverChoice =
  | {
      kind: 'frame';
      /** The video it's from (a series poster can come from any episode). */
      sourceId: string;
      timeSec: number;
      preview: string;
    }
  | { kind: 'image'; dataUrl: string };

/**
 * What the user typed or picked for one video. Fields left undefined take
 * the "same for all" value (SharedFields).
 */
export type ItemFields = {
  title?: string;
  description?: string;
  category?: number | null;
  subcategory?: number | null;
  /** Subscreen film genre. */
  genre?: number | null;
  year?: number | null;
  postText?: string;
  qshareSubcategory?: number | null;
  season?: number | null;
  episode?: number | null;
  episodeKind?: EpisodeKind;
  episodeTitle?: string;
  cover?: CoverChoice | null;
  /** A Subscreen film's cast & crew, in the order added. */
  credits?: SubscreenCredit[];
};

/** The "same for all" values. */
export type SharedFields = Pick<
  ItemFields,
  | 'description'
  | 'category'
  | 'subcategory'
  | 'genre'
  | 'postText'
  | 'qshareSubcategory'
>;

/** A Subscreen series: one form for all its episodes. */
export type SeriesFields = {
  title: string;
  year: number | null;
  genre: number | null;
  description: string;
  poster: CoverChoice | null;
  /** The series' cast & crew (the series', never an episode's). */
  credits?: SubscreenCredit[];
};

export type ItemPhase =
  /** Before a run. */
  | 'probing'
  | 'ready'
  | 'unusable'
  /** In a run. */
  | 'waiting'
  | 'converting'
  | 'converted'
  | 'review'
  | 'publishing'
  | 'saving'
  /** After. */
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'discarded';

export type ItemErrorStage = 'probe' | 'convert' | 'publish' | 'save';

/** A stable code (core:video_publisher.error.*), never English text. */
export type ItemError = { code: string; stage: ItemErrorStage };

export type PublishProgress = {
  stepIndex: number;
  stepCount: number;
  kind: PublishStepKind;
  /** Chunks of the current step. */
  done: number;
  total: number;
  /** Bytes of the steps already up, of this step, and of all of them. */
  bytesBefore?: number;
  stepBytes?: number;
  bytesTotal?: number;
  /**
   * A node on this PC is reading the file itself (nothing is uploaded):
   * no progress to show until it's done.
   */
  onNode?: boolean;
};

export type RemovalState = 'confirm' | 'removing' | 'removed' | 'failed';

export type QueueItem = {
  id: string;
  source: VideoSource;
  probe?: VideoProbe;
  /** A small picture of the video for its card. */
  thumbnail?: string;
  /** Moments to pick a cover from (the source's frames). */
  frames?: VideoFrame[];
  framesState?: 'loading' | 'ready' | 'failed';
  /** This video's own quality, instead of the one for all. */
  quality?: VideoJobQuality;
  /** The sound kept; undefined = the default one, null = none. */
  audioIndex?: number | null;
  burnSubtitleIndex?: number | null;
  subtitles: SubtitleChoice[];
  fields: ItemFields;
  phase: ItemPhase;
  /**
   * An episode's place in its series' run, fixed when the run starts: an
   * untitled episode's number, on its card and as it's published.
   */
  episodePlace?: number;
  jobId?: string;
  /** 0–100 of the conversion. */
  percent?: number;
  etaSec?: number;
  speed?: number;
  /** Its conversion is paused: the job's ffmpeg stands still. */
  paused?: boolean;
  output?: VideoJobOutput;
  /**
   * The subtitle list the job's files were written for (subtitlesKey):
   * when the chosen ones differ, they're written again before it goes up.
   */
  madeSubtitles?: string;
  /** Its subtitles are being written again. */
  subtitlesBusy?: boolean;
  publish?: PublishProgress;
  /** Unconfirmed transactions it waits behind. */
  waitingForSlot?: number;
  /** Hub's approval (resources and fee) is open, waiting for the user. */
  awaitingApproval?: boolean;
  error?: ItemError;
  /** Chosen subtitles that couldn't be written. */
  failedSubtitles?: number;
  /** What it published: for Open, Copy link and Remove. */
  record?: PublishedRecord;
  /**
   * The run it went into, fixed then (destination, name, the shared and
   * series fields): its card, Retry and Remove keep to it after a new run.
   */
  context?: RunContext;
  /** A series episode's own link (its Q-Tube page). */
  link?: string;
  saved?: boolean;
  /** Where Save to this PC put it: main's id for it, and the path shown. */
  savedFile?: { id: string; path: string };
  /** Opening the saved video failed (a code under …error.*). */
  savedFileError?: string;
  /** Unticked: a ready video left out of the next Publish (kept for later). */
  unticked?: boolean;
  /** The user checked it and let it go ("Let me check each video first"). */
  approved?: boolean;
  removal?: RemovalState;
  removalError?: string;
};

export type VideoPublisherSettings = {
  destination: VideoDestination;
  /** The user picked the destination (no more suggestions). */
  destinationChosen: boolean;
  /**
   * A step, Original quality (each video's own size, its picture kept when
   * it can be), or Keep as is where a video can keep its file.
   */
  quality: VideoQualityId | 'original' | 'keep';
  /**
   * The picture format the user chose; null: AV1 on a PC fast enough for it,
   * else H.264 (VideoPublisherController.codec).
   */
  codec: VideoCodec | null;
  reviewFirst: boolean;
  shared: SharedFields;
  series: SeriesFields;
};

/** What a run publishes with: fixed when it starts. */
export type RunContext = {
  /** Tells runs apart. */
  id: number;
  destination: VideoDestination;
  name: string | null;
  publicKey: string | null;
  /** The account that started it: nothing goes up as another one. */
  address: string | null;
  sizeLimitBytes: number;
  reviewFirst: boolean;
  /** "Same for all videos" and the series' form, as they were at Publish. */
  shared: SharedFields;
  series: SeriesFields;
};

export type SeriesResult = {
  phase: 'waiting' | 'publishing' | 'done' | 'failed';
  /** Hub's approval for the playlist is open. */
  awaitingApproval?: boolean;
  error?: ItemError;
  record?: PublishedRecord;
  /** Its entry in the published list (publishedHistory). */
  historyId?: string;
  removal?: RemovalState;
  removalError?: string;
};

export type VideoRunState = {
  active: boolean;
  context: RunContext | null;
  /** The videos of this run (its progress counts only these). */
  itemIds?: string[];
  /** Why the run stopped early (a refusal, the balance, …). */
  stoppedBy?: string;
  /**
   * The next video waits to convert: MAX_CONVERTED_HELD converted ones are
   * on disk, waiting for the user's check.
   */
  waitingForChecks?: boolean;
  series?: SeriesResult;
};

export type NodeLimit = { bytes: number; publicNode: boolean };

/** What this Hub's converter can do, once its status is known. */
export type VideoEncoderInfo = {
  av1: boolean;
  cpuThreads: number;
  /** A conversion can be paused here (not on Windows). */
  canPause?: boolean;
};

/**
 * A file an add left out, and why: a sound file, a subtitle file no video
 * of the queue is named like, or anything else that isn't a video.
 */
export type LeftOutFile = {
  name: string;
  reason: 'audio' | 'subtitle' | 'other';
};

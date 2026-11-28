/**
 * The contract between Home's Video publisher (renderer) and Electron main,
 * which runs ffmpeg/ffprobe. Shared by both sides; no runtime code here
 * besides constants.
 *
 * Paths never cross into the renderer: a source is a file the user dropped or
 * picked (preload turns the File into a path with webUtils and main keeps it
 * under an id), and a job's outputs live in main's job folder, reached by id.
 */

/** Hub's channel names, `videoTool:*`. */
export const VIDEO_TOOL_CHANNELS = {
  status: 'videoTool:status',
  addFiles: 'videoTool:addFiles',
  forgetSource: 'videoTool:forgetSource',
  probe: 'videoTool:probe',
  frames: 'videoTool:frames',
  readSubtitleFile: 'videoTool:readSubtitleFile',
  startJob: 'videoTool:startJob',
  cancelJob: 'videoTool:cancelJob',
  pauseJob: 'videoTool:pauseJob',
  resumeJob: 'videoTool:resumeJob',
  remakeSubtitles: 'videoTool:remakeSubtitles',
  listJobs: 'videoTool:listJobs',
  releaseJob: 'videoTool:releaseJob',
  readText: 'videoTool:readText',
  uploadChunk: 'videoTool:uploadChunk',
  buildOnNode: 'videoTool:buildOnNode',
  saveOutput: 'videoTool:saveOutput',
  openSaved: 'videoTool:openSaved',
  pickFiles: 'videoTool:pickFiles',
  /** main → renderer, VideoJobEvent */
  jobEvent: 'videoTool:jobEvent',
} as const;

/**
 * The system's open dialog, worded by the window (Chromium's own picker
 * says "Upload"): videos, or a folder and everything in it.
 */
export type VideoPickRequest = {
  folder: boolean;
  title: string;
  buttonLabel: string;
  /** The file type filter's name ("Videos and subtitles"). */
  filterName: string;
};

/** saveOutput's answer: an id openSaved takes, and the path to show. */
export type VideoSaveResult =
  | { saved: false }
  | { saved: true; savedId: string; filePath: string };

/** Custom scheme serving a job's outputs, with Range support. */
export const VIDEO_TOOL_PREVIEW_SCHEME = 'hub-video';

/**
 * Main passes this to the Hub page's preload when ffmpeg and ffprobe came
 * with this Hub. Without it the page gets no window.videoTool, so Home
 * leaves the Video publisher out (a build made without the converter).
 */
export const VIDEO_TOOL_PAGE_ARG = '--hub-video-tool';
/** `hub-video://job/<jobId>/video.mp4`, `.../subtitles/<trackId>.vtt` */
export const videoToolPreviewUrl = (jobId: string, file = 'video.mp4') =>
  `${VIDEO_TOOL_PREVIEW_SCHEME}://job/${encodeURIComponent(jobId)}/${file}`;

/** publishData's chunk size: main reads at most this much per upload call. */
export const VIDEO_TOOL_MAX_CHUNK_BYTES = 5 * 1024 * 1024;

export type VideoQualityId = '1080' | '720' | '540' | '480' | '360';

/**
 * - a VideoQualityId: fit within that box (1920×1080 … 640×360), never
 *   enlarged;
 * - 'original': re-encode at the source's own size (for sizes between steps);
 * - 'keep': no re-encode, repackage only (allowed when `playableAsIs`).
 */
export type VideoJobQuality = VideoQualityId | 'original' | 'keep';

export type VideoToolStatus =
  | {
      available: true;
      ffmpegVersion: string;
      /** Free bytes where main writes job files. */
      freeBytes: number | null;
      /** This ffmpeg can write AV1 (SVT-AV1). */
      av1: boolean;
      /** The PC's logical processors: AV1 wants several. */
      cpuThreads: number;
      /** A conversion can be paused here (not on Windows). */
      canPause: boolean;
    }
  | { available: false; reason: 'missing-binary' | 'not-electron' | 'failed' };

/** A file the user dropped or picked, known to main by `id`. */
export type VideoSource = {
  id: string;
  name: string;
  size: number;
  /** Folder picks: the path below the chosen folder ("Season 1/E02.mkv"). */
  relativePath?: string;
  kind: 'video' | 'subtitle' | 'other';
};

export type VideoStreamSummary = {
  /** ffprobe's stream index in the file. */
  index: number;
  codec: string;
  language?: string;
  title?: string;
  isDefault: boolean;
};

export type VideoProbe = {
  sourceId: string;
  name: string;
  size: number;
  durationSec: number;
  /** ffprobe's format_name, e.g. "matroska,webm". */
  container: string;
  video: {
    index: number;
    codec: string;
    profile?: string;
    /** Coded size. */
    width: number;
    height: number;
    /** As shown: square pixels, after rotation. */
    displayWidth: number;
    displayHeight: number;
    fps: number;
    bitDepth: number;
    pixFmt: string;
    hdr: boolean;
    interlaced: boolean;
    /** Clockwise degrees to show it upright: 0, 90, 180 or 270. */
    rotation: number;
    /** The video stream's own bitrate (bits/s) when the file says. */
    bitrate?: number;
  } | null;
  audio: (VideoStreamSummary & { channels: number; bitrate?: number })[];
  subtitles: (VideoStreamSummary & {
    /**
     * Text subtitles become WebVTT; pictures can only be burned in; this
     * build can't read 'unsupported' ones at all.
     */
    kind: 'text' | 'picture' | 'unsupported';
    isForced: boolean;
  })[];
  /**
   * H.264 8-bit or AV1 8/10-bit, 4:2:0, with AAC (or no) sound: `keep` is
   * allowed.
   */
  playableAsIs: boolean;
};

export type VideoJobSubtitle =
  | { source: 'stream'; index: number; language: string; label?: string }
  | {
      source: 'file';
      sourceId: string;
      language: string;
      label?: string;
      encoding?: string;
    };

/** The picture's format: AV1 (SVT-AV1) or H.264 (x264). */
export type VideoCodec = 'av1' | 'h264';

export type VideoJobSpec = {
  sourceId: string;
  quality: VideoJobQuality;
  /**
   * What a re-encoded picture becomes; H.264 when absent. A copied picture
   * keeps its own (an AV1 one only with AV1 chosen).
   */
  codec?: VideoCodec;
  /** ffprobe stream index of the sound to keep; null = no sound. Default: the default/first one. */
  audioIndex?: number | null;
  subtitles: VideoJobSubtitle[];
  /** A picture (or text) subtitle stream drawn into the video. */
  burnSubtitleIndex?: number | null;
  /** The result must stay under this (Hub's publish limit for the node in use). */
  sizeLimitBytes: number;
};

export type VideoJobPhase =
  | 'queued'
  | 'analyzing'
  | 'pass1'
  | 'encoding'
  | 'subtitles'
  | 'done'
  | 'failed'
  | 'cancelled';

/** A chosen subtitle that could not be written; the video is fine. */
export type VideoJobFailedSubtitle = {
  /** Its position in VideoJobSpec.subtitles. */
  specIndex: number;
  language: string;
  label?: string;
  /**
   * too-big: over VIDEO_TOOL_MAX_SUBTITLE_BYTES; picture: not text;
   * unsupported: a track this build can't read.
   */
  reason: 'too-big' | 'picture' | 'unsupported' | 'failed';
};

/** Q-Tube's and Subscreen's limit for one subtitle file. */
export const VIDEO_TOOL_MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

export type VideoJobOutput = {
  size: number;
  durationSec: number;
  width: number;
  height: number;
  /** "video/mp4" */
  mimeType: string;
  /** The picture's format, as the output's probe found it. */
  codec?: VideoCodec;
  hasAudio: boolean;
  subtitles: { id: string; language: string; label?: string; bytes: number }[];
  failedSubtitles: VideoJobFailedSubtitle[];
};

/** What main decided to do, known once the job starts (phase 'analyzing'). */
export type VideoJobPlanSummary = {
  /** keep: repackaged; copy-video: picture copied, sound encoded. */
  mode: 'keep' | 'copy-video' | 'encode';
  /** The result's picture format. */
  codec: VideoCodec;
  twoPass: boolean;
  /** Upper bound of the result's size. */
  estimateBytes: number;
  width: number;
  height: number;
};

export type VideoJobState = {
  jobId: string;
  spec: VideoJobSpec;
  phase: VideoJobPhase;
  /** 0–100 over the whole job. */
  percent: number;
  etaSec?: number;
  /** Encode speed vs real time, e.g. 2.4. */
  speed?: number;
  /**
   * Paused by the user: its ffmpeg is stopped where it was and goes on from
   * there on resume (nothing new starts meanwhile).
   */
  paused?: boolean;
  plan?: VideoJobPlanSummary;
  output?: VideoJobOutput;
  /** Stable code for the renderer's own strings. */
  errorCode?:
    | 'probe-failed'
    | 'no-video'
    | 'too-long-for-limit'
    | 'disk-full'
    | 'ffmpeg-failed'
    | 'output-too-big'
    | 'source-missing'
    | 'keep-not-allowed'
    | 'burn-in-not-supported'
    | 'invalid-spec';
  errorDetail?: string;
};

export type VideoJobErrorCode = NonNullable<VideoJobState['errorCode']>;

/**
 * Codes of errors the bridge's promises reject with (job failures arrive as
 * a 'failed' VideoJobState instead). Electron wraps the message, so read the
 * code with videoToolErrorCode().
 */
export type VideoToolErrorCode =
  | 'missing-binary'
  | 'source-missing'
  | 'probe-failed'
  | 'no-video'
  | 'job-missing'
  | 'not-ready'
  | 'invalid-request'
  | 'unsupported-encoding'
  | 'too-big'
  | 'frames-failed'
  | 'save-failed'
  /** A saved video was moved or deleted since. */
  | 'saved-missing'
  /** Hub is quitting: nothing new starts. */
  | 'cancelled'
  /** This system can't do it (pausing on Windows). */
  | 'not-supported';

/** Thrown messages look like "[video-tool:no-video] details". */
export const videoToolErrorMessage = (
  code: VideoToolErrorCode,
  detail?: string
) => `[video-tool:${code}]${detail ? ` ${detail}` : ''}`;

export const videoToolErrorCode = (
  error: unknown
): VideoToolErrorCode | null => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const match = /\[video-tool:([a-z-]+)\]/.exec(message);
  return match ? (match[1] as VideoToolErrorCode) : null;
};

export type VideoJobEvent = { type: 'state'; state: VideoJobState };

export type VideoFrame = { timeSec: number; dataUrl: string };

export type VideoUploadRequest = {
  jobId: string;
  /** 'video' or a subtitle id from VideoJobOutput.subtitles. */
  file: 'video' | string;
  start: number;
  end: number;
  index: number;
  /** publishData's chunk endpoint (node URL incl. API key when needed). */
  endpoint: string;
};

export type VideoUploadResult = { ok: true } | { ok: false; status: number };

/**
 * A node on this PC builds the publish transaction from the file itself
 * (Core's publish-from-path route) instead of an upload.
 */
export type VideoNodeBuildRequest = {
  jobId: string;
  /** 'video' or a subtitle id from VideoJobOutput.subtitles. */
  file: 'video' | string;
  /**
   * publishData's /arbitrary/<SERVICE>/<name>[/<identifier>] endpoint, with
   * its query (node URL incl. API key when needed).
   */
  endpoint: string;
  /** The name the node publishes the file under (its last part). */
  filename?: string;
};

export type VideoNodeBuildResult =
  /** The unsigned transaction, Base58. */
  | { ok: true; transaction: string }
  | {
      ok: false;
      /** The node's HTTP status; 0 when it wasn't asked or didn't answer. */
      status: number;
      /**
       * not-local: the node isn't on this PC. link: the file couldn't be
       * named for it. refused: the node said no. answer: it answered
       * something else than a transaction. network: no answer.
       */
      reason: 'not-local' | 'link' | 'refused' | 'answer' | 'network';
    };

/** window.videoTool, exposed by preload in Electron only. */
export interface VideoToolBridge {
  status(): Promise<VideoToolStatus>;
  /**
   * Files from an <input type=file>, a folder input or a drop.
   * `relativePaths[i]`, when set, says where files[i] sat in a dropped
   * folder (a dropped file has no webkitRelativePath).
   */
  addFiles(
    files: File[],
    relativePaths?: (string | undefined)[]
  ): Promise<VideoSource[]>;
  forgetSource(sourceId: string): Promise<void>;
  probe(sourceId: string): Promise<VideoProbe>;
  /** `count` evenly spread frames (or at `times`), JPEG data URLs. */
  frames(
    target: { sourceId: string } | { jobId: string },
    options: { count?: number; times?: number[]; width?: number }
  ): Promise<VideoFrame[]>;
  /** An external .srt/.vtt/.ass, decoded for a preview. */
  readSubtitleFile(
    sourceId: string,
    encoding?: string
  ): Promise<{ text: string; encoding: string; valid: boolean }>;
  startJob(spec: VideoJobSpec): Promise<VideoJobState>;
  cancelJob(jobId: string): Promise<void>;
  /** Stops the job's ffmpeg where it is, until resumeJob. */
  pauseJob(jobId: string): Promise<VideoJobState>;
  resumeJob(jobId: string): Promise<VideoJobState>;
  /**
   * Writes a finished job's subtitles again, as `subtitles` now lists them
   * (the picture stays): its output's subtitles change to those.
   */
  remakeSubtitles(
    jobId: string,
    subtitles: VideoJobSubtitle[]
  ): Promise<VideoJobState>;
  listJobs(): Promise<VideoJobState[]>;
  /**
   * Deletes the job's files. A job that hasn't finished is stopped, and its
   * last event ('cancelled') is sent before this resolves.
   */
  releaseJob(jobId: string): Promise<void>;
  /** A small output (a subtitle), as text. */
  readText(jobId: string, file: string): Promise<string>;
  uploadChunk(request: VideoUploadRequest): Promise<VideoUploadResult>;
  /** The transaction built by a node on this PC from the file itself. */
  buildOnNode(request: VideoNodeBuildRequest): Promise<VideoNodeBuildResult>;
  /** The system's save dialog; where it went, when it was saved. */
  saveOutput(jobId: string, suggestedName: string): Promise<VideoSaveResult>;
  /**
   * Opens a file saved by saveOutput in the system's player, or shows it in
   * its folder. Only what saveOutput gave out can be opened.
   */
  openSaved(savedId: string, how: 'open' | 'folder'): Promise<void>;
  /** The open dialog; what was picked, added as sources ([] if cancelled). */
  pickFiles(request: VideoPickRequest): Promise<VideoSource[]>;
  onJobEvent(listener: (event: VideoJobEvent) => void): () => void;
}

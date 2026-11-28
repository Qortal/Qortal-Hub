/**
 * A fake window.videoTool (the Video publisher's Electron bridge) for
 * renderer tests: sources by file name, probes the test gives, and jobs the
 * test moves along with `emit`/`finishJob`.
 */
import { vi } from 'vitest';
import type {
  VideoFrame,
  VideoJobEvent,
  VideoJobOutput,
  VideoJobSpec,
  VideoJobState,
  VideoProbe,
  VideoSaveResult,
  VideoSource,
  VideoToolBridge,
} from '../../../electron/src/video-tool-types';

const SUBTITLE = /\.(srt|vtt|ass|ssa|sub|sup)$/i;
const VIDEO =
  /\.(mp4|m4v|mov|qt|3gp|3g2|mkv|webm|avi|wmv|asf|flv|f4v|ts|m2ts|mts|mpg|mpeg|vob|ogv|mxf|dv|divx|xvid)$/i;

export const FRAME_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

/** A probe of a plain 1080p H.264 + AAC file (playable as is). */
export function fakeProbe(overrides: Partial<VideoProbe> = {}): VideoProbe {
  return {
    sourceId: 'source-1',
    name: 'video.mp4',
    size: 300 * 1024 * 1024,
    durationSec: 1200,
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    video: {
      index: 0,
      codec: 'h264',
      width: 1920,
      height: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
      fps: 25,
      bitDepth: 8,
      pixFmt: 'yuv420p',
      hdr: false,
      interlaced: false,
      rotation: 0,
      bitrate: 1_800_000,
    },
    audio: [
      {
        index: 1,
        codec: 'aac',
        channels: 2,
        isDefault: true,
        bitrate: 128_000,
      },
    ],
    subtitles: [],
    playableAsIs: true,
    ...overrides,
  };
}

export function fakeOutput(
  overrides: Partial<VideoJobOutput> = {}
): VideoJobOutput {
  return {
    size: 120 * 1024 * 1024,
    durationSec: 1200,
    width: 1280,
    height: 720,
    mimeType: 'video/mp4',
    hasAudio: true,
    subtitles: [],
    failedSubtitles: [],
    ...overrides,
  };
}

export type FakeVideoTool = VideoToolBridge & {
  /** The probe for a source, by its file name; default fakeProbe(). */
  probes: Map<string, VideoProbe | Error>;
  jobs: Map<string, VideoJobState>;
  sources: Map<string, VideoSource>;
  emit: (state: VideoJobState) => void;
  /** Moves a job to done (with this output) and tells the listeners. */
  finishJob: (jobId: string, output?: Partial<VideoJobOutput>) => void;
  failJob: (jobId: string, errorCode: VideoJobState['errorCode']) => void;
  listenerCount: () => number;
  texts: Map<string, string>;
  /** What the next pickFiles "picks" (as if chosen in the dialog). */
  nextPick: File[] | null;
};

export function createFakeVideoTool(): FakeVideoTool {
  const listeners = new Set<(event: VideoJobEvent) => void>();
  const sources = new Map<string, VideoSource>();
  const jobs = new Map<string, VideoJobState>();
  const probes = new Map<string, VideoProbe | Error>();
  const texts = new Map<string, string>();
  let sourceCount = 0;
  let jobCount = 0;
  let remakeCount = 0;

  const emit = (state: VideoJobState) => {
    jobs.set(state.jobId, state);
    listeners.forEach((listener) => listener({ type: 'state', state }));
  };

  const tool: FakeVideoTool = {
    probes,
    jobs,
    sources,
    texts,
    emit,
    listenerCount: () => listeners.size,
    finishJob: (jobId, output) => {
      const job = jobs.get(jobId);
      emit({
        ...job,
        phase: 'done',
        percent: 100,
        output: fakeOutput(output),
      });
    },
    failJob: (jobId, errorCode) => {
      emit({ ...jobs.get(jobId), phase: 'failed', errorCode });
    },
    status: vi.fn(async () => ({
      available: true as const,
      ffmpegVersion: 'test',
      freeBytes: 100 * 1024 ** 3,
      av1: true,
      cpuThreads: 16,
      canPause: true,
    })),
    addFiles: vi.fn(
      async (files: File[], relativePaths?: (string | undefined)[]) =>
        Array.from(files).map((file, index) => {
          sourceCount += 1;
          const relativePath =
            relativePaths?.[index] || file.webkitRelativePath;
          const source: VideoSource = {
            id: `source-${sourceCount}`,
            name: file.name,
            size: file.size,
            ...(relativePath ? { relativePath } : {}),
            kind: VIDEO.test(file.name)
              ? 'video'
              : SUBTITLE.test(file.name)
                ? 'subtitle'
                : 'other',
          };
          sources.set(source.id, source);
          return source;
        })
    ),
    forgetSource: vi.fn(async (sourceId: string) => {
      sources.delete(sourceId);
    }),
    probe: vi.fn(async (sourceId: string) => {
      const source = sources.get(sourceId);
      if (!source) throw new Error('[video-tool:source-missing]');
      const probe = probes.get(source.name) ?? fakeProbe();
      if (probe instanceof Error) throw probe;
      return { ...probe, sourceId, name: source.name, size: source.size };
    }),
    frames: vi.fn(
      async (
        _target: { sourceId: string } | { jobId: string },
        options: { count?: number; times?: number[] }
      ): Promise<VideoFrame[]> => {
        const times =
          options.times ??
          Array.from({ length: options.count ?? 1 }, (_, index) => index * 10);
        return times.map((timeSec) => ({ timeSec, dataUrl: FRAME_DATA_URL }));
      }
    ),
    readSubtitleFile: vi.fn(async () => ({
      text: 'WEBVTT',
      encoding: 'utf-8',
      valid: true,
    })),
    startJob: vi.fn(async (spec: VideoJobSpec) => {
      jobCount += 1;
      const state: VideoJobState = {
        jobId: `job-${jobCount}`,
        spec,
        phase: 'queued',
        percent: 0,
      };
      jobs.set(state.jobId, state);
      return state;
    }),
    cancelJob: vi.fn(async (jobId: string) => {
      const job = jobs.get(jobId);
      if (job && !['done', 'failed', 'cancelled'].includes(job.phase)) {
        emit({ ...job, phase: 'cancelled' });
      }
    }),
    pauseJob: vi.fn(async (jobId: string) => {
      const job = jobs.get(jobId);
      if (!job) throw new Error('[video-tool:job-missing]');
      if (['done', 'failed', 'cancelled'].includes(job.phase)) return job;
      emit({ ...job, paused: true, etaSec: undefined });
      return jobs.get(jobId);
    }),
    resumeJob: vi.fn(async (jobId: string) => {
      const job = jobs.get(jobId);
      if (!job) throw new Error('[video-tool:job-missing]');
      if (!job.paused) return job;
      emit({ ...job, paused: false });
      return jobs.get(jobId);
    }),
    // As main: the finished job's subtitles written again under new ids.
    remakeSubtitles: vi.fn(
      async (jobId: string, subtitles: VideoJobSpec['subtitles']) => {
        const job = jobs.get(jobId);
        if (!job || job.phase !== 'done' || !job.output) {
          throw new Error('[video-tool:not-ready]');
        }
        remakeCount += 1;
        const done: VideoJobState = {
          ...job,
          output: {
            ...job.output,
            subtitles: subtitles.map((track, index) => ({
              id: `g${remakeCount}s${index}`,
              language: track.language,
              ...(track.label ? { label: track.label } : {}),
              bytes: 100,
            })),
            failedSubtitles: [],
          },
        };
        emit(done);
        return done;
      }
    ),
    listJobs: vi.fn(async () => [...jobs.values()]),
    releaseJob: vi.fn(async (jobId: string) => {
      // As main: a job released half-way says it has ended, then goes.
      const job = jobs.get(jobId);
      if (job && !['done', 'failed', 'cancelled'].includes(job.phase)) {
        emit({ ...job, phase: 'cancelled' });
      }
      jobs.delete(jobId);
    }),
    readText: vi.fn(async (jobId: string, file: string) => {
      // As main: only a subtitle id from the job's output, never a path.
      const known = jobs
        .get(jobId)
        ?.output?.subtitles.some((track) => track.id === file);
      if (!known) throw new Error('[video-tool:invalid-request] file');
      return texts.get(`${jobId}/${file}`) ?? 'WEBVTT\n\n';
    }),
    uploadChunk: vi.fn(async () => ({ ok: true as const })),
    // As main with a node elsewhere: the file is uploaded.
    buildOnNode: vi.fn(async () => ({
      ok: false as const,
      status: 0,
      reason: 'not-local' as const,
    })),
    saveOutput: vi.fn(
      async (jobId: string): Promise<VideoSaveResult> => ({
        saved: true,
        savedId: `saved-${jobId}`,
        filePath: `/data/videos/${jobId}.mp4`,
      })
    ),
    openSaved: vi.fn(async () => {}),
    pickFiles: vi.fn(async () => {
      const files = tool.nextPick;
      tool.nextPick = null;
      return files ? tool.addFiles(files) : [];
    }),
    nextPick: null,
    onJobEvent: vi.fn((listener: (event: VideoJobEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
  return tool;
}

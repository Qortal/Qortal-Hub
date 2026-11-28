/**
 * Which qualities a video can be converted to, and how big each gets at
 * most, with the engine's own budget math (planVideoJob is pure, so the
 * window runs it too).
 */
import {
  planVideoJob,
  VIDEO_QUALITIES,
  type VideoQualityStep,
} from '../../../electron/src/video-tool-plan';
import type {
  VideoCodec,
  VideoJobQuality,
  VideoProbe,
  VideoQualityId,
} from '../../../electron/src/video-tool-types';

export type QualityUnavailableReason =
  /** The video is smaller: this step would give the same as a lower one. */
  | 'above-source'
  /** Even at the lowest bitrate it allows, it wouldn't fit the limit. */
  | 'too-long'
  /** Keep as is: the file is bigger than the limit. */
  | 'too-big';

export type QualityOption = {
  id: VideoJobQuality;
  available: boolean;
  reason?: QualityUnavailableReason;
  /** The result's size at most (the plan's upper bound). */
  estimateBytes?: number;
  width?: number;
  height?: number;
  /** too-long: the longest video this quality fits. */
  maxDurationSec?: number;
  /**
   * Original quality only: the video's own size sits between two steps (or
   * under the smallest), so a smaller video keeps it rather than a step.
   */
  between?: boolean;
};

/** A step's box filled this much counts as the video's own size. */
const FILL_TOLERANCE = 0.97;

type Size = { width: number; height: number };

const displaySize = (probe: VideoProbe): Size | null =>
  probe?.video
    ? {
        width: probe.video.displayWidth || probe.video.width,
        height: probe.video.displayHeight || probe.video.height,
      }
    : null;

const boxOf = (step: VideoQualityStep, size: Size): Size =>
  size.height > size.width
    ? { width: step.height, height: step.width }
    : { width: step.width, height: step.height };

/** The video reaches the step's box on one side at least. */
const fillsBox = (size: Size, step: VideoQualityStep) => {
  const box = boxOf(step, size);
  return (
    size.width >= box.width * FILL_TOLERANCE ||
    size.height >= box.height * FILL_TOLERANCE
  );
};

const fitsInBox = (size: Size, step: VideoQualityStep) => {
  const box = boxOf(step, size);
  return size.width <= box.width && size.height <= box.height;
};

function planOption(
  probe: VideoProbe,
  id: VideoJobQuality,
  sizeLimitBytes: number,
  audioIndex: number | null | undefined,
  codec: VideoCodec
): QualityOption {
  const plan = planVideoJob(probe, {
    sourceId: probe.sourceId,
    quality: id,
    codec,
    subtitles: [],
    sizeLimitBytes,
    ...(audioIndex !== undefined ? { audioIndex } : {}),
  });
  if (plan.ok === true) {
    return {
      id,
      available: true,
      estimateBytes: Math.min(plan.estimateBytes, sizeLimitBytes),
      width: plan.width,
      height: plan.height,
    };
  }
  if (plan.error === 'too-long-for-limit') {
    return {
      id,
      available: false,
      reason: 'too-long',
      maxDurationSec: plan.maxDurationSec,
    };
  }
  return { id, available: false, reason: 'too-big' };
}

/**
 * Every quality for this video under `sizeLimitBytes`, largest first: the
 * five steps, then Original quality (its own size, its picture kept when it
 * can be) and Keep as is (when it already plays in the apps).
 */
export function qualityOptions(
  probe: VideoProbe | undefined,
  sizeLimitBytes: number,
  audioIndex?: number | null,
  codec: VideoCodec = 'h264'
): QualityOption[] {
  const size = probe ? displaySize(probe) : null;
  if (!probe || !size || !(sizeLimitBytes > 0)) return [];

  const steps = VIDEO_QUALITIES.map((step) =>
    fillsBox(size, step)
      ? planOption(probe, step.id, sizeLimitBytes, audioIndex, codec)
      : ({ id: step.id, available: false, reason: 'above-source' } as const)
  );
  const options: QualityOption[] = [...steps];

  // A video exactly one step's width or height (1920×800 is 1080p's)
  // already has that step for its own size.
  const ownSizeReached = VIDEO_QUALITIES.some((step) => {
    const box = boxOf(step, size);
    return (
      Math.abs(size.width - box.width) <= 2 ||
      Math.abs(size.height - box.height) <= 2
    );
  });
  options.push({
    ...planOption(probe, 'original', sizeLimitBytes, audioIndex, codec),
    between: fitsInBox(size, VIDEO_QUALITIES[0]) && !ownSizeReached,
  });
  if (probe.playableAsIs) {
    options.push(planOption(probe, 'keep', sizeLimitBytes, audioIndex, codec));
  }
  return options;
}

/** The window's one quality choice: a step, Original quality or Keep as is. */
export type WindowQuality = VideoQualityId | 'original' | 'keep';

const isStep = (id: WindowQuality) => id !== 'original' && id !== 'keep';

export type WindowQualityChoice = { id: WindowQuality; available: boolean };

/**
 * The window's quality choices for these videos (each one's
 * qualityOptions): a step is greyed when it's above every video's own size,
 * Original quality is always there, Keep as is is offered when a video
 * could keep its file, and is greyed when none can. With no video read yet,
 * every step is open.
 */
export function windowQualityChoices(
  perVideo: readonly (readonly QualityOption[])[]
): WindowQualityChoice[] {
  const read = perVideo.filter((options) => options.length);
  const steps = VIDEO_QUALITIES.map((step) => ({
    id: step.id,
    // Too long for it only steps that video down: still a choice.
    available:
      !read.length ||
      read.some((options) =>
        options.some(
          (option) =>
            option.id === step.id &&
            (option.available || option.reason === 'too-long')
        )
      ),
  }));
  // Too long for it at its own size only steps that video down.
  const original: WindowQualityChoice = {
    id: 'original',
    available:
      !read.length ||
      read.some((options) =>
        options.some(
          (option) =>
            option.id === 'original' &&
            (option.available || option.reason === 'too-long')
        )
      ),
  };
  const keeps = read
    .map((options) => options.find((option) => option.id === 'keep'))
    .filter(Boolean);
  return keeps.length
    ? [
        ...steps,
        original,
        { id: 'keep', available: keeps.some((option) => option.available) },
      ]
    : [...steps, original];
}

/**
 * The choice the window shows as picked: the preferred one, or, when it's
 * greyed, the first open step below it (what the videos then get).
 */
export function shownWindowQuality(
  choices: readonly WindowQualityChoice[],
  preferred: WindowQuality
): WindowQuality | null {
  const own = choices.find((choice) => choice.id === preferred);
  if (own?.available) return preferred;
  const steps = choices.filter((choice) => isStep(choice.id));
  const from = !isStep(preferred)
    ? 0
    : Math.max(
        0,
        steps.findIndex((choice) => choice.id === preferred)
      );
  return steps.slice(from).find((choice) => choice.available)?.id ?? null;
}

export type EffectiveQuality = {
  quality: VideoJobQuality | null;
  /** The preferred quality didn't fit the limit: a lower one is used. */
  steppedDown: boolean;
};

/**
 * The quality a video converts at: its own choice when that is available,
 * else the preferred one, or the next lower step that fits (Original
 * quality and Keep as is fall back to the largest). A video smaller than
 * the preferred step, between two steps, keeps its own size (Original)
 * rather than being scaled down. Null when nothing fits the limit.
 */
export function effectiveQuality(
  options: readonly QualityOption[],
  preferredChoice: WindowQuality,
  override?: VideoJobQuality
): EffectiveQuality {
  if (override) {
    const own = options.find((option) => option.id === override);
    if (own?.available) return { quality: override, steppedDown: false };
  }
  // Keep as is or Original quality where the video allows it, else the
  // best step it fits.
  if (!isStep(preferredChoice)) {
    const own = options.find((option) => option.id === preferredChoice);
    if (own?.available) {
      return {
        quality: preferredChoice as VideoJobQuality,
        steppedDown: false,
      };
    }
  }
  const preferred: VideoQualityId = isStep(preferredChoice)
    ? (preferredChoice as VideoQualityId)
    : VIDEO_QUALITIES[0].id;
  // Original quality too long for the limit at its own size: a step lower.
  const originalTooLong =
    preferredChoice === 'original' &&
    options.some(
      (option) => option.id === 'original' && option.reason === 'too-long'
    );
  const steps = options.filter((option) =>
    VIDEO_QUALITIES.some((step) => step.id === option.id)
  );
  const start = steps.findIndex((option) => option.id === preferred);
  const original = options.find((option) => option.id === 'original');
  const ownSize = original?.available && original.between;
  let steppedDown = originalTooLong;
  for (const option of steps.slice(Math.max(0, start))) {
    if (option.available) return { quality: option.id, steppedDown };
    if (option.reason === 'above-source') {
      if (ownSize && !originalTooLong) {
        return { quality: 'original', steppedDown: false };
      }
      continue;
    }
    steppedDown = true;
  }
  if (ownSize) return { quality: 'original', steppedDown };
  return { quality: null, steppedDown };
}

/**
 * The video can go up as its file is: its picture and sound already play
 * in the apps, and Keep as is fits the limit.
 */
export const readyAsIs = (options: readonly QualityOption[]): boolean =>
  options.some((option) => option.id === 'keep' && option.available);

/** The option the video converts at, for its size estimate. */
export const chosenOption = (
  options: readonly QualityOption[],
  quality: VideoJobQuality | null
) => options.find((option) => option.id === quality);

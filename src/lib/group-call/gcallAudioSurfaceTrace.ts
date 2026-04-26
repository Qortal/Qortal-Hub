/**
 * Trace points for debugging the main shell → preload → audio-surface window path.
 * Filter DevTools console by: GCall:audio-surface
 *
 * Optional verbose traces (per tick / noisy):
 *   localStorage.setItem('qortal:gcall-audio-pipeline-verbose', '1') in the
 *   audio-surface window DevTools, then reload the audio page.
 */

const TAG = '[GCall:audio-surface]';

const TRACE_KEY = 'qortal:gcall-audio-surface-debug';
const VERBOSE_KEY = 'qortal:gcall-audio-pipeline-verbose';

function isTraceEnabled(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(TRACE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

function isPipelineVerboseEnabled(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(VERBOSE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function traceGcallAudioSurface(
  step: string,
  detail?: Record<string, unknown>
): void {
  if (!isTraceEnabled()) return;
  if (detail && Object.keys(detail).length > 0) {
    console.info(TAG, step, detail);
  } else {
    console.info(TAG, step);
  }
}

/** Throttled gcall:audio + decrypt path (per audio-surface page load). */
let pipelineSessionSawGcallAudio = false;
let pipelineWindowStart = 0;
let pipelineGcallAudioCount = 0;
const PIPELINE_WINDOW_MS = 2000;
let noRoomKeyDropCount = 0;
let noRoomKeyWindowStart = 0;

export function resetGcallAudioPipelineSessionStats(): void {
  pipelineSessionSawGcallAudio = false;
  pipelineWindowStart = 0;
  pipelineGcallAudioCount = 0;
  noRoomKeyDropCount = 0;
  noRoomKeyWindowStart = 0;
}

/**
 * One line per gcall:audio batch at engine ingress (throttled: first + every ~2s summary).
 */
export function tracePipelineGcallAudioIngress(
  detail: Record<string, unknown>
): void {
  const now = Date.now();
  if (!pipelineSessionSawGcallAudio) {
    pipelineSessionSawGcallAudio = true;
    traceGcallAudioSurface('pipeline: first gcall:audio', detail);
  }
  pipelineGcallAudioCount += 1;
  if (pipelineWindowStart === 0) pipelineWindowStart = now;
  if (now - pipelineWindowStart >= PIPELINE_WINDOW_MS) {
    traceGcallAudioSurface('pipeline: gcall:audio window', {
      packetsInWindow: pipelineGcallAudioCount,
      ...detail,
    });
    pipelineGcallAudioCount = 0;
    pipelineWindowStart = now;
  }
  if (isPipelineVerboseEnabled()) {
    traceGcallAudioSurface('pipeline: gcall:audio (verbose)', detail);
  }
}

/**
 * Dropped at decode because `roomKey` is still null (throttled every ~2s / burst count).
 */
export function tracePipelineReceiveDroppedNoRoomKey(
  detail: Record<string, unknown>
): void {
  const now = Date.now();
  noRoomKeyDropCount += 1;
  if (noRoomKeyWindowStart === 0) noRoomKeyWindowStart = now;
  if (now - noRoomKeyWindowStart >= PIPELINE_WINDOW_MS) {
    traceGcallAudioSurface('pipeline: receive drop (no room key)', {
      droppedInWindow: noRoomKeyDropCount,
      ...detail,
    });
    noRoomKeyDropCount = 0;
    noRoomKeyWindowStart = now;
  } else if (noRoomKeyDropCount === 1) {
    traceGcallAudioSurface('pipeline: receive drop (no room key) [first in window]', detail);
  }
}

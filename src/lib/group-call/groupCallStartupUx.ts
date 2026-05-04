import type {
  GroupCallControllerSnapshot,
  GroupCallStartupStatus,
} from './audioEngineTypes';

const STARTUP_DELAY_MS = 4_000;

export function deriveGroupCallStartupStatus(params: {
  snapshot: GroupCallControllerSnapshot;
  elapsedStageMs: number;
}): GroupCallStartupStatus {
  const { snapshot, elapsedStageMs } = params;
  const delayed = elapsedStageMs >= STARTUP_DELAY_MS;
  const remoteCount = Math.max(0, snapshot.participants.length - 1);
  const packetsReceived = snapshot.metrics.packetsReceived ?? 0;
  const packetsDecoded = snapshot.metrics.packetsDecoded ?? 0;
  const hasInboundAudio = packetsReceived > 0 || packetsDecoded > 0;

  if (snapshot.roomState === 'idle' || snapshot.roomState === 'ended') {
    return {
      stage: 'idle',
      headline: '',
      detail: null,
      tone: 'neutral',
      showProgress: false,
      delayed: false,
    };
  }

  if (snapshot.roomState === 'joining') {
    return {
      stage: 'joining-call',
      headline: 'Joining call...',
      detail: 'Connecting to the room and preparing secure voice.',
      tone: 'info',
      showProgress: true,
      delayed,
    };
  }

  if (snapshot.roomState !== 'connected') {
    return {
      stage: 'idle',
      headline: '',
      detail: null,
      tone: 'neutral',
      showProgress: false,
      delayed: false,
    };
  }

  if (remoteCount === 0) {
    return {
      stage: 'syncing-participants',
      headline: 'Waiting for participants...',
      detail: 'Waiting for the other side to appear.',
      tone: 'info',
      showProgress: true,
      delayed,
    };
  }

  if (!snapshot.mediaViable) {
    return {
      stage: hasInboundAudio ? 'starting-audio' : 'securing-audio',
      headline: hasInboundAudio ? 'Starting audio...' : 'Securing audio...',
      detail: delayed
        ? 'This call is taking longer than usual to start. Still waiting for secure incoming audio.'
        : hasInboundAudio
          ? 'Finalizing audio startup so you can hear the other side.'
          : 'Syncing participants and secure audio setup.',
      tone: delayed ? 'warning' : 'info',
      showProgress: true,
      delayed,
    };
  }

  if (snapshot.localConnectionHint) {
    return {
      stage: 'degraded',
      headline: 'Audio is unstable',
      detail: snapshot.localConnectionHint.detail,
      tone: 'warning',
      showProgress: false,
      delayed: false,
    };
  }

  return {
    stage: 'connected',
    headline: 'Connected',
    detail: remoteCount > 1 ? `${remoteCount} other participants in the call.` : null,
    tone: 'neutral',
    showProgress: false,
    delayed: false,
  };
}

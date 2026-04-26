import './messaging/MessagesToBackground.tsx';
import type { AudioSurfaceResponse } from './lib/group-call/audioSurfaceBridge';
import { GroupCallAudioEngineRuntime } from './lib/group-call/groupCallAudioEngineRuntime';
import { traceGcallAudioSurface } from './lib/group-call/gcallAudioSurfaceTrace';

const runtime = new GroupCallAudioEngineRuntime();

if (!window.audioSurfaceHost) {
  traceGcallAudioSurface('audio-surface page: window.audioSurfaceHost is missing; IPC bridge will not work', {});
} else {
  traceGcallAudioSurface('audio-surface page: host bridge present', {});
}
traceGcallAudioSurface('audio-surface page: isolation status', {
  crossOriginIsolated:
    typeof window.crossOriginIsolated === 'boolean'
      ? window.crossOriginIsolated
      : false,
  sharedArrayBufferDefined: typeof SharedArrayBuffer !== 'undefined',
});

runtime.onEvent((event) => {
  window.audioSurfaceHost?.emitEvent(event);
});

if (window.audioSurfaceHost) {
  window.audioSurfaceHost.onCommand(async (envelope) => {
    if (envelope.command.type === 'join-group-call') {
      traceGcallAudioSurface('audio-surface page: onCommand join', {
        roomId: envelope.command.roomId,
      });
    }
    let response: AudioSurfaceResponse;
    try {
      response = await runtime.handleCommand(envelope.command);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'audio-engine-command-throw';
      traceGcallAudioSurface('audio-surface page: handleCommand threw', { message });
      response = { ok: false, error: message };
    }
    traceGcallAudioSurface('audio-surface page: resolveCommand', {
      commandId: envelope.commandId,
      ok: response.ok,
      error: response.ok ? undefined : response.error,
    });
    window.audioSurfaceHost?.resolveCommand({
      commandId: envelope.commandId,
      response,
    });
  });
}

runtime.start();
window.audioSurfaceHost?.notifyReady();

window.addEventListener('beforeunload', () => {
  runtime.dispose();
});

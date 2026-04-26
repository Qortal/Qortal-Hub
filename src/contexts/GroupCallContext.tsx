import React, { useEffect, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { groupChatOpenAtom } from '../atoms/global';
import { useAudioSurfaceGroupCallController } from '../hooks/useAudioSurfaceGroupCallController';
import { useQortalGroupCallSidebarActivitySync } from '../hooks/useQortalGroupCallSidebarActivitySync';
import { buildUnavailableGroupCallControllerApi } from '../lib/group-call/audioSurfaceBridge';
import { traceGcallAudioSurface } from '../lib/group-call/gcallAudioSurfaceTrace';
import {
  GroupCallContext,
  GroupCallJoinErrorNotifier,
  useGroupCallContext,
} from './groupCallContextShared';

/**
 * Group call controller for the main shell: IPC to the cross-origin-isolated
 * audio-surface engine only (no `useGroupVoiceCall` in this layer).
 * uiActive follows the group support panel so metrics flush while that panel is open.
 */
export function GroupCallProvider({ children }: { children: React.ReactNode }) {
  const hasAudioSurface =
    typeof window !== 'undefined' &&
    Boolean((window as Window & { audioSurface?: unknown }).audioSurface);
  if (hasAudioSurface) {
    return <AudioSurfaceGroupCallProvider>{children}</AudioSurfaceGroupCallProvider>;
  }
  return <UnavailableGroupCallProvider>{children}</UnavailableGroupCallProvider>;
}

function UnavailableGroupCallProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    traceGcallAudioSurface('GroupCallProvider: using no-op API (no window.audioSurface on preload)', {
      hasWindow: typeof window !== 'undefined',
    });
  }, []);
  const value = useMemo(
    () => buildUnavailableGroupCallControllerApi(),
    []
  );
  return (
    <GroupCallContext.Provider value={value}>
      <GroupCallJoinErrorNotifier />
      {children}
    </GroupCallContext.Provider>
  );
}

function AudioSurfaceGroupCallProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    traceGcallAudioSurface('GroupCallProvider: audio-surface IPC path (window.audioSurface present)');
  }, []);
  const groupChatOpen = useAtomValue(groupChatOpenAtom);
  useQortalGroupCallSidebarActivitySync();
  const value = useAudioSurfaceGroupCallController(groupChatOpen);
  return (
    <GroupCallContext.Provider value={value}>
      <GroupCallJoinErrorNotifier />
      {children}
    </GroupCallContext.Provider>
  );
}

export { useGroupCallContext };

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  callAudioDevicesAtom,
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
  userInfoAtom,
} from '../atoms/global';
import { myStatusAtom } from '../atoms/presence';
import {
  buildDefaultAudioSurfaceBridgeState,
  isAudioSurfaceSnapshotEvent,
} from '../lib/group-call/audioSurfaceBridge';
import { deriveGroupCallStartupStatus } from '../lib/group-call/groupCallStartupUx';
import { traceGcallAudioSurface } from '../lib/group-call/gcallAudioSurfaceTrace';
import type {
  AudioEngineJoinOptions,
  GroupCallControllerApi,
} from '../lib/group-call/audioEngineTypes';

export function useAudioSurfaceGroupCallController(
  uiActive = false
): GroupCallControllerApi {
  const userInfo = useAtomValue(userInfoAtom);
  const myStatus = useAtomValue(myStatusAtom);
  const callAudioDevices = useAtomValue(callAudioDevicesAtom);
  const setInfoSnackGlobal = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const [bridgeState, setBridgeState] = useState(
    buildDefaultAudioSurfaceBridgeState()
  );
  const [startupClock, setStartupClock] = useState(0);
  const lastSnapshotLogRef = useRef<{
    roomState: string;
    gcallJoinError: string | null;
    roomId: string;
  } | null>(null);
  const startupStageSinceRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!window.audioSurface) {
      traceGcallAudioSurface('controller.setup: no window.audioSurface; ensureReady skipped');
      return;
    }
    const unsubscribe = window.audioSurface.onEvent((event) => {
      if (event.type === 'engine-ready') {
        traceGcallAudioSurface('controller.event: engine-ready', {
          bootstrapRevisionApplied: event.bootstrapRevisionApplied,
        });
        setBridgeState((current) => ({
          ...current,
          hostReady: true,
          bootstrapRevisionApplied: event.bootstrapRevisionApplied,
        }));
        return;
      }
      if (isAudioSurfaceSnapshotEvent(event)) {
        const s = event.snapshot;
        const prev = lastSnapshotLogRef.current;
        if (
          !prev ||
          prev.roomState !== s.roomState ||
          prev.gcallJoinError !== s.gcallJoinError ||
          prev.roomId !== s.roomId
        ) {
          lastSnapshotLogRef.current = {
            roomState: s.roomState,
            gcallJoinError: s.gcallJoinError,
            roomId: s.roomId,
          };
          traceGcallAudioSurface('controller.event: snapshot (changed)', {
            roomState: s.roomState,
            roomId: s.roomId,
            gcallJoinError: s.gcallJoinError,
          });
        }
        setBridgeState((current) => ({
          ...current,
          snapshot: event.snapshot,
        }));
        return;
      }
      if (event.type === 'engine-error') {
        traceGcallAudioSurface('controller.event: engine-error', { message: event.message });
      }
    });
    void (async () => {
      const result = await window.audioSurface!.ensureReady();
      traceGcallAudioSurface('controller.ensureReady: result', {
        success: (result as { success?: boolean })?.success,
        error: (result as { error?: string })?.error,
      });
    })();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!window.audioSurface) return;
    void window.audioSurface.sendCommand({
      type: 'set-user',
      userInfo,
      myStatus,
    });
  }, [myStatus, userInfo]);

  useEffect(() => {
    if (!window.audioSurface) return;
    void window.audioSurface.sendCommand({
      type: 'set-device-preferences',
      inputDeviceId: callAudioDevices.inputDeviceId,
      inputDeviceLabel: callAudioDevices.inputDeviceLabel ?? null,
      inputDeviceGroupId: callAudioDevices.inputDeviceGroupId ?? null,
      outputDeviceId: callAudioDevices.outputDeviceId,
      outputDeviceLabel: callAudioDevices.outputDeviceLabel ?? null,
      outputDeviceGroupId: callAudioDevices.outputDeviceGroupId ?? null,
    });
  }, [
    callAudioDevices.inputDeviceGroupId,
    callAudioDevices.inputDeviceId,
    callAudioDevices.inputDeviceLabel,
    callAudioDevices.outputDeviceGroupId,
    callAudioDevices.outputDeviceId,
    callAudioDevices.outputDeviceLabel,
  ]);

  useEffect(() => {
    if (!window.audioSurface) return;
    void window.audioSurface.sendCommand({
      type: 'set-ui-active',
      uiActive,
    });
  }, [uiActive]);

  const snapshot = bridgeState.snapshot;

  const startupStageKey = useMemo(() => {
    const remoteCount = Math.max(0, snapshot.participants.length - 1);
    const hasInboundAudio =
      (snapshot.metrics.packetsReceived ?? 0) > 0 ||
      (snapshot.metrics.packetsDecoded ?? 0) > 0;
    return [
      snapshot.roomState,
      remoteCount > 0 ? 'remote' : 'solo',
      snapshot.mediaViable ? 'viable' : 'unready',
      hasInboundAudio ? 'inbound' : 'silent',
      snapshot.localConnectionHint ? 'hint' : 'stable',
    ].join(':');
  }, [
    snapshot.localConnectionHint,
    snapshot.mediaViable,
    snapshot.metrics.packetsDecoded,
    snapshot.metrics.packetsReceived,
    snapshot.participants.length,
    snapshot.roomState,
  ]);

  useEffect(() => {
    startupStageSinceRef.current = Date.now();
    setStartupClock((tick) => tick + 1);
  }, [startupStageKey]);

  useEffect(() => {
    if (
      snapshot.roomState !== 'joining' &&
      !(snapshot.roomState === 'connected' && !snapshot.mediaViable)
    ) {
      return;
    }
    const id = window.setInterval(() => {
      setStartupClock((tick) => tick + 1);
    }, 1_000);
    return () => window.clearInterval(id);
  }, [snapshot.mediaViable, snapshot.roomState]);

  const sendCommand = useCallback(
    async (
      command: Parameters<NonNullable<Window['audioSurface']>['sendCommand']>[0]
    ) => {
      if (!window.audioSurface) {
        traceGcallAudioSurface('controller.sendCommand: blocked (no window.audioSurface)', {
          type: command.type,
        });
        return { ok: false as const, error: 'audio-surface-unavailable' };
      }
      const cmdType = command.type;
      const detail =
        cmdType === 'join-group-call'
          ? {
              type: cmdType,
              roomId: command.roomId,
              chatId: command.chatId,
            }
          : { type: cmdType };
      traceGcallAudioSurface('controller.sendCommand: request', detail);
      const response = await window.audioSurface.sendCommand(command);
      traceGcallAudioSurface('controller.sendCommand: response', {
        type: cmdType,
        ok: response.ok,
        error: response.ok ? undefined : response.error,
      });
      return response;
    },
    []
  );
  void startupClock;

  const startupStatus = useMemo(
    () =>
      deriveGroupCallStartupStatus({
        snapshot,
        elapsedStageMs: Math.max(0, Date.now() - startupStageSinceRef.current),
      }),
    [snapshot, startupClock]
  );

  const joinGroupCall = useCallback(
    async (roomId: string, chatId: string, options?: AudioEngineJoinOptions) => {
      traceGcallAudioSurface('controller.joinGroupCall: entered', { roomId, chatId });
      const cachedReadiness =
        await window.electronAPI?.getSystemCallReadiness?.();
      const readiness =
        cachedReadiness?.status === 'good'
          ? cachedReadiness
          : ((await window.electronAPI?.refreshSystemCallReadiness?.()) ??
            cachedReadiness);
      if (!readiness || readiness.status !== 'good') {
        traceGcallAudioSurface('controller.joinGroupCall: blocked by system readiness', {
          status: readiness?.status ?? 'unavailable',
          reasons: readiness?.reasons ?? [],
          cpuLoad: readiness?.cpuLoad ?? null,
          memoryPressure: readiness?.memoryPressure ?? null,
          eventLoopLagMs: readiness?.eventLoopLagMs ?? null,
          cachedStatus: cachedReadiness?.status ?? 'unavailable',
          cachedReasons: cachedReadiness?.reasons ?? [],
        });
        setInfoSnackGlobal({
          type: 'error',
          message:
            'Your system is too busy for calls right now. Close other apps and try again.',
        });
        setOpenSnackGlobal(true);
        return;
      }
      const response = await sendCommand({
        type: 'join-group-call',
        roomId,
        chatId,
        options,
      });
      if (!response.ok) {
        traceGcallAudioSurface('controller.joinGroupCall: sendCommand failed', {
          error: response.error,
        });
      }
    },
    [sendCommand, setInfoSnackGlobal, setOpenSnackGlobal]
  );

  const leaveGroupCall = useCallback(async () => {
    await sendCommand({ type: 'leave-group-call' });
  }, [sendCommand]);

  const clearGcallJoinError = useCallback(() => {
    void sendCommand({ type: 'clear-join-error' });
  }, [sendCommand]);

  const setMuted = useCallback(
    (muted: boolean) => {
      void sendCommand({ type: 'set-muted', muted });
    },
    [sendCommand]
  );

  const setHearCall = useCallback(
    (hearCall: boolean) => {
      void sendCommand({ type: 'set-hear-call', hearCall });
    },
    [sendCommand]
  );

  const toggleHearCall = useCallback(() => {
    void sendCommand({ type: 'set-hear-call', hearCall: !snapshot.hearCall });
  }, [sendCommand, snapshot.hearCall]);

  const exportGroupCallDiagnostics = useCallback(
    async (options?: { download?: boolean; clipboard?: boolean }) => {
      const response = await sendCommand({
        type: 'export-diagnostics',
        options,
      });
      return response.ok ? response.payload : null;
    },
    [sendCommand]
  );

  return useMemo(
    () => ({
      roomState: snapshot.roomState,
      participants: snapshot.participants,
      myRole: snapshot.myRole,
      activeSpeakers: snapshot.activeSpeakers,
      metrics: snapshot.metrics,
      mediaViable: snapshot.mediaViable,
      localConnectionHint: snapshot.localConnectionHint,
      topologyLabel: snapshot.topologyLabel,
      joinGroupCall,
      leaveGroupCall,
      gcallJoinError: snapshot.gcallJoinError,
      clearGcallJoinError,
      exportGroupCallDiagnostics,
      muted: snapshot.muted,
      setMuted,
      hearCall: snapshot.hearCall,
      setHearCall,
      toggleHearCall,
      roomId: snapshot.roomId,
      memberPrimaryNames: snapshot.memberPrimaryNames,
      memberGateGroupName: snapshot.memberGateGroupName,
      audioQualityProfile: snapshot.audioQualityProfile,
      startupStatus,
    }),
    [
      clearGcallJoinError,
      exportGroupCallDiagnostics,
      joinGroupCall,
      leaveGroupCall,
      setHearCall,
      setMuted,
      snapshot.activeSpeakers,
      snapshot.audioQualityProfile,
      snapshot.gcallJoinError,
      snapshot.hearCall,
      snapshot.localConnectionHint,
      snapshot.mediaViable,
      snapshot.memberGateGroupName,
      snapshot.memberPrimaryNames,
      snapshot.metrics,
      snapshot.muted,
      snapshot.myRole,
      snapshot.participants,
      snapshot.roomId,
      snapshot.roomState,
      startupStatus,
      snapshot.topologyLabel,
      toggleHearCall,
    ]
  );
}

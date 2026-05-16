import { contextBridge, ipcRenderer } from 'electron';
import type {
  AudioSurfaceCommandEnvelope,
  AudioSurfaceCommandResultEnvelope,
  AudioSurfaceEvent,
} from './audio-surface-ipc';

const HOST_COMMAND = 'audio-surface:host-command' as const;
let gcallFullStreamOnEventRefCount = 0;

contextBridge.exposeInMainWorld('CapacitorCustomPlatform', {
  name: 'electron',
  plugins: {},
});

contextBridge.exposeInMainWorld('electronAPI', {
  reticulumGetLocalDestinationHash: () =>
    ipcRenderer.invoke('reticulum:getLocalDestinationHash') as Promise<{
      destinationHash: string | null;
    }>,
  reticulumGetLocalIdentityPublicKeyBase64: () =>
    ipcRenderer.invoke('reticulum:getLocalIdentityPublicKeyBase64') as Promise<{
      publicKeyBase64: string | null;
    }>,
  gcallProxySignPresenceMessage: (payload: Record<string, unknown>) =>
    ipcRenderer.invoke('gcall:proxySignPresenceMessage', payload) as Promise<{
      signature?: string;
      error?: string;
      message?: string;
    }>,
  gcallProxyDecryptBoxWithMyKey: (payload: {
    ephemeralPublicKey: string;
    nonce: string;
    ciphertext: string;
  }) =>
    ipcRenderer.invoke('gcall:proxyDecryptBoxWithMyKey', payload) as Promise<{
      decryptedKey?: string;
      error?: string;
      message?: string;
    }>,
});

contextBridge.exposeInMainWorld('groupCall', {
  join: async (
    roomId: string,
    chatId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    reticulumDestinationHash: string,
    joinGeneration?: number,
    topologyEpochFloor?: number,
    reticulumIdentityPublicKeyBase64?: string,
    joinRkSignature?: string
  ) =>
    ipcRenderer.invoke(
      'gcall:join',
      roomId,
      chatId,
      localAddress,
      signature,
      publicKey,
      timestamp,
      reticulumDestinationHash,
      joinGeneration,
      topologyEpochFloor,
      reticulumIdentityPublicKeyBase64,
      joinRkSignature
    ),
  leave: async (
    roomId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ) =>
    ipcRenderer.invoke(
      'gcall:leave',
      roomId,
      localAddress,
      signature,
      publicKey,
      timestamp
    ),
  leaveSync: (
    roomId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ) =>
    ipcRenderer.sendSync(
      'gcall:leaveSync',
      roomId,
      localAddress,
      signature,
      publicKey,
      timestamp
    ) as { success: boolean; error?: string },
  broadcastTopology: async (
    roomId: string,
    topology: unknown,
    signature: string,
    publicKey: string,
    timestamp: number
  ) =>
    ipcRenderer.invoke(
      'gcall:broadcastTopology',
      roomId,
      topology,
      signature,
      publicKey,
      timestamp
    ),
  sendClusterHeartbeat: async (
    roomId: string,
    payload: {
      topologyEpoch: number;
      clusterForwarder: string;
      clusterIndex: number;
      seq: number;
      fromAddress: string;
      fromPublicKey: string;
      timestamp: number;
    },
    signature: string
  ) =>
    ipcRenderer.invoke(
      'gcall:sendClusterHeartbeat',
      roomId,
      payload,
      signature
    ),
  sendAudio: async (
    roomId: string,
    toAddress: string,
    data: Uint8Array,
    timing?: { rendererSendAtWallMs?: number }
  ) => ipcRenderer.invoke('gcall:sendAudio', roomId, toAddress, data, timing),
  sendAudioBatch: async (
    roomId: string,
    toAddresses: string[],
    data: Uint8Array,
    timing?: { rendererSendAtWallMs?: number }
  ) =>
    ipcRenderer.invoke(
      'gcall:sendAudioBatch',
      roomId,
      toAddresses,
      data,
      timing
    ),
  requestPeerMediaRecovery: async (
    roomId: string,
    address: string,
    reason: string
  ) =>
    ipcRenderer.invoke(
      'gcall:requestPeerMediaRecovery',
      roomId,
      address,
      reason
    ) as Promise<{ success: boolean; error?: string }>,
  getLinkStats: async (roomId: string) =>
    ipcRenderer.invoke('gcall:getLinkStats', roomId),
  sendKey: async (
    roomId: string,
    toAddress: string,
    encryptedKey: string,
    fromAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    meta: {
      keyMessageVersion: number;
      callSessionId: string;
      mediaSessionGeneration: number;
      keyCommitment: string;
      encryptedKeyDigest: string;
    }
  ) =>
    ipcRenderer.invoke(
      'gcall:sendKey',
      roomId,
      toAddress,
      encryptedKey,
      fromAddress,
      signature,
      publicKey,
      timestamp,
      meta
    ),
  sendKeyRequest: async (
    roomId: string,
    toAddress: string,
    fromAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    callSessionId: string,
    mediaSessionGeneration: number
  ) =>
    ipcRenderer.invoke(
      'gcall:sendKeyRequest',
      roomId,
      toAddress,
      fromAddress,
      signature,
      publicKey,
      timestamp,
      callSessionId,
      mediaSessionGeneration
    ),
  setLocalAddresses: async (addresses: string[], source?: string) =>
    ipcRenderer.invoke('gcall:setLocalAddresses', addresses, source),
  setQortalGroupReticulumTargets: async (roomId: string, addresses: string[]) =>
    ipcRenderer.invoke(
      'gcall:setQortalGroupReticulumTargets',
      roomId,
      addresses
    ),
  getRoomParticipants: async (roomId: string) =>
    ipcRenderer.invoke('gcall:getRoomParticipants', roomId),
  getRoomBootstrapState: async (roomId: string) =>
    ipcRenderer.invoke('gcall:getRoomBootstrapState', roomId),
  requestRetainedKeyReplay: () => {
    ipcRenderer.send('gcall:request-key-replay');
  },
  onEvent: (cb: (event: string, payload: unknown) => void) => {
    const channels = [
      'gcall:participant-joined',
      'gcall:participant-left',
      'gcall:topology',
      'gcall:cluster-heartbeat',
      'gcall:heartbeat',
      'gcall:audio',
      'gcall:key',
      'gcall:key-request',
      'gcall:session-updated',
    ] as const;

    const handlers = new Map<string, (...args: unknown[]) => void>();
    for (const channel of channels) {
      const handler = (_e: unknown, payload: unknown) => cb(channel, payload);
      handlers.set(channel, handler);
      ipcRenderer.on(channel, handler);
    }
    ipcRenderer.send('gcall:subscribe');
    gcallFullStreamOnEventRefCount++;

    return () => {
      for (const [channel, handler] of handlers) {
        ipcRenderer.removeListener(channel, handler);
      }
      gcallFullStreamOnEventRefCount--;
      if (gcallFullStreamOnEventRefCount <= 0) {
        gcallFullStreamOnEventRefCount = 0;
        ipcRenderer.send('gcall:unsubscribe');
      }
    };
  },
});

contextBridge.exposeInMainWorld('audioSurfaceHost', {
  notifyReady() {
    ipcRenderer.send('audio-surface:host-ready');
  },
  emitEvent(event: AudioSurfaceEvent) {
    ipcRenderer.send('audio-surface:host-event', event);
  },
  resolveCommand(envelope: AudioSurfaceCommandResultEnvelope) {
    return ipcRenderer
      .invoke('audio-surface:command-result', envelope)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false as const, error: message };
      });
  },
  onCommand(listener: (envelope: AudioSurfaceCommandEnvelope) => void) {
    const wrapped = (
      _event: unknown,
      envelope: AudioSurfaceCommandEnvelope
    ) => {
      listener(envelope);
    };
    ipcRenderer.on(HOST_COMMAND, wrapped);
    return () => {
      ipcRenderer.removeListener(HOST_COMMAND, wrapped);
    };
  },
});

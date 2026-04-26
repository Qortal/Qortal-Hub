import type {
  AudioSurfaceBootstrap,
  AudioSurfaceCommand,
  AudioSurfaceEvent,
  AudioSurfaceResponse,
} from './audioSurfaceBridge';
import { buildDefaultGroupCallControllerSnapshot } from './audioSurfaceBridge';
import type {
  AudioEngineJoinOptions,
  GroupCallControllerSnapshot,
  AudioEngineUserIdentity,
} from './audioEngineTypes';
import {
  buildGcallDiagnosticsExportJson,
  copyGcallDiagnosticsToClipboard,
  downloadGcallDiagnosticsJson,
  truncateGcallDiagAddress,
  type GcallDiagExportContext,
} from './gcall-diagnostics';
import packageJson from '../../../package.json';
import {
  decryptBoxWithMyKeyForGroupCall,
  fetchLocalReticulumDestinationHash,
  fetchLocalReticulumIdentityPublicKeyBase64,
  signGroupCallFields,
  signReticulumJoinSplit,
} from './groupCallJoinSigning';
import {
  buildConnectedSnapshot,
  buildJoinFailureSnapshot,
  buildJoiningSnapshot,
  buildPostLeaveSnapshot,
  projectGroupCallEvent,
} from './audioEngineSessionProjector';
import {
  resetGcallAudioPipelineSessionStats,
  traceGcallAudioSurface,
  tracePipelineGcallAudioIngress,
} from './gcallAudioSurfaceTrace';
import { encodeAudioPacketV2 } from './audioPacketCodec';
import { buildMediaKeyCommitmentHex } from './mediaKeyCommitment';
import { GroupCallAudioSenderEngine } from './groupCallAudioSenderEngine';
import {
  GroupCallAudioReceiveEngine,
  type GroupCallAudioReceivePayload,
} from './groupCallAudioReceiveEngine';
import {
  DecryptWorkerPool,
  type DecryptPoolDecryptBatchHandlerInput,
} from './decryptWorkerPool';
import {
  groupCallLocalConnectionHintFromLevel,
  rawConnectionStressLevel,
  type GroupCallLocalConnectionHint,
} from './groupCallLocalConnectionHint';
import {
  buildGroupCallTopology,
  computeGroupCallRole,
  getReticulumTransportTargets,
  normalizeGroupCallTopology,
  type GroupCallTopology,
} from './groupCallTopology';
import { chooseSameEpochTopologyWinner } from './groupCallTopologyAuthority';
import {
  collectActiveSpeakers,
  reconcileParticipantSpeaking,
  sameAddressList,
} from './router';
import AudioDecryptWorker from '../../workers/audio-decrypt.worker?worker';
import nacl from '../../encryption/nacl-fast';
import ed2curve from '../../encryption/ed2curve';
import Base58 from '../../encryption/Base58.js';
import { getGroupMembers } from '../../components/Group/groupApi';

type EventListener = (event: AudioSurfaceEvent) => void;

type IncomingRoomKeyPayload = {
  roomId: string;
  encryptedKey: string;
  fromAddress: string;
  fromPublicKey: string;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  verified?: boolean;
};

type BootstrapRoomState = {
  roomId: string;
  participants: Array<{
    address: string;
    publicKey: string;
    joinedAt: number;
  }>;
  topologyEpoch: number;
  lastTopology?: {
    topologyEpoch: number;
    rootForwarder: string;
    standbyForwarder: string;
    clusters: Array<{
      members: string[];
      forwarder: string;
      standby: string;
      standby2?: string;
    }>;
    lastSeen?: number | null;
  };
  callSessionId: string;
  mediaSessionGeneration: number;
  updatedAtMs: number;
  fromRecentCache?: boolean;
};

type AudioSurfaceDiagEvent = {
  t: number;
  tag: string;
  payload?: Record<string, unknown>;
};

const GCALL_KEY_MESSAGE_VERSION = 3;
const TOPOLOGY_HEARTBEAT_MS = 5_000;
const TOPOLOGY_ELECTION_DEBOUNCE_MS = 120;
const AUTHORITATIVE_KEY_RECOVERY_RETRY_MS = 1_500;
const MAX_AUDIO_SURFACE_DIAG_EVENTS = 120;
const MAX_ACTIVE_SPEAKERS_GLOBAL = 3;
const ACTIVE_SPEAKER_WINDOW_MS = 2_000;
const GCALL_CONNECTION_HINT_BAD_MS = 2_800;
const GCALL_CONNECTION_HINT_SEVERE_MS = 1_200;
const GCALL_CONNECTION_HINT_GOOD_MS = 4_500;
const MEMBER_GATE_REFRESH_INTERVAL_MS = 90_000;
const naclApi = nacl as typeof nacl;

function base64ToUint8(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function uint8ToBase64(value: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < value.length; i++) binary += String.fromCharCode(value[i]!);
  return btoa(binary);
}

function canonicalizeStringMap(value: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, string>>((out, key) => {
        out[key] = value[key]!;
        return out;
      }, {})
  );
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function buildGcKeyDigest(
  toAddress: string,
  encryptedKey: string
): Promise<string> {
  return sha256Hex(JSON.stringify({ encryptedKey, toAddress }));
}

async function buildGcKeyRotateDigest(
  encryptedKeys: Record<string, string>
): Promise<string> {
  return sha256Hex(canonicalizeStringMap(encryptedKeys));
}

function base58DecodeRenderer(value: string): Uint8Array {
  return new Uint8Array(Base58.decode(value.trim()));
}

function encryptRoomKeyForRecipients(
  key: Uint8Array,
  roster: ReadonlyMap<string, { publicKey: string }>,
  myAddr: string
): {
  encryptedKeys: Record<string, string>;
  omittedAddresses: string[];
  failedAddresses: string[];
} {
  const encryptedKeys: Record<string, string> = {};
  const omittedAddresses: string[] = [];
  const failedAddresses: string[] = [];
  for (const [addr, { publicKey }] of roster) {
    if (addr === myAddr) continue;
    if (!publicKey) {
      omittedAddresses.push(addr);
      continue;
    }
    try {
      const recipientPkBytes = base58DecodeRenderer(publicKey);
      const recipientCurve25519PK = ed2curve.convertPublicKey(recipientPkBytes);
      const ephemeralKP = naclApi.box.keyPair();
      const sharedKey = naclApi.box.before(
        recipientCurve25519PK,
        ephemeralKP.secretKey
      );
      const nonce = naclApi.randomBytes(24);
      const ciphertext = naclApi.box.after(key, nonce, sharedKey);
      const combined = new Uint8Array(32 + 24 + ciphertext.length);
      combined.set(ephemeralKP.publicKey, 0);
      combined.set(nonce, 32);
      combined.set(ciphertext, 56);
      encryptedKeys[addr] = uint8ToBase64(combined);
    } catch {
      failedAddresses.push(addr);
    }
  }
  return { encryptedKeys, omittedAddresses, failedAddresses };
}

export class GroupCallAudioEngineRuntime {
  private bootstrapRevisionApplied = 0;
  private readonly listeners = new Set<EventListener>();
  private readonly senderEngine = new GroupCallAudioSenderEngine();
  private readonly receiveEngine: GroupCallAudioReceiveEngine;
  private snapshot: GroupCallControllerSnapshot =
    buildDefaultGroupCallControllerSnapshot();
  private userInfo: AudioEngineUserIdentity | null = null;
  private myStatus: AudioSurfaceBootstrap['myStatus'] = 'online';
  private uiActive = false;
  private inputDeviceId: string | null = null;
  private outputDeviceId: string | null = null;
  private unsubscribeGroupCallEvents: (() => void) | null = null;
  private currentChatId = '';
  private topology: GroupCallTopology | null = null;
  private roomKey: Uint8Array | null = null;
  private callEpochMs = 0;
  private seq = 0;
  private decryptPool: DecryptWorkerPool | null = null;
  private decryptPoolKeyVersion = 0;
  private decryptPoolAppliedKeyVersion = 0;
  private decryptId = 1;
  private callSessionId = '';
  private mediaSessionGeneration = 1;
  private ownsRoomKey = false;
  private selfMintedRoomKey = false;
  private awaitingAuthoritativeKey = false;
  private keyRecoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private topologyHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private topologyElectionTimer: ReturnType<typeof setTimeout> | null = null;
  private activeSpeakerRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private memberGateRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private topologyAsyncGeneration = 0;
  private lastObservedTopologyEpoch = 0;
  private readonly electionDigestCache = new Map<string, string>();
  private readonly activeSpeakerLastSeenAt = new Map<string, number>();
  private readonly diagEvents: AudioSurfaceDiagEvent[] = [];
  private connectionHintBadSince: number | null = null;
  private connectionHintGoodSince: number | null = null;
  private connectionHintSevereSince: number | null = null;
  private memberGateGroupId: number | null = null;
  /** Log once if IPC delivers gcall:audio payload data in a shape that skips the worker pool. */
  private warnedNonArrayBufferAudioData = false;
  /** After a successful join, run one more retained-key replay when topology first arrives. */
  private shouldReplayRetainedKeysAfterNextTopology = false;

  constructor() {
    this.receiveEngine = new GroupCallAudioReceiveEngine(
      (metrics) => {
        this.snapshot = {
          ...this.snapshot,
          metrics,
        };
        this.emitSnapshot();
      },
      (sourceAddr, playedSeq) => {
        this.decryptPool?.setLastPlayedSeq(sourceAddr, playedSeq);
      },
      (packets) => {
        this.noteDecodedPacketActivity(packets);
      }
    );
  }

  start(): void {
    this.emit({
      type: 'engine-ready',
      bootstrapRevisionApplied: this.bootstrapRevisionApplied,
    });
    this.emitSnapshot();
  }

  dispose(): void {
    this.unsubscribeGroupCallEvents?.();
    this.unsubscribeGroupCallEvents = null;
    this.stopTopologyHeartbeat();
    this.clearTopologyElectionTimer();
    this.clearKeyRecoveryRetryTimer();
    this.clearActiveSpeakerRefreshTimer();
    this.clearMemberGateRefreshTimer();
    void this.senderEngine.stop();
    void this.receiveEngine.dispose();
    void this.decryptPool?.terminate();
    this.decryptPool = null;
    this.listeners.clear();
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  applyBootstrap(bootstrap: AudioSurfaceBootstrap): void {
    this.bootstrapRevisionApplied = bootstrap.revision >>> 0;
    this.userInfo = bootstrap.userInfo ?? null;
    this.myStatus = bootstrap.myStatus;
    this.uiActive = bootstrap.uiActive === true;
    this.inputDeviceId = bootstrap.devices?.inputDeviceId ?? null;
    this.outputDeviceId = bootstrap.devices?.outputDeviceId ?? null;
    this.emit({
      type: 'engine-ready',
      bootstrapRevisionApplied: this.bootstrapRevisionApplied,
    });
    this.emitSnapshot();
  }

  async handleCommand(command: AudioSurfaceCommand): Promise<AudioSurfaceResponse> {
    try {
      if (command.type === 'join-group-call') {
        traceGcallAudioSurface('engine.handleCommand: join-group-call', {
          roomId: command.roomId,
          chatId: command.chatId,
        });
      }
      switch (command.type) {
        case 'set-user':
          this.userInfo = command.userInfo ?? null;
          this.myStatus = command.myStatus;
          void this.syncSenderState();
          this.emitSnapshot();
          return { ok: true };
        case 'set-ui-active':
          this.uiActive = command.uiActive === true;
          return { ok: true };
        case 'set-device-preferences':
          this.inputDeviceId = command.inputDeviceId ?? null;
          this.outputDeviceId = command.outputDeviceId ?? null;
          void this.syncSenderState();
          void this.receiveEngine.configure({
            outputDeviceId: this.outputDeviceId,
          });
          return { ok: true };
        case 'join-group-call':
          return await this.joinGroupCall(
            command.roomId,
            command.chatId,
            command.options
          );
        case 'leave-group-call':
          return await this.leaveGroupCall();
        case 'set-muted':
          this.snapshot = { ...this.snapshot, muted: command.muted === true };
          this.senderEngine.setMuted(command.muted === true);
          void this.syncSenderState();
          this.emitSnapshot();
          return { ok: true };
        case 'set-hear-call':
          this.snapshot = { ...this.snapshot, hearCall: command.hearCall === true };
          void this.receiveEngine.configure({
            hearCall: command.hearCall === true,
          });
          this.emitSnapshot();
          return { ok: true };
        case 'set-audio-quality-profile':
          this.snapshot = {
            ...this.snapshot,
            audioQualityProfile: command.profile,
          };
          void this.syncSenderState();
          void this.receiveEngine.configure({
            profile: command.profile,
          });
          this.emitSnapshot();
          return { ok: true };
        case 'clear-join-error':
          this.snapshot = { ...this.snapshot, gcallJoinError: null };
          this.emitSnapshot();
          return { ok: true };
        case 'export-diagnostics':
          return {
            ok: true,
            payload: await this.exportDiagnostics(command.options),
          };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'audio-engine-command-failed';
      this.emit({ type: 'engine-error', message });
      return { ok: false, error: message };
    }
  }

  private emit(event: AudioSurfaceEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitSnapshot(): void {
    this.snapshot = this.withDerivedSnapshotState(this.snapshot);
    this.emit({ type: 'snapshot', snapshot: this.snapshot });
  }

  private recordDiagEvent(tag: string, payload?: Record<string, unknown>): void {
    this.diagEvents.push({
      t: Date.now(),
      tag,
      payload,
    });
    if (this.diagEvents.length > MAX_AUDIO_SURFACE_DIAG_EVENTS) {
      this.diagEvents.splice(
        0,
        this.diagEvents.length - MAX_AUDIO_SURFACE_DIAG_EVENTS
      );
    }
  }

  private buildAudioSurfaceRuntimeDiagnosticsSnapshot(): Record<string, unknown> {
    const topology = this.topology;
    const myAddress = this.userInfo?.address ?? '';
    const role = topology ? computeGroupCallRole(myAddress, topology) : 'listener';
    const receiveEngine = this.receiveEngine.getDiagnosticsSnapshot();
    const decodePaths = [...new Set(receiveEngine.playouts.map((playout) => playout.decodePath))];
    const sharedRingEnabled = receiveEngine.playouts.some(
      (playout) => playout.sharedRingEnabled
    );
    return {
      pipelineMode: {
        crossOriginIsolated:
          typeof window !== 'undefined' ? window.crossOriginIsolated === true : false,
        sharedArrayBufferDefined: typeof SharedArrayBuffer !== 'undefined',
        workerDefined: typeof Worker !== 'undefined',
        roomKeyPresent: this.roomKey !== null,
        decryptPoolEnabled: this.decryptPool !== null,
        decodePaths,
        sharedRingEnabled,
      },
      sessionState: {
        roomId: this.snapshot.roomId || null,
        roomState: this.snapshot.roomState,
        callSessionId: this.callSessionId || null,
        mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
        ownsRoomKey: this.ownsRoomKey,
        selfMintedRoomKey: this.selfMintedRoomKey,
        awaitingAuthoritativeKey: this.awaitingAuthoritativeKey,
        decryptPoolKeyVersion: this.decryptPoolKeyVersion >>> 0,
        decryptPoolAppliedKeyVersion: this.decryptPoolAppliedKeyVersion >>> 0,
        role,
      },
      topologyState: topology
        ? {
            topologyEpoch: topology.topologyEpoch >>> 0,
            rootForwarder: topology.rootForwarder || null,
            standbyForwarder: topology.standbyForwarder || null,
            clusterCount: topology.clusters.length,
            participantCount: this.snapshot.participants.length,
            clusterForwarders: topology.clusters.map((cluster) => ({
              forwarder: cluster.forwarder,
              standby: cluster.standby,
              standby2: cluster.standby2 ?? null,
              memberCount: cluster.members.length,
            })),
          }
        : null,
      receiveEngine,
      decryptPool: this.decryptPool?.stats() ?? {
        enabled: false,
        currentKeyVersion: 0,
      },
      eventCount: this.diagEvents.length,
      recentEvents: [...this.diagEvents],
    };
  }

  private withDerivedSnapshotState(
    snapshot: GroupCallControllerSnapshot
  ): GroupCallControllerSnapshot {
    const myAddress = this.userInfo?.address ?? '';
    let mediaViable = true;
    if (snapshot.roomState === 'connected') {
      const roomKeyPresent = this.roomKey !== null;
      const remoteOthers = snapshot.participants.filter(
        (participant) => participant.address !== myAddress
      );
      const soloCall = remoteOthers.length === 0;
      const firstInbound =
        (snapshot.metrics.packetsReceived ?? 0) > 0 ||
        (snapshot.metrics.packetsDecoded ?? 0) > 0;
      mediaViable = firstInbound || (soloCall && roomKeyPresent);
      if (!roomKeyPresent) {
        mediaViable = false;
      }
    }
    const localConnectionHint = this.deriveLocalConnectionHint(snapshot);
    return {
      ...snapshot,
      mediaViable,
      localConnectionHint,
      topologyLabel: 'Reticulum',
    };
  }

  private deriveLocalConnectionHint(
    snapshot: GroupCallControllerSnapshot
  ): GroupCallLocalConnectionHint | null {
    if (snapshot.roomState !== 'connected') {
      this.connectionHintBadSince = null;
      this.connectionHintGoodSince = null;
      this.connectionHintSevereSince = null;
      return null;
    }
    const raw = rawConnectionStressLevel(snapshot.metrics);
    const now = Date.now();

    if (raw === 0) {
      this.connectionHintSevereSince = null;
      this.connectionHintBadSince = null;
      if (!snapshot.localConnectionHint) {
        this.connectionHintGoodSince = null;
        return null;
      }
      if (this.connectionHintGoodSince === null) {
        this.connectionHintGoodSince = now;
      }
      if (now - this.connectionHintGoodSince >= GCALL_CONNECTION_HINT_GOOD_MS) {
        this.connectionHintGoodSince = null;
        return null;
      }
      return snapshot.localConnectionHint;
    }

    this.connectionHintGoodSince = null;
    if (this.connectionHintBadSince === null) {
      this.connectionHintBadSince = now;
    }
    if (raw === 2) {
      if (this.connectionHintSevereSince === null) {
        this.connectionHintSevereSince = now;
      }
    } else {
      this.connectionHintSevereSince = null;
    }

    const badFor = now - this.connectionHintBadSince;
    const severeFor = this.connectionHintSevereSince
      ? now - this.connectionHintSevereSince
      : 0;
    const previous = snapshot.localConnectionHint ?? null;
    if (raw === 2 && severeFor >= GCALL_CONNECTION_HINT_SEVERE_MS) {
      return groupCallLocalConnectionHintFromLevel(2);
    }
    if (previous?.level === 'severe' && raw >= 1) {
      return previous;
    }
    if (raw >= 1 && badFor >= GCALL_CONNECTION_HINT_BAD_MS) {
      return groupCallLocalConnectionHintFromLevel(1);
    }
    return previous;
  }

  private async exportDiagnostics(options?: {
    download?: boolean;
    clipboard?: boolean;
  }): Promise<string> {
    const liveMetricsSnapshot = this.receiveEngine.getSnapshot();
    const context: GcallDiagExportContext = {
      buildMode: import.meta.env.MODE,
      appVersionLabel: packageJson.version,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      platform:
        typeof navigator !== 'undefined' ? navigator.platform : undefined,
      roomId: this.snapshot.roomId || null,
      chatId: this.currentChatId || null,
      roomState: this.snapshot.roomState,
      myAddressTruncated: this.userInfo?.address
        ? truncateGcallDiagAddress(this.userInfo.address)
        : null,
    };
    const json = buildGcallDiagnosticsExportJson({
      context,
      liveMetricsSnapshot,
      exportWindowMetrics: liveMetricsSnapshot,
      audioSurfaceRuntimeDiagnostics:
        this.buildAudioSurfaceRuntimeDiagnosticsSnapshot(),
    });
    if (options?.clipboard) {
      await copyGcallDiagnosticsToClipboard(json);
    }
    const clipboardOnly =
      options?.clipboard === true && options?.download === false;
    if (!clipboardOnly && options?.download !== false) {
      await downloadGcallDiagnosticsJson(json);
    }
    this.emit({ type: 'diagnostics-exported', json });
    return json;
  }

  private ensureGroupCallSubscription(): void {
    if (this.unsubscribeGroupCallEvents) return;
    if (!window.groupCall?.onEvent) {
      traceGcallAudioSurface(
        'pipeline: BLOCKED — window.groupCall.onEvent missing; no gcall IPC stream',
        {}
      );
      return;
    }
    traceGcallAudioSurface('pipeline: subscribing groupCall.onEvent (gcall:audio, gcall:key, …)', {});
    this.unsubscribeGroupCallEvents = window.groupCall.onEvent((event, payload) => {
      const nextSnapshot = projectGroupCallEvent({
        snapshot: this.snapshot,
        event,
        payload,
      });
      if (nextSnapshot) {
        this.snapshot = nextSnapshot;
        this.emitSnapshot();
      }
      void this.handleGroupCallRuntimeEvent(event, payload);
    });
  }

  private async joinGroupCall(
    roomId: string,
    chatId: string,
    options?: AudioEngineJoinOptions
  ): Promise<AudioSurfaceResponse> {
    this.recordDiagEvent('join-start', { roomId, chatId });
    traceGcallAudioSurface('engine.joinGroupCall: start', {
      roomId,
      chatId,
      hasUser: Boolean(this.userInfo?.address),
    });
    const userInfo = this.userInfo;
    if (!userInfo?.address || !userInfo?.publicKey) {
      traceGcallAudioSurface('engine.joinGroupCall: fail missing user in engine', {});
      this.snapshot = buildJoinFailureSnapshot(this.snapshot, 'not_ready');
      this.emitSnapshot();
      return { ok: false, error: 'missing-user' };
    }
    if (roomId.startsWith('gcall-qortal-') && this.myStatus === 'offline') {
      traceGcallAudioSurface('engine.joinGroupCall: fail presence_offline', {});
      this.snapshot = buildJoinFailureSnapshot(this.snapshot, 'presence_offline');
      this.emitSnapshot();
      return { ok: false, error: 'presence_offline' };
    }
    this.currentChatId = chatId;
    this.callEpochMs = Date.now();
    this.seq = 0;
    this.roomKey = null;
    this.ownsRoomKey = false;
    this.selfMintedRoomKey = false;
    this.awaitingAuthoritativeKey = false;
    this.callSessionId = '';
    this.mediaSessionGeneration = 1;
    this.topology = null;
    this.lastObservedTopologyEpoch = 0;
    this.memberGateGroupId =
      options?.memberGateGroupId != null &&
      Number.isFinite(options.memberGateGroupId)
        ? Math.floor(Number(options.memberGateGroupId))
        : null;
    this.electionDigestCache.clear();
    this.stopTopologyHeartbeat();
    this.clearTopologyElectionTimer();
    this.clearKeyRecoveryRetryTimer();
    this.clearActiveSpeakerRefreshTimer();
    this.clearMemberGateRefreshTimer();
    this.activeSpeakerLastSeenAt.clear();
    this.connectionHintBadSince = null;
    this.connectionHintGoodSince = null;
    this.connectionHintSevereSince = null;
    resetGcallAudioPipelineSessionStats();
    this.warnedNonArrayBufferAudioData = false;
    this.shouldReplayRetainedKeysAfterNextTopology = false;
    // Must set `snapshot.roomId` before the first `gcall:subscribe`, which synchronously
    // replays verified keys over IPC. Otherwise replayed `gcall:key` frames are dropped
    // in handleIncomingRoomKey (room mismatch) and the receive path never gets a key.
    this.snapshot = {
      ...this.snapshot,
      roomId,
      roomState: 'joining',
      gcallJoinError: null,
    };
    this.ensureGroupCallSubscription();
    traceGcallAudioSurface('engine.joinGroupCall: step ensureGroupCallSubscription done', {});
    traceGcallAudioSurface('engine.joinGroupCall: step before senderEngine.stop', {});
    await this.senderEngine.stop();
    traceGcallAudioSurface('engine.joinGroupCall: step after senderEngine.stop', {});
    traceGcallAudioSurface('engine.joinGroupCall: step before syncDecryptPoolRoomKey', {});
    await this.syncDecryptPoolRoomKey(null);
    traceGcallAudioSurface('engine.joinGroupCall: step after syncDecryptPoolRoomKey', {});
    traceGcallAudioSurface('engine.joinGroupCall: step before receiveEngine.reset', {});
    await this.receiveEngine.reset();
    traceGcallAudioSurface('engine.joinGroupCall: step after receiveEngine.reset', {});
    this.snapshot = buildJoiningSnapshot({
      current: this.snapshot,
      roomId,
      user: userInfo,
      options,
    });
    this.emitSnapshot();
    traceGcallAudioSurface('engine.joinGroupCall: step after buildJoiningSnapshot + emitSnapshot', {
      roomState: this.snapshot.roomState,
    });

    traceGcallAudioSurface('engine.joinGroupCall: step before setLocalAddresses', {});
    await window.groupCall?.setLocalAddresses?.([userInfo.address], 'group');
    traceGcallAudioSurface('engine.joinGroupCall: step after setLocalAddresses', {});
    await this.syncQortalGroupReticulumTargets(roomId, options);
    this.startMemberGateRefresh(roomId);
    const joinGeneration = (crypto.getRandomValues(new Uint32Array(1))[0] ??
      0) >>> 0;
    traceGcallAudioSurface('engine.joinGroupCall: step before fetchLocalReticulumDestinationHash', {});
    const reticulumDestinationHash =
      await fetchLocalReticulumDestinationHash();
    traceGcallAudioSurface('engine.joinGroupCall: step after fetchLocalReticulumDestinationHash', {
      hasHash: Boolean(reticulumDestinationHash),
    });
    if (!reticulumDestinationHash) {
      traceGcallAudioSurface('engine.joinGroupCall: fail reticulum_not_ready (no local destination hash)', {});
      this.snapshot = buildJoinFailureSnapshot(
        this.snapshot,
        'reticulum_not_ready'
      );
      this.emitSnapshot();
      return { ok: false, error: 'reticulum_not_ready' };
    }
    traceGcallAudioSurface('engine.joinGroupCall: step before fetchLocalReticulumIdentityPublicKeyBase64', {});
    const reticulumIdentityPublicKeyBase64 =
      await fetchLocalReticulumIdentityPublicKeyBase64();
    traceGcallAudioSurface('engine.joinGroupCall: step after fetchLocalReticulumIdentityPublicKeyBase64', {
      hasKey: Boolean(reticulumIdentityPublicKeyBase64),
    });
    const timestamp = Date.now();
    traceGcallAudioSurface('engine.joinGroupCall: step before signReticulumJoinSplit', {});
    const signed = await signReticulumJoinSplit({
      roomId,
      chatId,
      fromAddress: userInfo.address,
      fromPublicKey: userInfo.publicKey,
      timestamp,
      joinGeneration,
      reticulumDestinationHash,
      reticulumIdentityPublicKeyBase64,
    });
    traceGcallAudioSurface('engine.joinGroupCall: step after signReticulumJoinSplit', {
      hasJoinSig: Boolean(signed?.joinSig),
    });
    if (!signed?.joinSig) {
      this.snapshot = buildJoinFailureSnapshot(this.snapshot, 'join_sign_failed');
      this.emitSnapshot();
      return { ok: false, error: 'join_sign_failed' };
    }
    const joinFn = window.groupCall?.join;
    if (typeof joinFn !== 'function') {
      traceGcallAudioSurface('engine.joinGroupCall: window.groupCall.join missing', {});
      this.snapshot = buildJoinFailureSnapshot(this.snapshot, 'groupcall_api_missing');
      this.emitSnapshot();
      return { ok: false, error: 'groupcall_api_missing' };
    }
    const joinPromise = joinFn(
      roomId,
      chatId,
      userInfo.address,
      signed.joinSig,
      userInfo.publicKey,
      timestamp,
      reticulumDestinationHash,
      joinGeneration,
      0,
      reticulumIdentityPublicKeyBase64 ?? undefined,
      signed.joinRkSig
    );
    const GCALL_JOIN_IPC_TIMEOUT_MS = 25_000;
    traceGcallAudioSurface('engine.joinGroupCall: step before gcall:join (Promise.race)', {
      joinGeneration,
    });
    let result: Awaited<typeof joinPromise>;
    try {
      result = await Promise.race([
        joinPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('gcall-join-ipc-timeout-25s'));
          }, GCALL_JOIN_IPC_TIMEOUT_MS);
        }),
      ]);
      traceGcallAudioSurface('engine.joinGroupCall: step after gcall:join (Promise.race settled)', {
        success: result?.success,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'gcall-join-failed';
      traceGcallAudioSurface('engine.joinGroupCall: join race failed', { msg });
      this.snapshot = buildJoinFailureSnapshot(this.snapshot, msg);
      this.emitSnapshot();
      return { ok: false, error: msg };
    }
    if (!result?.success) {
      const err = result?.error ?? 'join_failed';
      traceGcallAudioSurface('engine.joinGroupCall: main join returned failure', { error: err });
      this.snapshot = buildJoinFailureSnapshot(
        this.snapshot,
        err
      );
      this.emitSnapshot();
      return { ok: false, error: err };
    }
    traceGcallAudioSurface('engine.joinGroupCall: success', { roomId });
    this.recordDiagEvent('join-success', { roomId });
    this.snapshot = buildConnectedSnapshot(this.snapshot, roomId);
    this.emitSnapshot();
    this.callSessionId = result.callSessionId ?? '';
    this.mediaSessionGeneration = (result.mediaSessionGeneration ?? 1) >>> 0;
    if (typeof window.groupCall?.requestRetainedKeyReplay === 'function') {
      window.groupCall.requestRetainedKeyReplay();
      traceGcallAudioSurface(
        'engine.joinGroupCall: requested retained key replay from main (post-join)',
        { roomId }
      );
    }
    this.shouldReplayRetainedKeysAfterNextTopology = true;
    await this.hydrateBootstrapState(roomId);
    if (!this.topology?.rootForwarder) {
      this.scheduleTopologyElection('post-join');
    }
    return { ok: true, payload: result };
  }

  private async leaveGroupCall(): Promise<AudioSurfaceResponse> {
    const userInfo = this.userInfo;
    if (!userInfo?.address || !this.snapshot.roomId) {
      return { ok: true };
    }
    const timestamp = Date.now();
    const signature = await signGroupCallFields({
      type: 'GC_LEAVE',
      roomId: this.snapshot.roomId,
      fromAddress: userInfo.address,
      fromPublicKey: userInfo.publicKey ?? '',
      timestamp,
    }).catch(() => '');
    await window.groupCall?.leave?.(
      this.snapshot.roomId,
      userInfo.address,
      signature,
      userInfo.publicKey ?? '',
      timestamp
    );
    this.roomKey = null;
    this.ownsRoomKey = false;
    this.selfMintedRoomKey = false;
    this.awaitingAuthoritativeKey = false;
    this.callSessionId = '';
    this.mediaSessionGeneration = 1;
    this.topology = null;
    this.lastObservedTopologyEpoch = 0;
    this.seq = 0;
    this.shouldReplayRetainedKeysAfterNextTopology = false;
    this.stopTopologyHeartbeat();
    this.clearTopologyElectionTimer();
    this.clearKeyRecoveryRetryTimer();
    this.clearActiveSpeakerRefreshTimer();
    this.clearMemberGateRefreshTimer();
    await this.senderEngine.stop();
    await this.syncDecryptPoolRoomKey(null);
    await this.receiveEngine.reset();
    this.memberGateGroupId = null;
    this.activeSpeakerLastSeenAt.clear();
    this.connectionHintBadSince = null;
    this.connectionHintGoodSince = null;
    this.connectionHintSevereSince = null;
    this.snapshot = buildPostLeaveSnapshot(this.snapshot);
    this.emitSnapshot();
    resetGcallAudioPipelineSessionStats();
    return { ok: true };
  }

  private async handleGroupCallRuntimeEvent(
    event: string,
    payload: unknown
  ): Promise<void> {
    if (event === 'gcall:topology') {
      const topology = payload as GroupCallTopology;
      if (topology?.roomId !== this.snapshot.roomId) return;
      await this.applyTopology(topology, 'remote-event');
      return;
    }
    if (event === 'gcall:participant-joined' || event === 'gcall:participant-left') {
      const roomId = (payload as { roomId?: string } | null | undefined)?.roomId;
      if (roomId === this.snapshot.roomId) {
        if (event === 'gcall:participant-left') {
          const leavingAddress = (payload as { address?: string } | null | undefined)?.address;
          if (leavingAddress) {
            this.activeSpeakerLastSeenAt.delete(leavingAddress);
            this.refreshActiveSpeakerState();
          }
        }
        this.scheduleTopologyElection(event);
      }
      return;
    }
    if (event === 'gcall:key') {
      const keyP = payload as IncomingRoomKeyPayload;
      traceGcallAudioSurface('pipeline: gcall:key received', {
        roomId: keyP?.roomId,
        from: keyP?.fromAddress,
        verified: keyP?.verified === true,
        keyMessageVersion: keyP?.keyMessageVersion,
      });
      this.recordDiagEvent('gcall-key-received', {
        roomId: keyP?.roomId,
        fromAddress: keyP?.fromAddress,
        verified: keyP?.verified === true,
        keyMessageVersion: keyP?.keyMessageVersion,
      });
      await this.handleIncomingRoomKey(keyP);
      return;
    }
    if (event === 'gcall:audio') {
      const audioPayload = payload as GroupCallAudioReceivePayload;
      if (audioPayload?.roomId !== this.snapshot.roomId) {
        traceGcallAudioSurface('pipeline: gcall:audio dropped (room mismatch)', {
          expectedRoomId: this.snapshot.roomId,
          payloadRoomId: audioPayload?.roomId,
        });
        return;
      }
      const dataBuf = audioPayload.data;
      const byteLen =
        dataBuf instanceof ArrayBuffer
          ? dataBuf.byteLength
          : ArrayBuffer.isView(dataBuf)
            ? dataBuf.byteLength
            : 0;
      const poolReady =
        this.decryptPool !== null &&
        this.decryptPoolAppliedKeyVersion === this.decryptPoolKeyVersion;
      const fromAddr =
        audioPayload.fromAddress ?? audioPayload.resolvedFromAddress ?? '';
      tracePipelineGcallAudioIngress({
        from: fromAddr || undefined,
        bytes: byteLen,
        hasRoomKey: this.roomKey !== null,
        poolReady,
        transport: audioPayload.transport ?? 'unknown',
        dataIsArrayBuffer: audioPayload.data instanceof ArrayBuffer,
      });
      if (
        !this.warnedNonArrayBufferAudioData &&
        poolReady &&
        !(audioPayload.data instanceof ArrayBuffer) &&
        byteLen > 0
      ) {
        this.warnedNonArrayBufferAudioData = true;
        traceGcallAudioSurface(
          'pipeline: gcall:audio data is not ArrayBuffer — worker pool path skipped (check IPC clone type)',
          { ctor: (audioPayload.data as object)?.constructor?.name }
        );
      }
      if (poolReady && audioPayload.data instanceof ArrayBuffer) {
        this.receiveEngine.noteIncomingAudio(audioPayload.bridgeReceivedAtWallMs);
        const ingressPeerAddress =
          audioPayload.fromAddress ??
          audioPayload.resolvedFromAddress ??
          'unknown';
        const posted = this.decryptPool!.postDecrypt(
          ingressPeerAddress,
          this.decryptId++,
          audioPayload.data.slice(0)
        );
        if (posted) {
          return;
        }
        traceGcallAudioSurface('pipeline: decrypt pool postDecrypt returned false, falling back', {
          from: ingressPeerAddress,
        });
      }
      const decodedCount = await this.receiveEngine.handleIncomingAudio(
        audioPayload,
        this.roomKey
      );
      if (decodedCount === 0 && this.awaitingAuthoritativeKey) {
        traceGcallAudioSurface(
          'pipeline: gcall:audio decode failed while awaiting authoritative room key',
          {
            roomId: this.snapshot.roomId,
            from: fromAddr || null,
            currentRoot: this.topology?.rootForwarder ?? null,
            ownsRoomKey: this.ownsRoomKey,
            selfMintedRoomKey: this.selfMintedRoomKey,
          }
        );
        this.recordDiagEvent('audio-decode-failed-awaiting-authoritative-key', {
          roomId: this.snapshot.roomId,
          fromAddress: fromAddr || null,
          currentRoot: this.topology?.rootForwarder ?? null,
          ownsRoomKey: this.ownsRoomKey,
          selfMintedRoomKey: this.selfMintedRoomKey,
        });
        this.scheduleAuthoritativeKeyRecovery('decode-failure');
      }
      return;
    }
    if (event === 'gcall:session-updated') {
      const p = payload as {
        roomId: string;
        callSessionId?: string;
        mediaSessionGeneration?: number;
      };
      if (p.roomId !== this.snapshot.roomId) return;
      traceGcallAudioSurface(
        'pipeline: gcall:session-updated — room key cleared, receive reset',
        { roomId: this.snapshot.roomId }
      );
      this.recordDiagEvent('session-updated-reset', {
        roomId: this.snapshot.roomId,
        mediaSessionGeneration:
          (p.mediaSessionGeneration ?? this.mediaSessionGeneration ?? 1) >>> 0,
      });
      this.callSessionId = p.callSessionId ?? this.callSessionId;
      this.mediaSessionGeneration =
        (p.mediaSessionGeneration ?? this.mediaSessionGeneration ?? 1) >>> 0;
      this.roomKey = null;
      this.ownsRoomKey = false;
      this.selfMintedRoomKey = false;
      this.awaitingAuthoritativeKey = false;
      this.seq = 0;
      this.callEpochMs = Date.now();
      this.activeSpeakerLastSeenAt.clear();
      this.clearActiveSpeakerRefreshTimer();
      await this.senderEngine.stop();
      await this.syncDecryptPoolRoomKey(null);
      await this.receiveEngine.reset();
      await this.handleSessionUpdated();
      return;
    }
    if (event === 'gcall:key-request') {
      await this.handleIncomingKeyRequest(
        payload as {
          roomId: string;
          toAddress: string;
          fromAddress: string;
          fromPublicKey: string;
          verified?: boolean;
          callSessionId?: string;
          mediaSessionGeneration?: number;
        }
      );
    }
  }

  private async handleIncomingRoomKey(
    payload: IncomingRoomKeyPayload
  ): Promise<void> {
    if (payload?.roomId !== this.snapshot.roomId) {
      traceGcallAudioSurface('pipeline: gcall:key dropped (room mismatch)', {
        expectedRoomId: this.snapshot.roomId,
        payloadRoomId: payload?.roomId,
      });
      return;
    }
    if (payload?.verified !== true) {
      traceGcallAudioSurface('pipeline: gcall:key dropped (not verified)', {
        roomId: payload?.roomId,
        from: payload?.fromAddress,
      });
      return;
    }
    if (payload?.keyMessageVersion !== GCALL_KEY_MESSAGE_VERSION) {
      traceGcallAudioSurface('pipeline: gcall:key dropped (wrong key message version)', {
        want: GCALL_KEY_MESSAGE_VERSION,
        got: payload?.keyMessageVersion,
      });
      return;
    }
    if (!payload?.encryptedKey) {
      traceGcallAudioSurface('pipeline: gcall:key dropped (missing encryptedKey)', {
        from: payload?.fromAddress,
      });
      return;
    }
    const senderInRoster = this.snapshot.participants.some(
      (participant) => participant.address === payload.fromAddress
    );
    const currentRoot = this.topology?.rootForwarder?.trim() ?? '';
    const trustedSender = currentRoot
      ? payload.fromAddress === currentRoot
      : senderInRoster || this.snapshot.participants.length <= 2;
    const canDecryptBox =
      typeof window.sendMessage === 'function' ||
      typeof (window as Window & { electronAPI?: { gcallProxyDecryptBoxWithMyKey?: unknown } })
        .electronAPI?.gcallProxyDecryptBoxWithMyKey === 'function';
    if (!trustedSender) {
      traceGcallAudioSurface('pipeline: gcall:key dropped (untrusted sender for topology)', {
        from: payload.fromAddress,
        currentRoot: currentRoot || null,
        senderInRoster,
        participants: this.snapshot.participants.length,
      });
      return;
    }
    if (!canDecryptBox) {
      traceGcallAudioSurface(
        'pipeline: gcall:key dropped (no sendMessage / gcallProxyDecryptBoxWithMyKey — cannot decrypt box)',
        {}
      );
      return;
    }
    const combined = base64ToUint8(payload.encryptedKey);
    const ephemeralPublicKey = btoa(
      String.fromCharCode(...combined.slice(0, 32))
    );
    const nonce = btoa(String.fromCharCode(...combined.slice(32, 56)));
    const ciphertext = btoa(String.fromCharCode(...combined.slice(56)));
    const result = await decryptBoxWithMyKeyForGroupCall({
      ephemeralPublicKey,
      nonce,
      ciphertext,
    });
    if (!result?.decryptedKey) {
      traceGcallAudioSurface('pipeline: gcall:key decrypt failed (decryptBox empty)', {
        from: payload.fromAddress,
      });
      return;
    }
    const roomKey = base64ToUint8(result.decryptedKey);
    const expectedCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      payload.callSessionId,
      payload.mediaSessionGeneration >>> 0
    );
    if (expectedCommitment !== payload.keyCommitment) {
      traceGcallAudioSurface('pipeline: gcall:key dropped (keyCommitment mismatch)', {
        from: payload.fromAddress,
      });
      return;
    }
    this.roomKey = roomKey;
    this.ownsRoomKey = false;
    this.selfMintedRoomKey = false;
    this.awaitingAuthoritativeKey = false;
    this.clearKeyRecoveryRetryTimer();
    this.callEpochMs = Date.now();
    this.seq = 0;
    await this.syncDecryptPoolRoomKey(roomKey);
    traceGcallAudioSurface('pipeline: room key applied, decrypt path enabled', {
      keyBytes: roomKey.length,
      from: payload.fromAddress,
    });
    this.recordDiagEvent('room-key-applied', {
      roomId: this.snapshot.roomId,
      fromAddress: payload.fromAddress,
      keyBytes: roomKey.length,
      mediaSessionGeneration: payload.mediaSessionGeneration >>> 0,
    });
    await this.syncSenderState();
  }

  private async handleSessionUpdated(): Promise<void> {
    const myAddress = this.userInfo?.address ?? '';
    const root = this.topology?.rootForwarder?.trim() ?? '';
    if (!myAddress || !this.snapshot.roomId || !this.callSessionId) return;
    if (!root) {
      this.scheduleTopologyElection('session-updated-no-topology');
      return;
    }
    if (root && root === myAddress) {
      const roomKey = naclApi.randomBytes(32);
      this.roomKey = roomKey;
      this.ownsRoomKey = true;
      this.selfMintedRoomKey = true;
      this.awaitingAuthoritativeKey = false;
      this.clearKeyRecoveryRetryTimer();
      this.callEpochMs = Date.now();
      this.seq = 0;
      await this.syncDecryptPoolRoomKey(roomKey);
      await this.distributeRoomKey(roomKey);
      await this.syncSenderState();
      traceGcallAudioSurface('pipeline: session-updated minted and distributed room key', {
        roomId: this.snapshot.roomId,
        mediaSessionGeneration: this.mediaSessionGeneration,
      });
      this.recordDiagEvent('session-updated-room-key-distributed', {
        roomId: this.snapshot.roomId,
        mediaSessionGeneration: this.mediaSessionGeneration,
      });
      await this.syncTopologyHeartbeat();
      return;
    }
    if (root) {
      this.awaitingAuthoritativeKey = true;
      await this.requestRoomKeyFrom(root, 'session-updated');
      this.requestRetainedKeyReplay('session-updated');
      this.scheduleAuthoritativeKeyRecovery('session-updated');
    }
  }

  private async hydrateBootstrapState(roomId: string): Promise<void> {
    const bootstrap = await window.groupCall?.getRoomBootstrapState?.(roomId).catch(
      () => null
    );
    const roster = await window.groupCall?.getRoomParticipants?.(roomId).catch(
      () => []
    );
    if (roomId !== this.snapshot.roomId) return;

    const participantMap = new Map<string, { address: string; publicKey: string }>();
    for (const participant of this.snapshot.participants) {
      if (participant.address) {
        participantMap.set(participant.address, {
          address: participant.address,
          publicKey: participant.publicKey ?? '',
        });
      }
    }
    for (const participant of bootstrap?.participants ?? []) {
      if (participant?.address) {
        participantMap.set(participant.address, {
          address: participant.address,
          publicKey: participant.publicKey ?? '',
        });
      }
    }
    for (const participant of roster ?? []) {
      if (participant?.address) {
        participantMap.set(participant.address, {
          address: participant.address,
          publicKey: participant.publicKey ?? '',
        });
      }
    }
    this.snapshot = {
      ...this.snapshot,
      participants: [...participantMap.values()].map((participant) => ({
        ...participant,
        speaking: false,
        role: 'participant',
      })),
    };

    if (bootstrap?.callSessionId) {
      this.callSessionId = bootstrap.callSessionId;
      this.mediaSessionGeneration =
        (bootstrap.mediaSessionGeneration ?? 1) >>> 0;
    }

    const bootstrapTopology = bootstrap?.lastTopology;
    if (bootstrapTopology?.rootForwarder) {
      this.topology = {
        roomId,
        topologyEpoch: bootstrapTopology.topologyEpoch,
        rootForwarder: bootstrapTopology.rootForwarder,
        standbyForwarder: bootstrapTopology.standbyForwarder,
        clusters: bootstrapTopology.clusters.map((cluster) => ({
          members: [...cluster.members],
          forwarder: cluster.forwarder,
          standby: cluster.standby,
          standby2: cluster.standby2 ?? '',
        })),
        lastSeen: bootstrapTopology.lastSeen ?? bootstrap.updatedAtMs ?? Date.now(),
      };
      const myAddress = this.userInfo?.address ?? '';
      this.snapshot = {
        ...this.snapshot,
        myRole: computeGroupCallRole(myAddress, this.topology),
      };
      this.lastObservedTopologyEpoch = Math.max(
        this.lastObservedTopologyEpoch,
        this.topology.topologyEpoch >>> 0
      );
    }

    this.emitSnapshot();
    traceGcallAudioSurface('pipeline: bootstrap hydration applied', {
      roomId,
      participantCount: this.snapshot.participants.length,
      hasTopology: Boolean(this.topology?.rootForwarder),
      callSessionId: this.callSessionId || null,
      mediaSessionGeneration: this.mediaSessionGeneration,
      fromRecentCache: bootstrap?.fromRecentCache ?? false,
    });
    this.recordDiagEvent('bootstrap-hydration-applied', {
      roomId,
      participantCount: this.snapshot.participants.length,
      hasTopology: Boolean(this.topology?.rootForwarder),
      callSessionId: this.callSessionId || null,
      mediaSessionGeneration: this.mediaSessionGeneration,
      fromRecentCache: bootstrap?.fromRecentCache ?? false,
    });

    const root = this.topology?.rootForwarder?.trim() ?? '';
    const myAddress = this.userInfo?.address ?? '';
    if (!this.roomKey && root && root !== myAddress) {
      await this.requestRoomKeyFrom(root, 'topology');
    }
    if (!root) {
      this.scheduleTopologyElection('bootstrap-no-topology');
    }
  }

  private async syncCallSessionFromMainForKeyRecovery(): Promise<void> {
    const roomId = this.snapshot.roomId;
    if (!roomId) return;
    const api = window.groupCall?.getRoomBootstrapState;
    if (typeof api !== 'function') return;
    try {
      const state = await api(roomId);
      if (!state?.callSessionId || roomId !== this.snapshot.roomId) return;
      const mainCallSessionId = state.callSessionId.trim();
      const mainGeneration = (state.mediaSessionGeneration ?? 1) >>> 0;
      const localCallSessionId = this.callSessionId.trim();
      const localGeneration = this.mediaSessionGeneration >>> 0;
      if (!mainCallSessionId) return;
      if (mainGeneration > localGeneration) {
        this.callSessionId = mainCallSessionId;
        this.mediaSessionGeneration = mainGeneration;
        traceGcallAudioSurface('pipeline: session identity synced from main', {
          roomId,
          reason: 'newer-generation',
          mainGeneration,
          localGeneration,
        });
        this.recordDiagEvent('session-identity-synced', {
          roomId,
          reason: 'newer-generation',
          mainGeneration,
          localGeneration,
        });
        return;
      }
      if (mainGeneration === localGeneration && mainCallSessionId !== localCallSessionId) {
        this.callSessionId = mainCallSessionId;
        traceGcallAudioSurface('pipeline: session identity synced from main', {
          roomId,
          reason: 'same-generation-uuid',
          mainGeneration,
        });
        this.recordDiagEvent('session-identity-synced', {
          roomId,
          reason: 'same-generation-uuid',
          mainGeneration,
        });
      }
    } catch {
      /* ignore */
    }
  }

  private clearTopologyElectionTimer(): void {
    if (this.topologyElectionTimer) {
      clearTimeout(this.topologyElectionTimer);
      this.topologyElectionTimer = null;
    }
  }

  private clearKeyRecoveryRetryTimer(): void {
    if (this.keyRecoveryRetryTimer) {
      clearTimeout(this.keyRecoveryRetryTimer);
      this.keyRecoveryRetryTimer = null;
    }
  }

  private stopTopologyHeartbeat(): void {
    if (this.topologyHeartbeatTimer) {
      clearInterval(this.topologyHeartbeatTimer);
      this.topologyHeartbeatTimer = null;
    }
  }

  private scheduleTopologyElection(reason: string): void {
    if (
      !this.snapshot.roomId ||
      !this.userInfo?.address ||
      (this.snapshot.roomState !== 'joining' && this.snapshot.roomState !== 'connected')
    ) {
      return;
    }
    this.clearTopologyElectionTimer();
    this.topologyElectionTimer = setTimeout(() => {
      this.topologyElectionTimer = null;
      const generation = ++this.topologyAsyncGeneration;
      void this.runTopologyElection(generation, reason);
    }, TOPOLOGY_ELECTION_DEBOUNCE_MS);
  }

  private async runTopologyElection(
    generation: number,
    reason: string
  ): Promise<void> {
    const roomId = this.snapshot.roomId;
    const myAddress = this.userInfo?.address ?? '';
    if (!roomId || !myAddress) return;
    const participantSet = new Set<string>();
    for (const participant of this.snapshot.participants) {
      const address = participant.address?.trim() ?? '';
      if (address) participantSet.add(address);
    }
    participantSet.add(myAddress);
    const addresses = [...participantSet];
    if (addresses.length === 0) return;
    const sorted = await this.computeElectionOrder(addresses, roomId);
    if (generation !== this.topologyAsyncGeneration || roomId !== this.snapshot.roomId) {
      return;
    }
    const topologyEpoch =
      Math.max(
        this.topology?.topologyEpoch ?? 0,
        this.lastObservedTopologyEpoch ?? 0
      ) + 1;
    const topology = normalizeGroupCallTopology({
      ...buildGroupCallTopology(sorted, topologyEpoch),
      roomId,
      lastSeen: Date.now(),
    });
    traceGcallAudioSurface('pipeline: local topology election result', {
      roomId,
      reason,
      topologyEpoch,
      participantCount: sorted.length,
      rootForwarder: topology.rootForwarder,
      standbyForwarder: topology.standbyForwarder,
    });
    this.recordDiagEvent('local-topology-election', {
      roomId,
      reason,
      topologyEpoch,
      participantCount: sorted.length,
      rootForwarder: topology.rootForwarder,
      standbyForwarder: topology.standbyForwarder,
    });
    const applied = await this.applyTopology(topology, 'local-election');
    if (applied) {
      await this.broadcastTopology(topology, reason);
    }
  }

  private async computeElectionOrder(
    addresses: string[],
    roomId: string
  ): Promise<string[]> {
    const scores = await Promise.all(
      addresses.map(async (address) => ({
        address,
        digest:
          this.electionDigestCache.get(address) ??
          (await sha256Hex(`${address}:${roomId}`)),
      }))
    );
    scores.sort((left, right) => left.digest.localeCompare(right.digest));
    for (const score of scores) {
      this.electionDigestCache.set(score.address, score.digest);
    }
    return scores.map((score) => score.address);
  }

  private isSameTopologyStructure(
    left: GroupCallTopology | null,
    right: GroupCallTopology
  ): boolean {
    if (!left) return false;
    if (
      left.topologyEpoch !== right.topologyEpoch ||
      left.rootForwarder !== right.rootForwarder ||
      left.standbyForwarder !== right.standbyForwarder ||
      left.clusters.length !== right.clusters.length
    ) {
      return false;
    }
    return left.clusters.every((cluster, index) => {
      const next = right.clusters[index];
      if (!next) return false;
      return (
        cluster.forwarder === next.forwarder &&
        cluster.standby === next.standby &&
        (cluster.standby2 ?? '') === (next.standby2 ?? '') &&
        cluster.members.length === next.members.length &&
        cluster.members.every((member, memberIndex) => member === next.members[memberIndex])
      );
    });
  }

  private async maybeReplayRetainedKeysAfterTopology(
    topology: GroupCallTopology
  ): Promise<void> {
    if (!this.shouldReplayRetainedKeysAfterNextTopology) return;
    this.shouldReplayRetainedKeysAfterNextTopology = false;
    if (typeof window.groupCall?.requestRetainedKeyReplay !== 'function') return;
    window.groupCall.requestRetainedKeyReplay();
    traceGcallAudioSurface(
      'pipeline: gcall:topology — retained key replay (keys may only be storable after root is known)',
      { roomId: topology.roomId }
    );
  }

  private requestRetainedKeyReplay(reason: string): void {
    if (typeof window.groupCall?.requestRetainedKeyReplay !== 'function') return;
    window.groupCall.requestRetainedKeyReplay();
    traceGcallAudioSurface('pipeline: requested retained key replay', {
      roomId: this.snapshot.roomId,
      reason,
    });
    this.recordDiagEvent('retained-key-replay-requested', {
      roomId: this.snapshot.roomId,
      reason,
    });
  }

  private scheduleAuthoritativeKeyRecovery(reason: string): void {
    const root = this.topology?.rootForwarder?.trim() ?? '';
    const myAddress = this.userInfo?.address ?? '';
    if (
      !this.awaitingAuthoritativeKey ||
      !root ||
      !myAddress ||
      root === myAddress ||
      !this.snapshot.roomId
    ) {
      return;
    }
    this.clearKeyRecoveryRetryTimer();
    this.keyRecoveryRetryTimer = setTimeout(() => {
      this.keyRecoveryRetryTimer = null;
      void this.requestRoomKeyFrom(root, 'topology');
      this.requestRetainedKeyReplay(reason);
      if (this.awaitingAuthoritativeKey) {
        this.scheduleAuthoritativeKeyRecovery(reason);
      }
    }, AUTHORITATIVE_KEY_RECOVERY_RETRY_MS);
  }

  private async broadcastTopology(
    topology: GroupCallTopology,
    reason: string
  ): Promise<void> {
    if (
      !this.userInfo?.address ||
      !this.snapshot.roomId ||
      typeof window.groupCall?.broadcastTopology !== 'function'
    ) {
      return;
    }
    const timestamp = Date.now();
    const signature = await signGroupCallFields({
      type: 'GC_TOPOLOGY',
      roomId: this.snapshot.roomId,
      topologyEpoch: topology.topologyEpoch,
      rootForwarder: topology.rootForwarder,
      standbyForwarder: topology.standbyForwarder,
      fromAddress: this.userInfo.address,
      fromPublicKey: this.userInfo.publicKey ?? '',
      timestamp,
    }).catch(() => '');
    if (!signature) return;
    await window.groupCall.broadcastTopology(
      this.snapshot.roomId,
      {
        topologyEpoch: topology.topologyEpoch,
        rootForwarder: topology.rootForwarder,
        standbyForwarder: topology.standbyForwarder,
        clusters: topology.clusters,
        lastSeen: timestamp,
        fromAddress: this.userInfo.address,
      },
      signature,
      this.userInfo.publicKey ?? '',
      timestamp
    );
    traceGcallAudioSurface('pipeline: topology broadcast sent', {
      roomId: this.snapshot.roomId,
      reason,
      topologyEpoch: topology.topologyEpoch,
      rootForwarder: topology.rootForwarder,
    });
    this.recordDiagEvent('topology-broadcast-sent', {
      roomId: this.snapshot.roomId,
      reason,
      topologyEpoch: topology.topologyEpoch,
      rootForwarder: topology.rootForwarder,
    });
  }

  private async syncTopologyHeartbeat(): Promise<void> {
    const myAddress = this.userInfo?.address ?? '';
    const topology = this.topology;
    if (!myAddress || !topology || topology.rootForwarder !== myAddress) {
      this.stopTopologyHeartbeat();
      return;
    }
    if (this.topologyHeartbeatTimer) {
      return;
    }
    await this.broadcastTopology(topology, 'initial-heartbeat');
    this.topologyHeartbeatTimer = setInterval(() => {
      const current = this.topology;
      if (!current || current.rootForwarder !== (this.userInfo?.address ?? '')) {
        this.stopTopologyHeartbeat();
        return;
      }
      void this.broadcastTopology(current, 'heartbeat');
    }, TOPOLOGY_HEARTBEAT_MS);
  }

  private async ensureRoomKeyAuthorityForTopology(
    previousRoot: string,
    nextTopology: GroupCallTopology
  ): Promise<void> {
    const myAddress = this.userInfo?.address ?? '';
    const root = nextTopology.rootForwarder?.trim() ?? '';
    if (!myAddress || !root || !this.callSessionId) return;
    if (root === myAddress) {
      const previousRoomKey = this.roomKey;
      const hadOwnRoomKey = this.ownsRoomKey && previousRoomKey !== null;
      const nextRoomKey = hadOwnRoomKey ? previousRoomKey : naclApi.randomBytes(32);
      this.roomKey = nextRoomKey;
      this.ownsRoomKey = true;
      this.selfMintedRoomKey = true;
      this.awaitingAuthoritativeKey = false;
      this.clearKeyRecoveryRetryTimer();
      if (!hadOwnRoomKey) {
        this.callEpochMs = Date.now();
        this.seq = 0;
        await this.syncDecryptPoolRoomKey(nextRoomKey);
      }
      await this.distributeRoomKey(nextRoomKey);
      await this.syncSenderState();
      traceGcallAudioSurface('pipeline: root authority ensured room key', {
        roomId: this.snapshot.roomId,
        topologyEpoch: nextTopology.topologyEpoch,
        rotated: !hadOwnRoomKey || previousRoot !== myAddress,
      });
      this.recordDiagEvent('root-authority-ensured-room-key', {
        roomId: this.snapshot.roomId,
        topologyEpoch: nextTopology.topologyEpoch,
        rotated: !hadOwnRoomKey || previousRoot !== myAddress,
      });
      return;
    }
    if (previousRoot === myAddress) {
      this.ownsRoomKey = false;
    }
    if (previousRoot === myAddress && this.selfMintedRoomKey) {
      this.awaitingAuthoritativeKey = true;
      this.requestRetainedKeyReplay('topology-root-changed');
      await this.requestRoomKeyFrom(root, 'topology');
      this.scheduleAuthoritativeKeyRecovery('topology-root-changed');
      return;
    }
    if (!this.roomKey || previousRoot === myAddress) {
      this.awaitingAuthoritativeKey = true;
      await this.requestRoomKeyFrom(root, 'topology');
      this.requestRetainedKeyReplay('topology');
      this.scheduleAuthoritativeKeyRecovery('topology');
    }
  }

  private async applyTopology(
    topology: GroupCallTopology,
    source: 'remote-event' | 'local-election'
  ): Promise<boolean> {
    const normalized = normalizeGroupCallTopology({
      ...topology,
      roomId: topology.roomId ?? this.snapshot.roomId,
      lastSeen:
        typeof topology.lastSeen === 'number' && Number.isFinite(topology.lastSeen)
          ? topology.lastSeen
          : Date.now(),
    });
    const current = this.topology;
    if (current && normalized.topologyEpoch < current.topologyEpoch) {
      traceGcallAudioSurface('pipeline: topology dropped as stale', {
        roomId: normalized.roomId,
        source,
        incomingEpoch: normalized.topologyEpoch,
        currentEpoch: current.topologyEpoch,
      });
      return false;
    }
    if (
      current &&
      normalized.topologyEpoch === current.topologyEpoch &&
      normalized.rootForwarder !== current.rootForwarder
    ) {
      const winner = chooseSameEpochTopologyWinner(
        current,
        normalized,
        this.snapshot.roomId,
        this.electionDigestCache
      );
      if (!winner.acceptIncoming) {
        traceGcallAudioSurface('pipeline: topology rejected by same-epoch authority', {
          roomId: normalized.roomId,
          source,
          epoch: normalized.topologyEpoch,
          incomingRoot: normalized.rootForwarder,
          currentRoot: current.rootForwarder,
          reason: winner.reason,
        });
        return false;
      }
    }
    this.lastObservedTopologyEpoch = Math.max(
      this.lastObservedTopologyEpoch,
      normalized.topologyEpoch >>> 0
    );
    if (this.isSameTopologyStructure(current, normalized)) {
      this.topology = {
        ...normalized,
        roomId: this.snapshot.roomId,
      };
      await this.maybeReplayRetainedKeysAfterTopology(this.topology);
      await this.syncTopologyHeartbeat();
      return false;
    }

    const previousRoot = current?.rootForwarder?.trim() ?? '';
    this.topology = {
      ...normalized,
      roomId: this.snapshot.roomId,
    };
    const myAddress = this.userInfo?.address ?? '';
    this.snapshot = {
      ...this.snapshot,
      myRole: computeGroupCallRole(myAddress, this.topology),
    };
    this.emitSnapshot();
    traceGcallAudioSurface('pipeline: topology applied', {
      roomId: this.topology.roomId,
      source,
      topologyEpoch: this.topology.topologyEpoch,
      rootForwarder: this.topology.rootForwarder,
      standbyForwarder: this.topology.standbyForwarder,
      participantCount: this.snapshot.participants.length,
    });
    this.recordDiagEvent('topology-applied', {
      roomId: this.topology.roomId,
      source,
      topologyEpoch: this.topology.topologyEpoch,
      rootForwarder: this.topology.rootForwarder,
      standbyForwarder: this.topology.standbyForwarder,
      participantCount: this.snapshot.participants.length,
    });
    await this.maybeReplayRetainedKeysAfterTopology(this.topology);
    await this.syncTopologyHeartbeat();
    await this.ensureRoomKeyAuthorityForTopology(previousRoot, this.topology);
    await this.syncSenderState();
    return true;
  }

  private async syncQortalGroupReticulumTargets(
    roomId: string,
    options?: AudioEngineJoinOptions
  ): Promise<void> {
    if (
      !roomId.startsWith('gcall-qortal-') ||
      typeof window.groupCall?.setQortalGroupReticulumTargets !== 'function'
    ) {
      return;
    }
    const groupId = options?.memberGateGroupId;
    if (groupId == null || !Number.isFinite(groupId)) return;
    try {
      const data = await getGroupMembers(Math.floor(Number(groupId)));
      const names: Record<string, string> = {};
      const addresses = Array.isArray(data?.members)
        ? data.members
            .map((member) => {
              const address =
                typeof member?.member === 'string' ? member.member.trim() : '';
              const primaryName =
                typeof member?.primaryName === 'string'
                  ? member.primaryName.trim()
                  : '';
              if (address && primaryName) {
                names[address] = primaryName;
              }
              return address;
            })
            .filter((address) => address.length > 0)
        : [];
      if (!this.areStringMapsEqual(this.snapshot.memberPrimaryNames, names)) {
        this.snapshot = {
          ...this.snapshot,
          memberPrimaryNames: names,
        };
        this.emitSnapshot();
      }
      await window.groupCall.setQortalGroupReticulumTargets(roomId, addresses);
      traceGcallAudioSurface('pipeline: synced qortal reticulum targets', {
        roomId,
        groupId,
        targetCount: addresses.length,
      });
    } catch (error) {
      traceGcallAudioSurface('pipeline: failed to sync qortal reticulum targets', {
        roomId,
        groupId,
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  private startMemberGateRefresh(roomId: string): void {
    this.clearMemberGateRefreshTimer();
    if (this.memberGateGroupId === null) return;
    this.memberGateRefreshTimer = setInterval(() => {
      if (this.snapshot.roomId !== roomId) return;
      void this.syncQortalGroupReticulumTargets(roomId, {
        memberGateGroupId: this.memberGateGroupId!,
        memberGateGroupName: this.snapshot.memberGateGroupName,
      });
    }, MEMBER_GATE_REFRESH_INTERVAL_MS);
  }

  private clearMemberGateRefreshTimer(): void {
    if (this.memberGateRefreshTimer) {
      clearInterval(this.memberGateRefreshTimer);
      this.memberGateRefreshTimer = null;
    }
  }

  private noteDecodedPacketActivity(
    packets: Array<{
      sourceAddr: string;
      seq: number;
      vad: boolean;
      timestampMs: number;
    }>
  ): void {
    let sawVad = false;
    const now = Date.now();
    for (const packet of packets) {
      if (!packet.vad || !packet.sourceAddr) continue;
      this.activeSpeakerLastSeenAt.set(packet.sourceAddr, now);
      sawVad = true;
    }
    if (!sawVad) return;
    this.refreshActiveSpeakerState(now);
    this.scheduleActiveSpeakerRefresh(now);
  }

  private refreshActiveSpeakerState(now = Date.now()): void {
    const nextSpeakers = collectActiveSpeakers(
      this.activeSpeakerLastSeenAt,
      now,
      ACTIVE_SPEAKER_WINDOW_MS,
      MAX_ACTIVE_SPEAKERS_GLOBAL
    );
    const nextParticipants = reconcileParticipantSpeaking(
      this.snapshot.participants,
      nextSpeakers
    );
    if (
      sameAddressList(this.snapshot.activeSpeakers, nextSpeakers) &&
      nextParticipants === this.snapshot.participants
    ) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      activeSpeakers: nextSpeakers,
      participants: nextParticipants,
    };
    this.emitSnapshot();
  }

  private scheduleActiveSpeakerRefresh(now = Date.now()): void {
    this.clearActiveSpeakerRefreshTimer();
    let nextDelay = ACTIVE_SPEAKER_WINDOW_MS + 50;
    for (const lastSeenAt of this.activeSpeakerLastSeenAt.values()) {
      const remaining = ACTIVE_SPEAKER_WINDOW_MS - (now - lastSeenAt);
      if (remaining > 0) {
        nextDelay = Math.min(nextDelay, remaining + 50);
      }
    }
    this.activeSpeakerRefreshTimer = setTimeout(() => {
      this.activeSpeakerRefreshTimer = null;
      this.refreshActiveSpeakerState();
      if (this.snapshot.activeSpeakers.length > 0) {
        this.scheduleActiveSpeakerRefresh();
      }
    }, Math.max(50, nextDelay));
  }

  private clearActiveSpeakerRefreshTimer(): void {
    if (this.activeSpeakerRefreshTimer) {
      clearTimeout(this.activeSpeakerRefreshTimer);
      this.activeSpeakerRefreshTimer = null;
    }
  }

  private areStringMapsEqual(
    left: Record<string, string>,
    right: Record<string, string>
  ): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (left[key] !== right[key]) return false;
    }
    return true;
  }

  private async getAuthoritativeRecipients(): Promise<Map<string, { publicKey: string }>> {
    const recipients = new Map<string, { publicKey: string }>();
    for (const participant of this.snapshot.participants) {
      if (participant.address) {
        recipients.set(participant.address, {
          publicKey: participant.publicKey ?? '',
        });
      }
    }
    const mainRoster = await window.groupCall?.getRoomParticipants?.(this.snapshot.roomId);
    for (const participant of mainRoster ?? []) {
      if (participant?.address) {
        recipients.set(participant.address, {
          publicKey: participant.publicKey ?? '',
        });
      }
    }
    return recipients;
  }

  private async distributeRoomKey(roomKey: Uint8Array): Promise<void> {
    if (!this.userInfo?.address || !this.snapshot.roomId || !this.callSessionId) return;
    const recipients = await this.getAuthoritativeRecipients();
    const { encryptedKeys } = encryptRoomKeyForRecipients(
      roomKey,
      recipients,
      this.userInfo.address
    );
    const recipientAddrs = Object.keys(encryptedKeys);
    if (recipientAddrs.length === 0) return;
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      this.callSessionId,
      this.mediaSessionGeneration >>> 0
    );
    const encryptedKeysDigest = await buildGcKeyRotateDigest(encryptedKeys);
    const timestamp = Date.now();
    const signature = await signGroupCallFields({
      type: 'GC_KEY_ROTATE',
      roomId: this.snapshot.roomId,
      fromAddress: this.userInfo.address,
      fromPublicKey: this.userInfo.publicKey ?? '',
      keyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
      callSessionId: this.callSessionId,
      mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
      keyCommitment,
      encryptedKeysDigest,
      timestamp,
    }).catch(() => '');
    if (!signature) return;
    await window.groupCall?.sendKeyRotate(
      this.snapshot.roomId,
      encryptedKeys,
      this.userInfo.address,
      signature,
      this.userInfo.publicKey ?? '',
      timestamp,
      {
        keyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
        callSessionId: this.callSessionId,
        mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
        keyCommitment,
        encryptedKeysDigest,
      }
    );
  }

  private async requestRoomKeyFrom(
    toAddress: string,
    reason: 'session-updated' | 'topology'
  ): Promise<void> {
    if (
      !this.userInfo?.address ||
      !this.userInfo.publicKey ||
      !this.snapshot.roomId ||
      !this.callSessionId ||
      !toAddress ||
      toAddress === this.userInfo.address
    ) {
      return;
    }
    if (this.awaitingAuthoritativeKey || !this.ownsRoomKey) {
      await this.syncCallSessionFromMainForKeyRecovery();
    }
    const timestamp = Date.now();
    const signature = await signGroupCallFields({
      type: 'GC_KEY_REQUEST',
      roomId: this.snapshot.roomId,
      toAddress,
      fromAddress: this.userInfo.address,
      fromPublicKey: this.userInfo.publicKey,
      callSessionId: this.callSessionId,
      mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
      keyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
      timestamp,
    }).catch(() => '');
    if (!signature) return;
    traceGcallAudioSurface('pipeline: requesting room key', {
      roomId: this.snapshot.roomId,
      toAddress,
      reason,
      mediaSessionGeneration: this.mediaSessionGeneration,
    });
    this.recordDiagEvent('room-key-requested', {
      roomId: this.snapshot.roomId,
      toAddress,
      reason,
      mediaSessionGeneration: this.mediaSessionGeneration,
    });
    await window.groupCall?.sendKeyRequest(
      this.snapshot.roomId,
      toAddress,
      this.userInfo.address,
      signature,
      this.userInfo.publicKey,
      timestamp,
      this.callSessionId,
      this.mediaSessionGeneration >>> 0
    );
  }

  private async sendTargetedRoomKey(
    roomKey: Uint8Array,
    toAddress: string,
    publicKey: string,
    reason: string
  ): Promise<void> {
    if (!this.userInfo?.address || !this.snapshot.roomId || !this.callSessionId) return;
    const recipients = new Map<string, { publicKey: string }>([
      [toAddress, { publicKey }],
    ]);
    const { encryptedKeys } = encryptRoomKeyForRecipients(
      roomKey,
      recipients,
      this.userInfo.address
    );
    const encryptedKey = encryptedKeys[toAddress];
    if (!encryptedKey) return;
    const keyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      this.callSessionId,
      this.mediaSessionGeneration >>> 0
    );
    const encryptedKeyDigest = await buildGcKeyDigest(toAddress, encryptedKey);
    const timestamp = Date.now();
    const signature = await signGroupCallFields({
      type: 'GC_KEY',
      roomId: this.snapshot.roomId,
      toAddress,
      fromAddress: this.userInfo.address,
      fromPublicKey: this.userInfo.publicKey ?? '',
      keyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
      callSessionId: this.callSessionId,
      mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
      keyCommitment,
      encryptedKeyDigest,
      timestamp,
    }).catch(() => '');
    if (!signature) return;
    traceGcallAudioSurface('pipeline: sending targeted room key', {
      roomId: this.snapshot.roomId,
      toAddress,
      reason,
    });
    this.recordDiagEvent('targeted-room-key-sent', {
      roomId: this.snapshot.roomId,
      toAddress,
      reason,
    });
    await window.groupCall?.sendKey(
      this.snapshot.roomId,
      toAddress,
      encryptedKey,
      this.userInfo.address,
      signature,
      this.userInfo.publicKey ?? '',
      timestamp,
      {
        keyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
        callSessionId: this.callSessionId,
        mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
        keyCommitment,
        encryptedKeyDigest,
      }
    );
  }

  private async handleIncomingKeyRequest(payload: {
    roomId: string;
    toAddress: string;
    fromAddress: string;
    fromPublicKey: string;
    verified?: boolean;
    callSessionId?: string;
    mediaSessionGeneration?: number;
  }): Promise<void> {
    if (
      payload.roomId !== this.snapshot.roomId ||
      payload.toAddress !== this.userInfo?.address ||
      payload.verified !== true ||
      !this.roomKey ||
      !this.ownsRoomKey
    ) {
      return;
    }
    const root = this.topology?.rootForwarder?.trim() ?? '';
    if (!root || root !== this.userInfo?.address) return;
    // Requesters may still hold their local pre-root-handoff callSessionId.
    // Only generation proves true staleness; a mismatched UUID is exactly what
    // authoritative key recovery is meant to repair.
    if (
      typeof payload.mediaSessionGeneration === 'number' &&
      (payload.mediaSessionGeneration >>> 0) !== (this.mediaSessionGeneration >>> 0)
    ) {
      return;
    }
    await this.sendTargetedRoomKey(
      this.roomKey,
      payload.fromAddress,
      payload.fromPublicKey,
      'key-request'
    );
  }

  private async syncSenderState(): Promise<void> {
    try {
      if (
        this.snapshot.roomState !== 'connected' ||
        !this.roomKey ||
        !this.topology ||
        !this.userInfo?.address
      ) {
        await this.senderEngine.stop();
        return;
      }
      await this.senderEngine.startOrUpdate({
        inputDeviceId: this.inputDeviceId,
        outputDeviceId: this.outputDeviceId,
        muted: this.snapshot.muted,
        profile: this.snapshot.audioQualityProfile,
        onEncodedFrame: ({ opusFrame, encodeOutPerfMs }) => {
          void this.dispatchEncodedFrame(opusFrame, encodeOutPerfMs);
        },
      });
    } catch (error) {
      this.emit({
        type: 'engine-error',
        message:
          error instanceof Error ? error.message : 'audio-sender-sync-failed',
      });
    }
  }

  private ensureDecryptPool(): DecryptWorkerPool | null {
    if (this.decryptPool) return this.decryptPool;
    if (typeof Worker === 'undefined') {
      traceGcallAudioSurface('pipeline: Worker API missing; decrypt pool disabled', {});
      return null;
    }
    const hardware = Math.max(
      1,
      Math.min(
        4,
        Math.floor((navigator.hardwareConcurrency || 2) - 1) || 1
      )
    );
    this.decryptPool = new DecryptWorkerPool({
      initialSize: Math.max(1, Math.min(2, hardware)),
      maxSize: hardware,
      workerFactory: () => new AudioDecryptWorker(),
      handlers: {
        onDecryptResult: (entry: DecryptPoolDecryptBatchHandlerInput) => {
          void this.handleDecryptPoolEntry(entry);
        },
        onEncryptResult: () => {},
        onAllRoomKeyApplied: (keyVersion) => {
          this.decryptPoolAppliedKeyVersion = keyVersion >>> 0;
        },
        onAllRoomKeyCleared: (keyVersion) => {
          this.decryptPoolAppliedKeyVersion = keyVersion >>> 0;
        },
      },
    });
    return this.decryptPool;
  }

  private async syncDecryptPoolRoomKey(roomKey: Uint8Array | null): Promise<void> {
    const pool = this.ensureDecryptPool();
    if (!pool) return;
    const nextVersion = (this.decryptPoolKeyVersion + 1) >>> 0;
    this.decryptPoolKeyVersion = nextVersion;
    pool.clearLastPlayedSeq();
    if (roomKey) {
      await pool.setRoomKey(roomKey, nextVersion);
    } else {
      await pool.clearRoomKey(nextVersion);
    }
    this.decryptPoolAppliedKeyVersion = nextVersion;
  }

  private async handleDecryptPoolEntry(
    entry: DecryptPoolDecryptBatchHandlerInput
  ): Promise<void> {
    if (entry.status === 'decode-failed') {
      this.receiveEngine.recordDecodeFailure();
      traceGcallAudioSurface('pipeline: decrypt worker reported decode-failed', {
        id: entry.id,
      });
      return;
    }
    if (entry.status !== 'ok') {
      traceGcallAudioSurface('pipeline: decrypt worker non-ok status', {
        status: entry.status,
      });
      return;
    }
    const decodedPackets = entry.decoded
      ? [entry.decoded]
      : entry.decodedMulti ?? [];
    await this.receiveEngine.handleDecodedPackets(decodedPackets);
  }

  private async dispatchEncodedFrame(
    opusFrame: Uint8Array,
    _encodeOutPerfMs?: number
  ): Promise<void> {
    if (
      !this.roomKey ||
      !this.topology ||
      !this.userInfo?.address ||
      !this.snapshot.roomId ||
      this.snapshot.muted
    ) {
      return;
    }
    const seq = this.seq++ & 0xffff;
    const packet = encodeAudioPacketV2(
      this.userInfo.address,
      this.senderEngine.getVad(),
      seq,
      Math.max(0, Date.now() - this.callEpochMs),
      opusFrame,
      this.roomKey
    );
    const targets = getReticulumTransportTargets(
      this.userInfo.address,
      this.topology
    );
    if (targets.length === 0) return;
    if (
      targets.length > 1 &&
      typeof window.groupCall?.sendAudioBatch === 'function'
    ) {
      await window.groupCall.sendAudioBatch(
        this.snapshot.roomId,
        targets,
        packet
      );
      return;
    }
    await Promise.all(
      targets.map((address) =>
        window.groupCall?.sendAudio(this.snapshot.roomId, address, packet)
      )
    );
  }
}

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
  AudioEngineParticipant,
  AudioEngineRole,
} from './audioEngineTypes';
import {
  buildGcallDiagnosticsExportJson,
  copyGcallDiagnosticsToClipboard,
  downloadGcallDiagnosticsJson,
  truncateGcallDiagAddress,
  type GcallDiagExportContext,
} from './gcall-diagnostics';
import type { GcallAudioGapAttributionRecord } from '../call/dmVoiceGcallInboundPlayout';
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
import {
  GroupCallAudioSenderEngine,
  type GroupCallAudioSenderFrame,
} from './groupCallAudioSenderEngine';
import type { GroupCallAudioQualityProfile } from './groupCallAudioProfile';
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
  DEFAULT_GROUP_CALL_CLUSTER_SIZE,
  getReticulumTransportTargets,
  normalizeGroupCallTopology,
  type GroupCallTopology,
} from './groupCallTopology';
import { chooseSameEpochTopologyWinner } from './groupCallTopologyAuthority';
import {
  buildHierarchicalTopologyWithStickyRoot,
  buildSingleClusterTopologyWithStickyRoot,
  collectActiveSpeakers,
  reconcileParticipantSpeaking,
  sameAddressList,
  type GroupCallMetricsSnapshot,
} from './router';
import {
  hasOccupiedRoomEvidenceForJoin,
  shouldPromoteStandbyRootAfterHeartbeatTimeout,
  shouldDeferLocalTopologyElection,
  shouldDelayPostJoinRosterElection,
} from './groupCallJoinLifecycleDecisions';
import {
  getConflictingRootForAuthorityWait,
  getTrustedRootForRejoinElection,
} from './groupCallSessionKeyPolicy';
import { buildStandbyRootFailoverTopology } from './groupCallTopologyLifecycle';
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
  timestampMs: number;
  tag: string;
  payload?: Record<string, unknown>;
};

type HeldIncomingAudioPayload = {
  payload: GroupCallAudioReceivePayload;
  heldAtMs: number;
};

type RuntimeRendererThreadSample = {
  atMs: number;
  startTime: number;
  durationMs: number;
  name: string;
};

type AudioStageTimingTimestamps = NonNullable<
  GroupCallAudioReceivePayload['audioStageTimestamps']
>;

type AudioStageName =
  | 'bridgeReceived'
  | 'managerEmit'
  | 'mainFanout'
  | 'audioSurfaceHandler'
  | 'decryptSubmit'
  | 'decryptResult'
  | 'jitterPush'
  | 'syncDecodeStart'
  | 'syncDecodeEnd';

type AudioStageDeltaName =
  | 'bridgeToManager'
  | 'managerToMainFanout'
  | 'mainFanoutToSurface'
  | 'bridgeToSurface'
  | 'managerToSurface'
  | 'surfaceToDecryptSubmit'
  | 'decryptSubmitToResult'
  | 'decryptResultToJitterPush'
  | 'surfaceToJitterPush'
  | 'surfaceToSyncDecodeStart'
  | 'syncDecodeDuration';

type AudioStageAggregate = {
  samples: number;
  sumMs: number;
  maxMs: number;
  over80: number;
  over160: number;
  over320: number;
  over640: number;
};

type AudioStageRecentWorst = {
  atMs: number;
  kind: 'gap' | 'delta';
  name: string;
  source: string | null;
  valueMs: number;
};

const AUDIO_STAGE_TIMING_WARN_MS = 80;
const AUDIO_STAGE_RECENT_WORST_LIMIT = 32;

type RuntimeRecentWindowTrend = {
  atMs: number;
  reason: string[] | null;
  cpuDegradedActive?: boolean;
  cpuDegradedReason?: string | null;
  role: AudioEngineRole;
  topologyEpoch: number;
  adaptiveNetworkMode: GroupCallMetricsSnapshot['adaptiveNetworkMode'];
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  playoutRateFractionBelow097: number;
  missingFrames: number;
  missingFramesDelta: number;
  concealmentTicks: number;
  concealmentTicksDelta: number;
  packetsDroppedPendingDecrypt: number;
  packetsDroppedPendingDecryptDelta: number;
  packetsDroppedDecodeFailure: number;
  packetsDroppedDecodeFailureDelta: number;
  reticulumAudioPacketPathTimeouts: number;
  reticulumAudioPacketPathTimeoutsDelta: number;
  reticulumAudioOutboundLinkSamples: number;
  reticulumAudioOutboundPacketSamples: number;
  reticulumAudioInboundLinkSamples: number;
  reticulumAudioInboundPacketSamples: number;
  outboundEncodedFrames: number;
  outboundSendAttempts: number;
  outboundSendSuccesses: number;
  outboundSendFailures: number;
  outboundSendFailuresDelta: number;
  outboundNoTargetSkips: number;
  outboundNoTargetSkipsDelta: number;
  rendererStallCount: number;
  rendererStallMaxDelayMs: number;
  rendererLongTaskCount: number;
  rendererLongTaskMaxMs: number;
  receiveProfiles: Array<{
    peerAddress: string;
    profile: string;
  }>;
  receivePlayouts: Array<{
    peerAddress: string;
    jitterBufferedFrames: number;
    jitterHasReadyFrame: boolean;
    jitterMaxEntries?: number;
    jitterPushAccepted?: number;
    jitterPushStale?: number;
    jitterPushDuplicate?: number;
    jitterPushTrimmedFrames?: number;
    jitterPushTrimEvents?: number;
    jitterPushDepthHighWater?: number;
    jitterLastTrimmedFrames?: number;
    jitterLastTrimAtMs?: number;
    jitterBurstHeadroomLevel?: number;
    jitterBurstHeadroomReason?: string | null;
    postBurstLatencyLockoutActive?: boolean;
    postBurstLatencyLockoutUntilMs?: number;
    postBurstLatencyShedFrames?: number;
    lastPostBurstLatencyShedAtMs?: number;
    lastPostBurstLatencyShedFrames?: number;
    liveLatencyGovernorShedFrames?: number;
    liveLatencyGovernorResetCount?: number;
    lastLiveLatencyGovernorAtMs?: number;
    lastLiveLatencyGovernorReason?: string | null;
    burstGapResetCount?: number;
    burstGapRecoveryCount?: number;
    burstGapDroppedFrames?: number;
    lastBurstGapMs?: number;
    lastBurstGapFrames?: number;
    lastBurstGapDroppedFrames?: number;
    lastBurstGapResetAtMs?: number;
    starvedBacklogDrainCount?: number;
    starvedBacklogDrainFrames?: number;
    lastStarvedBacklogDrainAtMs?: number;
    lastStarvedBacklogDrainFrames?: number;
    jitterDrainReadyTicks?: number;
    jitterDrainReadyNoPopTicks?: number;
    jitterDrainPoppedFrames?: number;
    lastJitterDrainBudget?: number;
    lastJitterDrainPoppedFrames?: number;
    pcmPostAcceptedFrames?: number;
    pcmPostRejectedFrames?: number;
    pcmPostOverrunCount?: number;
    lastPcmPostRejectedAtMs?: number;
    audioGapAttributionCount?: number;
    audioGapAttributionMaxFrames?: number;
    audioGapAttributionLast?: GcallAudioGapAttributionRecord | null;
    audioGapAttributionRecent?: GcallAudioGapAttributionRecord[];
    wasmFecPipelineDiagnostics?: {
      queuedDecodeJobs: number;
      queuedDecodeJobsHighWater: number;
      inflightDecode: boolean;
      inflightDecodeAgeMs: number;
      deferredPcmSlabs: number;
      deferredPcmFrames: number;
      deferredPcmFramesHighWater: number;
      enqueuedDecodeJobs: number;
      completedDecodeJobs: number;
      postedPcmFrames: number;
      rejectedPcmFrames: number;
      deferredPcmTicks: number;
      lastRejectedPcmAtMs: number;
      lastDeferredPcmAtMs: number;
    } | null;
    lastJitterAdaptiveMode: 'low-latency' | 'recovery' | null;
  }>;
};

type OutboundMediaTargetDiagnostics = {
  target: string;
  attempts: number;
  successes: number;
  failures: number;
  firstAttemptAtMs: number;
  lastAttemptAtMs: number;
  lastSuccessAtMs: number;
  lastFailureAtMs: number;
  lastFailureMessage: string | null;
  lastMainDiagnostics: GcallSendAudioDiagnostics | null;
};

type GcallSendAudioDiagnostics = {
  transport?: 'link' | 'packet';
  pendingFrames?: number;
  pendingOldestAgeMs?: number;
  queuePressureDrops?: number;
  staleDrops?: number;
  linkUnreadyDrops?: number;
  packetSendFailures?: number;
  targetAddress?: string;
  peerPresenceHash?: string;
  routeKey?: string;
  linkId?: string;
  linkEstablished?: boolean;
  linkOpenedByOwner?: boolean | null;
  lastLinkCloseReason?: string;
  lastLinkCloseAtMs?: number;
  lastLinkCloseLinkId?: string;
  lastLinkUnreadyReason?: string;
  lastLinkUnreadyAtMs?: number;
  lastLinkUnreadyLinkId?: string;
  lastInboundAtMs?: number;
  recoveryReason?: string;
  recoveryHoldUntilMs?: number;
  linkFallbackActive?: boolean;
  linkFallbackReason?: string;
  linkFallbackDwellMs?: number;
  linkFallbackProbeCount?: number;
  linkFallbackExitCount?: number;
  linkFallbackLastDwellMs?: number;
  pathDiversityActive?: boolean;
  pathDiversityReason?: string;
  pathDiversityMirrorAttempts?: number;
  pathDiversityMirrorSuccesses?: number;
  pathDiversityMirrorFailures?: number;
  rendererToMainIpcMsMax?: number;
  mainIpcToManagerEnqueueMsMax?: number;
  managerPendingDwellMsMax?: number;
  managerFlushToBridgeEnqueueMsMax?: number;
  bridge?: {
    bridgeQueuedFrames?: number;
    bridgeQueuedOldestAgeMs?: number;
    bridgeWaitingForDrain?: boolean;
    decodedQueueDepth?: number;
    decodedQueueOldestAgeMs?: number;
    binaryOutQueueDepth?: number;
    binaryOutQueueOldestAgeMs?: number;
    queuePressureDropsLast5s?: number;
    staleDropsLast5s?: number;
    queuePressureDrops?: number;
    staleDrops?: number;
    packetSendFailures?: number;
    packetPathRequests?: number;
    packetPathResolutions?: number;
    packetPathTimeouts?: number;
    packetFreshSends?: number;
    packetStaleSends?: number;
    packetUnknownSends?: number;
    deadlineDropCount?: number;
    decodedQueueEvictOldestCount?: number;
    decodedQueueDropNewestCount?: number;
    fd3DecodedAgeMsMax?: number;
    decodedQueueDwellMsMax?: number;
    rnsSendDurationMsMax?: number;
    packetPathCheckMsMax?: number;
    executorLoopGapMsMax?: number;
    executorGapWhileQueuedMsMax?: number;
    executorAudioPassMsMax?: number;
    processBatchMsMax?: number;
    processBatchFramesMax?: number;
    rnsSendSlowCount?: number;
    executorStallCount?: number;
    executorCommandMsMax?: number;
    executorCommandWhileQueuedMsMax?: number;
    executorCommandSlowCount?: number;
    rnsCallbackSchedulerGapMsMax?: number;
    rnsCallbackSchedulerGapOver100Count?: number;
    rnsCallbackSchedulerGapOver250Count?: number;
    rnsCallbackSchedulerGapOver500Count?: number;
    rnsCallbackSchedulerGapOver1000Count?: number;
    rnsRawInboundGapMsMax?: number;
    rnsRawInboundGapOver80Count?: number;
    rnsRawInboundGapOver160Count?: number;
    rnsRawInboundGapOver320Count?: number;
    rnsRawInboundGapOver640Count?: number;
    rnsRawInboundGapOver1000Count?: number;
    rnsRawInboundToLinkReceiveMsMax?: number;
    rnsRawInboundToLinkReceiveOver80Count?: number;
    rnsRawInboundToLinkReceiveOver160Count?: number;
    rnsRawInboundToLinkReceiveOver320Count?: number;
    rnsRawInboundToLinkReceiveOver640Count?: number;
    rnsRawInboundToLinkReceiveOver1000Count?: number;
    rnsRawInboundToLinkReceiveSamples?: number;
    rnsRawInboundInterfaceLast?: string;
    rnsRawInboundInterfaceWorst?: string;
    rnsSharedFrameGapMsMax?: number;
    rnsSharedFrameGapOver80Count?: number;
    rnsSharedFrameGapOver160Count?: number;
    rnsSharedFrameGapOver320Count?: number;
    rnsSharedFrameGapOver640Count?: number;
    rnsSharedFrameGapOver1000Count?: number;
    rnsSharedFrameToTransportInboundMsMax?: number;
    rnsSharedFrameToTransportInboundOver80Count?: number;
    rnsSharedFrameToTransportInboundOver160Count?: number;
    rnsSharedFrameToTransportInboundOver320Count?: number;
    rnsSharedFrameToTransportInboundOver640Count?: number;
    rnsSharedFrameToTransportInboundOver1000Count?: number;
    rnsSharedFrameToTransportInboundSamples?: number;
    rnsSharedFrameInterfaceLast?: string;
    rnsSharedFrameInterfaceWorst?: string;
    schedulerDiagnostics?: Array<Record<string, unknown>>;
    rendererToBridgeEnqueueMsMax?: number;
    managerFlushToBridgeEnqueueMsMax?: number;
    bridgeEnqueueToFd3WriteMsMax?: number;
    bridgeEnqueueToFd3WriteQueueDwellMsMax?: number;
    rendererToFd3WriteMsMax?: number;
    mediaRouteDiagnostics?: Array<{
      transport?: string;
      routeKey?: string;
      linkId?: string;
      peerPresenceHash?: string;
      peerDestinationHash?: string;
      incoming?: boolean;
      sentFrames?: number;
      sentBytes?: number;
      sendFailures?: number;
      receivedFrames?: number;
      receivedBytes?: number;
      fd4EnqueuedFrames?: number;
      fd4EnqueueFailures?: number;
      lastSendAtMs?: number;
      lastSendFailureAtMs?: number;
      lastReceiveAtMs?: number;
      lastFd4EnqueueAtMs?: number;
      lastActivityAtMs?: number;
      lastRoomId?: string;
      sendGapMsMax?: number;
      receiveGapMsMax?: number;
      sendGapOver80Count?: number;
      sendGapOver160Count?: number;
      sendGapOver320Count?: number;
      sendGapOver640Count?: number;
      sendGapOver1000Count?: number;
      receiveGapOver80Count?: number;
      receiveGapOver160Count?: number;
      receiveGapOver320Count?: number;
      receiveGapOver640Count?: number;
      receiveGapOver1000Count?: number;
      linkReceiveGapMsMax?: number;
      linkReceiveGapOver80Count?: number;
      linkReceiveGapOver160Count?: number;
      linkReceiveGapOver320Count?: number;
      linkReceiveGapOver640Count?: number;
      linkReceiveGapOver1000Count?: number;
      linkReceiveToCallbackDispatchMsMax?: number;
      linkCallbackDispatchToStartMsMax?: number;
      linkReceiveToCallbackStartMsMax?: number;
      linkCallbackDispatchToStartOver80Count?: number;
      linkCallbackDispatchToStartOver160Count?: number;
      linkCallbackDispatchToStartOver320Count?: number;
      linkCallbackDispatchToStartOver640Count?: number;
      linkCallbackDispatchToStartOver1000Count?: number;
      rnsRawInboundGapMsMax?: number;
      rnsRawInboundGapOver80Count?: number;
      rnsRawInboundGapOver160Count?: number;
      rnsRawInboundGapOver320Count?: number;
      rnsRawInboundGapOver640Count?: number;
      rnsRawInboundGapOver1000Count?: number;
      rnsRawInboundToLinkReceiveMsMax?: number;
      rnsRawInboundToLinkReceiveOver80Count?: number;
      rnsRawInboundToLinkReceiveOver160Count?: number;
      rnsRawInboundToLinkReceiveOver320Count?: number;
      rnsRawInboundToLinkReceiveOver640Count?: number;
      rnsRawInboundToLinkReceiveOver1000Count?: number;
      rnsRawInboundInterfaceLast?: string;
      rnsRawInboundInterfaceWorst?: string;
      rnsSharedFrameGapMsMax?: number;
      rnsSharedFrameGapOver80Count?: number;
      rnsSharedFrameGapOver160Count?: number;
      rnsSharedFrameGapOver320Count?: number;
      rnsSharedFrameGapOver640Count?: number;
      rnsSharedFrameGapOver1000Count?: number;
      rnsSharedFrameToTransportInboundMsMax?: number;
      rnsSharedFrameToTransportInboundOver80Count?: number;
      rnsSharedFrameToTransportInboundOver160Count?: number;
      rnsSharedFrameToTransportInboundOver320Count?: number;
      rnsSharedFrameToTransportInboundOver640Count?: number;
      rnsSharedFrameToTransportInboundOver1000Count?: number;
      rnsSharedFrameInterfaceLast?: string;
      rnsSharedFrameInterfaceWorst?: string;
      rendererToBridgeEnqueueMsMax?: number;
      managerFlushToBridgeEnqueueMsMax?: number;
      bridgeEnqueueToFd3WriteMsMax?: number;
      bridgeEnqueueToFd3WriteQueueDwellMsMax?: number;
      rendererToFd3WriteMsMax?: number;
      preRnsSendAgeMsMax?: number;
      rnsSendDurationMsMax?: number;
      receiveToFd4EnqueueMsMax?: number;
    }>;
  };
};

type GcallSendAudioResult = {
  success?: boolean;
  error?: string;
  diagnostics?: GcallSendAudioDiagnostics;
};

type OutboundMediaDiagnostics = {
  encodedFrameCallbacks: number;
  packetBuildAttempts: number;
  sendAttempts: number;
  sendSuccesses: number;
  sendFailures: number;
  skippedNoRoomKey: number;
  skippedNoTopology: number;
  skippedNoUser: number;
  skippedNoRoomId: number;
  skippedMuted: number;
  skippedNoTargets: number;
  lastEncodedFrameAtMs: number;
  lastPacketBuildAttemptAtMs: number;
  lastSendAttemptAtMs: number;
  lastSendSuccessAtMs: number;
  lastSendFailureAtMs: number;
  lastSkipAtMs: number;
  lastSkipReason: string | null;
  lastSendFailureMessage: string | null;
  lastMainDiagnostics: GcallSendAudioDiagnostics | null;
  lastTargets: string[];
  targets: OutboundMediaTargetDiagnostics[];
};

const GCALL_KEY_MESSAGE_VERSION = 3;
const TOPOLOGY_HEARTBEAT_MS = 5_000;
const TOPOLOGY_ELECTION_DEBOUNCE_MS = 120;
const STARTUP_MEDIA_TARGET_SETTLE_MS = 15_000;
const STARTUP_EMPTY_TARGET_SETTLE_MS = 60_000;
const ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS = TOPOLOGY_HEARTBEAT_MS * 2 + 1_500;
const ROOT_ONE_TO_ONE_FAILOVER_TIMEOUT_MS =
  ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS * 2;
const ROOT_RECENT_ACTIVITY_FAILOVER_VETO_MS =
  ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS;
const ROOT_RECENT_EVIDENCE_FAILOVER_GRACE_MS =
  ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS + TOPOLOGY_HEARTBEAT_MS;
const POST_FAILOVER_ROOT_RECEIVE_PROTECTION_MS = 12_000;

type RootPeerLivenessState =
  | 'unknown'
  | 'healthy'
  | 'heartbeat-stale-but-media-alive'
  | 'heartbeat-stale-but-control-alive'
  | 'suspect'
  | 'reconnect-required';

type RootPeerLivenessRecord = {
  currentRoot: string;
  lastHeartbeatAt: number;
  lastDecodedMediaAt: number;
  lastVerifiedControlAt: number;
  lastVerifiedKeyAt: number;
  lastSpeakerActivityAt: number;
  lastAnyRootEvidenceAt: number;
};

function buildEmptyRootPeerLivenessRecord(): RootPeerLivenessRecord {
  return {
    currentRoot: '',
    lastHeartbeatAt: 0,
    lastDecodedMediaAt: 0,
    lastVerifiedControlAt: 0,
    lastVerifiedKeyAt: 0,
    lastSpeakerActivityAt: 0,
    lastAnyRootEvidenceAt: 0,
  };
}
const GROUP_CALL_SELF_ONLY_JOIN_ELECTION_WAIT_MS = 1_000;
const OCCUPIED_JOIN_AUTHORITY_WAIT_MS = TOPOLOGY_HEARTBEAT_MS + 250;
const GROUP_CALL_SENDER_SYNC_RETRY_MS = 1_500;
const RECENTLY_LEFT_PARTICIPANT_SUPPRESS_MS = 10 * 60_000;
const PARTICIPANT_ROSTER_REFRESH_INTERVAL_MS = TOPOLOGY_HEARTBEAT_MS;
const PARTICIPANT_ROSTER_MISSING_EVICT_MS = TOPOLOGY_HEARTBEAT_MS * 2 + 500;
const PARTICIPANT_RECENT_ACTIVITY_EVICT_VETO_MS =
  PARTICIPANT_ROSTER_MISSING_EVICT_MS;
const LIVE_EVIDENCE_TOPOLOGY_ELECTION_MIN_MS = 2_000;
const TRUSTED_REMOTE_ROOT_STICKY_REJOIN_MS = 7_500;
const CONFLICTING_REMOTE_ROOT_AUTHORITY_SETTLE_MS =
  TRUSTED_REMOTE_ROOT_STICKY_REJOIN_MS + TOPOLOGY_HEARTBEAT_MS;
const PROVISIONAL_LOCAL_ROOT_RECONCILE_MS =
  CONFLICTING_REMOTE_ROOT_AUTHORITY_SETTLE_MS;
const AUTHORITATIVE_KEY_RECOVERY_RETRY_MS = 1_500;
const AUTHORITATIVE_KEY_RECOVERY_FAILURE_LOG_COOLDOWN_MS = 1_000;
const WORKER_DECODE_FAILURE_RECOVERY_WINDOW_MS = 2_000;
const WORKER_DECODE_FAILURE_RECOVERY_THRESHOLD = 8;
const WORKER_DECODE_FAILURE_RECOVERY_COOLDOWN_MS = 5_000;
const AWAITING_AUTHORITATIVE_KEY_HOLD_MAX_PACKETS = 48;
const AWAITING_AUTHORITATIVE_KEY_HOLD_MAX_AGE_MS = 4_000;
const MAX_AUDIO_SURFACE_DIAG_EVENTS = 120;
const MAX_RECENT_WINDOW_TRENDS = 300;
const GCALL_RENDERER_STALL_SAMPLE_INTERVAL_MS = 250;
const GCALL_RENDERER_STALL_DELAY_THRESHOLD_MS = 80;
const GCALL_RENDERER_THREAD_RECENT_LIMIT = 40;
const GCALL_CPU_DEGRADED_SENDER_TOTAL_MODERATE_MS = 80;
const GCALL_CPU_DEGRADED_SENDER_TOTAL_SEVERE_MS = 250;
const GCALL_CPU_DEGRADED_SENDER_ENCODER_MODERATE_MS = 50;
const GCALL_CPU_DEGRADED_SENDER_ENCODER_SEVERE_MS = 200;
const GCALL_CPU_DEGRADED_LONG_TASK_MODERATE_MS = 75;
const GCALL_CPU_DEGRADED_LONG_TASK_SEVERE_MS = 150;
const GCALL_CPU_DEGRADED_BRIDGE_OLDEST_MODERATE_MS = 80;
const GCALL_CPU_DEGRADED_BRIDGE_OLDEST_SEVERE_MS = 150;
const GCALL_CPU_DEGRADED_BRIDGE_DROPS_MODERATE = 1;
const GCALL_CPU_DEGRADED_BRIDGE_DROPS_SEVERE = 3;
const GCALL_CPU_DEGRADED_MODERATE_ENTER_MS = 3_000;
const GCALL_CPU_DEGRADED_PRESSURE_RESET_MS = 5_000;
const GCALL_CPU_DEGRADED_MODERATE_HOLD_MS = 15_000;
const GCALL_CPU_DEGRADED_SEVERE_HOLD_MS = 30_000;
const GCALL_CPU_DEGRADED_CALM_EXIT_MS = 20_000;
const GCALL_CALL_QUALITY_WORSENED_UNDERTARGET_DELTA_MIN = 0.05;
const GCALL_CALL_QUALITY_WORSENED_MISSING_DELTA_MIN = 300;
const GCALL_CALL_QUALITY_WORSENED_CONCEALMENT_DELTA_MIN = 80;
const MAX_ACTIVE_SPEAKERS_GLOBAL = 3;
const ACTIVE_SPEAKER_WINDOW_MS = 2_000;
const GCALL_CONNECTION_HINT_BAD_MS = 2_800;
const GCALL_CONNECTION_HINT_SEVERE_MS = 1_200;
const GCALL_CONNECTION_HINT_GOOD_MS = 4_500;
const MEMBER_GATE_REFRESH_INTERVAL_MS = 90_000;
const ZERO_INBOUND_MEDIA_RECOVERY_MIN_OUTBOUND_FRAMES = 100;
const ZERO_INBOUND_MEDIA_RECOVERY_COOLDOWN_MS = 3_000;
const LOW_INBOUND_MEDIA_RECOVERY_MIN_OUTBOUND_FRAMES = 300;
const LOW_INBOUND_MEDIA_RECOVERY_MAX_INBOUND_TO_OUTBOUND_RATIO = 0.35;
const LOW_INBOUND_MEDIA_RECOVERY_UNDERTARGET_MIN = 0.12;
const LOW_INBOUND_MEDIA_RECOVERY_RATE_BELOW_097_MIN = 0.1;
const LOW_INBOUND_MEDIA_RECOVERY_CONCEALMENT_MIN = 100;
const LOW_INBOUND_MEDIA_RECOVERY_STARTUP_GRACE_MS = 12_000;
const TWO_PARTY_LINK_RESYNC_STARTUP_GRACE_MS = 8_000;
const STARTUP_SUPPRESSION_DIAG_COOLDOWN_MS = 5_000;
const BURSTY_INBOUND_MEDIA_RECOVERY_MAX_INCOMING_PACKET_MS = 1_000;
const BURSTY_INBOUND_MEDIA_RECOVERY_MAX_BRIDGE_TO_RENDERER_MS = 750;
const BURSTY_INBOUND_MEDIA_RECOVERY_CONCEALMENT_MIN = 80;
const BURSTY_INBOUND_MEDIA_RECOVERY_MISSING_FRAMES_MIN = 300;
const naclApi = nacl as typeof nacl;
const randomNaclBytes = (nacl as { randomBytes(size: number): Uint8Array })
  .randomBytes;

function randomRoomKey(): Uint8Array {
  return randomNaclBytes(32);
}

function base64ToUint8(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function uint8ToBase64(value: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < value.length; i++)
    binary += String.fromCharCode(value[i]!);
  return btoa(binary);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

async function buildGcKeyDigest(
  toAddress: string,
  encryptedKey: string
): Promise<string> {
  return sha256Hex(JSON.stringify({ encryptedKey, toAddress }));
}

function buildTopologyWithTrustedRoot(
  sorted: string[],
  topologyEpoch: number,
  trustedRoot: string | null | undefined
): GroupCallTopology {
  if (sorted.length <= DEFAULT_GROUP_CALL_CLUSTER_SIZE) {
    return normalizeGroupCallTopology(
      buildSingleClusterTopologyWithStickyRoot(
        sorted,
        topologyEpoch,
        trustedRoot,
        DEFAULT_GROUP_CALL_CLUSTER_SIZE
      ) ?? buildGroupCallTopology(sorted, topologyEpoch)
    );
  }
  return normalizeGroupCallTopology(
    buildHierarchicalTopologyWithStickyRoot(
      sorted,
      topologyEpoch,
      trustedRoot,
      DEFAULT_GROUP_CALL_CLUSTER_SIZE
    ) ?? buildGroupCallTopology(sorted, topologyEpoch)
  );
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

function setRosterPublicKey(
  roster: Map<string, { publicKey: string }>,
  addressValue: string | null | undefined,
  publicKeyValue: string | null | undefined
): void {
  const address = addressValue?.trim() ?? '';
  if (!address) return;
  const publicKey = publicKeyValue?.trim() ?? '';
  const existing = roster.get(address);
  if (!existing || (publicKey && !existing.publicKey)) {
    roster.set(address, { publicKey });
  }
}

const ROOM_KEY_DISTRIBUTION_RETRY_MS = 750;
const TARGETED_ROOM_KEY_REPLAY_RETRY_MS = 2_000;
const TARGETED_ROOM_KEY_REPLAY_MAX_ATTEMPTS = 6;
const TWO_PARTY_LINK_RESYNC_COOLDOWN_MS = 5_000;
const DEMOTED_ROOT_KEY_TRANSFER_GRACE_MS =
  ROOT_RECENT_ACTIVITY_FAILOVER_VETO_MS;
const FRESH_LOCAL_KEY_AUTHORITY_GRACE_MS = 10_000;

export class GroupCallAudioEngineRuntime {
  private bootstrapRevisionApplied = 0;
  private readonly listeners = new Set<EventListener>();
  private readonly senderEngine = new GroupCallAudioSenderEngine();
  private readonly directVoiceSenderEngine = new GroupCallAudioSenderEngine();
  private readonly receiveEngine: GroupCallAudioReceiveEngine;
  private directVoiceReceiveEngine: GroupCallAudioReceiveEngine | null = null;
  private snapshot: GroupCallControllerSnapshot =
    buildDefaultGroupCallControllerSnapshot();
  private userInfo: AudioEngineUserIdentity | null = null;
  private myStatus: AudioSurfaceBootstrap['myStatus'] = 'online';
  private uiActive = false;
  private inputDeviceId: string | null = null;
  private outputDeviceId: string | null = null;
  private directVoiceRoomId = '';
  private directVoicePeerAddress = '';
  private directVoiceLocalAddress = '';
  private directVoiceRoomKey: Uint8Array | null = null;
  private directVoiceSeq = 0;
  private directVoiceMuted = false;
  private directVoiceInputDeviceId: string | null = null;
  private directVoiceOutputDeviceId: string | null = null;
  private directVoiceHearCall = true;
  private directVoiceProfile: GroupCallAudioQualityProfile = 'low-latency';
  private directVoiceOutboundSendAttempts = 0;
  private directVoiceOutboundSendSuccesses = 0;
  private directVoiceOutboundSendFailures = 0;
  private directVoiceOutboundLastFailureMessage: string | null = null;
  private directVoiceOutboundLastSendAtMs = 0;
  private unsubscribeGroupCallEvents: (() => void) | null = null;
  private currentChatId = '';
  private topology: GroupCallTopology | null = null;
  private roomKey: Uint8Array | null = null;
  private appliedRoomKeyCommitment = '';
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
  private localRoomKeyLastEnsuredAtMs = 0;
  private demotedRootKeyTransferUntilMs = 0;
  private keyRecoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private roomKeyDistributionRetryTimer: ReturnType<typeof setTimeout> | null =
    null;
  private readonly targetedRoomKeyReplayTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly targetedRoomKeyReplayAttempts = new Map<string, number>();
  private senderSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private topologyHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private rootFailoverTimer: ReturnType<typeof setTimeout> | null = null;
  private topologyElectionTimer: ReturnType<typeof setTimeout> | null = null;
  private activeSpeakerRefreshTimer: ReturnType<typeof setTimeout> | null =
    null;
  private memberGateRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private participantRosterRefreshTimer: ReturnType<typeof setInterval> | null =
    null;
  private rendererStallSampleTimer: ReturnType<typeof setInterval> | null =
    null;
  private rendererStallExpectedPerfMs = 0;
  private rendererStallMonitorStartedAtMs = 0;
  private rendererStallSampleCount = 0;
  private rendererStallCount = 0;
  private rendererStallMaxDelayMs = 0;
  private readonly rendererStallRecent: RuntimeRendererThreadSample[] = [];
  private rendererLongTaskObserver: PerformanceObserver | null = null;
  private rendererLongTaskSupported = false;
  private rendererLongTaskCount = 0;
  private rendererLongTaskMaxMs = 0;
  private readonly rendererLongTaskRecent: RuntimeRendererThreadSample[] = [];
  private cpuDegradedActive = false;
  private cpuDegradedEnteredAtMs = 0;
  private cpuDegradedHoldUntilMs = 0;
  private cpuDegradedLastPressureAtMs = 0;
  private cpuDegradedPressureStartedAtMs = 0;
  private cpuDegradedEntryCount = 0;
  private cpuDegradedLastReasons: string[] = [];
  private cpuDegradedLastDetail: Record<string, unknown> | null = null;
  private cpuDegradedSenderSyncQueued = false;
  private topologyAsyncGeneration = 0;
  private leaveCleanupGeneration = 0;
  private lastObservedTopologyEpoch = 0;
  private trustedRemoteRoot = '';
  private trustedRemoteRootLastSeenAt = 0;
  private conflictingRemoteRoot = '';
  private conflictingRemoteRootLastSeenAt = 0;
  private authoritySettleUntilMs = 0;
  private topologyElectionDelayUntilMs = 0;
  private startupOccupiedRoomEvidence = false;
  private startupHydratedRemoteCount = 0;
  private startupBootstrapHasTopology = false;
  private lastJoinSuccessAtMs = 0;
  private provisionalLocalRootUntilMs = 0;
  private provisionalLocalRootElectionAtMs = 0;
  private provisionalLocalRootReason = '';
  private provisionalLocalRootRemoteCount = 0;
  private readonly electionDigestCache = new Map<string, string>();
  private readonly activeSpeakerLastSeenAt = new Map<string, number>();
  private readonly participantDecodedMediaLastSeenAt = new Map<
    string,
    number
  >();
  private readonly participantLiveEvidenceLastSeenAt = new Map<
    string,
    number
  >();
  private readonly twoPartyLinkResyncLastAtByPeer = new Map<string, number>();
  private readonly liveEvidenceTopologyElectionLastAt = new Map<
    string,
    number
  >();
  private readonly bootstrapOnlyParticipantAddresses = new Set<string>();
  private bootstrapOnlyMediaTargetSkipLastDiagAt = 0;
  private startupMediaTargetWaitLastDiagAt = 0;
  private readonly recentlyLeftParticipantsUntilMs = new Map<string, number>();
  private readonly participantJoinIdentityByAddress = new Map<string, string>();
  private readonly participantRosterMissingSinceMs = new Map<string, number>();
  private readonly diagEvents: AudioSurfaceDiagEvent[] = [];
  private readonly throttledDiagEvents = new Map<
    string,
    { firstAtMs: number; lastEmitAtMs: number; suppressedSinceEmit: number }
  >();
  private readonly recentWindowTrends: RuntimeRecentWindowTrend[] = [];
  private readonly audioStageGapStats = new Map<
    AudioStageName,
    AudioStageAggregate
  >();
  private readonly audioStageDeltaStats = new Map<
    AudioStageDeltaName,
    AudioStageAggregate
  >();
  private readonly audioStageLastAtBySource = new Map<string, number>();
  private readonly audioStageRecentWorst: AudioStageRecentWorst[] = [];
  private connectionHintBadSince: number | null = null;
  private connectionHintGoodSince: number | null = null;
  private connectionHintSevereSince: number | null = null;
  private memberGateGroupId: number | null = null;
  /** Log once if IPC delivers gcall:audio payload data in a shape that skips the worker pool. */
  private warnedNonArrayBufferAudioData = false;
  /** After a successful join, run one more retained-key replay when topology first arrives. */
  private shouldReplayRetainedKeysAfterNextTopology = false;
  private heldIncomingAudio: HeldIncomingAudioPayload[] = [];
  private lastAwaitingAuthoritativeKeyFailureLogAt = 0;
  private rootPeerLiveness = buildEmptyRootPeerLivenessRecord();
  private workerDecodeFailureWindowStartedAt = 0;
  private workerDecodeFailureCount = 0;
  private workerDecodeFailureRecoveryLastAt = 0;
  private readonly pendingDecryptIngressById = new Map<number, string>();
  private readonly pendingDecryptStageById = new Map<
    number,
    {
      sourceAddr: string;
      timestamps: AudioStageTimingTimestamps;
    }
  >();
  private readonly rootDecodeFailureWindowStartedAtBySource = new Map<
    string,
    number
  >();
  private readonly rootDecodeFailureCountBySource = new Map<string, number>();
  private readonly rootDecodeFailureKeyReplayLastAtBySource = new Map<
    string,
    number
  >();
  private outboundEncodedFrameCallbacks = 0;
  private outboundPacketBuildAttempts = 0;
  private outboundSendAttempts = 0;
  private outboundSendSuccesses = 0;
  private outboundSendFailures = 0;
  private outboundSkippedNoRoomKey = 0;
  private outboundSkippedNoTopology = 0;
  private outboundSkippedNoUser = 0;
  private outboundSkippedNoRoomId = 0;
  private outboundSkippedMuted = 0;
  private outboundSkippedNoTargets = 0;
  private outboundLastEncodedFrameAtMs = 0;
  private outboundLastPacketBuildAttemptAtMs = 0;
  private outboundLastSendAttemptAtMs = 0;
  private outboundLastSendSuccessAtMs = 0;
  private outboundLastSendFailureAtMs = 0;
  private outboundLastSkipAtMs = 0;
  private outboundLastSkipReason: string | null = null;
  private outboundLastSendFailureMessage: string | null = null;
  private outboundLastMainDiagnostics: GcallSendAudioDiagnostics | null = null;
  private outboundLastTargets: string[] = [];
  private mediaRecoveryApiUnavailableLastAtMs = 0;
  private readonly zeroInboundMediaRecoveryLastAtByAddress = new Map<
    string,
    number
  >();
  private readonly outboundTargetDiagnostics = new Map<
    string,
    OutboundMediaTargetDiagnostics
  >();

  constructor() {
    this.receiveEngine = new GroupCallAudioReceiveEngine(
      (metrics) => {
        this.recordRecentWindowTrend(metrics);
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
    this.startRendererThreadMonitor();
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
    this.clearRootFailoverTimer();
    this.clearTopologyElectionTimer();
    this.clearKeyRecoveryRetryTimer();
    this.clearRoomKeyDistributionRetryTimer();
    this.clearTargetedRoomKeyReplayRetries();
    this.clearSenderSyncRetryTimer();
    this.clearActiveSpeakerRefreshTimer();
    this.clearMemberGateRefreshTimer();
    this.clearParticipantRosterRefreshTimer();
    this.stopRendererThreadMonitor();
    void this.senderEngine.stop();
    void this.directVoiceSenderEngine.stop();
    void this.receiveEngine.dispose();
    void this.directVoiceReceiveEngine?.dispose();
    this.directVoiceReceiveEngine = null;
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

  async handleCommand(
    command: AudioSurfaceCommand
  ): Promise<AudioSurfaceResponse> {
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
            postFailoverRootHoldUntilMs: 0,
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
          this.snapshot = {
            ...this.snapshot,
            hearCall: command.hearCall === true,
          };
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
        case 'start-direct-voice-receive':
          return await this.startDirectVoiceReceive(command);
        case 'update-direct-voice-receive':
          if (this.directVoiceReceiveEngine) {
            await this.directVoiceReceiveEngine.configure({
              ...(command.outputDeviceId !== undefined
                ? { outputDeviceId: command.outputDeviceId }
                : {}),
              ...(typeof command.hearCall === 'boolean'
                ? { hearCall: command.hearCall }
                : {}),
              ...(command.profile ? { profile: command.profile } : {}),
            });
          }
          return { ok: true };
        case 'stop-direct-voice-receive':
          await this.stopDirectVoiceReceive();
          return { ok: true };
        case 'start-direct-voice-media':
          return await this.startDirectVoiceMedia(command);
        case 'update-direct-voice-media':
          return await this.updateDirectVoiceMedia(command);
        case 'stop-direct-voice-media':
          await this.stopDirectVoiceMedia();
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

  private async startDirectVoiceReceive(
    command: Extract<
      AudioSurfaceCommand,
      { type: 'start-direct-voice-receive' }
    >
  ): Promise<AudioSurfaceResponse> {
    const roomId = command.roomId.trim();
    const peerAddress = command.peerAddress.trim();
    const key = this.normalizeDirectVoiceRoomKey(command.roomKey);
    if (!roomId || !peerAddress || !key) {
      return { ok: false, error: 'invalid-direct-voice-receive-config' };
    }
    if (
      this.directVoiceRoomId &&
      (this.directVoiceRoomId !== roomId ||
        this.directVoicePeerAddress !== peerAddress)
    ) {
      await this.directVoiceReceiveEngine?.reset();
    }
    this.directVoiceRoomId = roomId;
    this.directVoicePeerAddress = peerAddress;
    this.directVoiceRoomKey = key;
    this.ensureGroupCallSubscription();
    await this.getDirectVoiceReceiveEngine().configure({
      outputDeviceId: command.outputDeviceId ?? this.outputDeviceId,
      hearCall: command.hearCall !== false,
      profile: command.profile ?? this.snapshot.audioQualityProfile,
    });
    this.recordDiagEvent('direct-voice-receive-started', {
      roomId,
      peerAddress: truncateGcallDiagAddress(peerAddress),
    });
    return { ok: true };
  }

  private async startDirectVoiceMedia(
    command: Extract<AudioSurfaceCommand, { type: 'start-direct-voice-media' }>
  ): Promise<AudioSurfaceResponse> {
    const roomId = command.roomId.trim();
    const peerAddress = command.peerAddress.trim();
    const localAddress = command.localAddress.trim();
    const key = this.normalizeDirectVoiceRoomKey(command.roomKey);
    if (!roomId || !peerAddress || !localAddress || !key) {
      return { ok: false, error: 'invalid-direct-voice-media-config' };
    }

    const sessionChanged =
      this.directVoiceRoomId &&
      (this.directVoiceRoomId !== roomId ||
        this.directVoicePeerAddress !== peerAddress ||
        this.directVoiceLocalAddress !== localAddress);
    if (sessionChanged) {
      await this.directVoiceSenderEngine.stop();
      await this.directVoiceReceiveEngine?.reset();
    }

    this.directVoiceRoomId = roomId;
    this.directVoicePeerAddress = peerAddress;
    this.directVoiceLocalAddress = localAddress;
    this.directVoiceRoomKey = key;
    this.resetDirectVoiceOutboundDiagnostics();
    this.directVoiceInputDeviceId =
      command.inputDeviceId !== undefined
        ? command.inputDeviceId
        : this.inputDeviceId;
    this.directVoiceOutputDeviceId =
      command.outputDeviceId !== undefined
        ? command.outputDeviceId
        : this.outputDeviceId;
    this.directVoiceMuted = command.muted === true;
    this.directVoiceHearCall = command.hearCall !== false;
    this.directVoiceProfile =
      command.profile ?? this.snapshot.audioQualityProfile;
    this.ensureGroupCallSubscription();

    await this.getDirectVoiceReceiveEngine().configure({
      outputDeviceId: this.directVoiceOutputDeviceId,
      hearCall: this.directVoiceHearCall,
      profile: this.directVoiceProfile,
    });
    await this.directVoiceSenderEngine.startOrUpdate({
      inputDeviceId: this.directVoiceInputDeviceId,
      outputDeviceId: this.directVoiceOutputDeviceId,
      muted: this.directVoiceMuted,
      profile: this.directVoiceProfile,
      onEncodedFrame: (frame) => {
        void this.dispatchDirectVoiceEncodedFrame(frame);
      },
    });
    const senderDiagnostics =
      this.directVoiceSenderEngine.getDiagnosticsSnapshot();
    if (typeof senderDiagnostics.unsupportedReason === 'string') {
      const unsupportedReason = senderDiagnostics.unsupportedReason;
      await this.stopDirectVoiceMedia();
      return { ok: false, error: unsupportedReason };
    }
    this.recordDiagEvent('direct-voice-media-started', {
      roomId,
      peerAddress: truncateGcallDiagAddress(peerAddress),
      localAddress: truncateGcallDiagAddress(localAddress),
    });
    return { ok: true, payload: { usingAudioSurfaceMedia: true } };
  }

  private async updateDirectVoiceMedia(
    command: Extract<AudioSurfaceCommand, { type: 'update-direct-voice-media' }>
  ): Promise<AudioSurfaceResponse> {
    if (!this.directVoiceRoomId || !this.directVoiceRoomKey) {
      return { ok: true };
    }
    if (command.inputDeviceId !== undefined) {
      this.directVoiceInputDeviceId = command.inputDeviceId;
    }
    if (command.outputDeviceId !== undefined) {
      this.directVoiceOutputDeviceId = command.outputDeviceId;
    }
    if (typeof command.muted === 'boolean') {
      this.directVoiceMuted = command.muted;
      this.directVoiceSenderEngine.setMuted(command.muted);
    }
    if (typeof command.hearCall === 'boolean') {
      this.directVoiceHearCall = command.hearCall;
    }
    if (command.profile) {
      this.directVoiceProfile = command.profile;
    }

    if (this.directVoiceReceiveEngine) {
      await this.directVoiceReceiveEngine.configure({
        ...(command.outputDeviceId !== undefined
          ? { outputDeviceId: this.directVoiceOutputDeviceId }
          : {}),
        ...(typeof command.hearCall === 'boolean'
          ? { hearCall: this.directVoiceHearCall }
          : {}),
        ...(command.profile ? { profile: this.directVoiceProfile } : {}),
      });
    }
    await this.directVoiceSenderEngine.startOrUpdate({
      inputDeviceId: this.directVoiceInputDeviceId,
      outputDeviceId: this.directVoiceOutputDeviceId,
      muted: this.directVoiceMuted,
      profile: this.directVoiceProfile,
      onEncodedFrame: (frame) => {
        void this.dispatchDirectVoiceEncodedFrame(frame);
      },
    });
    return { ok: true };
  }

  private async stopDirectVoiceMedia(): Promise<void> {
    if (!this.directVoiceRoomId && !this.directVoiceRoomKey) return;
    this.recordDiagEvent('direct-voice-media-stopped', {
      roomId: this.directVoiceRoomId,
      peerAddress: truncateGcallDiagAddress(this.directVoicePeerAddress),
    });
    await this.directVoiceSenderEngine.stop();
    this.directVoiceRoomId = '';
    this.directVoicePeerAddress = '';
    this.directVoiceLocalAddress = '';
    this.directVoiceRoomKey = null;
    this.directVoiceSeq = 0;
    this.directVoiceMuted = false;
    this.directVoiceInputDeviceId = null;
    this.directVoiceOutputDeviceId = null;
    this.directVoiceHearCall = true;
    this.directVoiceProfile = this.snapshot.audioQualityProfile;
    await this.directVoiceReceiveEngine?.reset();
  }

  private async dispatchDirectVoiceEncodedFrame(
    frame: GroupCallAudioSenderFrame
  ): Promise<void> {
    if (
      !this.directVoiceRoomKey ||
      !this.directVoiceRoomId ||
      !this.directVoicePeerAddress ||
      !this.directVoiceLocalAddress ||
      this.directVoiceMuted
    ) {
      return;
    }
    if (typeof window.groupCall?.sendAudio !== 'function') {
      this.directVoiceOutboundSendFailures++;
      this.directVoiceOutboundLastFailureMessage =
        'window.groupCall.sendAudio unavailable';
      this.recordDiagEvent('direct-voice-audio-send-failed', {
        roomId: this.directVoiceRoomId,
        peerAddress: truncateGcallDiagAddress(this.directVoicePeerAddress),
        message: this.directVoiceOutboundLastFailureMessage,
      });
      return;
    }
    const seq = ++this.directVoiceSeq & 0xffff;
    const packet = encodeAudioPacketV2(
      this.directVoiceLocalAddress,
      frame.vad,
      seq,
      Date.now() & 0xffffffff,
      frame.opusFrame,
      this.directVoiceRoomKey
    );
    this.directVoiceOutboundSendAttempts++;
    this.directVoiceOutboundLastSendAtMs = Date.now();
    try {
      const result = (await window.groupCall.sendAudio(
        this.directVoiceRoomId,
        this.directVoicePeerAddress,
        packet,
        { rendererSendAtWallMs: this.directVoiceOutboundLastSendAtMs }
      )) as GcallSendAudioResult | undefined;
      if (result?.success === false) {
        throw new Error(result.error ?? 'sendAudio returned failure');
      }
      this.directVoiceOutboundSendSuccesses++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.directVoiceOutboundSendFailures++;
      this.directVoiceOutboundLastFailureMessage = message;
      this.recordDiagEvent('direct-voice-audio-send-failed', {
        roomId: this.directVoiceRoomId,
        peerAddress: truncateGcallDiagAddress(this.directVoicePeerAddress),
        message,
      });
    }
  }

  private resetDirectVoiceOutboundDiagnostics(): void {
    this.directVoiceSeq = 0;
    this.directVoiceOutboundSendAttempts = 0;
    this.directVoiceOutboundSendSuccesses = 0;
    this.directVoiceOutboundSendFailures = 0;
    this.directVoiceOutboundLastFailureMessage = null;
    this.directVoiceOutboundLastSendAtMs = 0;
  }

  private async stopDirectVoiceReceive(): Promise<void> {
    if (this.directVoiceLocalAddress) {
      await this.stopDirectVoiceMedia();
      return;
    }
    if (!this.directVoiceRoomId && !this.directVoiceRoomKey) return;
    this.recordDiagEvent('direct-voice-receive-stopped', {
      roomId: this.directVoiceRoomId,
      peerAddress: truncateGcallDiagAddress(this.directVoicePeerAddress),
    });
    this.directVoiceRoomId = '';
    this.directVoicePeerAddress = '';
    this.directVoiceRoomKey = null;
    await this.directVoiceReceiveEngine?.reset();
  }

  private getDirectVoiceReceiveEngine(): GroupCallAudioReceiveEngine {
    if (!this.directVoiceReceiveEngine) {
      this.directVoiceReceiveEngine = new GroupCallAudioReceiveEngine(() => {});
    }
    return this.directVoiceReceiveEngine;
  }

  private normalizeDirectVoiceRoomKey(
    value: ArrayBuffer | Uint8Array
  ): Uint8Array | null {
    const bytes =
      value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : null;
    if (!bytes || bytes.byteLength !== 32) return null;
    return new Uint8Array(bytes);
  }

  private clearHeldIncomingAudio(): void {
    this.heldIncomingAudio = [];
  }

  private cloneIncomingAudioPayload(
    payload: GroupCallAudioReceivePayload
  ): GroupCallAudioReceivePayload | null {
    if (!(payload.data instanceof ArrayBuffer)) {
      return null;
    }
    return {
      ...payload,
      data: payload.data.slice(0),
    };
  }

  private pruneHeldIncomingAudio(nowMs: number): void {
    this.heldIncomingAudio = this.heldIncomingAudio.filter(
      (entry) =>
        nowMs - entry.heldAtMs <= AWAITING_AUTHORITATIVE_KEY_HOLD_MAX_AGE_MS
    );
    if (
      this.heldIncomingAudio.length >
      AWAITING_AUTHORITATIVE_KEY_HOLD_MAX_PACKETS
    ) {
      this.heldIncomingAudio.splice(
        0,
        this.heldIncomingAudio.length -
          AWAITING_AUTHORITATIVE_KEY_HOLD_MAX_PACKETS
      );
    }
  }

  private enqueueIncomingAudioWhileAwaitingKey(
    payload: GroupCallAudioReceivePayload
  ): void {
    const cloned = this.cloneIncomingAudioPayload(payload);
    if (!cloned) {
      return;
    }
    const nowMs = Date.now();
    this.pruneHeldIncomingAudio(nowMs);
    this.heldIncomingAudio.push({
      payload: cloned,
      heldAtMs: nowMs,
    });
    this.pruneHeldIncomingAudio(nowMs);
  }

  private async flushHeldIncomingAudioAfterKeyApplied(): Promise<void> {
    if (this.heldIncomingAudio.length === 0) {
      return;
    }
    const nowMs = Date.now();
    this.pruneHeldIncomingAudio(nowMs);
    if (this.heldIncomingAudio.length === 0) {
      return;
    }
    const pending = this.heldIncomingAudio;
    this.heldIncomingAudio = [];
    this.recordDiagEvent('held-audio-flush-after-room-key', {
      roomId: this.snapshot.roomId,
      count: pending.length,
    });
    for (const entry of pending) {
      await this.processIncomingAudioPayload(entry.payload);
    }
  }

  private shouldLogAwaitingAuthoritativeKeyFailure(
    nowMs = Date.now()
  ): boolean {
    if (
      nowMs - this.lastAwaitingAuthoritativeKeyFailureLogAt <
      AUTHORITATIVE_KEY_RECOVERY_FAILURE_LOG_COOLDOWN_MS
    ) {
      return false;
    }
    this.lastAwaitingAuthoritativeKeyFailureLogAt = nowMs;
    return true;
  }

  private emitSnapshot(): void {
    this.snapshot = this.withDerivedSnapshotState(this.snapshot);
    this.emit({ type: 'snapshot', snapshot: this.snapshot });
  }

  private recordDiagEvent(
    tag: string,
    payload?: Record<string, unknown>
  ): void {
    const nowMs = Date.now();
    this.diagEvents.push({
      t: nowMs,
      timestampMs: nowMs,
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

  private recordThrottledDiagEvent(
    tag: string,
    throttleKey: string,
    payload?: Record<string, unknown>,
    cooldownMs = STARTUP_SUPPRESSION_DIAG_COOLDOWN_MS
  ): void {
    const nowMs = Date.now();
    const key = `${tag}:${throttleKey}`;
    const existing = this.throttledDiagEvents.get(key);
    if (!existing) {
      this.throttledDiagEvents.set(key, {
        firstAtMs: nowMs,
        lastEmitAtMs: nowMs,
        suppressedSinceEmit: 0,
      });
      this.recordDiagEvent(tag, payload);
      return;
    }

    existing.suppressedSinceEmit += 1;
    if (nowMs - existing.lastEmitAtMs < cooldownMs) return;

    const suppressedSinceLast = existing.suppressedSinceEmit;
    existing.lastEmitAtMs = nowMs;
    existing.suppressedSinceEmit = 0;
    this.recordDiagEvent(tag, {
      ...payload,
      firstSuppressedAtMs: existing.firstAtMs,
      suppressedSinceLast,
    });
  }

  private getAudioStageAggregate<K extends string>(
    map: Map<K, AudioStageAggregate>,
    key: K
  ): AudioStageAggregate {
    let aggregate = map.get(key);
    if (!aggregate) {
      aggregate = {
        samples: 0,
        sumMs: 0,
        maxMs: 0,
        over80: 0,
        over160: 0,
        over320: 0,
        over640: 0,
      };
      map.set(key, aggregate);
    }
    return aggregate;
  }

  private recordAudioStageAggregate(
    aggregate: AudioStageAggregate,
    valueMs: number
  ): void {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    aggregate.samples++;
    aggregate.sumMs += valueMs;
    aggregate.maxMs = Math.max(aggregate.maxMs, valueMs);
    if (valueMs >= 80) aggregate.over80++;
    if (valueMs >= 160) aggregate.over160++;
    if (valueMs >= 320) aggregate.over320++;
    if (valueMs >= 640) aggregate.over640++;
  }

  private pushAudioStageRecentWorst(entry: AudioStageRecentWorst): void {
    if (entry.valueMs < AUDIO_STAGE_TIMING_WARN_MS) return;
    this.audioStageRecentWorst.push(entry);
    this.audioStageRecentWorst.sort((a, b) => b.valueMs - a.valueMs);
    if (this.audioStageRecentWorst.length > AUDIO_STAGE_RECENT_WORST_LIMIT) {
      this.audioStageRecentWorst.splice(AUDIO_STAGE_RECENT_WORST_LIMIT);
    }
  }

  private recordAudioStageGap(
    stage: AudioStageName,
    sourceAddr: string,
    atMs: number
  ): void {
    if (!Number.isFinite(atMs) || atMs <= 0) return;
    const source = sourceAddr || 'unknown';
    const key = `${stage}:${source}`;
    const previousAt = this.audioStageLastAtBySource.get(key) ?? 0;
    this.audioStageLastAtBySource.set(key, atMs);
    if (previousAt <= 0) return;
    const gapMs = atMs - previousAt;
    const aggregate = this.getAudioStageAggregate(
      this.audioStageGapStats,
      stage
    );
    this.recordAudioStageAggregate(aggregate, gapMs);
    this.pushAudioStageRecentWorst({
      atMs,
      kind: 'gap',
      name: stage,
      source: truncateGcallDiagAddress(source),
      valueMs: Math.round(gapMs * 1000) / 1000,
    });
  }

  private recordAudioStageDelta(
    name: AudioStageDeltaName,
    sourceAddr: string,
    startAtMs: number | null | undefined,
    endAtMs: number | null | undefined
  ): void {
    if (
      typeof startAtMs !== 'number' ||
      typeof endAtMs !== 'number' ||
      !Number.isFinite(startAtMs) ||
      !Number.isFinite(endAtMs) ||
      startAtMs <= 0 ||
      endAtMs <= 0
    ) {
      return;
    }
    const deltaMs = endAtMs - startAtMs;
    const aggregate = this.getAudioStageAggregate(
      this.audioStageDeltaStats,
      name
    );
    this.recordAudioStageAggregate(aggregate, deltaMs);
    this.pushAudioStageRecentWorst({
      atMs: endAtMs,
      kind: 'delta',
      name,
      source: sourceAddr ? truncateGcallDiagAddress(sourceAddr) : null,
      valueMs: Math.round(deltaMs * 1000) / 1000,
    });
  }

  private cloneAudioStageTimestamps(
    payload: GroupCallAudioReceivePayload,
    patch?: Partial<AudioStageTimingTimestamps>
  ): AudioStageTimingTimestamps {
    return {
      ...(payload.audioStageTimestamps ?? {}),
      ...patch,
    };
  }

  private recordAudioStageIngress(
    audioPayload: GroupCallAudioReceivePayload
  ): GroupCallAudioReceivePayload {
    const sourceAddr =
      audioPayload.fromAddress ?? audioPayload.resolvedFromAddress ?? 'unknown';
    const handlerAt = Date.now();
    const timestamps = this.cloneAudioStageTimestamps(audioPayload, {
      audioSurfaceHandlerAtWallMs: handlerAt,
    });
    const bridgeAt =
      timestamps.bridgeReceivedAtWallMs ?? audioPayload.bridgeReceivedAtWallMs;
    if (typeof bridgeAt === 'number') {
      this.recordAudioStageGap('bridgeReceived', sourceAddr, bridgeAt);
    }
    if (typeof timestamps.managerEmitAtWallMs === 'number') {
      this.recordAudioStageGap(
        'managerEmit',
        sourceAddr,
        timestamps.managerEmitAtWallMs
      );
    }
    if (typeof timestamps.mainFanoutAtWallMs === 'number') {
      this.recordAudioStageGap(
        'mainFanout',
        sourceAddr,
        timestamps.mainFanoutAtWallMs
      );
    }
    this.recordAudioStageGap('audioSurfaceHandler', sourceAddr, handlerAt);
    this.recordAudioStageDelta(
      'bridgeToManager',
      sourceAddr,
      bridgeAt,
      timestamps.managerEmitAtWallMs
    );
    this.recordAudioStageDelta(
      'managerToMainFanout',
      sourceAddr,
      timestamps.managerEmitAtWallMs,
      timestamps.mainFanoutAtWallMs
    );
    this.recordAudioStageDelta(
      'mainFanoutToSurface',
      sourceAddr,
      timestamps.mainFanoutAtWallMs,
      handlerAt
    );
    this.recordAudioStageDelta(
      'bridgeToSurface',
      sourceAddr,
      bridgeAt,
      handlerAt
    );
    this.recordAudioStageDelta(
      'managerToSurface',
      sourceAddr,
      timestamps.managerEmitAtWallMs,
      handlerAt
    );
    return {
      ...audioPayload,
      audioStageTimestamps: timestamps,
    };
  }

  private serializeAudioStageAggregate(
    aggregate: AudioStageAggregate
  ): Record<string, number> {
    return {
      samples: aggregate.samples,
      avgMs:
        aggregate.samples > 0
          ? Math.round((aggregate.sumMs / aggregate.samples) * 1000) / 1000
          : 0,
      maxMs: Math.round(aggregate.maxMs * 1000) / 1000,
      over80: aggregate.over80,
      over160: aggregate.over160,
      over320: aggregate.over320,
      over640: aggregate.over640,
    };
  }

  private buildAudioStageTimingDiagnostics(): Record<string, unknown> {
    return {
      gapByStage: Object.fromEntries(
        [...this.audioStageGapStats.entries()].map(([key, value]) => [
          key,
          this.serializeAudioStageAggregate(value),
        ])
      ),
      deltaByStage: Object.fromEntries(
        [...this.audioStageDeltaStats.entries()].map(([key, value]) => [
          key,
          this.serializeAudioStageAggregate(value),
        ])
      ),
      recentWorst: [...this.audioStageRecentWorst],
    };
  }

  private truncateDiagHex(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? '';
    if (!normalized) return null;
    return normalized.length > 16
      ? `${normalized.slice(0, 12)}...${normalized.slice(-4)}`
      : normalized;
  }

  private buildIncomingRoomKeyDiagPayload(
    payload: Partial<IncomingRoomKeyPayload> | null | undefined,
    extra?: Record<string, unknown>
  ): Record<string, unknown> {
    const currentRoot = this.topology?.rootForwarder?.trim() ?? '';
    const fromAddress = payload?.fromAddress?.trim() ?? '';
    const senderInRoster = fromAddress
      ? this.snapshot.participants.some(
          (participant) => participant.address?.trim() === fromAddress
        )
      : false;
    return {
      roomId: payload?.roomId ?? null,
      expectedRoomId: this.snapshot.roomId || null,
      fromAddress: fromAddress || null,
      currentRoot: currentRoot || null,
      senderInRoster,
      participantCount: this.snapshot.participants.length,
      verified: payload?.verified === true,
      keyMessageVersion: payload?.keyMessageVersion ?? null,
      expectedKeyMessageVersion: GCALL_KEY_MESSAGE_VERSION,
      payloadCallSessionId: payload?.callSessionId ?? null,
      localCallSessionId: this.callSessionId || null,
      payloadMediaSessionGeneration:
        typeof payload?.mediaSessionGeneration === 'number'
          ? payload.mediaSessionGeneration >>> 0
          : null,
      localMediaSessionGeneration: this.mediaSessionGeneration >>> 0,
      keyCommitment: this.truncateDiagHex(payload?.keyCommitment),
      hasEncryptedKey: Boolean(payload?.encryptedKey),
      hasRoomKey: this.roomKey !== null,
      ownsRoomKey: this.ownsRoomKey,
      selfMintedRoomKey: this.selfMintedRoomKey,
      awaitingAuthoritativeKey: this.awaitingAuthoritativeKey,
      ...extra,
    };
  }

  private buildKeyExchangeDiagnosticsSnapshot(): Record<string, unknown> {
    const keyEvents = this.diagEvents.filter(
      (event) =>
        event.tag.includes('key') ||
        event.tag.includes('room-key') ||
        event.tag.includes('session-identity')
    );
    const countByTag = keyEvents.reduce<Record<string, number>>(
      (counts, event) => {
        counts[event.tag] = (counts[event.tag] ?? 0) + 1;
        return counts;
      },
      {}
    );
    const findLast = (
      predicate: (event: AudioSurfaceDiagEvent) => boolean
    ): AudioSurfaceDiagEvent | null => {
      for (let index = this.diagEvents.length - 1; index >= 0; index -= 1) {
        const event = this.diagEvents[index];
        if (event && predicate(event)) return event;
      }
      return null;
    };
    return {
      countByTag,
      lastKeyReceived: findLast((event) => event.tag === 'gcall-key-received'),
      lastKeyApplied: findLast((event) => event.tag === 'room-key-applied'),
      lastKeyDropped: findLast((event) => event.tag === 'room-key-dropped'),
      lastKeyRequested: findLast((event) => event.tag === 'room-key-requested'),
      lastKeyRequestDropped: findLast(
        (event) => event.tag === 'room-key-request-dropped'
      ),
      lastTargetedKeySent: findLast(
        (event) => event.tag === 'targeted-room-key-sent'
      ),
      lastTargetedKeySkipped: findLast(
        (event) => event.tag === 'targeted-room-key-skipped'
      ),
    };
  }

  private buildAuthoritySnapshot(): Record<string, unknown> {
    const nowMs = Date.now();
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const participantAddresses = this.snapshot.participants
      .map((participant) => participant.address?.trim() ?? '')
      .filter(Boolean);
    const remoteParticipantCount = participantAddresses.filter(
      (address) => address !== myAddress
    ).length;
    return {
      roomId: this.snapshot.roomId || null,
      roomState: this.snapshot.roomState,
      myRole: this.snapshot.myRole,
      topologyEpoch: this.topology?.topologyEpoch ?? null,
      topologyRootForwarder: this.topology?.rootForwarder
        ? truncateGcallDiagAddress(this.topology.rootForwarder)
        : null,
      topologyStandbyForwarder: this.topology?.standbyForwarder
        ? truncateGcallDiagAddress(this.topology.standbyForwarder)
        : null,
      lastObservedTopologyEpoch: this.lastObservedTopologyEpoch,
      participantCount: participantAddresses.length,
      remoteParticipantCount,
      topologyElectionDelayRemainingMs:
        this.topologyElectionDelayUntilMs > nowMs
          ? this.topologyElectionDelayUntilMs - nowMs
          : 0,
      authoritySettleRemainingMs:
        this.authoritySettleUntilMs > nowMs
          ? this.authoritySettleUntilMs - nowMs
          : 0,
      startupOccupiedRoomEvidence: this.startupOccupiedRoomEvidence,
      startupHydratedRemoteCount: this.startupHydratedRemoteCount,
      startupBootstrapHasTopology: this.startupBootstrapHasTopology,
      provisionalLocalRootActive: this.isProvisionalLocalRootActive(nowMs),
      provisionalLocalRootRemainingMs:
        this.provisionalLocalRootUntilMs > nowMs
          ? this.provisionalLocalRootUntilMs - nowMs
          : 0,
      provisionalLocalRootElectionAgeMs:
        this.provisionalLocalRootElectionAtMs > 0
          ? nowMs - this.provisionalLocalRootElectionAtMs
          : null,
      provisionalLocalRootReason: this.provisionalLocalRootReason || null,
      provisionalLocalRootRemoteCount: this.provisionalLocalRootRemoteCount,
      callAgeMs: this.callEpochMs > 0 ? nowMs - this.callEpochMs : null,
      trustedRemoteRoot: this.trustedRemoteRoot
        ? truncateGcallDiagAddress(this.trustedRemoteRoot)
        : null,
      trustedRemoteRootAgeMs:
        this.trustedRemoteRootLastSeenAt > 0
          ? nowMs - this.trustedRemoteRootLastSeenAt
          : null,
      conflictingRemoteRoot: this.conflictingRemoteRoot
        ? truncateGcallDiagAddress(this.conflictingRemoteRoot)
        : null,
      conflictingRemoteRootAgeMs:
        this.conflictingRemoteRootLastSeenAt > 0
          ? nowMs - this.conflictingRemoteRootLastSeenAt
          : null,
      hasRoomKey: this.roomKey !== null,
      ownsRoomKey: this.ownsRoomKey,
      selfMintedRoomKey: this.selfMintedRoomKey,
      awaitingAuthoritativeKey: this.awaitingAuthoritativeKey,
      callSessionIdPresent: this.callSessionId.trim() !== '',
      mediaSessionGeneration: this.mediaSessionGeneration,
    };
  }

  private clearProvisionalLocalRoot(): void {
    this.provisionalLocalRootUntilMs = 0;
    this.provisionalLocalRootElectionAtMs = 0;
    this.provisionalLocalRootReason = '';
    this.provisionalLocalRootRemoteCount = 0;
  }

  private isProvisionalLocalRootActive(nowMs = Date.now()): boolean {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    return (
      Boolean(myAddress) &&
      this.topology?.rootForwarder?.trim() === myAddress &&
      this.provisionalLocalRootUntilMs > nowMs
    );
  }

  private isAddressInCurrentRoster(address: string): boolean {
    const target = address.trim();
    if (!target) return false;
    return this.snapshot.participants.some(
      (participant) => participant.address?.trim() === target
    );
  }

  private countRemoteParticipants(): number {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    return this.snapshot.participants
      .map((participant) => participant.address?.trim() ?? '')
      .filter((address) => address && address !== myAddress).length;
  }

  private shouldMarkLocalRootProvisional(): boolean {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!myAddress) return false;
    return (
      this.countRemoteParticipants() > 0 || this.startupHydratedRemoteCount > 0
    );
  }

  private markProvisionalLocalRoot(reason: string, nowMs = Date.now()): void {
    const remoteParticipantCount = Math.max(
      this.countRemoteParticipants(),
      this.startupHydratedRemoteCount
    );
    this.provisionalLocalRootElectionAtMs = nowMs;
    this.provisionalLocalRootUntilMs =
      nowMs + PROVISIONAL_LOCAL_ROOT_RECONCILE_MS;
    this.provisionalLocalRootReason = reason;
    this.provisionalLocalRootRemoteCount = remoteParticipantCount;
    this.recordDiagEvent('provisional-local-root-armed', {
      roomId: this.snapshot.roomId,
      reason,
      remoteParticipantCount,
      reconcileMs: PROVISIONAL_LOCAL_ROOT_RECONCILE_MS,
      startupOccupiedRoomEvidence: this.startupOccupiedRoomEvidence,
      startupHydratedRemoteCount: this.startupHydratedRemoteCount,
    });
  }

  private canReconcileProvisionalLocalRootWithRemote(
    remoteRoot: string,
    nowMs = Date.now()
  ): boolean {
    const root = remoteRoot.trim();
    const myAddress = this.userInfo?.address?.trim() ?? '';
    return (
      Boolean(root) &&
      root !== myAddress &&
      this.isProvisionalLocalRootActive(nowMs) &&
      this.isAddressInCurrentRoster(root)
    );
  }

  private reconcileProvisionalLocalRootFromRemoteAuthority(
    remoteRoot: string,
    seenAtMs: number,
    reason: 'heartbeat' | 'verified-key'
  ): boolean {
    const nowMs = Date.now();
    const root = remoteRoot.trim();
    if (!this.canReconcileProvisionalLocalRootWithRemote(root, nowMs)) {
      return false;
    }
    const effectiveSeenAt =
      seenAtMs > 0 && Number.isFinite(seenAtMs) ? seenAtMs : nowMs;
    this.updateTrustedRemoteRoot(root, effectiveSeenAt);
    this.clearConflictingRemoteRootIfMatches(root);
    this.topologyElectionDelayUntilMs = Math.min(
      this.topologyElectionDelayUntilMs,
      nowMs
    );
    this.recordDiagEvent('provisional-local-root-reconcile-triggered', {
      roomId: this.snapshot.roomId,
      remoteRoot: truncateGcallDiagAddress(root),
      reason,
      provisionalRemainingMs: Math.max(
        0,
        this.provisionalLocalRootUntilMs - nowMs
      ),
    });
    this.scheduleTopologyElection(`provisional-local-root-${reason}`);
    return true;
  }

  private getRecentRemoteActivityAtMs(nowMs: number): number {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    let latest = 0;
    const visit = (addressValue: string, seenAtMs: number): void => {
      const address = addressValue.trim();
      if (
        !address ||
        address === myAddress ||
        seenAtMs <= 0 ||
        !Number.isFinite(seenAtMs)
      ) {
        return;
      }
      if (nowMs - seenAtMs <= ROOT_RECENT_EVIDENCE_FAILOVER_GRACE_MS) {
        latest = Math.max(latest, seenAtMs);
      }
    };
    for (const [address, seenAtMs] of this.participantLiveEvidenceLastSeenAt) {
      visit(address, seenAtMs);
    }
    for (const [address, seenAtMs] of this.participantDecodedMediaLastSeenAt) {
      visit(address, seenAtMs);
    }
    for (const [address, seenAtMs] of this.activeSpeakerLastSeenAt) {
      visit(address, seenAtMs);
    }
    return latest;
  }

  private getOccupiedRejoinLocalRootSuppressionUntilMs(nowMs: number): number {
    const remoteParticipantCount = Math.max(
      this.countRemoteParticipants(),
      this.startupHydratedRemoteCount
    );
    if (
      remoteParticipantCount <= 0 ||
      (!this.startupOccupiedRoomEvidence &&
        this.startupHydratedRemoteCount <= 0)
    ) {
      return 0;
    }
    const joinGuardUntil =
      this.lastJoinSuccessAtMs > 0
        ? this.lastJoinSuccessAtMs + ROOT_RECENT_EVIDENCE_FAILOVER_GRACE_MS
        : 0;
    const recentRemoteActivityAtMs = this.getRecentRemoteActivityAtMs(nowMs);
    const activityGuardUntil =
      recentRemoteActivityAtMs > 0
        ? recentRemoteActivityAtMs + ROOT_RECENT_EVIDENCE_FAILOVER_GRACE_MS
        : 0;
    return Math.max(joinGuardUntil, activityGuardUntil);
  }

  private shouldSuppressOccupiedRejoinLocalRootElection(
    topology: GroupCallTopology,
    reason: string,
    nowMs: number
  ): boolean {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!myAddress || topology.rootForwarder?.trim() !== myAddress) {
      return false;
    }
    if (reason !== 'authoritative-roster-refresh') return false;
    if ((this.topology?.rootForwarder?.trim() ?? '') === myAddress) {
      return false;
    }
    const suppressUntilMs =
      this.getOccupiedRejoinLocalRootSuppressionUntilMs(nowMs);
    if (suppressUntilMs <= nowMs) return false;
    this.topologyElectionDelayUntilMs = Math.max(
      this.topologyElectionDelayUntilMs,
      suppressUntilMs
    );
    this.recordDiagEvent('local-root-election-suppressed-occupied-rejoin', {
      roomId: this.snapshot.roomId,
      reason,
      proposedRoot: myAddress,
      participantCount: topology.clusters.flatMap((cluster) => cluster.members)
        .length,
      startupOccupiedRoomEvidence: this.startupOccupiedRoomEvidence,
      startupHydratedRemoteCount: this.startupHydratedRemoteCount,
      suppressRemainingMs: Math.max(0, suppressUntilMs - nowMs),
    });
    this.requestRetainedKeyReplay('occupied-rejoin-root-election-suppressed');
    this.scheduleTopologyElection('authority-conflict');
    return true;
  }

  private shouldAcceptVerifiedRoomKeyDuringAuthorityLag(
    fromAddress: string,
    senderInRoster: boolean,
    currentRoot: string
  ): boolean {
    const sender = fromAddress.trim();
    const root = currentRoot.trim();
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!sender || !myAddress || sender === myAddress) return false;
    if (root && root !== myAddress) return false;
    const smallRoom =
      this.snapshot.participants.length <= 2 &&
      this.countRemoteParticipants() <= 1;
    const hasOccupiedRejoinEvidence =
      this.startupOccupiedRoomEvidence || this.startupHydratedRemoteCount > 0;
    return (
      smallRoom ||
      senderInRoster ||
      hasOccupiedRejoinEvidence ||
      this.isProvisionalLocalRootActive()
    );
  }

  private markRoomKeyLocallyEnsured(): void {
    this.localRoomKeyLastEnsuredAtMs = Date.now();
    this.demotedRootKeyTransferUntilMs = 0;
  }

  private async markLocalRoomKeyApplied(roomKey: Uint8Array): Promise<void> {
    if (!this.callSessionId) {
      this.appliedRoomKeyCommitment = '';
      return;
    }
    this.appliedRoomKeyCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      this.callSessionId,
      this.mediaSessionGeneration >>> 0
    );
  }

  private hasFreshLocalKeyAuthority(nowMs = Date.now()): boolean {
    return (
      this.roomKey !== null &&
      this.ownsRoomKey &&
      this.localRoomKeyLastEnsuredAtMs > 0 &&
      nowMs - this.localRoomKeyLastEnsuredAtMs <=
        FRESH_LOCAL_KEY_AUTHORITY_GRACE_MS
    );
  }

  private retainDemotedRootKeyForTransfer(reason: string): void {
    if (!this.roomKey) return;
    this.demotedRootKeyTransferUntilMs =
      Date.now() + DEMOTED_ROOT_KEY_TRANSFER_GRACE_MS;
    this.recordDiagEvent('demoted-root-key-retained', {
      roomId: this.snapshot.roomId,
      reason,
      transferGraceMs: DEMOTED_ROOT_KEY_TRANSFER_GRACE_MS,
      currentRoot: this.topology?.rootForwarder?.trim() || null,
    });
  }

  private clearRecentWindowTrends(): void {
    this.recentWindowTrends.splice(0, this.recentWindowTrends.length);
  }

  private resetOutboundMediaDiagnostics(): void {
    this.outboundEncodedFrameCallbacks = 0;
    this.outboundPacketBuildAttempts = 0;
    this.outboundSendAttempts = 0;
    this.outboundSendSuccesses = 0;
    this.outboundSendFailures = 0;
    this.outboundSkippedNoRoomKey = 0;
    this.outboundSkippedNoTopology = 0;
    this.outboundSkippedNoUser = 0;
    this.outboundSkippedNoRoomId = 0;
    this.outboundSkippedMuted = 0;
    this.outboundSkippedNoTargets = 0;
    this.outboundLastEncodedFrameAtMs = 0;
    this.outboundLastPacketBuildAttemptAtMs = 0;
    this.outboundLastSendAttemptAtMs = 0;
    this.outboundLastSendSuccessAtMs = 0;
    this.outboundLastSendFailureAtMs = 0;
    this.outboundLastSkipAtMs = 0;
    this.outboundLastSkipReason = null;
    this.outboundLastSendFailureMessage = null;
    this.outboundLastMainDiagnostics = null;
    this.outboundLastTargets = [];
    this.outboundTargetDiagnostics.clear();
    this.startupMediaTargetWaitLastDiagAt = 0;
  }

  private recordOutboundSkip(reason: string): void {
    if (reason === 'no-room-key') this.outboundSkippedNoRoomKey++;
    else if (reason === 'no-topology') this.outboundSkippedNoTopology++;
    else if (reason === 'no-user') this.outboundSkippedNoUser++;
    else if (reason === 'no-room-id') this.outboundSkippedNoRoomId++;
    else if (reason === 'muted') this.outboundSkippedMuted++;
    else if (reason === 'no-targets') this.outboundSkippedNoTargets++;
    this.outboundLastSkipAtMs = Date.now();
    this.outboundLastSkipReason = reason;
  }

  private getOutboundTargetDiagnostics(
    target: string
  ): OutboundMediaTargetDiagnostics {
    const existing = this.outboundTargetDiagnostics.get(target);
    if (existing) return existing;
    const next: OutboundMediaTargetDiagnostics = {
      target,
      attempts: 0,
      successes: 0,
      failures: 0,
      firstAttemptAtMs: 0,
      lastAttemptAtMs: 0,
      lastSuccessAtMs: 0,
      lastFailureAtMs: 0,
      lastFailureMessage: null,
      lastMainDiagnostics: null,
    };
    this.outboundTargetDiagnostics.set(target, next);
    return next;
  }

  private buildOutboundMediaDiagnosticsSnapshot(): OutboundMediaDiagnostics {
    return {
      encodedFrameCallbacks: this.outboundEncodedFrameCallbacks,
      packetBuildAttempts: this.outboundPacketBuildAttempts,
      sendAttempts: this.outboundSendAttempts,
      sendSuccesses: this.outboundSendSuccesses,
      sendFailures: this.outboundSendFailures,
      skippedNoRoomKey: this.outboundSkippedNoRoomKey,
      skippedNoTopology: this.outboundSkippedNoTopology,
      skippedNoUser: this.outboundSkippedNoUser,
      skippedNoRoomId: this.outboundSkippedNoRoomId,
      skippedMuted: this.outboundSkippedMuted,
      skippedNoTargets: this.outboundSkippedNoTargets,
      lastEncodedFrameAtMs: this.outboundLastEncodedFrameAtMs,
      lastPacketBuildAttemptAtMs: this.outboundLastPacketBuildAttemptAtMs,
      lastSendAttemptAtMs: this.outboundLastSendAttemptAtMs,
      lastSendSuccessAtMs: this.outboundLastSendSuccessAtMs,
      lastSendFailureAtMs: this.outboundLastSendFailureAtMs,
      lastSkipAtMs: this.outboundLastSkipAtMs,
      lastSkipReason: this.outboundLastSkipReason,
      lastSendFailureMessage: this.outboundLastSendFailureMessage,
      lastMainDiagnostics: this.outboundLastMainDiagnostics,
      lastTargets: [...this.outboundLastTargets],
      targets: [...this.outboundTargetDiagnostics.values()],
    };
  }

  private recordOutboundMainDiagnostics(
    diagnostics: GcallSendAudioDiagnostics | undefined | null
  ): void {
    if (!diagnostics) return;
    this.outboundLastMainDiagnostics = diagnostics;
    const target = diagnostics.targetAddress;
    if (target) {
      this.getOutboundTargetDiagnostics(target).lastMainDiagnostics =
        diagnostics;
    }
    const transport = diagnostics.transport;
    if (transport === 'link' || transport === 'packet') {
      this.receiveEngine.recordReticulumAudioOutboundTransport(transport);
    }
    this.receiveEngine.setReticulumAudioQueueDepths({
      pendingFrames: diagnostics.pendingFrames,
      pendingOldestAgeMs: diagnostics.pendingOldestAgeMs,
      bridgeQueuedFrames: diagnostics.bridge?.bridgeQueuedFrames,
      bridgeQueuedOldestAgeMs: diagnostics.bridge?.bridgeQueuedOldestAgeMs,
      bridgeWaitingForDrain: diagnostics.bridge?.bridgeWaitingForDrain,
      decodedQueueDepth: diagnostics.bridge?.decodedQueueDepth,
      decodedQueueOldestAgeMs: diagnostics.bridge?.decodedQueueOldestAgeMs,
      binaryOutQueueDepth: diagnostics.bridge?.binaryOutQueueDepth,
      binaryOutQueueOldestAgeMs: diagnostics.bridge?.binaryOutQueueOldestAgeMs,
      queuePressureDropsLast5s: diagnostics.bridge?.queuePressureDropsLast5s,
      staleDropsLast5s: diagnostics.bridge?.staleDropsLast5s,
      packetPathRequests: diagnostics.bridge?.packetPathRequests,
      packetPathResolutions: diagnostics.bridge?.packetPathResolutions,
      packetPathTimeouts: diagnostics.bridge?.packetPathTimeouts,
      packetFreshSends: diagnostics.bridge?.packetFreshSends,
      packetStaleSends: diagnostics.bridge?.packetStaleSends,
      packetUnknownSends: diagnostics.bridge?.packetUnknownSends,
      deadlineDropCount: diagnostics.bridge?.deadlineDropCount,
      decodedQueueEvictOldestCount:
        diagnostics.bridge?.decodedQueueEvictOldestCount,
      decodedQueueDropNewestCount:
        diagnostics.bridge?.decodedQueueDropNewestCount,
      fd3DecodedAgeMsMax: diagnostics.bridge?.fd3DecodedAgeMsMax,
      decodedQueueDwellMsMax: diagnostics.bridge?.decodedQueueDwellMsMax,
      rnsSendDurationMsMax: diagnostics.bridge?.rnsSendDurationMsMax,
      packetPathCheckMsMax: diagnostics.bridge?.packetPathCheckMsMax,
      executorLoopGapMsMax: diagnostics.bridge?.executorLoopGapMsMax,
      executorGapWhileQueuedMsMax:
        diagnostics.bridge?.executorGapWhileQueuedMsMax,
      executorAudioPassMsMax: diagnostics.bridge?.executorAudioPassMsMax,
      processBatchMsMax: diagnostics.bridge?.processBatchMsMax,
      processBatchFramesMax: diagnostics.bridge?.processBatchFramesMax,
      rnsSendSlowCount: diagnostics.bridge?.rnsSendSlowCount,
      executorStallCount: diagnostics.bridge?.executorStallCount,
      executorCommandMsMax: diagnostics.bridge?.executorCommandMsMax,
      executorCommandWhileQueuedMsMax:
        diagnostics.bridge?.executorCommandWhileQueuedMsMax,
      executorCommandSlowCount: diagnostics.bridge?.executorCommandSlowCount,
      rnsCallbackSchedulerGapMsMax:
        diagnostics.bridge?.rnsCallbackSchedulerGapMsMax,
      rnsCallbackSchedulerGapOver100Count:
        diagnostics.bridge?.rnsCallbackSchedulerGapOver100Count,
      rnsCallbackSchedulerGapOver250Count:
        diagnostics.bridge?.rnsCallbackSchedulerGapOver250Count,
      rnsCallbackSchedulerGapOver500Count:
        diagnostics.bridge?.rnsCallbackSchedulerGapOver500Count,
      rnsCallbackSchedulerGapOver1000Count:
        diagnostics.bridge?.rnsCallbackSchedulerGapOver1000Count,
      rnsRawInboundGapMsMax: diagnostics.bridge?.rnsRawInboundGapMsMax,
      rnsRawInboundGapOver80Count:
        diagnostics.bridge?.rnsRawInboundGapOver80Count,
      rnsRawInboundGapOver160Count:
        diagnostics.bridge?.rnsRawInboundGapOver160Count,
      rnsRawInboundGapOver320Count:
        diagnostics.bridge?.rnsRawInboundGapOver320Count,
      rnsRawInboundGapOver640Count:
        diagnostics.bridge?.rnsRawInboundGapOver640Count,
      rnsRawInboundGapOver1000Count:
        diagnostics.bridge?.rnsRawInboundGapOver1000Count,
      rnsRawInboundToLinkReceiveMsMax:
        diagnostics.bridge?.rnsRawInboundToLinkReceiveMsMax,
      rnsRawInboundToLinkReceiveOver80Count:
        diagnostics.bridge?.rnsRawInboundToLinkReceiveOver80Count,
      rnsRawInboundToLinkReceiveOver160Count:
        diagnostics.bridge?.rnsRawInboundToLinkReceiveOver160Count,
      rnsRawInboundToLinkReceiveOver320Count:
        diagnostics.bridge?.rnsRawInboundToLinkReceiveOver320Count,
      rnsRawInboundToLinkReceiveOver640Count:
        diagnostics.bridge?.rnsRawInboundToLinkReceiveOver640Count,
      rnsRawInboundToLinkReceiveOver1000Count:
        diagnostics.bridge?.rnsRawInboundToLinkReceiveOver1000Count,
      rnsRawInboundToLinkReceiveSamples:
        diagnostics.bridge?.rnsRawInboundToLinkReceiveSamples,
      rnsRawInboundInterfaceLast:
        diagnostics.bridge?.rnsRawInboundInterfaceLast,
      rnsRawInboundInterfaceWorst:
        diagnostics.bridge?.rnsRawInboundInterfaceWorst,
      rnsSharedFrameGapMsMax: diagnostics.bridge?.rnsSharedFrameGapMsMax,
      rnsSharedFrameGapOver80Count:
        diagnostics.bridge?.rnsSharedFrameGapOver80Count,
      rnsSharedFrameGapOver160Count:
        diagnostics.bridge?.rnsSharedFrameGapOver160Count,
      rnsSharedFrameGapOver320Count:
        diagnostics.bridge?.rnsSharedFrameGapOver320Count,
      rnsSharedFrameGapOver640Count:
        diagnostics.bridge?.rnsSharedFrameGapOver640Count,
      rnsSharedFrameGapOver1000Count:
        diagnostics.bridge?.rnsSharedFrameGapOver1000Count,
      rnsSharedFrameToTransportInboundMsMax:
        diagnostics.bridge?.rnsSharedFrameToTransportInboundMsMax,
      rnsSharedFrameToTransportInboundOver80Count:
        diagnostics.bridge?.rnsSharedFrameToTransportInboundOver80Count,
      rnsSharedFrameToTransportInboundOver160Count:
        diagnostics.bridge?.rnsSharedFrameToTransportInboundOver160Count,
      rnsSharedFrameToTransportInboundOver320Count:
        diagnostics.bridge?.rnsSharedFrameToTransportInboundOver320Count,
      rnsSharedFrameToTransportInboundOver640Count:
        diagnostics.bridge?.rnsSharedFrameToTransportInboundOver640Count,
      rnsSharedFrameToTransportInboundOver1000Count:
        diagnostics.bridge?.rnsSharedFrameToTransportInboundOver1000Count,
      rnsSharedFrameToTransportInboundSamples:
        diagnostics.bridge?.rnsSharedFrameToTransportInboundSamples,
      rnsSharedFrameInterfaceLast:
        diagnostics.bridge?.rnsSharedFrameInterfaceLast,
      rnsSharedFrameInterfaceWorst:
        diagnostics.bridge?.rnsSharedFrameInterfaceWorst,
      schedulerDiagnostics: diagnostics.bridge?.schedulerDiagnostics,
    });
    this.noteCpuDegradedBridgePressure(diagnostics);
    this.maybeResyncTwoPartyTopologyFromLinkDiagnostics(diagnostics);
  }

  private noteCpuDegradedBridgePressure(
    diagnostics: GcallSendAudioDiagnostics
  ): void {
    const bridge = diagnostics.bridge;
    if (!bridge) return;
    const bridgeOldest = Math.max(
      diagnostics.pendingOldestAgeMs ?? 0,
      bridge.bridgeQueuedOldestAgeMs ?? 0,
      bridge.decodedQueueOldestAgeMs ?? 0,
      bridge.binaryOutQueueOldestAgeMs ?? 0
    );
    const dropsLast5s = Math.max(
      bridge.queuePressureDropsLast5s ?? 0,
      bridge.staleDropsLast5s ?? 0
    );
    if (
      bridgeOldest >= GCALL_CPU_DEGRADED_BRIDGE_OLDEST_SEVERE_MS ||
      dropsLast5s >= GCALL_CPU_DEGRADED_BRIDGE_DROPS_SEVERE
    ) {
      this.noteCpuDegradedPressure('outbound-bridge-pressure', 'severe', {
        bridgeQueuedOldestAgeMs: bridge.bridgeQueuedOldestAgeMs ?? null,
        decodedQueueOldestAgeMs: bridge.decodedQueueOldestAgeMs ?? null,
        binaryOutQueueOldestAgeMs: bridge.binaryOutQueueOldestAgeMs ?? null,
        pendingOldestAgeMs: diagnostics.pendingOldestAgeMs ?? null,
        queuePressureDropsLast5s: bridge.queuePressureDropsLast5s ?? null,
        staleDropsLast5s: bridge.staleDropsLast5s ?? null,
      });
      return;
    }
    if (
      bridgeOldest >= GCALL_CPU_DEGRADED_BRIDGE_OLDEST_MODERATE_MS ||
      dropsLast5s >= GCALL_CPU_DEGRADED_BRIDGE_DROPS_MODERATE ||
      bridge.bridgeWaitingForDrain === true
    ) {
      this.noteCpuDegradedPressure('outbound-bridge-pressure', 'moderate', {
        bridgeQueuedOldestAgeMs: bridge.bridgeQueuedOldestAgeMs ?? null,
        decodedQueueOldestAgeMs: bridge.decodedQueueOldestAgeMs ?? null,
        binaryOutQueueOldestAgeMs: bridge.binaryOutQueueOldestAgeMs ?? null,
        pendingOldestAgeMs: diagnostics.pendingOldestAgeMs ?? null,
        bridgeWaitingForDrain: bridge.bridgeWaitingForDrain === true,
        queuePressureDropsLast5s: bridge.queuePressureDropsLast5s ?? null,
        staleDropsLast5s: bridge.staleDropsLast5s ?? null,
      });
    }
  }

  private noteSenderEncodePressure(input: {
    workletToEncoderOutputMs: number;
    mainThreadToEncoderOutputMs: number;
  }): void {
    const totalMs = Math.max(0, input.workletToEncoderOutputMs);
    const encoderMs = Math.max(0, input.mainThreadToEncoderOutputMs);
    if (
      totalMs >= GCALL_CPU_DEGRADED_SENDER_TOTAL_SEVERE_MS ||
      encoderMs >= GCALL_CPU_DEGRADED_SENDER_ENCODER_SEVERE_MS
    ) {
      this.noteCpuDegradedPressure('sender-encode-delay', 'severe', {
        workletToEncoderOutputMs: totalMs,
        mainThreadToEncoderOutputMs: encoderMs,
      });
      return;
    }
    if (
      totalMs >= GCALL_CPU_DEGRADED_SENDER_TOTAL_MODERATE_MS ||
      encoderMs >= GCALL_CPU_DEGRADED_SENDER_ENCODER_MODERATE_MS
    ) {
      this.noteCpuDegradedPressure('sender-encode-delay', 'moderate', {
        workletToEncoderOutputMs: totalMs,
        mainThreadToEncoderOutputMs: encoderMs,
      });
    }
  }

  private noteCpuDegradedPressure(
    reason: string,
    severity: 'moderate' | 'severe',
    detail?: Record<string, unknown>
  ): void {
    const nowMs = Date.now();
    if (
      this.cpuDegradedLastPressureAtMs > 0 &&
      nowMs - this.cpuDegradedLastPressureAtMs >
        GCALL_CPU_DEGRADED_PRESSURE_RESET_MS
    ) {
      this.cpuDegradedPressureStartedAtMs = 0;
    }
    this.cpuDegradedLastPressureAtMs = nowMs;
    this.cpuDegradedHoldUntilMs = Math.max(
      this.cpuDegradedHoldUntilMs,
      nowMs +
        (severity === 'severe'
          ? GCALL_CPU_DEGRADED_SEVERE_HOLD_MS
          : GCALL_CPU_DEGRADED_MODERATE_HOLD_MS)
    );
    this.cpuDegradedLastReasons = [
      reason,
      ...this.cpuDegradedLastReasons.filter((entry) => entry !== reason),
    ].slice(0, 5);
    this.cpuDegradedLastDetail = {
      reason,
      severity,
      ...(detail ?? {}),
    };

    if (this.cpuDegradedActive) return;
    if (severity === 'severe') {
      this.setCpuDegradedActive(true, reason, this.cpuDegradedLastDetail);
      return;
    }
    if (this.cpuDegradedPressureStartedAtMs <= 0) {
      this.cpuDegradedPressureStartedAtMs = nowMs;
    }
    if (
      nowMs - this.cpuDegradedPressureStartedAtMs >=
      GCALL_CPU_DEGRADED_MODERATE_ENTER_MS
    ) {
      this.setCpuDegradedActive(true, reason, this.cpuDegradedLastDetail);
    }
  }

  private tickCpuDegradedMode(nowMs = Date.now()): void {
    if (
      this.cpuDegradedLastPressureAtMs > 0 &&
      nowMs - this.cpuDegradedLastPressureAtMs >
        GCALL_CPU_DEGRADED_PRESSURE_RESET_MS
    ) {
      this.cpuDegradedPressureStartedAtMs = 0;
    }
    if (!this.cpuDegradedActive) return;
    if (nowMs < this.cpuDegradedHoldUntilMs) return;
    if (
      nowMs - this.cpuDegradedLastPressureAtMs <
      GCALL_CPU_DEGRADED_CALM_EXIT_MS
    ) {
      return;
    }
    this.setCpuDegradedActive(false, 'calm-window', {
      lastPressureAtMs: this.cpuDegradedLastPressureAtMs || null,
    });
  }

  private setCpuDegradedActive(
    active: boolean,
    reason: string,
    detail?: Record<string, unknown> | null
  ): void {
    if (this.cpuDegradedActive === active) return;
    const nowMs = Date.now();
    this.cpuDegradedActive = active;
    if (active) {
      this.cpuDegradedEnteredAtMs = nowMs;
      this.cpuDegradedEntryCount++;
      this.recordDiagEvent('cpu-degraded-audio-entered', {
        reason,
        holdUntilMs: this.cpuDegradedHoldUntilMs,
        detail: detail ?? null,
      });
    } else {
      this.cpuDegradedEnteredAtMs = 0;
      this.cpuDegradedPressureStartedAtMs = 0;
      this.recordDiagEvent('cpu-degraded-audio-exited', {
        reason,
        detail: detail ?? null,
      });
    }
    this.queueSenderCpuModeSync();
  }

  private queueSenderCpuModeSync(): void {
    if (this.cpuDegradedSenderSyncQueued) return;
    this.cpuDegradedSenderSyncQueued = true;
    const run = () => {
      this.cpuDegradedSenderSyncQueued = false;
      void this.syncSenderState();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else void Promise.resolve().then(run);
  }

  private startRendererThreadMonitor(): void {
    if (this.rendererStallSampleTimer !== null) return;
    const nowPerf =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.rendererStallMonitorStartedAtMs = Date.now();
    this.rendererStallExpectedPerfMs =
      nowPerf + GCALL_RENDERER_STALL_SAMPLE_INTERVAL_MS;
    this.rendererStallSampleTimer = setInterval(() => {
      const actualPerf =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const delayMs = Math.max(
        0,
        actualPerf - this.rendererStallExpectedPerfMs
      );
      this.rendererStallExpectedPerfMs =
        actualPerf + GCALL_RENDERER_STALL_SAMPLE_INTERVAL_MS;
      this.rendererStallSampleCount++;
      this.tickCpuDegradedMode();
      if (delayMs < GCALL_RENDERER_STALL_DELAY_THRESHOLD_MS) return;
      this.rendererStallCount++;
      this.rendererStallMaxDelayMs = Math.max(
        this.rendererStallMaxDelayMs,
        delayMs
      );
      this.pushRendererThreadSample(this.rendererStallRecent, {
        atMs: Date.now(),
        startTime: actualPerf - delayMs,
        durationMs: delayMs,
        name: 'event-loop-lag',
      });
    }, GCALL_RENDERER_STALL_SAMPLE_INTERVAL_MS);

    this.startRendererLongTaskObserver();
  }

  private startRendererLongTaskObserver(): void {
    if (
      this.rendererLongTaskObserver !== null ||
      typeof PerformanceObserver === 'undefined'
    ) {
      return;
    }
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const durationMs = entry.duration;
          if (!Number.isFinite(durationMs) || durationMs <= 0) continue;
          this.rendererLongTaskSupported = true;
          this.rendererLongTaskCount++;
          this.rendererLongTaskMaxMs = Math.max(
            this.rendererLongTaskMaxMs,
            durationMs
          );
          this.pushRendererThreadSample(this.rendererLongTaskRecent, {
            atMs: Date.now(),
            startTime: entry.startTime,
            durationMs,
            name: entry.name || 'longtask',
          });
          if (durationMs >= GCALL_CPU_DEGRADED_LONG_TASK_SEVERE_MS) {
            this.noteCpuDegradedPressure('renderer-long-task', 'severe', {
              durationMs,
            });
          } else if (durationMs >= GCALL_CPU_DEGRADED_LONG_TASK_MODERATE_MS) {
            this.noteCpuDegradedPressure('renderer-long-task', 'moderate', {
              durationMs,
            });
          }
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      this.rendererLongTaskObserver = observer;
      this.rendererLongTaskSupported = true;
    } catch {
      this.rendererLongTaskObserver = null;
      this.rendererLongTaskSupported = false;
    }
  }

  private stopRendererThreadMonitor(): void {
    if (this.rendererStallSampleTimer !== null) {
      clearInterval(this.rendererStallSampleTimer);
      this.rendererStallSampleTimer = null;
    }
    this.rendererLongTaskObserver?.disconnect();
    this.rendererLongTaskObserver = null;
  }

  private pushRendererThreadSample(
    samples: RuntimeRendererThreadSample[],
    sample: RuntimeRendererThreadSample
  ): void {
    samples.push(sample);
    if (samples.length > GCALL_RENDERER_THREAD_RECENT_LIMIT) {
      samples.splice(0, samples.length - GCALL_RENDERER_THREAD_RECENT_LIMIT);
    }
  }

  private buildRendererThreadDiagnosticsSnapshot(): Record<string, unknown> {
    return {
      monitorActive: this.rendererStallSampleTimer !== null,
      monitorStartedAtMs: this.rendererStallMonitorStartedAtMs || null,
      sampleIntervalMs: GCALL_RENDERER_STALL_SAMPLE_INTERVAL_MS,
      stallThresholdMs: GCALL_RENDERER_STALL_DELAY_THRESHOLD_MS,
      eventLoopLag: {
        sampleCount: this.rendererStallSampleCount,
        count: this.rendererStallCount,
        maxDelayMs: this.rendererStallMaxDelayMs,
        recent: [...this.rendererStallRecent],
      },
      longTasks: {
        supported: this.rendererLongTaskSupported,
        observerActive: this.rendererLongTaskObserver !== null,
        count: this.rendererLongTaskCount,
        maxMs: this.rendererLongTaskMaxMs,
        recent: [...this.rendererLongTaskRecent],
      },
    };
  }

  private recordRecentWindowTrend(metrics: GroupCallMetricsSnapshot): void {
    const previous =
      this.recentWindowTrends[this.recentWindowTrends.length - 1] ?? null;
    const receiveDiagnostics: ReturnType<
      GroupCallAudioReceiveEngine['getDiagnosticsSnapshot']
    > | null =
      this.receiveEngine instanceof GroupCallAudioReceiveEngine
        ? this.receiveEngine.getDiagnosticsSnapshot()
        : null;
    const reasons: string[] = [];
    const missingFramesDelta = previous
      ? Math.max(0, metrics.missingFrames - previous.missingFrames)
      : 0;
    const concealmentTicksDelta = previous
      ? Math.max(0, metrics.concealmentTicks - previous.concealmentTicks)
      : 0;
    const packetsDroppedPendingDecryptDelta = previous
      ? Math.max(
          0,
          metrics.packetsDroppedPendingDecrypt -
            previous.packetsDroppedPendingDecrypt
        )
      : 0;
    const packetsDroppedDecodeFailureDelta = previous
      ? Math.max(
          0,
          metrics.packetsDroppedDecodeFailure -
            previous.packetsDroppedDecodeFailure
        )
      : 0;
    const reticulumAudioPacketPathTimeoutsDelta = previous
      ? Math.max(
          0,
          metrics.reticulumAudioPacketPathTimeouts -
            previous.reticulumAudioPacketPathTimeouts
        )
      : 0;
    const outboundSendFailuresDelta = previous
      ? Math.max(0, this.outboundSendFailures - previous.outboundSendFailures)
      : 0;
    const outboundNoTargetSkipsDelta = previous
      ? Math.max(
          0,
          this.outboundSkippedNoTargets - previous.outboundNoTargetSkips
        )
      : 0;
    if (
      previous &&
      previous.adaptiveNetworkMode !== 'recovery' &&
      metrics.adaptiveNetworkMode === 'recovery'
    ) {
      reasons.push('entered-recovery');
    }
    if (
      previous &&
      metrics.playoutUnderTargetFraction -
        previous.playoutUnderTargetFraction >=
        GCALL_CALL_QUALITY_WORSENED_UNDERTARGET_DELTA_MIN
    ) {
      reasons.push('under-target-spike');
    }
    if (
      previous &&
      missingFramesDelta >= GCALL_CALL_QUALITY_WORSENED_MISSING_DELTA_MIN
    ) {
      reasons.push('missing-frames-spike');
    }
    if (
      previous &&
      concealmentTicksDelta >= GCALL_CALL_QUALITY_WORSENED_CONCEALMENT_DELTA_MIN
    ) {
      reasons.push('concealment-spike');
    }
    if (
      previous &&
      previous.packetsDroppedDecodeFailure === 0 &&
      metrics.packetsDroppedDecodeFailure > 0
    ) {
      reasons.push('decode-failures-started');
    }
    if (
      previous &&
      previous.packetsDroppedPendingDecrypt === 0 &&
      metrics.packetsDroppedPendingDecrypt > 0
    ) {
      reasons.push('pending-decrypt-started');
    }
    if (
      previous &&
      previous.reticulumAudioPacketPathTimeouts === 0 &&
      metrics.reticulumAudioPacketPathTimeouts > 0
    ) {
      reasons.push('packet-path-timeouts-started');
    }

    this.recentWindowTrends.push({
      atMs: Date.now(),
      reason: reasons.length > 0 ? reasons : null,
      cpuDegradedActive: this.cpuDegradedActive,
      cpuDegradedReason: this.cpuDegradedLastReasons[0] ?? null,
      role: this.deriveTopologyRoleForAddress(this.userInfo?.address ?? ''),
      topologyEpoch: this.topology?.topologyEpoch ?? 0,
      adaptiveNetworkMode: metrics.adaptiveNetworkMode,
      avgPcmBufferedMs: metrics.avgPcmBufferedMs,
      playoutUnderTargetFraction: metrics.playoutUnderTargetFraction,
      playoutRateFractionBelow097: metrics.playoutRateFractionBelow097,
      missingFrames: metrics.missingFrames,
      missingFramesDelta,
      concealmentTicks: metrics.concealmentTicks,
      concealmentTicksDelta,
      packetsDroppedPendingDecrypt: metrics.packetsDroppedPendingDecrypt,
      packetsDroppedPendingDecryptDelta,
      packetsDroppedDecodeFailure: metrics.packetsDroppedDecodeFailure,
      packetsDroppedDecodeFailureDelta,
      reticulumAudioPacketPathTimeouts:
        metrics.reticulumAudioPacketPathTimeouts,
      reticulumAudioPacketPathTimeoutsDelta,
      reticulumAudioOutboundLinkSamples:
        metrics.reticulumAudioOutboundLinkSamples,
      reticulumAudioOutboundPacketSamples:
        metrics.reticulumAudioOutboundPacketSamples,
      reticulumAudioInboundLinkSamples:
        metrics.reticulumAudioInboundLinkSamples,
      reticulumAudioInboundPacketSamples:
        metrics.reticulumAudioInboundPacketSamples,
      outboundEncodedFrames: this.outboundEncodedFrameCallbacks,
      outboundSendAttempts: this.outboundSendAttempts,
      outboundSendSuccesses: this.outboundSendSuccesses,
      outboundSendFailures: this.outboundSendFailures,
      outboundSendFailuresDelta,
      outboundNoTargetSkips: this.outboundSkippedNoTargets,
      outboundNoTargetSkipsDelta,
      rendererStallCount: this.rendererStallCount,
      rendererStallMaxDelayMs: this.rendererStallMaxDelayMs,
      rendererLongTaskCount: this.rendererLongTaskCount,
      rendererLongTaskMaxMs: this.rendererLongTaskMaxMs,
      receiveProfiles: (
        receiveDiagnostics?.livePolicyProfilesBySource ?? []
      ).map(({ peerAddress, profile }) => ({
        peerAddress,
        profile,
      })),
      receivePlayouts: (receiveDiagnostics?.playouts ?? []).map((playout) => ({
        peerAddress: playout.peerAddress,
        jitterBufferedFrames: playout.jitterBufferedFrames,
        jitterHasReadyFrame: playout.jitterHasReadyFrame,
        jitterMaxEntries: playout.jitterMaxEntries,
        jitterPushAccepted: playout.jitterPushAccepted,
        jitterPushStale: playout.jitterPushStale,
        jitterPushDuplicate: playout.jitterPushDuplicate,
        jitterPushTrimmedFrames: playout.jitterPushTrimmedFrames,
        jitterPushTrimEvents: playout.jitterPushTrimEvents,
        jitterPushDepthHighWater: playout.jitterPushDepthHighWater,
        jitterLastTrimmedFrames: playout.jitterLastTrimmedFrames,
        jitterLastTrimAtMs: playout.jitterLastTrimAtMs,
        jitterBurstHeadroomLevel: playout.jitterBurstHeadroomLevel,
        jitterBurstHeadroomReason: playout.jitterBurstHeadroomReason,
        postBurstLatencyLockoutActive: playout.postBurstLatencyLockoutActive,
        postBurstLatencyLockoutUntilMs: playout.postBurstLatencyLockoutUntilMs,
        postBurstLatencyShedFrames: playout.postBurstLatencyShedFrames,
        lastPostBurstLatencyShedAtMs: playout.lastPostBurstLatencyShedAtMs,
        lastPostBurstLatencyShedFrames: playout.lastPostBurstLatencyShedFrames,
        liveLatencyGovernorShedFrames: playout.liveLatencyGovernorShedFrames,
        liveLatencyGovernorResetCount: playout.liveLatencyGovernorResetCount,
        lastLiveLatencyGovernorAtMs: playout.lastLiveLatencyGovernorAtMs,
        lastLiveLatencyGovernorReason: playout.lastLiveLatencyGovernorReason,
        burstGapResetCount: playout.burstGapResetCount,
        burstGapRecoveryCount: playout.burstGapRecoveryCount,
        burstGapDroppedFrames: playout.burstGapDroppedFrames,
        lastBurstGapMs: playout.lastBurstGapMs,
        lastBurstGapFrames: playout.lastBurstGapFrames,
        lastBurstGapDroppedFrames: playout.lastBurstGapDroppedFrames,
        lastBurstGapResetAtMs: playout.lastBurstGapResetAtMs,
        starvedBacklogDrainCount: playout.starvedBacklogDrainCount,
        starvedBacklogDrainFrames: playout.starvedBacklogDrainFrames,
        lastStarvedBacklogDrainAtMs: playout.lastStarvedBacklogDrainAtMs,
        lastStarvedBacklogDrainFrames: playout.lastStarvedBacklogDrainFrames,
        jitterDrainReadyTicks: playout.jitterDrainReadyTicks,
        jitterDrainReadyNoPopTicks: playout.jitterDrainReadyNoPopTicks,
        jitterDrainPoppedFrames: playout.jitterDrainPoppedFrames,
        lastJitterDrainBudget: playout.lastJitterDrainBudget,
        lastJitterDrainPoppedFrames: playout.lastJitterDrainPoppedFrames,
        pcmPostAcceptedFrames: playout.pcmPostAcceptedFrames,
        pcmPostRejectedFrames: playout.pcmPostRejectedFrames,
        pcmPostOverrunCount: playout.pcmPostOverrunCount,
        lastPcmPostRejectedAtMs: playout.lastPcmPostRejectedAtMs,
        audioGapAttributionCount: playout.audioGapAttributionCount,
        audioGapAttributionMaxFrames: playout.audioGapAttributionMaxFrames,
        audioGapAttributionLast: playout.audioGapAttributionLast,
        audioGapAttributionRecent: playout.audioGapAttributionRecent,
        wasmFecPipelineDiagnostics: playout.wasmFecPipelineDiagnostics,
        lastJitterAdaptiveMode: playout.lastJitterAdaptiveMode,
      })),
    });
    if (this.recentWindowTrends.length > MAX_RECENT_WINDOW_TRENDS) {
      this.recentWindowTrends.splice(
        0,
        this.recentWindowTrends.length - MAX_RECENT_WINDOW_TRENDS
      );
    }
    if (reasons.length > 0) {
      this.recordDiagEvent('call-quality-worsened', {
        reasons,
        adaptiveNetworkMode: metrics.adaptiveNetworkMode,
        playoutUnderTargetFraction: metrics.playoutUnderTargetFraction,
        missingFrames: metrics.missingFrames,
        missingFramesDelta,
        concealmentTicks: metrics.concealmentTicks,
        concealmentTicksDelta,
        packetsDroppedPendingDecrypt: metrics.packetsDroppedPendingDecrypt,
        packetsDroppedPendingDecryptDelta,
        packetsDroppedDecodeFailure: metrics.packetsDroppedDecodeFailure,
        packetsDroppedDecodeFailureDelta,
        reticulumAudioPacketPathTimeouts:
          metrics.reticulumAudioPacketPathTimeouts,
        reticulumAudioPacketPathTimeoutsDelta,
        receiveProfiles: receiveDiagnostics?.livePolicyProfilesBySource ?? [],
      });
    }
    this.tickCpuDegradedMode();
    this.maybeRequestZeroInboundMediaRecovery(metrics);
    this.maybeRequestLowInboundMediaRecovery(metrics);
  }

  private buildRecentWindowSummary(): Record<string, unknown> {
    const trends = this.recentWindowTrends;
    if (trends.length === 0) {
      return {
        sampleCount: 0,
        spanMs: 0,
      };
    }
    const first = trends[0];
    const last = trends[trends.length - 1];
    const profileCounts = new Map<string, number>();
    for (const trend of trends) {
      for (const profile of trend.receiveProfiles) {
        const key = `${profile.peerAddress}:${profile.profile}`;
        profileCounts.set(key, (profileCounts.get(key) ?? 0) + 1);
      }
    }
    return {
      sampleCount: trends.length,
      spanMs: Math.max(0, last.atMs - first.atMs),
      firstAtMs: first.atMs,
      lastAtMs: last.atMs,
      totalMissingFramesDelta: Math.max(
        0,
        last.missingFrames - first.missingFrames
      ),
      totalConcealmentTicksDelta: Math.max(
        0,
        last.concealmentTicks - first.concealmentTicks
      ),
      totalPendingDecryptDelta: Math.max(
        0,
        last.packetsDroppedPendingDecrypt - first.packetsDroppedPendingDecrypt
      ),
      totalDecodeFailureDelta: Math.max(
        0,
        last.packetsDroppedDecodeFailure - first.packetsDroppedDecodeFailure
      ),
      totalNoTargetSkipsDelta: Math.max(
        0,
        last.outboundNoTargetSkips - first.outboundNoTargetSkips
      ),
      maxAvgPcmBufferedMs: Math.max(
        ...trends.map((trend) => trend.avgPcmBufferedMs)
      ),
      minAvgPcmBufferedMs: Math.min(
        ...trends.map((trend) => trend.avgPcmBufferedMs)
      ),
      maxPlayoutUnderTargetFraction: Math.max(
        ...trends.map((trend) => trend.playoutUnderTargetFraction)
      ),
      maxPlayoutRateFractionBelow097: Math.max(
        ...trends.map((trend) => trend.playoutRateFractionBelow097)
      ),
      recoverySamples: trends.filter(
        (trend) => trend.adaptiveNetworkMode === 'recovery'
      ).length,
      profileSampleCounts: [...profileCounts.entries()].map(([key, count]) => {
        const separatorIndex = key.lastIndexOf(':');
        return {
          peerAddress: key.slice(0, separatorIndex),
          profile: key.slice(separatorIndex + 1),
          count,
        };
      }),
    };
  }

  private getMediaRecoveryTargets(): string[] {
    if (!this.topology || !this.userInfo?.address) return [];
    const myAddress = this.userInfo.address;
    const transportTargets = getReticulumTransportTargets(
      myAddress,
      this.topology
    )
      .map((address) => address.trim())
      .filter((address) => address && address !== myAddress);
    const targets =
      transportTargets.length > 0
        ? transportTargets
        : this.snapshot.participants
            .map((participant) => participant.address?.trim() ?? '')
            .filter((address) => address && address !== myAddress);
    return this.filterBootstrapOnlyMediaTargets([...new Set(targets)]);
  }

  private getMediaTargetSettleAnchorMs(address: string): number {
    const firstAttemptAtMs =
      this.outboundTargetDiagnostics.get(address)?.firstAttemptAtMs ?? 0;
    return Math.max(this.lastJoinSuccessAtMs, firstAttemptAtMs);
  }

  private getMediaTargetSettleAgeMs(address: string, now: number): number {
    const anchorMs = this.getMediaTargetSettleAnchorMs(address);
    return anchorMs > 0 ? now - anchorMs : Number.POSITIVE_INFINITY;
  }

  private maybeRequestZeroInboundMediaRecovery(
    metrics: GroupCallMetricsSnapshot
  ): void {
    if (
      this.snapshot.roomState !== 'connected' ||
      !this.snapshot.roomId ||
      !this.roomKey ||
      !this.topology ||
      !this.userInfo?.address ||
      metrics.packetsReceived > 0 ||
      this.outboundSendSuccesses <
        ZERO_INBOUND_MEDIA_RECOVERY_MIN_OUTBOUND_FRAMES
    ) {
      return;
    }
    const requestPeerMediaRecovery = window.groupCall?.requestPeerMediaRecovery;
    if (typeof requestPeerMediaRecovery !== 'function') {
      this.recordMediaRecoveryApiUnavailable('zero-inbound-media-recovery');
      return;
    }
    const uniqueTargets = this.getMediaRecoveryTargets();
    if (uniqueTargets.length === 0) return;
    const now = Date.now();
    for (const address of uniqueTargets) {
      const settleAgeMs = this.getMediaTargetSettleAgeMs(address, now);
      if (settleAgeMs < LOW_INBOUND_MEDIA_RECOVERY_STARTUP_GRACE_MS) {
        this.recordThrottledDiagEvent(
          'zero-inbound-media-recovery-suppressed-startup',
          `${this.snapshot.roomId}:${address}`,
          {
            roomId: this.snapshot.roomId,
            peerAddress: address,
            settleAgeMs,
            graceMs: LOW_INBOUND_MEDIA_RECOVERY_STARTUP_GRACE_MS,
            outboundSendSuccesses: this.outboundSendSuccesses,
            packetsReceived: metrics.packetsReceived,
          }
        );
        continue;
      }
      const lastAt =
        this.zeroInboundMediaRecoveryLastAtByAddress.get(address) ?? 0;
      if (
        lastAt > 0 &&
        now - lastAt < ZERO_INBOUND_MEDIA_RECOVERY_COOLDOWN_MS
      ) {
        continue;
      }
      this.zeroInboundMediaRecoveryLastAtByAddress.set(address, now);
      this.recordDiagEvent('zero-inbound-media-recovery-requested', {
        roomId: this.snapshot.roomId,
        peerAddress: address,
        outboundSendSuccesses: this.outboundSendSuccesses,
        packetsReceived: metrics.packetsReceived,
        reason: 'path-degraded-warm',
      });
      void requestPeerMediaRecovery(
        this.snapshot.roomId,
        address,
        'path-degraded-warm'
      ).catch(() => {});
    }
  }

  private maybeRequestLowInboundMediaRecovery(
    metrics: GroupCallMetricsSnapshot
  ): void {
    if (
      this.snapshot.roomState !== 'connected' ||
      !this.snapshot.roomId ||
      !this.roomKey ||
      !this.topology ||
      !this.userInfo?.address ||
      metrics.packetsReceived <= 0 ||
      this.outboundSendSuccesses <
        LOW_INBOUND_MEDIA_RECOVERY_MIN_OUTBOUND_FRAMES
    ) {
      return;
    }
    const inboundToOutboundRatio =
      metrics.packetsReceived / Math.max(1, this.outboundSendSuccesses);
    const receiveDamage =
      metrics.playoutUnderTargetFraction >=
        LOW_INBOUND_MEDIA_RECOVERY_UNDERTARGET_MIN ||
      metrics.playoutRateFractionBelow097 >=
        LOW_INBOUND_MEDIA_RECOVERY_RATE_BELOW_097_MIN ||
      metrics.concealmentTicks >= LOW_INBOUND_MEDIA_RECOVERY_CONCEALMENT_MIN;
    const burstyInboundDamage =
      (metrics.maxIncomingPacketMs >=
        BURSTY_INBOUND_MEDIA_RECOVERY_MAX_INCOMING_PACKET_MS ||
        metrics.maxReticulumAudioBridgeToRendererIngressMs >=
          BURSTY_INBOUND_MEDIA_RECOVERY_MAX_BRIDGE_TO_RENDERER_MS) &&
      (metrics.concealmentTicks >=
        BURSTY_INBOUND_MEDIA_RECOVERY_CONCEALMENT_MIN ||
        metrics.missingFrames >=
          BURSTY_INBOUND_MEDIA_RECOVERY_MISSING_FRAMES_MIN);
    if (
      !burstyInboundDamage &&
      (inboundToOutboundRatio >
        LOW_INBOUND_MEDIA_RECOVERY_MAX_INBOUND_TO_OUTBOUND_RATIO ||
        !receiveDamage)
    ) {
      return;
    }
    const requestPeerMediaRecovery = window.groupCall?.requestPeerMediaRecovery;
    if (typeof requestPeerMediaRecovery !== 'function') {
      this.recordMediaRecoveryApiUnavailable('low-inbound-media-recovery');
      return;
    }
    const uniqueTargets = this.getMediaRecoveryTargets();
    if (uniqueTargets.length === 0) return;
    const now = Date.now();
    if (
      this.lastJoinSuccessAtMs > 0 &&
      now - this.lastJoinSuccessAtMs <
        LOW_INBOUND_MEDIA_RECOVERY_STARTUP_GRACE_MS
    ) {
      this.recordThrottledDiagEvent(
        'low-inbound-media-recovery-suppressed-startup',
        `${this.snapshot.roomId}`,
        {
          roomId: this.snapshot.roomId,
          sinceJoinMs: now - this.lastJoinSuccessAtMs,
          graceMs: LOW_INBOUND_MEDIA_RECOVERY_STARTUP_GRACE_MS,
          outboundSendSuccesses: this.outboundSendSuccesses,
          packetsReceived: metrics.packetsReceived,
          inboundToOutboundRatio,
          concealmentTicks: metrics.concealmentTicks,
          missingFrames: metrics.missingFrames,
        }
      );
      return;
    }
    for (const address of uniqueTargets) {
      const lastAt =
        this.zeroInboundMediaRecoveryLastAtByAddress.get(address) ?? 0;
      if (
        lastAt > 0 &&
        now - lastAt < ZERO_INBOUND_MEDIA_RECOVERY_COOLDOWN_MS
      ) {
        continue;
      }
      this.zeroInboundMediaRecoveryLastAtByAddress.set(address, now);
      this.recordDiagEvent('low-inbound-media-recovery-requested', {
        roomId: this.snapshot.roomId,
        peerAddress: address,
        outboundSendSuccesses: this.outboundSendSuccesses,
        packetsReceived: metrics.packetsReceived,
        inboundToOutboundRatio,
        playoutUnderTargetFraction: metrics.playoutUnderTargetFraction,
        playoutRateFractionBelow097: metrics.playoutRateFractionBelow097,
        concealmentTicks: metrics.concealmentTicks,
        missingFrames: metrics.missingFrames,
        maxIncomingPacketMs: metrics.maxIncomingPacketMs,
        maxReticulumAudioBridgeToRendererIngressMs:
          metrics.maxReticulumAudioBridgeToRendererIngressMs,
        burstyInboundDamage,
        reason: 'path-degraded-warm',
      });
      void requestPeerMediaRecovery(
        this.snapshot.roomId,
        address,
        'path-degraded-warm'
      ).catch(() => {});
    }
  }

  private recordMediaRecoveryApiUnavailable(context: string): void {
    const now = Date.now();
    if (
      this.mediaRecoveryApiUnavailableLastAtMs > 0 &&
      now - this.mediaRecoveryApiUnavailableLastAtMs <
        ZERO_INBOUND_MEDIA_RECOVERY_COOLDOWN_MS
    ) {
      return;
    }
    this.mediaRecoveryApiUnavailableLastAtMs = now;
    this.recordDiagEvent('media-recovery-api-unavailable', {
      context,
      hasGroupCallApi: !!window.groupCall,
    });
  }

  private buildAudioSurfaceRuntimeDiagnosticsSnapshot(): Record<
    string,
    unknown
  > {
    const topology = this.topology;
    const myAddress = this.userInfo?.address ?? '';
    const role = topology
      ? computeGroupCallRole(myAddress, topology)
      : 'listener';
    const receiveEngine = this.receiveEngine.getDiagnosticsSnapshot();
    const senderEngine = this.senderEngine.getDiagnosticsSnapshot();
    const rootPeerLiveness = this.getRootPeerLivenessSnapshot();
    const decodePaths = [
      ...new Set(receiveEngine.playouts.map((playout) => playout.decodePath)),
    ];
    const sharedRingEnabled = receiveEngine.playouts.some(
      (playout) => playout.sharedRingEnabled
    );
    return {
      pipelineMode: {
        crossOriginIsolated:
          typeof window !== 'undefined'
            ? window.crossOriginIsolated === true
            : false,
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
        forwardRecipientCount: this.getForwardRecipientCount(),
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
      rootPeerLiveness,
      rootAuthorityState: {
        trustedRemoteRoot: this.trustedRemoteRoot || null,
        trustedRemoteRootLastSeenAtMs: this.trustedRemoteRootLastSeenAt,
        conflictingRemoteRoot:
          this.getConflictingRemoteRootForAuthorityWait() ?? null,
        conflictingRemoteRootLastSeenAtMs: this.conflictingRemoteRootLastSeenAt,
        authoritySettleUntilMs: this.authoritySettleUntilMs,
        authoritySettleRemainingMs:
          this.authoritySettleUntilMs > 0
            ? Math.max(0, this.authoritySettleUntilMs - Date.now())
            : 0,
      },
      receiveEngine,
      senderEngine,
      senderEncodePipeline: (senderEngine.senderEncodeSummary as Record<
        string,
        unknown
      >) ?? {
        mode: senderEngine.senderEncodeMode ?? 'unknown',
      },
      cpuDegradedAudio: {
        active: this.cpuDegradedActive,
        senderOnly: true,
        enteredAtMs: this.cpuDegradedEnteredAtMs || null,
        holdUntilMs: this.cpuDegradedHoldUntilMs || null,
        lastPressureAtMs: this.cpuDegradedLastPressureAtMs || null,
        entryCount: this.cpuDegradedEntryCount,
        reasons: [...this.cpuDegradedLastReasons],
        lastDetail: this.cpuDegradedLastDetail,
      },
      rendererThread: this.buildRendererThreadDiagnosticsSnapshot(),
      audioStageTiming: this.buildAudioStageTimingDiagnostics(),
      outboundMedia: this.buildOutboundMediaDiagnosticsSnapshot(),
      keyExchange: this.buildKeyExchangeDiagnosticsSnapshot(),
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
    const myRole = this.deriveTopologyRoleForAddress(
      this.userInfo?.address ?? ''
    );
    const participants = this.withTopologyRoles(snapshot.participants);
    const metrics = this.withTopologyMetrics(snapshot.metrics, myRole);
    const myAddress = this.userInfo?.address ?? '';
    let mediaViable = true;
    if (snapshot.roomState === 'connected') {
      const roomKeyPresent = this.roomKey !== null;
      const remoteOthers = participants.filter(
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
      myRole,
      participants,
      metrics,
      mediaViable,
      localConnectionHint,
      topologyLabel: 'Reticulum',
    };
  }

  private deriveTopologyRoleForAddress(address: string): AudioEngineRole {
    if (!address || !this.topology) return 'participant';
    return computeGroupCallRole(address, this.topology);
  }

  private withTopologyRoles(
    participants: AudioEngineParticipant[]
  ): AudioEngineParticipant[] {
    return participants.map((participant) => ({
      ...participant,
      role: this.deriveTopologyRoleForAddress(participant.address),
    }));
  }

  private markParticipantRecentlyLeft(
    addressValue: string | null | undefined
  ): void {
    const address = addressValue?.trim() ?? '';
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!address || address === myAddress) return;
    this.recentlyLeftParticipantsUntilMs.set(
      address,
      Date.now() + RECENTLY_LEFT_PARTICIPANT_SUPPRESS_MS
    );
  }

  private clearRecentLeftParticipant(
    addressValue: string | null | undefined
  ): void {
    const address = addressValue?.trim() ?? '';
    if (!address) return;
    this.recentlyLeftParticipantsUntilMs.delete(address);
  }

  private shouldSuppressRecentlyLeftParticipant(addressValue: string): boolean {
    const address = addressValue.trim();
    if (!address) return false;
    const untilMs = this.recentlyLeftParticipantsUntilMs.get(address) ?? 0;
    if (untilMs <= 0) return false;
    if (Date.now() >= untilMs) {
      this.recentlyLeftParticipantsUntilMs.delete(address);
      return false;
    }
    return true;
  }

  private getParticipantJoinIdentity(
    joinGeneration?: number,
    timestamp?: number
  ): string | null {
    if (typeof joinGeneration === 'number' && Number.isFinite(joinGeneration)) {
      return `gen:${joinGeneration >>> 0}`;
    }
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      return `ts:${Math.trunc(timestamp)}`;
    }
    return null;
  }

  private async resetReceiveStateForParticipant(
    addressValue: string | null | undefined,
    reason: string
  ): Promise<void> {
    const address = addressValue?.trim() ?? '';
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!address || address === myAddress) return;
    this.activeSpeakerLastSeenAt.delete(address);
    this.participantDecodedMediaLastSeenAt.delete(address);
    this.participantLiveEvidenceLastSeenAt.delete(address);
    this.decryptPool?.clearLastPlayedSeq(address);
    await this.receiveEngine.removeSource(address);
    this.recordDiagEvent('participant-receive-state-reset', {
      roomId: this.snapshot.roomId,
      peer: truncateGcallDiagAddress(address),
      reason,
    });
  }

  private async resetReceiveStateForFreshParticipantJoin(
    addressValue: string | null | undefined,
    joinGeneration?: number,
    timestamp?: number
  ): Promise<void> {
    const address = addressValue?.trim() ?? '';
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!address || address === myAddress) return;
    const joinIdentity = this.getParticipantJoinIdentity(
      joinGeneration,
      timestamp
    );
    if (!joinIdentity) return;
    const previousJoinIdentity =
      this.participantJoinIdentityByAddress.get(address) ?? null;
    if (previousJoinIdentity === joinIdentity) return;
    this.participantJoinIdentityByAddress.set(address, joinIdentity);
    if (!previousJoinIdentity && !this.receiveEngine.hasSource(address)) return;
    await this.resetReceiveStateForParticipant(
      address,
      'fresh-participant-join'
    );
  }

  private mergeParticipantsFromTopology(
    participants: AudioEngineParticipant[],
    topology: GroupCallTopology
  ): AudioEngineParticipant[] {
    const nextByAddress = new Map<string, AudioEngineParticipant>();
    const ensureParticipant = (address: string, publicKey = ''): void => {
      const normalizedAddress = address.trim();
      if (!normalizedAddress || nextByAddress.has(normalizedAddress)) return;
      if (this.shouldSuppressRecentlyLeftParticipant(normalizedAddress)) return;
      nextByAddress.set(normalizedAddress, {
        address: normalizedAddress,
        publicKey,
        speaking: false,
        role: 'participant',
      });
    };
    for (const participant of participants) {
      const address = participant.address?.trim() ?? '';
      if (!address) continue;
      if (this.shouldSuppressRecentlyLeftParticipant(address)) continue;
      nextByAddress.set(address, participant);
    }
    const myAddress = this.userInfo?.address?.trim() ?? '';
    ensureParticipant(myAddress, this.userInfo?.publicKey ?? '');
    ensureParticipant(topology.rootForwarder);
    ensureParticipant(topology.standbyForwarder);
    for (const cluster of topology.clusters) {
      ensureParticipant(cluster.forwarder);
      ensureParticipant(cluster.standby);
      ensureParticipant(cluster.standby2 ?? '');
      for (const address of cluster.members) {
        ensureParticipant(address ?? '');
      }
    }
    return [...nextByAddress.values()];
  }

  private upsertParticipantFromRuntimeEvent(
    addressValue: string | null | undefined,
    publicKeyValue?: string | null
  ): void {
    const address = addressValue?.trim() ?? '';
    if (!address) return;
    this.bootstrapOnlyParticipantAddresses.delete(address);
    const existing = this.snapshot.participants.find(
      (participant) => participant.address === address
    );
    const publicKey = publicKeyValue?.trim() ?? '';
    if (existing) {
      this.clearRecentLeftParticipant(address);
      if (!publicKey || existing.publicKey === publicKey) return;
      this.snapshot = {
        ...this.snapshot,
        participants: this.snapshot.participants.map((participant) =>
          participant.address === address
            ? { ...participant, publicKey }
            : participant
        ),
      };
      this.emitSnapshot();
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      participants: this.withTopologyRoles([
        ...this.snapshot.participants,
        {
          address,
          publicKey,
          speaking: false,
          role: 'participant',
        },
      ]),
    };
    this.clearRecentLeftParticipant(address);
    this.emitSnapshot();
  }

  private removeParticipantFromRuntimeEvent(
    addressValue: string | null | undefined
  ): void {
    const address = addressValue?.trim() ?? '';
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!address || address === myAddress) return;
    this.markParticipantRecentlyLeft(address);
    this.participantDecodedMediaLastSeenAt.delete(address);
    this.participantLiveEvidenceLastSeenAt.delete(address);
    this.bootstrapOnlyParticipantAddresses.delete(address);
    const nextParticipants = this.snapshot.participants.filter(
      (participant) => participant.address !== address
    );
    if (nextParticipants.length === this.snapshot.participants.length) return;
    this.snapshot = {
      ...this.snapshot,
      participants: this.withTopologyRoles(nextParticipants),
    };
    this.emitSnapshot();
  }

  private getForwardRecipientCount(): number {
    if (!this.topology || !this.userInfo?.address) return 0;
    return getReticulumTransportTargets(this.userInfo.address, this.topology)
      .length;
  }

  private withTopologyMetrics(
    metrics: GroupCallControllerSnapshot['metrics'],
    myRole: AudioEngineRole
  ): GroupCallControllerSnapshot['metrics'] {
    return {
      ...metrics,
      role: myRole,
      topologyRole: myRole,
      forwardRecipientCount: this.getForwardRecipientCount(),
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
    const derivedSnapshot = this.withDerivedSnapshotState(this.snapshot);
    this.snapshot = derivedSnapshot;
    const liveMetricsSnapshot = derivedSnapshot.metrics;
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
      authoritySnapshot: this.buildAuthoritySnapshot(),
      liveMetricsSnapshot,
      exportWindowMetrics: liveMetricsSnapshot,
      recentWindowSummary: this.buildRecentWindowSummary(),
      recentWindowTrends: [...this.recentWindowTrends],
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
    traceGcallAudioSurface(
      'pipeline: subscribing groupCall.onEvent (gcall:audio, gcall:key, …)',
      {}
    );
    this.unsubscribeGroupCallEvents = window.groupCall.onEvent(
      (event, payload) => {
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
      }
    );
  }

  private async joinGroupCall(
    roomId: string,
    chatId: string,
    options?: AudioEngineJoinOptions
  ): Promise<AudioSurfaceResponse> {
    this.startRendererThreadMonitor();
    this.recordDiagEvent('join-start', { roomId, chatId });
    traceGcallAudioSurface('engine.joinGroupCall: start', {
      roomId,
      chatId,
      hasUser: Boolean(this.userInfo?.address),
    });
    const userInfo = this.userInfo;
    if (!userInfo?.address || !userInfo?.publicKey) {
      traceGcallAudioSurface(
        'engine.joinGroupCall: fail missing user in engine',
        {}
      );
      this.snapshot = buildJoinFailureSnapshot(this.snapshot, 'not_ready');
      this.emitSnapshot();
      return { ok: false, error: 'missing-user' };
    }
    if (roomId.startsWith('gcall-qortal-') && this.myStatus === 'offline') {
      traceGcallAudioSurface('engine.joinGroupCall: fail presence_offline', {});
      this.snapshot = buildJoinFailureSnapshot(
        this.snapshot,
        'presence_offline'
      );
      this.emitSnapshot();
      return { ok: false, error: 'presence_offline' };
    }
    this.currentChatId = chatId;
    this.callEpochMs = Date.now();
    this.seq = 0;
    this.roomKey = null;
    this.appliedRoomKeyCommitment = '';
    this.ownsRoomKey = false;
    this.selfMintedRoomKey = false;
    this.awaitingAuthoritativeKey = false;
    this.resetWorkerDecodeFailureRecoveryState();
    this.callSessionId = '';
    this.mediaSessionGeneration = 1;
    this.topology = null;
    this.lastObservedTopologyEpoch = 0;
    this.resetRootAuthorityTracking();
    this.resetRootPeerLiveness();
    this.topologyElectionDelayUntilMs = 0;
    this.startupOccupiedRoomEvidence = false;
    this.startupHydratedRemoteCount = 0;
    this.startupBootstrapHasTopology = false;
    this.lastJoinSuccessAtMs = 0;
    this.clearProvisionalLocalRoot();
    this.memberGateGroupId =
      options?.memberGateGroupId != null &&
      Number.isFinite(options.memberGateGroupId)
        ? Math.floor(Number(options.memberGateGroupId))
        : null;
    this.electionDigestCache.clear();
    this.stopTopologyHeartbeat();
    this.clearRootFailoverTimer();
    this.clearTopologyElectionTimer();
    this.clearKeyRecoveryRetryTimer();
    this.clearRoomKeyDistributionRetryTimer();
    this.clearTargetedRoomKeyReplayRetries();
    this.clearSenderSyncRetryTimer();
    this.clearActiveSpeakerRefreshTimer();
    this.clearMemberGateRefreshTimer();
    this.clearParticipantRosterRefreshTimer();
    this.clearHeldIncomingAudio();
    this.clearRecentWindowTrends();
    this.throttledDiagEvents.clear();
    this.zeroInboundMediaRecoveryLastAtByAddress.clear();
    this.resetOutboundMediaDiagnostics();
    this.lastAwaitingAuthoritativeKeyFailureLogAt = 0;
    this.activeSpeakerLastSeenAt.clear();
    this.participantDecodedMediaLastSeenAt.clear();
    this.participantLiveEvidenceLastSeenAt.clear();
    this.liveEvidenceTopologyElectionLastAt.clear();
    this.bootstrapOnlyParticipantAddresses.clear();
    this.bootstrapOnlyMediaTargetSkipLastDiagAt = 0;
    this.startupMediaTargetWaitLastDiagAt = 0;
    this.recentlyLeftParticipantsUntilMs.clear();
    this.participantJoinIdentityByAddress.clear();
    this.participantRosterMissingSinceMs.clear();
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
    traceGcallAudioSurface(
      'engine.joinGroupCall: step ensureGroupCallSubscription done',
      {}
    );
    traceGcallAudioSurface(
      'engine.joinGroupCall: step before senderEngine.stop',
      {}
    );
    await this.senderEngine.stop();
    traceGcallAudioSurface(
      'engine.joinGroupCall: step after senderEngine.stop',
      {}
    );
    traceGcallAudioSurface(
      'engine.joinGroupCall: step before syncDecryptPoolRoomKey',
      {}
    );
    await this.syncDecryptPoolRoomKey(null);
    traceGcallAudioSurface(
      'engine.joinGroupCall: step after syncDecryptPoolRoomKey',
      {}
    );
    traceGcallAudioSurface(
      'engine.joinGroupCall: step before receiveEngine.reset',
      {}
    );
    await this.receiveEngine.reset();
    await this.receiveEngine.configure({
      postFailoverRootHoldUntilMs: 0,
    });
    traceGcallAudioSurface(
      'engine.joinGroupCall: step after receiveEngine.reset',
      {}
    );
    this.snapshot = buildJoiningSnapshot({
      current: this.snapshot,
      roomId,
      user: userInfo,
      options,
    });
    this.emitSnapshot();
    traceGcallAudioSurface(
      'engine.joinGroupCall: step after buildJoiningSnapshot + emitSnapshot',
      {
        roomState: this.snapshot.roomState,
      }
    );

    traceGcallAudioSurface(
      'engine.joinGroupCall: step before setLocalAddresses',
      {}
    );
    await window.groupCall?.setLocalAddresses?.([userInfo.address], 'group');
    traceGcallAudioSurface(
      'engine.joinGroupCall: step after setLocalAddresses',
      {}
    );
    await this.syncQortalGroupReticulumTargets(roomId, options);
    this.startMemberGateRefresh(roomId);
    this.startParticipantRosterRefresh(roomId);
    const joinGeneration =
      (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) >>> 0;
    traceGcallAudioSurface(
      'engine.joinGroupCall: step before fetchLocalReticulumDestinationHash',
      {}
    );
    const reticulumDestinationHash = await fetchLocalReticulumDestinationHash();
    traceGcallAudioSurface(
      'engine.joinGroupCall: step after fetchLocalReticulumDestinationHash',
      {
        hasHash: Boolean(reticulumDestinationHash),
      }
    );
    if (!reticulumDestinationHash) {
      traceGcallAudioSurface(
        'engine.joinGroupCall: fail reticulum_not_ready (no local destination hash)',
        {}
      );
      this.snapshot = buildJoinFailureSnapshot(
        this.snapshot,
        'reticulum_not_ready'
      );
      this.emitSnapshot();
      return { ok: false, error: 'reticulum_not_ready' };
    }
    traceGcallAudioSurface(
      'engine.joinGroupCall: step before fetchLocalReticulumIdentityPublicKeyBase64',
      {}
    );
    const reticulumIdentityPublicKeyBase64 =
      await fetchLocalReticulumIdentityPublicKeyBase64();
    traceGcallAudioSurface(
      'engine.joinGroupCall: step after fetchLocalReticulumIdentityPublicKeyBase64',
      {
        hasKey: Boolean(reticulumIdentityPublicKeyBase64),
      }
    );
    const timestamp = Date.now();
    traceGcallAudioSurface(
      'engine.joinGroupCall: step before signReticulumJoinSplit',
      {}
    );
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
    traceGcallAudioSurface(
      'engine.joinGroupCall: step after signReticulumJoinSplit',
      {
        hasJoinSig: Boolean(signed?.joinSig),
      }
    );
    if (!signed?.joinSig) {
      this.snapshot = buildJoinFailureSnapshot(
        this.snapshot,
        'join_sign_failed'
      );
      this.emitSnapshot();
      return { ok: false, error: 'join_sign_failed' };
    }
    const joinFn = window.groupCall?.join;
    if (typeof joinFn !== 'function') {
      traceGcallAudioSurface(
        'engine.joinGroupCall: window.groupCall.join missing',
        {}
      );
      this.snapshot = buildJoinFailureSnapshot(
        this.snapshot,
        'groupcall_api_missing'
      );
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
    traceGcallAudioSurface(
      'engine.joinGroupCall: step before gcall:join (Promise.race)',
      {
        joinGeneration,
      }
    );
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
      traceGcallAudioSurface(
        'engine.joinGroupCall: step after gcall:join (Promise.race settled)',
        {
          success: result?.success,
        }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'gcall-join-failed';
      traceGcallAudioSurface('engine.joinGroupCall: join race failed', { msg });
      this.snapshot = buildJoinFailureSnapshot(this.snapshot, msg);
      this.emitSnapshot();
      return { ok: false, error: msg };
    }
    if (!result?.success) {
      const err = result?.error ?? 'join_failed';
      traceGcallAudioSurface(
        'engine.joinGroupCall: main join returned failure',
        { error: err }
      );
      this.snapshot = buildJoinFailureSnapshot(this.snapshot, err);
      this.emitSnapshot();
      return { ok: false, error: err };
    }
    traceGcallAudioSurface('engine.joinGroupCall: success', { roomId });
    const joinSuccessAtMs = Date.now();
    this.lastJoinSuccessAtMs = joinSuccessAtMs;
    this.recordDiagEvent('join-success', { roomId, joinSuccessAtMs });
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
    const roomId = this.snapshot.roomId;
    if (!userInfo?.address || !roomId) {
      return { ok: true };
    }
    const localAddress = userInfo.address;
    const publicKey = userInfo.publicKey ?? '';
    const timestamp = Date.now();
    const cleanupGeneration = ++this.leaveCleanupGeneration;

    this.roomKey = null;
    this.appliedRoomKeyCommitment = '';
    this.ownsRoomKey = false;
    this.selfMintedRoomKey = false;
    this.awaitingAuthoritativeKey = false;
    this.resetWorkerDecodeFailureRecoveryState();
    this.callSessionId = '';
    this.mediaSessionGeneration = 1;
    this.topology = null;
    this.lastObservedTopologyEpoch = 0;
    this.resetRootAuthorityTracking();
    this.resetRootPeerLiveness();
    this.topologyElectionDelayUntilMs = 0;
    this.seq = 0;
    this.shouldReplayRetainedKeysAfterNextTopology = false;
    this.lastJoinSuccessAtMs = 0;
    this.stopTopologyHeartbeat();
    this.clearRootFailoverTimer();
    this.clearTopologyElectionTimer();
    this.clearKeyRecoveryRetryTimer();
    this.clearRoomKeyDistributionRetryTimer();
    this.clearTargetedRoomKeyReplayRetries();
    this.clearSenderSyncRetryTimer();
    this.clearActiveSpeakerRefreshTimer();
    this.clearMemberGateRefreshTimer();
    this.clearParticipantRosterRefreshTimer();
    this.clearHeldIncomingAudio();
    this.clearRecentWindowTrends();
    this.throttledDiagEvents.clear();
    this.resetOutboundMediaDiagnostics();
    this.lastAwaitingAuthoritativeKeyFailureLogAt = 0;
    this.memberGateGroupId = null;
    this.activeSpeakerLastSeenAt.clear();
    this.participantDecodedMediaLastSeenAt.clear();
    this.participantLiveEvidenceLastSeenAt.clear();
    this.liveEvidenceTopologyElectionLastAt.clear();
    this.bootstrapOnlyParticipantAddresses.clear();
    this.bootstrapOnlyMediaTargetSkipLastDiagAt = 0;
    this.startupMediaTargetWaitLastDiagAt = 0;
    this.recentlyLeftParticipantsUntilMs.clear();
    this.participantJoinIdentityByAddress.clear();
    this.participantRosterMissingSinceMs.clear();
    this.connectionHintBadSince = null;
    this.connectionHintGoodSince = null;
    this.connectionHintSevereSince = null;
    this.snapshot = buildPostLeaveSnapshot(this.snapshot);
    this.emitSnapshot();
    resetGcallAudioPipelineSessionStats();
    this.recordDiagEvent('local-leave-applied', { roomId });

    const signature = await signGroupCallFields({
      type: 'GC_LEAVE',
      roomId,
      fromAddress: localAddress,
      fromPublicKey: publicKey,
      timestamp,
    }).catch(() => '');
    void this.notifyMainOfLeave(
      roomId,
      localAddress,
      publicKey,
      timestamp,
      signature
    );
    void this.cleanupMediaAfterLeave(cleanupGeneration, roomId);

    return { ok: true };
  }

  private async notifyMainOfLeave(
    roomId: string,
    localAddress: string,
    publicKey: string,
    timestamp: number,
    signature: string
  ): Promise<void> {
    try {
      await Promise.race([
        window.groupCall?.leave?.(
          roomId,
          localAddress,
          signature,
          publicKey,
          timestamp
        ) ??
          Promise.resolve({ success: false, error: 'groupcall-api-missing' }),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('gcall-leave-ipc-timeout-5s')),
            5_000
          );
        }),
      ]);
      this.recordDiagEvent('main-leave-sent', { roomId });
    } catch (error) {
      const fallback = window.groupCall?.leaveSync?.(
        roomId,
        localAddress,
        signature,
        publicKey,
        timestamp
      );
      this.recordDiagEvent('main-leave-failed', {
        roomId,
        error: error instanceof Error ? error.message : 'unknown',
        syncFallbackSuccess: fallback?.success === true,
        syncFallbackError: fallback?.error,
      });
    }
  }

  private async leaveCleanupStep(
    label: string,
    task: Promise<unknown>
  ): Promise<void> {
    try {
      await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`${label}-timeout-5s`)), 5_000);
        }),
      ]);
    } catch (error) {
      this.recordDiagEvent('leave-cleanup-step-failed', {
        step: label,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  private async cleanupMediaAfterLeave(
    cleanupGeneration: number,
    roomId: string
  ): Promise<void> {
    const stillCurrent = (): boolean =>
      cleanupGeneration === this.leaveCleanupGeneration &&
      !this.snapshot.roomId;
    await this.leaveCleanupStep('sender-stop', this.senderEngine.stop());
    if (!stillCurrent()) return;
    await this.leaveCleanupStep(
      'decrypt-key-clear',
      this.syncDecryptPoolRoomKey(null)
    );
    if (!stillCurrent()) return;
    await this.leaveCleanupStep('receive-reset', this.receiveEngine.reset());
    if (!stillCurrent()) return;
    await this.leaveCleanupStep(
      'receive-configure',
      this.receiveEngine.configure({ postFailoverRootHoldUntilMs: 0 })
    );
    this.recordDiagEvent('leave-cleanup-complete', { roomId });
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
    if (event === 'gcall:heartbeat') {
      const heartbeat = payload as
        | { roomId?: string; rootForwarder?: string; lastSeen?: number | null }
        | null
        | undefined;
      if (heartbeat?.roomId !== this.snapshot.roomId) return;
      const seenAtMs =
        typeof heartbeat?.lastSeen === 'number' &&
        Number.isFinite(heartbeat.lastSeen)
          ? heartbeat.lastSeen
          : Date.now();
      const rootForwarder = heartbeat?.rootForwarder?.trim() ?? '';
      const myAddress = this.userInfo?.address?.trim() ?? '';
      const currentRoot = this.topology?.rootForwarder?.trim() ?? '';
      const participantSet = new Set(
        this.snapshot.participants
          .map((participant) => participant.address?.trim() ?? '')
          .filter(Boolean)
      );
      if (
        rootForwarder &&
        rootForwarder !== myAddress &&
        participantSet.has(rootForwarder)
      ) {
        if (!currentRoot || currentRoot === rootForwarder) {
          this.updateTrustedRemoteRoot(rootForwarder, seenAtMs);
          this.clearConflictingRemoteRootIfMatches(rootForwarder);
        } else if (
          !this.reconcileProvisionalLocalRootFromRemoteAuthority(
            rootForwarder,
            seenAtMs,
            'heartbeat'
          )
        ) {
          this.noteConflictingRemoteRoot(rootForwarder, seenAtMs, 'heartbeat');
        } else {
          this.noteRootVerifiedControl(rootForwarder, seenAtMs);
        }
      } else if (this.trustedRemoteRoot) {
        this.trustedRemoteRootLastSeenAt = Math.max(
          this.trustedRemoteRootLastSeenAt,
          seenAtMs
        );
      }
      this.noteRootHeartbeat(rootForwarder, seenAtMs);
      return;
    }
    if (
      event === 'gcall:participant-joined' ||
      event === 'gcall:participant-left'
    ) {
      const roomId = (payload as { roomId?: string } | null | undefined)
        ?.roomId;
      if (roomId === this.snapshot.roomId) {
        if (event === 'gcall:participant-left') {
          const leavingAddress = (
            payload as { address?: string } | null | undefined
          )?.address;
          if (leavingAddress) {
            this.participantJoinIdentityByAddress.delete(leavingAddress.trim());
            this.clearTargetedRoomKeyReplayRetriesForAddress(leavingAddress);
            await this.resetReceiveStateForParticipant(
              leavingAddress,
              'participant-left'
            );
            this.refreshActiveSpeakerState();
            if (
              (this.topology?.rootForwarder?.trim() ?? '') ===
              leavingAddress.trim()
            ) {
              if (this.trustedRemoteRoot === leavingAddress.trim()) {
                this.clearTrustedRemoteRootIfMatches(leavingAddress);
              }
              this.resetRootPeerLiveness();
            } else if (this.conflictingRemoteRoot === leavingAddress.trim()) {
              this.clearConflictingRemoteRootIfMatches(leavingAddress);
            }
          }
          this.removeParticipantFromRuntimeEvent(leavingAddress);
        } else {
          const joining = payload as
            | {
                address?: string;
                publicKey?: string;
                joinGeneration?: number;
                timestamp?: number;
              }
            | null
            | undefined;
          const joiningAddress = joining?.address?.trim() ?? '';
          const myAddress = this.userInfo?.address?.trim() ?? '';
          await this.resetReceiveStateForFreshParticipantJoin(
            joiningAddress,
            joining?.joinGeneration,
            joining?.timestamp
          );
          this.upsertParticipantFromRuntimeEvent(
            joiningAddress,
            joining?.publicKey
          );
          await this.maybeSendRoomKeyToJoiningParticipant(
            joiningAddress,
            joining?.publicKey
          );
          if (
            joiningAddress &&
            joiningAddress !== myAddress &&
            !this.topology?.rootForwarder
          ) {
            this.armOccupiedRoomElectionWaitFromParticipantJoin(
              joiningAddress,
              joining?.joinGeneration
            );
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
      this.recordDiagEvent(
        'gcall-key-received',
        this.buildIncomingRoomKeyDiagPayload(keyP)
      );
      await this.handleIncomingRoomKey(keyP);
      return;
    }
    if (event === 'gcall:audio') {
      const audioPayload = this.recordAudioStageIngress(
        payload as GroupCallAudioReceivePayload
      );
      if (
        this.directVoiceRoomId &&
        audioPayload?.roomId === this.directVoiceRoomId
      ) {
        await this.processDirectVoiceAudioPayload(audioPayload);
        return;
      }
      if (audioPayload?.roomId !== this.snapshot.roomId) {
        traceGcallAudioSurface(
          'pipeline: gcall:audio dropped (room mismatch)',
          {
            expectedRoomId: this.snapshot.roomId,
            payloadRoomId: audioPayload?.roomId,
          }
        );
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
      const transport = audioPayload.transport;
      if (transport === 'link' || transport === 'packet') {
        this.receiveEngine.recordReticulumAudioInboundTransport(transport);
      }
      tracePipelineGcallAudioIngress({
        from: fromAddr || undefined,
        bytes: byteLen,
        hasRoomKey: this.roomKey !== null,
        poolReady,
        transport: transport ?? 'unknown',
        dataIsArrayBuffer: audioPayload.data instanceof ArrayBuffer,
      });
      if (this.awaitingAuthoritativeKey && this.roomKey === null) {
        this.noteParticipantLiveEvidence(fromAddr, Date.now());
        this.enqueueIncomingAudioWhileAwaitingKey(audioPayload);
        this.scheduleAuthoritativeKeyRecovery('decode-failure');
        return;
      }
      const decodedCount = await this.processIncomingAudioPayload(audioPayload);
      if (
        decodedCount === 0 &&
        this.awaitingAuthoritativeKey &&
        this.shouldLogAwaitingAuthoritativeKeyFailure()
      ) {
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
      this.appliedRoomKeyCommitment = '';
      this.ownsRoomKey = false;
      this.selfMintedRoomKey = false;
      this.awaitingAuthoritativeKey = false;
      this.localRoomKeyLastEnsuredAtMs = 0;
      this.demotedRootKeyTransferUntilMs = 0;
      this.resetWorkerDecodeFailureRecoveryState();
      this.seq = 0;
      this.callEpochMs = Date.now();
      this.resetOutboundMediaDiagnostics();
      this.clearHeldIncomingAudio();
      this.lastAwaitingAuthoritativeKeyFailureLogAt = 0;
      this.activeSpeakerLastSeenAt.clear();
      this.participantDecodedMediaLastSeenAt.clear();
      this.participantLiveEvidenceLastSeenAt.clear();
      this.liveEvidenceTopologyElectionLastAt.clear();
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

  private async processDirectVoiceAudioPayload(
    audioPayload: GroupCallAudioReceivePayload
  ): Promise<void> {
    const fromAddr =
      audioPayload.fromAddress ?? audioPayload.resolvedFromAddress ?? '';
    if (
      !this.directVoiceRoomKey ||
      audioPayload.roomId !== this.directVoiceRoomId
    ) {
      return;
    }
    if (!fromAddr || fromAddr !== this.directVoicePeerAddress) {
      return;
    }
    try {
      const receiveEngine = this.directVoiceReceiveEngine;
      if (!receiveEngine) return;
      await receiveEngine.handleIncomingAudio(
        audioPayload,
        this.directVoiceRoomKey
      );
    } catch (error) {
      this.recordDiagEvent('direct-voice-audio-receive-failed', {
        roomId: this.directVoiceRoomId,
        fromAddress: truncateGcallDiagAddress(fromAddr),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async processIncomingAudioPayload(
    audioPayload: GroupCallAudioReceivePayload
  ): Promise<number> {
    const byteLen =
      audioPayload.data instanceof ArrayBuffer
        ? audioPayload.data.byteLength
        : ArrayBuffer.isView(audioPayload.data)
          ? audioPayload.data.byteLength
          : 0;
    const poolReady =
      this.decryptPool !== null &&
      this.decryptPoolAppliedKeyVersion === this.decryptPoolKeyVersion;
    const fromAddr =
      audioPayload.fromAddress ?? audioPayload.resolvedFromAddress ?? '';
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (myAddress && fromAddr.trim() === myAddress) {
      this.recordDiagEvent('self-audio-dropped', {
        roomId: this.snapshot.roomId,
        fromAddress: truncateGcallDiagAddress(fromAddr),
        byteLen,
      });
      return 0;
    }
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
      const decryptSubmitAtWallMs = Date.now();
      const stageTimestamps = this.cloneAudioStageTimestamps(audioPayload, {
        decryptSubmitAtWallMs,
      });
      this.recordAudioStageGap(
        'decryptSubmit',
        ingressPeerAddress,
        decryptSubmitAtWallMs
      );
      this.recordAudioStageDelta(
        'surfaceToDecryptSubmit',
        ingressPeerAddress,
        stageTimestamps.audioSurfaceHandlerAtWallMs,
        decryptSubmitAtWallMs
      );
      const decryptId = this.decryptId++;
      this.pendingDecryptIngressById.set(decryptId, ingressPeerAddress);
      this.pendingDecryptStageById.set(decryptId, {
        sourceAddr: ingressPeerAddress,
        timestamps: stageTimestamps,
      });
      const posted = this.decryptPool!.postDecrypt(
        ingressPeerAddress,
        decryptId,
        audioPayload.data.slice(0)
      );
      this.noteParticipantLiveEvidence(ingressPeerAddress, Date.now());
      if (posted) {
        return 1;
      }
      this.pendingDecryptIngressById.delete(decryptId);
      this.pendingDecryptStageById.delete(decryptId);
      traceGcallAudioSurface(
        'pipeline: decrypt pool postDecrypt returned false, falling back',
        {
          from: ingressPeerAddress,
        }
      );
    }
    this.noteParticipantLiveEvidence(fromAddr, Date.now());
    const syncDecodeStartAtWallMs = Date.now();
    const syncStageTimestamps = this.cloneAudioStageTimestamps(audioPayload, {
      syncDecodeStartAtWallMs,
    });
    this.recordAudioStageGap(
      'syncDecodeStart',
      fromAddr || 'unknown',
      syncDecodeStartAtWallMs
    );
    this.recordAudioStageDelta(
      'surfaceToSyncDecodeStart',
      fromAddr || 'unknown',
      syncStageTimestamps.audioSurfaceHandlerAtWallMs,
      syncDecodeStartAtWallMs
    );
    const decodedCount = await this.receiveEngine.handleIncomingAudio(
      { ...audioPayload, audioStageTimestamps: syncStageTimestamps },
      this.roomKey
    );
    const syncDecodeEndAtWallMs = Date.now();
    this.recordAudioStageGap(
      'syncDecodeEnd',
      fromAddr || 'unknown',
      syncDecodeEndAtWallMs
    );
    this.recordAudioStageDelta(
      'syncDecodeDuration',
      fromAddr || 'unknown',
      syncDecodeStartAtWallMs,
      syncDecodeEndAtWallMs
    );
    return decodedCount;
  }

  private async handleIncomingRoomKey(
    payload: IncomingRoomKeyPayload
  ): Promise<void> {
    if (payload?.roomId !== this.snapshot.roomId) {
      traceGcallAudioSurface('pipeline: gcall:key dropped (room mismatch)', {
        expectedRoomId: this.snapshot.roomId,
        payloadRoomId: payload?.roomId,
      });
      this.recordDiagEvent(
        'room-key-dropped',
        this.buildIncomingRoomKeyDiagPayload(payload, {
          reason: 'room-mismatch',
        })
      );
      return;
    }
    if (payload?.verified !== true) {
      traceGcallAudioSurface('pipeline: gcall:key dropped (not verified)', {
        roomId: payload?.roomId,
        from: payload?.fromAddress,
      });
      this.recordDiagEvent(
        'room-key-dropped',
        this.buildIncomingRoomKeyDiagPayload(payload, {
          reason: 'not-verified',
        })
      );
      return;
    }
    if (payload?.keyMessageVersion !== GCALL_KEY_MESSAGE_VERSION) {
      traceGcallAudioSurface(
        'pipeline: gcall:key dropped (wrong key message version)',
        {
          want: GCALL_KEY_MESSAGE_VERSION,
          got: payload?.keyMessageVersion,
        }
      );
      this.recordDiagEvent(
        'room-key-dropped',
        this.buildIncomingRoomKeyDiagPayload(payload, {
          reason: 'wrong-key-message-version',
        })
      );
      return;
    }
    if (!payload?.encryptedKey) {
      traceGcallAudioSurface(
        'pipeline: gcall:key dropped (missing encryptedKey)',
        {
          from: payload?.fromAddress,
        }
      );
      this.recordDiagEvent(
        'room-key-dropped',
        this.buildIncomingRoomKeyDiagPayload(payload, {
          reason: 'missing-encrypted-key',
        })
      );
      return;
    }
    const senderInRoster = this.snapshot.participants.some(
      (participant) => participant.address === payload.fromAddress
    );
    const currentRoot = this.topology?.rootForwarder?.trim() ?? '';
    const trustedSender =
      Boolean(currentRoot) && payload.fromAddress === currentRoot;
    const canDecryptBox =
      typeof window.sendMessage === 'function' ||
      typeof (
        window as Window & {
          electronAPI?: { gcallProxyDecryptBoxWithMyKey?: unknown };
        }
      ).electronAPI?.gcallProxyDecryptBoxWithMyKey === 'function';
    if (!trustedSender) {
      const myAddress = this.userInfo?.address?.trim() ?? '';
      const fromAddress = payload.fromAddress?.trim() ?? '';
      if (
        fromAddress &&
        this.reconcileProvisionalLocalRootFromRemoteAuthority(
          fromAddress,
          Date.now(),
          'verified-key'
        )
      ) {
        this.noteRootVerifiedControl(fromAddress, Date.now());
        traceGcallAudioSurface(
          'pipeline: gcall:key deferred to provisional-root reconciliation',
          {
            from: payload.fromAddress,
            currentRoot: currentRoot || null,
          }
        );
        this.recordDiagEvent(
          'room-key-deferred',
          this.buildIncomingRoomKeyDiagPayload(payload, {
            reason: 'provisional-root-reconciliation',
          })
        );
        return;
      }
      if (
        fromAddress &&
        fromAddress !== myAddress &&
        fromAddress !== currentRoot &&
        senderInRoster
      ) {
        this.noteConflictingRemoteRoot(fromAddress, Date.now(), 'verified-key');
      }
      traceGcallAudioSurface(
        'pipeline: gcall:key dropped (untrusted sender for topology)',
        {
          from: payload.fromAddress,
          currentRoot: currentRoot || null,
          senderInRoster,
          participants: this.snapshot.participants.length,
        }
      );
      this.recordDiagEvent(
        'room-key-dropped',
        this.buildIncomingRoomKeyDiagPayload(payload, {
          reason: 'untrusted-sender',
        })
      );
      return;
    }
    if (!canDecryptBox) {
      traceGcallAudioSurface(
        'pipeline: gcall:key dropped (no sendMessage / gcallProxyDecryptBoxWithMyKey — cannot decrypt box)',
        {}
      );
      this.recordDiagEvent(
        'room-key-dropped',
        this.buildIncomingRoomKeyDiagPayload(payload, {
          reason: 'decrypt-box-api-unavailable',
          hasSendMessage: typeof window.sendMessage === 'function',
          hasElectronProxyDecrypt:
            typeof (
              window as Window & {
                electronAPI?: { gcallProxyDecryptBoxWithMyKey?: unknown };
              }
            ).electronAPI?.gcallProxyDecryptBoxWithMyKey === 'function',
        })
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
      traceGcallAudioSurface(
        'pipeline: gcall:key decrypt failed (decryptBox empty)',
        {
          from: payload.fromAddress,
        }
      );
      this.recordDiagEvent(
        'room-key-dropped',
        this.buildIncomingRoomKeyDiagPayload(payload, {
          reason: 'decrypt-box-empty',
        })
      );
      return;
    }
    const roomKey = base64ToUint8(result.decryptedKey);
    const expectedCommitment = await buildMediaKeyCommitmentHex(
      roomKey,
      payload.callSessionId,
      payload.mediaSessionGeneration >>> 0
    );
    if (expectedCommitment !== payload.keyCommitment) {
      traceGcallAudioSurface(
        'pipeline: gcall:key dropped (keyCommitment mismatch)',
        {
          from: payload.fromAddress,
        }
      );
      this.recordDiagEvent(
        'room-key-dropped',
        this.buildIncomingRoomKeyDiagPayload(payload, {
          reason: 'key-commitment-mismatch',
          expectedKeyCommitment: this.truncateDiagHex(expectedCommitment),
        })
      );
      return;
    }
    const incomingGeneration = payload.mediaSessionGeneration >>> 0;
    if (
      this.roomKey &&
      this.appliedRoomKeyCommitment === payload.keyCommitment &&
      this.callSessionId === payload.callSessionId &&
      this.mediaSessionGeneration === incomingGeneration
    ) {
      this.noteRootVerifiedKey(payload.fromAddress, Date.now());
      this.noteParticipantLiveEvidence(payload.fromAddress, Date.now());
      this.awaitingAuthoritativeKey = false;
      this.clearKeyRecoveryRetryTimer();
      traceGcallAudioSurface(
        'pipeline: duplicate room key ignored without receive reset',
        {
          from: payload.fromAddress,
          mediaSessionGeneration: incomingGeneration,
        }
      );
      this.recordDiagEvent('room-key-duplicate-ignored', {
        roomId: this.snapshot.roomId,
        fromAddress: payload.fromAddress,
        callSessionId: payload.callSessionId,
        mediaSessionGeneration: incomingGeneration,
        keyCommitment: this.truncateDiagHex(payload.keyCommitment),
      });
      await this.flushHeldIncomingAudioAfterKeyApplied();
      await this.syncSenderState();
      return;
    }
    this.noteRootVerifiedKey(payload.fromAddress, Date.now());
    this.noteParticipantLiveEvidence(payload.fromAddress, Date.now());
    this.roomKey = roomKey;
    this.appliedRoomKeyCommitment = payload.keyCommitment;
    this.ownsRoomKey = false;
    this.selfMintedRoomKey = false;
    this.awaitingAuthoritativeKey = false;
    this.resetWorkerDecodeFailureRecoveryState();
    this.clearKeyRecoveryRetryTimer();
    this.clearRecentWindowTrends();
    this.callEpochMs = Date.now();
    this.seq = 0;
    this.resetOutboundMediaDiagnostics();
    await this.receiveEngine.reset();
    await this.syncDecryptPoolRoomKey(roomKey);
    traceGcallAudioSurface('pipeline: room key applied, decrypt path enabled', {
      keyBytes: roomKey.length,
      from: payload.fromAddress,
    });
    this.recordDiagEvent('room-key-applied', {
      roomId: this.snapshot.roomId,
      fromAddress: payload.fromAddress,
      keyBytes: roomKey.length,
      callSessionId: payload.callSessionId,
      mediaSessionGeneration: payload.mediaSessionGeneration >>> 0,
      keyCommitment: this.truncateDiagHex(payload.keyCommitment),
    });
    await this.flushHeldIncomingAudioAfterKeyApplied();
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
      const roomKey = randomRoomKey();
      this.roomKey = roomKey;
      this.ownsRoomKey = true;
      this.selfMintedRoomKey = true;
      this.awaitingAuthoritativeKey = false;
      this.markRoomKeyLocallyEnsured();
      await this.markLocalRoomKeyApplied(roomKey);
      this.resetWorkerDecodeFailureRecoveryState();
      this.clearKeyRecoveryRetryTimer();
      this.callEpochMs = Date.now();
      this.seq = 0;
      this.resetOutboundMediaDiagnostics();
      await this.syncDecryptPoolRoomKey(roomKey);
      await this.distributeRoomKey(roomKey);
      await this.syncSenderState();
      traceGcallAudioSurface(
        'pipeline: session-updated minted and distributed room key',
        {
          roomId: this.snapshot.roomId,
          mediaSessionGeneration: this.mediaSessionGeneration,
        }
      );
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
    const bootstrap = await window.groupCall
      ?.getRoomBootstrapState?.(roomId)
      .catch(() => null);
    const roster = await window.groupCall
      ?.getRoomParticipants?.(roomId)
      .catch(() => []);
    if (roomId !== this.snapshot.roomId) return;

    const myAddress = this.userInfo?.address?.trim() ?? '';
    const rosterAddresses = new Set<string>();
    for (const participant of roster ?? []) {
      const address = participant?.address?.trim?.() ?? '';
      if (address) rosterAddresses.add(address);
    }

    const participantMap = new Map<
      string,
      { address: string; publicKey: string }
    >();
    for (const participant of this.snapshot.participants) {
      if (participant.address) {
        const address = participant.address.trim();
        const publicKey = participant.publicKey?.trim() ?? '';
        const existing = participantMap.get(address);
        if (!existing || (publicKey && !existing.publicKey)) {
          participantMap.set(address, { address, publicKey });
        }
      }
    }
    for (const participant of bootstrap?.participants ?? []) {
      if (participant?.address) {
        const address = participant.address.trim();
        const publicKey = participant.publicKey?.trim() ?? '';
        if (
          bootstrap?.fromRecentCache === true &&
          address !== myAddress &&
          !rosterAddresses.has(address)
        ) {
          this.bootstrapOnlyParticipantAddresses.add(address);
        }
        const existing = participantMap.get(address);
        if (!existing || (publicKey && !existing.publicKey)) {
          participantMap.set(address, { address, publicKey });
        }
      }
    }
    for (const participant of roster ?? []) {
      if (participant?.address) {
        const address = participant.address.trim();
        const publicKey = participant.publicKey?.trim() ?? '';
        this.bootstrapOnlyParticipantAddresses.delete(address);
        const existing = participantMap.get(address);
        if (!existing || (publicKey && !existing.publicKey)) {
          participantMap.set(address, { address, publicKey });
        }
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

    const remoteParticipantCount = [...participantMap.keys()].filter(
      (address) => address !== myAddress
    ).length;
    const bootstrapTopology = bootstrap?.lastTopology;
    const bootstrapUpdatedAtMs =
      bootstrap?.updatedAtMs && Number.isFinite(bootstrap.updatedAtMs)
        ? bootstrap.updatedAtMs
        : Date.now();
    const suppressCachedLocalRootAuthority =
      (bootstrap?.fromRecentCache ?? false) &&
      (bootstrapTopology?.rootForwarder?.trim() ?? '') === myAddress;
    if (bootstrapTopology?.rootForwarder && !suppressCachedLocalRootAuthority) {
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
        lastSeen: bootstrapTopology.lastSeen ?? bootstrapUpdatedAtMs,
      };
      this.snapshot = {
        ...this.snapshot,
        participants: this.mergeParticipantsFromTopology(
          this.snapshot.participants,
          this.topology
        ),
        myRole: computeGroupCallRole(myAddress, this.topology),
      };
      if (bootstrapTopology.rootForwarder.trim() === myAddress) {
        this.resetRootAuthorityTracking();
        this.resetRootPeerLiveness();
      } else {
        this.updateTrustedRemoteRoot(
          bootstrapTopology.rootForwarder,
          bootstrapTopology.lastSeen ?? bootstrapUpdatedAtMs
        );
        this.noteRootVerifiedControl(
          bootstrapTopology.rootForwarder,
          bootstrapTopology.lastSeen ?? bootstrapUpdatedAtMs
        );
      }
      this.topologyElectionDelayUntilMs = 0;
      this.lastObservedTopologyEpoch = Math.max(
        this.lastObservedTopologyEpoch,
        this.topology.topologyEpoch >>> 0
      );
    } else if (suppressCachedLocalRootAuthority) {
      this.lastObservedTopologyEpoch = Math.max(
        this.lastObservedTopologyEpoch,
        (bootstrapTopology?.topologyEpoch ?? 0) >>> 0
      );
      this.topologyElectionDelayUntilMs = Math.max(
        this.topologyElectionDelayUntilMs,
        Date.now() + OCCUPIED_JOIN_AUTHORITY_WAIT_MS
      );
      traceGcallAudioSurface(
        'pipeline: suppressed cached local-root authority during rejoin',
        {
          roomId,
          topologyEpoch: bootstrapTopology?.topologyEpoch ?? 0,
          remoteParticipantCount,
        }
      );
      this.recordDiagEvent('cached-local-root-authority-suppressed', {
        roomId,
        topologyEpoch: bootstrapTopology?.topologyEpoch ?? 0,
        remoteParticipantCount,
      });
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
    if (!this.roomKey && root && root !== myAddress) {
      await this.requestRoomKeyFrom(root, 'topology');
    }
    if (!root) {
      const trustedElectionRoot = getTrustedRootForRejoinElection({
        currentRoot: null,
        trustedRemoteRoot: this.trustedRemoteRoot,
        trustedRemoteRootLastSeenAtMs: this.trustedRemoteRootLastSeenAt,
        nowMs: Date.now(),
        staleAfterMs: TRUSTED_REMOTE_ROOT_STICKY_REJOIN_MS,
        rosterAddresses: participantMap.keys(),
      });
      const occupiedRoomEvidence = hasOccupiedRoomEvidenceForJoin({
        sameRoomRejoin: true,
        hydratedRemoteParticipantCount: remoteParticipantCount,
        bootstrapParticipantCount: bootstrap?.participants?.length ?? 0,
        bootstrapTopologyEpoch:
          bootstrapTopology?.topologyEpoch ?? bootstrap?.topologyEpoch ?? 0,
        bootstrapHasTopology: Boolean(bootstrapTopology?.rootForwarder),
        lastObservedEpoch: this.lastObservedTopologyEpoch,
        trustedRemoteRoot: trustedElectionRoot,
        bootstrapCallSessionId: bootstrap?.callSessionId,
        bootstrapMediaSessionGeneration: bootstrap?.mediaSessionGeneration ?? 0,
      });
      this.startupOccupiedRoomEvidence =
        this.startupOccupiedRoomEvidence || occupiedRoomEvidence;
      this.startupHydratedRemoteCount = Math.max(
        this.startupHydratedRemoteCount,
        remoteParticipantCount
      );
      this.startupBootstrapHasTopology =
        this.startupBootstrapHasTopology ||
        Boolean(bootstrapTopology?.rootForwarder);
      if (roomId.startsWith('gcall-qortal-') && remoteParticipantCount === 0) {
        const selfOnlyDelayMs = occupiedRoomEvidence
          ? ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS
          : GROUP_CALL_SELF_ONLY_JOIN_ELECTION_WAIT_MS;
        this.topologyElectionDelayUntilMs = Math.max(
          this.topologyElectionDelayUntilMs,
          Date.now() + selfOnlyDelayMs
        );
      } else if (
        shouldDelayPostJoinRosterElection({
          hydratedRemoteParticipantCount: remoteParticipantCount,
          currentRoot: null,
          trustedRemoteRoot: trustedElectionRoot,
          hasOccupiedRoomEvidence: occupiedRoomEvidence,
        })
      ) {
        this.topologyElectionDelayUntilMs = Math.max(
          this.topologyElectionDelayUntilMs,
          Date.now() + OCCUPIED_JOIN_AUTHORITY_WAIT_MS
        );
      }
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
      if (
        mainGeneration === localGeneration &&
        mainCallSessionId !== localCallSessionId
      ) {
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

  private clearRoomKeyDistributionRetryTimer(): void {
    if (this.roomKeyDistributionRetryTimer) {
      clearTimeout(this.roomKeyDistributionRetryTimer);
      this.roomKeyDistributionRetryTimer = null;
    }
  }

  private buildTargetedRoomKeyReplayKey(address: string): string {
    return [
      this.snapshot.roomId,
      this.callSessionId,
      this.mediaSessionGeneration >>> 0,
      address,
    ].join('|');
  }

  private clearTargetedRoomKeyReplayRetries(): void {
    for (const timer of this.targetedRoomKeyReplayTimers.values()) {
      clearTimeout(timer);
    }
    this.targetedRoomKeyReplayTimers.clear();
    this.targetedRoomKeyReplayAttempts.clear();
  }

  private clearTargetedRoomKeyReplayRetriesForAddress(address: string): void {
    const target = address.trim();
    if (!target) return;
    for (const [key, timer] of this.targetedRoomKeyReplayTimers) {
      const parts = key.split('|');
      if (parts[3] !== target) continue;
      clearTimeout(timer);
      this.targetedRoomKeyReplayTimers.delete(key);
      this.targetedRoomKeyReplayAttempts.delete(key);
    }
  }

  private scheduleTargetedRoomKeyReplayRetry(
    toAddressValue: string | null | undefined,
    publicKeyValue: string | null | undefined,
    reason: string
  ): void {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const root = this.topology?.rootForwarder?.trim() ?? '';
    const toAddress = toAddressValue?.trim() ?? '';
    const publicKey = publicKeyValue?.trim() ?? '';
    if (
      !myAddress ||
      !this.snapshot.roomId ||
      !this.callSessionId ||
      !this.roomKey ||
      !this.ownsRoomKey ||
      root !== myAddress ||
      !toAddress ||
      toAddress === myAddress ||
      !publicKey
    ) {
      return;
    }

    const retryKey = this.buildTargetedRoomKeyReplayKey(toAddress);
    if (this.targetedRoomKeyReplayTimers.has(retryKey)) return;
    if (
      (this.targetedRoomKeyReplayAttempts.get(retryKey) ?? 0) >=
      TARGETED_ROOM_KEY_REPLAY_MAX_ATTEMPTS
    ) {
      return;
    }

    this.recordDiagEvent('targeted-room-key-replay-retry-scheduled', {
      roomId: this.snapshot.roomId,
      toAddress,
      reason,
      mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
    });
    const timer = setTimeout(() => {
      this.targetedRoomKeyReplayTimers.delete(retryKey);
      void this.runTargetedRoomKeyReplayRetry(
        toAddress,
        publicKey,
        retryKey,
        reason
      );
    }, TARGETED_ROOM_KEY_REPLAY_RETRY_MS);
    this.targetedRoomKeyReplayTimers.set(retryKey, timer);
  }

  private async runTargetedRoomKeyReplayRetry(
    toAddress: string,
    publicKey: string,
    retryKey: string,
    reason: string
  ): Promise<void> {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const root = this.topology?.rootForwarder?.trim() ?? '';
    if (
      !myAddress ||
      !this.snapshot.roomId ||
      !this.callSessionId ||
      !this.roomKey ||
      !this.ownsRoomKey ||
      root !== myAddress ||
      toAddress === myAddress ||
      retryKey !== this.buildTargetedRoomKeyReplayKey(toAddress)
    ) {
      return;
    }
    const targetStillInRoom = this.snapshot.participants.some(
      (participant) => participant.address?.trim() === toAddress
    );
    if (!targetStillInRoom) {
      this.targetedRoomKeyReplayAttempts.delete(retryKey);
      return;
    }

    const nextAttempt =
      (this.targetedRoomKeyReplayAttempts.get(retryKey) ?? 0) + 1;
    this.targetedRoomKeyReplayAttempts.set(retryKey, nextAttempt);
    this.recordDiagEvent('targeted-room-key-replay-retry-fired', {
      roomId: this.snapshot.roomId,
      toAddress,
      reason,
      attempt: nextAttempt,
      mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
    });
    try {
      await this.sendTargetedRoomKey(
        this.roomKey,
        toAddress,
        publicKey,
        `${reason}-retry`
      );
    } catch {
      /* retry budget is bounded; later attempts may still succeed */
    }

    if (nextAttempt < TARGETED_ROOM_KEY_REPLAY_MAX_ATTEMPTS) {
      this.scheduleTargetedRoomKeyReplayRetry(toAddress, publicKey, reason);
    }
  }

  private hasRemoteParticipantEvidence(): boolean {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (
      this.snapshot.participants.some(
        (participant) =>
          participant.address && participant.address !== myAddress
      )
    ) {
      return true;
    }
    if ((this.topology?.participantCount ?? 0) > 1) {
      return true;
    }
    return (this.snapshot.forwardRecipientCount ?? 0) > 0;
  }

  private scheduleRoomKeyDistributionRetry(reason: string): void {
    if (
      this.roomKeyDistributionRetryTimer ||
      !this.roomKey ||
      !this.ownsRoomKey
    ) {
      return;
    }
    this.recordDiagEvent('room-key-distribution-retry-scheduled', {
      roomId: this.snapshot.roomId,
      reason,
    });
    this.roomKeyDistributionRetryTimer = setTimeout(() => {
      this.roomKeyDistributionRetryTimer = null;
      if (!this.roomKey || !this.ownsRoomKey) {
        return;
      }
      void this.distributeRoomKey(this.roomKey);
    }, ROOM_KEY_DISTRIBUTION_RETRY_MS);
  }

  private clearSenderSyncRetryTimer(): void {
    if (this.senderSyncRetryTimer) {
      clearTimeout(this.senderSyncRetryTimer);
      this.senderSyncRetryTimer = null;
    }
  }

  private clearRootFailoverTimer(): void {
    if (this.rootFailoverTimer) {
      clearTimeout(this.rootFailoverTimer);
      this.rootFailoverTimer = null;
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
      (this.snapshot.roomState !== 'joining' &&
        this.snapshot.roomState !== 'connected')
    ) {
      return;
    }
    this.clearTopologyElectionTimer();
    const nowMs = Date.now();
    const delayMs = shouldDeferLocalTopologyElection({
      nowMs,
      authorityDelayUntilMs: this.topologyElectionDelayUntilMs,
    })
      ? Math.max(
          TOPOLOGY_ELECTION_DEBOUNCE_MS,
          this.topologyElectionDelayUntilMs - nowMs
        )
      : TOPOLOGY_ELECTION_DEBOUNCE_MS;
    this.topologyElectionTimer = setTimeout(() => {
      this.topologyElectionTimer = null;
      const generation = ++this.topologyAsyncGeneration;
      void this.runTopologyElection(generation, reason);
    }, delayMs);
  }

  private armOccupiedRoomElectionWaitFromParticipantJoin(
    address: string,
    joinGeneration?: number
  ): void {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const remoteAddress = address.trim();
    if (!myAddress || !remoteAddress || remoteAddress === myAddress) return;
    if ((this.topology?.rootForwarder?.trim() ?? '') !== '') return;
    const participantAddresses = this.snapshot.participants
      .map((participant) => participant.address?.trim() ?? '')
      .filter(Boolean);
    const remoteParticipantCount = participantAddresses.filter(
      (participantAddress) => participantAddress !== myAddress
    ).length;
    if (remoteParticipantCount <= 0) return;

    const nowMs = Date.now();
    const delayUntil =
      this.topologyElectionDelayUntilMs > nowMs
        ? this.topologyElectionDelayUntilMs
        : nowMs + OCCUPIED_JOIN_AUTHORITY_WAIT_MS;
    this.topologyElectionDelayUntilMs = Math.max(
      this.topologyElectionDelayUntilMs,
      delayUntil
    );
    this.authoritySettleUntilMs = Math.max(
      this.authoritySettleUntilMs,
      this.topologyElectionDelayUntilMs
    );
    this.startupOccupiedRoomEvidence = true;
    this.startupHydratedRemoteCount = Math.max(
      this.startupHydratedRemoteCount,
      remoteParticipantCount
    );
    this.recordDiagEvent('occupied-room-election-wait-from-participant-join', {
      roomId: this.snapshot.roomId,
      peer: truncateGcallDiagAddress(remoteAddress),
      joinGeneration: joinGeneration ?? null,
      remoteParticipantCount,
      topologyElectionDelayRemainingMs: Math.max(
        0,
        this.topologyElectionDelayUntilMs - nowMs
      ),
      authoritySettleRemainingMs: Math.max(
        0,
        this.authoritySettleUntilMs - nowMs
      ),
    });
    traceGcallAudioSurface(
      'pipeline: occupied-room election wait armed from participant join',
      {
        roomId: this.snapshot.roomId,
        peer: truncateGcallDiagAddress(remoteAddress),
        remoteParticipantCount,
        delayMs: Math.max(0, this.topologyElectionDelayUntilMs - nowMs),
      }
    );
  }

  private shouldMaintainActiveSender(): boolean {
    return (
      this.snapshot.roomState === 'connected' &&
      this.roomKey !== null &&
      this.topology !== null &&
      Boolean(this.userInfo?.address)
    );
  }

  private scheduleSenderSyncRetry(reason: string): void {
    if (!this.shouldMaintainActiveSender()) return;
    if (this.senderSyncRetryTimer) return;
    this.senderSyncRetryTimer = setTimeout(() => {
      this.senderSyncRetryTimer = null;
      void this.syncSenderState();
    }, GROUP_CALL_SENDER_SYNC_RETRY_MS);
    this.recordDiagEvent('sender-sync-retry-scheduled', {
      roomId: this.snapshot.roomId,
      reason,
      delayMs: GROUP_CALL_SENDER_SYNC_RETRY_MS,
    });
  }

  private async runTopologyElection(
    generation: number,
    reason: string
  ): Promise<void> {
    const roomId = this.snapshot.roomId;
    const myAddress = this.userInfo?.address ?? '';
    if (!roomId || !myAddress) return;
    const nowMs = Date.now();
    const participantSet = this.collectTopologyElectionAddresses(nowMs);
    const addresses = [...participantSet];
    if (addresses.length === 0) return;
    const conflictingRoot = this.getConflictingRemoteRootForAuthorityWait(
      nowMs,
      addresses
    );
    if (conflictingRoot && nowMs < this.authoritySettleUntilMs) {
      this.topologyElectionDelayUntilMs = Math.max(
        this.topologyElectionDelayUntilMs,
        this.authoritySettleUntilMs
      );
      this.recordDiagEvent(
        'local-topology-election-deferred-authority-conflict',
        {
          roomId,
          reason,
          conflictingRemoteRoot: conflictingRoot,
          authoritySettleUntilMs: this.authoritySettleUntilMs,
        }
      );
      this.scheduleTopologyElection('authority-conflict');
      return;
    }
    const sorted = await this.computeElectionOrder(addresses, roomId);
    if (
      generation !== this.topologyAsyncGeneration ||
      roomId !== this.snapshot.roomId
    ) {
      return;
    }
    const shouldReconsiderSelfMintedRootFromLiveEvidence =
      reason === 'live-media-evidence' &&
      this.selfMintedRoomKey &&
      (this.topology?.rootForwarder?.trim() ?? '') === myAddress &&
      addresses.some((address) => address.trim() && address !== myAddress);
    const shouldPreferConflictingRootForThreePlus =
      addresses.length >= 3 &&
      Boolean(conflictingRoot) &&
      conflictingRoot !== myAddress;
    const trustedElectionRoot = getTrustedRootForRejoinElection({
      currentRoot:
        shouldPreferConflictingRootForThreePlus ||
        this.isProvisionalLocalRootActive(nowMs) ||
        shouldReconsiderSelfMintedRootFromLiveEvidence
          ? null
          : this.topology?.rootForwarder,
      trustedRemoteRoot: shouldPreferConflictingRootForThreePlus
        ? (conflictingRoot ?? '')
        : this.trustedRemoteRoot,
      trustedRemoteRootLastSeenAtMs: this.trustedRemoteRootLastSeenAt,
      nowMs,
      staleAfterMs: TRUSTED_REMOTE_ROOT_STICKY_REJOIN_MS,
      rosterAddresses: addresses,
    });
    if (shouldPreferConflictingRootForThreePlus) {
      this.recordDiagEvent('conflicting-root-preferred-for-election', {
        roomId,
        reason,
        conflictingRemoteRoot: truncateGcallDiagAddress(conflictingRoot ?? ''),
        participantCount: addresses.length,
        currentRoot: truncateGcallDiagAddress(
          this.topology?.rootForwarder ?? ''
        ),
      });
    }
    if (shouldReconsiderSelfMintedRootFromLiveEvidence) {
      this.recordDiagEvent('self-minted-root-reconsidered-from-live-evidence', {
        roomId,
        reason,
        participantCount: addresses.length,
        currentRoot: this.topology?.rootForwarder ?? null,
      });
    }
    const topologyEpoch =
      Math.max(
        this.topology?.topologyEpoch ?? 0,
        this.lastObservedTopologyEpoch ?? 0
      ) + 1;
    const topology = normalizeGroupCallTopology({
      ...buildTopologyWithTrustedRoot(
        sorted,
        topologyEpoch,
        sorted.length === 2 ? sorted[0] : trustedElectionRoot
      ),
      roomId,
      lastSeen: nowMs,
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
    if (
      this.shouldSuppressOccupiedRejoinLocalRootElection(
        topology,
        reason,
        nowMs
      )
    ) {
      return;
    }
    if (
      this.isSameTopologyStructureIgnoringEpoch(this.topology, topology) &&
      this.isTopologyRepresentedInSnapshotRoster(this.topology)
    ) {
      this.recordDiagEvent('local-topology-election-suppressed-unchanged', {
        roomId,
        reason,
        currentEpoch: this.topology?.topologyEpoch ?? null,
        proposedEpoch: topology.topologyEpoch,
        rootForwarder: topology.rootForwarder,
        standbyForwarder: topology.standbyForwarder,
        participantCount: sorted.length,
      });
      await this.refreshAuthoritativeParticipantRoster(
        'local-topology-election-suppressed-unchanged'
      );
      return;
    }
    const applied = await this.applyTopology(topology, 'local-election');
    if (applied) {
      if (
        topology.rootForwarder === myAddress &&
        this.shouldMarkLocalRootProvisional()
      ) {
        this.markProvisionalLocalRoot(reason, nowMs);
      } else if (topology.rootForwarder !== myAddress) {
        this.clearProvisionalLocalRoot();
      }
      await this.broadcastTopology(topology, reason);
    }
  }

  private async reconcileSelfMintedTwoPartyRootFromDecodeFailure(
    peerAddress: string,
    decodeFailedCount: number
  ): Promise<void> {
    const roomId = this.snapshot.roomId;
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const peer = peerAddress.trim();
    if (
      !roomId ||
      !myAddress ||
      !peer ||
      peer === myAddress ||
      this.topology?.rootForwarder?.trim() !== myAddress ||
      !this.selfMintedRoomKey ||
      !this.ownsRoomKey ||
      this.countRemoteParticipants() !== 1 ||
      !this.isAddressInCurrentRoster(peer)
    ) {
      return;
    }
    const nowMs = Date.now();
    const sorted = await this.computeElectionOrder([myAddress, peer], roomId);
    if (sorted[0] !== peer) {
      this.recordDiagEvent('self-minted-root-decode-failure-kept-local-root', {
        roomId,
        peer: truncateGcallDiagAddress(peer),
        decodeFailedCount,
        deterministicRoot: truncateGcallDiagAddress(sorted[0] ?? ''),
      });
      return;
    }
    const topologyEpoch =
      Math.max(
        this.topology?.topologyEpoch ?? 0,
        this.lastObservedTopologyEpoch ?? 0
      ) + 1;
    const topology = normalizeGroupCallTopology({
      ...buildTopologyWithTrustedRoot(sorted, topologyEpoch, peer),
      roomId,
      lastSeen: nowMs,
    });
    this.recordDiagEvent('self-minted-root-demoted-by-decode-failure', {
      roomId,
      peer: truncateGcallDiagAddress(peer),
      decodeFailedCount,
      topologyEpoch,
    });
    traceGcallAudioSurface(
      'pipeline: self-minted root demoting after repeated peer decode failures',
      {
        roomId,
        peer: truncateGcallDiagAddress(peer),
        decodeFailedCount,
        topologyEpoch,
      }
    );
    const applied = await this.applyTopology(topology, 'local-election');
    if (applied) {
      await this.broadcastTopology(topology, 'self-minted-root-decode-failure');
    }
  }

  private isTwoPartyRoomWithPeer(peerAddress: string): boolean {
    const peer = peerAddress.trim();
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!peer || !myAddress || peer === myAddress) return false;
    if (!this.isAddressInCurrentRoster(peer)) return false;
    const addresses = new Set(
      this.snapshot.participants
        .map((participant) => participant.address?.trim() ?? '')
        .filter(Boolean)
    );
    addresses.add(myAddress);
    return addresses.size === 2 && addresses.has(peer);
  }

  private async forceTwoPartyDeterministicTopologyResync(
    peerAddress: string,
    reason: string
  ): Promise<void> {
    const roomId = this.snapshot.roomId;
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const peer = peerAddress.trim();
    if (!roomId || !myAddress || !peer || peer === myAddress) return;
    if (!this.isTwoPartyRoomWithPeer(peer)) {
      this.recordDiagEvent('two-party-link-resync-skipped', {
        roomId,
        reason,
        peer: truncateGcallDiagAddress(peer),
        skippedReason: 'not-current-two-party-roster',
        participantCount: this.snapshot.participants.length,
      });
      return;
    }
    const nowMs = Date.now();
    const lastAt = this.twoPartyLinkResyncLastAtByPeer.get(peer) ?? 0;
    if (nowMs - lastAt < TWO_PARTY_LINK_RESYNC_COOLDOWN_MS) return;
    this.twoPartyLinkResyncLastAtByPeer.set(peer, nowMs);

    const sorted = await this.computeElectionOrder([myAddress, peer], roomId);
    const deterministicRoot = sorted[0] ?? myAddress;
    if (
      deterministicRoot !== myAddress &&
      this.hasFreshLocalKeyAuthority(nowMs)
    ) {
      this.recordDiagEvent('two-party-link-resync-skipped', {
        roomId,
        reason,
        peer: truncateGcallDiagAddress(peer),
        skippedReason: 'fresh-local-key-authority',
        deterministicRoot: truncateGcallDiagAddress(deterministicRoot),
        currentRoot: truncateGcallDiagAddress(
          this.topology?.rootForwarder ?? ''
        ),
        keyAuthorityAgeMs: nowMs - this.localRoomKeyLastEnsuredAtMs,
      });
      return;
    }
    const topologyEpoch =
      Math.max(
        this.topology?.topologyEpoch ?? 0,
        this.lastObservedTopologyEpoch ?? 0
      ) + 1;
    const topology = normalizeGroupCallTopology({
      ...buildTopologyWithTrustedRoot(sorted, topologyEpoch, deterministicRoot),
      roomId,
      lastSeen: nowMs,
    });
    this.recordDiagEvent('two-party-link-resync-topology', {
      roomId,
      reason,
      peer: truncateGcallDiagAddress(peer),
      topologyEpoch,
      deterministicRoot: truncateGcallDiagAddress(deterministicRoot),
      localPreviousRoot: truncateGcallDiagAddress(
        this.topology?.rootForwarder ?? ''
      ),
      localPreviousEpoch: this.topology?.topologyEpoch ?? null,
    });
    const applied = await this.applyTopology(topology, 'local-election');
    if (applied && topology.rootForwarder === myAddress) {
      await this.broadcastTopology(topology, reason);
      if (this.roomKey) {
        await this.distributeRoomKey(this.roomKey);
      }
    } else if (applied && topology.rootForwarder !== myAddress) {
      this.clearProvisionalLocalRoot();
      if (!this.ownsRoomKey) {
        await this.requestRoomKeyFrom(topology.rootForwarder, 'topology');
      }
    }
  }

  private maybeResyncTwoPartyTopologyFromLinkDiagnostics(
    diagnostics: GcallSendAudioDiagnostics
  ): void {
    const peer = diagnostics.targetAddress?.trim() ?? '';
    if (!peer || !this.isTwoPartyRoomWithPeer(peer)) return;
    const lastUnreadyAt = diagnostics.lastLinkUnreadyAtMs ?? 0;
    const reason = diagnostics.lastLinkUnreadyReason ?? '';
    const linkHealthy =
      diagnostics.transport === 'link' && diagnostics.linkEstablished === true;
    if (linkHealthy) return;
    const linkClosedOrTimedOut =
      reason.startsWith('bridge-link-closed:') ||
      reason === 'link-heartbeat-timeout' ||
      reason.startsWith('audio-recovery:link-heartbeat-timeout') ||
      reason.startsWith('audio-recovery:link-closed');
    const linkCurrentlyUnready =
      diagnostics.transport === 'link' &&
      diagnostics.linkEstablished === false &&
      lastUnreadyAt > 0 &&
      Date.now() - lastUnreadyAt <= 30_000;
    if (!linkClosedOrTimedOut && !linkCurrentlyUnready) return;
    const nowMs = Date.now();
    const startupAgeMs = this.getMediaTargetSettleAgeMs(peer, nowMs);
    const linkStillSettling =
      diagnostics.linkOpening === true ||
      (typeof diagnostics.linkEstablishPendingAgeMs === 'number' &&
        diagnostics.linkEstablishPendingAgeMs <
          TWO_PARTY_LINK_RESYNC_STARTUP_GRACE_MS) ||
      (lastUnreadyAt > 0 &&
        nowMs - lastUnreadyAt < TWO_PARTY_LINK_RESYNC_STARTUP_GRACE_MS);
    if (
      startupAgeMs < TWO_PARTY_LINK_RESYNC_STARTUP_GRACE_MS &&
      linkStillSettling
    ) {
      this.recordThrottledDiagEvent(
        'two-party-link-resync-suppressed-startup',
        `${this.snapshot.roomId}:${peer}:${reason}`,
        {
          roomId: this.snapshot.roomId,
          reason,
          peer: truncateGcallDiagAddress(peer),
          settleAgeMs: startupAgeMs,
          graceMs: TWO_PARTY_LINK_RESYNC_STARTUP_GRACE_MS,
          linkOpening: diagnostics.linkOpening ?? null,
          linkEstablishPendingAgeMs:
            diagnostics.linkEstablishPendingAgeMs ?? null,
          lastLinkUnreadyAgeMs:
            lastUnreadyAt > 0 ? nowMs - lastUnreadyAt : null,
        }
      );
      return;
    }
    void this.forceTwoPartyDeterministicTopologyResync(
      peer,
      `link-recovery:${reason || 'unready'}`
    );
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
      !this.isSameTopologyStructureIgnoringEpoch(left, right)
    ) {
      return false;
    }
    return true;
  }

  private isTopologyRepresentedInSnapshotRoster(
    topology: GroupCallTopology | null
  ): boolean {
    if (!topology) return false;
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const roster = new Set(
      this.snapshot.participants
        .map((participant) => participant.address?.trim() ?? '')
        .filter(Boolean)
    );
    if (myAddress) roster.add(myAddress);
    return this.collectTopologyAddresses(topology).every((address) =>
      roster.has(address)
    );
  }

  private isSameTopologyStructureIgnoringEpoch(
    left: GroupCallTopology | null,
    right: GroupCallTopology
  ): boolean {
    if (!left) return false;
    if (
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
        cluster.members.every(
          (member, memberIndex) => member === next.members[memberIndex]
        )
      );
    });
  }

  private async maybeReplayRetainedKeysAfterTopology(
    topology: GroupCallTopology
  ): Promise<void> {
    if (!this.shouldReplayRetainedKeysAfterNextTopology) return;
    this.shouldReplayRetainedKeysAfterNextTopology = false;
    if (typeof window.groupCall?.requestRetainedKeyReplay !== 'function')
      return;
    window.groupCall.requestRetainedKeyReplay();
    traceGcallAudioSurface(
      'pipeline: gcall:topology — retained key replay (keys may only be storable after root is known)',
      { roomId: topology.roomId }
    );
  }

  private requestRetainedKeyReplay(reason: string): void {
    if (typeof window.groupCall?.requestRetainedKeyReplay !== 'function')
      return;
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

  private resetWorkerDecodeFailureRecoveryState(): void {
    this.workerDecodeFailureWindowStartedAt = 0;
    this.workerDecodeFailureCount = 0;
    this.workerDecodeFailureRecoveryLastAt = 0;
    this.pendingDecryptIngressById.clear();
    this.pendingDecryptStageById.clear();
    this.rootDecodeFailureWindowStartedAtBySource.clear();
    this.rootDecodeFailureCountBySource.clear();
    this.rootDecodeFailureKeyReplayLastAtBySource.clear();
  }

  private noteWorkerDecodeFailureForKeyRecovery(): void {
    const root = this.topology?.rootForwarder?.trim() ?? '';
    const myAddress = this.userInfo?.address ?? '';
    if (!root || !myAddress || root === myAddress || !this.snapshot.roomId) {
      return;
    }
    const now = Date.now();
    if (
      this.workerDecodeFailureWindowStartedAt <= 0 ||
      now - this.workerDecodeFailureWindowStartedAt >
        WORKER_DECODE_FAILURE_RECOVERY_WINDOW_MS
    ) {
      this.workerDecodeFailureWindowStartedAt = now;
      this.workerDecodeFailureCount = 0;
    }
    this.workerDecodeFailureCount += 1;
    if (
      this.workerDecodeFailureCount < WORKER_DECODE_FAILURE_RECOVERY_THRESHOLD
    ) {
      return;
    }
    if (
      this.workerDecodeFailureRecoveryLastAt > 0 &&
      now - this.workerDecodeFailureRecoveryLastAt <
        WORKER_DECODE_FAILURE_RECOVERY_COOLDOWN_MS
    ) {
      return;
    }
    this.workerDecodeFailureRecoveryLastAt = now;
    this.awaitingAuthoritativeKey = true;
    traceGcallAudioSurface(
      'pipeline: repeated decrypt worker decode-failed triggered authoritative key recovery',
      {
        roomId: this.snapshot.roomId,
        rootForwarder: root,
        decodeFailedCount: this.workerDecodeFailureCount,
      }
    );
    this.recordDiagEvent('worker-decode-failure-key-recovery', {
      roomId: this.snapshot.roomId,
      rootForwarder: root,
      decodeFailedCount: this.workerDecodeFailureCount,
    });
    void this.requestRoomKeyFrom(root, 'topology');
    this.requestRetainedKeyReplay('worker-decode-failure');
    this.scheduleAuthoritativeKeyRecovery('worker-decode-failure');
  }

  private noteRootDecodeFailureForPeerKeyReplay(
    sourceAddress: string
  ): boolean {
    const root = this.topology?.rootForwarder?.trim() ?? '';
    const myAddress = this.userInfo?.address ?? '';
    const peerAddress = sourceAddress.trim();
    if (
      !root ||
      !myAddress ||
      root !== myAddress ||
      !this.snapshot.roomId ||
      !this.roomKey ||
      !this.ownsRoomKey ||
      !peerAddress ||
      peerAddress === 'unknown' ||
      peerAddress === myAddress
    ) {
      return false;
    }
    const participant = this.snapshot.participants.find(
      (candidate) => candidate.address === peerAddress
    );
    const publicKey = participant?.publicKey?.trim() ?? '';
    if (!publicKey) {
      this.recordDiagEvent('root-worker-decode-failure-key-replay-skipped', {
        roomId: this.snapshot.roomId,
        sourceAddress: peerAddress,
        reason: 'missing-public-key',
      });
      return true;
    }

    const now = Date.now();
    const windowStartedAt =
      this.rootDecodeFailureWindowStartedAtBySource.get(peerAddress) ?? 0;
    if (
      windowStartedAt <= 0 ||
      now - windowStartedAt > WORKER_DECODE_FAILURE_RECOVERY_WINDOW_MS
    ) {
      this.rootDecodeFailureWindowStartedAtBySource.set(peerAddress, now);
      this.rootDecodeFailureCountBySource.set(peerAddress, 0);
    }
    const count =
      (this.rootDecodeFailureCountBySource.get(peerAddress) ?? 0) + 1;
    this.rootDecodeFailureCountBySource.set(peerAddress, count);
    if (count < WORKER_DECODE_FAILURE_RECOVERY_THRESHOLD) {
      return true;
    }

    const lastReplayAt =
      this.rootDecodeFailureKeyReplayLastAtBySource.get(peerAddress) ?? 0;
    if (
      lastReplayAt > 0 &&
      now - lastReplayAt < WORKER_DECODE_FAILURE_RECOVERY_COOLDOWN_MS
    ) {
      return true;
    }
    this.rootDecodeFailureKeyReplayLastAtBySource.set(peerAddress, now);
    if (
      this.selfMintedRoomKey &&
      this.countRemoteParticipants() === 1 &&
      this.isAddressInCurrentRoster(peerAddress)
    ) {
      this.recordDiagEvent(
        'self-minted-root-decode-failure-reconcile-scheduled',
        {
          roomId: this.snapshot.roomId,
          sourceAddress: peerAddress,
          decodeFailedCount: count,
        }
      );
      void this.reconcileSelfMintedTwoPartyRootFromDecodeFailure(
        peerAddress,
        count
      );
    }
    traceGcallAudioSurface(
      'pipeline: root decode-failed triggered targeted room-key replay',
      {
        roomId: this.snapshot.roomId,
        sourceAddress: peerAddress,
        decodeFailedCount: count,
      }
    );
    this.recordDiagEvent('root-worker-decode-failure-key-replay', {
      roomId: this.snapshot.roomId,
      sourceAddress: peerAddress,
      decodeFailedCount: count,
    });
    void this.sendTargetedRoomKey(
      this.roomKey,
      peerAddress,
      publicKey,
      'root-worker-decode-failure'
    );
    return true;
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
    if (this.keyRecoveryRetryTimer) {
      return;
    }
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
    const broadcastTopology = window.groupCall?.broadcastTopology;
    if (typeof broadcastTopology !== 'function') return;
    await broadcastTopology(
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
      this.scheduleRootFailoverWatch();
      return;
    }
    this.clearRootFailoverTimer();
    if (this.topologyHeartbeatTimer) {
      return;
    }
    await this.broadcastTopology(topology, 'initial-heartbeat');
    this.topologyHeartbeatTimer = setInterval(() => {
      const current = this.topology;
      if (
        !current ||
        current.rootForwarder !== (this.userInfo?.address ?? '')
      ) {
        this.stopTopologyHeartbeat();
        return;
      }
      void this.broadcastTopology(current, 'heartbeat');
    }, TOPOLOGY_HEARTBEAT_MS);
  }

  private resetRootPeerLiveness(currentRoot = ''): void {
    this.rootPeerLiveness = {
      ...buildEmptyRootPeerLivenessRecord(),
      currentRoot: currentRoot.trim(),
    };
  }

  private markRootPeerEvidence(
    addressValue: string | null | undefined,
    seenAtMs: number,
    kind:
      | 'heartbeat'
      | 'decoded-media'
      | 'verified-control'
      | 'verified-key'
      | 'speaker'
  ): void {
    const address = addressValue?.trim() ?? '';
    const currentRoot = this.topology?.rootForwarder?.trim() ?? '';
    if (!address || !currentRoot || address !== currentRoot) return;
    const effectiveSeenAt =
      seenAtMs > 0 && Number.isFinite(seenAtMs) ? seenAtMs : Date.now();
    if (this.rootPeerLiveness.currentRoot !== currentRoot) {
      this.resetRootPeerLiveness(currentRoot);
    }
    this.rootPeerLiveness.currentRoot = currentRoot;
    this.rootPeerLiveness.lastAnyRootEvidenceAt = Math.max(
      this.rootPeerLiveness.lastAnyRootEvidenceAt,
      effectiveSeenAt
    );
    switch (kind) {
      case 'heartbeat':
        this.rootPeerLiveness.lastHeartbeatAt = Math.max(
          this.rootPeerLiveness.lastHeartbeatAt,
          effectiveSeenAt
        );
        break;
      case 'decoded-media':
        this.rootPeerLiveness.lastDecodedMediaAt = Math.max(
          this.rootPeerLiveness.lastDecodedMediaAt,
          effectiveSeenAt
        );
        break;
      case 'verified-control':
        this.rootPeerLiveness.lastVerifiedControlAt = Math.max(
          this.rootPeerLiveness.lastVerifiedControlAt,
          effectiveSeenAt
        );
        break;
      case 'verified-key':
        this.rootPeerLiveness.lastVerifiedKeyAt = Math.max(
          this.rootPeerLiveness.lastVerifiedKeyAt,
          effectiveSeenAt
        );
        break;
      case 'speaker':
        this.rootPeerLiveness.lastSpeakerActivityAt = Math.max(
          this.rootPeerLiveness.lastSpeakerActivityAt,
          effectiveSeenAt
        );
        break;
    }
  }

  private noteRootHeartbeat(
    addressValue: string | null | undefined,
    seenAtMs: number
  ): void {
    this.markRootPeerEvidence(addressValue, seenAtMs, 'heartbeat');
    this.scheduleRootFailoverWatch();
  }

  private noteRootVerifiedControl(
    addressValue: string | null | undefined,
    seenAtMs: number
  ): void {
    this.markRootPeerEvidence(addressValue, seenAtMs, 'verified-control');
    this.scheduleRootFailoverWatch();
  }

  private noteRootVerifiedKey(
    addressValue: string | null | undefined,
    seenAtMs: number
  ): void {
    this.markRootPeerEvidence(addressValue, seenAtMs, 'verified-key');
    this.scheduleRootFailoverWatch();
  }

  private noteRootDecodedMedia(
    addressValue: string | null | undefined,
    seenAtMs: number
  ): void {
    this.markRootPeerEvidence(addressValue, seenAtMs, 'decoded-media');
    this.scheduleRootFailoverWatch();
  }

  private noteRootSpeakerActivity(
    addressValue: string | null | undefined,
    seenAtMs: number
  ): void {
    this.markRootPeerEvidence(addressValue, seenAtMs, 'speaker');
    this.scheduleRootFailoverWatch();
  }

  private getRootPeerLivenessSnapshot(nowMs = Date.now()): {
    currentRoot: string;
    lastHeartbeatAt: number;
    lastDecodedMediaAt: number;
    lastVerifiedControlAt: number;
    lastVerifiedKeyAt: number;
    lastSpeakerActivityAt: number;
    lastAnyRootEvidenceAt: number;
    heartbeatSilentMs: number | null;
    state: RootPeerLivenessState;
    rootPeerRequiresReconnect: boolean;
  } {
    const currentRoot = this.topology?.rootForwarder?.trim() ?? '';
    const record =
      this.rootPeerLiveness.currentRoot === currentRoot
        ? this.rootPeerLiveness
        : buildEmptyRootPeerLivenessRecord();
    const heartbeatSilentMs =
      record.lastHeartbeatAt > 0
        ? Math.max(0, nowMs - record.lastHeartbeatAt)
        : null;
    const heartbeatHealthy =
      heartbeatSilentMs !== null &&
      heartbeatSilentMs < ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS;
    const recentMediaAlive =
      (record.lastDecodedMediaAt > 0 &&
        nowMs - record.lastDecodedMediaAt <=
          ROOT_RECENT_ACTIVITY_FAILOVER_VETO_MS) ||
      (record.lastSpeakerActivityAt > 0 &&
        nowMs - record.lastSpeakerActivityAt <=
          ROOT_RECENT_ACTIVITY_FAILOVER_VETO_MS);
    const recentControlAlive =
      (record.lastVerifiedControlAt > 0 &&
        nowMs - record.lastVerifiedControlAt <=
          ROOT_RECENT_ACTIVITY_FAILOVER_VETO_MS) ||
      (record.lastVerifiedKeyAt > 0 &&
        nowMs - record.lastVerifiedKeyAt <=
          ROOT_RECENT_ACTIVITY_FAILOVER_VETO_MS);
    const recentAnyAlive =
      record.lastAnyRootEvidenceAt > 0 &&
      nowMs - record.lastAnyRootEvidenceAt <=
        ROOT_RECENT_ACTIVITY_FAILOVER_VETO_MS;

    let state: RootPeerLivenessState = 'unknown';
    if (!currentRoot) {
      state = 'unknown';
    } else if (heartbeatHealthy) {
      state = 'healthy';
    } else if (recentMediaAlive) {
      state = 'heartbeat-stale-but-media-alive';
    } else if (recentControlAlive) {
      state = 'heartbeat-stale-but-control-alive';
    } else if (recentAnyAlive) {
      state = 'suspect';
    } else if (heartbeatSilentMs !== null || record.lastAnyRootEvidenceAt > 0) {
      state = 'reconnect-required';
    }

    return {
      currentRoot,
      lastHeartbeatAt: record.lastHeartbeatAt,
      lastDecodedMediaAt: record.lastDecodedMediaAt,
      lastVerifiedControlAt: record.lastVerifiedControlAt,
      lastVerifiedKeyAt: record.lastVerifiedKeyAt,
      lastSpeakerActivityAt: record.lastSpeakerActivityAt,
      lastAnyRootEvidenceAt: record.lastAnyRootEvidenceAt,
      heartbeatSilentMs,
      state,
      rootPeerRequiresReconnect: state === 'reconnect-required',
    };
  }

  private getRootFailoverDeadlineAnchorMs(topology: GroupCallTopology): number {
    const currentRoot = topology.rootForwarder?.trim() ?? '';
    if (!currentRoot) return Date.now();
    if (this.rootPeerLiveness.currentRoot !== currentRoot) {
      return typeof topology.lastSeen === 'number' &&
        Number.isFinite(topology.lastSeen)
        ? topology.lastSeen
        : Date.now();
    }
    const candidates = [
      this.rootPeerLiveness.lastHeartbeatAt,
      this.rootPeerLiveness.lastVerifiedControlAt,
      this.rootPeerLiveness.lastVerifiedKeyAt,
      this.rootPeerLiveness.lastDecodedMediaAt,
      this.rootPeerLiveness.lastSpeakerActivityAt,
      this.rootPeerLiveness.lastAnyRootEvidenceAt,
    ].filter((value) => value > 0 && Number.isFinite(value));
    if (candidates.length > 0) {
      return Math.max(...candidates);
    }
    return typeof topology.lastSeen === 'number' &&
      Number.isFinite(topology.lastSeen)
      ? topology.lastSeen
      : Date.now();
  }

  private isCurrentRootProtectedFromRemoteTakeover(
    current: GroupCallTopology,
    nowMs: number
  ): boolean {
    const currentRoot = current.rootForwarder?.trim() ?? '';
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!currentRoot) return false;
    const rootStillInRoom =
      this.isAddressInCurrentRoster(currentRoot) ||
      this.collectTopologyAddresses(current).includes(currentRoot);
    if (!rootStillInRoom) return false;
    if (currentRoot === myAddress) {
      return this.ownsRoomKey && !this.isProvisionalLocalRootActive(nowMs);
    }
    const liveness = this.getRootPeerLivenessSnapshot(nowMs);
    return (
      liveness.currentRoot === currentRoot &&
      liveness.state !== 'unknown' &&
      !liveness.rootPeerRequiresReconnect
    );
  }

  private shouldRejectRemoteTopologyDemotingHealthyRoot(opts: {
    current: GroupCallTopology | null;
    incoming: GroupCallTopology;
    source: 'remote-event' | 'local-election';
    incomingAuthor: string;
    acceptProvisionalIncumbentTopology: boolean;
    nowMs: number;
  }): boolean {
    if (opts.source !== 'remote-event' || !opts.current) return false;
    if (opts.acceptProvisionalIncumbentTopology) return false;
    const currentRoot = opts.current.rootForwarder?.trim() ?? '';
    const incomingRoot = opts.incoming.rootForwarder?.trim() ?? '';
    if (!currentRoot || !incomingRoot || currentRoot === incomingRoot) {
      return false;
    }
    if (opts.incoming.topologyEpoch <= opts.current.topologyEpoch) {
      return false;
    }
    if (!opts.incomingAuthor || opts.incomingAuthor === currentRoot) {
      return false;
    }
    if (
      !this.isCurrentRootProtectedFromRemoteTakeover(opts.current, opts.nowMs)
    ) {
      return false;
    }
    this.recordDiagEvent('remote-topology-rejected-healthy-root-protected', {
      roomId: opts.incoming.roomId ?? this.snapshot.roomId,
      currentRoot,
      incomingRoot,
      incomingAuthor: opts.incomingAuthor || null,
      currentEpoch: opts.current.topologyEpoch,
      incomingEpoch: opts.incoming.topologyEpoch,
    });
    return true;
  }

  private scheduleRootFailoverWatch(): void {
    this.clearRootFailoverTimer();
    const topology = this.topology;
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!topology || !myAddress) return;
    const currentRoot = topology.rootForwarder?.trim() ?? '';
    if (!currentRoot || currentRoot === myAddress) return;
    if ((topology.standbyForwarder?.trim() ?? '') !== myAddress) return;
    if (this.rootPeerLiveness.currentRoot !== currentRoot) {
      this.resetRootPeerLiveness(currentRoot);
    }
    const lastSeenAt = this.getRootFailoverDeadlineAnchorMs(topology);
    const authorityConflictDelayMs =
      this.authoritySettleUntilMs > Date.now()
        ? this.authoritySettleUntilMs
        : 0;
    const delayMs = Math.max(
      250,
      Math.max(
        lastSeenAt + ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS,
        authorityConflictDelayMs
      ) - Date.now()
    );
    this.rootFailoverTimer = setTimeout(() => {
      this.rootFailoverTimer = null;
      void this.maybePromoteStandbyAfterRootHeartbeatTimeout();
    }, delayMs);
  }

  private scheduleRootFailoverWatchForDeadline(deadlineMs: number): void {
    this.clearRootFailoverTimer();
    const delayMs = Math.max(250, deadlineMs - Date.now());
    this.rootFailoverTimer = setTimeout(() => {
      this.rootFailoverTimer = null;
      void this.maybePromoteStandbyAfterRootHeartbeatTimeout();
    }, delayMs);
  }

  private async maybePromoteStandbyAfterRootHeartbeatTimeout(): Promise<void> {
    const topology = this.topology;
    const roomId = this.snapshot.roomId;
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!topology || !roomId || !myAddress) return;
    const currentRoot = topology.rootForwarder?.trim() ?? '';
    const standby = topology.standbyForwarder?.trim() ?? '';
    if (!currentRoot || currentRoot === myAddress || standby !== myAddress)
      return;
    if (this.rootPeerLiveness.currentRoot !== currentRoot) {
      this.resetRootPeerLiveness(currentRoot);
    }
    const lastSeenAt = this.getRootFailoverDeadlineAnchorMs(topology);
    const nowMs = Date.now();
    const heartbeatSilentMs =
      lastSeenAt > 0
        ? Math.max(0, nowMs - lastSeenAt)
        : ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS;
    const conflictingRoot =
      this.getConflictingRemoteRootForAuthorityWait(nowMs);
    if (conflictingRoot && nowMs < this.authoritySettleUntilMs) {
      this.recordDiagEvent(
        'root-heartbeat-timeout-suppressed-authority-conflict',
        {
          roomId,
          currentRoot,
          conflictingRemoteRoot: conflictingRoot,
          heartbeatSilentMs,
          authoritySettleUntilMs: this.authoritySettleUntilMs,
        }
      );
      this.scheduleRootFailoverWatch();
      return;
    }
    const rootLiveness = this.getRootPeerLivenessSnapshot(nowMs);
    const rootPeerRequiresReconnect = rootLiveness.rootPeerRequiresReconnect;
    const lastNonHeartbeatRootEvidenceAt = Math.max(
      0,
      ...[
        rootLiveness.lastDecodedMediaAt,
        rootLiveness.lastSpeakerActivityAt,
      ].filter((seenAtMs) => seenAtMs > rootLiveness.lastHeartbeatAt)
    );
    const rootNonHeartbeatEvidenceAgeMs =
      lastNonHeartbeatRootEvidenceAt > 0
        ? nowMs - lastNonHeartbeatRootEvidenceAt
        : Number.POSITIVE_INFINITY;
    if (
      rootPeerRequiresReconnect &&
      rootNonHeartbeatEvidenceAgeMs <= ROOT_RECENT_EVIDENCE_FAILOVER_GRACE_MS
    ) {
      this.recordDiagEvent(
        'root-heartbeat-timeout-suppressed-recent-root-evidence-grace',
        {
          roomId,
          currentRoot,
          heartbeatSilentMs,
          rootLivenessState: rootLiveness.state,
          lastNonHeartbeatRootEvidenceAgeMs: rootNonHeartbeatEvidenceAgeMs,
          graceMs: ROOT_RECENT_EVIDENCE_FAILOVER_GRACE_MS,
        }
      );
      this.scheduleRootFailoverWatch();
      return;
    }
    const topologyMemberCount = new Set(
      [
        topology.rootForwarder,
        topology.standbyForwarder,
        ...topology.clusters.flatMap((cluster) => [
          cluster.forwarder,
          cluster.standby,
          cluster.standby2,
          ...cluster.members,
        ]),
      ]
        .map((address) => address?.trim() ?? '')
        .filter(Boolean)
    ).size;
    if (rootPeerRequiresReconnect && topologyMemberCount <= 2) {
      const oneToOneGraceAnchorMs =
        this.lastJoinSuccessAtMs > lastSeenAt &&
        this.lastJoinSuccessAtMs <= nowMs
          ? this.lastJoinSuccessAtMs
          : lastSeenAt;
      const oneToOneSilentMs =
        oneToOneGraceAnchorMs > 0
          ? Math.max(0, nowMs - oneToOneGraceAnchorMs)
          : heartbeatSilentMs;
      if (oneToOneSilentMs < ROOT_ONE_TO_ONE_FAILOVER_TIMEOUT_MS) {
        this.recordDiagEvent(
          'root-heartbeat-timeout-suppressed-one-to-one-grace',
          {
            roomId,
            currentRoot,
            heartbeatSilentMs,
            heartbeatTimeoutMs: ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS,
            oneToOneSilentMs,
            oneToOneGraceAnchorMs,
            oneToOneGraceAnchor:
              oneToOneGraceAnchorMs === this.lastJoinSuccessAtMs
                ? 'join-success'
                : 'root-evidence',
            oneToOneTimeoutMs: ROOT_ONE_TO_ONE_FAILOVER_TIMEOUT_MS,
            rootLivenessState: rootLiveness.state,
          }
        );
        this.scheduleRootFailoverWatchForDeadline(
          oneToOneGraceAnchorMs + ROOT_ONE_TO_ONE_FAILOVER_TIMEOUT_MS
        );
        return;
      }
      if (this.awaitingAuthoritativeKey) {
        this.recordDiagEvent(
          'root-heartbeat-timeout-suppressed-awaiting-authoritative-key',
          {
            roomId,
            currentRoot,
            heartbeatSilentMs,
            rootLivenessState: rootLiveness.state,
          }
        );
        this.scheduleRootFailoverWatchForDeadline(
          nowMs + ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS
        );
        return;
      }
      this.recordDiagEvent(
        'root-heartbeat-timeout-two-party-deterministic-resync',
        {
          roomId,
          currentRoot,
          heartbeatSilentMs,
          oneToOneSilentMs,
          rootLivenessState: rootLiveness.state,
        }
      );
      await this.forceTwoPartyDeterministicTopologyResync(
        currentRoot,
        'root-heartbeat-timeout'
      );
      this.scheduleRootFailoverWatchForDeadline(
        nowMs + ROOT_ONE_TO_ONE_FAILOVER_TIMEOUT_MS
      );
      return;
    }
    if (this.awaitingAuthoritativeKey) {
      this.recordDiagEvent(
        'root-heartbeat-timeout-suppressed-awaiting-authoritative-key',
        {
          roomId,
          currentRoot,
          heartbeatSilentMs,
          rootLivenessState: rootLiveness.state,
        }
      );
      this.scheduleRootFailoverWatchForDeadline(
        nowMs + ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS
      );
      return;
    }
    if (
      !shouldPromoteStandbyRootAfterHeartbeatTimeout({
        heartbeatSilentMs,
        heartbeatTimeoutMs: ROOT_HEARTBEAT_FAILOVER_TIMEOUT_MS,
        rootPeerRequiresReconnect,
      })
    ) {
      if (!rootPeerRequiresReconnect) {
        this.recordDiagEvent(
          'root-heartbeat-timeout-suppressed-recent-root-activity',
          {
            roomId,
            currentRoot,
            heartbeatSilentMs,
            rootLivenessState: rootLiveness.state,
          }
        );
      }
      this.scheduleRootFailoverWatch();
      return;
    }
    const survivingAddresses = this.collectTopologyElectionAddresses(nowMs, {
      excludeAddress: currentRoot,
    });
    survivingAddresses.add(myAddress);
    const sorted = await this.computeElectionOrder(
      [...survivingAddresses],
      roomId
    );
    const topologyEpoch =
      Math.max(
        this.topology?.topologyEpoch ?? 0,
        this.lastObservedTopologyEpoch ?? 0
      ) + 1;
    const promoted = normalizeGroupCallTopology({
      ...buildTopologyWithTrustedRoot(sorted, topologyEpoch, myAddress),
      roomId,
      lastSeen: nowMs,
    });
    const failoverTopology = normalizeGroupCallTopology(
      buildStandbyRootFailoverTopology({
        promotedTopology: promoted,
        sortedAddresses: sorted,
        deadRoot: currentRoot,
        myAddress,
        nowMs,
      })
    );
    this.recordDiagEvent('root-heartbeat-timeout-failover', {
      roomId,
      deadRoot: currentRoot,
      topologyEpoch,
      heartbeatSilentMs,
    });
    const applied = await this.applyTopology(
      failoverTopology,
      'local-election'
    );
    if (applied) {
      await this.receiveEngine.configure({
        postFailoverRootHoldUntilMs:
          nowMs + POST_FAILOVER_ROOT_RECEIVE_PROTECTION_MS,
      });
      await this.broadcastTopology(failoverTopology, 'root-heartbeat-timeout');
    }
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
      const adoptingExistingRoomKey =
        !hadOwnRoomKey && previousRoomKey !== null;
      const nextRoomKey =
        hadOwnRoomKey || adoptingExistingRoomKey
          ? previousRoomKey
          : randomRoomKey();
      this.roomKey = nextRoomKey;
      this.ownsRoomKey = true;
      this.selfMintedRoomKey = !adoptingExistingRoomKey;
      this.awaitingAuthoritativeKey = false;
      this.markRoomKeyLocallyEnsured();
      await this.markLocalRoomKeyApplied(nextRoomKey);
      this.resetWorkerDecodeFailureRecoveryState();
      this.clearKeyRecoveryRetryTimer();
      if (!hadOwnRoomKey && !adoptingExistingRoomKey) {
        this.callEpochMs = Date.now();
        this.seq = 0;
        this.resetOutboundMediaDiagnostics();
        await this.syncDecryptPoolRoomKey(nextRoomKey);
      }
      await this.distributeRoomKey(nextRoomKey);
      await this.syncSenderState();
      traceGcallAudioSurface('pipeline: root authority ensured room key', {
        roomId: this.snapshot.roomId,
        topologyEpoch: nextTopology.topologyEpoch,
        rotated: !hadOwnRoomKey && !adoptingExistingRoomKey,
        adoptedExistingRoomKey: adoptingExistingRoomKey,
      });
      this.recordDiagEvent('root-authority-ensured-room-key', {
        roomId: this.snapshot.roomId,
        topologyEpoch: nextTopology.topologyEpoch,
        rotated: !hadOwnRoomKey && !adoptingExistingRoomKey,
        adoptedExistingRoomKey: adoptingExistingRoomKey,
      });
      return;
    }
    const remoteRootChanged =
      previousRoot.length > 0 &&
      previousRoot !== root &&
      previousRoot !== myAddress;
    if (remoteRootChanged) {
      if (this.roomKey) {
        this.retainDemotedRootKeyForTransfer('remote-root-changed');
      } else {
        this.appliedRoomKeyCommitment = '';
      }
      this.ownsRoomKey = false;
      this.selfMintedRoomKey = false;
      this.awaitingAuthoritativeKey = true;
      await this.syncSenderState();
      this.requestRetainedKeyReplay('topology-root-changed');
      await this.requestRoomKeyFrom(root, 'topology');
      this.scheduleAuthoritativeKeyRecovery('topology-root-changed');
      return;
    }
    if (previousRoot === myAddress) {
      this.ownsRoomKey = false;
    }
    if (previousRoot === myAddress && this.selfMintedRoomKey) {
      this.retainDemotedRootKeyForTransfer('self-minted-root-changed');
      this.selfMintedRoomKey = false;
      this.awaitingAuthoritativeKey = true;
      await this.syncSenderState();
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
        typeof topology.lastSeen === 'number' &&
        Number.isFinite(topology.lastSeen)
          ? topology.lastSeen
          : Date.now(),
    });
    const current = this.topology;
    const nowMs = Date.now();
    const incomingRoot = normalized.rootForwarder?.trim() ?? '';
    const incomingAuthor =
      (topology as unknown as { fromAddress?: string }).fromAddress?.trim() ??
      '';
    const myAddress = this.userInfo?.address ?? '';
    const acceptProvisionalIncumbentTopology =
      source === 'remote-event' &&
      current?.rootForwarder?.trim() === myAddress.trim() &&
      this.canReconcileProvisionalLocalRootWithRemote(incomingRoot, nowMs);
    const acceptRemoteAuthorityOverLocalRoot =
      source === 'remote-event' &&
      Boolean(current) &&
      current?.rootForwarder?.trim() === myAddress.trim() &&
      Boolean(incomingRoot) &&
      incomingRoot !== myAddress.trim() &&
      this.countRemoteParticipants() >= 2 &&
      this.isAddressInCurrentRoster(incomingRoot);
    if (
      this.shouldRejectRemoteTopologyDemotingHealthyRoot({
        current,
        incoming: normalized,
        source,
        incomingAuthor,
        acceptProvisionalIncumbentTopology,
        nowMs,
      })
    ) {
      return false;
    }
    if (
      current &&
      normalized.topologyEpoch < current.topologyEpoch &&
      !acceptProvisionalIncumbentTopology &&
      !acceptRemoteAuthorityOverLocalRoot
    ) {
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
      normalized.topologyEpoch < current.topologyEpoch &&
      acceptRemoteAuthorityOverLocalRoot
    ) {
      this.recordDiagEvent('local-root-demoted-by-stale-remote-topology', {
        roomId: normalized.roomId,
        incomingRoot: truncateGcallDiagAddress(incomingRoot),
        incomingEpoch: normalized.topologyEpoch,
        currentEpoch: current.topologyEpoch,
        participantCount: this.snapshot.participants.length,
      });
    }
    if (
      current &&
      normalized.topologyEpoch === current.topologyEpoch &&
      normalized.rootForwarder !== current.rootForwarder &&
      !acceptProvisionalIncumbentTopology
    ) {
      const winner = chooseSameEpochTopologyWinner(
        current,
        normalized,
        this.snapshot.roomId,
        this.electionDigestCache
      );
      if (!winner.acceptIncoming) {
        this.noteConflictingRemoteRoot(
          normalized.rootForwarder,
          normalized.lastSeen ?? Date.now(),
          'same-epoch-topology'
        );
        traceGcallAudioSurface(
          'pipeline: topology rejected by same-epoch authority',
          {
            roomId: normalized.roomId,
            source,
            epoch: normalized.topologyEpoch,
            incomingRoot: normalized.rootForwarder,
            currentRoot: current.rootForwarder,
            reason: winner.reason,
          }
        );
        return false;
      }
    }
    if (acceptProvisionalIncumbentTopology) {
      this.recordDiagEvent('provisional-local-root-demoted-by-topology', {
        roomId: normalized.roomId,
        incomingRoot: truncateGcallDiagAddress(incomingRoot),
        incomingEpoch: normalized.topologyEpoch,
        currentEpoch: current?.topologyEpoch ?? null,
        provisionalRemainingMs: Math.max(
          0,
          this.provisionalLocalRootUntilMs - nowMs
        ),
      });
    }
    if (source === 'remote-event') {
      this.promoteBootstrapOnlyParticipantsFromTopology(normalized);
    }
    this.lastObservedTopologyEpoch = Math.max(
      this.lastObservedTopologyEpoch,
      normalized.topologyEpoch >>> 0
    );
    if (
      normalized.rootForwarder?.trim() &&
      normalized.rootForwarder !== myAddress
    ) {
      this.updateTrustedRemoteRoot(
        normalized.rootForwarder,
        normalized.lastSeen ?? Date.now()
      );
      this.clearConflictingRemoteRootIfMatches(normalized.rootForwarder);
      this.topologyElectionDelayUntilMs = 0;
      this.clearProvisionalLocalRoot();
    } else if (
      normalized.rootForwarder?.trim() === myAddress ||
      source === 'local-election'
    ) {
      this.resetRootAuthorityTracking();
      this.resetRootPeerLiveness();
      this.topologyElectionDelayUntilMs = 0;
    }
    if (this.isSameTopologyStructure(current, normalized)) {
      this.topology = {
        ...normalized,
        roomId: this.snapshot.roomId,
      };
      if (
        this.topology.rootForwarder?.trim() &&
        this.topology.rootForwarder !== myAddress
      ) {
        this.noteRootHeartbeat(
          this.topology.rootForwarder,
          this.topology.lastSeen ?? Date.now()
        );
        this.noteRootVerifiedControl(
          this.topology.rootForwarder,
          this.topology.lastSeen ?? Date.now()
        );
      }
      await this.maybeReplayRetainedKeysAfterTopology(this.topology);
      await this.syncTopologyHeartbeat();
      return false;
    }

    const previousRoot = current?.rootForwarder?.trim() ?? '';
    const topologyTransitionChanged =
      Boolean(current) &&
      (current?.rootForwarder !== normalized.rootForwarder ||
        current?.topologyEpoch !== normalized.topologyEpoch);
    this.topology = {
      ...normalized,
      roomId: this.snapshot.roomId,
    };
    if (topologyTransitionChanged) {
      this.topologyElectionDelayUntilMs = Math.max(
        this.topologyElectionDelayUntilMs,
        Date.now() + OCCUPIED_JOIN_AUTHORITY_WAIT_MS
      );
    }
    if (
      this.topology.rootForwarder?.trim() &&
      this.topology.rootForwarder !== myAddress
    ) {
      this.noteRootHeartbeat(
        this.topology.rootForwarder,
        this.topology.lastSeen ?? Date.now()
      );
      this.noteRootVerifiedControl(
        this.topology.rootForwarder,
        this.topology.lastSeen ?? Date.now()
      );
    }
    this.snapshot = {
      ...this.snapshot,
      participants: this.mergeParticipantsFromTopology(
        this.snapshot.participants,
        this.topology
      ),
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
    await this.refreshAuthoritativeParticipantRoster('topology-applied');
    await this.maybeReplayRetainedKeysAfterTopology(this.topology);
    await this.syncTopologyHeartbeat();
    await this.ensureRoomKeyAuthorityForTopology(previousRoot, this.topology);
    await this.syncSenderState();
    return true;
  }

  private updateTrustedRemoteRoot(
    rootForwarder: string,
    seenAtMs: number
  ): void {
    const nextRoot = rootForwarder.trim();
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!nextRoot || nextRoot === myAddress) {
      this.resetRootAuthorityTracking();
      return;
    }
    this.trustedRemoteRoot = nextRoot;
    this.trustedRemoteRootLastSeenAt =
      seenAtMs > 0 && Number.isFinite(seenAtMs) ? seenAtMs : Date.now();
  }

  private resetRootAuthorityTracking(): void {
    this.trustedRemoteRoot = '';
    this.trustedRemoteRootLastSeenAt = 0;
    this.conflictingRemoteRoot = '';
    this.conflictingRemoteRootLastSeenAt = 0;
    this.authoritySettleUntilMs = 0;
  }

  private clearTrustedRemoteRootIfMatches(
    rootForwarder: string | null | undefined
  ): void {
    const root = rootForwarder?.trim() ?? '';
    if (!root || this.trustedRemoteRoot !== root) return;
    this.trustedRemoteRoot = '';
    this.trustedRemoteRootLastSeenAt = 0;
  }

  private clearConflictingRemoteRootIfMatches(
    rootForwarder: string | null | undefined
  ): void {
    const root = rootForwarder?.trim() ?? '';
    if (!root || this.conflictingRemoteRoot !== root) return;
    this.conflictingRemoteRoot = '';
    this.conflictingRemoteRootLastSeenAt = 0;
    this.authoritySettleUntilMs = 0;
    this.topologyElectionDelayUntilMs = Math.min(
      this.topologyElectionDelayUntilMs,
      Date.now()
    );
    this.scheduleRootFailoverWatch();
  }

  private noteConflictingRemoteRoot(
    rootForwarder: string | null | undefined,
    seenAtMs: number,
    reason: 'heartbeat' | 'same-epoch-topology' | 'verified-key'
  ): void {
    const nextRoot = rootForwarder?.trim() ?? '';
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const currentRoot = this.topology?.rootForwarder?.trim() ?? '';
    if (!nextRoot || nextRoot === myAddress || nextRoot === currentRoot) return;
    const effectiveSeenAt =
      seenAtMs > 0 && Number.isFinite(seenAtMs) ? seenAtMs : Date.now();
    this.conflictingRemoteRoot = nextRoot;
    this.conflictingRemoteRootLastSeenAt = Math.max(
      this.conflictingRemoteRootLastSeenAt,
      effectiveSeenAt
    );
    this.authoritySettleUntilMs = Math.max(
      this.authoritySettleUntilMs,
      effectiveSeenAt + CONFLICTING_REMOTE_ROOT_AUTHORITY_SETTLE_MS
    );
    this.topologyElectionDelayUntilMs = Math.max(
      this.topologyElectionDelayUntilMs,
      this.authoritySettleUntilMs
    );
    this.recordDiagEvent('conflicting-remote-root-observed', {
      roomId: this.snapshot.roomId,
      currentRoot,
      conflictingRemoteRoot: nextRoot,
      reason,
      authoritySettleUntilMs: this.authoritySettleUntilMs,
    });
    this.scheduleTopologyElection('authority-conflict');
    this.scheduleRootFailoverWatch();
  }

  private getConflictingRemoteRootForAuthorityWait(
    nowMs = Date.now(),
    rosterAddresses?: Iterable<string>
  ): string | null {
    const addresses =
      rosterAddresses ??
      new Set<string>([
        ...this.snapshot.participants
          .map((participant) => participant.address?.trim() ?? '')
          .filter(Boolean),
        this.userInfo?.address?.trim() ?? '',
        this.topology?.rootForwarder?.trim() ?? '',
        this.topology?.standbyForwarder?.trim() ?? '',
      ]);
    return getConflictingRootForAuthorityWait({
      currentRoot: this.topology?.rootForwarder,
      conflictingRemoteRoot: this.conflictingRemoteRoot,
      conflictingRemoteRootLastSeenAtMs: this.conflictingRemoteRootLastSeenAt,
      nowMs,
      staleAfterMs: TRUSTED_REMOTE_ROOT_STICKY_REJOIN_MS,
      rosterAddresses: addresses,
    });
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
      traceGcallAudioSurface(
        'pipeline: failed to sync qortal reticulum targets',
        {
          roomId,
          groupId,
          message: error instanceof Error ? error.message : 'unknown',
        }
      );
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

  private startParticipantRosterRefresh(roomId: string): void {
    this.clearParticipantRosterRefreshTimer();
    this.participantRosterRefreshTimer = setInterval(() => {
      if (this.snapshot.roomId !== roomId) return;
      void this.refreshAuthoritativeParticipantRoster('periodic');
    }, PARTICIPANT_ROSTER_REFRESH_INTERVAL_MS);
  }

  private clearParticipantRosterRefreshTimer(): void {
    if (this.participantRosterRefreshTimer) {
      clearInterval(this.participantRosterRefreshTimer);
      this.participantRosterRefreshTimer = null;
    }
  }

  private async refreshAuthoritativeParticipantRoster(
    reason:
      | 'periodic'
      | 'topology-applied'
      | 'local-topology-election-suppressed-unchanged'
      | 'live-media-evidence'
  ): Promise<void> {
    const roomId = this.snapshot.roomId;
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const api = window.groupCall?.getRoomParticipants;
    if (!roomId || !myAddress || typeof api !== 'function') return;
    const roster = await api(roomId).catch(() => null);
    if (roomId !== this.snapshot.roomId || !Array.isArray(roster)) return;

    const rosterByAddress = new Map<string, { publicKey: string }>();
    for (const participant of roster) {
      const address = participant?.address?.trim?.() ?? '';
      if (!address) continue;
      if (this.shouldSuppressRecentlyLeftParticipant(address)) {
        continue;
      }
      rosterByAddress.set(address, {
        publicKey: participant?.publicKey?.trim?.() ?? '',
      });
      this.bootstrapOnlyParticipantAddresses.delete(address);
      this.participantRosterMissingSinceMs.delete(address);
    }
    this.participantRosterMissingSinceMs.delete(myAddress);

    let nextParticipants = this.snapshot.participants;
    const removedAddresses: string[] = [];
    const now = Date.now();
    for (const participant of this.snapshot.participants) {
      const address = participant.address?.trim() ?? '';
      if (!address || address === myAddress) continue;
      if (rosterByAddress.has(address)) continue;
      if (this.hasRecentParticipantActivityEvidence(address, now)) {
        this.participantRosterMissingSinceMs.delete(address);
        continue;
      }
      const missingSince =
        this.participantRosterMissingSinceMs.get(address) ?? now;
      this.participantRosterMissingSinceMs.set(address, missingSince);
      if (now - missingSince < PARTICIPANT_ROSTER_MISSING_EVICT_MS) continue;
      removedAddresses.push(address);
      nextParticipants = nextParticipants.filter(
        (current) => current.address !== address
      );
    }

    let addedAny = false;
    for (const [address, { publicKey }] of rosterByAddress) {
      if (address === myAddress) continue;
      const existing = nextParticipants.find(
        (participant) => participant.address === address
      );
      if (existing) {
        if (publicKey && existing.publicKey !== publicKey) {
          nextParticipants = nextParticipants.map((participant) =>
            participant.address === address
              ? { ...participant, publicKey }
              : participant
          );
        }
        continue;
      }
      addedAny = true;
      nextParticipants = this.withTopologyRoles([
        ...nextParticipants,
        { address, publicKey, speaking: false, role: 'participant' },
      ]);
    }

    if (
      removedAddresses.length === 0 &&
      !addedAny &&
      nextParticipants === this.snapshot.participants
    ) {
      return;
    }

    for (const address of removedAddresses) {
      this.bootstrapOnlyParticipantAddresses.delete(address);
      this.participantJoinIdentityByAddress.delete(address);
      await this.resetReceiveStateForParticipant(
        address,
        'authoritative-roster-remove'
      );
      this.markParticipantRecentlyLeft(address);
      if ((this.topology?.rootForwarder?.trim() ?? '') === address) {
        if (this.trustedRemoteRoot === address) {
          this.clearTrustedRemoteRootIfMatches(address);
        }
        this.resetRootPeerLiveness();
      } else if (this.conflictingRemoteRoot === address) {
        this.clearConflictingRemoteRootIfMatches(address);
      }
    }

    this.snapshot = {
      ...this.snapshot,
      participants: this.withTopologyRoles(nextParticipants),
    };
    this.refreshActiveSpeakerState();
    this.recordDiagEvent('authoritative-roster-refreshed', {
      roomId,
      reason,
      participantCount: this.snapshot.participants.length,
      removedCount: removedAddresses.length,
      addedCount: addedAny ? 1 : 0,
    });
    if (removedAddresses.length > 0) {
      this.scheduleTopologyElection('authoritative-roster-refresh');
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
      if (packet.sourceAddr) {
        this.upsertParticipantFromRuntimeEvent(packet.sourceAddr);
        this.noteParticipantDecodedMedia(packet.sourceAddr, now);
        this.noteRootDecodedMedia(packet.sourceAddr, now);
      }
      if (!packet.vad || !packet.sourceAddr) continue;
      this.noteRootSpeakerActivity(packet.sourceAddr, now);
      this.activeSpeakerLastSeenAt.set(packet.sourceAddr, now);
      sawVad = true;
    }
    if (!sawVad) return;
    this.refreshActiveSpeakerState(now);
    this.scheduleActiveSpeakerRefresh(now);
  }

  private noteParticipantDecodedMedia(
    addressValue: string | null | undefined,
    seenAtMs: number
  ): void {
    const address = addressValue?.trim() ?? '';
    if (!address) return;
    const effectiveSeenAt =
      seenAtMs > 0 && Number.isFinite(seenAtMs) ? seenAtMs : Date.now();
    this.participantDecodedMediaLastSeenAt.set(
      address,
      Math.max(
        this.participantDecodedMediaLastSeenAt.get(address) ?? 0,
        effectiveSeenAt
      )
    );
    this.noteParticipantLiveEvidence(address, effectiveSeenAt);
  }

  private noteParticipantLiveEvidence(
    addressValue: string | null | undefined,
    seenAtMs: number
  ): void {
    const address = addressValue?.trim() ?? '';
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!address || address === myAddress) return;
    if (this.shouldSuppressRecentlyLeftParticipant(address)) return;
    const effectiveSeenAt =
      seenAtMs > 0 && Number.isFinite(seenAtMs) ? seenAtMs : Date.now();
    const wasInRoster = this.snapshot.participants.some(
      (participant) => participant.address?.trim() === address
    );
    const wasInTopology = this.collectTopologyAddresses(this.topology).includes(
      address
    );
    this.bootstrapOnlyParticipantAddresses.delete(address);
    this.participantLiveEvidenceLastSeenAt.set(
      address,
      Math.max(
        this.participantLiveEvidenceLastSeenAt.get(address) ?? 0,
        effectiveSeenAt
      )
    );
    if (!wasInRoster) {
      this.upsertParticipantFromRuntimeEvent(address);
    }
    if (!wasInRoster || !wasInTopology) {
      const lastElectionAt =
        this.liveEvidenceTopologyElectionLastAt.get(address) ?? 0;
      if (
        effectiveSeenAt - lastElectionAt >=
        LIVE_EVIDENCE_TOPOLOGY_ELECTION_MIN_MS
      ) {
        this.liveEvidenceTopologyElectionLastAt.set(address, effectiveSeenAt);
        this.recordDiagEvent('live-evidence-topology-election-requested', {
          roomId: this.snapshot.roomId,
          address: truncateGcallDiagAddress(address),
          wasInRoster,
          wasInTopology,
          topologyEpoch: this.topology?.topologyEpoch ?? null,
        });
        this.scheduleTopologyElection('live-media-evidence');
        void this.refreshAuthoritativeParticipantRoster('live-media-evidence');
      }
    }
  }

  private collectTopologyAddresses(
    topology: GroupCallTopology | null
  ): string[] {
    if (!topology) return [];
    const addresses = new Set<string>();
    const add = (addressValue: string | null | undefined): void => {
      const address = addressValue?.trim() ?? '';
      if (address) addresses.add(address);
    };
    add(topology.rootForwarder);
    add(topology.standbyForwarder);
    for (const cluster of topology.clusters) {
      add(cluster.forwarder);
      add(cluster.standby);
      add(cluster.standby2 ?? '');
      for (const member of cluster.members) add(member);
    }
    return [...addresses];
  }

  private collectRecentLiveParticipantAddresses(nowMs: number): string[] {
    const addresses = new Set<string>();
    const addRecent = (address: string, seenAtMs: number): void => {
      const normalized = address.trim();
      if (
        !normalized ||
        this.shouldSuppressRecentlyLeftParticipant(normalized) ||
        seenAtMs <= 0 ||
        !Number.isFinite(seenAtMs) ||
        nowMs - seenAtMs > PARTICIPANT_RECENT_ACTIVITY_EVICT_VETO_MS
      ) {
        return;
      }
      addresses.add(normalized);
    };
    for (const [address, seenAtMs] of this.participantLiveEvidenceLastSeenAt) {
      addRecent(address, seenAtMs);
    }
    for (const [address, seenAtMs] of this.participantDecodedMediaLastSeenAt) {
      addRecent(address, seenAtMs);
    }
    for (const [address, seenAtMs] of this.activeSpeakerLastSeenAt) {
      addRecent(address, seenAtMs);
    }
    return [...addresses];
  }

  private collectTopologyElectionAddresses(
    nowMs: number,
    opts?: { excludeAddress?: string | null }
  ): Set<string> {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const excluded = opts?.excludeAddress?.trim() ?? '';
    const addresses = new Set<string>();
    const add = (addressValue: string | null | undefined): void => {
      const address = addressValue?.trim() ?? '';
      if (
        !address ||
        address === excluded ||
        this.shouldSuppressRecentlyLeftParticipant(address)
      ) {
        return;
      }
      addresses.add(address);
    };
    for (const participant of this.snapshot.participants) {
      add(participant.address);
    }
    for (const address of this.collectTopologyAddresses(this.topology)) {
      add(address);
    }
    for (const address of this.collectRecentLiveParticipantAddresses(nowMs)) {
      add(address);
    }
    add(myAddress);
    return addresses;
  }

  private promoteBootstrapOnlyParticipantsFromTopology(
    topology: GroupCallTopology
  ): void {
    const addresses = new Set<string>();
    const add = (addressValue: string | null | undefined): void => {
      const address = addressValue?.trim() ?? '';
      if (address) addresses.add(address);
    };
    add(topology.rootForwarder);
    add(topology.standbyForwarder);
    for (const cluster of topology.clusters) {
      add(cluster.forwarder);
      add(cluster.standby);
      add(cluster.standby2 ?? '');
      for (const member of cluster.members) add(member);
    }
    for (const address of addresses) {
      this.bootstrapOnlyParticipantAddresses.delete(address);
    }
  }

  private isBootstrapOnlyParticipant(
    addressValue: string | null | undefined
  ): boolean {
    const address = addressValue?.trim() ?? '';
    return Boolean(
      address && this.bootstrapOnlyParticipantAddresses.has(address)
    );
  }

  private filterBootstrapOnlyMediaTargets(targets: string[]): string[] {
    const filtered: string[] = [];
    const skipped: string[] = [];
    for (const target of targets) {
      const address = target.trim();
      if (!address) continue;
      if (this.isBootstrapOnlyParticipant(address)) {
        skipped.push(address);
        continue;
      }
      filtered.push(address);
    }
    const nowMs = Date.now();
    if (
      skipped.length > 0 &&
      nowMs - this.bootstrapOnlyMediaTargetSkipLastDiagAt > 1_000
    ) {
      this.bootstrapOnlyMediaTargetSkipLastDiagAt = nowMs;
      this.recordDiagEvent('bootstrap-only-media-targets-skipped', {
        roomId: this.snapshot.roomId,
        skippedCount: skipped.length,
        skipped: skipped.map((address) => truncateGcallDiagAddress(address)),
      });
    }
    return filtered;
  }

  private getRecentLiveMediaFallbackTargets(nowMs: number): string[] {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!myAddress) return [];
    const candidates = new Set<string>();
    for (const participant of this.snapshot.participants) {
      const address = participant.address?.trim() ?? '';
      if (address && address !== myAddress) candidates.add(address);
    }
    for (const address of this.collectTopologyAddresses(this.topology)) {
      if (address && address !== myAddress) candidates.add(address);
    }
    for (const address of this.collectRecentLiveParticipantAddresses(nowMs)) {
      if (address && address !== myAddress) candidates.add(address);
    }
    const targets = [...candidates].filter((address) =>
      this.hasRecentParticipantActivityEvidence(address, nowMs)
    );
    return this.filterBootstrapOnlyMediaTargets(targets);
  }

  private shouldWaitForStartupMediaTargets(nowMs: number): boolean {
    if (
      !this.snapshot.roomId ||
      !this.topology ||
      this.lastJoinSuccessAtMs <= 0
    ) {
      return false;
    }
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!myAddress) return false;
    const remoteCandidates = new Set<string>();
    for (const participant of this.snapshot.participants) {
      const address = participant.address?.trim() ?? '';
      if (address && address !== myAddress) remoteCandidates.add(address);
    }
    for (const address of this.collectTopologyAddresses(this.topology)) {
      if (address && address !== myAddress) remoteCandidates.add(address);
    }
    const settleMs =
      remoteCandidates.size > 0
        ? STARTUP_MEDIA_TARGET_SETTLE_MS
        : STARTUP_EMPTY_TARGET_SETTLE_MS;
    return nowMs - this.lastJoinSuccessAtMs <= settleMs;
  }

  private recordStartupMediaTargetWait(nowMs: number): void {
    this.outboundLastSkipAtMs = nowMs;
    this.outboundLastSkipReason = 'startup-target-wait';
    if (nowMs - this.startupMediaTargetWaitLastDiagAt <= 1_000) return;
    this.startupMediaTargetWaitLastDiagAt = nowMs;
    this.recordDiagEvent('outbound-media-startup-target-wait', {
      roomId: this.snapshot.roomId,
      topologyEpoch: this.topology?.topologyEpoch ?? 0,
      sinceJoinMs: Math.max(0, nowMs - this.lastJoinSuccessAtMs),
    });
  }

  private hasRecentParticipantActivityEvidence(
    addressValue: string | null | undefined,
    nowMs: number
  ): boolean {
    const address = addressValue?.trim() ?? '';
    if (!address) return false;
    const lastLiveEvidenceAt =
      this.participantLiveEvidenceLastSeenAt.get(address) ?? 0;
    if (
      lastLiveEvidenceAt > 0 &&
      nowMs - lastLiveEvidenceAt <= PARTICIPANT_RECENT_ACTIVITY_EVICT_VETO_MS
    ) {
      return true;
    }
    const lastDecodedMediaAt =
      this.participantDecodedMediaLastSeenAt.get(address) ?? 0;
    if (
      lastDecodedMediaAt > 0 &&
      nowMs - lastDecodedMediaAt <= PARTICIPANT_RECENT_ACTIVITY_EVICT_VETO_MS
    ) {
      return true;
    }
    const lastSpeakerAt = this.activeSpeakerLastSeenAt.get(address) ?? 0;
    if (
      lastSpeakerAt > 0 &&
      nowMs - lastSpeakerAt <= PARTICIPANT_RECENT_ACTIVITY_EVICT_VETO_MS
    ) {
      return true;
    }
    const rootLiveness = this.getRootPeerLivenessSnapshot(nowMs);
    return (
      rootLiveness.currentRoot === address &&
      rootLiveness.lastAnyRootEvidenceAt > 0 &&
      nowMs - rootLiveness.lastAnyRootEvidenceAt <=
        PARTICIPANT_RECENT_ACTIVITY_EVICT_VETO_MS
    );
  }

  private noteLocalVadActivity(vad: boolean): void {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    if (!myAddress) return;
    if (vad) {
      const now = Date.now();
      this.activeSpeakerLastSeenAt.set(myAddress, now);
      this.refreshActiveSpeakerState(now);
      this.scheduleActiveSpeakerRefresh(now);
      return;
    }
    if (!this.activeSpeakerLastSeenAt.has(myAddress)) return;
    this.activeSpeakerLastSeenAt.delete(myAddress);
    this.refreshActiveSpeakerState();
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
    this.activeSpeakerRefreshTimer = setTimeout(
      () => {
        this.activeSpeakerRefreshTimer = null;
        this.refreshActiveSpeakerState();
        if (this.snapshot.activeSpeakers.length > 0) {
          this.scheduleActiveSpeakerRefresh();
        }
      },
      Math.max(50, nextDelay)
    );
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

  private async getAuthoritativeRecipients(): Promise<
    Map<string, { publicKey: string }>
  > {
    const recipients = new Map<string, { publicKey: string }>();
    const mainRoster = await window.groupCall?.getRoomParticipants?.(
      this.snapshot.roomId
    );
    const mainRosterAddresses = new Set<string>();
    for (const participant of mainRoster ?? []) {
      const address = participant?.address?.trim?.() ?? '';
      if (address) mainRosterAddresses.add(address);
    }
    for (const participant of this.snapshot.participants) {
      const address = participant.address?.trim() ?? '';
      if (
        this.isBootstrapOnlyParticipant(address) &&
        !mainRosterAddresses.has(address)
      ) {
        continue;
      }
      setRosterPublicKey(
        recipients,
        participant.address,
        participant.publicKey
      );
    }
    for (const participant of mainRoster ?? []) {
      setRosterPublicKey(
        recipients,
        participant?.address,
        participant?.publicKey
      );
    }
    return recipients;
  }

  private async maybeSendRoomKeyToJoiningParticipant(
    address: string | null | undefined,
    publicKey: string | null | undefined
  ): Promise<void> {
    const myAddress = this.userInfo?.address?.trim() ?? '';
    const root = this.topology?.rootForwarder?.trim() ?? '';
    const nextAddress = address?.trim() ?? '';
    const nextPublicKey = publicKey?.trim() ?? '';
    if (
      !myAddress ||
      !this.roomKey ||
      !nextAddress ||
      nextAddress === myAddress ||
      root !== myAddress
    ) {
      return;
    }
    if (!nextPublicKey) {
      this.scheduleRoomKeyDistributionRetry(
        'participant-joined-missing-public-key'
      );
      return;
    }
    await this.sendTargetedRoomKey(
      this.roomKey,
      nextAddress,
      nextPublicKey,
      'participant-joined'
    );
    this.scheduleTargetedRoomKeyReplayRetry(
      nextAddress,
      nextPublicKey,
      'participant-joined'
    );
  }

  private async distributeRoomKey(roomKey: Uint8Array): Promise<void> {
    if (!this.userInfo?.address || !this.snapshot.roomId || !this.callSessionId)
      return;
    const recipients = await this.getAuthoritativeRecipients();
    const { encryptedKeys, omittedAddresses, failedAddresses } =
      encryptRoomKeyForRecipients(roomKey, recipients, this.userInfo.address);
    const recipientAddrs = Object.keys(encryptedKeys);
    if (recipientAddrs.length === 0) {
      this.recordDiagEvent('room-key-distribution-skipped', {
        roomId: this.snapshot.roomId,
        recipientCount: recipients.size,
        omittedCount: omittedAddresses.length,
        failedCount: failedAddresses.length,
        hasRemoteParticipantEvidence: this.hasRemoteParticipantEvidence(),
      });
      if (
        omittedAddresses.length > 0 ||
        failedAddresses.length > 0 ||
        this.hasRemoteParticipantEvidence()
      ) {
        this.scheduleRoomKeyDistributionRetry('no-encrypted-recipients');
      }
      return;
    }
    for (const recipientAddress of recipientAddrs) {
      const publicKey = recipients.get(recipientAddress)?.publicKey;
      if (publicKey) {
        await this.sendTargetedRoomKey(
          roomKey,
          recipientAddress,
          publicKey,
          'room-key-distribution'
        );
      }
    }
    this.recordDiagEvent('room-key-targeted-distribution-sent', {
      roomId: this.snapshot.roomId,
      recipientCount: recipientAddrs.length,
      omittedCount: omittedAddresses.length,
      failedCount: failedAddresses.length,
      callSessionId: this.callSessionId,
      mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
    });
    for (const recipientAddress of recipientAddrs) {
      this.scheduleTargetedRoomKeyReplayRetry(
        recipientAddress,
        recipients.get(recipientAddress)?.publicKey,
        'room-key-distribution'
      );
    }
    if (omittedAddresses.length > 0 || failedAddresses.length > 0) {
      this.scheduleRoomKeyDistributionRetry('partial-recipient-set');
    }
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
    if (this.isBootstrapOnlyParticipant(toAddress)) {
      this.recordDiagEvent('bootstrap-only-key-request-skipped', {
        roomId: this.snapshot.roomId,
        toAddress: truncateGcallDiagAddress(toAddress),
        reason,
      });
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
      callSessionId: this.callSessionId,
      mediaSessionGeneration: this.mediaSessionGeneration,
      awaitingAuthoritativeKey: this.awaitingAuthoritativeKey,
      ownsRoomKey: this.ownsRoomKey,
      currentRoot: this.topology?.rootForwarder?.trim() || null,
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
    if (!this.userInfo?.address || !this.snapshot.roomId || !this.callSessionId)
      return;
    if (this.isBootstrapOnlyParticipant(toAddress)) {
      this.recordDiagEvent('bootstrap-only-targeted-key-skipped', {
        roomId: this.snapshot.roomId,
        toAddress: truncateGcallDiagAddress(toAddress),
        reason,
      });
      return;
    }
    const recipients = new Map<string, { publicKey: string }>([
      [toAddress, { publicKey }],
    ]);
    const { encryptedKeys } = encryptRoomKeyForRecipients(
      roomKey,
      recipients,
      this.userInfo.address
    );
    const encryptedKey = encryptedKeys[toAddress];
    if (!encryptedKey) {
      this.recordDiagEvent('targeted-room-key-skipped', {
        roomId: this.snapshot.roomId,
        toAddress,
        reason: publicKey.trim() ? 'encrypt-failed' : 'missing-public-key',
      });
      return;
    }
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
      callSessionId: this.callSessionId,
      mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
      keyCommitment: this.truncateDiagHex(keyCommitment),
      encryptedKeyDigest: this.truncateDiagHex(encryptedKeyDigest),
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
    const dropKeyRequest = (reason: string): void => {
      this.recordDiagEvent('room-key-request-dropped', {
        reason,
        roomId: payload.roomId,
        expectedRoomId: this.snapshot.roomId || null,
        toAddress: payload.toAddress,
        localAddress: this.userInfo?.address ?? null,
        fromAddress: payload.fromAddress,
        verified: payload.verified === true,
        payloadCallSessionId: payload.callSessionId ?? null,
        localCallSessionId: this.callSessionId || null,
        payloadMediaSessionGeneration:
          typeof payload.mediaSessionGeneration === 'number'
            ? payload.mediaSessionGeneration >>> 0
            : null,
        localMediaSessionGeneration: this.mediaSessionGeneration >>> 0,
        hasRoomKey: this.roomKey !== null,
        ownsRoomKey: this.ownsRoomKey,
        selfMintedRoomKey: this.selfMintedRoomKey,
        awaitingAuthoritativeKey: this.awaitingAuthoritativeKey,
        currentRoot: this.topology?.rootForwarder?.trim() || null,
      });
    };
    if (payload.roomId !== this.snapshot.roomId) {
      dropKeyRequest('room-mismatch');
      return;
    }
    if (payload.toAddress !== this.userInfo?.address) {
      dropKeyRequest('not-local-recipient');
      return;
    }
    if (payload.verified !== true) {
      dropKeyRequest('not-verified');
      return;
    }
    const root = this.topology?.rootForwarder?.trim() ?? '';
    const localAddress = this.userInfo?.address?.trim() ?? '';
    if (!this.roomKey) {
      if (root && root === localAddress && this.callSessionId) {
        const roomKey = randomRoomKey();
        this.roomKey = roomKey;
        this.ownsRoomKey = true;
        this.selfMintedRoomKey = true;
        this.awaitingAuthoritativeKey = false;
        this.markRoomKeyLocallyEnsured();
        await this.markLocalRoomKeyApplied(roomKey);
        this.resetWorkerDecodeFailureRecoveryState();
        this.clearKeyRecoveryRetryTimer();
        this.callEpochMs = Date.now();
        this.seq = 0;
        this.resetOutboundMediaDiagnostics();
        await this.syncDecryptPoolRoomKey(roomKey);
        await this.syncSenderState();
        this.recordDiagEvent('missing-room-key-self-recovered', {
          roomId: this.snapshot.roomId,
          fromAddress: payload.fromAddress,
          mediaSessionGeneration: this.mediaSessionGeneration >>> 0,
        });
      } else {
        dropKeyRequest('missing-room-key');
        return;
      }
    }
    const retainedRoomKey = this.roomKey;
    if (
      retainedRoomKey &&
      !this.ownsRoomKey &&
      root &&
      root === payload.fromAddress?.trim() &&
      this.demotedRootKeyTransferUntilMs > Date.now()
    ) {
      this.noteParticipantLiveEvidence(payload.fromAddress, Date.now());
      await this.sendTargetedRoomKey(
        retainedRoomKey,
        payload.fromAddress,
        payload.fromPublicKey,
        'key-request-demoted-root-transfer'
      );
      this.scheduleTargetedRoomKeyReplayRetry(
        payload.fromAddress,
        payload.fromPublicKey,
        'key-request-demoted-root-transfer'
      );
      return;
    }
    if (!this.roomKey) {
      dropKeyRequest('missing-room-key');
      return;
    }
    if (!this.ownsRoomKey) {
      dropKeyRequest('not-key-owner');
      return;
    }
    if (!root || root !== this.userInfo?.address) {
      dropKeyRequest('local-not-root');
      return;
    }
    // Requesters may still hold their local pre-root-handoff callSessionId.
    // Only generation proves true staleness; a mismatched UUID is exactly what
    // authoritative key recovery is meant to repair.
    if (
      typeof payload.mediaSessionGeneration === 'number' &&
      payload.mediaSessionGeneration >>> 0 !== this.mediaSessionGeneration >>> 0
    ) {
      dropKeyRequest('media-generation-mismatch');
      return;
    }
    this.noteParticipantLiveEvidence(payload.fromAddress, Date.now());
    await this.sendTargetedRoomKey(
      this.roomKey,
      payload.fromAddress,
      payload.fromPublicKey,
      'key-request'
    );
    this.scheduleTargetedRoomKeyReplayRetry(
      payload.fromAddress,
      payload.fromPublicKey,
      'key-request'
    );
  }

  private async syncSenderState(): Promise<void> {
    try {
      if (!this.shouldMaintainActiveSender()) {
        this.clearSenderSyncRetryTimer();
        await this.senderEngine.stop();
        return;
      }
      this.clearSenderSyncRetryTimer();
      await this.senderEngine.startOrUpdate({
        inputDeviceId: this.inputDeviceId,
        outputDeviceId: this.outputDeviceId,
        muted: this.snapshot.muted,
        profile: this.snapshot.audioQualityProfile,
        cpuDegraded: this.cpuDegradedActive,
        onVadChanged: (vad) => {
          this.noteLocalVadActivity(vad);
        },
        onEncodedFrame: ({
          opusFrame,
          vad,
          capturePerfMs,
          encoderInputPerfMs,
          encodeOutPerfMs,
        }) => {
          this.outboundEncodedFrameCallbacks++;
          this.outboundLastEncodedFrameAtMs = Date.now();
          const workletToMainThreadMs = Math.max(
            0,
            encoderInputPerfMs - capturePerfMs
          );
          const mainThreadToEncoderOutputMs = Math.max(
            0,
            encodeOutPerfMs - encoderInputPerfMs
          );
          const workletToEncoderOutputMs = Math.max(
            0,
            encodeOutPerfMs - capturePerfMs
          );
          this.receiveEngine.recordSenderPreEncodePipeline({
            workletToMainThreadMs,
            mainThreadToEncoderOutputMs,
            workletToEncoderOutputMs,
          });
          this.noteSenderEncodePressure({
            workletToEncoderOutputMs,
            mainThreadToEncoderOutputMs,
          });
          void this.dispatchEncodedFrame(opusFrame, vad, encodeOutPerfMs);
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'audio-sender-sync-failed';
      this.recordDiagEvent('sender-sync-failed', {
        roomId: this.snapshot.roomId,
        message,
      });
      this.emit({
        type: 'engine-error',
        message,
      });
      this.scheduleSenderSyncRetry('sync-failed');
    }
  }

  private ensureDecryptPool(): DecryptWorkerPool | null {
    if (this.decryptPool) return this.decryptPool;
    if (typeof Worker === 'undefined') {
      traceGcallAudioSurface(
        'pipeline: Worker API missing; decrypt pool disabled',
        {}
      );
      return null;
    }
    const hardware = Math.max(
      1,
      Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) - 1) || 1)
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

  private async syncDecryptPoolRoomKey(
    roomKey: Uint8Array | null
  ): Promise<void> {
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
    const ingressPeerAddress =
      this.pendingDecryptIngressById.get(entry.id) ?? '';
    this.pendingDecryptIngressById.delete(entry.id);
    const stageEntry = this.pendingDecryptStageById.get(entry.id);
    this.pendingDecryptStageById.delete(entry.id);
    const decryptResultAtWallMs = Date.now();
    if (stageEntry) {
      this.recordAudioStageGap(
        'decryptResult',
        stageEntry.sourceAddr,
        decryptResultAtWallMs
      );
      this.recordAudioStageDelta(
        'decryptSubmitToResult',
        stageEntry.sourceAddr,
        stageEntry.timestamps.decryptSubmitAtWallMs,
        decryptResultAtWallMs
      );
    }
    if (entry.status === 'decode-failed') {
      this.receiveEngine.recordDecodeFailure();
      traceGcallAudioSurface(
        'pipeline: decrypt worker reported decode-failed',
        {
          id: entry.id,
          from: ingressPeerAddress,
        }
      );
      if (!this.noteRootDecodeFailureForPeerKeyReplay(ingressPeerAddress)) {
        this.noteWorkerDecodeFailureForKeyRecovery();
      }
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
      : (entry.decodedMulti ?? []);
    const jitterPushAtWallMs = Date.now();
    if (stageEntry) {
      this.recordAudioStageGap(
        'jitterPush',
        stageEntry.sourceAddr,
        jitterPushAtWallMs
      );
      this.recordAudioStageDelta(
        'decryptResultToJitterPush',
        stageEntry.sourceAddr,
        decryptResultAtWallMs,
        jitterPushAtWallMs
      );
      this.recordAudioStageDelta(
        'surfaceToJitterPush',
        stageEntry.sourceAddr,
        stageEntry.timestamps.audioSurfaceHandlerAtWallMs,
        jitterPushAtWallMs
      );
    }
    await this.receiveEngine.handleDecodedPackets(decodedPackets);
  }

  private async dispatchEncodedFrame(
    opusFrame: Uint8Array,
    vad = this.senderEngine.getVad(),
    encodeOutPerfMs?: number
  ): Promise<void> {
    if (!this.roomKey) {
      this.recordOutboundSkip('no-room-key');
      return;
    }
    if (!this.topology) {
      this.recordOutboundSkip('no-topology');
      return;
    }
    if (!this.userInfo?.address) {
      this.recordOutboundSkip('no-user');
      return;
    }
    if (!this.snapshot.roomId) {
      this.recordOutboundSkip('no-room-id');
      return;
    }
    if (this.snapshot.muted) {
      this.recordOutboundSkip('muted');
      return;
    }
    const nowMs = Date.now();
    let targets = this.filterBootstrapOnlyMediaTargets(
      getReticulumTransportTargets(this.userInfo.address, this.topology)
    );
    if (targets.length === 0) {
      const fallbackTargets = this.getRecentLiveMediaFallbackTargets(
        Date.now()
      );
      if (fallbackTargets.length > 0) {
        targets = fallbackTargets;
        this.recordDiagEvent(
          'outbound-media-targets-recovered-from-live-evidence',
          {
            roomId: this.snapshot.roomId,
            topologyEpoch: this.topology.topologyEpoch,
            targetCount: targets.length,
            targets: targets.map((address) =>
              truncateGcallDiagAddress(address)
            ),
          }
        );
      }
    }
    this.outboundLastTargets = [...targets];
    if (targets.length === 0) {
      if (this.shouldWaitForStartupMediaTargets(nowMs)) {
        this.recordStartupMediaTargetWait(nowMs);
        return;
      }
      this.recordOutboundSkip('no-targets');
      return;
    }
    this.outboundPacketBuildAttempts++;
    this.outboundLastPacketBuildAttemptAtMs = Date.now();
    if (typeof encodeOutPerfMs === 'number') {
      this.receiveEngine.recordSenderEncoderToPacketTimestampGap(
        Math.max(0, performance.now() - encodeOutPerfMs)
      );
    }
    const seq = this.seq++ & 0xffff;
    const packet = encodeAudioPacketV2(
      this.userInfo.address,
      vad,
      seq,
      Math.max(0, Date.now() - this.callEpochMs),
      opusFrame,
      this.roomKey
    );
    const markAttempt = (target: string): OutboundMediaTargetDiagnostics => {
      const diag = this.getOutboundTargetDiagnostics(target);
      diag.attempts++;
      diag.lastAttemptAtMs = Date.now();
      if (diag.firstAttemptAtMs <= 0) {
        diag.firstAttemptAtMs = diag.lastAttemptAtMs;
      }
      this.outboundSendAttempts++;
      this.outboundLastSendAttemptAtMs = diag.lastAttemptAtMs;
      return diag;
    };
    const markSuccess = (diag: OutboundMediaTargetDiagnostics): void => {
      diag.successes++;
      diag.lastSuccessAtMs = Date.now();
      this.outboundSendSuccesses++;
      this.outboundLastSendSuccessAtMs = diag.lastSuccessAtMs;
    };
    const markFailure = (
      diag: OutboundMediaTargetDiagnostics,
      error: unknown
    ): void => {
      const message = error instanceof Error ? error.message : String(error);
      diag.failures++;
      diag.lastFailureAtMs = Date.now();
      diag.lastFailureMessage = message;
      this.outboundSendFailures++;
      this.outboundLastSendFailureAtMs = diag.lastFailureAtMs;
      this.outboundLastSendFailureMessage = message;
      this.recordDiagEvent('outbound-audio-send-failed', {
        roomId: this.snapshot.roomId,
        target: diag.target,
        message,
      });
    };
    if (
      targets.length > 1 &&
      typeof window.groupCall?.sendAudioBatch === 'function'
    ) {
      const diagnostics = targets.map(markAttempt);
      try {
        const rendererSendAtWallMs = Date.now();
        const result = (await window.groupCall.sendAudioBatch(
          this.snapshot.roomId,
          targets,
          packet,
          { rendererSendAtWallMs }
        )) as GcallSendAudioResult | undefined;
        this.recordOutboundMainDiagnostics(result?.diagnostics);
        if (result?.success === false) {
          throw new Error(result.error ?? 'sendAudioBatch returned failure');
        }
        diagnostics.forEach((diag) => {
          if (result?.diagnostics && !result.diagnostics.targetAddress) {
            diag.lastMainDiagnostics = result.diagnostics;
          }
          markSuccess(diag);
        });
      } catch (error) {
        diagnostics.forEach((diag) => markFailure(diag, error));
      }
      return;
    }
    await Promise.all(
      targets.map(async (address) => {
        const diag = markAttempt(address);
        try {
          if (typeof window.groupCall?.sendAudio !== 'function') {
            throw new Error('window.groupCall.sendAudio unavailable');
          }
          const rendererSendAtWallMs = Date.now();
          const result = (await window.groupCall.sendAudio(
            this.snapshot.roomId,
            address,
            packet,
            { rendererSendAtWallMs }
          )) as GcallSendAudioResult | undefined;
          this.recordOutboundMainDiagnostics(result?.diagnostics);
          if (result?.diagnostics) {
            diag.lastMainDiagnostics = result.diagnostics;
          }
          if (result?.success === false) {
            throw new Error(result.error ?? 'sendAudio returned failure');
          }
          markSuccess(diag);
        } catch (error) {
          markFailure(diag, error);
        }
      })
    );
  }
}

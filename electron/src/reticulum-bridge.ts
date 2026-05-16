import { ChildProcess, spawn } from 'child_process';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import type {
  PresenceEnvelope,
  PresenceRoute,
  PresenceTransport,
  PresenceTransportHandlers,
} from './presence';
import { buildPresenceSignedFields, getPresenceManager } from './presence';
import {
  getReticulumBridgeIdentityPath,
  getReticulumConfigDir,
  persistReticulumSharedTransportState,
  resolveReticulumPythonLaunch,
  type ReticulumBridgeState,
  type ReticulumReachability,
} from './reticulum-daemon';
import {
  error as loggerError,
  log as loggerLog,
  warn as loggerWarn,
} from './logger';
import {
  decodeReticulumAudioMessage,
  encodeReticulumAudioBatch,
  RETICULUM_AUDIO_HEADER_BYTES,
  RETICULUM_AUDIO_MAGIC,
  RETICULUM_AUDIO_MAX_BODY_BYTES,
  RETICULUM_AUDIO_MAX_FRAMES_PER_BATCH,
  RETICULUM_AUDIO_VERSION,
  type ReticulumAudioFrame,
} from './reticulum-audio-ipc';
import { GC_RETICULUM_WIRE_BUILD_MARKER } from './group-call-wire-reticulum';

const RETICULUM_AUDIO_QUEUED_AT_MS = Symbol.for(
  'qortal.reticulumAudioQueuedAtMs'
);
const GCALL_AUDIO_RENDERER_SEND_AT_MS = Symbol.for(
  'qortal.gcallAudioRendererSendAtMs'
);
const GCALL_AUDIO_MANAGER_FLUSH_AT_MS = Symbol.for(
  'qortal.gcallAudioManagerFlushAtMs'
);

function readNumberSymbol(data: Buffer, symbol: symbol): number | undefined {
  const value = Reflect.get(data, symbol);
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/**
 * Python emits overlay_link_state after every overlay send with these traffic labels
 * (presence_bridge._send_wire_to_overlay_peer). Logging each line is very noisy.
 */
const OVERLAY_LINK_PER_PACKET_REASONS = new Set([
  'group_signal',
  'presence_publish',
  'presence_forward',
  'call_signal',
]);

function shouldLogOverlayLinkStateEvent(reason: string): boolean {
  if (OVERLAY_LINK_PER_PACKET_REASONS.has(reason)) return false;
  if (reason === 'rx_presence') return false;
  if (reason.startsWith('queued:')) return false;
  return true;
}

function overlayAgeDetail(
  payload: Record<string, unknown> | undefined
): string {
  if (!payload) return '';
  const parts: string[] = [];
  for (const key of [
    'createdAgeMs',
    'establishedAgeMs',
    'lastRxAgeMs',
    'lastSendOkAgeMs',
    'lastActivityAgeMs',
  ]) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      parts.push(`${key}=${Math.round(value)}`);
    }
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

type BridgeCmdFrame = {
  type: 'cmd';
  action:
    | 'start'
    | 'publish_presence'
    | 'forward_presence'
    | 'overlay_sync_state'
    | 'overlay_note_candidate_failure'
    | 'stop'
    | 'send_call'
    | 'accept_qchat_file_resource'
    | 'send_qchat_file_resource'
    | 'authorize_qchat_file_resource'
    | 'reject_qchat_file_resource'
    | 'fanout_call'
    | 'send_group_call'
    | 'fanout_group_call'
    | 'send_group_audio_link_heartbeat'
    | 'open_group_audio_link'
    | 'close_group_audio_link'
    | 'reset_group_audio_peer_state'
    | 'warm_group_audio_path'
    | 'get_local_identity_public_key'
    | 'register_peer_identity';
  id: string;
  payload?: Record<string, unknown>;
};

type BridgeRespFrame = {
  type: 'resp';
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
};

export type ReticulumSendFailureReason =
  | 'bridge-unavailable'
  | 'bridge-not-ready'
  | 'bridge-timeout'
  | 'bridge-exception'
  | 'bridge-overloaded'
  | 'bridge-not-started'
  | 'unknown-peer-presence-hash'
  | 'wire-too-large'
  | 'packet-send-false'
  | 'no-route'
  | 'unknown-link-id'
  | 'audio-link-not-ready'
  | 'audio-payload-too-large'
  | 'send-command-failed'
  | 'audio-enqueue-failed';

export type ReticulumAudioQueueSnapshot = {
  bridgeQueuedFrames: number;
  bridgeQueuedOldestAgeMs: number;
  bridgeQueuedBytes: number;
  bridgeBinaryWritesQueued: number;
  bridgeWaitingForDrain: boolean;
  perLinkQueuedFrames: number;
  queuePressureDrops: number;
  queuePressureDropsLast5s: number;
  staleDrops: number;
  staleDropsLast5s: number;
  decodedQueueDepth: number;
  decodedQueueOldestAgeMs: number;
  decodedQueueMax: number;
  decodedQueueDrops: number;
  binaryOutQueueDepth: number;
  binaryOutQueueOldestAgeMs: number;
  binaryOutQueueMax: number;
  binaryOutQueueDrops: number;
  jsonOutQueueDrops: number;
  packetSendFailures: number;
  packetPathRequests: number;
  packetPathResolutions: number;
  packetPathTimeouts: number;
  packetFreshSends: number;
  packetStaleSends: number;
  packetUnknownSends: number;
  deadlineDropCount: number;
  decodedQueueEvictOldestCount: number;
  decodedQueueDropNewestCount: number;
  fd3DecodedAgeMsMax: number;
  decodedQueueDwellMsMax: number;
  rnsSendDurationMsMax: number;
  packetPathCheckMsMax: number;
  executorLoopGapMsMax: number;
  executorGapWhileQueuedMsMax: number;
  executorAudioPassMsMax: number;
  processBatchMsMax: number;
  processBatchFramesMax: number;
  rnsSendSlowCount: number;
  executorStallCount: number;
  executorCommandMsMax: number;
  executorCommandWhileQueuedMsMax: number;
  executorCommandSlowCount: number;
  rnsCallbackSchedulerGapMsMax: number;
  rnsCallbackSchedulerGapOver100Count: number;
  rnsCallbackSchedulerGapOver250Count: number;
  rnsCallbackSchedulerGapOver500Count: number;
  rnsCallbackSchedulerGapOver1000Count: number;
  rnsRawInboundGapMsMax: number;
  rnsRawInboundGapOver80Count: number;
  rnsRawInboundGapOver160Count: number;
  rnsRawInboundGapOver320Count: number;
  rnsRawInboundGapOver640Count: number;
  rnsRawInboundGapOver1000Count: number;
  rnsRawInboundToLinkReceiveMsMax: number;
  rnsRawInboundToLinkReceiveOver80Count: number;
  rnsRawInboundToLinkReceiveOver160Count: number;
  rnsRawInboundToLinkReceiveOver320Count: number;
  rnsRawInboundToLinkReceiveOver640Count: number;
  rnsRawInboundToLinkReceiveOver1000Count: number;
  rnsRawInboundToLinkReceiveSamples: number;
  rnsRawInboundInterfaceLast: string;
  rnsRawInboundInterfaceWorst: string;
  rendererToBridgeEnqueueMsMax: number;
  managerFlushToBridgeEnqueueMsMax: number;
  bridgeEnqueueToFd3WriteMsMax: number;
  bridgeEnqueueToFd3WriteQueueDwellMsMax: number;
  rendererToFd3WriteMsMax: number;
  schedulerDiagnostics?: ReticulumSchedulerLaneDiagnostic[];
  mediaRouteDiagnostics?: ReticulumAudioMediaRouteDiagnostic[];
};

export type ReticulumSchedulerLaneDiagnostic = {
  lane: string;
  logicalLane: string;
  queueMax: number;
  queueDepth: number;
  queueDepthHighWater: number;
  droppedTasks: number;
  completedTasks: number;
  enqueuedTasks: number;
  dwellMsMax: number;
  busyMsMax: number;
  slowTaskCount: number;
  lastTask: string;
};

export type ReticulumAudioMediaRouteDiagnostic = {
  transport: 'link' | 'packet' | string;
  routeKey: string;
  linkId: string;
  peerPresenceHash: string;
  peerDestinationHash: string;
  incoming: boolean;
  sentFrames: number;
  sentBytes: number;
  sendFailures: number;
  receivedFrames: number;
  receivedBytes: number;
  fd4EnqueuedFrames: number;
  fd4EnqueueFailures: number;
  lastSendAtMs: number;
  lastSendFailureAtMs: number;
  lastReceiveAtMs: number;
  lastFd4EnqueueAtMs: number;
  lastActivityAtMs: number;
  lastRoomId: string;
  sendGapMsMax: number;
  receiveGapMsMax: number;
  sendGapOver80Count: number;
  sendGapOver160Count: number;
  sendGapOver320Count: number;
  sendGapOver640Count: number;
  sendGapOver1000Count: number;
  receiveGapOver80Count: number;
  receiveGapOver160Count: number;
  receiveGapOver320Count: number;
  receiveGapOver640Count: number;
  receiveGapOver1000Count: number;
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
  rendererToBridgeEnqueueMsMax?: number;
  managerFlushToBridgeEnqueueMsMax?: number;
  bridgeEnqueueToFd3WriteMsMax?: number;
  bridgeEnqueueToFd3WriteQueueDwellMsMax?: number;
  rendererToFd3WriteMsMax?: number;
  preRnsSendAgeMsMax: number;
  rnsSendDurationMsMax: number;
  receiveToFd4EnqueueMsMax: number;
};

export type ReticulumEnqueueGroupAudioResult =
  | {
      ok: true;
      dropped: boolean;
      queuePressureDrops: number;
      staleDrops: number;
      snapshot: ReticulumAudioQueueSnapshot;
    }
  | { ok: false; reason: ReticulumSendFailureReason };

export type ReticulumSendResult =
  | { ok: true }
  | {
      ok: false;
      reason: ReticulumSendFailureReason;
      error?: string;
    };

export type ReticulumWarmPathResult =
  | {
      ok: true;
      pathState?: string;
      ready?: boolean;
    }
  | {
      ok: false;
      reason: ReticulumSendFailureReason;
      error?: string;
    };

export type ReticulumAudioLinkHeartbeatCommand = 'PING' | 'PONG';

export type ReticulumOpenAudioLinkResult =
  | { ok: true; linkId: string; established: boolean }
  | {
      ok: false;
      reason: ReticulumSendFailureReason;
      error?: string;
    };

export type ReticulumConnectivitySnapshot = {
  bridgeState: ReticulumBridgeState;
  reachability: ReticulumReachability;
  transportEnabled?: boolean;
  configuredHubInterfaces?: number;
  onlineHubInterfaces?: number;
  /** TCP/Backbone outbound hubs; excludes local Qortal Hub Mesh Listen. */
  configuredRemoteHubInterfaces?: number;
  onlineRemoteHubInterfaces?: number;
  hubSummary?: string;
  reason?: string;
  /** Mesh listen section is online; RNS may report short or long interface names (presence_bridge matches substring). */
  meshListenOnline?: boolean;
  /** Established RNS.Link sessions used for Reticulum presence/signaling overlay (not group audio). */
  overlayLinksConnected?: number;
};

export type ReticulumOverlayVerifiedPeer = {
  destinationHash: string;
  address: string;
  lastSeen: number;
};

export type ReticulumOverlayLinkSnapshot = {
  linkId: string;
  peerPresenceHash: string;
  incoming: boolean;
  connectedAt: number;
  lastRxAt: number;
};

type BridgeEventFrame =
  | {
      type: 'event';
      event: 'ready';
      payload?: { destinationHash?: string };
    }
  | {
      type: 'event';
      event: 'presence_message';
      payload?: {
        envelope?: PresenceEnvelope;
        route?: {
          kind: 'reticulum';
          destinationHash: string;
          linkId?: string;
          overlayHopsRemaining?: number;
        };
      };
    }
  | {
      type: 'event';
      event: 'candidate_peer_discovered';
      payload?: {
        peerHash?: string;
        source?: string;
      };
    }
  | {
      type: 'event';
      event: 'call_message';
      payload?: {
        wire?: Record<string, unknown>;
        senderDestinationHash?: string;
        peerPresenceHash?: string;
        linkId?: string;
      };
    }
  | {
      type: 'event';
      event: 'group_call_message';
      payload?: {
        wire?: Record<string, unknown>;
        senderDestinationHash?: string;
        peerPresenceHash?: string;
        linkId?: string;
      };
    }
  | {
      type: 'event';
      event: 'group_audio_link_established';
      payload?: {
        linkId?: string;
        peerPresenceHash?: string;
        peerDestinationHash?: string;
        incoming?: boolean;
      };
    }
  | {
      type: 'event';
      event: 'group_audio_link_closed';
      payload?: {
        linkId?: string;
        peerPresenceHash?: string;
        peerDestinationHash?: string;
        incoming?: boolean;
        reason?: string;
      };
    }
  | {
      type: 'event';
      event: 'group_audio_send_failed';
      payload?: {
        linkId?: string;
        peerPresenceHash?: string;
        transport?: 'link' | 'packet';
        reason?: string;
        code?: string;
        error?: string;
        pathState?: string;
      };
    }
  | {
      type: 'event';
      event: 'group_audio_queue_state';
      payload?: {
        decodedQueueDepth?: number;
        decodedQueueOldestAgeMs?: number;
        decodedQueueMax?: number;
        decodedQueueDrops?: number;
        binaryOutQueueDepth?: number;
        binaryOutQueueOldestAgeMs?: number;
        binaryOutQueueMax?: number;
        binaryOutQueueDrops?: number;
        jsonOutQueueDrops?: number;
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
        schedulerDiagnostics?: Array<Record<string, unknown>>;
        mediaRouteDiagnostics?: Array<Record<string, unknown>>;
      };
    }
  | {
      type: 'event';
      event: 'overlay_link_state';
      payload?: {
        linkId?: string;
        peerPresenceHash?: string;
        incoming?: boolean;
        established?: boolean;
        reason?: string;
        queuedPackets?: number;
        closedByReticulum?: boolean;
        lastRxAt?: number | null;
        createdAgeMs?: number | null;
        establishedAgeMs?: number | null;
        lastRxAgeMs?: number | null;
        lastSendOkAgeMs?: number | null;
        lastActivityAgeMs?: number | null;
      };
    }
  | {
      type: 'event';
      event: 'qchat_file_transfer';
      payload?: Record<string, unknown>;
    }
  | {
      type: 'event';
      event: 'error';
      payload?: { code?: string; message?: string; detail?: string };
    }
  | {
      type: 'event';
      event: 'transport_state';
      payload?: {
        reachability?: ReticulumReachability;
        transportEnabled?: boolean;
        configuredHubInterfaces?: number;
        onlineHubInterfaces?: number;
        configuredRemoteHubInterfaces?: number;
        onlineRemoteHubInterfaces?: number;
        hubSummary?: string;
        reason?: string;
        meshListenOnline?: boolean;
      };
    };
type PendingRequest = {
  action: BridgeCmdFrame['action'];
  priority: BridgeCmdPriority;
  resolve: (frame: BridgeRespFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type BridgeCmdPriority = 'high' | 'normal' | 'low';

type QueuedCommand = {
  id: string;
  wire: string;
  priority: BridgeCmdPriority;
};

type BridgeState = 'stopped' | 'starting' | 'ready' | 'degraded';

const REQUEST_TIMEOUT_MS = 10_000;
const CONTROL_PENDING_MAX = 512;
const CONTROL_LOW_PRIORITY_PENDING_MAX = 128;
const HEARTBEAT_MIN_INTERVAL_MS = 10_000;
const ANNOUNCE_DEDUP_WINDOW_MS = 1_000;
const RESTART_DELAY_MS = 2_000;
const OVERLAY_LINK_RX_IDLE_TIMEOUT_MS = 95_000;

/** Grep main-process logs for this string when debugging binary audio IPC (fd3/fd4). */
const RETICULUM_AUDIO_IPC_LOG = 'target=reticulum-audio-ipc';

function bridgeExeName(): string {
  return process.platform === 'win32'
    ? 'presence_bridge.exe'
    : 'presence_bridge';
}

function getFrozenBridgePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'reticulum', bridgeExeName());
  }
  return path.join(
    __dirname,
    '..',
    '..',
    'resources',
    'reticulum',
    bridgeExeName()
  );
}

function getBridgeScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'reticulum', 'presence_bridge.py');
  }
  return path.join(__dirname, '..', '..', 'resources', 'presence_bridge.py');
}

function resolveBridgeLaunch(configDir: string):
  | {
      cmd: string;
      args: string[];
      cwd: string;
      mode: 'frozen';
      envExtra?: Record<string, string>;
    }
  | ReturnType<typeof resolveReticulumPythonLaunch> {
  // Dev (`npm run electron:start`): always use `presence_bridge.py` so edits apply; ignore PyInstaller binary in resources/reticulum/.
  if (!app.isPackaged) {
    return resolveReticulumPythonLaunch(getBridgeScriptPath(), [
      '--config',
      configDir,
    ]);
  }

  const frozenBridge = getFrozenBridgePath();
  if (fs.existsSync(frozenBridge)) {
    return {
      cmd: frozenBridge,
      args: ['--config', configDir],
      cwd: path.dirname(frozenBridge),
      mode: 'frozen',
    };
  }

  return resolveReticulumPythonLaunch(getBridgeScriptPath(), [
    '--config',
    configDir,
  ]);
}

function toPresenceRoute(raw: unknown): PresenceRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const route = raw as {
    kind?: unknown;
    destinationHash?: unknown;
    viaDestinationHash?: unknown;
    linkId?: unknown;
    overlayHopsRemaining?: unknown;
  };
  if (route.kind !== 'reticulum' || typeof route.destinationHash !== 'string') {
    return null;
  }
  return {
    kind: 'reticulum',
    destinationHash: route.destinationHash,
    ...(typeof route.viaDestinationHash === 'string'
      ? { viaDestinationHash: route.viaDestinationHash }
      : {}),
    ...(typeof route.linkId === 'string' ? { linkId: route.linkId } : {}),
    ...(typeof route.overlayHopsRemaining === 'number'
      ? { overlayHopsRemaining: route.overlayHopsRemaining }
      : {}),
  };
}

function semanticPresenceKey(envelope: PresenceEnvelope): string {
  const signed = buildPresenceSignedFields(envelope);
  return JSON.stringify({
    type: envelope.type,
    ...signed,
    timestamp: undefined,
  });
}

function commandPriorityForAction(
  action: BridgeCmdFrame['action']
): BridgeCmdPriority {
  switch (action) {
    case 'publish_presence':
    case 'forward_presence':
    case 'overlay_sync_state':
    case 'overlay_note_candidate_failure':
      return 'low';
    default:
      return 'high';
  }
}

export type ReticulumGroupAudioPacketPayload = {
  linkId: string;
  routeKey: string;
  transport: 'link' | 'packet';
  roomId: string;
  data: Buffer;
  peerPresenceHash: string;
  peerDestinationHash: string;
  receivedAtWallMs?: number;
  incoming: boolean;
};

type QueuedAudioFrame = {
  routeKey: string;
  transport: 'link' | 'packet';
  linkId: string;
  roomId: string;
  peerPresenceHash: string;
  peerDestinationHash: string;
  data: Buffer;
  queuedAtMs: number;
  rendererSendAtMs?: number;
  managerFlushAtMs?: number;
  bridgeEnqueuedAtMs: number;
  sizeBytes: number;
};

type AudioBinaryWriteQueueItem = {
  buf: Buffer;
  queuedAtMs: number;
  frames: Array<{
    routeKey: string;
    rendererSendAtMs?: number;
    bridgeEnqueuedAtMs: number;
  }>;
};

export class ReticulumBridge extends EventEmitter implements PresenceTransport {
  readonly kind = 'reticulum' as const;

  private child: ChildProcess | null = null;
  private desiredRunning = false;
  private state: BridgeState = 'stopped';
  private stdoutBuffer = '';
  private highPriorityWriteQueue: QueuedCommand[] = [];
  private normalPriorityWriteQueue: QueuedCommand[] = [];
  private lowPriorityWriteQueue: QueuedCommand[] = [];
  private waitingForDrain = false;
  /** Pending frames before encoding to binary batches, stored per target for round-robin fairness. */
  private audioFrameQueues = new Map<string, QueuedAudioFrame[]>();
  private audioQueuedLinkOrder: string[] = [];
  private audioRoundRobinCursor = 0;
  private audioQueuedFrames = 0;
  private audioQueuedBytes = 0;
  /** Global cap on queued outbound frames before pressure-drops (oldest evicted). */
  private readonly audioFrameQueueMax = 96;
  /** Per-route outbound queue cap (packet path uses one route per peer). */
  private readonly audioFrameQueuePerLinkMax = 24;
  /**
   * Max age an outbound frame may sit in `audioFrameQueues` before we drop it.
   * Needs to be tight enough that when fd3 drain stalls we evict audio that is
   * already past the receiver's playout deadline rather than stockpile a burst
   * of 700ms-old frames that will all hit the wire at once (call 62 saw up to
   * 32 frames queued per link with `audioFrameStaleMs = 750`, exactly the
   * burst-delivery pattern that kept Kenny's jitter buffer oscillating between
   * 0 and 400 ms of queued Opus).
   *
   * Receiver playout target ranges 145–185 ms across adaptive profiles, so
   * anything older than ~400 ms is past the deepest smoothed target plus a
   * generous margin.
   */
  private readonly audioFrameStaleMs = 400;
  /**
   * Batched IPC buffers waiting for fd3 write. When this is full, `packAudioFramesIntoBinaryWrites`
   * stops pulling from `audioFrameQueues` even if frames remain — combined with a slow fd3 drain
   * that starves the main process and causes `queuePressureDrops` (field: Kenny root-forwarder
   * in phil-kenny-one-on-one-60: 49 drops vs 0 on standby; bridge high-water sat at per-link max).
   */
  private readonly audioBinaryWriteQueueMax = 12;
  private audioBinaryWriteQueue: AudioBinaryWriteQueueItem[] = [];
  private waitingForAudioBinaryDrain = false;
  private audioFlushScheduled = false;
  private audioInBuffer = Buffer.alloc(0);
  private audioQueuePressureDrops = 0;
  private audioStaleDrops = 0;
  private audioQueuePressureDropEvents: Array<{ atMs: number; count: number }> =
    [];
  private audioStaleDropEvents: Array<{ atMs: number; count: number }> = [];
  private lastAudioQueueSnapshot: ReticulumAudioQueueSnapshot = {
    bridgeQueuedFrames: 0,
    bridgeQueuedOldestAgeMs: 0,
    bridgeQueuedBytes: 0,
    bridgeBinaryWritesQueued: 0,
    bridgeWaitingForDrain: false,
    perLinkQueuedFrames: 0,
    queuePressureDrops: 0,
    queuePressureDropsLast5s: 0,
    staleDrops: 0,
    staleDropsLast5s: 0,
    decodedQueueDepth: 0,
    decodedQueueOldestAgeMs: 0,
    decodedQueueMax: 48,
    decodedQueueDrops: 0,
    binaryOutQueueDepth: 0,
    binaryOutQueueOldestAgeMs: 0,
    binaryOutQueueMax: 128,
    binaryOutQueueDrops: 0,
    jsonOutQueueDrops: 0,
    packetSendFailures: 0,
    packetPathRequests: 0,
    packetPathResolutions: 0,
    packetPathTimeouts: 0,
    packetFreshSends: 0,
    packetStaleSends: 0,
    packetUnknownSends: 0,
    deadlineDropCount: 0,
    decodedQueueEvictOldestCount: 0,
    decodedQueueDropNewestCount: 0,
    fd3DecodedAgeMsMax: 0,
    decodedQueueDwellMsMax: 0,
    rnsSendDurationMsMax: 0,
    packetPathCheckMsMax: 0,
    executorLoopGapMsMax: 0,
    executorGapWhileQueuedMsMax: 0,
    executorAudioPassMsMax: 0,
    processBatchMsMax: 0,
    processBatchFramesMax: 0,
    rnsSendSlowCount: 0,
    executorStallCount: 0,
    executorCommandMsMax: 0,
    executorCommandWhileQueuedMsMax: 0,
    executorCommandSlowCount: 0,
    rnsCallbackSchedulerGapMsMax: 0,
    rnsCallbackSchedulerGapOver100Count: 0,
    rnsCallbackSchedulerGapOver250Count: 0,
    rnsCallbackSchedulerGapOver500Count: 0,
    rnsCallbackSchedulerGapOver1000Count: 0,
    rnsRawInboundGapMsMax: 0,
    rnsRawInboundGapOver80Count: 0,
    rnsRawInboundGapOver160Count: 0,
    rnsRawInboundGapOver320Count: 0,
    rnsRawInboundGapOver640Count: 0,
    rnsRawInboundGapOver1000Count: 0,
    rnsRawInboundToLinkReceiveMsMax: 0,
    rnsRawInboundToLinkReceiveOver80Count: 0,
    rnsRawInboundToLinkReceiveOver160Count: 0,
    rnsRawInboundToLinkReceiveOver320Count: 0,
    rnsRawInboundToLinkReceiveOver640Count: 0,
    rnsRawInboundToLinkReceiveOver1000Count: 0,
    rnsRawInboundToLinkReceiveSamples: 0,
    rnsRawInboundInterfaceLast: '',
    rnsRawInboundInterfaceWorst: '',
    rendererToBridgeEnqueueMsMax: 0,
    managerFlushToBridgeEnqueueMsMax: 0,
    bridgeEnqueueToFd3WriteMsMax: 0,
    bridgeEnqueueToFd3WriteQueueDwellMsMax: 0,
    rendererToFd3WriteMsMax: 0,
    schedulerDiagnostics: [],
    mediaRouteDiagnostics: [],
  };
  /** One-shot diagnostics: confirm binary egress/ingress actually ran. */
  private audioIpcFd3FirstBatchLogged = false;
  private audioIpcFd4FirstMessageLogged = false;
  /** Bytes arrived on fd4 before framing (proves Python wrote something). */
  private audioIpcFd4FirstRawChunkLogged = false;
  /** First JSON `group_audio_send_failed` per `code` (RNS path). */
  private audioIpcSendFailedCodesLogged = new Set<string>();
  private pending = new Map<string, PendingRequest>();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private statePromise: Promise<void> | null = null;
  private launchConfigDir: string | null = null;
  private lastHeartbeatSentAt = 0;
  private lastHeartbeatSemanticKey: string | null = null;
  private lastSemanticPresence = new Map<string, number>();
  private connectivitySnapshot: ReticulumConnectivitySnapshot = {
    bridgeState: 'stopped',
    reachability: 'disconnected',
  };
  private lastDegradedReason: string | undefined;
  /** Local hub destination hash (RNS); set on `ready` event from Python. */
  private localPresenceDestinationHash: string | undefined;
  /** Overlay control-plane links reporting `established` from Python `overlay_link_state`. */
  private overlayEstablishedLinkIds = new Set<string>();
  private overlayLinkSnapshots = new Map<
    string,
    ReticulumOverlayLinkSnapshot
  >();

  private markOverlayPeerVerifiedFromQortalTraffic(
    peerPresenceHash: string,
    senderDestinationHash: string,
    source: string
  ): void {
    const hash = (peerPresenceHash || senderDestinationHash)
      .trim()
      .toLowerCase();
    if (!hash) return;
    getPresenceManager()?.markReticulumOverlayPeerVerified(hash, source);
  }

  subscribe(handlers: PresenceTransportHandlers): () => void {
    const onReady = () => handlers.onReady?.();
    const onDegraded = (reason?: string) => handlers.onDegraded?.(reason);
    const onEnvelope = (envelope: PresenceEnvelope, route: PresenceRoute) =>
      handlers.onEnvelope(envelope, route);
    const onCandidatePeerDiscovered = (payload: {
      peerHash: string;
      source?: string;
    }) => handlers.onCandidatePeerDiscovered?.(payload);
    const onOverlayLinkClosed = (payload: {
      peerHash: string;
      reason?: string;
    }) => handlers.onOverlayLinkClosed?.(payload);

    this.on('ready', onReady);
    this.on('degraded', onDegraded);
    this.on('presence-envelope', onEnvelope);
    this.on('candidate-peer-discovered', onCandidatePeerDiscovered);
    this.on('overlay-link-closed', onOverlayLinkClosed);

    if (this.state === 'ready') {
      queueMicrotask(onReady);
    }

    return () => {
      this.off('ready', onReady);
      this.off('degraded', onDegraded);
      this.off('presence-envelope', onEnvelope);
      this.off('candidate-peer-discovered', onCandidatePeerDiscovered);
      this.off('overlay-link-closed', onOverlayLinkClosed);
    };
  }

  async start(): Promise<void> {
    this.desiredRunning = true;
    const configDir = getReticulumConfigDir();
    if (
      this.launchConfigDir &&
      this.launchConfigDir !== configDir &&
      this.state !== 'stopped'
    ) {
      loggerWarn(
        `[ReticulumBridge] Config changed from ${this.launchConfigDir} to ${configDir}; restarting bridge for current app instance`
      );
      const previousStart = this.statePromise;
      this.stop();
      if (previousStart) {
        try {
          await previousStart;
        } catch {
          /* expected when stopping a bridge started with the wrong config */
        }
      }
      this.desiredRunning = true;
    }
    if (this.state === 'ready') return;
    if (this.statePromise) return this.statePromise;
    if (
      this.state === 'starting' &&
      this.child &&
      this.child.exitCode === null &&
      !this.child.killed
    ) {
      return;
    }

    loggerLog(`[ReticulumBridge] Starting bridge for config=${configDir}`);
    this.state = 'starting';
    this.launchConfigDir = configDir;
    this.statePromise = this.spawnAndHandshake(configDir).finally(() => {
      this.statePromise = null;
    });
    return this.statePromise;
  }

  stop(): void {
    this.desiredRunning = false;
    loggerLog('[ReticulumBridge] Stopping bridge');
    this.state = 'stopped';
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Reticulum bridge stopped'));
    }
    this.pending.clear();
    this.highPriorityWriteQueue = [];
    this.normalPriorityWriteQueue = [];
    this.lowPriorityWriteQueue = [];
    this.waitingForDrain = false;
    this.audioFrameQueues.clear();
    this.audioQueuedLinkOrder = [];
    this.audioRoundRobinCursor = 0;
    this.audioQueuedFrames = 0;
    this.audioQueuedBytes = 0;
    this.audioQueuePressureDrops = 0;
    this.audioStaleDrops = 0;
    this.audioQueuePressureDropEvents = [];
    this.audioStaleDropEvents = [];
    this.audioBinaryWriteQueue = [];
    this.waitingForAudioBinaryDrain = false;
    this.audioFlushScheduled = false;
    this.audioInBuffer = Buffer.alloc(0);
    this.audioIpcFd3FirstBatchLogged = false;
    this.audioIpcFd4FirstMessageLogged = false;
    this.audioIpcFd4FirstRawChunkLogged = false;
    this.audioIpcSendFailedCodesLogged.clear();
    this.overlayEstablishedLinkIds.clear();
    this.stdoutBuffer = '';
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && !child.killed) {
      child.kill();
    }
    this.localPresenceDestinationHash = undefined;
    this.launchConfigDir = null;
  }

  /**
   * Send one compact call-signaling frame to a peer (destination hash).
   * Python injects `r` (local destination hash) before transmit.
   */
  async sendCall(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<boolean> {
    const result = await this.sendCallDetailed(peerPresenceHash, message);
    return result.ok;
  }

  async sendCallDetailed(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_call', {
      peerPresenceHash,
      message,
    });
  }

  async acceptQchatFileResource(payload: {
    peerPresenceHash: string;
    reticulumIdentityPublicKeyBase64: string;
    authMessage: Record<string, unknown>;
    transferId: string;
    savePath: string;
    fileName: string;
    size: number;
    sha256?: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('accept_qchat_file_resource', payload);
  }

  async sendQchatFileResource(payload: {
    allowedRecipientAddress: string;
    transferId: string;
    filePath: string;
    fileName: string;
    size: number;
    sha256?: string;
    expiresAt?: number;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_qchat_file_resource', payload);
  }

  async authorizeQchatFileResource(payload: {
    linkId: string;
    transferId: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('authorize_qchat_file_resource', payload);
  }

  async rejectQchatFileResource(payload: {
    linkId: string;
    transferId: string;
    reason: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('reject_qchat_file_resource', payload);
  }

  async fanoutCallDetailed(
    messages: Record<string, unknown>[],
    excludePeerPresenceHashes: string[] = []
  ): Promise<ReticulumSendResult> {
    if (messages.length === 0) {
      return {
        ok: false,
        reason: 'wire-too-large',
        error: 'No Reticulum frames fit encrypted wire limit',
      };
    }
    const pm = getPresenceManager();
    const overlayNeighborHashes =
      pm?.getReticulumActiveNeighborHashes(excludePeerPresenceHashes) ??
      pm?.getReticulumFanoutDestinationHashes() ??
      [];
    return this.sendDetailed('fanout_call', {
      messages,
      overlayNeighborHashes,
      excludePeerPresenceHashes,
    });
  }

  async sendGroupCall(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<boolean> {
    const result = await this.sendGroupCallDetailed(peerPresenceHash, message);
    return result.ok;
  }

  async sendGroupCallDetailed(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_group_call', {
      peerPresenceHash,
      message,
    });
  }

  async fanoutGroupCallDetailed(
    messages: Record<string, unknown>[],
    excludePeerPresenceHashes: string[] = []
  ): Promise<ReticulumSendResult> {
    if (messages.length === 0) {
      return {
        ok: false,
        reason: 'wire-too-large',
        error: 'No Reticulum frames fit encrypted wire limit',
      };
    }
    const pm = getPresenceManager();
    const overlayNeighborHashes =
      pm?.getReticulumActiveNeighborHashes(excludePeerPresenceHashes) ??
      pm?.getReticulumFanoutDestinationHashes() ??
      [];
    return this.sendDetailed('fanout_group_call', {
      messages,
      overlayNeighborHashes,
      excludePeerPresenceHashes,
    });
  }

  async sendGroupAudioLinkHeartbeatDetailed(opts: {
    roomId: string;
    command: ReticulumAudioLinkHeartbeatCommand;
    seq?: number;
    peerPresenceHash?: string;
    linkId?: string;
    packetRxAgeMs?: number;
    packetRxRecent?: boolean;
  }): Promise<ReticulumSendResult> {
    const linkId = typeof opts.linkId === 'string' ? opts.linkId.trim() : '';
    const peerPresenceHash =
      typeof opts.peerPresenceHash === 'string'
        ? opts.peerPresenceHash.trim().toLowerCase()
        : '';
    if (!linkId && !peerPresenceHash) {
      return {
        ok: false,
        reason: 'send-command-failed',
        error: 'Missing linkId or peerPresenceHash',
      };
    }
    return this.sendDetailed('send_group_audio_link_heartbeat', {
      roomId: opts.roomId,
      command: opts.command,
      ...(typeof opts.seq === 'number' ? { seq: opts.seq } : {}),
      ...(linkId ? { linkId } : {}),
      ...(peerPresenceHash ? { peerPresenceHash } : {}),
      ...(typeof opts.packetRxAgeMs === 'number'
        ? { packetRxAgeMs: opts.packetRxAgeMs }
        : {}),
      ...(typeof opts.packetRxRecent === 'boolean'
        ? { packetRxRecent: opts.packetRxRecent }
        : {}),
    });
  }

  async openGroupAudioLink(
    peerPresenceHash: string
  ): Promise<ReticulumOpenAudioLinkResult> {
    try {
      await this.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: 'bridge-exception',
        error: message,
      };
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.sendCommand('open_group_audio_link', {
        peerPresenceHash,
      });
      if (!resp.ok) {
        return {
          ok: false,
          reason: this.mapSendFailureReason(resp),
          ...(resp.error ? { error: resp.error } : {}),
        };
      }
      const linkId = resp.payload?.linkId;
      if (typeof linkId !== 'string' || linkId.length === 0) {
        return {
          ok: false,
          reason: 'send-command-failed',
          error: 'Bridge open_group_audio_link response missing linkId',
        };
      }
      return {
        ok: true,
        linkId,
        established: resp.payload?.established === true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: message.includes('timed out')
          ? 'bridge-timeout'
          : 'bridge-exception',
        error: message,
      };
    }
  }

  async closeGroupAudioLink(
    linkId: string,
    reason?: string
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('close_group_audio_link', {
      linkId,
      ...(reason ? { reason } : {}),
    });
  }

  async resetGroupAudioPeerState(
    peerPresenceHash: string,
    reason: string
  ): Promise<ReticulumSendResult> {
    const peerHash = peerPresenceHash.trim().toLowerCase();
    if (!peerHash) {
      return {
        ok: false,
        reason: 'send-command-failed',
        error: 'Missing peerPresenceHash',
      };
    }
    this.dropQueuedAudioFramesForPeerPresenceHash(peerHash);
    return this.sendDetailed('reset_group_audio_peer_state', {
      peerPresenceHash: peerHash,
      reason,
    });
  }

  async warmGroupAudioPath(
    peerPresenceHash: string
  ): Promise<ReticulumWarmPathResult> {
    try {
      await this.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: 'bridge-exception',
        error: message,
      };
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.sendCommand('warm_group_audio_path', {
        peerPresenceHash,
      });
      if (resp.ok) {
        return {
          ok: true,
          ...(typeof resp.payload?.pathState === 'string'
            ? { pathState: resp.payload.pathState }
            : {}),
          ...(typeof resp.payload?.ready === 'boolean'
            ? { ready: resp.payload.ready }
            : {}),
        };
      }
      const reason = this.mapSendFailureReason(resp);
      return {
        ok: false,
        reason,
        ...(resp.error ? { error: resp.error } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: message.includes('timed out')
          ? 'bridge-timeout'
          : 'bridge-exception',
        error: message,
      };
    }
  }

  /**
   * Queue Opus (or other) payload for fd3 binary IPC. Non-blocking; may drop oldest
   * frames when the queue is full. Listen for `group-audio-send-failed` for RNS errors.
   */
  enqueueGroupAudio(
    linkId: string,
    roomId: string,
    data: Buffer
  ): ReticulumEnqueueGroupAudioResult {
    return this.enqueueAudioFrame({
      routeKey: linkId,
      transport: 'link',
      linkId,
      roomId,
      peerPresenceHash: '',
      peerDestinationHash: '',
      data,
    });
  }

  enqueuePacketGroupAudio(
    peerPresenceHash: string,
    roomId: string,
    data: Buffer,
    peerDestinationHash = ''
  ): ReticulumEnqueueGroupAudioResult {
    const normalizedPeerPresenceHash = peerPresenceHash.trim().toLowerCase();
    if (!normalizedPeerPresenceHash) {
      return { ok: false, reason: 'unknown-peer-presence-hash' };
    }
    return this.enqueueAudioFrame({
      routeKey: `packet:${normalizedPeerPresenceHash}`,
      transport: 'packet',
      linkId: '',
      roomId,
      peerPresenceHash: normalizedPeerPresenceHash,
      peerDestinationHash: peerDestinationHash.trim().toLowerCase(),
      data,
    });
  }

  private enqueueAudioFrame(
    frameInput: Omit<
      QueuedAudioFrame,
      | 'queuedAtMs'
      | 'rendererSendAtMs'
      | 'managerFlushAtMs'
      | 'bridgeEnqueuedAtMs'
      | 'sizeBytes'
    >
  ): ReticulumEnqueueGroupAudioResult {
    if (!Buffer.isBuffer(frameInput.data)) {
      return { ok: false, reason: 'audio-enqueue-failed' };
    }
    if (!this.child || this.child.exitCode !== null || this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    let queuePressureDrops = 0;
    const staleDrops = this.pruneStaleQueuedAudioFrames();
    let dropped = staleDrops > 0;
    let queue = this.audioFrameQueues.get(frameInput.routeKey);
    if (!queue) {
      queue = [];
      this.audioFrameQueues.set(frameInput.routeKey, queue);
      this.audioQueuedLinkOrder.push(frameInput.routeKey);
    }
    while (queue.length >= this.audioFrameQueuePerLinkMax) {
      if (!this.dropOldestQueuedFrameForLink(frameInput.routeKey)) break;
      queuePressureDrops++;
      dropped = true;
    }
    while (this.audioQueuedFrames >= this.audioFrameQueueMax) {
      if (!this.dropOldestQueuedFrameFromLargestQueue()) break;
      queuePressureDrops++;
      dropped = true;
    }
    const queuedAtMs = readNumberSymbol(
      frameInput.data,
      RETICULUM_AUDIO_QUEUED_AT_MS
    );
    const rendererSendAtMs = readNumberSymbol(
      frameInput.data,
      GCALL_AUDIO_RENDERER_SEND_AT_MS
    );
    const managerFlushAtMs = readNumberSymbol(
      frameInput.data,
      GCALL_AUDIO_MANAGER_FLUSH_AT_MS
    );
    const bridgeEnqueuedAtMs = Date.now();
    if (rendererSendAtMs) {
      this.lastAudioQueueSnapshot.rendererToBridgeEnqueueMsMax = Math.max(
        this.lastAudioQueueSnapshot.rendererToBridgeEnqueueMsMax,
        Math.max(0, bridgeEnqueuedAtMs - rendererSendAtMs)
      );
    }
    if (managerFlushAtMs) {
      this.lastAudioQueueSnapshot.managerFlushToBridgeEnqueueMsMax = Math.max(
        this.lastAudioQueueSnapshot.managerFlushToBridgeEnqueueMsMax,
        Math.max(0, bridgeEnqueuedAtMs - managerFlushAtMs)
      );
    }
    const frame: QueuedAudioFrame = {
      ...frameInput,
      data: Buffer.from(frameInput.data),
      queuedAtMs: queuedAtMs ?? bridgeEnqueuedAtMs,
      rendererSendAtMs,
      managerFlushAtMs,
      bridgeEnqueuedAtMs,
      sizeBytes: frameInput.data.length,
    };
    queue.push(frame);
    this.audioQueuedFrames++;
    this.audioQueuedBytes += frame.sizeBytes;
    this.audioQueuePressureDrops += queuePressureDrops;
    this.audioStaleDrops += staleDrops;
    this.recordAudioDropEvents(
      this.audioQueuePressureDropEvents,
      queuePressureDrops
    );
    this.recordAudioDropEvents(this.audioStaleDropEvents, staleDrops);
    this.scheduleAudioOutFlush();
    return {
      ok: true,
      dropped,
      queuePressureDrops,
      staleDrops,
      snapshot: this.getAudioQueueSnapshot(frameInput.routeKey),
    };
  }

  getAudioQueueSnapshot(routeKey?: string): ReticulumAudioQueueSnapshot {
    const nowMs = Date.now();
    const perLinkQueuedFrames = routeKey
      ? (this.audioFrameQueues.get(routeKey)?.length ?? 0)
      : 0;
    this.lastAudioQueueSnapshot = {
      ...this.lastAudioQueueSnapshot,
      bridgeQueuedFrames: this.audioQueuedFrames,
      bridgeQueuedOldestAgeMs: this.getQueuedAudioFrameOldestAgeMs(nowMs),
      bridgeQueuedBytes: this.audioQueuedBytes,
      bridgeBinaryWritesQueued: this.audioBinaryWriteQueue.length,
      bridgeWaitingForDrain: this.waitingForAudioBinaryDrain,
      perLinkQueuedFrames,
      queuePressureDrops: this.audioQueuePressureDrops,
      queuePressureDropsLast5s: this.sumRecentAudioDropEvents(
        this.audioQueuePressureDropEvents
      ),
      staleDrops: Math.max(
        this.lastAudioQueueSnapshot.staleDrops,
        this.audioStaleDrops
      ),
      staleDropsLast5s: this.sumRecentAudioDropEvents(
        this.audioStaleDropEvents
      ),
    };
    return { ...this.lastAudioQueueSnapshot };
  }

  private normalizeAudioMediaRouteDiagnostic(
    input: Record<string, unknown>
  ): ReticulumAudioMediaRouteDiagnostic {
    const num = (key: string): number => {
      const value = input[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    };
    const str = (key: string): string => {
      const value = input[key];
      return typeof value === 'string' ? value : '';
    };
    return {
      transport: str('transport'),
      routeKey: str('routeKey'),
      linkId: str('linkId'),
      peerPresenceHash: str('peerPresenceHash'),
      peerDestinationHash: str('peerDestinationHash'),
      incoming: input.incoming === true,
      sentFrames: num('sentFrames'),
      sentBytes: num('sentBytes'),
      sendFailures: num('sendFailures'),
      receivedFrames: num('receivedFrames'),
      receivedBytes: num('receivedBytes'),
      fd4EnqueuedFrames: num('fd4EnqueuedFrames'),
      fd4EnqueueFailures: num('fd4EnqueueFailures'),
      lastSendAtMs: num('lastSendAtMs'),
      lastSendFailureAtMs: num('lastSendFailureAtMs'),
      lastReceiveAtMs: num('lastReceiveAtMs'),
      lastFd4EnqueueAtMs: num('lastFd4EnqueueAtMs'),
      lastActivityAtMs: num('lastActivityAtMs'),
      lastRoomId: str('lastRoomId'),
      sendGapMsMax: num('sendGapMsMax'),
      receiveGapMsMax: num('receiveGapMsMax'),
      sendGapOver80Count: num('sendGapOver80Count'),
      sendGapOver160Count: num('sendGapOver160Count'),
      sendGapOver320Count: num('sendGapOver320Count'),
      sendGapOver640Count: num('sendGapOver640Count'),
      sendGapOver1000Count: num('sendGapOver1000Count'),
      receiveGapOver80Count: num('receiveGapOver80Count'),
      receiveGapOver160Count: num('receiveGapOver160Count'),
      receiveGapOver320Count: num('receiveGapOver320Count'),
      receiveGapOver640Count: num('receiveGapOver640Count'),
      receiveGapOver1000Count: num('receiveGapOver1000Count'),
      linkReceiveGapMsMax: num('linkReceiveGapMsMax'),
      linkReceiveGapOver80Count: num('linkReceiveGapOver80Count'),
      linkReceiveGapOver160Count: num('linkReceiveGapOver160Count'),
      linkReceiveGapOver320Count: num('linkReceiveGapOver320Count'),
      linkReceiveGapOver640Count: num('linkReceiveGapOver640Count'),
      linkReceiveGapOver1000Count: num('linkReceiveGapOver1000Count'),
      linkReceiveToCallbackDispatchMsMax: num(
        'linkReceiveToCallbackDispatchMsMax'
      ),
      linkCallbackDispatchToStartMsMax: num('linkCallbackDispatchToStartMsMax'),
      linkReceiveToCallbackStartMsMax: num('linkReceiveToCallbackStartMsMax'),
      linkCallbackDispatchToStartOver80Count: num(
        'linkCallbackDispatchToStartOver80Count'
      ),
      linkCallbackDispatchToStartOver160Count: num(
        'linkCallbackDispatchToStartOver160Count'
      ),
      linkCallbackDispatchToStartOver320Count: num(
        'linkCallbackDispatchToStartOver320Count'
      ),
      linkCallbackDispatchToStartOver640Count: num(
        'linkCallbackDispatchToStartOver640Count'
      ),
      linkCallbackDispatchToStartOver1000Count: num(
        'linkCallbackDispatchToStartOver1000Count'
      ),
      rnsRawInboundGapMsMax: num('rnsRawInboundGapMsMax'),
      rnsRawInboundGapOver80Count: num('rnsRawInboundGapOver80Count'),
      rnsRawInboundGapOver160Count: num('rnsRawInboundGapOver160Count'),
      rnsRawInboundGapOver320Count: num('rnsRawInboundGapOver320Count'),
      rnsRawInboundGapOver640Count: num('rnsRawInboundGapOver640Count'),
      rnsRawInboundGapOver1000Count: num('rnsRawInboundGapOver1000Count'),
      rnsRawInboundToLinkReceiveMsMax: num(
        'rnsRawInboundToLinkReceiveMsMax'
      ),
      rnsRawInboundToLinkReceiveOver80Count: num(
        'rnsRawInboundToLinkReceiveOver80Count'
      ),
      rnsRawInboundToLinkReceiveOver160Count: num(
        'rnsRawInboundToLinkReceiveOver160Count'
      ),
      rnsRawInboundToLinkReceiveOver320Count: num(
        'rnsRawInboundToLinkReceiveOver320Count'
      ),
      rnsRawInboundToLinkReceiveOver640Count: num(
        'rnsRawInboundToLinkReceiveOver640Count'
      ),
      rnsRawInboundToLinkReceiveOver1000Count: num(
        'rnsRawInboundToLinkReceiveOver1000Count'
      ),
      rnsRawInboundInterfaceLast: str('rnsRawInboundInterfaceLast'),
      rnsRawInboundInterfaceWorst: str('rnsRawInboundInterfaceWorst'),
      preRnsSendAgeMsMax: num('preRnsSendAgeMsMax'),
      rnsSendDurationMsMax: num('rnsSendDurationMsMax'),
      receiveToFd4EnqueueMsMax: num('receiveToFd4EnqueueMsMax'),
    };
  }

  private normalizeSchedulerLaneDiagnostic(
    input: Record<string, unknown>
  ): ReticulumSchedulerLaneDiagnostic {
    const num = (key: string): number => {
      const value = input[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    };
    const str = (key: string): string => {
      const value = input[key];
      return typeof value === 'string' ? value : '';
    };
    return {
      lane: str('lane'),
      logicalLane: str('logicalLane'),
      queueMax: num('queueMax'),
      queueDepth: num('queueDepth'),
      queueDepthHighWater: num('queueDepthHighWater'),
      droppedTasks: num('droppedTasks'),
      completedTasks: num('completedTasks'),
      enqueuedTasks: num('enqueuedTasks'),
      dwellMsMax: num('dwellMsMax'),
      busyMsMax: num('busyMsMax'),
      slowTaskCount: num('slowTaskCount'),
      lastTask: str('lastTask'),
    };
  }

  private getQueuedAudioFrameOldestAgeMs(nowMs = Date.now()): number {
    if (this.audioQueuedFrames <= 0) return 0;
    let oldestQueuedAtMs = Number.POSITIVE_INFINITY;
    for (const queue of this.audioFrameQueues.values()) {
      const head = queue[0];
      if (!head) continue;
      oldestQueuedAtMs = Math.min(oldestQueuedAtMs, head.queuedAtMs);
    }
    if (!Number.isFinite(oldestQueuedAtMs)) return 0;
    return Math.max(0, nowMs - oldestQueuedAtMs);
  }

  private recordAudioDropEvents(
    events: Array<{ atMs: number; count: number }>,
    count: number,
    atMs = Date.now()
  ): void {
    if (count <= 0) return;
    events.push({ atMs, count });
    this.pruneRecentAudioDropEvents(events, atMs);
  }

  private pruneRecentAudioDropEvents(
    events: Array<{ atMs: number; count: number }>,
    nowMs = Date.now()
  ): void {
    while (events.length > 0 && nowMs - events[0]!.atMs > 5_000) {
      events.shift();
    }
  }

  private sumRecentAudioDropEvents(
    events: Array<{ atMs: number; count: number }>,
    nowMs = Date.now()
  ): number {
    this.pruneRecentAudioDropEvents(events, nowMs);
    return events.reduce((sum, entry) => sum + entry.count, 0);
  }

  private dropOldestQueuedFrameForLink(linkId: string): boolean {
    const queue = this.audioFrameQueues.get(linkId);
    if (!queue || queue.length === 0) return false;
    const dropped = queue.shift();
    if (!dropped) return false;
    this.audioQueuedFrames = Math.max(0, this.audioQueuedFrames - 1);
    this.audioQueuedBytes = Math.max(
      0,
      this.audioQueuedBytes - dropped.sizeBytes
    );
    this.compactAudioQueueLink(linkId);
    return true;
  }

  private dropOldestQueuedFrameFromLargestQueue(): boolean {
    let chosenLinkId = '';
    let maxDepth = 0;
    for (const linkId of this.audioQueuedLinkOrder) {
      const depth = this.audioFrameQueues.get(linkId)?.length ?? 0;
      if (depth > maxDepth) {
        maxDepth = depth;
        chosenLinkId = linkId;
      }
    }
    if (!chosenLinkId) return false;
    return this.dropOldestQueuedFrameForLink(chosenLinkId);
  }

  private dropQueuedAudioFramesForPeerPresenceHash(
    peerPresenceHash: string
  ): number {
    const peerHash = peerPresenceHash.trim().toLowerCase();
    if (!peerHash) return 0;
    let dropped = 0;
    for (const routeKey of [...this.audioQueuedLinkOrder]) {
      const queue = this.audioFrameQueues.get(routeKey);
      if (!queue || queue.length === 0) continue;
      const kept: QueuedAudioFrame[] = [];
      for (const frame of queue) {
        if (
          frame.peerPresenceHash.trim().toLowerCase() === peerHash ||
          routeKey === `packet:${peerHash}`
        ) {
          this.audioQueuedFrames = Math.max(0, this.audioQueuedFrames - 1);
          this.audioQueuedBytes = Math.max(
            0,
            this.audioQueuedBytes - frame.sizeBytes
          );
          dropped++;
          continue;
        }
        kept.push(frame);
      }
      if (kept.length === queue.length) continue;
      if (kept.length > 0) {
        this.audioFrameQueues.set(routeKey, kept);
      } else {
        this.audioFrameQueues.delete(routeKey);
      }
      this.compactAudioQueueLink(routeKey);
    }
    if (dropped > 0) {
      this.lastAudioQueueSnapshot = this.getAudioQueueSnapshot();
      loggerLog(
        `[ReticulumBridge] Dropped queued group audio frames for peer=${peerHash} count=${dropped}`
      );
    }
    return dropped;
  }

  private compactAudioQueueLink(linkId: string): void {
    const queue = this.audioFrameQueues.get(linkId);
    if (queue && queue.length > 0) return;
    this.audioFrameQueues.delete(linkId);
    const idx = this.audioQueuedLinkOrder.indexOf(linkId);
    if (idx === -1) return;
    this.audioQueuedLinkOrder.splice(idx, 1);
    if (this.audioQueuedLinkOrder.length === 0) {
      this.audioRoundRobinCursor = 0;
      return;
    }
    if (idx < this.audioRoundRobinCursor) {
      this.audioRoundRobinCursor--;
    }
    if (this.audioRoundRobinCursor >= this.audioQueuedLinkOrder.length) {
      this.audioRoundRobinCursor = 0;
    }
  }

  private pruneStaleQueuedAudioFrames(nowMs = Date.now()): number {
    let dropped = 0;
    for (const linkId of [...this.audioQueuedLinkOrder]) {
      const queue = this.audioFrameQueues.get(linkId);
      if (!queue) continue;
      while (queue.length > 0) {
        const next = queue[0];
        if (!next || nowMs - next.queuedAtMs <= this.audioFrameStaleMs) break;
        queue.shift();
        this.audioQueuedFrames = Math.max(0, this.audioQueuedFrames - 1);
        this.audioQueuedBytes = Math.max(
          0,
          this.audioQueuedBytes - next.sizeBytes
        );
        dropped++;
      }
      this.compactAudioQueueLink(linkId);
    }
    return dropped;
  }

  async publish(envelope: PresenceEnvelope): Promise<boolean> {
    await this.start();
    if (this.state !== 'ready') return false;

    if (envelope.type === 'PRESENCE_HEARTBEAT') {
      const semanticKey = semanticPresenceKey(envelope);
      const now = Date.now();
      if (
        now - this.lastHeartbeatSentAt < HEARTBEAT_MIN_INTERVAL_MS &&
        semanticKey === this.lastHeartbeatSemanticKey
      ) {
        loggerLog(
          '[ReticulumBridge] Suppressed heartbeat due to minimum interval'
        );
        return true;
      }
      this.lastHeartbeatSentAt = now;
      this.lastHeartbeatSemanticKey = semanticKey;
    } else {
      const semanticKey = semanticPresenceKey(envelope);
      const lastSentAt = this.lastSemanticPresence.get(semanticKey) ?? 0;
      const now = Date.now();
      if (now - lastSentAt < ANNOUNCE_DEDUP_WINDOW_MS) {
        loggerLog(
          `[ReticulumBridge] Suppressed duplicate ${envelope.type} for ${(envelope.payload as { address?: string }).address ?? 'unknown'}`
        );
        return true;
      }
      this.lastSemanticPresence.set(semanticKey, now);
    }

    loggerLog(
      `[ReticulumBridge] Publishing ${envelope.type} for ${(envelope.payload as { address?: string }).address ?? 'unknown'}`
    );
    const pm = getPresenceManager();
    const activeOverlayNeighborHashes =
      pm?.getReticulumActiveNeighborHashes() ?? [];
    const overlayNeighborHashes =
      activeOverlayNeighborHashes.length > 0
        ? activeOverlayNeighborHashes
        : (pm?.getReticulumVerifiedNeighborHashes() ??
          pm?.getReticulumFanoutDestinationHashes() ??
          []);
    const resp = await this.sendCommand('publish_presence', {
      envelope,
      overlayNeighborHashes,
    });
    const pubAddr =
      typeof (envelope.payload as { address?: string })?.address === 'string'
        ? (envelope.payload as { address: string }).address
        : 'unknown';
    const pl = resp.payload;
    const fanoutPeers =
      pl && typeof pl['fanoutPeers'] === 'number'
        ? pl['fanoutPeers']
        : undefined;
    const fanoutHashes =
      pl &&
      Array.isArray(pl['fanoutHashes']) &&
      pl['fanoutHashes'].every((h): h is string => typeof h === 'string')
        ? (pl['fanoutHashes'] as string[]).join(',')
        : undefined;
    const fanoutLocal =
      pl && typeof pl['localPresenceHash'] === 'string'
        ? pl['localPresenceHash']
        : undefined;
    loggerLog(
      `[ReticulumBridge] target=presence-reticulum tx=${resp.ok ? 'publish_ok' : 'publish_fail'} type=${envelope.type} peer_addr=${pubAddr} envelope_id=${envelope.id ?? 'n/a'} env_ts=${typeof envelope.timestamp === 'number' ? envelope.timestamp : 'n/a'} fanout_peers=${fanoutPeers ?? 'n/a'} fanout_hashes=${fanoutHashes ?? 'n/a'} local_presence_hash=${fanoutLocal ?? this.localPresenceDestinationHash ?? 'n/a'}${resp.ok ? '' : ` err=${resp.error ?? 'unknown'}`}`
    );
    return resp.ok;
  }

  async forwardPresence(
    envelope: PresenceEnvelope,
    overlayHopsRemaining: number,
    excludeDestinationHashes: string[] = [],
    originalSenderHash?: string
  ): Promise<boolean> {
    await this.start();
    if (this.state !== 'ready') return false;
    const resp = await this.sendCommand('forward_presence', {
      envelope,
      overlayHopsRemaining,
      excludeDestinationHashes,
      ...(typeof originalSenderHash === 'string' ? { originalSenderHash } : {}),
    });
    return resp.ok;
  }

  async syncOverlayState(
    verifiedPeers: ReticulumOverlayVerifiedPeer[],
    activeNeighborHashes: string[]
  ): Promise<boolean> {
    await this.start();
    if (this.state !== 'ready') return false;
    const resp = await this.sendCommand('overlay_sync_state', {
      verifiedPeers,
      activeNeighborHashes,
    });
    return resp.ok;
  }

  async noteOverlayCandidateFailure(
    peerHash: string,
    reason: string
  ): Promise<boolean> {
    await this.start();
    if (this.state !== 'ready') return false;
    const resp = await this.sendCommand('overlay_note_candidate_failure', {
      peerHash,
      reason,
    });
    return resp.ok;
  }

  getState(): BridgeState {
    return this.state;
  }

  getConnectivitySnapshot(): ReticulumConnectivitySnapshot {
    return {
      ...this.connectivitySnapshot,
      bridgeState: this.state,
      overlayLinksConnected: this.getEstablishedOverlayPeerCount(),
      ...(this.lastDegradedReason ? { reason: this.lastDegradedReason } : {}),
    };
  }

  /** Unique overlay peers (by presence hash); links without hash yet count separately. */
  private getEstablishedOverlayPeerCount(): number {
    this.pruneStaleOverlayLinkSnapshots();
    const byPeer = new Set<string>();
    let noHash = 0;
    for (const snap of this.overlayLinkSnapshots.values()) {
      const k = snap.peerPresenceHash.trim().toLowerCase();
      if (k) byPeer.add(k);
      else noHash += 1;
    }
    return byPeer.size + noHash;
  }

  getOverlayLinkSnapshots(): ReticulumOverlayLinkSnapshot[] {
    this.pruneStaleOverlayLinkSnapshots();
    const byPeer = new Map<string, ReticulumOverlayLinkSnapshot>();
    const noHash: ReticulumOverlayLinkSnapshot[] = [];
    for (const snap of this.overlayLinkSnapshots.values()) {
      const k = snap.peerPresenceHash.trim().toLowerCase();
      if (!k) {
        noHash.push(snap);
        continue;
      }
      const cur = byPeer.get(k);
      if (!cur || snap.connectedAt < cur.connectedAt) {
        byPeer.set(k, snap);
      }
    }
    return [...byPeer.values(), ...noHash].sort(
      (a, b) => a.connectedAt - b.connectedAt
    );
  }

  private hasEstablishedOverlaySnapshotForPeer(
    peerPresenceHash: string
  ): boolean {
    const peerKey = peerPresenceHash.trim().toLowerCase();
    if (!peerKey) return false;
    for (const snap of this.overlayLinkSnapshots.values()) {
      if (snap.peerPresenceHash.trim().toLowerCase() === peerKey) {
        return true;
      }
    }
    return false;
  }

  private pruneStaleOverlayLinkSnapshots(now = Date.now()): void {
    for (const [linkId, snap] of this.overlayLinkSnapshots.entries()) {
      if (now - snap.lastRxAt <= OVERLAY_LINK_RX_IDLE_TIMEOUT_MS) continue;
      this.overlayEstablishedLinkIds.delete(linkId);
      this.overlayLinkSnapshots.delete(linkId);
      loggerLog(
        `[ReticulumBridge] overlay-link pruned stale snapshot link_id=${linkId} peer=${snap.peerPresenceHash || 'unknown'} rxIdleMs=${now - snap.lastRxAt}`
      );
      if (
        snap.peerPresenceHash &&
        !this.hasEstablishedOverlaySnapshotForPeer(snap.peerPresenceHash)
      ) {
        this.emit('overlay-link-closed', {
          peerHash: snap.peerPresenceHash,
          reason: 'rx_idle_timeout',
        });
      }
    }
  }

  /**
   * Local hub destination hash (RNS hex), set when the bridge receives `ready` from Python.
   * Used by group call join to sign GC_JOIN with a stable Reticulum identity.
   */
  getLocalDestinationHash(): string | undefined {
    return this.localPresenceDestinationHash;
  }

  /**
   * Wait for the bridge to expose the local destination hash. This keeps callers
   * aligned with the actual bridge handshake instead of racing a one-shot field read.
   */
  async waitForLocalDestinationHash(
    timeoutMs = 5_000
  ): Promise<string | undefined> {
    const normalize = (value?: string): string | undefined => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim().toLowerCase();
      return trimmed.length > 0 ? trimmed : undefined;
    };

    const existing = normalize(this.localPresenceDestinationHash);
    if (existing) return existing;

    try {
      await this.start();
    } catch {
      return normalize(this.localPresenceDestinationHash);
    }

    const afterStart = normalize(this.localPresenceDestinationHash);
    if (afterStart) return afterStart;

    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
      const current = normalize(this.localPresenceDestinationHash);
      if (current) return current;
      if (this.state === 'degraded' || this.state === 'stopped') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return normalize(this.localPresenceDestinationHash);
  }

  /**
   * RNS.Identity.get_public_key() as standard base64 (64 bytes); null if bridge not ready.
   */
  async getLocalIdentityPublicKeyBase64(): Promise<string | null> {
    try {
      await this.start();
    } catch {
      return null;
    }
    if (this.state !== 'ready') return null;
    try {
      const resp = await this.sendCommand('get_local_identity_public_key', {});
      if (!resp.ok) return null;
      const pk = resp.payload?.publicKeyBase64;
      return typeof pk === 'string' && pk.length > 0 ? pk : null;
    } catch {
      return null;
    }
  }

  /**
   * Register a peer's RNS public key from a verified GC_JOIN (`rk`) so overlay send can use them.
   */
  async registerPeerIdentityFromGroupJoin(
    peerPresenceHash: string,
    reticulumIdentityPublicKeyBase64: string
  ): Promise<boolean> {
    try {
      await this.start();
    } catch {
      return false;
    }
    if (this.state !== 'ready') return false;
    try {
      const resp = await this.sendCommand('register_peer_identity', {
        peerPresenceHash,
        reticulumIdentityPublicKeyBase64,
      });
      return resp.ok === true;
    } catch {
      return false;
    }
  }

  private async spawnAndHandshake(configDir: string): Promise<void> {
    const launch = resolveBridgeLaunch(configDir);
    if ('error' in launch) {
      this.transitionToDegraded(launch.error);
      throw new Error(launch.error);
    }

    loggerLog(
      `[ReticulumBridge] Launching bridge mode=${launch.mode} cmd=${launch.cmd}`
    );
    const identityPath = getReticulumBridgeIdentityPath();
    fs.mkdirSync(path.dirname(identityPath), { recursive: true });
    const env = {
      ...process.env,
      ...(launch.envExtra ?? {}),
      PYTHONUNBUFFERED: '1',
      QORTAL_RETICULUM_CONFIG_DIR: configDir,
      QORTAL_RETICULUM_IDENTITY_PATH: identityPath,
    };

    const child = spawn(launch.cmd, launch.args, {
      cwd: launch.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child = child;
    loggerLog(
      `[ReticulumBridge] Spawned child pid=${child.pid ?? 'unknown'} cmd=${launch.cmd}`
    );
    const audioOutParent = child.stdio[3];
    if (
      !audioOutParent ||
      typeof (audioOutParent as NodeJS.WritableStream).write !== 'function'
    ) {
      loggerWarn(
        `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd3=parent-write-missing outbound-binary-audio-disabled`
      );
    } else {
      loggerLog(
        `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd3=parent-pipe-open (Electron→Python)`
      );
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      this.handleStdout(chunk);
    });
    const audioIn = child.stdio[4];
    if (
      audioIn &&
      typeof (audioIn as NodeJS.ReadableStream).on === 'function'
    ) {
      (audioIn as NodeJS.ReadableStream).on(
        'data',
        (chunk: Buffer | string) => {
          if (this.child !== child) return;
          const buf = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk as string, 'binary');
          if (!this.audioIpcFd4FirstRawChunkLogged && buf.length > 0) {
            this.audioIpcFd4FirstRawChunkLogged = true;
            loggerLog(
              `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} stage=fd4-first-raw-chunk-from-child len=${buf.length}`
            );
          }
          this.appendAudioInData(buf);
        }
      );
    } else {
      loggerWarn(
        `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd4=parent-read-missing inbound-binary-audio-disabled`
      );
    }
    child.stderr.on('data', (chunk: string) => {
      if (this.child !== child) return;
      const text = chunk.trim();
      if (text) loggerLog(`[ReticulumBridge/stderr] ${text}`);
    });
    child.stdin.on('drain', () => {
      if (this.child !== child) return;
      this.waitingForDrain = false;
      this.flushWriteQueue();
    });
    child.on('error', (err) => {
      if (this.child !== child) return;
      loggerError('[ReticulumBridge] Child process error:', err);
      this.transitionToDegraded(String(err));
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      loggerWarn(
        `[ReticulumBridge] Child exited code=${code} signal=${signal ?? ''}`
      );
      this.child = null;
      if (this.desiredRunning) {
        this.transitionToDegraded(
          `bridge-exit:${code ?? 'null'}:${signal ?? ''}`
        );
        this.scheduleRestart();
      } else {
        this.state = 'stopped';
      }
    });

    const resp = await this.sendCommand('start', {
      configDir,
    });
    if (!resp.ok) {
      const reason = resp.error ?? 'Reticulum bridge start failed';
      this.transitionToDegraded(reason);
      throw new Error(reason);
    }
    loggerLog(
      `[ReticulumBridge] Start handshake completed reticulumWire=${GC_RETICULUM_WIRE_BUILD_MARKER}`
    );
  }

  private sendCommand(
    action: BridgeCmdFrame['action'],
    payload?: Record<string, unknown>
  ): Promise<BridgeRespFrame> {
    if (!this.child || this.child.exitCode !== null) {
      return Promise.resolve({
        type: 'resp',
        id: 'unavailable',
        ok: false,
        error: 'Reticulum bridge is not running',
      });
    }

    const priority = commandPriorityForAction(action);
    const totalPending = this.pending.size;
    const lowPriorityPending = this.countPendingRequestsByPriority('low');
    if (totalPending >= CONTROL_PENDING_MAX) {
      return Promise.resolve(this.makeOverloadedResponse(action));
    }
    if (
      priority === 'low' &&
      lowPriorityPending >= CONTROL_LOW_PRIORITY_PENDING_MAX
    ) {
      return Promise.resolve(this.makeOverloadedResponse(action));
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const frame: BridgeCmdFrame = { type: 'cmd', action, id, payload };
    const wire = JSON.stringify(frame) + '\n';

    return new Promise<BridgeRespFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Reticulum bridge request timed out: ${action}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { action, priority, resolve, reject, timer });
      this.enqueueCommand({ id, wire, priority });
      this.flushWriteQueue();
    });
  }

  private flushWriteQueue(): void {
    if (!this.child || this.waitingForDrain) return;
    for (;;) {
      const frame = this.dequeueNextCommand();
      if (!frame) return;
      const ok = this.child.stdin.write(frame.wire);
      if (!ok) {
        this.waitingForDrain = true;
        return;
      }
    }
  }

  private makeOverloadedResponse(
    action: BridgeCmdFrame['action']
  ): BridgeRespFrame {
    return {
      type: 'resp',
      id: 'overloaded',
      ok: false,
      payload: {
        code: 'bridge_overloaded',
        action,
      },
      error: `Reticulum bridge queue overloaded: ${action}`,
    };
  }

  private countPendingRequestsByPriority(priority: BridgeCmdPriority): number {
    let count = 0;
    for (const pending of this.pending.values()) {
      if (pending.priority === priority) {
        count += 1;
      }
    }
    return count;
  }

  private enqueueCommand(entry: QueuedCommand): void {
    switch (entry.priority) {
      case 'high':
        this.highPriorityWriteQueue.push(entry);
        return;
      case 'normal':
        this.normalPriorityWriteQueue.push(entry);
        return;
      case 'low':
        this.lowPriorityWriteQueue.push(entry);
        return;
    }
  }

  private dequeueNextCommand(): QueuedCommand | null {
    for (const queue of [
      this.highPriorityWriteQueue,
      this.normalPriorityWriteQueue,
      this.lowPriorityWriteQueue,
    ]) {
      while (queue.length > 0) {
        const next = queue.shift() ?? null;
        if (!next) {
          break;
        }
        if (!this.pending.has(next.id)) {
          continue;
        }
        return next;
      }
    }
    return null;
  }

  private scheduleAudioOutFlush(): void {
    if (this.audioFlushScheduled) return;
    this.audioFlushScheduled = true;
    setImmediate(() => {
      this.audioFlushScheduled = false;
      // Run several pack→flush rounds in one turn so a slow fd3 does not leave frames stuck
      // in `audioFrameQueues` until the next enqueue (reduces queue-pressure drops under burst).
      const maxRounds = 8;
      for (let round = 0; round < maxRounds; round++) {
        if (this.audioQueuedFrames <= 0) break;
        this.packAudioFramesIntoBinaryWrites();
        this.flushAudioBinaryQueue();
        if (this.waitingForAudioBinaryDrain) break;
      }
    });
  }

  private packAudioFramesIntoBinaryWrites(): void {
    const staleDrops = this.pruneStaleQueuedAudioFrames();
    if (staleDrops > 0) {
      this.audioStaleDrops += staleDrops;
      this.recordAudioDropEvents(this.audioStaleDropEvents, staleDrops);
    }
    while (
      this.audioQueuedFrames > 0 &&
      this.child &&
      this.audioBinaryWriteQueue.length < this.audioBinaryWriteQueueMax
    ) {
      const batch: ReticulumAudioFrame[] = [];
      const batchTiming: AudioBinaryWriteQueueItem['frames'] = [];
      let bodyBudget = 2;
      const maxBody = Math.min(60000, RETICULUM_AUDIO_MAX_BODY_BYTES);
      let madeProgress = false;
      while (
        this.audioQueuedFrames > 0 &&
        batch.length < RETICULUM_AUDIO_MAX_FRAMES_PER_BATCH
      ) {
        if (this.audioQueuedLinkOrder.length === 0) break;
        let next: QueuedAudioFrame | null = null;
        let routeKey = '';
        let scanned = 0;
        while (scanned < this.audioQueuedLinkOrder.length) {
          if (this.audioQueuedLinkOrder.length === 0) break;
          const index =
            this.audioRoundRobinCursor % this.audioQueuedLinkOrder.length;
          routeKey = this.audioQueuedLinkOrder[index]!;
          const queue = this.audioFrameQueues.get(routeKey);
          if (!queue || queue.length === 0) {
            this.compactAudioQueueLink(routeKey);
            scanned++;
            continue;
          }
          next = queue[0] ?? null;
          break;
        }
        if (!next || !routeKey) break;
        const lid = Buffer.from(next.linkId, 'utf8');
        const rid = Buffer.from(next.roomId, 'utf8');
        const pph = Buffer.from(next.peerPresenceHash, 'utf8');
        const pch = Buffer.from(next.peerDestinationHash, 'utf8');
        const frameBody =
          1 +
          lid.length +
          1 +
          rid.length +
          1 +
          pph.length +
          1 +
          pch.length +
          2 +
          next.data.length;
        const nextBody = bodyBudget + frameBody;
        if (batch.length > 0 && nextBody > maxBody) break;
        const queue = this.audioFrameQueues.get(routeKey);
        if (!queue || queue.length === 0) break;
        queue.shift();
        this.audioQueuedFrames = Math.max(0, this.audioQueuedFrames - 1);
        this.audioQueuedBytes = Math.max(
          0,
          this.audioQueuedBytes - next.sizeBytes
        );
        batch.push({
          linkId: next.linkId,
          roomId: next.roomId,
          peerPresenceHash: next.peerPresenceHash,
          peerDestinationHash: next.peerDestinationHash,
          receivedAtWallMs: next.queuedAtMs,
          payload: next.data,
        });
        batchTiming.push({
          routeKey,
          rendererSendAtMs: next.rendererSendAtMs,
          bridgeEnqueuedAtMs: next.bridgeEnqueuedAtMs,
        });
        bodyBudget = nextBody;
        madeProgress = true;
        this.compactAudioQueueLink(routeKey);
        if (this.audioQueuedLinkOrder.length > 0) {
          this.audioRoundRobinCursor =
            (this.audioRoundRobinCursor + 1) % this.audioQueuedLinkOrder.length;
        } else {
          this.audioRoundRobinCursor = 0;
        }
      }
      if (batch.length === 0 || !madeProgress) break;
      try {
        const buf = encodeReticulumAudioBatch(batch);
        this.audioBinaryWriteQueue.push({
          buf,
          queuedAtMs: Date.now(),
          frames: batchTiming,
        });
      } catch (err) {
        loggerError('[ReticulumBridge] encode audio batch failed:', err);
      }
    }
  }

  private flushAudioBinaryQueue(): void {
    const c = this.child;
    const raw = c?.stdio?.[3];
    if (!c || !raw || this.waitingForAudioBinaryDrain) return;
    const stream = raw as NodeJS.WritableStream & {
      write(chunk: Buffer, cb?: (err?: Error | null) => void): boolean;
      once(event: 'drain', listener: () => void): typeof stream;
    };
    while (this.audioBinaryWriteQueue.length > 0) {
      const item = this.audioBinaryWriteQueue[0]!;
      const noteWriteTiming = () => {
        const nowMs = Date.now();
        this.lastAudioQueueSnapshot.bridgeEnqueueToFd3WriteQueueDwellMsMax =
          Math.max(
            this.lastAudioQueueSnapshot.bridgeEnqueueToFd3WriteQueueDwellMsMax,
            Math.max(0, nowMs - item.queuedAtMs)
          );
        for (const frame of item.frames) {
          this.lastAudioQueueSnapshot.bridgeEnqueueToFd3WriteMsMax = Math.max(
            this.lastAudioQueueSnapshot.bridgeEnqueueToFd3WriteMsMax,
            Math.max(0, nowMs - frame.bridgeEnqueuedAtMs)
          );
          if (frame.rendererSendAtMs) {
            this.lastAudioQueueSnapshot.rendererToFd3WriteMsMax = Math.max(
              this.lastAudioQueueSnapshot.rendererToFd3WriteMsMax,
              Math.max(0, nowMs - frame.rendererSendAtMs)
            );
          }
        }
      };
      const ok = stream.write(item.buf);
      if (!ok) {
        this.waitingForAudioBinaryDrain = true;
        stream.once('drain', () => {
          this.waitingForAudioBinaryDrain = false;
          noteWriteTiming();
          this.audioBinaryWriteQueue.shift();
          if (!this.audioIpcFd3FirstBatchLogged) {
            this.audioIpcFd3FirstBatchLogged = true;
            loggerLog(
              `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd3=first-batch-written (async drain)`
            );
          }
          this.flushAudioBinaryQueue();
          // fd3 was back-pressured; after draining the binary queue, pull any frames that were
          // blocked from packing while `audioBinaryWriteQueue` was at capacity.
          if (this.audioQueuedFrames > 0) {
            this.packAudioFramesIntoBinaryWrites();
            this.flushAudioBinaryQueue();
          }
        });
        return;
      }
      noteWriteTiming();
      this.audioBinaryWriteQueue.shift();
      if (!this.audioIpcFd3FirstBatchLogged) {
        this.audioIpcFd3FirstBatchLogged = true;
        loggerLog(
          `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd3=first-batch-written`
        );
      }
    }
  }

  private appendAudioInData(chunk: Buffer): void {
    this.audioInBuffer = Buffer.concat([this.audioInBuffer, chunk]);
    for (;;) {
      if (this.audioInBuffer.length < RETICULUM_AUDIO_HEADER_BYTES) return;
      if (
        this.audioInBuffer.subarray(0, 4).compare(RETICULUM_AUDIO_MAGIC) !== 0
      ) {
        loggerWarn(
          `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd4=bad-magic-resync`
        );
        this.audioInBuffer = this.audioInBuffer.subarray(1);
        continue;
      }
      if (this.audioInBuffer[4] !== RETICULUM_AUDIO_VERSION) {
        loggerWarn(
          `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd4=bad-version-resync`
        );
        this.audioInBuffer = this.audioInBuffer.subarray(1);
        continue;
      }
      const bodyLen = this.audioInBuffer.readUInt32BE(5);
      if (bodyLen > RETICULUM_AUDIO_MAX_BODY_BYTES) {
        loggerWarn(
          `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd4=oversize-body-resync`
        );
        this.audioInBuffer = this.audioInBuffer.subarray(1);
        continue;
      }
      const total = RETICULUM_AUDIO_HEADER_BYTES + bodyLen;
      if (this.audioInBuffer.length < total) return;
      const msg = this.audioInBuffer.subarray(0, total);
      this.audioInBuffer = this.audioInBuffer.subarray(total);
      try {
        const frames = decodeReticulumAudioMessage(msg);
        if (!this.audioIpcFd4FirstMessageLogged) {
          this.audioIpcFd4FirstMessageLogged = true;
          loggerLog(
            `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd4=first-message-decoded frames=${frames.length}`
          );
        }
        for (const f of frames) {
          const transport: 'link' | 'packet' = f.linkId ? 'link' : 'packet';
          const routeKey =
            transport === 'link'
              ? f.linkId
              : `packet:${(f.peerPresenceHash || f.peerDestinationHash || 'unknown').trim().toLowerCase()}`;
          const pkt: ReticulumGroupAudioPacketPayload = {
            linkId: f.linkId,
            routeKey,
            transport,
            roomId: f.roomId,
            data: Buffer.from(f.payload),
            peerPresenceHash: f.peerPresenceHash ?? '',
            peerDestinationHash: f.peerDestinationHash ?? '',
            ...(f.receivedAtWallMs && f.receivedAtWallMs > 0
              ? { receivedAtWallMs: f.receivedAtWallMs }
              : {}),
            incoming: true,
          };
          this.emit('group-audio-packet', pkt);
        }
      } catch (err) {
        loggerError(
          `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd4=decode-error`,
          err
        );
      }
    }
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    for (;;) {
      const nlIndex = this.stdoutBuffer.indexOf('\n');
      if (nlIndex === -1) return;
      const line = this.stdoutBuffer.slice(0, nlIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nlIndex + 1);
      if (!line) continue;

      let frame: BridgeRespFrame | BridgeEventFrame;
      try {
        frame = JSON.parse(line) as BridgeRespFrame | BridgeEventFrame;
      } catch (err) {
        loggerError('[ReticulumBridge] Invalid JSON frame:', err);
        loggerError(`[ReticulumBridge] Invalid line: ${line}`);
        continue;
      }
      this.handleFrame(frame);
    }
  }

  private handleFrame(frame: BridgeRespFrame | BridgeEventFrame): void {
    if (frame.type === 'resp') {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      // `start` responds with the same destination hash as the `ready` event; applying
      // it here covers ordering/chunking where the event line is processed after the resp.
      if (frame.ok) {
        const raw = frame.payload?.destinationHash;
        if (typeof raw === 'string') {
          const h = raw.trim().toLowerCase();
          if (h.length > 0) {
            this.localPresenceDestinationHash = h;
          }
        }
      }
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      pending.resolve(frame);
      return;
    }

    switch (frame.event) {
      case 'ready':
        this.state = 'ready';
        this.lastDegradedReason = undefined;
        this.overlayEstablishedLinkIds.clear();
        this.overlayLinkSnapshots.clear();
        this.connectivitySnapshot = {
          ...this.connectivitySnapshot,
          bridgeState: 'ready',
          reason: undefined,
        };
        this.localPresenceDestinationHash =
          typeof frame.payload?.destinationHash === 'string'
            ? frame.payload.destinationHash
            : undefined;
        loggerLog(
          `[ReticulumBridge] Ready destination=${frame.payload?.destinationHash ?? 'unknown'}`
        );
        this.emit('ready');
        return;
      case 'presence_message': {
        const envelope = frame.payload?.envelope;
        const route = toPresenceRoute(frame.payload?.route);
        if (!envelope || !route || route.kind !== 'reticulum') return;
        const peerAddr =
          typeof (envelope.payload as { address?: string })?.address ===
          'string'
            ? (envelope.payload as { address: string }).address
            : 'unknown';
        loggerLog(
          `[ReticulumBridge] Inbound ${envelope.type} from ${peerAddr} via ${route.viaDestinationHash ?? route.destinationHash} origin ${route.destinationHash}`
        );
        loggerLog(
          `[ReticulumBridge] target=presence-reticulum rx=bridge_in type=${envelope.type} peer_addr=${peerAddr} sender_hash=${route.destinationHash} via_hash=${route.viaDestinationHash ?? route.destinationHash} envelope_id=${envelope.id ?? 'n/a'} env_ts=${typeof envelope.timestamp === 'number' ? envelope.timestamp : 'n/a'}`
        );
        this.emit('presence-envelope', envelope, route);
        return;
      }
      case 'candidate_peer_discovered': {
        const peerHash = frame.payload?.peerHash;
        if (typeof peerHash !== 'string' || !peerHash) return;
        this.emit('candidate-peer-discovered', {
          peerHash,
          ...(typeof frame.payload?.source === 'string'
            ? { source: frame.payload.source }
            : {}),
        });
        return;
      }
      case 'call_message': {
        const wire = frame.payload?.wire;
        const senderDestinationHash = frame.payload?.senderDestinationHash;
        const peerPresenceHash = frame.payload?.peerPresenceHash;
        if (!wire || typeof wire !== 'object') return;
        this.markOverlayPeerVerifiedFromQortalTraffic(
          typeof peerPresenceHash === 'string' ? peerPresenceHash : '',
          typeof senderDestinationHash === 'string'
            ? senderDestinationHash
            : '',
          'call_signal'
        );
        this.emit(
          'call-message',
          wire as Record<string, unknown>,
          typeof senderDestinationHash === 'string'
            ? senderDestinationHash
            : '',
          typeof peerPresenceHash === 'string' ? peerPresenceHash : ''
        );
        return;
      }
      case 'group_call_message': {
        const wire = frame.payload?.wire;
        const senderDestinationHash = frame.payload?.senderDestinationHash;
        const peerPresenceHash = frame.payload?.peerPresenceHash;
        if (!wire || typeof wire !== 'object') return;
        this.markOverlayPeerVerifiedFromQortalTraffic(
          typeof peerPresenceHash === 'string' ? peerPresenceHash : '',
          typeof senderDestinationHash === 'string'
            ? senderDestinationHash
            : '',
          'group_signal'
        );
        this.emit(
          'group-call-message',
          wire as Record<string, unknown>,
          typeof senderDestinationHash === 'string'
            ? senderDestinationHash
            : '',
          typeof peerPresenceHash === 'string' ? peerPresenceHash : '',
          typeof frame.payload?.linkId === 'string' ? frame.payload.linkId : ''
        );
        return;
      }
      case 'group_audio_link_established': {
        const linkId = frame.payload?.linkId;
        if (typeof linkId !== 'string' || !linkId) return;
        this.emit('group-audio-link-established', {
          linkId,
          peerPresenceHash:
            typeof frame.payload?.peerPresenceHash === 'string'
              ? frame.payload.peerPresenceHash
              : '',
          peerDestinationHash:
            typeof frame.payload?.peerDestinationHash === 'string'
              ? frame.payload.peerDestinationHash
              : '',
          incoming: frame.payload?.incoming === true,
        });
        return;
      }
      case 'group_audio_link_closed': {
        const linkId = frame.payload?.linkId;
        if (typeof linkId !== 'string' || !linkId) return;
        this.emit('group-audio-link-closed', {
          linkId,
          peerPresenceHash:
            typeof frame.payload?.peerPresenceHash === 'string'
              ? frame.payload.peerPresenceHash
              : '',
          peerDestinationHash:
            typeof frame.payload?.peerDestinationHash === 'string'
              ? frame.payload.peerDestinationHash
              : '',
          incoming: frame.payload?.incoming === true,
          reason:
            typeof frame.payload?.reason === 'string'
              ? frame.payload.reason
              : '',
        });
        return;
      }
      case 'group_audio_send_failed': {
        const linkId =
          typeof frame.payload?.linkId === 'string' ? frame.payload.linkId : '';
        const peerPresenceHash =
          typeof frame.payload?.peerPresenceHash === 'string'
            ? frame.payload.peerPresenceHash
            : '';
        const transport =
          frame.payload?.transport === 'packet' ? 'packet' : 'link';
        if (!linkId && !peerPresenceHash) return;
        const code =
          typeof frame.payload?.code === 'string' ? frame.payload.code : '';
        if (code && !this.audioIpcSendFailedCodesLogged.has(code)) {
          this.audioIpcSendFailedCodesLogged.add(code);
          loggerWarn(
            `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} stage=rns-send-failed-first-code code=${code} transport=${transport} target=${linkId ? linkId.slice(0, 8) : peerPresenceHash.slice(0, 16)} reason=${typeof frame.payload?.reason === 'string' ? frame.payload.reason : ''}${typeof frame.payload?.error === 'string' && frame.payload.error ? ` err=${frame.payload.error}` : ''}`
          );
        }
        this.emit('group-audio-send-failed', {
          linkId,
          peerPresenceHash,
          transport,
          reason:
            typeof frame.payload?.reason === 'string'
              ? frame.payload.reason
              : '',
          code,
          error:
            typeof frame.payload?.error === 'string' ? frame.payload.error : '',
          pathState:
            typeof frame.payload?.pathState === 'string'
              ? frame.payload.pathState
              : '',
        });
        return;
      }
      case 'group_audio_queue_state': {
        this.lastAudioQueueSnapshot = {
          ...this.getAudioQueueSnapshot(),
          decodedQueueDepth:
            typeof frame.payload?.decodedQueueDepth === 'number'
              ? frame.payload.decodedQueueDepth
              : this.lastAudioQueueSnapshot.decodedQueueDepth,
          decodedQueueOldestAgeMs:
            typeof frame.payload?.decodedQueueOldestAgeMs === 'number'
              ? frame.payload.decodedQueueOldestAgeMs
              : this.lastAudioQueueSnapshot.decodedQueueOldestAgeMs,
          decodedQueueMax:
            typeof frame.payload?.decodedQueueMax === 'number'
              ? frame.payload.decodedQueueMax
              : this.lastAudioQueueSnapshot.decodedQueueMax,
          decodedQueueDrops:
            typeof frame.payload?.decodedQueueDrops === 'number'
              ? frame.payload.decodedQueueDrops
              : this.lastAudioQueueSnapshot.decodedQueueDrops,
          binaryOutQueueDepth:
            typeof frame.payload?.binaryOutQueueDepth === 'number'
              ? frame.payload.binaryOutQueueDepth
              : this.lastAudioQueueSnapshot.binaryOutQueueDepth,
          binaryOutQueueOldestAgeMs:
            typeof frame.payload?.binaryOutQueueOldestAgeMs === 'number'
              ? frame.payload.binaryOutQueueOldestAgeMs
              : this.lastAudioQueueSnapshot.binaryOutQueueOldestAgeMs,
          binaryOutQueueMax:
            typeof frame.payload?.binaryOutQueueMax === 'number'
              ? frame.payload.binaryOutQueueMax
              : this.lastAudioQueueSnapshot.binaryOutQueueMax,
          binaryOutQueueDrops:
            typeof frame.payload?.binaryOutQueueDrops === 'number'
              ? frame.payload.binaryOutQueueDrops
              : this.lastAudioQueueSnapshot.binaryOutQueueDrops,
          jsonOutQueueDrops:
            typeof frame.payload?.jsonOutQueueDrops === 'number'
              ? frame.payload.jsonOutQueueDrops
              : this.lastAudioQueueSnapshot.jsonOutQueueDrops,
          staleDrops:
            typeof frame.payload?.staleDrops === 'number'
              ? frame.payload.staleDrops
              : this.lastAudioQueueSnapshot.staleDrops,
          packetSendFailures:
            typeof frame.payload?.packetSendFailures === 'number'
              ? frame.payload.packetSendFailures
              : this.lastAudioQueueSnapshot.packetSendFailures,
          packetPathRequests:
            typeof frame.payload?.packetPathRequests === 'number'
              ? frame.payload.packetPathRequests
              : this.lastAudioQueueSnapshot.packetPathRequests,
          packetPathResolutions:
            typeof frame.payload?.packetPathResolutions === 'number'
              ? frame.payload.packetPathResolutions
              : this.lastAudioQueueSnapshot.packetPathResolutions,
          packetPathTimeouts:
            typeof frame.payload?.packetPathTimeouts === 'number'
              ? frame.payload.packetPathTimeouts
              : this.lastAudioQueueSnapshot.packetPathTimeouts,
          packetFreshSends:
            typeof frame.payload?.packetFreshSends === 'number'
              ? frame.payload.packetFreshSends
              : this.lastAudioQueueSnapshot.packetFreshSends,
          packetStaleSends:
            typeof frame.payload?.packetStaleSends === 'number'
              ? frame.payload.packetStaleSends
              : this.lastAudioQueueSnapshot.packetStaleSends,
          packetUnknownSends:
            typeof frame.payload?.packetUnknownSends === 'number'
              ? frame.payload.packetUnknownSends
              : this.lastAudioQueueSnapshot.packetUnknownSends,
          deadlineDropCount:
            typeof frame.payload?.deadlineDropCount === 'number'
              ? frame.payload.deadlineDropCount
              : this.lastAudioQueueSnapshot.deadlineDropCount,
          decodedQueueEvictOldestCount:
            typeof frame.payload?.decodedQueueEvictOldestCount === 'number'
              ? frame.payload.decodedQueueEvictOldestCount
              : this.lastAudioQueueSnapshot.decodedQueueEvictOldestCount,
          decodedQueueDropNewestCount:
            typeof frame.payload?.decodedQueueDropNewestCount === 'number'
              ? frame.payload.decodedQueueDropNewestCount
              : this.lastAudioQueueSnapshot.decodedQueueDropNewestCount,
          fd3DecodedAgeMsMax:
            typeof frame.payload?.fd3DecodedAgeMsMax === 'number'
              ? frame.payload.fd3DecodedAgeMsMax
              : this.lastAudioQueueSnapshot.fd3DecodedAgeMsMax,
          decodedQueueDwellMsMax:
            typeof frame.payload?.decodedQueueDwellMsMax === 'number'
              ? frame.payload.decodedQueueDwellMsMax
              : this.lastAudioQueueSnapshot.decodedQueueDwellMsMax,
          rnsSendDurationMsMax:
            typeof frame.payload?.rnsSendDurationMsMax === 'number'
              ? frame.payload.rnsSendDurationMsMax
              : this.lastAudioQueueSnapshot.rnsSendDurationMsMax,
          packetPathCheckMsMax:
            typeof frame.payload?.packetPathCheckMsMax === 'number'
              ? frame.payload.packetPathCheckMsMax
              : this.lastAudioQueueSnapshot.packetPathCheckMsMax,
          executorLoopGapMsMax:
            typeof frame.payload?.executorLoopGapMsMax === 'number'
              ? frame.payload.executorLoopGapMsMax
              : this.lastAudioQueueSnapshot.executorLoopGapMsMax,
          executorGapWhileQueuedMsMax:
            typeof frame.payload?.executorGapWhileQueuedMsMax === 'number'
              ? frame.payload.executorGapWhileQueuedMsMax
              : this.lastAudioQueueSnapshot.executorGapWhileQueuedMsMax,
          executorAudioPassMsMax:
            typeof frame.payload?.executorAudioPassMsMax === 'number'
              ? frame.payload.executorAudioPassMsMax
              : this.lastAudioQueueSnapshot.executorAudioPassMsMax,
          processBatchMsMax:
            typeof frame.payload?.processBatchMsMax === 'number'
              ? frame.payload.processBatchMsMax
              : this.lastAudioQueueSnapshot.processBatchMsMax,
          processBatchFramesMax:
            typeof frame.payload?.processBatchFramesMax === 'number'
              ? frame.payload.processBatchFramesMax
              : this.lastAudioQueueSnapshot.processBatchFramesMax,
          rnsSendSlowCount:
            typeof frame.payload?.rnsSendSlowCount === 'number'
              ? frame.payload.rnsSendSlowCount
              : this.lastAudioQueueSnapshot.rnsSendSlowCount,
          executorStallCount:
            typeof frame.payload?.executorStallCount === 'number'
              ? frame.payload.executorStallCount
              : this.lastAudioQueueSnapshot.executorStallCount,
          executorCommandMsMax:
            typeof frame.payload?.executorCommandMsMax === 'number'
              ? frame.payload.executorCommandMsMax
              : this.lastAudioQueueSnapshot.executorCommandMsMax,
          executorCommandWhileQueuedMsMax:
            typeof frame.payload?.executorCommandWhileQueuedMsMax === 'number'
              ? frame.payload.executorCommandWhileQueuedMsMax
              : this.lastAudioQueueSnapshot.executorCommandWhileQueuedMsMax,
          executorCommandSlowCount:
            typeof frame.payload?.executorCommandSlowCount === 'number'
              ? frame.payload.executorCommandSlowCount
              : this.lastAudioQueueSnapshot.executorCommandSlowCount,
          rnsCallbackSchedulerGapMsMax:
            typeof frame.payload?.rnsCallbackSchedulerGapMsMax === 'number'
              ? frame.payload.rnsCallbackSchedulerGapMsMax
              : this.lastAudioQueueSnapshot.rnsCallbackSchedulerGapMsMax,
          rnsCallbackSchedulerGapOver100Count:
            typeof frame.payload?.rnsCallbackSchedulerGapOver100Count ===
            'number'
              ? frame.payload.rnsCallbackSchedulerGapOver100Count
              : this.lastAudioQueueSnapshot.rnsCallbackSchedulerGapOver100Count,
          rnsCallbackSchedulerGapOver250Count:
            typeof frame.payload?.rnsCallbackSchedulerGapOver250Count ===
            'number'
              ? frame.payload.rnsCallbackSchedulerGapOver250Count
              : this.lastAudioQueueSnapshot.rnsCallbackSchedulerGapOver250Count,
          rnsCallbackSchedulerGapOver500Count:
            typeof frame.payload?.rnsCallbackSchedulerGapOver500Count ===
            'number'
              ? frame.payload.rnsCallbackSchedulerGapOver500Count
              : this.lastAudioQueueSnapshot.rnsCallbackSchedulerGapOver500Count,
          rnsCallbackSchedulerGapOver1000Count:
            typeof frame.payload?.rnsCallbackSchedulerGapOver1000Count ===
            'number'
              ? frame.payload.rnsCallbackSchedulerGapOver1000Count
              : this.lastAudioQueueSnapshot
                  .rnsCallbackSchedulerGapOver1000Count,
          rnsRawInboundGapMsMax:
            typeof frame.payload?.rnsRawInboundGapMsMax === 'number'
              ? frame.payload.rnsRawInboundGapMsMax
              : this.lastAudioQueueSnapshot.rnsRawInboundGapMsMax,
          rnsRawInboundGapOver80Count:
            typeof frame.payload?.rnsRawInboundGapOver80Count === 'number'
              ? frame.payload.rnsRawInboundGapOver80Count
              : this.lastAudioQueueSnapshot.rnsRawInboundGapOver80Count,
          rnsRawInboundGapOver160Count:
            typeof frame.payload?.rnsRawInboundGapOver160Count === 'number'
              ? frame.payload.rnsRawInboundGapOver160Count
              : this.lastAudioQueueSnapshot.rnsRawInboundGapOver160Count,
          rnsRawInboundGapOver320Count:
            typeof frame.payload?.rnsRawInboundGapOver320Count === 'number'
              ? frame.payload.rnsRawInboundGapOver320Count
              : this.lastAudioQueueSnapshot.rnsRawInboundGapOver320Count,
          rnsRawInboundGapOver640Count:
            typeof frame.payload?.rnsRawInboundGapOver640Count === 'number'
              ? frame.payload.rnsRawInboundGapOver640Count
              : this.lastAudioQueueSnapshot.rnsRawInboundGapOver640Count,
          rnsRawInboundGapOver1000Count:
            typeof frame.payload?.rnsRawInboundGapOver1000Count === 'number'
              ? frame.payload.rnsRawInboundGapOver1000Count
              : this.lastAudioQueueSnapshot.rnsRawInboundGapOver1000Count,
          rnsRawInboundToLinkReceiveMsMax:
            typeof frame.payload?.rnsRawInboundToLinkReceiveMsMax === 'number'
              ? frame.payload.rnsRawInboundToLinkReceiveMsMax
              : this.lastAudioQueueSnapshot.rnsRawInboundToLinkReceiveMsMax,
          rnsRawInboundToLinkReceiveOver80Count:
            typeof frame.payload?.rnsRawInboundToLinkReceiveOver80Count ===
            'number'
              ? frame.payload.rnsRawInboundToLinkReceiveOver80Count
              : this.lastAudioQueueSnapshot
                  .rnsRawInboundToLinkReceiveOver80Count,
          rnsRawInboundToLinkReceiveOver160Count:
            typeof frame.payload?.rnsRawInboundToLinkReceiveOver160Count ===
            'number'
              ? frame.payload.rnsRawInboundToLinkReceiveOver160Count
              : this.lastAudioQueueSnapshot
                  .rnsRawInboundToLinkReceiveOver160Count,
          rnsRawInboundToLinkReceiveOver320Count:
            typeof frame.payload?.rnsRawInboundToLinkReceiveOver320Count ===
            'number'
              ? frame.payload.rnsRawInboundToLinkReceiveOver320Count
              : this.lastAudioQueueSnapshot
                  .rnsRawInboundToLinkReceiveOver320Count,
          rnsRawInboundToLinkReceiveOver640Count:
            typeof frame.payload?.rnsRawInboundToLinkReceiveOver640Count ===
            'number'
              ? frame.payload.rnsRawInboundToLinkReceiveOver640Count
              : this.lastAudioQueueSnapshot
                  .rnsRawInboundToLinkReceiveOver640Count,
          rnsRawInboundToLinkReceiveOver1000Count:
            typeof frame.payload?.rnsRawInboundToLinkReceiveOver1000Count ===
            'number'
              ? frame.payload.rnsRawInboundToLinkReceiveOver1000Count
              : this.lastAudioQueueSnapshot
                  .rnsRawInboundToLinkReceiveOver1000Count,
          rnsRawInboundToLinkReceiveSamples:
            typeof frame.payload?.rnsRawInboundToLinkReceiveSamples === 'number'
              ? frame.payload.rnsRawInboundToLinkReceiveSamples
              : this.lastAudioQueueSnapshot.rnsRawInboundToLinkReceiveSamples,
          rnsRawInboundInterfaceLast:
            typeof frame.payload?.rnsRawInboundInterfaceLast === 'string'
              ? frame.payload.rnsRawInboundInterfaceLast
              : this.lastAudioQueueSnapshot.rnsRawInboundInterfaceLast,
          rnsRawInboundInterfaceWorst:
            typeof frame.payload?.rnsRawInboundInterfaceWorst === 'string'
              ? frame.payload.rnsRawInboundInterfaceWorst
              : this.lastAudioQueueSnapshot.rnsRawInboundInterfaceWorst,
          schedulerDiagnostics: Array.isArray(
            frame.payload?.schedulerDiagnostics
          )
            ? frame.payload.schedulerDiagnostics
                .filter((item): item is Record<string, unknown> => {
                  return !!item && typeof item === 'object';
                })
                .map((item) => this.normalizeSchedulerLaneDiagnostic(item))
            : this.lastAudioQueueSnapshot.schedulerDiagnostics,
          mediaRouteDiagnostics: Array.isArray(
            frame.payload?.mediaRouteDiagnostics
          )
            ? frame.payload.mediaRouteDiagnostics
                .filter((item): item is Record<string, unknown> => {
                  return !!item && typeof item === 'object';
                })
                .map((item) => this.normalizeAudioMediaRouteDiagnostic(item))
            : this.lastAudioQueueSnapshot.mediaRouteDiagnostics,
        };
        return;
      }
      case 'overlay_link_state': {
        const linkId = frame.payload?.linkId;
        if (typeof linkId !== 'string' || !linkId) return;
        const peerPresenceHash =
          typeof frame.payload?.peerPresenceHash === 'string'
            ? frame.payload.peerPresenceHash
            : '';
        const reason =
          typeof frame.payload?.reason === 'string' ? frame.payload.reason : '';
        const queuedPackets =
          typeof frame.payload?.queuedPackets === 'number'
            ? frame.payload.queuedPackets
            : 0;
        if (shouldLogOverlayLinkStateEvent(reason)) {
          loggerLog(
            `[ReticulumBridge] overlay-link link_id=${linkId} peer=${peerPresenceHash || 'unknown'} incoming=${frame.payload?.incoming === true ? 'yes' : 'no'} established=${frame.payload?.established === true ? 'yes' : 'no'} queued=${queuedPackets}${reason ? ` reason=${reason}` : ''}${overlayAgeDetail(frame.payload as Record<string, unknown> | undefined)}`
          );
        }
        const established = frame.payload?.established === true;
        if (established) {
          this.overlayEstablishedLinkIds.add(linkId);
          const existing = this.overlayLinkSnapshots.get(linkId);
          const lastRxAt =
            typeof frame.payload?.lastRxAt === 'number' &&
            Number.isFinite(frame.payload.lastRxAt)
              ? frame.payload.lastRxAt
              : (existing?.lastRxAt ?? Date.now());
          this.overlayLinkSnapshots.set(linkId, {
            linkId,
            peerPresenceHash:
              peerPresenceHash || existing?.peerPresenceHash || '',
            incoming: frame.payload?.incoming === true,
            connectedAt: existing?.connectedAt ?? Date.now(),
            lastRxAt,
          });
        } else {
          this.overlayEstablishedLinkIds.delete(linkId);
          this.overlayLinkSnapshots.delete(linkId);
        }
        if (
          frame.payload?.closedByReticulum === true &&
          peerPresenceHash &&
          !this.hasEstablishedOverlaySnapshotForPeer(peerPresenceHash)
        ) {
          this.emit('overlay-link-closed', {
            peerHash: peerPresenceHash,
            reason,
          });
        }
        this.emit('overlay-link-state', {
          linkId,
          peerPresenceHash,
          incoming: frame.payload?.incoming === true,
          established,
          reason,
          queuedPackets,
          closedByReticulum: frame.payload?.closedByReticulum === true,
        });
        return;
      }
      case 'qchat_file_transfer': {
        this.emit('qchat-file-transfer', frame.payload ?? {});
        return;
      }
      case 'error': {
        const message =
          frame.payload?.message ??
          frame.payload?.detail ??
          'Reticulum bridge reported an error';
        loggerError('[ReticulumBridge] Python error event:', message);
        return;
      }
      case 'transport_state': {
        const hubSummary =
          typeof frame.payload?.hubSummary === 'string'
            ? frame.payload.hubSummary
            : undefined;
        const reason =
          typeof frame.payload?.reason === 'string'
            ? frame.payload.reason
            : undefined;
        const reachability = frame.payload?.reachability;
        this.connectivitySnapshot = {
          bridgeState: this.state,
          reachability:
            reachability === 'lan-only' ||
            reachability === 'hub-connected' ||
            reachability === 'disconnected'
              ? reachability
              : 'unknown',
          transportEnabled: frame.payload?.transportEnabled === true,
          configuredHubInterfaces:
            typeof frame.payload?.configuredHubInterfaces === 'number'
              ? frame.payload.configuredHubInterfaces
              : undefined,
          onlineHubInterfaces:
            typeof frame.payload?.onlineHubInterfaces === 'number'
              ? frame.payload.onlineHubInterfaces
              : undefined,
          configuredRemoteHubInterfaces:
            typeof frame.payload?.configuredRemoteHubInterfaces === 'number'
              ? frame.payload.configuredRemoteHubInterfaces
              : undefined,
          onlineRemoteHubInterfaces:
            typeof frame.payload?.onlineRemoteHubInterfaces === 'number'
              ? frame.payload.onlineRemoteHubInterfaces
              : undefined,
          hubSummary,
          reason,
          meshListenOnline: frame.payload?.meshListenOnline === true,
        };
        if (hubSummary !== 'Unable to read Reticulum interface stats') {
          persistReticulumSharedTransportState({
            reachability: this.connectivitySnapshot.reachability,
            transportEnabled: this.connectivitySnapshot.transportEnabled,
            configuredHubInterfaces:
              this.connectivitySnapshot.configuredHubInterfaces,
            onlineHubInterfaces: this.connectivitySnapshot.onlineHubInterfaces,
            configuredRemoteHubInterfaces:
              this.connectivitySnapshot.configuredRemoteHubInterfaces,
            onlineRemoteHubInterfaces:
              this.connectivitySnapshot.onlineRemoteHubInterfaces,
            hubSummary: this.connectivitySnapshot.hubSummary,
            ...(reason ? { reason } : {}),
          });
        }
        loggerLog(
          `[ReticulumBridge] Transport state=${this.connectivitySnapshot.reachability} hubs=${this.connectivitySnapshot.onlineHubInterfaces ?? 0}/${this.connectivitySnapshot.configuredHubInterfaces ?? 0} remote_hubs=${this.connectivitySnapshot.onlineRemoteHubInterfaces ?? 0}/${this.connectivitySnapshot.configuredRemoteHubInterfaces ?? 0} transport=${this.connectivitySnapshot.transportEnabled === true ? 'on' : 'off'} meshListenOnline=${this.connectivitySnapshot.meshListenOnline === true ? 'on' : 'off'}`
        );
        this.emit('transport-state', this.getConnectivitySnapshot());
        return;
      }
    }
  }

  private transitionToDegraded(reason?: string): void {
    if (this.state === 'degraded' && !reason) return;
    this.state = 'degraded';
    this.lastDegradedReason = reason;
    this.localPresenceDestinationHash = undefined;
    this.overlayEstablishedLinkIds.clear();
    this.overlayLinkSnapshots.clear();
    this.connectivitySnapshot = {
      ...this.connectivitySnapshot,
      bridgeState: 'degraded',
      reachability: 'disconnected',
      reason,
    };
    loggerWarn(`[ReticulumBridge] Degraded: ${reason ?? 'unknown reason'}`);
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason ?? 'Reticulum bridge degraded'));
    }
    this.pending.clear();
    this.highPriorityWriteQueue = [];
    this.normalPriorityWriteQueue = [];
    this.lowPriorityWriteQueue = [];
    this.waitingForDrain = false;
    this.audioFrameQueues.clear();
    this.audioQueuedLinkOrder = [];
    this.audioRoundRobinCursor = 0;
    this.audioQueuedFrames = 0;
    this.audioQueuedBytes = 0;
    this.audioQueuePressureDrops = 0;
    this.audioStaleDrops = 0;
    this.audioQueuePressureDropEvents = [];
    this.audioStaleDropEvents = [];
    this.audioBinaryWriteQueue = [];
    this.waitingForAudioBinaryDrain = false;
    this.audioFlushScheduled = false;
    this.audioInBuffer = Buffer.alloc(0);
    this.audioIpcFd3FirstBatchLogged = false;
    this.audioIpcFd4FirstMessageLogged = false;
    this.audioIpcFd4FirstRawChunkLogged = false;
    this.audioIpcSendFailedCodesLogged.clear();
    this.emit('degraded', reason);
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return;
    loggerLog(`[ReticulumBridge] Scheduling restart in ${RESTART_DELAY_MS}ms`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start().catch((err) => {
        loggerError('[ReticulumBridge] Restart failed:', err);
        this.scheduleRestart();
      });
    }, RESTART_DELAY_MS);
    this.restartTimer.unref?.();
  }

  private async sendDetailed(
    action:
      | 'send_call'
      | 'accept_qchat_file_resource'
      | 'send_qchat_file_resource'
      | 'authorize_qchat_file_resource'
      | 'reject_qchat_file_resource'
      | 'fanout_call'
      | 'send_group_call'
      | 'fanout_group_call'
      | 'send_group_audio_link_heartbeat'
      | 'close_group_audio_link'
      | 'reset_group_audio_peer_state'
      | 'warm_group_audio_path',
    payload: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    try {
      await this.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: 'bridge-exception',
        error: message,
      };
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.sendCommand(action, payload);
      if (resp.ok) {
        return { ok: true };
      }
      const reason = this.mapSendFailureReason(resp);
      return {
        ok: false,
        reason,
        ...(resp.error ? { error: resp.error } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: message.includes('timed out')
          ? 'bridge-timeout'
          : 'bridge-exception',
        error: message,
      };
    }
  }

  private mapSendFailureReason(
    frame: BridgeRespFrame
  ): ReticulumSendFailureReason {
    const code = frame.payload?.code;
    if (code === 'bridge_overloaded') return 'bridge-overloaded';
    if (code === 'bridge_not_started') return 'bridge-not-started';
    if (code === 'unknown_peer_presence_hash')
      return 'unknown-peer-presence-hash';
    if (code === 'wire_too_large') return 'wire-too-large';
    if (code === 'packet_send_false') return 'packet-send-false';
    if (code === 'no_route') return 'no-route';
    if (code === 'unknown_link_id') return 'unknown-link-id';
    if (code === 'audio_link_not_ready') return 'audio-link-not-ready';
    if (code === 'audio_payload_too_large') return 'audio-payload-too-large';
    if (frame.error === 'Reticulum bridge is not running') {
      return 'bridge-unavailable';
    }
    return 'send-command-failed';
  }
}

let bridgeInstance: ReticulumBridge | null = null;

export function getReticulumBridge(): ReticulumBridge | null {
  return bridgeInstance;
}

export async function startReticulumBridge(): Promise<ReticulumBridge> {
  if (!bridgeInstance) {
    bridgeInstance = new ReticulumBridge();
  }
  await bridgeInstance.start();
  return bridgeInstance;
}

export function stopReticulumBridge(): void {
  bridgeInstance?.stop();
  bridgeInstance = null;
}

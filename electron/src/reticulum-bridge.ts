import { ChildProcess, spawn, spawnSync } from 'child_process';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { randomBytes, randomUUID } from 'crypto';
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
  getReticulumInstanceIndex,
  getReticulumSourceEnvExtra,
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
import { runMainPressureTask } from './main-pressure';
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
import { isReticulumRuntimeEnabled } from './reticulum-runtime-state';

const RETICULUM_AUDIO_QUEUED_AT_MS = Symbol.for(
  'qortal.reticulumAudioQueuedAtMs'
);
const GCALL_AUDIO_RENDERER_SEND_AT_MS = Symbol.for(
  'qortal.gcallAudioRendererSendAtMs'
);
const GCALL_AUDIO_MANAGER_FLUSH_AT_MS = Symbol.for(
  'qortal.gcallAudioManagerFlushAtMs'
);
const GCALL_AUDIO_FRAME_KIND = Symbol.for('qortal.gcallAudioFrameKind');
const GCALL_AUDIO_CONTROL_TYPE = Symbol.for('qortal.gcallAudioControlType');
const GC_LINK_CONTROL_MAGIC = Buffer.from('QGCCTL1\0', 'ascii');

function readNumberSymbol(data: Buffer, symbol: symbol): number | undefined {
  const value = Reflect.get(data, symbol);
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function readStringSymbol(data: Buffer, symbol: symbol): string | undefined {
  const value = Reflect.get(data, symbol);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

type ReticulumAudioFrameKind = 'media' | 'control';

function inspectReticulumAudioFrame(data: Buffer): {
  frameKind: ReticulumAudioFrameKind;
  controlType?: string;
} {
  const symbolKind = readStringSymbol(data, GCALL_AUDIO_FRAME_KIND);
  const symbolControlType = readStringSymbol(data, GCALL_AUDIO_CONTROL_TYPE);
  if (symbolKind === 'control' || symbolKind === 'media') {
    return {
      frameKind: symbolKind,
      controlType: symbolControlType,
    };
  }
  if (
    data.length > GC_LINK_CONTROL_MAGIC.length &&
    data.subarray(0, GC_LINK_CONTROL_MAGIC.length).equals(GC_LINK_CONTROL_MAGIC)
  ) {
    try {
      const parsed = JSON.parse(
        data.subarray(GC_LINK_CONTROL_MAGIC.length).toString('utf8')
      ) as unknown;
      const controlType =
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as { type?: unknown }).type === 'string'
          ? (parsed as { type: string }).type
          : undefined;
      return { frameKind: 'control', controlType };
    } catch {
      return { frameKind: 'control' };
    }
  }
  return { frameKind: 'media' };
}

function audioFrameLogPrefix(frameKind: ReticulumAudioFrameKind): string {
  return frameKind === 'control' ? 'gcall-control' : 'gcall-audio';
}

function audioFrameLogDetail(
  frameKind: ReticulumAudioFrameKind,
  controlType?: string
): string {
  return `frame_kind=${frameKind}${controlType ? ` control_type=${controlType}` : ''}`;
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
  'reticulum_chat_fanout',
]);
const BRIDGE_GRACEFUL_STOP_TIMEOUT_MS = 5_000;
const BRIDGE_FORCE_STOP_TIMEOUT_MS = 3_000;
const P2P_HEALTH_RECEIVE_WINDOW_MS = 30_000;
const P2P_HEALTH_MIN_RECEIVING_PEERS = 1;

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

function numericFrameField(frame: unknown, key: string): number | null {
  if (!frame || typeof frame !== 'object') return null;
  const value = (frame as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bridgeEventTimingDetail(frame: unknown, nowMs: number): string {
  const queuedAtMs = numericFrameField(frame, '_queuedAtMs');
  const writeAtMs = numericFrameField(frame, '_writeAtMs');
  const queuedDepthBefore = numericFrameField(frame, '_eventQueueDepthBefore');
  const queuedDepthAfter = numericFrameField(frame, '_eventQueueDepthAfter');
  const parts: string[] = [];
  if (queuedAtMs !== null) {
    parts.push(`queued_age_ms=${Math.max(0, Math.round(nowMs - queuedAtMs))}`);
  }
  if (writeAtMs !== null) {
    parts.push(`stdout_age_ms=${Math.max(0, Math.round(nowMs - writeAtMs))}`);
  }
  if (queuedAtMs !== null && writeAtMs !== null) {
    parts.push(
      `python_queue_ms=${Math.max(0, Math.round(writeAtMs - queuedAtMs))}`
    );
  }
  if (queuedDepthBefore !== null) {
    parts.push(`queue_depth_before=${Math.round(queuedDepthBefore)}`);
  }
  if (queuedDepthAfter !== null) {
    parts.push(`queue_depth_after=${Math.round(queuedDepthAfter)}`);
  }
  return parts.join(' ');
}

type BridgeCmdFrame = {
  type: 'cmd';
  action:
    | 'start'
    | 'publish_presence'
    | 'clear_presence_cache'
    | 'forward_presence'
    | 'overlay_sync_state'
    | 'configure_reticulum_chat_pinned_peers'
    | 'overlay_note_candidate_failure'
    | 'stop'
    | 'send_call'
    | 'prepare_reticulum_resource_session'
    | 'accept_qchat_file_resource'
    | 'send_qchat_file_resource'
    | 'authorize_qchat_file_resource'
    | 'reject_qchat_file_resource'
    | 'accept_reticulum_chat_resource'
    | 'send_reticulum_chat_resource'
    | 'authorize_reticulum_chat_resource'
    | 'reject_reticulum_chat_resource'
    | 'accept_reticulum_resource'
    | 'send_reticulum_resource'
    | 'authorize_reticulum_resource'
    | 'reject_reticulum_resource'
    | 'cancel_reticulum_resource'
    | 'fanout_call'
    | 'send_group_call'
    | 'fanout_group_call'
    | 'send_reticulum_chat'
    | 'send_reticulum_chat_targets'
    | 'fanout_reticulum_chat'
    | 'send_group_audio_link_control'
    | 'send_group_audio_link_heartbeat'
    | 'open_group_audio_link'
    | 'close_group_audio_link'
    | 'reset_group_audio_peer_state'
    | 'warm_group_audio_path'
    | 'clear_group_audio_diagnostics'
    | 'get_group_audio_data_plane_session'
    | 'configure_group_audio_data_plane_routes'
    | 'configure_group_audio_forwarding'
    | 'configure_land_state_forwarding'
    | 'get_local_identity_public_key'
    | 'ensure_peer_identity'
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
  rnsSharedFrameGapMsMax: number;
  rnsSharedFrameGapOver80Count: number;
  rnsSharedFrameGapOver160Count: number;
  rnsSharedFrameGapOver320Count: number;
  rnsSharedFrameGapOver640Count: number;
  rnsSharedFrameGapOver1000Count: number;
  rnsSharedFrameToTransportInboundMsMax: number;
  rnsSharedFrameToTransportInboundOver80Count: number;
  rnsSharedFrameToTransportInboundOver160Count: number;
  rnsSharedFrameToTransportInboundOver320Count: number;
  rnsSharedFrameToTransportInboundOver640Count: number;
  rnsSharedFrameToTransportInboundOver1000Count: number;
  rnsSharedFrameToTransportInboundSamples: number;
  rnsSharedFrameInterfaceLast: string;
  rnsSharedFrameInterfaceWorst: string;
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

export type ReticulumAudioDataPlaneRoute = {
  address: string;
  transport: 'link' | 'packet';
  linkId?: string;
  peerPresenceHash?: string;
  peerDestinationHash?: string;
};

export type ReticulumAudioForwardingRule = {
  sourceAddress: string;
  ingress: ReticulumAudioDataPlaneRoute;
  targets: ReticulumAudioDataPlaneRoute[];
};

export type ReticulumAudioForwardingPlan = {
  roomId: string;
  topologyEpoch: number;
  rules: ReticulumAudioForwardingRule[];
};

export type ReticulumLandStateForwardingTarget = {
  peerPresenceHash: string;
  expiresAt: number;
};

export type ReticulumLandStateForwardingPlan = {
  groupId: number;
  targets: ReticulumLandStateForwardingTarget[];
};

export type ReticulumLandStateAuthSession = {
  groupId: number;
  authorAddress: string;
  sessionId: string;
  ephemeralPublicKey: string;
  expiresAt: number;
};

export type ReticulumAudioDataPlaneSessionResult =
  | {
      ok: true;
      endpoint: string;
      token: string;
      version: 2;
      routeCount: number;
      routes: ReticulumAudioDataPlaneRoute[];
    }
  | {
      ok: false;
      reason: ReticulumSendFailureReason | 'audio-data-plane-disabled';
      error?: string;
    };

export type ReticulumSendResult =
  | { ok: true }
  | {
      ok: false;
      reason: ReticulumSendFailureReason;
      error?: string;
    };

export type ReticulumTargetedChatFailure = {
  peerPresenceHash: string;
  reason: ReticulumSendFailureReason;
  error?: string;
};

export type ReticulumTargetedChatResult =
  | {
      ok: true;
      deliveredPeerHashes: string[];
      failures: ReticulumTargetedChatFailure[];
    }
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
  /** Recently receiving RNS.Link sessions used for Reticulum presence/signaling overlay (not group audio). */
  overlayLinksConnected?: number;
  /** Recently receiving outbound overlay peers this node can send fanout to. */
  overlayLinksOutboundConnected?: number;
  /** Recently receiving inbound overlay peers feeding this node data. */
  overlayLinksInboundConnected?: number;
  /** Distinct overlay peers we have received traffic from inside the health window. */
  overlayLinksReceivingConnected?: number;
  /** How long the receiving-peer count has continuously satisfied the health threshold. */
  overlayLinksReceivingStableMs?: number;
};

export type ReticulumOverlayVerifiedPeer = {
  destinationHash: string;
  lastSeen: number;
};

export type ReticulumOverlayAccountEndpointLease = {
  destinationHash: string;
  address: string;
  sessionId: string;
  lastSeen: number;
  expiresAt: number;
  verification: 'direct-bound' | 'direct-legacy' | 'relayed-bound';
};

export type ReticulumOverlayLinkSnapshot = {
  linkId: string;
  peerPresenceHash: string;
  incoming: boolean;
  overlayTransportAdmitted: boolean;
  connectedAt: number;
  lastRxAt: number;
  lastActivityAt: number;
};

type BridgeEventFrame =
  | {
      type: 'event';
      event: 'ready';
      payload?: { destinationHash?: string };
    }
  | {
      type: 'event';
      event: 'qortalland_game_ws_ready';
      payload?: { port?: number; instanceId?: string };
    }
  | {
      type: 'event';
      event: 'presence_message';
      payload?: {
        envelope?: PresenceEnvelope;
        route?: {
          kind: 'reticulum';
          destinationHash: string;
          viaDestinationHash?: string;
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
      event: 'reticulum_chat_message';
      payload?: {
        wire?: Record<string, unknown>;
        senderDestinationHash?: string;
        peerPresenceHash?: string;
        linkId?: string;
        landStateFastForwarded?: boolean;
        landStateForwardingRevision?: number;
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
      event: 'group_audio_fast_path_activity';
      payload?: {
        roomId?: string;
        sourceAddress?: string;
        linkId?: string;
        peerPresenceHash?: string;
        peerDestinationHash?: string;
        forwardedTargets?: number;
        receivedAtWallMs?: number;
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
        overlayTransportAdmitted?: boolean;
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
      event: 'reticulum_chat_resource';
      payload?: Record<string, unknown>;
    }
  | {
      type: 'event';
      event: 'reticulum_resource';
      payload?: Record<string, unknown>;
    }
  | {
      type: 'event';
      event: 'reticulum_resource_session';
      payload?: {
        status?: 'ready' | 'failed';
        peerPresenceHash?: string;
        lane?: 'fast' | 'bulk';
        linkId?: string;
        reason?: string;
      };
    }
  | {
      type: 'event';
      event: 'error';
      payload?: {
        code?: string;
        message?: string;
        detail?: string;
        lane?: string;
        task?: string;
        action?: string;
      };
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

export type BridgeState = 'stopped' | 'starting' | 'ready' | 'degraded';

export type ReticulumPresencePublishOptions = {
  /** Bypass local heartbeat/announce dedup for explicit recovery replays. */
  force?: boolean;
  reason?: string;
};

export type ReticulumPresenceHealthSnapshot = {
  bridgeState: BridgeState;
  lastPresencePublishAt: number;
  lastPresencePublishOkAt: number;
  lastPresenceFanoutPeers: number | null;
  lastInboundPresenceAt: number;
  lastOverlayLinkClosedAt: number;
  recentOverlayLinkTimeouts: number;
};

const REQUEST_TIMEOUT_MS = 10_000;
const CONTROL_PENDING_MAX = 512;
const CONTROL_LOW_PRIORITY_PENDING_MAX = 128;
const HEARTBEAT_MIN_INTERVAL_MS = 10_000;
const ANNOUNCE_DEDUP_WINDOW_MS = 1_000;
const RESTART_DELAY_MS = 2_000;
const OVERLAY_LINK_RX_IDLE_TIMEOUT_MS = 95_000;
const OVERLAY_LINK_STALE_PRUNE_INTERVAL_MS = 5_000;

/** Grep main-process logs for this string when debugging binary audio IPC (fd3/fd4). */
const RETICULUM_AUDIO_IPC_LOG = 'target=reticulum-audio-ipc';
const RETICULUM_AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS = 80;
const RETICULUM_AUDIO_TIMING_GAP_LOG_THRESHOLD_MS = 320;
const RETICULUM_AUDIO_TIMING_LOG_THROTTLE_MS = 2_000;
const RETICULUM_AUDIO_PATH_PRESSURE_LOG_INTERVAL_MS = 5_000;
const RETICULUM_STDOUT_DRAIN_MAX_LINES = readPositiveIntEnv(
  'QORTAL_RETICULUM_STDOUT_DRAIN_MAX_LINES',
  32
);
const RETICULUM_STDOUT_DRAIN_MAX_MS = readPositiveIntEnv(
  'QORTAL_RETICULUM_STDOUT_DRAIN_MAX_MS',
  5
);
const RETICULUM_STDOUT_PAUSE_BYTES = readPositiveIntEnv(
  'QORTAL_RETICULUM_STDOUT_PAUSE_BYTES',
  256 * 1024
);
const RETICULUM_STDOUT_RESUME_BYTES = readPositiveIntEnv(
  'QORTAL_RETICULUM_STDOUT_RESUME_BYTES',
  64 * 1024
);
const RETICULUM_STDOUT_FRAME_SLOW_MS = readPositiveIntEnv(
  'QORTAL_RETICULUM_STDOUT_FRAME_SLOW_MS',
  50
);
const RETICULUM_STDOUT_EMIT_SLOW_MS = readPositiveIntEnv(
  'QORTAL_RETICULUM_STDOUT_EMIT_SLOW_MS',
  50
);

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function bridgeExeName(): string {
  return process.platform === 'win32'
    ? 'presence_bridge.exe'
    : 'presence_bridge';
}

function getFrozenBridgePath(): string {
  const exeName = bridgeExeName();
  if (app.isPackaged) {
    const base = path.join(process.resourcesPath, 'reticulum');
    const archSpecific =
      process.platform === 'darwin'
        ? path.join(base, `darwin-${process.arch}`, exeName)
        : null;
    if (archSpecific && fs.existsSync(archSpecific)) return archSpecific;
    return path.join(base, exeName);
  }
  return path.join(__dirname, '..', '..', 'resources', 'reticulum', exeName);
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

function signalBridgeProcessTree(
  pid: number,
  signal: NodeJS.Signals = 'SIGTERM'
): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (err) {
      const code =
        typeof err === 'object' && err && 'code' in err
          ? String((err as { code?: unknown }).code ?? '')
          : '';
      if (code !== 'ESRCH') {
        loggerWarn(
          `[ReticulumBridge] Failed to signal child process group pid=${pid}:`,
          err
        );
        return false;
      }
      try {
        process.kill(pid, signal);
        return true;
      } catch (pidErr) {
        loggerWarn(
          `[ReticulumBridge] Failed to signal child pid=${pid}:`,
          pidErr
        );
        return false;
      }
    }
  }

  const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) {
    loggerWarn(
      `[ReticulumBridge] Failed to taskkill child tree pid=${pid}:`,
      result.error
    );
    return false;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    loggerWarn(
      `[ReticulumBridge] taskkill child tree pid=${pid} exited status=${result.status}${detail ? ` detail=${detail}` : ''}`
    );
    return false;
  }
  return true;
}

function waitForBridgeChildExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(true);
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    timer.unref?.();
    child.once('exit', onExit);
    child.once('error', onError);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(true);
    }
  });
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
    case 'configure_reticulum_chat_pinned_peers':
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
  frameKind: ReticulumAudioFrameKind;
  controlType?: string;
};

type AudioBinaryWriteQueueItem = {
  buf: Buffer;
  queuedAtMs: number;
  frames: Array<{
    routeKey: string;
    rendererSendAtMs?: number;
    bridgeEnqueuedAtMs: number;
    frameKind: ReticulumAudioFrameKind;
    controlType?: string;
  }>;
};

export class ReticulumBridge extends EventEmitter implements PresenceTransport {
  readonly kind = 'reticulum' as const;

  private child: ChildProcess | null = null;
  private gameTransportToken: string | null = null;
  private gameTransportInstanceId: string | null = null;
  private gameTransportUrl: string | null = null;
  private desiredRunning = false;
  private state: BridgeState = 'stopped';
  private stdoutBuffer = '';
  private stdoutChunkQueue: string[] = [];
  private stdoutQueuedBytes = 0;
  private stdoutDrainScheduled = false;
  private stdoutPaused = false;
  private stdoutPressureLogLastAt = 0;
  private stdoutSlowFrameLogLastByKey = new Map<string, number>();
  private stdoutSlowEmitLogLastByEvent = new Map<string, number>();
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
  private audioTimingLogLastByKey = new Map<string, number>();
  private bridgeEventTimingLogLastByEvent = new Map<string, number>();
  private audioLastBridgeEnqueueAtMsByRoute = new Map<string, number>();
  private audioLastFd3WriteAtMsByRoute = new Map<string, number>();
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
    rnsSharedFrameGapMsMax: 0,
    rnsSharedFrameGapOver80Count: 0,
    rnsSharedFrameGapOver160Count: 0,
    rnsSharedFrameGapOver320Count: 0,
    rnsSharedFrameGapOver640Count: 0,
    rnsSharedFrameGapOver1000Count: 0,
    rnsSharedFrameToTransportInboundMsMax: 0,
    rnsSharedFrameToTransportInboundOver80Count: 0,
    rnsSharedFrameToTransportInboundOver160Count: 0,
    rnsSharedFrameToTransportInboundOver320Count: 0,
    rnsSharedFrameToTransportInboundOver640Count: 0,
    rnsSharedFrameToTransportInboundOver1000Count: 0,
    rnsSharedFrameToTransportInboundSamples: 0,
    rnsSharedFrameInterfaceLast: '',
    rnsSharedFrameInterfaceWorst: '',
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
  private audioPathPressureByRoute = new Map<
    string,
    {
      windowStartedAtMs: number;
      frames: number;
      bytes: number;
      fd4DecodeGapMsMax: number;
      pythonToElectronMsMax: number;
      lastDecodedAtMs: number;
    }
  >();
  /** First JSON `group_audio_send_failed` per `code` (RNS path). */
  private audioIpcSendFailedCodesLogged = new Set<string>();
  private pending = new Map<string, PendingRequest>();
  private resourceSessionPreparations = new Map<
    string,
    Promise<ReticulumSendResult>
  >();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private overlayStalePruneTimer: ReturnType<typeof setInterval> | null = null;
  private statePromise: Promise<void> | null = null;
  private launchConfigDir: string | null = null;
  private lastHeartbeatSentAt = 0;
  private lastHeartbeatSemanticKey: string | null = null;
  private lastSemanticPresence = new Map<string, number>();
  private lastPresencePublishAt = 0;
  private lastPresencePublishOkAt = 0;
  private lastPresenceFanoutPeers: number | null = null;
  private lastInboundPresenceAt = 0;
  private lastOverlayLinkClosedAt = 0;
  private recentOverlayLinkTimeouts: number[] = [];
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
  private overlayReceivingHealthySince: number | null = null;

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
      lastActivityAgeMs?: number | null;
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
    this.ensureOverlayStalePruneTimer();
    this.statePromise = this.spawnAndHandshake(configDir).finally(() => {
      this.statePromise = null;
    });
    return this.statePromise;
  }

  private prepareStop(): ChildProcess | null {
    this.desiredRunning = false;
    loggerLog('[ReticulumBridge] Stopping bridge');
    this.state = 'stopped';
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.clearOverlayStalePruneTimer();
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
    this.resetStdoutState();
    const child = this.child;
    this.child = null;
    this.localPresenceDestinationHash = undefined;
    this.launchConfigDir = null;
    this.emit('stopped');
    return child && child.exitCode === null ? child : null;
  }

  stop(): void {
    const child = this.prepareStop();
    if (!child) return;
    if (typeof child.pid === 'number') {
      signalBridgeProcessTree(child.pid, 'SIGTERM');
    } else {
      child.kill();
    }
  }

  async stopAndWait(
    gracefulTimeoutMs = BRIDGE_GRACEFUL_STOP_TIMEOUT_MS
  ): Promise<void> {
    const child = this.prepareStop();
    if (!child) return;

    if (typeof child.pid === 'number') {
      signalBridgeProcessTree(child.pid, 'SIGTERM');
    } else {
      child.kill();
    }

    if (await waitForBridgeChildExit(child, gracefulTimeoutMs)) {
      return;
    }

    const pid = child.pid;
    loggerWarn(
      `[ReticulumBridge] Bridge child pid=${pid ?? 'unknown'} survived graceful stop; forcing stop`
    );
    if (typeof pid === 'number') {
      signalBridgeProcessTree(pid, 'SIGKILL');
    } else {
      child.kill('SIGKILL');
    }
    if (!(await waitForBridgeChildExit(child, BRIDGE_FORCE_STOP_TIMEOUT_MS))) {
      loggerError(
        `[ReticulumBridge] Bridge child pid=${pid ?? 'unknown'} did not exit after force stop`
      );
    }
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

  async acceptReticulumChatResourceDetailed(payload: {
    peerPresenceHash: string;
    reticulumIdentityPublicKeyBase64: string;
    authMessage: Record<string, unknown>;
    transferId: string;
    savePath: string;
    fileName: string;
    size: number;
    sha256?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('accept_reticulum_chat_resource', payload);
  }

  async ensureReticulumResourceSessionDetailed(payload: {
    peerPresenceHash: string;
    reticulumIdentityPublicKeyBase64: string;
    resourceType: string;
    logicalResourceType?: string;
  }): Promise<ReticulumSendResult> {
    const peerPresenceHash = payload.peerPresenceHash.trim().toLowerCase();
    const logicalResourceType = payload.logicalResourceType ?? '';
    const lane =
      logicalResourceType === 'reticulum_chat_dm_page' ||
      (![
        'reticulum_chat_history_page',
        'reticulum_chat_metadata_snapshot',
        'reticulum_chat_event_page',
        'reticulum_chat_calendar',
      ].includes(logicalResourceType) &&
        payload.resourceType === 'reticulum_chat_event')
        ? 'fast'
        : 'bulk';
    if (!peerPresenceHash) {
      return {
        ok: false,
        reason: 'unknown-peer-presence-hash',
        error: 'Missing peer presence hash',
      };
    }
    const key = `${peerPresenceHash}:${lane}`;
    const existing = this.resourceSessionPreparations.get(key);
    if (existing) return existing;
    const preparation = this.prepareReticulumResourceSession({
      ...payload,
      peerPresenceHash,
      lane,
    });
    this.resourceSessionPreparations.set(key, preparation);
    void preparation.finally(() => {
      if (this.resourceSessionPreparations.get(key) === preparation) {
        this.resourceSessionPreparations.delete(key);
      }
    });
    return preparation;
  }

  private async prepareReticulumResourceSession(payload: {
    peerPresenceHash: string;
    reticulumIdentityPublicKeyBase64: string;
    resourceType: string;
    logicalResourceType?: string;
    lane: 'fast' | 'bulk';
  }): Promise<ReticulumSendResult> {
    try {
      await this.start();
    } catch (err) {
      return {
        ok: false,
        reason: 'bridge-exception',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    return new Promise<ReticulumSendResult>((resolve) => {
      let settled = false;
      let expectedLinkId = '';
      const pendingSessionStates: Array<{
        status?: string;
        peerPresenceHash?: string;
        lane?: string;
        linkId?: string;
        reason?: string;
      }> = [];
      const finish = (result: ReticulumSendResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.off('reticulum-resource-session', onSessionState);
        this.off('degraded', onDegraded);
        this.off('stopped', onStopped);
        resolve(result);
      };
      const onSessionState = (state: {
        status?: string;
        peerPresenceHash?: string;
        lane?: string;
        linkId?: string;
        reason?: string;
      }) => {
        if (
          state.peerPresenceHash?.trim().toLowerCase() !==
            payload.peerPresenceHash ||
          state.lane !== payload.lane
        ) {
          return;
        }
        if (!expectedLinkId) {
          pendingSessionStates.push(state);
          return;
        }
        if (state.linkId && state.linkId !== expectedLinkId) return;
        if (state.status === 'ready') {
          finish({ ok: true });
        } else if (state.status === 'failed') {
          finish({
            ok: false,
            reason:
              state.reason === 'resource_session_backoff'
                ? 'no-route'
                : 'send-command-failed',
            ...(state.reason ? { error: state.reason } : {}),
          });
        }
      };
      const onDegraded = (reason?: string) => {
        finish({
          ok: false,
          reason: 'bridge-not-ready',
          ...(reason ? { error: reason } : {}),
        });
      };
      const onStopped = () => {
        finish({
          ok: false,
          reason: 'bridge-not-ready',
          error: 'Reticulum bridge stopped',
        });
      };
      const timer = setTimeout(() => {
        finish({
          ok: false,
          reason: 'bridge-timeout',
          error: 'Reticulum resource session preparation timed out',
        });
      }, 32_000);
      timer.unref?.();
      this.on('reticulum-resource-session', onSessionState);
      this.on('degraded', onDegraded);
      this.on('stopped', onStopped);
      void this.sendCommand('prepare_reticulum_resource_session', {
        peerPresenceHash: payload.peerPresenceHash,
        reticulumIdentityPublicKeyBase64:
          payload.reticulumIdentityPublicKeyBase64,
        resourceType: payload.resourceType,
        ...(payload.logicalResourceType
          ? { logicalResourceType: payload.logicalResourceType }
          : {}),
      })
        .then((resp) => {
          if (!resp.ok) {
            finish({
              ok: false,
              reason: this.mapSendFailureReason(resp),
              ...(resp.error ? { error: resp.error } : {}),
            });
            return;
          }
          expectedLinkId = String(resp.payload?.linkId ?? '');
          if (resp.payload?.status === 'ready') {
            finish({ ok: true });
            return;
          }
          for (const state of pendingSessionStates) {
            if (!state.linkId || state.linkId === expectedLinkId) {
              onSessionState(state);
              if (settled) break;
            }
          }
          pendingSessionStates.length = 0;
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          finish({
            ok: false,
            reason: message.includes('timed out')
              ? 'bridge-timeout'
              : 'bridge-exception',
            error: message,
          });
        });
    });
  }

  async sendReticulumChatResourceDetailed(payload: {
    allowedRecipientAddress: string;
    transferId: string;
    filePath: string;
    fileName: string;
    size: number;
    sha256?: string;
    expiresAt?: number;
    metadata?: Record<string, unknown>;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_reticulum_chat_resource', payload);
  }

  async authorizeReticulumChatResourceDetailed(payload: {
    linkId: string;
    transferId: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('authorize_reticulum_chat_resource', payload);
  }

  async rejectReticulumChatResourceDetailed(payload: {
    linkId: string;
    transferId: string;
    reason: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('reject_reticulum_chat_resource', payload);
  }

  async acceptReticulumResourceDetailed(payload: {
    peerPresenceHash: string;
    reticulumIdentityPublicKeyBase64: string;
    authMessage: Record<string, unknown>;
    transferId: string;
    savePath: string;
    fileName: string;
    size: number;
    sha256?: string;
    resourceType?: string;
    metadata?: Record<string, unknown>;
    streamMode?: boolean;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('accept_reticulum_resource', payload);
  }

  async sendReticulumResourceDetailed(payload: {
    allowedRecipientAddress: string;
    transferId: string;
    filePath: string;
    fileName: string;
    size: number;
    sha256?: string;
    expiresAt?: number;
    resourceType?: string;
    metadata?: Record<string, unknown>;
    streamMode?: boolean;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_reticulum_resource', payload);
  }

  async authorizeReticulumResourceDetailed(payload: {
    linkId: string;
    transferId: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('authorize_reticulum_resource', payload);
  }

  async rejectReticulumResourceDetailed(payload: {
    linkId: string;
    transferId: string;
    reason: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('reject_reticulum_resource', payload);
  }

  async cancelReticulumResourceDetailed(payload: {
    transferId: string;
    peerPresenceHash?: string;
    reason?: string;
  }): Promise<ReticulumSendResult> {
    return this.sendDetailed('cancel_reticulum_resource', payload);
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
    return this.sendDetailed('fanout_call', {
      messages,
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
    return this.sendDetailed('fanout_group_call', {
      messages,
      excludePeerPresenceHashes,
    });
  }

  async sendReticulumChatDetailed(
    peerPresenceHash: string,
    message: Record<string, unknown>
  ): Promise<ReticulumSendResult> {
    return this.sendDetailed('send_reticulum_chat', {
      peerPresenceHash,
      message,
    });
  }

  async sendReticulumChatTargetsDetailed(
    peerPresenceHashes: string[],
    message: Record<string, unknown>
  ): Promise<ReticulumTargetedChatResult> {
    const peers = [
      ...new Set(
        peerPresenceHashes
          .map((peer) => peer.trim().toLowerCase())
          .filter(Boolean)
      ),
    ];
    if (peers.length === 0) {
      return { ok: false, reason: 'unknown-peer-presence-hash' };
    }
    try {
      await this.start();
    } catch (err) {
      return {
        ok: false,
        reason: 'bridge-exception',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.sendCommand('send_reticulum_chat_targets', {
        peerPresenceHashes: peers,
        message,
      });
      if (!resp.ok) {
        return {
          ok: false,
          reason: this.mapSendFailureReason(resp),
          ...(resp.error ? { error: resp.error } : {}),
        };
      }
      const deliveredPeerHashes = Array.isArray(
        resp.payload?.deliveredPeerHashes
      )
        ? resp.payload.deliveredPeerHashes
            .filter(
              (peer): peer is string => typeof peer === 'string' && !!peer
            )
            .map((peer) => peer.trim().toLowerCase())
        : [];
      const failures = Array.isArray(resp.payload?.failures)
        ? resp.payload.failures.flatMap((failure) => {
            if (!failure || typeof failure !== 'object') return [];
            const record = failure as Record<string, unknown>;
            const peerPresenceHash =
              typeof record.peerPresenceHash === 'string'
                ? record.peerPresenceHash.trim().toLowerCase()
                : '';
            if (!peerPresenceHash) return [];
            const code =
              typeof record.code === 'string'
                ? record.code
                : 'packet_send_false';
            const error =
              typeof record.error === 'string' ? record.error : undefined;
            const reason = this.mapSendFailureReason({
              type: 'resp',
              id: '',
              ok: false,
              payload: { code },
              ...(error ? { error } : {}),
            });
            return [
              {
                peerPresenceHash,
                reason,
                ...(error ? { error } : {}),
              },
            ];
          })
        : [];
      return { ok: true, deliveredPeerHashes, failures };
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        reason: messageText.includes('timed out')
          ? 'bridge-timeout'
          : 'bridge-exception',
        error: messageText,
      };
    }
  }

  async fanoutReticulumChatDetailed(
    messages: Record<string, unknown>[],
    excludePeerPresenceHashes: string[] = []
  ): Promise<ReticulumSendResult> {
    if (messages.length === 0) {
      return {
        ok: false,
        reason: 'wire-too-large',
        error: 'No Reticulum chat frames fit encrypted wire limit',
      };
    }
    return this.sendDetailed('fanout_reticulum_chat', {
      messages,
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

  /**
   * Queue call-control frames on the reliable RNS Channel attached to an
   * authenticated group-audio link. Unlike enqueueGroupAudio(), this path is
   * ordered, receipt-backed and never competes with the lossy Opus queue.
   */
  async sendGroupAudioLinkControlDetailed(opts: {
    roomId: string;
    payload: Buffer;
    signalType: string;
    signalId: string;
    callSessionId: string;
    peerPresenceHash?: string;
    linkId?: string;
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
    if (!Buffer.isBuffer(opts.payload) || opts.payload.length === 0) {
      return {
        ok: false,
        reason: 'send-command-failed',
        error: 'Missing control payload',
      };
    }
    return this.sendDetailed('send_group_audio_link_control', {
      roomId: opts.roomId,
      payload: opts.payload.toString('base64'),
      signalType: opts.signalType,
      signalId: opts.signalId,
      callSessionId: opts.callSessionId,
      ...(linkId ? { linkId } : {}),
      ...(peerPresenceHash ? { peerPresenceHash } : {}),
    });
  }

  async openGroupAudioLink(
    peerPresenceHash: string,
    opts?: { activeCall?: boolean }
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
        ...(opts?.activeCall === true ? { activeCall: true } : {}),
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

  async clearGroupAudioDiagnostics(
    roomId?: string
  ): Promise<ReticulumSendResult> {
    this.audioFrameQueues.clear();
    this.audioQueuedLinkOrder = [];
    this.audioQueuedFrames = 0;
    this.audioQueuedBytes = 0;
    this.lastAudioQueueSnapshot = {
      ...this.getAudioQueueSnapshot(),
      mediaRouteDiagnostics: [],
    };
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
      const resp = await this.sendCommand('clear_group_audio_diagnostics', {
        ...(roomId ? { roomId } : {}),
      });
      if (resp.ok) {
        loggerLog(
          `[ReticulumBridge] Cleared group audio diagnostics room=${roomId || '*'} cleared=${String(
            resp.payload?.clearedMediaRouteDiagnostics ?? '?'
          )}`
        );
        return { ok: true };
      }
      return {
        ok: false,
        reason: this.mapSendFailureReason(resp),
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

  async getGroupAudioDataPlaneSession(
    routes: ReticulumAudioDataPlaneRoute[]
  ): Promise<ReticulumAudioDataPlaneSessionResult> {
    try {
      await this.start();
    } catch (err) {
      return {
        ok: false,
        reason: 'bridge-exception',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const session = await this.sendCommand(
        'get_group_audio_data_plane_session',
        {}
      );
      if (!session.ok) {
        return {
          ok: false,
          reason: this.mapSendFailureReason(session),
          ...(session.error ? { error: session.error } : {}),
        };
      }
      const endpoint =
        typeof session.payload?.endpoint === 'string'
          ? session.payload.endpoint
          : '';
      const token =
        typeof session.payload?.token === 'string' ? session.payload.token : '';
      if (!endpoint || !token) {
        return {
          ok: false,
          reason: 'send-command-failed',
          error: 'Bridge data-plane response missing endpoint/token',
        };
      }
      const configured = await this.sendCommand(
        'configure_group_audio_data_plane_routes',
        { routes }
      );
      if (!configured.ok) {
        return {
          ok: false,
          reason: this.mapSendFailureReason(configured),
          ...(configured.error ? { error: configured.error } : {}),
        };
      }
      const routeCount =
        typeof configured.payload?.routeCount === 'number'
          ? configured.payload.routeCount
          : routes.length;
      loggerLog(
        `[ReticulumBridge] target=gcall-audio-data-plane stage=session-ready routes=${routeCount}`
      );
      return { ok: true, endpoint, token, version: 2, routeCount, routes };
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

  async configureGroupAudioForwarding(
    plans: ReticulumAudioForwardingPlan[],
    opts?: { startIfNeeded?: boolean }
  ): Promise<ReticulumSendResult> {
    if (this.state !== 'ready') {
      if (opts?.startIfNeeded === false) {
        return { ok: false, reason: 'bridge-not-ready' };
      }
      try {
        await this.start();
      } catch (err) {
        return {
          ok: false,
          reason: 'bridge-exception',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.sendCommand('configure_group_audio_forwarding', {
        plans,
      });
      if (!resp.ok) {
        return {
          ok: false,
          reason: this.mapSendFailureReason(resp),
          ...(resp.error ? { error: resp.error } : {}),
        };
      }
      return { ok: true };
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

  async configureLandStateForwarding(
    plans: ReticulumLandStateForwardingPlan[],
    sessions: ReticulumLandStateAuthSession[],
    revision: number,
    opts?: { startIfNeeded?: boolean }
  ): Promise<ReticulumSendResult> {
    if (this.state !== 'ready') {
      if (opts?.startIfNeeded === false) {
        return { ok: false, reason: 'bridge-not-ready' };
      }
      try {
        await this.start();
      } catch (err) {
        return {
          ok: false,
          reason: 'bridge-exception',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    if (this.state !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    try {
      const resp = await this.sendCommand('configure_land_state_forwarding', {
        plans,
        sessions,
        revision,
      });
      if (!resp.ok) {
        return {
          ok: false,
          reason: this.mapSendFailureReason(resp),
          ...(resp.error ? { error: resp.error } : {}),
        };
      }
      return { ok: true };
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
    data: Buffer,
    peerPresenceHash = '',
    peerDestinationHash = ''
  ): ReticulumEnqueueGroupAudioResult {
    return this.enqueueAudioFrame({
      routeKey: linkId,
      transport: 'link',
      linkId,
      roomId,
      peerPresenceHash: peerPresenceHash.trim().toLowerCase(),
      peerDestinationHash: peerDestinationHash.trim().toLowerCase(),
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
      | 'frameKind'
      | 'controlType'
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
    const { frameKind, controlType } = inspectReticulumAudioFrame(
      frameInput.data
    );
    const logPrefix = audioFrameLogPrefix(frameKind);
    const frameDetail = audioFrameLogDetail(frameKind, controlType);
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
      const managerFlushToBridgeMs = Math.max(
        0,
        bridgeEnqueuedAtMs - managerFlushAtMs
      );
      if (
        managerFlushToBridgeMs >= RETICULUM_AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS
      ) {
        this.logReticulumAudioTimingAnomaly(
          `${logPrefix}-manager-flush-to-bridge-enqueue-delay`,
          frameInput.routeKey,
          `route=${this.shortAudioRoute(frameInput.routeKey)} delay_ms=${managerFlushToBridgeMs} ${frameDetail}`
        );
      }
    }
    const previousBridgeEnqueueAtMs =
      this.audioLastBridgeEnqueueAtMsByRoute.get(frameInput.routeKey) ?? 0;
    if (previousBridgeEnqueueAtMs > 0) {
      const bridgeEnqueueGapMs = Math.max(
        0,
        bridgeEnqueuedAtMs - previousBridgeEnqueueAtMs
      );
      if (bridgeEnqueueGapMs >= RETICULUM_AUDIO_TIMING_GAP_LOG_THRESHOLD_MS) {
        this.logReticulumAudioTimingAnomaly(
          `${logPrefix}-bridge-enqueue-gap`,
          frameInput.routeKey,
          `route=${this.shortAudioRoute(frameInput.routeKey)} gap_ms=${bridgeEnqueueGapMs} ${frameDetail}`
        );
      }
    }
    this.audioLastBridgeEnqueueAtMsByRoute.set(
      frameInput.routeKey,
      bridgeEnqueuedAtMs
    );
    const frame: QueuedAudioFrame = {
      ...frameInput,
      data: Buffer.from(frameInput.data),
      queuedAtMs: queuedAtMs ?? bridgeEnqueuedAtMs,
      rendererSendAtMs,
      managerFlushAtMs,
      bridgeEnqueuedAtMs,
      sizeBytes: frameInput.data.length,
      frameKind,
      controlType,
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
      rnsRawInboundToLinkReceiveMsMax: num('rnsRawInboundToLinkReceiveMsMax'),
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
      rnsSharedFrameGapMsMax: num('rnsSharedFrameGapMsMax'),
      rnsSharedFrameGapOver80Count: num('rnsSharedFrameGapOver80Count'),
      rnsSharedFrameGapOver160Count: num('rnsSharedFrameGapOver160Count'),
      rnsSharedFrameGapOver320Count: num('rnsSharedFrameGapOver320Count'),
      rnsSharedFrameGapOver640Count: num('rnsSharedFrameGapOver640Count'),
      rnsSharedFrameGapOver1000Count: num('rnsSharedFrameGapOver1000Count'),
      rnsSharedFrameToTransportInboundMsMax: num(
        'rnsSharedFrameToTransportInboundMsMax'
      ),
      rnsSharedFrameToTransportInboundOver80Count: num(
        'rnsSharedFrameToTransportInboundOver80Count'
      ),
      rnsSharedFrameToTransportInboundOver160Count: num(
        'rnsSharedFrameToTransportInboundOver160Count'
      ),
      rnsSharedFrameToTransportInboundOver320Count: num(
        'rnsSharedFrameToTransportInboundOver320Count'
      ),
      rnsSharedFrameToTransportInboundOver640Count: num(
        'rnsSharedFrameToTransportInboundOver640Count'
      ),
      rnsSharedFrameToTransportInboundOver1000Count: num(
        'rnsSharedFrameToTransportInboundOver1000Count'
      ),
      rnsSharedFrameInterfaceLast: str('rnsSharedFrameInterfaceLast'),
      rnsSharedFrameInterfaceWorst: str('rnsSharedFrameInterfaceWorst'),
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

  async publish(
    envelope: PresenceEnvelope,
    options: ReticulumPresencePublishOptions = {}
  ): Promise<boolean> {
    await this.start();
    if (this.state !== 'ready') return false;

    if (!options.force && envelope.type === 'PRESENCE_HEARTBEAT') {
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
    } else if (!options.force) {
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
      `[ReticulumBridge] Publishing ${envelope.type} for ${(envelope.payload as { address?: string }).address ?? 'unknown'}${options.force ? ` force=yes reason=${options.reason ?? 'unspecified'}` : ''}`
    );
    this.lastPresencePublishAt = Date.now();
    const resp = await this.sendCommand('publish_presence', {
      envelope,
    });
    if (!resp.ok && this.isBridgeCommandBacklogResponse(resp)) {
      throw new Error(
        resp.error ?? 'Reticulum bridge command backlog: publish_presence'
      );
    }
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
      `[ReticulumBridge] target=presence-reticulum tx=${resp.ok ? 'publish_ok' : 'publish_fail'} type=${envelope.type} peer_addr=${pubAddr} envelope_id=${envelope.id ?? 'n/a'} env_ts=${typeof envelope.timestamp === 'number' ? envelope.timestamp : 'n/a'} fanout_peers=${fanoutPeers ?? 'n/a'} fanout_hashes=${fanoutHashes ?? 'n/a'} local_presence_hash=${fanoutLocal ?? this.localPresenceDestinationHash ?? 'n/a'}${options.force ? ` force=yes reason=${options.reason ?? 'unspecified'}` : ''}${resp.ok ? '' : ` err=${resp.error ?? 'unknown'}`}`
    );
    if (typeof fanoutPeers === 'number') {
      this.lastPresenceFanoutPeers = fanoutPeers;
    }
    if (resp.ok) {
      this.lastPresencePublishOkAt = Date.now();
    }
    return resp.ok;
  }

  async clearPresenceCache(reason: string): Promise<boolean> {
    await this.start();
    if (this.state !== 'ready') return false;
    const resp = await this.sendCommand('clear_presence_cache', { reason });
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
    activeNeighborHashes: string[],
    accountEndpointLeases: ReticulumOverlayAccountEndpointLease[] = []
  ): Promise<boolean> {
    await this.start();
    if (this.state !== 'ready') return false;
    const resp = await this.sendCommand('overlay_sync_state', {
      verifiedPeers,
      activeNeighborHashes,
      accountEndpointLeases,
    });
    if (!resp.ok && this.isBridgeCommandBacklogResponse(resp)) {
      throw new Error(
        resp.error ?? 'Reticulum bridge command backlog: overlay_sync_state'
      );
    }
    return resp.ok;
  }

  async configureReticulumChatPinnedPeers(
    peers: Array<{
      accountAddress: string;
      destinationHash: string;
      expiresAt: number;
    }>
  ): Promise<boolean> {
    await this.start();
    if (this.state !== 'ready') return false;
    const resp = await this.sendCommand(
      'configure_reticulum_chat_pinned_peers',
      { peers }
    );
    if (!resp.ok && this.isBridgeCommandBacklogResponse(resp)) {
      throw new Error(
        resp.error ??
          'Reticulum bridge command backlog: configure_reticulum_chat_pinned_peers'
      );
    }
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
    const directionCounts = this.getOverlayLinkDirectionCounts();
    const receivingPeerCount = this.getReceivingOverlayPeerCount();
    const now = Date.now();
    if (receivingPeerCount >= P2P_HEALTH_MIN_RECEIVING_PEERS) {
      this.overlayReceivingHealthySince ??= now;
    } else {
      this.overlayReceivingHealthySince = null;
    }
    return {
      ...this.connectivitySnapshot,
      bridgeState: this.state,
      overlayLinksConnected: this.getEstablishedOverlayPeerCount(),
      overlayLinksOutboundConnected: directionCounts.outbound,
      overlayLinksInboundConnected: directionCounts.inbound,
      overlayLinksReceivingConnected: receivingPeerCount,
      overlayLinksReceivingStableMs:
        this.overlayReceivingHealthySince === null
          ? 0
          : Math.max(0, now - this.overlayReceivingHealthySince),
      ...(this.lastDegradedReason ? { reason: this.lastDegradedReason } : {}),
    };
  }

  getPresenceHealthSnapshot(): ReticulumPresenceHealthSnapshot {
    const cutoff = Date.now() - 5 * 60_000;
    this.recentOverlayLinkTimeouts = this.recentOverlayLinkTimeouts.filter(
      (at) => at >= cutoff
    );
    return {
      bridgeState: this.state,
      lastPresencePublishAt: this.lastPresencePublishAt,
      lastPresencePublishOkAt: this.lastPresencePublishOkAt,
      lastPresenceFanoutPeers: this.lastPresenceFanoutPeers,
      lastInboundPresenceAt: this.lastInboundPresenceAt,
      lastOverlayLinkClosedAt: this.lastOverlayLinkClosedAt,
      recentOverlayLinkTimeouts: this.recentOverlayLinkTimeouts.length,
    };
  }

  private isOverlaySnapshotRecentlyLive(
    snap: ReticulumOverlayLinkSnapshot,
    now = Date.now()
  ): boolean {
    const lastActivityAt = snap.lastActivityAt || snap.lastRxAt;
    if (!lastActivityAt) return false;
    return now - lastActivityAt <= OVERLAY_LINK_RX_IDLE_TIMEOUT_MS;
  }

  private isOverlaySnapshotUsable(
    snap: ReticulumOverlayLinkSnapshot,
    now = Date.now()
  ): boolean {
    return snap.incoming ? this.isOverlaySnapshotRecentlyLive(snap, now) : true;
  }

  private isOverlaySnapshotReceiving(
    snap: ReticulumOverlayLinkSnapshot,
    now = Date.now()
  ): boolean {
    return Boolean(
      snap.lastRxAt && now - snap.lastRxAt <= P2P_HEALTH_RECEIVE_WINDOW_MS
    );
  }

  private isOverlaySnapshotRxLive(
    snap: ReticulumOverlayLinkSnapshot,
    now = Date.now()
  ): boolean {
    return Boolean(
      snap.lastRxAt && now - snap.lastRxAt <= OVERLAY_LINK_RX_IDLE_TIMEOUT_MS
    );
  }

  /** Unique live overlay peers (by presence hash); links without hash yet count separately. */
  private getEstablishedOverlayPeerCount(): number {
    this.pruneStaleOverlayLinkSnapshots();
    const now = Date.now();
    const byPeer = new Set<string>();
    let noHash = 0;
    for (const snap of this.overlayLinkSnapshots.values()) {
      if (!this.isOverlaySnapshotRecentlyLive(snap, now)) continue;
      const k = snap.peerPresenceHash.trim().toLowerCase();
      if (k) byPeer.add(k);
      else noHash += 1;
    }
    return byPeer.size + noHash;
  }

  getOverlayLinkDirectionCounts(): { outbound: number; inbound: number } {
    this.pruneStaleOverlayLinkSnapshots();
    const now = Date.now();
    const localHash = this.localPresenceDestinationHash?.trim().toLowerCase();
    const outbound = new Set<string>();
    const inbound = new Set<string>();
    for (const snap of this.overlayLinkSnapshots.values()) {
      if (!this.isOverlaySnapshotRxLive(snap, now)) continue;
      const k = snap.peerPresenceHash.trim().toLowerCase();
      if (!k) continue;
      if (localHash && k === localHash) continue;
      if (snap.incoming) inbound.add(k);
      else outbound.add(k);
    }
    return { outbound: outbound.size, inbound: inbound.size };
  }

  private getReceivingOverlayPeerCount(now = Date.now()): number {
    this.pruneStaleOverlayLinkSnapshots(now);
    const localHash = this.localPresenceDestinationHash?.trim().toLowerCase();
    const receiving = new Set<string>();
    for (const snap of this.overlayLinkSnapshots.values()) {
      if (!this.isOverlaySnapshotReceiving(snap, now)) continue;
      const peerKey = snap.peerPresenceHash.trim().toLowerCase();
      if (!peerKey) continue;
      if (localHash && peerKey === localHash) continue;
      receiving.add(peerKey);
    }
    return receiving.size;
  }

  getOverlayLinkSnapshots(): ReticulumOverlayLinkSnapshot[] {
    this.pruneStaleOverlayLinkSnapshots();
    const now = Date.now();
    const byPeer = new Map<string, ReticulumOverlayLinkSnapshot>();
    const noHash: ReticulumOverlayLinkSnapshot[] = [];
    for (const snap of this.overlayLinkSnapshots.values()) {
      if (!this.isOverlaySnapshotUsable(snap, now)) continue;
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

  private ensureOverlayStalePruneTimer(): void {
    if (this.overlayStalePruneTimer) return;
    this.overlayStalePruneTimer = setInterval(() => {
      this.pruneStaleOverlayLinkSnapshots();
    }, OVERLAY_LINK_STALE_PRUNE_INTERVAL_MS);
    this.overlayStalePruneTimer.unref?.();
  }

  private clearOverlayStalePruneTimer(): void {
    if (!this.overlayStalePruneTimer) return;
    clearInterval(this.overlayStalePruneTimer);
    this.overlayStalePruneTimer = null;
  }

  private pruneStaleOverlayLinkSnapshots(now = Date.now()): boolean {
    let pruned = false;
    for (const [linkId, snap] of this.overlayLinkSnapshots.entries()) {
      const lastActivityAt =
        snap.lastActivityAt || snap.lastRxAt || snap.connectedAt || 0;
      if (now - lastActivityAt <= OVERLAY_LINK_RX_IDLE_TIMEOUT_MS) continue;
      pruned = true;
      this.overlayEstablishedLinkIds.delete(linkId);
      this.overlayLinkSnapshots.delete(linkId);
      loggerLog(
        `[ReticulumBridge] overlay-link pruned stale snapshot link_id=${linkId} peer=${snap.peerPresenceHash || 'unknown'} idleMs=${now - lastActivityAt}`
      );
      this.emit('overlay-link-state', {
        linkId,
        peerPresenceHash: snap.peerPresenceHash,
        incoming: snap.incoming,
        established: false,
        reason: 'rx_idle_timeout',
        queuedPackets: 0,
        closedByReticulum: false,
      });
    }
    return pruned;
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

  async ensurePeerIdentityKnown(peerPresenceHash: string): Promise<boolean> {
    const peer = peerPresenceHash.trim().toLowerCase();
    if (!peer) return false;
    try {
      await this.start();
    } catch {
      return false;
    }
    if (this.state !== 'ready') return false;
    try {
      const resp = await this.sendCommand('ensure_peer_identity', {
        peerPresenceHash: peer,
      });
      return resp.ok === true;
    } catch {
      return false;
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
    this.resetStdoutState();
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
    this.gameTransportToken = randomBytes(32).toString('hex');
    this.gameTransportInstanceId = randomUUID();
    this.gameTransportUrl = null;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...getReticulumSourceEnvExtra(),
      ...(launch.envExtra ?? {}),
      PYTHONUNBUFFERED: '1',
      QORTAL_RNS_LINK_TRACE: process.env.QORTAL_RNS_LINK_TRACE ?? '0',
      QORTAL_RETICULUM_CONFIG_DIR: configDir,
      // rnsd owns configDir/logfile. Each simultaneously supported app
      // instance gets a separate bridge log so independent Python processes
      // can never race while rotating the same file.
      QORTAL_RNS_LOG_FILE: path.join(
        configDir,
        `logfile.bridge.${getReticulumInstanceIndex()}`
      ),
      // The bridge is detached on Unix so Electron can terminate its whole
      // process group. Give it an explicit owner as well: if Electron is
      // killed before its normal shutdown handler runs, the bridge must not
      // survive as an orphan and keep loading the shared rnsd instance.
      QORTAL_RETICULUM_OWNER_PID: String(process.pid),
      QORTAL_RETICULUM_IDENTITY_PATH: identityPath,
      QORTAL_LAND_GAMES_TOKEN: this.gameTransportToken,
      QORTAL_LAND_GAMES_INSTANCE_ID: this.gameTransportInstanceId,
      QORTAL_LAND_GAMES_DEV: app.isPackaged ? '0' : '1',
      QORTAL_LAND_REALTIME_TOKEN: this.gameTransportToken,
      QORTAL_LAND_REALTIME_INSTANCE_ID: this.gameTransportInstanceId,
      QORTAL_LAND_REALTIME_DEV: app.isPackaged ? '0' : '1',
    };
    loggerLog(
      `[ReticulumBridge] Launch env QORTAL_RNS_LINK_TRACE=${env.QORTAL_RNS_LINK_TRACE} QORTAL_RNS_LOCAL_TRACE=${env.QORTAL_RNS_LOCAL_TRACE ?? '0'} QORTAL_RNS_LOCAL_TRACE_FRAMES=${env.QORTAL_RNS_LOCAL_TRACE_FRAMES ?? '0'} PYTHONPATH=${env.PYTHONPATH ?? ''}`
    );

    const child = spawn(launch.cmd, launch.args, {
      cwd: launch.cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child = child;
    loggerLog(
      `[ReticulumBridge] Spawned child pid=${child.pid ?? 'unknown'} owner_pid=${process.pid} cmd=${launch.cmd}`
    );
    const audioOutParent = child.stdio[3];
    this.attachChildWritablePipeErrorGuards(child);
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
      runMainPressureTask(
        'reticulum.stdout.enqueue',
        { bytes: Buffer.byteLength(chunk, 'utf8') },
        () => this.enqueueStdoutChunk(chunk)
      );
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
          runMainPressureTask(
            'reticulum.fd4.audio',
            {
              bytes: Buffer.isBuffer(chunk)
                ? chunk.length
                : Buffer.byteLength(chunk as string, 'binary'),
            },
            () => {
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
        }
      );
    } else {
      loggerWarn(
        `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} fd4=parent-read-missing inbound-binary-audio-disabled`
      );
    }
    child.stderr.on('data', (chunk: string) => {
      if (this.child !== child) return;
      runMainPressureTask(
        'reticulum.stderr',
        { bytes: Buffer.byteLength(chunk, 'utf8') },
        () => {
          const text = chunk.trim();
          if (!text) return;
          const message = `[ReticulumBridge/stderr] ${text}`;
          loggerLog(message);
        }
      );
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

  private resetStdoutState(): void {
    this.stdoutBuffer = '';
    this.stdoutChunkQueue = [];
    this.stdoutQueuedBytes = 0;
    this.stdoutDrainScheduled = false;
    this.stdoutPaused = false;
    this.stdoutPressureLogLastAt = 0;
    this.stdoutSlowFrameLogLastByKey.clear();
    this.stdoutSlowEmitLogLastByEvent.clear();
  }

  /**
   * Child stdio pipes emit their own asynchronous `error` events. In
   * particular, Windows reports a write racing bridge shutdown as EPIPE on the
   * pipe Socket rather than on ChildProcess. Leaving either writable pipe
   * without an error listener turns that normal shutdown race into an
   * uncaught main-process error dialog.
   */
  private attachChildWritablePipeErrorGuards(child: ChildProcess): void {
    const attach = (
      stream: NodeJS.WritableStream | NodeJS.ReadableStream | null | undefined,
      pipe: 'control' | 'audio'
    ) => {
      if (!stream || typeof stream.on !== 'function') return;
      stream.on('error', (error: Error) => {
        this.handleChildWritablePipeError(child, pipe, error);
      });
    };
    attach(child.stdin, 'control');
    attach(child.stdio?.[3], 'audio');
  }

  private handleChildWritablePipeError(
    child: ChildProcess,
    pipe: 'control' | 'audio',
    error: Error
  ): void {
    // prepareStop() detaches this child before terminating it. Any late EPIPE
    // from that child is therefore expected and must not affect a replacement
    // bridge (or escape as an unhandled stream error).
    if (
      this.child !== child ||
      !this.desiredRunning ||
      this.state === 'stopped'
    ) {
      return;
    }
    const code = (error as NodeJS.ErrnoException).code;
    const reason = `bridge-${pipe}-pipe-error:${code || error.message || 'unknown'}`;
    loggerWarn(`[ReticulumBridge] ${reason}`);
    this.transitionToDegraded(reason);
    if (typeof child.pid === 'number') {
      signalBridgeProcessTree(child.pid, 'SIGTERM');
    } else if (!child.killed) {
      child.kill();
    }
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
      const child = this.child;
      let ok: boolean;
      try {
        ok = child.stdin.write(frame.wire);
      } catch (error) {
        this.handleChildWritablePipeError(
          child,
          'control',
          error instanceof Error ? error : new Error(String(error))
        );
        return;
      }
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

  private isBridgeCommandBacklogResponse(frame: BridgeRespFrame): boolean {
    const code = frame.payload?.code;
    return (
      code === 'bridge_command_queue_full' || code === 'scheduler_queue_full'
    );
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

  private shortAudioRoute(routeKey: string): string {
    return routeKey.length > 16 ? routeKey.slice(0, 16) : routeKey;
  }

  private logReticulumAudioTimingAnomaly(
    stage: string,
    routeKey: string,
    detail: string
  ): void {
    const key = `${stage}:${routeKey}`;
    const nowMs = Date.now();
    const lastMs = this.audioTimingLogLastByKey.get(key) ?? 0;
    if (nowMs - lastMs < RETICULUM_AUDIO_TIMING_LOG_THROTTLE_MS) return;
    this.audioTimingLogLastByKey.set(key, nowMs);
    loggerLog(
      `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} stage=${stage} ${detail}`
    );
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
          frameKind: next.frameKind,
          controlType: next.controlType,
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
        const queuedAtMs = Date.now();
        for (const frame of batchTiming) {
          const enqueueToPackMs = Math.max(
            0,
            queuedAtMs - frame.bridgeEnqueuedAtMs
          );
          if (
            enqueueToPackMs >= RETICULUM_AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS
          ) {
            const logPrefix = audioFrameLogPrefix(frame.frameKind);
            this.logReticulumAudioTimingAnomaly(
              `${logPrefix}-bridge-enqueue-to-binary-pack-delay`,
              frame.routeKey,
              `route=${this.shortAudioRoute(frame.routeKey)} delay_ms=${enqueueToPackMs} ${audioFrameLogDetail(frame.frameKind, frame.controlType)}`
            );
          }
        }
        this.audioBinaryWriteQueue.push({
          buf,
          queuedAtMs,
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
        const binaryQueueDwellMs = Math.max(0, nowMs - item.queuedAtMs);
        if (
          binaryQueueDwellMs >= RETICULUM_AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS
        ) {
          const routeKey = item.frames[0]?.routeKey ?? 'unknown';
          const itemFrameKinds = new Set(item.frames.map((f) => f.frameKind));
          const itemFrameKind =
            itemFrameKinds.size === 1
              ? (item.frames[0]?.frameKind ?? 'media')
              : 'media';
          const itemLogPrefix =
            itemFrameKinds.size === 1
              ? audioFrameLogPrefix(itemFrameKind)
              : 'gcall-mixed';
          this.logReticulumAudioTimingAnomaly(
            `${itemLogPrefix}-binary-queue-to-fd3-write-delay`,
            routeKey,
            `route=${this.shortAudioRoute(routeKey)} delay_ms=${binaryQueueDwellMs} frames=${item.frames.length} frame_kind=${itemFrameKinds.size === 1 ? itemFrameKind : 'mixed'}`
          );
        }
        this.lastAudioQueueSnapshot.bridgeEnqueueToFd3WriteQueueDwellMsMax =
          Math.max(
            this.lastAudioQueueSnapshot.bridgeEnqueueToFd3WriteQueueDwellMsMax,
            Math.max(0, nowMs - item.queuedAtMs)
          );
        for (const frame of item.frames) {
          const previousWriteAtMs =
            this.audioLastFd3WriteAtMsByRoute.get(frame.routeKey) ?? 0;
          if (previousWriteAtMs > 0) {
            const writeGapMs = Math.max(0, nowMs - previousWriteAtMs);
            if (writeGapMs >= RETICULUM_AUDIO_TIMING_GAP_LOG_THRESHOLD_MS) {
              const logPrefix = audioFrameLogPrefix(frame.frameKind);
              this.logReticulumAudioTimingAnomaly(
                `${logPrefix}-fd3-write-gap`,
                frame.routeKey,
                `route=${this.shortAudioRoute(frame.routeKey)} gap_ms=${writeGapMs} ${audioFrameLogDetail(frame.frameKind, frame.controlType)}`
              );
            }
          }
          this.audioLastFd3WriteAtMsByRoute.set(frame.routeKey, nowMs);
          const bridgeToFd3Ms = Math.max(0, nowMs - frame.bridgeEnqueuedAtMs);
          if (bridgeToFd3Ms >= RETICULUM_AUDIO_TIMING_DELAY_LOG_THRESHOLD_MS) {
            const logPrefix = audioFrameLogPrefix(frame.frameKind);
            this.logReticulumAudioTimingAnomaly(
              `${logPrefix}-bridge-enqueue-to-fd3-write-delay`,
              frame.routeKey,
              `route=${this.shortAudioRoute(frame.routeKey)} delay_ms=${bridgeToFd3Ms} ${audioFrameLogDetail(frame.frameKind, frame.controlType)}`
            );
          }
          this.lastAudioQueueSnapshot.bridgeEnqueueToFd3WriteMsMax = Math.max(
            this.lastAudioQueueSnapshot.bridgeEnqueueToFd3WriteMsMax,
            bridgeToFd3Ms
          );
          if (frame.rendererSendAtMs) {
            this.lastAudioQueueSnapshot.rendererToFd3WriteMsMax = Math.max(
              this.lastAudioQueueSnapshot.rendererToFd3WriteMsMax,
              Math.max(0, nowMs - frame.rendererSendAtMs)
            );
          }
        }
      };
      let ok: boolean;
      try {
        ok = stream.write(item.buf);
      } catch (error) {
        this.handleChildWritablePipeError(
          c,
          'audio',
          error instanceof Error ? error : new Error(String(error))
        );
        return;
      }
      if (!ok) {
        this.waitingForAudioBinaryDrain = true;
        stream.once('drain', () => {
          if (this.child !== c) return;
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

  private noteFd4AudioPathPressure(
    frame: ReticulumAudioFrame,
    routeKey: string
  ): void {
    const nowMs = Date.now();
    const key = `${frame.roomId || 'n/a'}:${routeKey}`;
    let stats = this.audioPathPressureByRoute.get(key);
    if (!stats) {
      stats = {
        windowStartedAtMs: nowMs,
        frames: 0,
        bytes: 0,
        fd4DecodeGapMsMax: 0,
        pythonToElectronMsMax: 0,
        lastDecodedAtMs: 0,
      };
      this.audioPathPressureByRoute.set(key, stats);
    }
    if (stats.lastDecodedAtMs > 0) {
      stats.fd4DecodeGapMsMax = Math.max(
        stats.fd4DecodeGapMsMax,
        nowMs - stats.lastDecodedAtMs
      );
    }
    stats.lastDecodedAtMs = nowMs;
    stats.frames += 1;
    stats.bytes += frame.payload?.length ?? 0;
    if (frame.receivedAtWallMs && frame.receivedAtWallMs > 0) {
      stats.pythonToElectronMsMax = Math.max(
        stats.pythonToElectronMsMax,
        Math.max(0, nowMs - frame.receivedAtWallMs)
      );
    }

    const elapsedMs = nowMs - stats.windowStartedAtMs;
    if (
      elapsedMs < RETICULUM_AUDIO_PATH_PRESSURE_LOG_INTERVAL_MS ||
      stats.frames <= 0
    ) {
      return;
    }
    loggerLog(
      `[ReticulumBridge] ${RETICULUM_AUDIO_IPC_LOG} audio_path_pressure side=electron_fd4 window_ms=${elapsedMs} room=${frame.roomId || 'n/a'} transport=${frame.linkId ? 'link' : 'packet'} route=${routeKey.slice(0, 16)} link=${frame.linkId ? frame.linkId.slice(0, 16) : 'n/a'} peer=${(frame.peerPresenceHash || '').slice(0, 16) || 'n/a'} dest=${(frame.peerDestinationHash || '').slice(0, 16) || 'n/a'} packets=${stats.frames} bytes=${stats.bytes} fd4_decode_gap_ms=${stats.fd4DecodeGapMsMax} python_to_electron_ms=${stats.pythonToElectronMsMax}`
    );
    stats.windowStartedAtMs = nowMs;
    stats.frames = 0;
    stats.bytes = 0;
    stats.fd4DecodeGapMsMax = 0;
    stats.pythonToElectronMsMax = 0;
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
          this.noteFd4AudioPathPressure(f, routeKey);
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

  private enqueueStdoutChunk(chunk: string): void {
    if (!chunk) return;
    this.stdoutChunkQueue.push(chunk);
    this.stdoutQueuedBytes += Buffer.byteLength(chunk, 'utf8');
    this.maybePauseStdoutForPressure();
    this.scheduleStdoutDrain();
  }

  private scheduleStdoutDrain(): void {
    if (this.stdoutDrainScheduled) return;
    this.stdoutDrainScheduled = true;
    setImmediate(() => {
      this.stdoutDrainScheduled = false;
      if (!this.child) return;
      runMainPressureTask(
        'reticulum.stdout.drain',
        {
          queuedBytes: this.getStdoutBacklogBytes(),
          queuedChunks: this.stdoutChunkQueue.length,
        },
        () => this.drainStdoutBudget()
      );
      this.maybeResumeStdoutAfterDrain();
      if (this.hasStdoutWorkReady()) {
        this.scheduleStdoutDrain();
      }
    });
  }

  private getStdoutBacklogBytes(): number {
    return (
      this.stdoutQueuedBytes + Buffer.byteLength(this.stdoutBuffer, 'utf8')
    );
  }

  private hasStdoutWorkReady(): boolean {
    return this.stdoutBuffer.includes('\n') || this.stdoutChunkQueue.length > 0;
  }

  private maybePauseStdoutForPressure(): void {
    const child = this.child;
    const stdout = child?.stdout;
    if (
      this.stdoutPaused ||
      !stdout ||
      this.getStdoutBacklogBytes() < RETICULUM_STDOUT_PAUSE_BYTES
    ) {
      return;
    }
    stdout.pause();
    this.stdoutPaused = true;
    this.logStdoutPressure('pause');
  }

  private maybeResumeStdoutAfterDrain(): void {
    const child = this.child;
    const stdout = child?.stdout;
    if (
      !this.stdoutPaused ||
      !stdout ||
      this.getStdoutBacklogBytes() > RETICULUM_STDOUT_RESUME_BYTES
    ) {
      return;
    }
    stdout.resume();
    this.stdoutPaused = false;
    this.logStdoutPressure('resume');
  }

  private logStdoutPressure(stage: 'pause' | 'resume'): void {
    const now = Date.now();
    if (stage === 'pause' && now - this.stdoutPressureLogLastAt < 2_000) {
      return;
    }
    this.stdoutPressureLogLastAt = now;
    loggerWarn(
      `[ReticulumBridge] target=presence-reticulum stage=stdout-${stage} backlog_bytes=${this.getStdoutBacklogBytes()} queued_chunks=${this.stdoutChunkQueue.length} buffered_bytes=${Buffer.byteLength(
        this.stdoutBuffer,
        'utf8'
      )}`
    );
  }

  private pullStdoutChunksUntilLineOrEmpty(): void {
    while (
      !this.stdoutBuffer.includes('\n') &&
      this.stdoutChunkQueue.length > 0
    ) {
      const next = this.stdoutChunkQueue.shift() ?? '';
      this.stdoutQueuedBytes = Math.max(
        0,
        this.stdoutQueuedBytes - Buffer.byteLength(next, 'utf8')
      );
      this.stdoutBuffer += next;
    }
  }

  private drainStdoutBudget(): void {
    const startedAtMs = Date.now();
    let processedLines = 0;
    for (;;) {
      this.pullStdoutChunksUntilLineOrEmpty();
      const nlIndex = this.stdoutBuffer.indexOf('\n');
      if (nlIndex === -1) return;
      const line = this.stdoutBuffer.slice(0, nlIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nlIndex + 1);
      processedLines += 1;
      if (!line) {
        if (
          processedLines >= RETICULUM_STDOUT_DRAIN_MAX_LINES ||
          Date.now() - startedAtMs >= RETICULUM_STDOUT_DRAIN_MAX_MS
        ) {
          return;
        }
        continue;
      }

      let frame: BridgeRespFrame | BridgeEventFrame;
      try {
        frame = JSON.parse(line) as BridgeRespFrame | BridgeEventFrame;
      } catch (err) {
        loggerError('[ReticulumBridge] Invalid JSON frame:', err);
        loggerError(`[ReticulumBridge] Invalid line: ${line}`);
        if (
          processedLines >= RETICULUM_STDOUT_DRAIN_MAX_LINES ||
          Date.now() - startedAtMs >= RETICULUM_STDOUT_DRAIN_MAX_MS
        ) {
          return;
        }
        continue;
      }
      this.handleFrame(frame);
      if (
        processedLines >= RETICULUM_STDOUT_DRAIN_MAX_LINES ||
        Date.now() - startedAtMs >= RETICULUM_STDOUT_DRAIN_MAX_MS
      ) {
        return;
      }
    }
  }

  private handleFrame(frame: BridgeRespFrame | BridgeEventFrame): void {
    const startedAtMs = Date.now();
    const frameKey = this.describeStdoutFrame(frame);
    try {
      this.handleFrameInner(frame);
    } finally {
      const durationMs = Date.now() - startedAtMs;
      if (durationMs >= RETICULUM_STDOUT_FRAME_SLOW_MS) {
        this.logSlowStdoutFrame(frameKey, durationMs);
      }
    }
  }

  private handleFrameInner(frame: BridgeRespFrame | BridgeEventFrame): void {
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

    this.logBridgeEventTimingIfSlow(frame);

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
        this.emitBridgeFrameEvent('ready');
        return;
      case 'qortalland_game_ws_ready': {
        const port = Number(frame.payload?.port);
        const instanceId = String(frame.payload?.instanceId ?? '');
        if (
          Number.isInteger(port) &&
          port > 0 &&
          port <= 65535 &&
          instanceId === this.gameTransportInstanceId
        ) {
          this.gameTransportUrl = `ws://127.0.0.1:${port}`;
          this.emitBridgeFrameEvent('qortalland-game-transport-restarted');
        }
        return;
      }
      case 'presence_message': {
        const envelope = frame.payload?.envelope;
        const route = toPresenceRoute(frame.payload?.route);
        if (!envelope || !route || route.kind !== 'reticulum') return;
        this.lastInboundPresenceAt = Date.now();
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
        this.emitBridgeFrameEvent('presence-envelope', envelope, route);
        return;
      }
      case 'candidate_peer_discovered': {
        const peerHash = frame.payload?.peerHash;
        if (typeof peerHash !== 'string' || !peerHash) return;
        this.emitBridgeFrameEvent('candidate-peer-discovered', {
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
        this.emitBridgeFrameEvent(
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
        this.emitBridgeFrameEvent(
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
      case 'reticulum_chat_message': {
        const wire = frame.payload?.wire;
        const senderDestinationHash = frame.payload?.senderDestinationHash;
        const peerPresenceHash = frame.payload?.peerPresenceHash;
        if (!wire || typeof wire !== 'object') return;
        this.markOverlayPeerVerifiedFromQortalTraffic(
          typeof peerPresenceHash === 'string' ? peerPresenceHash : '',
          typeof senderDestinationHash === 'string'
            ? senderDestinationHash
            : '',
          'reticulum_chat'
        );
        this.emitBridgeFrameEvent(
          'reticulum-chat-message',
          wire as Record<string, unknown>,
          typeof senderDestinationHash === 'string'
            ? senderDestinationHash
            : '',
          typeof peerPresenceHash === 'string' ? peerPresenceHash : '',
          typeof frame.payload?.linkId === 'string' ? frame.payload.linkId : '',
          frame.payload?.landStateFastForwarded === true,
          typeof frame.payload?.landStateForwardingRevision === 'number'
            ? frame.payload.landStateForwardingRevision
            : -1
        );
        return;
      }
      case 'group_audio_link_established': {
        const linkId = frame.payload?.linkId;
        if (typeof linkId !== 'string' || !linkId) return;
        this.emitBridgeFrameEvent('group-audio-link-established', {
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
        this.emitBridgeFrameEvent('group-audio-link-closed', {
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
        this.emitBridgeFrameEvent('group-audio-send-failed', {
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
      case 'group_audio_fast_path_activity': {
        const roomId =
          typeof frame.payload?.roomId === 'string' ? frame.payload.roomId : '';
        const sourceAddress =
          typeof frame.payload?.sourceAddress === 'string'
            ? frame.payload.sourceAddress
            : '';
        if (!roomId || !sourceAddress) return;
        this.emitBridgeFrameEvent('group-audio-fast-path-activity', {
          roomId,
          sourceAddress,
          linkId:
            typeof frame.payload?.linkId === 'string'
              ? frame.payload.linkId
              : '',
          peerPresenceHash:
            typeof frame.payload?.peerPresenceHash === 'string'
              ? frame.payload.peerPresenceHash
              : '',
          peerDestinationHash:
            typeof frame.payload?.peerDestinationHash === 'string'
              ? frame.payload.peerDestinationHash
              : '',
          forwardedTargets:
            typeof frame.payload?.forwardedTargets === 'number'
              ? frame.payload.forwardedTargets
              : 0,
          receivedAtWallMs:
            typeof frame.payload?.receivedAtWallMs === 'number'
              ? frame.payload.receivedAtWallMs
              : Date.now(),
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
          rnsSharedFrameGapMsMax:
            typeof frame.payload?.rnsSharedFrameGapMsMax === 'number'
              ? frame.payload.rnsSharedFrameGapMsMax
              : this.lastAudioQueueSnapshot.rnsSharedFrameGapMsMax,
          rnsSharedFrameGapOver80Count:
            typeof frame.payload?.rnsSharedFrameGapOver80Count === 'number'
              ? frame.payload.rnsSharedFrameGapOver80Count
              : this.lastAudioQueueSnapshot.rnsSharedFrameGapOver80Count,
          rnsSharedFrameGapOver160Count:
            typeof frame.payload?.rnsSharedFrameGapOver160Count === 'number'
              ? frame.payload.rnsSharedFrameGapOver160Count
              : this.lastAudioQueueSnapshot.rnsSharedFrameGapOver160Count,
          rnsSharedFrameGapOver320Count:
            typeof frame.payload?.rnsSharedFrameGapOver320Count === 'number'
              ? frame.payload.rnsSharedFrameGapOver320Count
              : this.lastAudioQueueSnapshot.rnsSharedFrameGapOver320Count,
          rnsSharedFrameGapOver640Count:
            typeof frame.payload?.rnsSharedFrameGapOver640Count === 'number'
              ? frame.payload.rnsSharedFrameGapOver640Count
              : this.lastAudioQueueSnapshot.rnsSharedFrameGapOver640Count,
          rnsSharedFrameGapOver1000Count:
            typeof frame.payload?.rnsSharedFrameGapOver1000Count === 'number'
              ? frame.payload.rnsSharedFrameGapOver1000Count
              : this.lastAudioQueueSnapshot.rnsSharedFrameGapOver1000Count,
          rnsSharedFrameToTransportInboundMsMax:
            typeof frame.payload?.rnsSharedFrameToTransportInboundMsMax ===
            'number'
              ? frame.payload.rnsSharedFrameToTransportInboundMsMax
              : this.lastAudioQueueSnapshot
                  .rnsSharedFrameToTransportInboundMsMax,
          rnsSharedFrameToTransportInboundOver80Count:
            typeof frame.payload
              ?.rnsSharedFrameToTransportInboundOver80Count === 'number'
              ? frame.payload.rnsSharedFrameToTransportInboundOver80Count
              : this.lastAudioQueueSnapshot
                  .rnsSharedFrameToTransportInboundOver80Count,
          rnsSharedFrameToTransportInboundOver160Count:
            typeof frame.payload
              ?.rnsSharedFrameToTransportInboundOver160Count === 'number'
              ? frame.payload.rnsSharedFrameToTransportInboundOver160Count
              : this.lastAudioQueueSnapshot
                  .rnsSharedFrameToTransportInboundOver160Count,
          rnsSharedFrameToTransportInboundOver320Count:
            typeof frame.payload
              ?.rnsSharedFrameToTransportInboundOver320Count === 'number'
              ? frame.payload.rnsSharedFrameToTransportInboundOver320Count
              : this.lastAudioQueueSnapshot
                  .rnsSharedFrameToTransportInboundOver320Count,
          rnsSharedFrameToTransportInboundOver640Count:
            typeof frame.payload
              ?.rnsSharedFrameToTransportInboundOver640Count === 'number'
              ? frame.payload.rnsSharedFrameToTransportInboundOver640Count
              : this.lastAudioQueueSnapshot
                  .rnsSharedFrameToTransportInboundOver640Count,
          rnsSharedFrameToTransportInboundOver1000Count:
            typeof frame.payload
              ?.rnsSharedFrameToTransportInboundOver1000Count === 'number'
              ? frame.payload.rnsSharedFrameToTransportInboundOver1000Count
              : this.lastAudioQueueSnapshot
                  .rnsSharedFrameToTransportInboundOver1000Count,
          rnsSharedFrameToTransportInboundSamples:
            typeof frame.payload?.rnsSharedFrameToTransportInboundSamples ===
            'number'
              ? frame.payload.rnsSharedFrameToTransportInboundSamples
              : this.lastAudioQueueSnapshot
                  .rnsSharedFrameToTransportInboundSamples,
          rnsSharedFrameInterfaceLast:
            typeof frame.payload?.rnsSharedFrameInterfaceLast === 'string'
              ? frame.payload.rnsSharedFrameInterfaceLast
              : this.lastAudioQueueSnapshot.rnsSharedFrameInterfaceLast,
          rnsSharedFrameInterfaceWorst:
            typeof frame.payload?.rnsSharedFrameInterfaceWorst === 'string'
              ? frame.payload.rnsSharedFrameInterfaceWorst
              : this.lastAudioQueueSnapshot.rnsSharedFrameInterfaceWorst,
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
        const overlayTransportAdmitted =
          frame.payload?.overlayTransportAdmitted === true;
        if (shouldLogOverlayLinkStateEvent(reason)) {
          loggerLog(
            `[ReticulumBridge] overlay-link link_id=${linkId} peer=${peerPresenceHash || 'unknown'} incoming=${frame.payload?.incoming === true ? 'yes' : 'no'} established=${frame.payload?.established === true ? 'yes' : 'no'} admitted=${overlayTransportAdmitted ? 'yes' : 'no'} queued=${queuedPackets}${reason ? ` reason=${reason}` : ''}${overlayAgeDetail(frame.payload as Record<string, unknown> | undefined)}`
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
              : (existing?.lastRxAt ?? 0);
          const lastActivityAgeMs =
            typeof frame.payload?.lastActivityAgeMs === 'number' &&
            Number.isFinite(frame.payload.lastActivityAgeMs)
              ? frame.payload.lastActivityAgeMs
              : null;
          const lastActivityAt =
            lastActivityAgeMs !== null
              ? Date.now() - lastActivityAgeMs
              : (existing?.lastActivityAt ?? lastRxAt);
          this.overlayLinkSnapshots.set(linkId, {
            linkId,
            peerPresenceHash:
              peerPresenceHash || existing?.peerPresenceHash || '',
            incoming: frame.payload?.incoming === true,
            overlayTransportAdmitted:
              overlayTransportAdmitted ||
              existing?.overlayTransportAdmitted === true,
            connectedAt: existing?.connectedAt ?? Date.now(),
            lastRxAt,
            lastActivityAt,
          });
        } else {
          this.overlayEstablishedLinkIds.delete(linkId);
          this.overlayLinkSnapshots.delete(linkId);
          this.lastOverlayLinkClosedAt = Date.now();
          if (reason.toLowerCase().includes('timeout')) {
            const now = Date.now();
            this.recentOverlayLinkTimeouts.push(now);
            const cutoff = now - 5 * 60_000;
            this.recentOverlayLinkTimeouts =
              this.recentOverlayLinkTimeouts.filter((at) => at >= cutoff);
          }
        }
        if (
          frame.payload?.closedByReticulum === true &&
          peerPresenceHash &&
          !this.hasEstablishedOverlaySnapshotForPeer(peerPresenceHash)
        ) {
          this.emitBridgeFrameEvent('overlay-link-closed', {
            peerHash: peerPresenceHash,
            reason,
            lastActivityAgeMs:
              typeof frame.payload?.lastActivityAgeMs === 'number' &&
              Number.isFinite(frame.payload.lastActivityAgeMs)
                ? frame.payload.lastActivityAgeMs
                : null,
          });
        }
        this.emitBridgeFrameEvent('overlay-link-state', {
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
        const resourceType = String(frame.payload?.resourceType ?? '');
        if (resourceType.startsWith('reticulum_resource')) {
          this.emitBridgeFrameEvent('reticulum-resource', frame.payload ?? {});
          return;
        }
        if (resourceType.startsWith('reticulum_chat')) {
          this.emitBridgeFrameEvent(
            'reticulum-chat-resource',
            frame.payload ?? {}
          );
          return;
        }
        this.emitBridgeFrameEvent('qchat-file-transfer', frame.payload ?? {});
        return;
      }
      case 'reticulum_chat_resource': {
        this.emitBridgeFrameEvent(
          'reticulum-chat-resource',
          frame.payload ?? {}
        );
        return;
      }
      case 'reticulum_resource': {
        this.emitBridgeFrameEvent('reticulum-resource', frame.payload ?? {});
        return;
      }
      case 'reticulum_resource_session': {
        this.emitBridgeFrameEvent(
          'reticulum-resource-session',
          frame.payload ?? {}
        );
        return;
      }
      case 'error': {
        const payload = frame.payload;
        const message =
          payload?.message ??
          payload?.detail ??
          'Reticulum bridge reported an error';
        const context = [
          payload?.code ? `code=${payload.code}` : '',
          payload?.lane ? `lane=${payload.lane}` : '',
          payload?.task ? `task=${payload.task}` : '',
          payload?.action ? `action=${payload.action}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        const detail =
          payload?.detail && payload.detail !== message
            ? `\n${payload.detail}`
            : '';
        loggerError(
          `[ReticulumBridge] Python error event${context ? ` ${context}` : ''}: ${message}${detail}`
        );
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
        this.emitBridgeFrameEvent(
          'transport-state',
          this.getConnectivitySnapshot()
        );
        return;
      }
    }
  }

  getQortalLandGameTransportBootstrap(): {
    url: string;
    token: string;
    instanceId: string;
  } | null {
    if (
      !this.gameTransportUrl ||
      !this.gameTransportToken ||
      !this.gameTransportInstanceId ||
      this.state !== 'ready'
    ) {
      return null;
    }
    return {
      url: this.gameTransportUrl,
      token: this.gameTransportToken,
      instanceId: this.gameTransportInstanceId,
    };
  }

  private describeStdoutFrame(
    frame: BridgeRespFrame | BridgeEventFrame
  ): string {
    if (frame.type === 'resp') {
      const pending = this.pending.get(frame.id);
      return `resp:${pending?.action ?? 'unknown'}`;
    }
    const payload = frame.payload;
    const wire =
      payload && typeof payload === 'object'
        ? (payload as { wire?: unknown }).wire
        : undefined;
    const wireKey =
      wire && typeof wire === 'object' && !Array.isArray(wire)
        ? String(
            (wire as { k?: unknown; t?: unknown }).k ??
              (wire as { t?: unknown }).t ??
              ''
          )
        : '';
    return wireKey ? `event:${frame.event}:${wireKey}` : `event:${frame.event}`;
  }

  private logSlowStdoutFrame(frameKey: string, durationMs: number): void {
    const now = Date.now();
    const last = this.stdoutSlowFrameLogLastByKey.get(frameKey) ?? 0;
    if (now - last < 2_000) return;
    this.stdoutSlowFrameLogLastByKey.set(frameKey, now);
    loggerWarn(
      `[ReticulumBridge] target=presence-reticulum stage=stdout-frame-slow frame=${frameKey} duration_ms=${Math.round(
        durationMs
      )} backlog_bytes=${this.getStdoutBacklogBytes()}`
    );
  }

  private emitBridgeFrameEvent(eventName: string, ...args: unknown[]): boolean {
    const startedAtMs = Date.now();
    try {
      return super.emit(eventName, ...args);
    } finally {
      const durationMs = Date.now() - startedAtMs;
      if (durationMs >= RETICULUM_STDOUT_EMIT_SLOW_MS) {
        this.logSlowStdoutEmit(eventName, durationMs);
      }
    }
  }

  private logSlowStdoutEmit(eventName: string, durationMs: number): void {
    const now = Date.now();
    const last = this.stdoutSlowEmitLogLastByEvent.get(eventName) ?? 0;
    if (now - last < 2_000) return;
    this.stdoutSlowEmitLogLastByEvent.set(eventName, now);
    loggerWarn(
      `[ReticulumBridge] target=presence-reticulum stage=stdout-emit-slow event=${eventName} duration_ms=${Math.round(
        durationMs
      )} listeners=${this.listenerCount(eventName)}`
    );
  }

  private logBridgeEventTimingIfSlow(frame: BridgeEventFrame): void {
    const now = Date.now();
    const queuedAtMs = numericFrameField(frame, '_queuedAtMs');
    const writeAtMs = numericFrameField(frame, '_writeAtMs');
    const queuedAgeMs = queuedAtMs !== null ? now - queuedAtMs : 0;
    const stdoutAgeMs = writeAtMs !== null ? now - writeAtMs : 0;
    const pythonQueueMs =
      queuedAtMs !== null && writeAtMs !== null ? writeAtMs - queuedAtMs : 0;
    if (queuedAgeMs < 80 && stdoutAgeMs < 80 && pythonQueueMs < 80) {
      return;
    }
    const last = this.bridgeEventTimingLogLastByEvent.get(frame.event) ?? 0;
    if (now - last < 2_000) return;
    this.bridgeEventTimingLogLastByEvent.set(frame.event, now);
    if (this.bridgeEventTimingLogLastByEvent.size > 256) {
      for (const key of Array.from(
        this.bridgeEventTimingLogLastByEvent.keys()
      ).slice(0, 64)) {
        this.bridgeEventTimingLogLastByEvent.delete(key);
      }
    }
    const detail = bridgeEventTimingDetail(frame, now);
    loggerLog(
      `[ReticulumBridge] target=presence-reticulum event_delivery event=${frame.event}${detail ? ` ${detail}` : ''}`
    );
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
      | 'accept_reticulum_chat_resource'
      | 'send_reticulum_chat_resource'
      | 'authorize_reticulum_chat_resource'
      | 'reject_reticulum_chat_resource'
      | 'accept_reticulum_resource'
      | 'send_reticulum_resource'
      | 'authorize_reticulum_resource'
      | 'reject_reticulum_resource'
      | 'cancel_reticulum_resource'
      | 'fanout_call'
      | 'send_group_call'
      | 'fanout_group_call'
      | 'send_reticulum_chat'
      | 'fanout_reticulum_chat'
      | 'send_group_audio_link_control'
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
    if (
      code === 'bridge_overloaded' ||
      code === 'bridge_command_queue_full' ||
      code === 'scheduler_queue_full' ||
      code === 'resource_open_queue_full' ||
      code === 'resource_session_capacity' ||
      code === 'resource_session_queue_full'
    )
      return 'bridge-overloaded';
    if (code === 'bridge_not_started') return 'bridge-not-started';
    if (code === 'unknown_peer_presence_hash')
      return 'unknown-peer-presence-hash';
    if (code === 'wire_too_large') return 'wire-too-large';
    if (code === 'packet_send_false') return 'packet-send-false';
    if (
      code === 'no_route' ||
      code === 'no_established_route' ||
      code === 'resource_session_backoff'
    )
      return 'no-route';
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
let bridgeStopPromise: Promise<void> | null = null;

export function getReticulumBridge(): ReticulumBridge | null {
  return bridgeInstance;
}

export async function startReticulumBridge(): Promise<ReticulumBridge> {
  if (!isReticulumRuntimeEnabled()) {
    throw new Error('Reticulum is disabled');
  }
  if (bridgeStopPromise) {
    await bridgeStopPromise;
  }
  if (!isReticulumRuntimeEnabled()) {
    throw new Error('Reticulum is disabled');
  }
  const bridge = bridgeInstance ?? new ReticulumBridge();
  bridgeInstance = bridge;
  await bridge.start();
  if (!isReticulumRuntimeEnabled() || bridgeInstance !== bridge) {
    if (bridgeInstance === bridge) {
      bridgeInstance = null;
      await bridge.stopAndWait();
    }
    throw new Error('Reticulum bridge startup was superseded');
  }
  return bridge;
}

export function stopReticulumBridge(): void {
  bridgeInstance?.stop();
  bridgeInstance = null;
}

export async function stopReticulumBridgeAndWait(): Promise<void> {
  const bridge = bridgeInstance;
  if (!bridge) {
    await bridgeStopPromise;
    return;
  }
  bridgeInstance = null;
  const stopPromise = bridge.stopAndWait();
  const trackedStopPromise = stopPromise.finally(() => {
    if (bridgeStopPromise === trackedStopPromise) {
      bridgeStopPromise = null;
    }
  });
  bridgeStopPromise = trackedStopPromise;
  await trackedStopPromise;
}

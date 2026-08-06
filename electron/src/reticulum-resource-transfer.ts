import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as nodeCrypto from 'crypto';
import * as path from 'path';
import type { ReticulumBridge, ReticulumSendResult } from './reticulum-bridge';
import {
  RETICULUM_RESOURCE_MAX_RANGE_SIZE,
  RETICULUM_RESOURCE_RANGE_SIZE,
  ReticulumResourceStore,
  type ReticulumResourceManifest,
} from './reticulum-resource-store';
import { log as loggerLog, warn as loggerWarn } from './logger';

export const RETICULUM_RESOURCE_TRANSFER_RANGE_BYTES = RETICULUM_RESOURCE_RANGE_SIZE;
export const RETICULUM_RESOURCE_TRANSFER_ACCEPT_CONCURRENCY = 30;
export const RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE = 5;
export const RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_PEER = 5;
export const RETICULUM_RESOURCE_TRANSFER_RETRY_MS = 5_000;
export const RETICULUM_RESOURCE_TRANSFER_MAX_RANGE_ATTEMPTS = 6;
export const RETICULUM_RESOURCE_TRANSFER_TTL_MS = 10 * 60 * 1000;
export const RETICULUM_RESOURCE_TRANSFER_PULL_THROTTLE_MS = 15_000;
export const RETICULUM_RESOURCE_TRANSFER_IN_FLIGHT_STALE_MS = 180_000;
export const RETICULUM_RESOURCE_TRANSFER_RESPONSE_TIMEOUT_MS = 45_000;
export const RETICULUM_RESOURCE_TRANSFER_OVERLAY_STALE_THROTTLE_MS = 30_000;
export const RETICULUM_RESOURCE_TRANSFER_OVERLAY_THROTTLE_RETRY_MS = 5_000;
const RETICULUM_RESOURCE_TRANSFER_ACCEPT_STALE_MS = 180_000;
const RETICULUM_RESOURCE_TRANSFER_SPEED_LOG_MS = 5_000;
// Session preparation completes before a range request is opened. These
// deadlines therefore cover the request lifecycle, not Reticulum link setup.
export const RETICULUM_RESOURCE_TRANSFER_REQUEST_START_TIMEOUT_MS = 15_000;
// Once the bridge accepts a request it may be waiting behind another range in
// a bounded reusable-session queue. The bridge rejects queue entries older
// than 90 seconds, so leave a small delivery margin for that explicit result.
export const RETICULUM_RESOURCE_TRANSFER_QUEUE_TIMEOUT_MS = 95_000;
// Updated providers reject an authorization stall after 10 seconds. Keep the
// receiver compatible with older providers whose bounded deadline is 30s.
export const RETICULUM_RESOURCE_TRANSFER_AUTHORIZATION_TIMEOUT_MS = 35_000;
const RETICULUM_RESOURCE_TRANSFER_ZERO_PROGRESS_RETRY_MS = 10_000;
const RETICULUM_RESOURCE_TRANSFER_STALLED_PROGRESS_RETRY_MS = 20_000;

export type ReticulumResourceByteRange = {
  startByte: number;
  endByteExclusive: number;
};

export type ReticulumResourceTransferRequest = {
  eventId?: string;
  fileHash: string;
  ranges: ReticulumResourceByteRange[];
  requesterAddress?: string;
  requesterPeerHash?: string;
  conversationId?: string;
  peerAddress?: string;
  relayRequestId?: string;
};

export type ReticulumResourceTransferOffer = {
  transferId: string;
  contextId: number;
  eventId?: string;
  fileHash: string;
  totalSizeBytes: number;
  sizeBytes: number;
  fileName: string;
  mimeType: string;
  ranges: ReticulumResourceByteRange[];
  payloadHash?: string;
  sourcePeerHash?: string;
  relayRequestId?: string;
  temporaryPath?: string;
  receiveTemporaryPath?: string;
};

export type ReticulumResourceTransferPayload = {
  status?: string;
  transferId?: string;
  path?: string;
  linkId?: string;
  peerPresenceHash?: string;
  auth?: Record<string, unknown>;
  progress?: number;
  bytesTransferred?: number;
  bytesPerSecond?: number;
  sha256?: string;
  payloadHash?: string;
  reason?: string;
};

export type ReticulumResourceTransferProgress = {
  contextId: number;
  eventId?: string;
  fileHash: string;
  bytesTransferred?: number;
  totalBytes?: number;
  progress?: number;
  complete?: boolean;
  failed?: boolean;
  canceled?: boolean;
  failureReason?: 'verification_failed';
  sourcePeerHashes?: string[];
  featureData?: Record<string, unknown>;
};

export type ReticulumResourceDownloadRuntimeStatus = {
  active: boolean;
  peerCount: number;
  candidatePeerCount: number;
  advertisedPeerCount: number;
  activeTransfers: number;
  pendingTransfers: number;
  requestedRangeCount: number;
  inFlightRangeCount: number;
  bytesTransferred?: number;
  totalBytes?: number;
  progress?: number;
  currentBytesPerSecond: number;
  averageBytesPerSecond: number;
  nextRequestAt: number | null;
};

type ReticulumResourceDownloadState<TRequestWire> = {
  contextId: number;
  fileHash: string;
  eventId?: string;
  manifest: ReticulumResourceManifest;
  peerHashes: Set<string>;
  sourcePeerHashes: Set<string>;
  missingRanges: Map<string, ReticulumResourceByteRange>;
  rangeAttempts: Map<string, number>;
  rangePeers: Map<string, Set<string>>;
  inFlightRanges: Map<string, { transferId: string; startedAt: number }>;
  peerBulkThrottleUntil: Map<string, number>;
  peerBulkThrottleLoggedAt: Map<string, number>;
  waitingForProvider: boolean;
  nextRequestAt: number;
  integrityRecoveryAttempts: number;
  integrityRecoveryPromise?: Promise<void>;
  featureData?: Record<string, unknown>;
  storageLeaseId: string;
  storageReservationId?: string;
};

type TransferSpeedSample = {
  at: number;
  bytes: number;
  loggedAt: number;
  startedAt: number;
  bytesPerSecond: number;
};

type TransferProgressWatch = {
  lastProgressAt: number;
  lastProgressBytes: number;
  receivingStarted: boolean;
  phase?: 'requesting' | 'queued' | 'authorizing' | 'receiving';
};

export type ReticulumResourceTransferOptions<TRequestWire> = {
  bridge?: ReticulumBridge | null;
  resourceStore: ReticulumResourceStore;
  now?: () => number;
  loggerPrefix?: string;
  resourceType?: string;
  rangeResourceType?: string;
  authMessageType?: string;
  contextMetadataKey?: string;
  buildRequestPayloads: (
    state: {
      contextId: number;
      eventId?: string;
      manifest: ReticulumResourceManifest;
      featureData?: Record<string, unknown>;
    },
    ranges: ReticulumResourceByteRange[]
  ) => Promise<TRequestWire[]>;
  canServeRequest?: (
    contextId: number,
    request: ReticulumResourceTransferRequest,
    manifest: ReticulumResourceManifest
  ) => boolean | Promise<boolean>;
  parseAuthRequest?: (
    contextId: number,
    auth: Record<string, unknown>,
    peerHash: string
  ) => ReticulumResourceTransferRequest | null | Promise<ReticulumResourceTransferRequest | null>;
  resolvePeerIdentity?: (
    peerHash: string,
    reason: string
  ) => Promise<string | null | undefined> | string | null | undefined;
  onProgress?: (progress: ReticulumResourceTransferProgress) => void;
};

function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatBytesPerSecond(bytesPerSecond: number): string {
  return `${formatByteCount(bytesPerSecond)}/s`;
}

function rangeKey(range: ReticulumResourceByteRange): string {
  return `${range.startByte}:${range.endByteExclusive}`;
}

function normalizeRange(range: ReticulumResourceByteRange): ReticulumResourceByteRange {
  return {
    startByte: Math.floor(range.startByte),
    endByteExclusive: Math.floor(range.endByteExclusive),
  };
}

function rangeSize(range: ReticulumResourceByteRange): number {
  return Math.max(0, range.endByteExclusive - range.startByte);
}

function validRangeForManifest(
  manifest: ReticulumResourceManifest,
  range: ReticulumResourceByteRange
): boolean {
  return (
    Number.isInteger(range.startByte) &&
    Number.isInteger(range.endByteExclusive) &&
    range.startByte >= 0 &&
    range.endByteExclusive > range.startByte &&
    range.endByteExclusive <= manifest.sizeBytes &&
    rangeSize(range) <= RETICULUM_RESOURCE_MAX_RANGE_SIZE
  );
}

function mergeRanges(ranges: ReticulumResourceByteRange[]): ReticulumResourceByteRange[] {
  const sorted = ranges
    .map(normalizeRange)
    .filter((range) => range.endByteExclusive > range.startByte)
    .sort((a, b) => a.startByte - b.startByte || a.endByteExclusive - b.endByteExclusive);
  const merged: ReticulumResourceByteRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.startByte <= previous.endByteExclusive) {
      previous.endByteExclusive = Math.max(previous.endByteExclusive, range.endByteExclusive);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export class ReticulumResourceTransferManager<TRequestWire> extends EventEmitter {
  private bridge: ReticulumBridge | null;
  private readonly resourceStore: ReticulumResourceStore;
  private readonly now: () => number;
  private readonly loggerPrefix: string;
  private readonly rangeResourceType: string;
  private readonly authMessageType: string;
  private readonly contextMetadataKey?: string;
  private readonly buildRequestPayloads: ReticulumResourceTransferOptions<TRequestWire>['buildRequestPayloads'];
  private readonly canServeRequest?: ReticulumResourceTransferOptions<TRequestWire>['canServeRequest'];
  private readonly parseAuthRequest?: ReticulumResourceTransferOptions<TRequestWire>['parseAuthRequest'];
  private readonly resolvePeerIdentity?: ReticulumResourceTransferOptions<TRequestWire>['resolvePeerIdentity'];
  private readonly onProgress?: ReticulumResourceTransferOptions<TRequestWire>['onProgress'];
  private readonly downloads = new Map<string, ReticulumResourceDownloadState<TRequestWire>>();
  private readonly recentCandidatePeers = new Map<string, Map<string, number>>();
  private readonly offers = new Map<string, ReticulumResourceTransferOffer>();
  private readonly pendingLinkedRangeServes = new Map<string, Promise<void>>();
  private readonly requestedResources = new Map<string, number>();
  private readonly activeAccepts = new Set<string>();
  private readonly activeAcceptStartedAt = new Map<string, number>();
  private readonly transferSpeedSamples = new Map<string, TransferSpeedSample>();
  private readonly transferProgressWatch = new Map<string, TransferProgressWatch>();
  private downloadTimer: ReturnType<typeof setTimeout> | null = null;
  private schedulerActive = false;
  private closed = false;

  constructor(options: ReticulumResourceTransferOptions<TRequestWire>) {
    super();
    this.bridge = options.bridge ?? null;
    this.resourceStore = options.resourceStore;
    this.now = options.now ?? Date.now;
    this.loggerPrefix = options.loggerPrefix ?? 'ReticulumResourceTransfer';
    this.rangeResourceType = options.rangeResourceType ?? 'reticulum_resource_range';
    this.authMessageType = options.authMessageType ?? 'RETICULUM_RESOURCE_AUTH';
    this.contextMetadataKey = options.contextMetadataKey;
    this.buildRequestPayloads = options.buildRequestPayloads;
    this.canServeRequest = options.canServeRequest;
    this.parseAuthRequest = options.parseAuthRequest;
    this.resolvePeerIdentity = options.resolvePeerIdentity;
    this.onProgress = options.onProgress;
  }

  setBridge(bridge: ReticulumBridge | null): void {
    this.bridge = bridge;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.downloadTimer) {
      clearTimeout(this.downloadTimer);
      this.downloadTimer = null;
    }
    for (const offer of this.offers.values()) {
      this.cleanupTemporaryOfferFile(offer);
    }
    for (const state of this.downloads.values()) this.releaseStorageProtection(state);
    this.downloads.clear();
    this.recentCandidatePeers.clear();
    this.offers.clear();
    this.pendingLinkedRangeServes.clear();
    this.requestedResources.clear();
    this.activeAccepts.clear();
    this.activeAcceptStartedAt.clear();
    this.transferSpeedSamples.clear();
    this.transferProgressWatch.clear();
  }

  getDownloadStatus(fileHash: string): ReticulumResourceDownloadRuntimeStatus {
    const blobId = String(fileHash || '').trim().toLowerCase();
    if (this.closed) return this.emptyDownloadStatus();
    const state = this.downloads.get(blobId);
    if (!state) {
      return this.emptyDownloadStatus(blobId);
    }
    this.cleanupStaleAccepts();
    this.releaseStaleInFlightRanges(state);
    const advertisedPeers = new Set<string>();
    for (const peers of state.rangePeers.values()) {
      for (const peer of peers) {
        const peerKey = peer.trim().toLowerCase();
        if (peerKey) advertisedPeers.add(peerKey);
      }
    }
    for (const peer of state.sourcePeerHashes) {
      const peerKey = peer.trim().toLowerCase();
      if (peerKey) advertisedPeers.add(peerKey);
    }
    let activeTransfers = 0;
    for (const transferId of this.activeAccepts) {
      if (this.offers.get(transferId)?.fileHash.toLowerCase() === blobId) {
        activeTransfers += 1;
      }
    }
    const pendingTransfers = 0;
    let currentBytesPerSecond = 0;
    let activeSampleBytes = 0;
    let oldestStartedAt = 0;
    for (const transferId of this.activeAccepts) {
      const offer = this.offers.get(transferId);
      if (offer?.fileHash.toLowerCase() !== blobId) continue;
      const sample = this.transferSpeedSamples.get(transferId);
      if (!sample) continue;
      currentBytesPerSecond += Math.max(0, sample.bytesPerSecond || 0);
      activeSampleBytes += Math.max(0, sample.bytes || 0);
      oldestStartedAt = oldestStartedAt === 0
        ? sample.startedAt
        : Math.min(oldestStartedAt, sample.startedAt);
    }
    const totalBytes = Math.max(0, Math.floor(Number(state.manifest.sizeBytes) || 0));
    const completedBytes = this.resourceStore.getCompletedBytes(blobId);
    const bytesTransferred =
      totalBytes > 0
        ? Math.max(0, Math.min(totalBytes, completedBytes + activeSampleBytes))
        : 0;
    const elapsedMs = oldestStartedAt > 0 ? Math.max(1, this.now() - oldestStartedAt) : 0;
    return {
      active: true,
      peerCount: state.sourcePeerHashes.size,
      candidatePeerCount: state.peerHashes.size,
      advertisedPeerCount: advertisedPeers.size,
      activeTransfers,
      pendingTransfers,
      requestedRangeCount: state.rangeAttempts.size,
      inFlightRangeCount: state.inFlightRanges.size,
      bytesTransferred,
      totalBytes,
      progress: totalBytes > 0 ? bytesTransferred / totalBytes : 0,
      currentBytesPerSecond,
      averageBytesPerSecond:
        elapsedMs > 0 ? (bytesTransferred * 1000) / elapsedMs : 0,
      nextRequestAt: state.nextRequestAt || null,
    };
  }

  requestResource(options: {
    contextId: number;
    manifest: ReticulumResourceManifest;
    eventId?: string;
    candidatePeers?: string[];
    featureData?: Record<string, unknown>;
  }): void {
    if (this.closed) return;
    const blobId = options.manifest.fileHash.toLowerCase();
    const manifest: ReticulumResourceManifest = {
      ...options.manifest,
      fileHash: blobId,
    };
    this.resourceStore.storeManifest(manifest, { provenance: 'remote_downloaded' });
    if (this.resourceStore.getVerifiedAssembledPath(blobId)) return;
    const existingDownload = this.downloads.get(blobId);
    const state = this.upsertDownload(
      options.contextId,
      manifest,
      options.eventId,
      options.candidatePeers ?? [],
      options.featureData
    );
    try {
      this.ensureStorageProtection(state);
      this.resourceStore.ensurePartialFile(blobId);
    } catch (error) {
      if (!existingDownload) {
        this.releaseStorageProtection(state);
        this.downloads.delete(blobId);
      }
      throw error;
    }
    state.waitingForProvider = false;
    const resetForRetry =
      existingDownload &&
      !this.hasActiveAcceptsForResource(blobId) &&
      !this.hasActiveBulkThrottle(state);
    if (resetForRetry) {
      state.rangeAttempts.clear();
      state.inFlightRanges.clear();
      this.clearRequestedResourcesForFile(blobId);
    }
    if (resetForRetry || !existingDownload || state.nextRequestAt <= this.now()) {
      state.nextRequestAt = 0;
    }
    this.emitProgress(state);
    this.scheduleDownload(Math.max(0, state.nextRequestAt - this.now()));
  }

  addCandidatePeers(fileHash: string, peerHashes: string[]): boolean {
    if (this.closed) return false;
    const blobId = String(fileHash || '').trim().toLowerCase();
    if (!blobId || peerHashes.length === 0) return false;
    this.rememberCandidatePeers(blobId, peerHashes);
    const state = this.downloads.get(blobId);
    if (!state) return false;
    let added = false;
    for (const peer of peerHashes) {
      const peerKey = peer.trim().toLowerCase();
      if (!peerKey || state.peerHashes.has(peerKey)) continue;
      state.peerHashes.add(peerKey);
      added = true;
    }
    if (!added) return false;
    state.waitingForProvider = false;
    state.nextRequestAt = 0;
    this.emitProgress(state);
    this.scheduleDownload(0);
    return true;
  }

  async cancelResource(fileHash: string, reason = 'user_cancelled'): Promise<boolean> {
    if (this.closed) return false;
    const blobId = String(fileHash || '').trim().toLowerCase();
    if (!blobId) return false;
    const state = this.downloads.get(blobId);
    const transferIds = new Set<string>();
    for (const [transferId, offer] of this.offers.entries()) {
      if (offer.fileHash.toLowerCase() === blobId) {
        transferIds.add(transferId);
      }
    }
    if (!state && transferIds.size === 0) return false;

    if (state) {
      const payload: ReticulumResourceTransferProgress = {
        contextId: state.contextId,
        eventId: state.eventId,
        fileHash: state.fileHash,
        bytesTransferred: 0,
        totalBytes: state.manifest.sizeBytes,
        progress: 0,
        complete: false,
        failed: false,
        canceled: true,
      };
      this.emit('progress', payload);
      this.onProgress?.(payload);
      state.inFlightRanges.clear();
      state.rangeAttempts.clear();
      this.releaseStorageProtection(state);
      this.downloads.delete(blobId);
    }
    this.clearRequestedResourcesForFile(blobId);

    const bridgeCancellations: Array<Promise<unknown>> = [];
    for (const transferId of transferIds) {
      const offer = this.offers.get(transferId);
      if (offer) this.cleanupTemporaryOfferFile(offer);
      this.offers.delete(transferId);
      this.transferSpeedSamples.delete(transferId);
      this.transferProgressWatch.delete(transferId);
      this.activeAccepts.delete(transferId);
      this.activeAcceptStartedAt.delete(transferId);
      const cancelPromise = this.bridge?.cancelReticulumResourceDetailed?.({
        transferId,
        peerPresenceHash: offer?.sourcePeerHash,
        reason,
      });
      if (cancelPromise) {
        bridgeCancellations.push(cancelPromise.catch((err) => {
          loggerWarn(
            `[${this.loggerPrefix}] Failed to cancel bridge resource transfer=${transferId}:`,
            err
          );
        }));
      }
    }

    await Promise.all([
      this.resourceStore.discardResourceDataAsync(blobId),
      ...bridgeCancellations,
    ]);

    loggerLog(
      `[${this.loggerPrefix}] resource_download_cancelled fileHash=${blobId} ` +
        `transfers=${transferIds.size} reason=${reason}`
    );
    return true;
  }

  handleResourceEvent(payload: ReticulumResourceTransferPayload): void {
    if (this.closed) {
      if (payload?.status === 'received' && payload.path) {
        void fs.promises.unlink(payload.path).catch(() => undefined);
      }
      return;
    }
    if (payload?.status === 'auth' && payload.linkId && payload.transferId) {
      void this.handleAuth(payload);
      return;
    }
    if (payload?.status === 'receiving' && payload.transferId) {
      this.handleTransferProgress(payload);
      return;
    }
    if (payload?.status === 'accepted' && payload.transferId) {
      this.advanceTransferPhase(payload.transferId, 'queued');
      return;
    }
    if (payload?.status === 'auth_sent' && payload.transferId) {
      this.advanceTransferPhase(payload.transferId, 'authorizing');
      return;
    }
    if (payload?.status === 'failed' && payload.transferId) {
      this.handleProviderFailure(payload.transferId, String(payload.reason || 'resource_failed'));
      this.finishTransfer(payload.transferId, false);
      return;
    }
    if (payload?.status === 'sent' && payload.transferId) {
      this.finishTransfer(payload.transferId, true);
      return;
    }
    if (payload?.status !== 'received' || !payload.path || !payload.transferId) return;
    void this.importReceived(payload);
  }

  private handleProviderFailure(transferId: string, reason: string): void {
    if (
      reason === 'resource_request_start_timeout' ||
      reason === 'resource_request_queue_timeout' ||
      reason === 'resource_authorization_timeout' ||
      reason === 'resource_auth_refresh_required' ||
      reason === 'resource_request_timeout' ||
      reason === 'resource_session_establish_timeout'
    ) {
      this.temporarilyThrottleProvider(transferId, reason);
      return;
    }
    if (
      reason !== 'resource_unavailable' &&
      reason !== 'manifest_not_found' &&
      reason !== 'request_not_allowed'
    ) {
      return;
    }
    const offer = this.offers.get(transferId);
    if (!offer?.sourcePeerHash) return;
    const state = this.downloads.get(offer.fileHash);
    if (!state) return;
    const peerKey = offer.sourcePeerHash.trim().toLowerCase();
    if (!peerKey) return;
    const removed = state.peerHashes.delete(peerKey);
    this.recentCandidatePeers.get(offer.fileHash)?.delete(peerKey);
    state.sourcePeerHashes.delete(peerKey);
    state.peerBulkThrottleUntil.delete(peerKey);
    state.peerBulkThrottleLoggedAt.delete(peerKey);
    for (const peers of state.rangePeers.values()) peers.delete(peerKey);
    if (removed) {
      loggerWarn(
        `[${this.loggerPrefix}] resource_provider_rejected fileHash=${offer.fileHash} ` +
          `peer=${peerKey.slice(0, 16)} transfer=${transferId} reason=${reason}`
      );
    }
  }

  private temporarilyThrottleProvider(transferId: string, reason: string): void {
    const offer = this.offers.get(transferId);
    if (!offer?.sourcePeerHash) return;
    const state = this.downloads.get(offer.fileHash);
    if (!state) return;
    const peerKey = offer.sourcePeerHash.trim().toLowerCase();
    if (!peerKey || !state.peerHashes.has(peerKey)) return;
    const retryMs = RETICULUM_RESOURCE_TRANSFER_OVERLAY_THROTTLE_RETRY_MS;
    const throttledUntil = this.now() + retryMs;
    state.peerBulkThrottleUntil.set(
      peerKey,
      Math.max(state.peerBulkThrottleUntil.get(peerKey) ?? 0, throttledUntil)
    );
    const lastLoggedAt = state.peerBulkThrottleLoggedAt.get(peerKey) ?? 0;
    if (lastLoggedAt === 0 || this.now() - lastLoggedAt >= retryMs) {
      state.peerBulkThrottleLoggedAt.set(peerKey, this.now());
      loggerLog(
        `[${this.loggerPrefix}] resource_provider_temporarily_throttled fileHash=${offer.fileHash} ` +
          `peer=${peerKey.slice(0, 16)} transfer=${transferId} reason=${reason} retryMs=${retryMs}`
      );
    }
  }

  private emptyDownloadStatus(fileHash = ''): ReticulumResourceDownloadRuntimeStatus {
    const manifest = fileHash ? this.resourceStore.getManifest(fileHash) : null;
    const totalBytes = Math.max(0, Number(manifest?.sizeBytes || 0));
    const bytesTransferred = fileHash ? this.resourceStore.getCompletedBytes(fileHash) : 0;
    return {
      active: false,
      peerCount: 0,
      candidatePeerCount: 0,
      advertisedPeerCount: 0,
      activeTransfers: 0,
      pendingTransfers: 0,
      requestedRangeCount: 0,
      inFlightRangeCount: 0,
      bytesTransferred,
      totalBytes,
      progress: totalBytes > 0 ? Math.min(1, bytesTransferred / totalBytes) : 0,
      currentBytesPerSecond: 0,
      averageBytesPerSecond: 0,
      nextRequestAt: null,
    };
  }

  private upsertDownload(
    contextId: number,
    manifest: ReticulumResourceManifest,
    eventId: string | undefined,
    peerHashes: string[],
    featureData?: Record<string, unknown>
  ): ReticulumResourceDownloadState<TRequestWire> {
    const blobId = manifest.fileHash.toLowerCase();
    const existing = this.downloads.get(blobId);
    if (existing) {
      existing.contextId = contextId;
      existing.eventId = eventId || existing.eventId;
      existing.manifest = manifest;
      existing.featureData = featureData ?? existing.featureData;
      for (const peer of peerHashes) {
        const peerKey = peer.trim().toLowerCase();
        if (peerKey) existing.peerHashes.add(peerKey);
      }
      return existing;
    }
    const rememberedPeers = this.getRememberedCandidatePeers(blobId);
    const state: ReticulumResourceDownloadState<TRequestWire> = {
      contextId,
      fileHash: blobId,
      ...(eventId ? { eventId } : {}),
      manifest,
      peerHashes: new Set(
        [...peerHashes, ...rememberedPeers]
          .map((peer) => peer.trim().toLowerCase())
          .filter(Boolean)
      ),
      sourcePeerHashes: new Set(),
      missingRanges: this.buildMissingRangeMap(manifest),
      rangeAttempts: new Map(),
      rangePeers: new Map(),
      inFlightRanges: new Map(),
      peerBulkThrottleUntil: new Map(),
      peerBulkThrottleLoggedAt: new Map(),
      waitingForProvider: false,
      nextRequestAt: 0,
      integrityRecoveryAttempts: 0,
      storageLeaseId: this.resourceStore.acquireLease(
        blobId,
        'transfer',
        RETICULUM_RESOURCE_TRANSFER_TTL_MS
      ),
      ...(featureData ? { featureData } : {}),
    };
    this.downloads.set(blobId, state);
    return state;
  }

  private rememberCandidatePeers(fileHash: string, peerHashes: string[]): void {
    const now = this.now();
    this.pruneRememberedCandidatePeers(now);
    const peers = this.recentCandidatePeers.get(fileHash) ?? new Map<string, number>();
    for (const peer of peerHashes) {
      const peerKey = peer.trim().toLowerCase();
      if (peerKey) peers.set(peerKey, now + RETICULUM_RESOURCE_TRANSFER_TTL_MS);
    }
    if (peers.size > 0) this.recentCandidatePeers.set(fileHash, peers);
  }

  private getRememberedCandidatePeers(fileHash: string): string[] {
    this.pruneRememberedCandidatePeers(this.now());
    return [...(this.recentCandidatePeers.get(fileHash)?.keys() ?? [])];
  }

  private pruneRememberedCandidatePeers(now: number): void {
    for (const [fileHash, peers] of this.recentCandidatePeers) {
      for (const [peer, expiresAt] of peers) {
        if (expiresAt <= now) peers.delete(peer);
      }
      if (peers.size === 0) this.recentCandidatePeers.delete(fileHash);
    }
    if (this.recentCandidatePeers.size <= 4_096) return;
    const overflow = [...this.recentCandidatePeers.entries()]
      .sort((a, b) => {
        const aExpiry = Math.max(...a[1].values());
        const bExpiry = Math.max(...b[1].values());
        return aExpiry - bExpiry;
      })
      .slice(0, this.recentCandidatePeers.size - 4_096);
    for (const [fileHash] of overflow) this.recentCandidatePeers.delete(fileHash);
  }

  private releaseStorageProtection(
    state: ReticulumResourceDownloadState<TRequestWire>
  ): void {
    this.resourceStore.releaseLease(state.storageLeaseId);
    if (state.storageReservationId) {
      this.resourceStore.releaseReservation(state.storageReservationId);
      delete state.storageReservationId;
    }
  }

  private ensureStorageProtection(
    state: ReticulumResourceDownloadState<TRequestWire>
  ): void {
    let replacementLeaseId: string | null = null;
    if (
      !this.resourceStore.renewLease(
        state.storageLeaseId,
        RETICULUM_RESOURCE_TRANSFER_TTL_MS
      )
    ) {
      replacementLeaseId = this.resourceStore.acquireLease(
        state.fileHash,
        'transfer',
        RETICULUM_RESOURCE_TRANSFER_TTL_MS
      );
    }
    const completedBytes = this.resourceStore.getCompletedBytes(state.fileHash);
    const remainingBytes = Math.max(0, state.manifest.sizeBytes - completedBytes);
    let replacementReservationId: string | null = null;
    try {
      if (
        !state.storageReservationId ||
        !this.resourceStore.updateReservation(
          state.storageReservationId,
          remainingBytes,
          RETICULUM_RESOURCE_TRANSFER_TTL_MS
        )
      ) {
        replacementReservationId = this.resourceStore.reserveCapacity({
          fileHash: state.fileHash,
          sizeBytes: remainingBytes,
          provenance: 'remote_downloaded',
          ttlMs: RETICULUM_RESOURCE_TRANSFER_TTL_MS,
        });
      }
    } catch (error) {
      if (replacementLeaseId) this.resourceStore.releaseLease(replacementLeaseId);
      throw error;
    }
    if (replacementLeaseId) state.storageLeaseId = replacementLeaseId;
    if (replacementReservationId) {
      state.storageReservationId = replacementReservationId;
    }
  }

  private scheduleDownload(delayMs = RETICULUM_RESOURCE_TRANSFER_RETRY_MS): void {
    if (this.closed) return;
    if (this.downloadTimer) {
      if (delayMs > 0) return;
      clearTimeout(this.downloadTimer);
      this.downloadTimer = null;
    }
    this.downloadTimer = setTimeout(() => {
      this.downloadTimer = null;
      void this.processDownloads();
    }, Math.max(0, delayMs));
    this.downloadTimer.unref?.();
  }

  private async processDownloads(): Promise<void> {
    if (this.closed || this.schedulerActive) return;
    this.schedulerActive = true;
    try {
      this.retryNoProgressTransfers();
      this.cleanupStaleAccepts();
      const now = this.now();
      let nextDelay: number | null = null;
      for (const state of this.downloads.values()) {
        if (this.closed) return;
        if (state.waitingForProvider) continue;
        try {
          this.ensureStorageProtection(state);
        } catch (error) {
          loggerWarn(
            `[${this.loggerPrefix}] resource_download_storage_unavailable fileHash=${state.fileHash}`,
            error
          );
          this.emitProgress(state, false, undefined, true);
          this.releaseStorageProtection(state);
          this.downloads.delete(state.fileHash);
          continue;
        }
        if (state.nextRequestAt > now) {
          const delay = state.nextRequestAt - now;
          nextDelay = nextDelay === null ? delay : Math.min(nextDelay, delay);
          continue;
        }
        await this.dispatchRequests(state);
        if (this.closed) return;
      }
      const hasRunnableDownloads = [...this.downloads.values()].some((state) => !state.waitingForProvider);
      if (hasRunnableDownloads || this.activeAccepts.size > 0) {
        const activeWatchDelay = this.activeAccepts.size > 0
          ? RETICULUM_RESOURCE_TRANSFER_RETRY_MS
          : null;
        const delay = nextDelay == null
          ? (activeWatchDelay ?? RETICULUM_RESOURCE_TRANSFER_RETRY_MS)
          : activeWatchDelay == null
            ? nextDelay
            : Math.min(nextDelay, activeWatchDelay);
        this.scheduleDownload(delay);
      }
    } finally {
      this.schedulerActive = false;
    }
  }

  private async dispatchRequests(state: ReticulumResourceDownloadState<TRequestWire>): Promise<void> {
    if (this.closed) return;
    this.releaseStaleInFlightRanges(state);
    if (state.missingRanges.size === 0) {
      try {
        await this.resourceStore.assembleResourceAsync(state.fileHash);
        if (this.closed) return;
        this.emitProgress(state, true);
        this.releaseStorageProtection(state);
        this.downloads.delete(state.fileHash);
      } catch (error) {
        if (this.closed) return;
        if (!(await this.recoverInvalidAssembly(state, error))) {
          this.emitProgress(state);
        }
      }
      return;
    }

    const missing: ReticulumResourceByteRange[] = [];
    let hasInFlightRange = false;
    for (const range of state.missingRanges.values()) {
      if (state.inFlightRanges.has(rangeKey(range))) {
        hasInFlightRange = true;
        continue;
      }
      const attempts = state.rangeAttempts.get(rangeKey(range)) ?? 0;
      if (attempts >= RETICULUM_RESOURCE_TRANSFER_MAX_RANGE_ATTEMPTS) continue;
      missing.push(range);
      if (missing.length >= RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE) break;
    }
    if (missing.length === 0) {
      if (hasInFlightRange) {
        state.nextRequestAt = this.now() + RETICULUM_RESOURCE_TRANSFER_RETRY_MS;
        this.emitProgress(state);
        return;
      }
      loggerWarn(
        `[${this.loggerPrefix}] resource_download_exhausted fileHash=${state.fileHash} ` +
          `missingRanges=${state.missingRanges.size}`
      );
      this.emitProgress(state, false, undefined, true);
      this.releaseStorageProtection(state);
      this.downloads.delete(state.fileHash);
      return;
    }
    let delivered = false;
    const knownPeers = [...state.peerHashes]
      .map((peer) => peer.trim().toLowerCase())
      .filter(Boolean);
    const availablePeers = knownPeers.filter(
      (peer) => !this.peerHasMaxActiveAcceptsForResource(peer, state.fileHash)
    );
    if (this.resourceHasMaxActiveAccepts(state.fileHash)) {
      state.nextRequestAt = this.now() + RETICULUM_RESOURCE_TRANSFER_RETRY_MS;
      this.emitProgress(state);
      return;
    }
    if (knownPeers.length > 0 && availablePeers.length === 0) {
      state.nextRequestAt = this.now() + RETICULUM_RESOURCE_TRANSFER_RETRY_MS;
      this.emitProgress(state);
      return;
    }
    const requestedRanges: ReticulumResourceByteRange[] = [];
    let throttledPeerCount = 0;
    let capacityLimited = false;
    const assigned = new Set<string>();
    for (const peerKey of availablePeers) {
      if (this.activeAccepts.size >= RETICULUM_RESOURCE_TRANSFER_ACCEPT_CONCURRENCY) {
        capacityLimited = true;
        break;
      }
      if (this.resourceHasMaxActiveAccepts(state.fileHash)) {
        capacityLimited = true;
        break;
      }
      if (this.shouldThrottlePeerForBulk(state, peerKey)) {
        throttledPeerCount += 1;
        continue;
      }
      const preparedSession = await this.preparePeerResourceSession(
        peerKey,
        state
      );
      if (this.closed) return;
      if (!preparedSession.result.ok) {
        const failed = preparedSession.result as Exclude<
          ReticulumSendResult,
          { ok: true }
        >;
        loggerWarn(
          `[${this.loggerPrefix}] resource_session_prepare_failed fileHash=${state.fileHash} ` +
            `peer=${peerKey.slice(0, 16)} reason=${failed.error ?? failed.reason}`
        );
        continue;
      }
      while (
        this.activeAccepts.size < RETICULUM_RESOURCE_TRANSFER_ACCEPT_CONCURRENCY &&
        !this.resourceHasMaxActiveAccepts(state.fileHash) &&
        !this.peerHasMaxActiveAcceptsForResource(peerKey, state.fileHash)
      ) {
        const requestRange =
          missing.find(
            (range) => !assigned.has(rangeKey(range)) && (state.rangePeers.get(rangeKey(range))?.has(peerKey) ?? false)
          ) ?? missing.find((range) => !assigned.has(rangeKey(range)));
        if (!requestRange) break;
        assigned.add(rangeKey(requestRange));
        const requests = await this.buildRequestPayloads(state, [requestRange]);
        if (this.closed) return;
        if (requests.length === 0) {
          loggerWarn(
            `[${this.loggerPrefix}] Could not build targeted range request fileHash=${state.fileHash} peer=${peerKey}`
          );
          continue;
        }
        for (const request of requests) {
          if (this.activeAccepts.size >= RETICULUM_RESOURCE_TRANSFER_ACCEPT_CONCURRENCY) {
            capacityLimited = true;
            break;
          }
          if (this.resourceHasMaxActiveAccepts(state.fileHash)) {
            capacityLimited = true;
            break;
          }
          if (this.peerHasMaxActiveAcceptsForResource(peerKey, state.fileHash)) break;
          const throttleKey = `${state.contextId}:${peerKey}:${state.fileHash}:${rangeKey(requestRange)}`;
          const now = this.now();
          if (now - (this.requestedResources.get(throttleKey) ?? 0) < RETICULUM_RESOURCE_TRANSFER_PULL_THROTTLE_MS) {
            continue;
          }
          this.requestedResources.set(throttleKey, now);
          loggerLog(
            `[${this.loggerPrefix}] resource_range_link_requested fileHash=${state.fileHash} ` +
              `peer=${peerKey.slice(0, 16)} range=${rangeKey(requestRange)}`
          );
          const result = await this.openRangeLink(
            peerKey,
            state,
            requestRange,
            request,
            preparedSession.reticulumIdentityPublicKeyBase64
          );
          if (this.closed) return;
          if (result.ok) {
            delivered = true;
            requestedRanges.push(requestRange);
          } else {
            const failed = result as Exclude<ReticulumSendResult, { ok: true }>;
            loggerWarn(
              `[${this.loggerPrefix}] Targeted range request failed fileHash=${state.fileHash} peer=${peerKey} range=${rangeKey(requestRange)}:`,
              failed.error ?? failed.reason
            );
          }
        }
      }
    }
    if (!delivered && capacityLimited) {
      state.nextRequestAt = this.now() + RETICULUM_RESOURCE_TRANSFER_RETRY_MS;
      this.emitProgress(state);
      return;
    }
    if (!delivered && throttledPeerCount > 0) {
      state.nextRequestAt = this.now() + RETICULUM_RESOURCE_TRANSFER_OVERLAY_THROTTLE_RETRY_MS;
      this.emitProgress(state);
      return;
    }
    if (!delivered && knownPeers.length === 0) {
      if (!state.waitingForProvider) {
        state.waitingForProvider = true;
        loggerLog(
          `[${this.loggerPrefix}] resource_range_waiting_for_provider fileHash=${state.fileHash} ` +
            `missingRanges=${missing.length}`
        );
      }
      this.emitProgress(state);
      return;
    }
    for (const range of requestedRanges) {
      state.rangeAttempts.set(rangeKey(range), (state.rangeAttempts.get(rangeKey(range)) ?? 0) + 1);
    }
    state.nextRequestAt = delivered
      ? this.now() + RETICULUM_RESOURCE_TRANSFER_RESPONSE_TIMEOUT_MS
      : this.now() + RETICULUM_RESOURCE_TRANSFER_RETRY_MS;
    this.emitProgress(state);
  }

  private async openRangeLink(
    peerHash: string,
    state: ReticulumResourceDownloadState<TRequestWire>,
    range: ReticulumResourceByteRange,
    request: TRequestWire,
    reticulumIdentityPublicKeyBase64: string
  ): Promise<ReticulumSendResult> {
    if (!this.bridge || typeof this.bridge.acceptReticulumResourceDetailed !== 'function') {
      return { ok: false, reason: 'bridge-unavailable', error: 'Reticulum bridge unavailable' };
    }
    const peerKey = peerHash.trim().toLowerCase();
    if (!peerKey) {
      return { ok: false, reason: 'unknown-peer-presence-hash', error: 'Missing peer hash' };
    }
    const transferId = nodeCrypto.randomBytes(8).toString('hex');
    const fileName = `${state.fileHash}.range-${range.startByte}-${range.endByteExclusive}.bin`;
    const sizeBytes = rangeSize(range);
    const savePath = this.resourceStore.createPlaintextTempPath(
      state.fileHash,
      path.extname(fileName) || '.bin'
    );
    const requestFields =
      request && typeof request === 'object' && !Array.isArray(request)
        ? { ...(request as Record<string, unknown>) }
        : {};
    const authMessage = {
      ...requestFields,
      type: this.authMessageType,
      transferId,
      eventId: state.eventId ?? '',
      contextId: state.contextId,
      ...(this.contextMetadataKey ? { [this.contextMetadataKey]: state.contextId } : {}),
      fileHash: state.fileHash,
      totalSizeBytes: state.manifest.sizeBytes,
      byteRanges: [[range.startByte, range.endByteExclusive]],
      requesterPeerHash: this.bridge.getLocalDestinationHash?.() ?? '',
    };
    const offer: ReticulumResourceTransferOffer = {
      transferId,
      contextId: state.contextId,
      ...(state.eventId ? { eventId: state.eventId } : {}),
      fileHash: state.fileHash,
      totalSizeBytes: state.manifest.sizeBytes,
      sizeBytes,
      fileName,
      mimeType: state.manifest.mimeType,
      ranges: [range],
      sourcePeerHash: peerKey,
      receiveTemporaryPath: savePath,
    };
    this.offers.set(transferId, offer);
    this.activeAccepts.add(transferId);
    const startedAt = this.now();
    this.activeAcceptStartedAt.set(transferId, startedAt);
    this.transferProgressWatch.set(transferId, {
      lastProgressAt: startedAt,
      lastProgressBytes: 0,
      receivingStarted: false,
      phase: 'requesting',
    });
    this.markOfferRangesInFlight(state, offer);
    loggerLog(
      `[${this.loggerPrefix}] resource_session_opened fileHash=${state.fileHash} ` +
        `peer=${peerKey.slice(0, 16)} transfer=${transferId} mode=link-auth-range ` +
        `range=${rangeKey(range)} bytes=${sizeBytes}`
    );
    const result = await this.bridge.acceptReticulumResourceDetailed({
      peerPresenceHash: peerKey,
      reticulumIdentityPublicKeyBase64,
      transferId,
      savePath,
      fileName,
      size: sizeBytes,
      resourceType: this.rangeResourceType,
      metadata: {
        logicalResourceType: this.rangeResourceType,
        eventId: state.eventId ?? '',
        contextId: state.contextId,
        ...this.contextMetadata(state.contextId),
        fileHash: state.fileHash,
        totalSizeBytes: state.manifest.sizeBytes,
        byteRanges: [[range.startByte, range.endByteExclusive]],
        mimeType: state.manifest.mimeType,
      },
      authMessage,
    });
    if (!result.ok) {
      this.finishTransfer(transferId, false);
    }
    return result;
  }

  private async preparePeerResourceSession(
    peerHash: string,
    state: ReticulumResourceDownloadState<TRequestWire>
  ): Promise<{
    result: ReticulumSendResult;
    reticulumIdentityPublicKeyBase64: string;
  }> {
    if (!this.bridge) {
      return {
        result: { ok: false, reason: 'bridge-unavailable' },
        reticulumIdentityPublicKeyBase64: '',
      };
    }
    let reticulumIdentityPublicKeyBase64 = '';
    if (this.resolvePeerIdentity) {
      try {
        const resolvedIdentity = await this.resolvePeerIdentity(
          peerHash,
          'resource-range'
        );
        if (resolvedIdentity == null) {
          return {
            result: {
              ok: false,
              reason: 'unknown-peer-presence-hash',
              error: 'Unable to resolve peer identity',
            },
            reticulumIdentityPublicKeyBase64: '',
          };
        }
        reticulumIdentityPublicKeyBase64 = resolvedIdentity.trim();
      } catch (err) {
        loggerWarn(
          `[${this.loggerPrefix}] resource_peer_identity_resolve_failed fileHash=${state.fileHash} ` +
            `peer=${peerHash.slice(0, 16)} reason=${err instanceof Error ? err.message : String(err)}`
        );
        return {
          result: {
            ok: false,
            reason: 'unknown-peer-presence-hash',
            error: 'Unable to resolve peer identity',
          },
          reticulumIdentityPublicKeyBase64: '',
        };
      }
    }
    if (
      typeof this.bridge.ensureReticulumResourceSessionDetailed !== 'function'
    ) {
      return {
        result: { ok: true },
        reticulumIdentityPublicKeyBase64,
      };
    }
    return {
      result: await this.bridge.ensureReticulumResourceSessionDetailed({
        peerPresenceHash: peerHash,
        reticulumIdentityPublicKeyBase64,
        resourceType: this.rangeResourceType,
      }),
      reticulumIdentityPublicKeyBase64,
    };
  }

  private overlayPeerLastRxAgeMs(peerHash: string): number | null {
    const peerKey = peerHash.trim().toLowerCase();
    if (!peerKey || !this.bridge) return null;
    const snapshots = this.bridge.getOverlayLinkSnapshots?.();
    if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
    let lastRxAt = 0;
    for (const snap of snapshots) {
      if ((snap.peerPresenceHash || '').trim().toLowerCase() !== peerKey) continue;
      if (Number.isFinite(snap.lastRxAt) && snap.lastRxAt > lastRxAt) {
        lastRxAt = snap.lastRxAt;
      }
    }
    return lastRxAt > 0 ? Math.max(0, this.now() - lastRxAt) : null;
  }

  private shouldThrottlePeerForBulk(
    state: ReticulumResourceDownloadState<TRequestWire>,
    peerHash: string
  ): boolean {
    const peerKey = peerHash.trim().toLowerCase();
    if (!peerKey) return false;
    const now = this.now();
    const throttledUntil = state.peerBulkThrottleUntil.get(peerKey) ?? 0;
    if (throttledUntil > now) {
      return true;
    }
    const lastRxAgeMs = this.overlayPeerLastRxAgeMs(peerHash);
    if (
      lastRxAgeMs == null ||
      lastRxAgeMs < RETICULUM_RESOURCE_TRANSFER_OVERLAY_STALE_THROTTLE_MS
    ) {
      state.peerBulkThrottleUntil.delete(peerKey);
      state.peerBulkThrottleLoggedAt.delete(peerKey);
      return false;
    }
    state.peerBulkThrottleUntil.set(
      peerKey,
      now + RETICULUM_RESOURCE_TRANSFER_OVERLAY_THROTTLE_RETRY_MS
    );
    const lastLoggedAt = state.peerBulkThrottleLoggedAt.get(peerKey) ?? 0;
    if (
      lastLoggedAt === 0 ||
      now - lastLoggedAt >= RETICULUM_RESOURCE_TRANSFER_OVERLAY_THROTTLE_RETRY_MS
    ) {
      state.peerBulkThrottleLoggedAt.set(peerKey, now);
      loggerLog(
        `[${this.loggerPrefix}] resource_session_throttled fileHash=${state.fileHash} ` +
          `peer=${peerKey.slice(0, 16)} overlayLastRxAgeMs=${Math.round(lastRxAgeMs)} ` +
          `retryMs=${RETICULUM_RESOURCE_TRANSFER_OVERLAY_THROTTLE_RETRY_MS}`
      );
    }
    return true;
  }

  private emitProgress(
    state: ReticulumResourceDownloadState<TRequestWire>,
    complete = false,
    activeTransfer?: {
      offer: ReticulumResourceTransferOffer;
      progress: number;
      bytesTransferred?: number;
    },
    failed = false,
    failureReason?: ReticulumResourceTransferProgress['failureReason']
  ): void {
    if (this.closed) return;
    const totalBytes = Math.max(0, Math.floor(Number(state.manifest.sizeBytes) || 0));
    const completedBytes = this.resourceStore.getCompletedBytes(state.fileHash);
    const activeBytes =
      activeTransfer && Number.isFinite(activeTransfer.bytesTransferred)
        ? Math.max(0, Math.min(activeTransfer.offer.sizeBytes, Number(activeTransfer.bytesTransferred)))
        : 0;
    const bytesTransferred = totalBytes > 0
      ? Math.max(0, Math.min(totalBytes, completedBytes + activeBytes))
      : 0;
    const payload: ReticulumResourceTransferProgress = {
      contextId: state.contextId,
      eventId: state.eventId,
      fileHash: state.manifest.fileHash,
      bytesTransferred,
      totalBytes,
      progress: totalBytes > 0 ? bytesTransferred / totalBytes : 0,
      complete,
      failed,
      ...(failureReason ? { failureReason } : {}),
      sourcePeerHashes: [...state.sourcePeerHashes],
      ...(state.featureData ? { featureData: state.featureData } : {}),
    };
    this.emit('progress', payload);
    this.onProgress?.(payload);
  }

  private handleTransferProgress(payload: ReticulumResourceTransferPayload): void {
    const offer = this.offers.get(payload.transferId || '');
    if (!offer) return;
    const state = this.downloads.get(offer.fileHash);
    if (!state) return;
    const payloadBytes = Number(payload.bytesTransferred);
    const boundedBytes = Number.isFinite(payloadBytes) && payloadBytes >= 0
      ? Math.min(offer.sizeBytes, Math.floor(payloadBytes))
      : null;
    const progress = typeof payload.progress === 'number'
      ? Math.max(0, Math.min(1, payload.progress))
      : boundedBytes != null && offer.sizeBytes > 0
        ? boundedBytes / offer.sizeBytes
        : 0;
    this.handleTransferReceivingStarted(offer.transferId);
    this.activeAcceptStartedAt.set(offer.transferId, this.now());
    this.updateTransferProgressWatch(offer.transferId, boundedBytes ?? 0);
    this.refreshOfferRangesInFlight(state, offer);
    this.logTransferSpeed(offer, payload);
    this.emitProgress(state, false, {
      offer,
      progress,
      bytesTransferred: boundedBytes ?? 0,
    });
  }

  private handleTransferReceivingStarted(transferId: string): void {
    const offer = this.offers.get(transferId);
    if (!offer || !this.activeAccepts.has(transferId)) return;
    const now = this.now();
    this.activeAcceptStartedAt.set(transferId, now);
    const watch = this.transferProgressWatch.get(transferId);
    if (!watch) {
      this.transferProgressWatch.set(transferId, {
        lastProgressAt: now,
        lastProgressBytes: 0,
        receivingStarted: true,
        phase: 'receiving',
      });
    } else if (!watch.receivingStarted) {
      watch.receivingStarted = true;
      watch.lastProgressAt = now;
      watch.phase = 'receiving';
    }
    const state = this.downloads.get(offer.fileHash);
    if (state) this.refreshOfferRangesInFlight(state, offer);
  }

  private logTransferSpeed(
    offer: ReticulumResourceTransferOffer,
    payload: ReticulumResourceTransferPayload
  ): void {
    if (!offer.transferId || offer.sizeBytes <= 0) return;
    const now = this.now();
    const progress = typeof payload.progress === 'number' ? payload.progress : 0;
    const boundedProgress = Math.max(0, Math.min(1, progress));
    const payloadBytes = Number(payload.bytesTransferred);
    const bytes = Number.isFinite(payloadBytes) && payloadBytes >= 0
      ? Math.min(offer.sizeBytes, Math.floor(payloadBytes))
      : Math.floor(offer.sizeBytes * boundedProgress);
    const previous = this.transferSpeedSamples.get(offer.transferId);
    if (!previous || bytes < previous.bytes) {
      this.transferSpeedSamples.set(offer.transferId, {
        at: now,
        bytes,
        loggedAt: now,
        startedAt: now,
        bytesPerSecond: Number(payload.bytesPerSecond) || 0,
      });
      loggerLog(
        `[${this.loggerPrefix}] Download speed fileHash=${offer.fileHash} ` +
          `transfer=${offer.transferId} ` +
          `peer=${(offer.sourcePeerHash || '').slice(0, 16) || 'unknown'} ` +
          `range=${offer.ranges.map(rangeKey).join(',')} ` +
          `progress=${Math.round(boundedProgress * 100)}% ` +
          `speed=${formatBytesPerSecond(Number(payload.bytesPerSecond) || 0)} ` +
          `received=${formatByteCount(bytes)}/${formatByteCount(offer.sizeBytes)}`
      );
      return;
    }
    const elapsedMs = now - previous.at;
    const logElapsedMs = now - previous.loggedAt;
    if (
      elapsedMs <= 0 ||
      (logElapsedMs < RETICULUM_RESOURCE_TRANSFER_SPEED_LOG_MS && boundedProgress < 1)
    ) {
      return;
    }
    const payloadBytesPerSecond = Number(payload.bytesPerSecond);
    const bytesPerSecond = Number.isFinite(payloadBytesPerSecond) && payloadBytesPerSecond >= 0
      ? payloadBytesPerSecond
      : ((bytes - previous.bytes) * 1000) / elapsedMs;
    const remainingBytes = Math.max(0, offer.sizeBytes - bytes);
    const etaSeconds =
      bytesPerSecond > 0 ? Math.ceil(remainingBytes / bytesPerSecond) : null;
    loggerLog(
      `[${this.loggerPrefix}] Download speed fileHash=${offer.fileHash} ` +
        `transfer=${offer.transferId} ` +
        `peer=${(offer.sourcePeerHash || '').slice(0, 16) || 'unknown'} ` +
        `range=${offer.ranges.map(rangeKey).join(',')} ` +
        `progress=${Math.round(boundedProgress * 100)}% ` +
        `speed=${formatBytesPerSecond(bytesPerSecond)} ` +
        `received=${formatByteCount(bytes)}/${formatByteCount(offer.sizeBytes)}` +
        (etaSeconds != null ? ` eta=${etaSeconds}s` : '')
    );
    this.transferSpeedSamples.set(offer.transferId, {
      at: now,
      bytes,
      loggedAt: now,
      startedAt: previous.startedAt,
      bytesPerSecond,
    });
  }

  private async handleAuth(payload: ReticulumResourceTransferPayload): Promise<void> {
    if (this.closed) return;
    const transferId = typeof payload.transferId === 'string' ? payload.transferId : '';
    if (!transferId || !this.bridge) return;
    const auth = payload.auth && typeof payload.auth === 'object' ? payload.auth : {};
    if (auth.type !== this.authMessageType) {
      loggerWarn(
        `[${this.loggerPrefix}] Rejecting resource auth transfer=${transferId}: bad auth type`
      );
      await this.bridge.rejectReticulumResourceDetailed?.({
        linkId: payload.linkId || '',
        transferId,
        reason: 'bad_auth_type',
      });
      this.finishTransfer(transferId, false);
      return;
    }
    const offer = this.offers.get(transferId);
    if (!offer) {
      const pendingServe = this.pendingLinkedRangeServes.get(transferId);
      if (pendingServe) {
        await pendingServe;
        if (this.closed) return;
        const preparedOffer = this.offers.get(transferId);
        if (preparedOffer?.temporaryPath && !preparedOffer.receiveTemporaryPath) {
          await this.authorizeProvidedOffer(
            payload,
            auth as Record<string, unknown>,
            preparedOffer
          );
        }
        return;
      }
      const serve = this.serveLinkedRangeRequest(
        payload,
        auth as Record<string, unknown>
      ).finally(() => {
        if (this.pendingLinkedRangeServes.get(transferId) === serve) {
          this.pendingLinkedRangeServes.delete(transferId);
        }
      });
      this.pendingLinkedRangeServes.set(transferId, serve);
      await serve;
      return;
    }
    if (offer.temporaryPath && !offer.receiveTemporaryPath) {
      await this.authorizeProvidedOffer(payload, auth as Record<string, unknown>, offer);
      return;
    }
    await this.authorizeAcceptedOffer(payload, auth as Record<string, unknown>, offer);
  }

  private async authorizeProvidedOffer(
    payload: ReticulumResourceTransferPayload,
    auth: Record<string, unknown>,
    offer: ReticulumResourceTransferOffer
  ): Promise<void> {
    if (this.closed) return;
    const transferId = offer.transferId;
    const authRanges = Array.isArray(auth.byteRanges)
      ? auth.byteRanges
      : [];
    const expectedRanges = offer.ranges.map((range) => [range.startByte, range.endByteExclusive]);
    if (
      Number(auth.contextId) !== offer.contextId ||
      auth.fileHash !== offer.fileHash ||
      JSON.stringify(authRanges) !== JSON.stringify(expectedRanges)
    ) {
      loggerWarn(
        `[${this.loggerPrefix}] Rejecting provided resource auth transfer=${transferId}: metadata mismatch`
      );
      await this.bridge?.rejectReticulumResourceDetailed?.({
        linkId: payload.linkId || '',
        transferId,
        reason: 'resource_auth_mismatch',
      });
      this.finishTransfer(transferId, false);
      return;
    }
    await this.bridge?.authorizeReticulumResourceDetailed({
      linkId: payload.linkId || '',
      transferId,
    });
  }

  private async authorizeAcceptedOffer(
    payload: ReticulumResourceTransferPayload,
    auth: Record<string, unknown>,
    offer: ReticulumResourceTransferOffer
  ): Promise<void> {
    if (this.closed) return;
    const transferId = offer.transferId;
    const authRanges = Array.isArray(auth.byteRanges)
      ? auth.byteRanges
      : [];
    const expectedRanges = offer?.ranges.map((range) => [range.startByte, range.endByteExclusive]) ?? [];
    if (
      Number(auth.contextId) !== offer.contextId ||
      auth.fileHash !== offer.fileHash ||
      JSON.stringify(authRanges) !== JSON.stringify(expectedRanges)
    ) {
      loggerWarn(
        `[${this.loggerPrefix}] Rejecting resource auth transfer=${transferId}: metadata mismatch`
      );
      await this.bridge.rejectReticulumResourceDetailed?.({
        linkId: payload.linkId || '',
        transferId,
        reason: 'resource_auth_mismatch',
      });
      this.finishTransfer(transferId, false);
      return;
    }
    if (offer.payloadHash && auth.payloadHash !== offer.payloadHash) {
      loggerWarn(
        `[${this.loggerPrefix}] Rejecting resource auth transfer=${transferId}: payload hash mismatch`
      );
      await this.bridge?.rejectReticulumResourceDetailed?.({
        linkId: payload.linkId || '',
        transferId,
        reason: 'resource_auth_mismatch',
      });
      this.finishTransfer(transferId, false);
      return;
    }
    await this.bridge.authorizeReticulumResourceDetailed({
      linkId: payload.linkId || '',
      transferId,
    });
  }

  private async serveLinkedRangeRequest(
    payload: ReticulumResourceTransferPayload,
    auth: Record<string, unknown>
  ): Promise<void> {
    if (
      this.closed ||
      !this.bridge ||
      !payload.linkId ||
      !payload.transferId ||
      !this.parseAuthRequest
    ) return;
    const contextId = Number(
      (this.contextMetadataKey ? auth[this.contextMetadataKey] : undefined) ??
        auth.contextId ??
        0
    );
    const authPeerHash =
      typeof auth.requesterPeerHash === 'string' ? auth.requesterPeerHash : '';
    const peerHash = String(payload.peerPresenceHash || authPeerHash || '').trim().toLowerCase();
    const request = await this.parseAuthRequest(contextId, auth, peerHash);
    if (this.closed) return;
    const transferId = payload.transferId;
    if (!request || !Number.isInteger(contextId) || contextId <= 0) {
      await this.bridge.rejectReticulumResourceDetailed?.({
        linkId: payload.linkId,
        transferId,
        reason: 'bad_resource_auth',
      });
      return;
    }
    const manifest = this.resourceStore.getManifest(request.fileHash);
    if (!manifest || manifest.fileHash.toLowerCase() !== request.fileHash.toLowerCase()) {
      await this.bridge.rejectReticulumResourceDetailed?.({
        linkId: payload.linkId,
        transferId,
        reason: 'manifest_not_found',
      });
      return;
    }
    if (this.canServeRequest) {
      const allowed = await this.canServeRequest(contextId, request, manifest);
      if (this.closed) return;
      if (!allowed) {
        await this.bridge.rejectReticulumResourceDetailed?.({
          linkId: payload.linkId,
          transferId,
          reason: 'request_not_allowed',
        });
        return;
      }
    }
    const ranges = mergeRanges(request.ranges || [])
      .filter((range) => validRangeForManifest(manifest, range))
      .slice(0, 1);
    if (ranges.length === 0) {
      await this.bridge.rejectReticulumResourceDetailed?.({
        linkId: payload.linkId,
        transferId,
        reason: 'invalid_ranges',
      });
      return;
    }
    const range = ranges[0];
    const requesterPeerHash = String(request.requesterPeerHash || peerHash || '').trim().toLowerCase();
    if (!requesterPeerHash) {
      await this.bridge.rejectReticulumResourceDetailed?.({
        linkId: payload.linkId,
        transferId,
        reason: 'missing_requester_peer',
      });
      return;
    }
    let rangePayload: { path: string; sizeBytes: number; sha256: string };
    try {
      rangePayload = await this.resourceStore.readByteRangeAsync(
        manifest.fileHash,
        range.startByte,
        range.endByteExclusive
      );
    } catch {
      await this.bridge.rejectReticulumResourceDetailed?.({
        linkId: payload.linkId,
        transferId,
        reason: 'resource_unavailable',
      });
      return;
    }
    if (this.closed) {
      this.cleanupTemporaryPath(rangePayload.path);
      return;
    }
    const registered = await this.bridge.sendReticulumResourceDetailed({
      allowedRecipientAddress: requesterPeerHash,
      transferId,
      filePath: rangePayload.path,
      fileName: `${manifest.fileHash}.range-${range.startByte}-${range.endByteExclusive}.bin`,
      size: rangePayload.sizeBytes,
      sha256: rangePayload.sha256,
      resourceType: this.rangeResourceType,
      metadata: {
        logicalResourceType: this.rangeResourceType,
        eventId: request.eventId ?? '',
        contextId,
        ...this.contextMetadata(contextId),
        fileHash: manifest.fileHash,
        totalSizeBytes: manifest.sizeBytes,
        byteRanges: [[range.startByte, range.endByteExclusive]],
        payloadHash: rangePayload.sha256,
        mimeType: manifest.mimeType,
        namespace: manifest.namespace,
      },
      expiresAt: this.now() + RETICULUM_RESOURCE_TRANSFER_TTL_MS,
    });
    if (this.closed) {
      this.cleanupTemporaryPath(rangePayload.path);
      if (registered.ok) {
        await this.bridge.rejectReticulumResourceDetailed?.({
          linkId: payload.linkId,
          transferId,
          reason: 'resource_manager_closed',
        });
      }
      return;
    }
    if (!registered.ok) {
      this.cleanupTemporaryPath(rangePayload.path);
      const failed = registered as Exclude<ReticulumSendResult, { ok: true }>;
      loggerWarn(
        `[${this.loggerPrefix}] Failed to register linked byte range fileHash=${manifest.fileHash} range=${rangeKey(range)}:`,
        failed.error ?? failed.reason
      );
      await this.bridge.rejectReticulumResourceDetailed?.({
        linkId: payload.linkId,
        transferId,
        reason: 'resource_register_failed',
      });
      return;
    }
    const offer: ReticulumResourceTransferOffer = {
      transferId,
      contextId,
      ...(request.eventId ? { eventId: request.eventId } : {}),
      fileHash: manifest.fileHash,
      totalSizeBytes: manifest.sizeBytes,
      sizeBytes: rangePayload.sizeBytes,
      fileName: `${manifest.fileHash}.range-${range.startByte}-${range.endByteExclusive}.bin`,
      mimeType: manifest.mimeType,
      ranges: [range],
      payloadHash: rangePayload.sha256,
      temporaryPath: rangePayload.path,
      sourcePeerHash: requesterPeerHash,
      ...(request.relayRequestId ? { relayRequestId: request.relayRequestId } : {}),
    };
    this.offers.set(transferId, offer);
    loggerLog(
      `[${this.loggerPrefix}] resource_range_streaming fileHash=${manifest.fileHash} ` +
        `peer=${requesterPeerHash.slice(0, 16) || 'unknown'} transfer=${transferId} ` +
        `mode=linked-auth range=${rangeKey(range)} bytes=${rangePayload.sizeBytes}`
    );
    await this.bridge.authorizeReticulumResourceDetailed({
      linkId: payload.linkId,
      transferId,
    });
  }

  private async importReceived(payload: ReticulumResourceTransferPayload): Promise<void> {
    if (!payload.path || !payload.transferId) return;
    const offer = this.offers.get(payload.transferId);
    if (!offer) {
      await fs.promises.unlink(payload.path).catch(() => undefined);
      return;
    }
    try {
      const { bytes, hash: actualHash } = await this.resourceStore.readAndHashFile(payload.path);
      if (this.closed) return;
      const expectedPayloadHash =
        typeof offer.payloadHash === 'string' && /^[0-9a-f]{64}$/i.test(offer.payloadHash)
          ? offer.payloadHash.toLowerCase()
          : typeof payload.payloadHash === 'string' && /^[0-9a-f]{64}$/i.test(payload.payloadHash)
            ? payload.payloadHash.toLowerCase()
            : typeof payload.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(payload.sha256)
              ? payload.sha256.toLowerCase()
              : '';
      const pendingManifest = this.resourceStore.getManifest(offer.fileHash);
      if (!pendingManifest) {
        loggerWarn(
          `[${this.loggerPrefix}] Cannot import resource transfer=${offer.transferId}: manifest not found`
        );
        return;
      }
      if (pendingManifest.fileHash.toLowerCase() !== offer.fileHash.toLowerCase()) {
        loggerWarn(
          `[${this.loggerPrefix}] Cannot import resource transfer=${offer.transferId}: manifest file hash mismatch`
        );
        return;
      }
      if (expectedPayloadHash && actualHash !== expectedPayloadHash) {
        loggerWarn(
          `[${this.loggerPrefix}] Cannot import resource range fileHash=${offer.fileHash}: payload hash mismatch`
        );
        return;
      }
      if (offer.ranges.length !== 1) {
        loggerWarn(
          `[${this.loggerPrefix}] Cannot import resource range fileHash=${offer.fileHash}: invalid range count`
        );
        return;
      }
      const range = offer.ranges[0];
      await this.resourceStore.storeByteRangeAsync(
        offer.fileHash,
        range.startByte,
        range.endByteExclusive,
        bytes
      );
      if (this.closed) return;
      const state = this.downloads.get(offer.fileHash);
      if (state) {
        this.ensureStorageProtection(state);
        if (offer.sourcePeerHash) {
          state.sourcePeerHashes.add(offer.sourcePeerHash.trim().toLowerCase());
        }
      }
      loggerLog(
        `[${this.loggerPrefix}] resource_range_stored fileHash=${offer.fileHash} ` +
          `transfer=${offer.transferId} range=${rangeKey(range)} bytes=${bytes.length}`
      );
      this.emit('resource', {
        contextId: offer.contextId,
        eventId: offer.eventId,
        fileHash: offer.fileHash,
      });
      await this.handleReceivedRange(offer);
    } catch (err) {
      loggerWarn(`[${this.loggerPrefix}] Failed to import received resource:`, err);
      this.finishTransfer(payload.transferId, false);
    } finally {
      const currentState = this.downloads.get(offer.fileHash);
      if (currentState) {
        this.releaseOfferRangesInFlight(currentState, offer);
      }
      this.offers.delete(payload.transferId);
      this.transferSpeedSamples.delete(payload.transferId);
      this.transferProgressWatch.delete(payload.transferId);
      this.activeAccepts.delete(payload.transferId);
      this.activeAcceptStartedAt.delete(payload.transferId);
      await fs.promises.unlink(payload.path).catch(() => undefined);
    }
  }

  private finishTransfer(transferId: string, success: boolean): void {
    const offer = this.offers.get(transferId);
    if (offer) this.cleanupTemporaryOfferFile(offer);
    this.offers.delete(transferId);
    this.transferSpeedSamples.delete(transferId);
    this.transferProgressWatch.delete(transferId);
    this.activeAccepts.delete(transferId);
    this.activeAcceptStartedAt.delete(transferId);
    if (offer) {
      const state = this.downloads.get(offer.fileHash);
      if (state) {
        this.releaseOfferRangesInFlight(state, offer);
        if (!success) {
          state.nextRequestAt = 0;
          this.emitProgress(state);
          this.scheduleDownload(0);
        }
      }
    }
  }

  private updateTransferProgressWatch(transferId: string, bytesTransferred: number): void {
    const watch = this.transferProgressWatch.get(transferId);
    if (!watch) return;
    const bytes = Math.max(0, Math.floor(bytesTransferred));
    if (bytes > watch.lastProgressBytes) {
      watch.lastProgressBytes = bytes;
      watch.lastProgressAt = this.now();
    }
  }

  private advanceTransferPhase(
    transferId: string,
    phase: 'requesting' | 'queued' | 'authorizing' | 'receiving'
  ): void {
    const watch = this.transferProgressWatch.get(transferId);
    if (!watch) return;
    const phaseRank = { requesting: 0, queued: 1, authorizing: 2, receiving: 3 } as const;
    const currentPhase = watch.phase ?? (watch.receivingStarted ? 'receiving' : 'requesting');
    if (phaseRank[phase] <= phaseRank[currentPhase]) return;
    watch.phase = phase;
    watch.receivingStarted = phase === 'receiving';
    watch.lastProgressAt = this.now();
  }

  private async handleReceivedRange(offer: ReticulumResourceTransferOffer): Promise<void> {
    if (this.closed) return;
    const state = this.downloads.get(offer.fileHash);
    if (!state) return;
    for (const range of offer.ranges) {
      state.rangeAttempts.delete(rangeKey(range));
      state.missingRanges.delete(rangeKey(range));
    }
    this.releaseOfferRangesInFlight(state, offer);
    try {
      await this.resourceStore.assembleResourceAsync(offer.fileHash);
      if (this.closed) return;
      loggerLog(
        `[${this.loggerPrefix}] resource_session_completed fileHash=${offer.fileHash} ` +
          `transfer=${offer.transferId} mode=byte-range`
      );
      this.emitProgress(state, true);
      this.releaseStorageProtection(state);
      this.downloads.delete(offer.fileHash);
      return;
    } catch (error) {
      if (this.closed) return;
      if (!(await this.recoverInvalidAssembly(state, error))) {
        this.emitProgress(state);
        state.nextRequestAt = 0;
        this.scheduleDownload(0);
      }
    }
  }

  private isAssemblyIntegrityError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return (
      message.includes('Assembled file hash mismatch') ||
      message.includes('Resource source size mismatch') ||
      message.includes('Partial file size mismatch')
    );
  }

  private async recoverInvalidAssembly(
    state: ReticulumResourceDownloadState<TRequestWire>,
    error: unknown
  ): Promise<boolean> {
    if (this.closed) return false;
    if (!this.isAssemblyIntegrityError(error)) return false;
    if (state.integrityRecoveryPromise) {
      await state.integrityRecoveryPromise;
      return true;
    }

    const recovery = (async () => {
      state.integrityRecoveryAttempts += 1;
      const terminal = state.integrityRecoveryAttempts > 1;
      loggerWarn(
        `[${this.loggerPrefix}] resource_verification_failed fileHash=${state.fileHash} ` +
          `attempt=${state.integrityRecoveryAttempts} action=${terminal ? 'stop' : 'redownload'} ` +
          `reason=${error instanceof Error ? error.message : String(error || 'unknown')}`
      );
      state.rangeAttempts.clear();
      state.inFlightRanges.clear();
      this.clearRequestedResourcesForFile(state.fileHash);
      await this.resourceStore.discardResourceDataAsync(state.fileHash);
      if (this.closed) return;
      if (this.downloads.get(state.fileHash) !== state) return;

      state.missingRanges = this.buildMissingRangeMap(state.manifest);
      state.waitingForProvider = false;
      state.nextRequestAt = 0;
      this.emitProgress(
        state,
        false,
        undefined,
        terminal,
        'verification_failed'
      );
      if (terminal) {
        this.releaseStorageProtection(state);
        this.downloads.delete(state.fileHash);
        return;
      }
      this.scheduleDownload(0);
    })();
    state.integrityRecoveryPromise = recovery;
    try {
      await recovery;
    } finally {
      if (state.integrityRecoveryPromise === recovery) {
        delete state.integrityRecoveryPromise;
      }
    }
    return true;
  }

  private isValidOffer(offer: ReticulumResourceTransferOffer): boolean {
    if (typeof offer.transferId !== 'string' || !offer.transferId) return false;
    if (!Number.isInteger(offer.contextId) || offer.contextId <= 0) return false;
    if (offer.eventId != null && (typeof offer.eventId !== 'string' || offer.eventId.length < 8)) return false;
    if (typeof offer.fileHash !== 'string' || !/^[0-9a-f]{64}$/i.test(offer.fileHash)) return false;
    if (!Number.isInteger(offer.totalSizeBytes) || offer.totalSizeBytes <= 0) return false;
    if (!Number.isInteger(offer.sizeBytes) || offer.sizeBytes <= 0) return false;
    if (
      offer.payloadHash != null &&
      (typeof offer.payloadHash !== 'string' || !/^[0-9a-f]{64}$/i.test(offer.payloadHash))
    ) return false;
    if (!Array.isArray(offer.ranges) || offer.ranges.length !== 1) return false;
    const totalRangeBytes = offer.ranges.reduce((total, range) => total + rangeSize(range), 0);
    return totalRangeBytes === offer.sizeBytes;
  }

  private buildMissingRangeMap(
    manifest: ReticulumResourceManifest
  ): Map<string, ReticulumResourceByteRange> {
    const completed = mergeRanges(
      this.resourceStore.getCompletedRanges(manifest.fileHash).map((range) => ({
        startByte: range.startByte,
        endByteExclusive: range.endByteExclusive,
      }))
    );
    const missing = new Map<string, ReticulumResourceByteRange>();
    const addMissing = (startByte: number, endByteExclusive: number) => {
      for (const range of this.splitRange(startByte, endByteExclusive)) {
        missing.set(rangeKey(range), range);
      }
    };
    let cursor = 0;
    for (const range of completed) {
      if (range.startByte > cursor) {
        addMissing(cursor, range.startByte);
      }
      cursor = Math.max(cursor, range.endByteExclusive);
    }
    if (cursor < manifest.sizeBytes) {
      addMissing(cursor, manifest.sizeBytes);
    }
    return missing;
  }

  private splitRange(startByte: number, endByteExclusive: number): ReticulumResourceByteRange[] {
    const ranges: ReticulumResourceByteRange[] = [];
    let cursor = startByte;
    while (cursor < endByteExclusive) {
      const end = Math.min(endByteExclusive, cursor + RETICULUM_RESOURCE_TRANSFER_RANGE_BYTES);
      ranges.push({ startByte: cursor, endByteExclusive: end });
      cursor = end;
    }
    return ranges;
  }

  private rangeAlreadyComplete(fileHash: string, candidate: ReticulumResourceByteRange): boolean {
    return this.resourceStore.hasCompletedRange(
      fileHash,
      candidate.startByte,
      candidate.endByteExclusive
    );
  }

  private markOfferRangesInFlight(
    state: ReticulumResourceDownloadState<TRequestWire>,
    offer: ReticulumResourceTransferOffer
  ): void {
    const startedAt = this.now();
    for (const range of offer.ranges) {
      state.inFlightRanges.set(rangeKey(range), {
        transferId: offer.transferId,
        startedAt,
      });
    }
  }

  private releaseOfferRangesInFlight(
    state: ReticulumResourceDownloadState<TRequestWire>,
    offer: ReticulumResourceTransferOffer
  ): void {
    for (const range of offer.ranges) {
      const reservation = state.inFlightRanges.get(rangeKey(range));
      if (reservation?.transferId === offer.transferId) {
        state.inFlightRanges.delete(rangeKey(range));
      }
    }
  }

  private refreshOfferRangesInFlight(
    state: ReticulumResourceDownloadState<TRequestWire>,
    offer: ReticulumResourceTransferOffer
  ): void {
    const now = this.now();
    for (const range of offer.ranges) {
      const reservation = state.inFlightRanges.get(rangeKey(range));
      if (reservation?.transferId === offer.transferId) {
        reservation.startedAt = now;
      }
    }
  }

  private releaseStaleInFlightRanges(state: ReticulumResourceDownloadState<TRequestWire>): void {
    const now = this.now();
    for (const [key, reservation] of state.inFlightRanges.entries()) {
      if (now - reservation.startedAt >= RETICULUM_RESOURCE_TRANSFER_IN_FLIGHT_STALE_MS) {
        state.inFlightRanges.delete(key);
      }
    }
  }

  private retryNoProgressTransfers(): void {
    const now = this.now();
    const retries: Array<{ transferId: string; reason: string }> = [];
    for (const transferId of this.activeAccepts) {
      const offer = this.offers.get(transferId);
      const watch = this.transferProgressWatch.get(transferId);
      if (!offer || !watch) continue;
      const receivedBytes = Math.max(0, Math.floor(watch.lastProgressBytes));
      const phase = watch.phase ?? (watch.receivingStarted ? 'receiving' : 'requesting');
      const thresholdMs = phase === 'requesting'
        ? RETICULUM_RESOURCE_TRANSFER_REQUEST_START_TIMEOUT_MS
        : phase === 'queued'
          ? RETICULUM_RESOURCE_TRANSFER_QUEUE_TIMEOUT_MS
          : phase === 'authorizing'
            ? RETICULUM_RESOURCE_TRANSFER_AUTHORIZATION_TIMEOUT_MS
            : receivedBytes <= 0
              ? RETICULUM_RESOURCE_TRANSFER_ZERO_PROGRESS_RETRY_MS
              : RETICULUM_RESOURCE_TRANSFER_STALLED_PROGRESS_RETRY_MS;
      const ageMs = now - watch.lastProgressAt;
      if (ageMs >= thresholdMs) {
        const reason = phase === 'requesting'
          ? 'resource_request_start_timeout'
          : phase === 'queued'
            ? 'resource_request_queue_timeout'
            : phase === 'authorizing'
              ? 'resource_authorization_timeout'
              : 'resource_range_no_progress_retry';
        loggerWarn(
          `[${this.loggerPrefix}] ${reason} fileHash=${offer.fileHash} ` +
            `transfer=${transferId} peer=${(offer.sourcePeerHash || '').slice(0, 16) || 'unknown'} ` +
            `range=${offer.ranges.map(rangeKey).join(',')} ` +
            `bytesReceived=${receivedBytes}/${offer.sizeBytes} ageMs=${Math.round(ageMs)} ` +
            `thresholdMs=${thresholdMs}`
        );
        retries.push({ transferId, reason });
      }
    }
    for (const { transferId, reason } of retries) {
      if (
        reason === 'resource_request_start_timeout' ||
        reason === 'resource_request_queue_timeout' ||
        reason === 'resource_authorization_timeout'
      ) {
        this.handleProviderFailure(transferId, reason);
      }
      this.cancelTransferForRetry(transferId, reason);
    }
  }

  private cancelTransferForRetry(transferId: string, reason: string): void {
    const offer = this.offers.get(transferId);
    const cancelPromise = this.bridge?.cancelReticulumResourceDetailed?.({
      transferId,
      peerPresenceHash: offer?.sourcePeerHash,
      reason,
    });
    if (cancelPromise) {
      void cancelPromise.catch((err) => {
        loggerWarn(
          `[${this.loggerPrefix}] Failed to cancel stalled resource transfer=${transferId}:`,
          err
        );
      });
    }
    this.finishTransfer(transferId, false);
  }

  private peerHasMaxActiveAcceptsForResource(peerHash: string, fileHash: string): boolean {
    const peerKey = peerHash.trim().toLowerCase();
    const blobId = fileHash.trim().toLowerCase();
    if (!peerKey) return false;
    let activeForPeer = 0;
    for (const transferId of this.activeAccepts) {
      const offer = this.offers.get(transferId);
      if (
        (offer?.sourcePeerHash || '').trim().toLowerCase() === peerKey &&
        (offer?.fileHash || '').trim().toLowerCase() === blobId
      ) {
        activeForPeer += 1;
      }
    }
    return activeForPeer >= RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_PEER;
  }

  private resourceHasMaxActiveAccepts(fileHash: string): boolean {
    const blobId = fileHash.trim().toLowerCase();
    if (!blobId) return false;
    let activeForResource = 0;
    for (const transferId of this.activeAccepts) {
      if (this.offers.get(transferId)?.fileHash.toLowerCase() === blobId) {
        activeForResource += 1;
      }
    }
    return activeForResource >= RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE;
  }

  private hasActiveAcceptsForResource(fileHash: string): boolean {
    const blobId = fileHash.trim().toLowerCase();
    for (const transferId of this.activeAccepts) {
      if (this.offers.get(transferId)?.fileHash.toLowerCase() === blobId) {
        return true;
      }
    }
    return false;
  }

  private hasActiveBulkThrottle(state: ReticulumResourceDownloadState<TRequestWire>): boolean {
    const now = this.now();
    for (const until of state.peerBulkThrottleUntil.values()) {
      if (until > now) return true;
    }
    return false;
  }

  private clearRequestedResourcesForFile(fileHash: string): void {
    const blobId = fileHash.trim().toLowerCase();
    if (!blobId) return;
    for (const key of [...this.requestedResources.keys()]) {
      if (key.includes(blobId)) this.requestedResources.delete(key);
    }
  }

  private cleanupStaleAccepts(): void {
    const now = this.now();
    const staleTransferIds: string[] = [];
    for (const transferId of this.activeAccepts) {
      const startedAt = this.activeAcceptStartedAt.get(transferId) ?? now;
      if (now - startedAt >= RETICULUM_RESOURCE_TRANSFER_ACCEPT_STALE_MS) {
        staleTransferIds.push(transferId);
      }
    }
    for (const transferId of staleTransferIds) {
      loggerWarn(
        `[${this.loggerPrefix}] Resource transfer stale transfer=${transferId}; releasing active slot`
      );
      this.finishTransfer(transferId, false);
    }
  }

  private contextMetadata(contextId: number): Record<string, number> {
    if (!this.contextMetadataKey) return {};
    return { [this.contextMetadataKey]: contextId };
  }

  private cleanupTemporaryOfferFile(offer: ReticulumResourceTransferOffer): void {
    this.cleanupTemporaryPath(offer.temporaryPath);
    this.cleanupTemporaryPath(offer.receiveTemporaryPath);
    delete offer.temporaryPath;
    delete offer.receiveTemporaryPath;
  }

  private cleanupTemporaryPath(filePath: string | undefined): void {
    if (!filePath) return;
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup for temporary transfer files.
    }
  }
}

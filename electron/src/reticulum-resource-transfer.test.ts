import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as nodeCrypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { ReticulumResourceStore, type ReticulumResourceManifest } from './reticulum-resource-store';
import {
  RETICULUM_RESOURCE_TRANSFER_AUTHORIZATION_TIMEOUT_MS,
  RETICULUM_RESOURCE_TRANSFER_OVERLAY_THROTTLE_RETRY_MS,
  RETICULUM_RESOURCE_TRANSFER_QUEUE_TIMEOUT_MS,
  RETICULUM_RESOURCE_TRANSFER_REQUEST_START_TIMEOUT_MS,
  RETICULUM_RESOURCE_TRANSFER_TTL_MS,
  type ReticulumResourceTransferProgress,
  ReticulumResourceTransferManager,
} from './reticulum-resource-transfer';

describe('reticulum resource transfer storage protection', () => {
  const stores: ReticulumResourceStore[] = [];
  const transfers: Array<ReticulumResourceTransferManager<Record<string, never>>> = [];

  afterEach(() => {
    while (transfers.length) transfers.pop()?.close();
    while (stores.length) stores.pop()?.close();
  });

  it('does not touch resource storage after the transfer manager closes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-transfer-test-'));
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
    });
    stores.push(store);
    const transfer = new ReticulumResourceTransferManager<Record<string, never>>({
      resourceStore: store,
      buildRequestPayloads: async () => [],
    });
    transfers.push(transfer);
    const completedBytes = vi.spyOn(store, 'getCompletedBytes');
    const state = {
      contextId: 716,
      manifest: {
        fileHash: 'f'.repeat(64),
        sizeBytes: 128,
      },
      sourcePeerHashes: new Set<string>(),
    };

    transfer.close();
    expect(() => (transfer as any).emitProgress(state)).not.toThrow();
    expect(completedBytes).not.toHaveBeenCalled();
    expect(transfer.getDownloadStatus('f'.repeat(64)).active).toBe(false);
    expect(completedBytes).not.toHaveBeenCalled();
    expect(transfer.addCandidatePeers('f'.repeat(64), ['peer-a'])).toBe(false);
    await expect(transfer.cancelResource('f'.repeat(64))).resolves.toBe(false);
  });

  it('recreates expired leases and reservations when a provider appears later', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-transfer-test-'));
    let now = 100_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
    });
    stores.push(store);
    const contents = Buffer.from('resumed transfer');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:sender',
      fileName: 'resumed.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: nodeCrypto.createHash('sha256').update(contents).digest('hex'),
      encrypted: false,
      createdAt: now,
      metadata: { groupId: 716 },
    };
    const transfer = new ReticulumResourceTransferManager<Record<string, never>>({
      resourceStore: store,
      now: () => now,
      buildRequestPayloads: async () => [],
    });
    transfers.push(transfer);

    transfer.requestResource({ contextId: 716, manifest });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const state = (transfer as any).downloads.get(manifest.fileHash);
    expect(state?.waitingForProvider).toBe(true);
    const oldLeaseId = state.storageLeaseId;
    const oldReservationId = state.storageReservationId;

    now += RETICULUM_RESOURCE_TRANSFER_TTL_MS - 1;
    await (transfer as any).processDownloads();
    now += 2;
    expect(store.getStorageStatus().reservedBytes).toBe(0);
    expect(transfer.addCandidatePeers(manifest.fileHash, ['provider-a'])).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(state.storageLeaseId).not.toBe(oldLeaseId);
    expect(state.storageReservationId).not.toBe(oldReservationId);
    expect(store.getStorageStatus().reservedBytes).toBe(contents.length);
  });

  it('builds the missing-range index once and keeps active ranges pending', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-transfer-test-'));
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
    });
    stores.push(store);
    const sizeBytes = 2 * 1024 * 1024;
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:sender',
      fileName: 'large.bin',
      mimeType: 'application/octet-stream',
      sizeBytes,
      fileHash: 'a'.repeat(64),
      encrypted: false,
      createdAt: Date.now(),
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest, { provenance: 'remote_downloaded' });
    const completedRangeSpy = vi.spyOn(store, 'getCompletedRanges');
    const transfer = new ReticulumResourceTransferManager<Record<string, never>>({
      resourceStore: store,
      buildRequestPayloads: async () => [],
    });
    transfers.push(transfer);

    const state = (transfer as any).upsertDownload(716, manifest, undefined, ['provider-a']);
    expect(completedRangeSpy).toHaveBeenCalledTimes(1);
    const firstRange = state.missingRanges.values().next().value;
    const firstKey = `${firstRange.startByte}:${firstRange.endByteExclusive}`;
    state.inFlightRanges.set(firstKey, { transferId: 'active-transfer', startedAt: Date.now() });

    await (transfer as any).dispatchRequests(state);
    await (transfer as any).dispatchRequests(state);

    expect(completedRangeSpy).toHaveBeenCalledTimes(1);
    expect((transfer as any).downloads.has(manifest.fileHash)).toBe(true);
    expect(state.missingRanges.size).toBe(2);
  });

  it('discards corrupt completed data and retries without reporting completion', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-transfer-test-'));
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
    });
    stores.push(store);
    const expectedContents = Buffer.from('verified attachment');
    const corruptContents = Buffer.from('corrupted attachmen');
    expect(corruptContents.length).toBe(expectedContents.length);
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:sender',
      fileName: 'attachment.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: expectedContents.length,
      fileHash: nodeCrypto.createHash('sha256').update(expectedContents).digest('hex'),
      encrypted: false,
      createdAt: Date.now(),
      metadata: { groupId: 716 },
    };
    store.storeManifest(manifest, { provenance: 'remote_downloaded' });
    store.storeByteRange(
      manifest.fileHash,
      0,
      corruptContents.length,
      corruptContents
    );
    const progressEvents: ReticulumResourceTransferProgress[] = [];
    const transfer = new ReticulumResourceTransferManager<Record<string, never>>({
      resourceStore: store,
      buildRequestPayloads: async () => [],
      onProgress: (progress) => progressEvents.push(progress),
    });
    transfers.push(transfer);

    const state = (transfer as any).upsertDownload(716, manifest, undefined, []);
    expect(state.missingRanges.size).toBe(0);
    (transfer as any).emitProgress(state);
    expect(progressEvents.at(-1)).toEqual(
      expect.objectContaining({
        bytesTransferred: manifest.sizeBytes,
        complete: false,
      })
    );

    await (transfer as any).dispatchRequests(state);

    expect(store.getCompletedRanges(manifest.fileHash)).toEqual([]);
    expect(state.missingRanges.size).toBe(1);
    expect((transfer as any).downloads.get(manifest.fileHash)).toBe(state);
    expect(progressEvents).not.toContainEqual(
      expect.objectContaining({ complete: true })
    );
    expect(progressEvents).toContainEqual(
      expect.objectContaining({
        fileHash: manifest.fileHash,
        bytesTransferred: 0,
        progress: 0,
        complete: false,
        failed: false,
        failureReason: 'verification_failed',
      })
    );
  });

  it('times out a range request that never reaches provider authorization', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-transfer-test-'));
    let now = 100_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
    });
    stores.push(store);
    const cancelReticulumResourceDetailed = vi.fn().mockResolvedValue({ ok: true });
    const transfer = new ReticulumResourceTransferManager<Record<string, never>>({
      bridge: { cancelReticulumResourceDetailed } as any,
      resourceStore: store,
      now: () => now,
      buildRequestPayloads: async () => [],
    });
    transfers.push(transfer);

    const transferId = 'queued-range';
    (transfer as any).offers.set(transferId, {
      transferId,
      contextId: 716,
      fileHash: 'a'.repeat(64),
      totalSizeBytes: 1024,
      sizeBytes: 1024,
      fileName: 'queued.range.bin',
      mimeType: 'application/octet-stream',
      ranges: [{ startByte: 0, endByteExclusive: 1024 }],
      sourcePeerHash: 'b'.repeat(32),
    });
    (transfer as any).activeAccepts.add(transferId);
    (transfer as any).activeAcceptStartedAt.set(transferId, now);
    (transfer as any).transferProgressWatch.set(transferId, {
      lastProgressAt: now,
      lastProgressBytes: 0,
      receivingStarted: false,
    });

    now += RETICULUM_RESOURCE_TRANSFER_REQUEST_START_TIMEOUT_MS - 1;
    (transfer as any).retryNoProgressTransfers();
    expect(cancelReticulumResourceDetailed).not.toHaveBeenCalled();

    now += 2;
    (transfer as any).retryNoProgressTransfers();
    expect(cancelReticulumResourceDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        transferId,
        reason: 'resource_request_start_timeout',
      })
    );
    expect((transfer as any).activeAccepts.has(transferId)).toBe(false);
    expect((transfer as any).offers.has(transferId)).toBe(false);
  });

  it('keeps an authorized request alive through the legacy provider window', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-transfer-test-'));
    let now = 100_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
    });
    stores.push(store);
    const cancelReticulumResourceDetailed = vi.fn().mockResolvedValue({ ok: true });
    const transfer = new ReticulumResourceTransferManager<Record<string, never>>({
      bridge: { cancelReticulumResourceDetailed } as any,
      resourceStore: store,
      now: () => now,
      buildRequestPayloads: async () => [],
    });
    transfers.push(transfer);

    const transferId = 'authorizing-range';
    (transfer as any).offers.set(transferId, {
      transferId,
      contextId: 1144,
      fileHash: 'c'.repeat(64),
      totalSizeBytes: 1762,
      sizeBytes: 1762,
      fileName: 'authorizing.range.bin',
      mimeType: 'application/octet-stream',
      ranges: [{ startByte: 0, endByteExclusive: 1762 }],
      sourcePeerHash: 'd'.repeat(32),
    });
    (transfer as any).activeAccepts.add(transferId);
    (transfer as any).transferProgressWatch.set(transferId, {
      lastProgressAt: now,
      lastProgressBytes: 0,
      receivingStarted: false,
      phase: 'requesting',
    });

    transfer.handleResourceEvent({ status: 'auth_sent', transferId });
    // An older provider may legitimately take up to 30 seconds to reject an
    // authorization stall, so the receiver must not cancel at the old 12s
    // request-start deadline.
    now += 30_001;
    (transfer as any).retryNoProgressTransfers();
    expect(cancelReticulumResourceDetailed).not.toHaveBeenCalled();

    now += RETICULUM_RESOURCE_TRANSFER_AUTHORIZATION_TIMEOUT_MS - 30_000;
    (transfer as any).retryNoProgressTransfers();
    expect(cancelReticulumResourceDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        transferId,
        reason: 'resource_authorization_timeout',
      })
    );
  });

  it('does not treat a bridge-accepted queued range as a request-start failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-transfer-test-'));
    let now = 100_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
    });
    stores.push(store);
    const cancelReticulumResourceDetailed = vi.fn().mockResolvedValue({ ok: true });
    const transfer = new ReticulumResourceTransferManager<Record<string, never>>({
      bridge: { cancelReticulumResourceDetailed } as any,
      resourceStore: store,
      now: () => now,
      buildRequestPayloads: async () => [],
    });
    transfers.push(transfer);

    const transferId = 'queued-range';
    (transfer as any).offers.set(transferId, {
      transferId,
      contextId: 1144,
      fileHash: 'e'.repeat(64),
      totalSizeBytes: 1024,
      sizeBytes: 1024,
      fileName: 'queued.range.bin',
      mimeType: 'application/octet-stream',
      ranges: [{ startByte: 0, endByteExclusive: 1024 }],
      sourcePeerHash: 'f'.repeat(32),
    });
    (transfer as any).activeAccepts.add(transferId);
    (transfer as any).transferProgressWatch.set(transferId, {
      lastProgressAt: now,
      lastProgressBytes: 0,
      receivingStarted: false,
      phase: 'requesting',
    });

    transfer.handleResourceEvent({ status: 'accepted', transferId });
    now += RETICULUM_RESOURCE_TRANSFER_AUTHORIZATION_TIMEOUT_MS + 1;
    (transfer as any).retryNoProgressTransfers();
    expect(cancelReticulumResourceDetailed).not.toHaveBeenCalled();

    now += RETICULUM_RESOURCE_TRANSFER_QUEUE_TIMEOUT_MS
      - RETICULUM_RESOURCE_TRANSFER_AUTHORIZATION_TIMEOUT_MS;
    (transfer as any).retryNoProgressTransfers();
    expect(cancelReticulumResourceDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        transferId,
        reason: 'resource_request_queue_timeout',
      })
    );
  });

  it('temporarily throttles a timed-out provider and moves the range to another provider', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-transfer-test-'));
    let now = 100_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
    });
    stores.push(store);
    const contents = Buffer.from('provider fallback');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:sender',
      fileName: 'fallback.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: nodeCrypto.createHash('sha256').update(contents).digest('hex'),
      encrypted: false,
      createdAt: now,
      metadata: { groupId: 716 },
    };
    const firstPeer = 'a'.repeat(32);
    const secondPeer = 'b'.repeat(32);
    store.storeManifest(manifest, { provenance: 'remote_downloaded' });
    const acceptedPeers: string[] = [];
    const transfer = new ReticulumResourceTransferManager<Record<string, never>>({
      bridge: {
        getLocalDestinationHash: () => 'c'.repeat(32),
        ensureReticulumResourceSessionDetailed: vi.fn(async () => ({
          ok: true,
        })),
        acceptReticulumResourceDetailed: vi.fn(async (payload: {
          peerPresenceHash: string;
        }) => {
          acceptedPeers.push(payload.peerPresenceHash);
          return { ok: true };
        }),
        cancelReticulumResourceDetailed: vi.fn(async () => ({ ok: true })),
      } as any,
      resourceStore: store,
      now: () => now,
      buildRequestPayloads: async () => [{}],
    });
    transfers.push(transfer);

    const state = (transfer as any).upsertDownload(
      716,
      manifest,
      'event-with-image',
      [firstPeer, secondPeer]
    );
    (transfer as any).ensureStorageProtection(state);
    store.ensurePartialFile(manifest.fileHash);
    await (transfer as any).dispatchRequests(state);

    expect(acceptedPeers).toEqual([firstPeer]);
    now += RETICULUM_RESOURCE_TRANSFER_REQUEST_START_TIMEOUT_MS + 1;
    (transfer as any).retryNoProgressTransfers();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(state.peerHashes.has(firstPeer)).toBe(true);
    expect(state.peerBulkThrottleUntil.get(firstPeer)).toBeGreaterThan(now);
    expect(state.peerHashes.has(secondPeer)).toBe(true);
    expect(acceptedPeers).toEqual([firstPeer, secondPeer]);
  });

  it('retries a timed-out range against the same sole provider after backoff', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-transfer-test-'));
    let now = 100_000;
    const store = new ReticulumResourceStore({
      dbPath: path.join(dir, 'resources.db'),
      rootDir: path.join(dir, 'resources'),
      now: () => now,
    });
    stores.push(store);
    const contents = Buffer.from('sole provider retry');
    const manifest: ReticulumResourceManifest = {
      namespace: 'reticulum-group-resource',
      ownerId: '716:sender',
      fileName: 'sole-provider.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: nodeCrypto.createHash('sha256').update(contents).digest('hex'),
      encrypted: false,
      createdAt: now,
      metadata: { groupId: 716 },
    };
    const peer = 'a'.repeat(32);
    store.storeManifest(manifest, { provenance: 'remote_downloaded' });
    const acceptedPeers: string[] = [];
    const transfer = new ReticulumResourceTransferManager<Record<string, never>>({
      bridge: {
        getLocalDestinationHash: () => 'c'.repeat(32),
        ensureReticulumResourceSessionDetailed: vi.fn(async () => ({ ok: true })),
        acceptReticulumResourceDetailed: vi.fn(async (payload: {
          peerPresenceHash: string;
        }) => {
          acceptedPeers.push(payload.peerPresenceHash);
          return { ok: true };
        }),
        cancelReticulumResourceDetailed: vi.fn(async () => ({ ok: true })),
      } as any,
      resourceStore: store,
      now: () => now,
      buildRequestPayloads: async () => [{}],
    });
    transfers.push(transfer);

    const state = (transfer as any).upsertDownload(
      716,
      manifest,
      'event-with-attachment',
      [peer]
    );
    (transfer as any).ensureStorageProtection(state);
    store.ensurePartialFile(manifest.fileHash);
    await (transfer as any).dispatchRequests(state);
    expect(acceptedPeers).toEqual([peer]);

    now += RETICULUM_RESOURCE_TRANSFER_REQUEST_START_TIMEOUT_MS + 1;
    (transfer as any).retryNoProgressTransfers();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(state.peerHashes.has(peer)).toBe(true);
    expect(state.waitingForProvider).toBe(false);
    expect(acceptedPeers).toEqual([peer]);

    now += RETICULUM_RESOURCE_TRANSFER_OVERLAY_THROTTLE_RETRY_MS;
    await (transfer as any).processDownloads();

    expect(acceptedPeers).toEqual([peer, peer]);
    expect(state.peerHashes.has(peer)).toBe(true);
    expect(state.waitingForProvider).toBe(false);
  });
});

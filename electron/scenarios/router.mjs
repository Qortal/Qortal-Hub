/**
 * In-process bridge router for scenarios.
 *
 * Implements the bridge surface `ReticulumChatManager` actually calls and routes
 * wire objects between identities by presence hash. Delivery is deferred to the
 * next tick, as a real bridge is: a synchronous fake would let scenarios pass
 * that the shipping app would fail.
 *
 * Resource transfer is modelled too, because an event *body* never travels as a
 * wire message. Publishing sends an `event_notice_v3`; the recipient requests
 * the event, receives an offer, then fetches the bytes over a resource link.
 * The shape of that handshake is described in `docs/reticulum-chat-sync-architecture.md`.
 *
 * The surface list is not guesswork — spike 1.1 proved each entry is required,
 * and `checkBridgeContract` fails loudly if the manager starts calling something
 * this fake does not provide.
 */

import { EventEmitter } from 'node:events';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * Methods and properties the manager is known to touch on its bridge. Every one
 * of these must exist on a fake or the manager fails somewhere far from here.
 */
export const REQUIRED_BRIDGE_SURFACE = [
  'getState',
  'getLocalDestinationHash',
  'getLocalIdentityPublicKeyBase64',
  'configureReticulumChatPinnedPeers',
  'sendReticulumChatDetailed',
  'sendReticulumChatTargetsDetailed',
  'fanoutReticulumChatDetailed',
  'sendReticulumChatResourceDetailed',
  'acceptReticulumChatResourceDetailed',
  'authorizeReticulumChatResourceDetailed',
  'rejectReticulumChatResourceDetailed',
];

/**
 * @returns {{
 *   register(identity: object): object,
 *   bridgeFor(identity: object): object,
 *   route(peerHash: string, wire: unknown): void,
 *   deliverTo(identity: object, wire: unknown): void,
 *   resources: Map<string, object>,
 *   stats: { sent: number, delivered: number, unknownPeer: number },
 * }}
 */
export function createRouter() {
  /** @type {Map<string, { identity: object, bus: EventEmitter }>} */
  const peers = new Map();
  const resources = new Map();
  const stats = {
    sent: 0,
    delivered: 0,
    unknownPeer: 0,
    resourceOffers: 0,
    resourceReceived: 0,
    historyPageRequests: 0,
  };

  /**
   * Deliver a wire to `target`, attributed to `sender`.
   *
   * The sender argument is not cosmetic. The manager derives the event source
   * peer from it, and a notice attributed to the recipient is discarded with no
   * log and no error — the reason the first version of this router appeared to
   * deliver wires while storing nothing.
   */
  function emitTo(target, wire, sender = target) {
    const entry = peers.get(target.presence);
    if (!entry) return;
    setImmediate(() => {
      entry.bus.emit(
        'reticulum-chat-message',
        wire,
        sender.presence, // sender destination hash
        sender.presence // sender presence hash
      );
    });
  }

  /**
   * Deliver a resource payload to a recipient's bridge, as the real bridge does
   * on `reticulum-chat-resource`.
   */
  function emitResourceTo(identity, payload) {
    const entry = peers.get(identity.presence);
    if (!entry) return;
    setImmediate(() => {
      entry.bus.emit('reticulum-chat-resource', payload);
    });
  }

  function makeBridge(identity) {
    const bus = new EventEmitter();
    bus.selfIdentity = identity;
    bus.getState = () => 'ready';
    bus.getLocalDestinationHash = () => identity.presence;
    bus.getLocalIdentityPublicKeyBase64 = () =>
      Buffer.from(identity.presence, 'hex').toString('base64');
    bus.configureReticulumChatPinnedPeers = async () => true;

    bus.sendReticulumChatDetailed = async (peerHash, wire) => {
      stats.sent += 1;
      const target = peers.get(String(peerHash || '').toLowerCase());
      if (!target) {
        stats.unknownPeer += 1;
        return { ok: false, reason: 'unknown-peer-presence-hash' };
      }
      stats.delivered += 1;
      emitTo(target.identity, wire, identity);
      return { ok: true };
    };

    bus.sendReticulumChatTargetsDetailed = async (peerHashes, wire) => {
      const deliveredPeerHashes = [];
      const failures = [];
      for (const peerHash of peerHashes ?? []) {
        const target = peers.get(String(peerHash || '').toLowerCase());
        if (!target) {
          failures.push({
            peerPresenceHash: peerHash,
            reason: 'unknown-peer-presence-hash',
          });
          continue;
        }
        stats.delivered += 1;
        emitTo(target.identity, wire, identity);
        deliveredPeerHashes.push(peerHash);
      }
      return deliveredPeerHashes.length
        ? { ok: true, deliveredPeerHashes, failures }
        : { ok: false, reason: 'unknown-peer-presence-hash', failures };
    };

    bus.fanoutReticulumChatDetailed = async (wires, exclude = []) => {
      const excluded = new Set(
        (exclude ?? []).map((hash) => String(hash).toLowerCase())
      );
      let delivered = 0;
      for (const [hash, target] of peers) {
        if (hash === identity.presence || excluded.has(hash)) continue;
        for (const wire of wires ?? []) {
          stats.delivered += 1;
          emitTo(target.identity, wire, identity);
        }
        delivered += 1;
      }
      return delivered ? { ok: true } : { ok: false, reason: 'no-route' };
    };

    /**
     * Provider side: register the bytes this identity is offering. The real
     * bridge reads `filePath` when the recipient authorizes the link, so record
     * it and answer `sent` when that happens.
     */
    bus.sendReticulumChatResourceDetailed = async (payload) => {
      const transferId = String(payload?.transferId || '');
      if (!transferId || !payload?.filePath) {
        return { ok: false, reason: 'send-command-failed' };
      }
      resources.set(transferId, {
        transferId,
        from: identity.presence,
        to: String(payload.allowedRecipientAddress || '').toLowerCase(),
        filePath: payload.filePath,
        fileName: payload.fileName,
        size: Number(payload.size) || 0,
        metadata: payload.metadata,
        status: 'offered',
      });
      stats.resourceOffers += 1;
      return { ok: true };
    };

    /**
     * Recipient side: the manager has opened a resource link and named a
     * `savePath`. Copy the bytes there and report `received`, which is what the
     * real bridge emits once the transfer completes.
     *
     * Both sides choose their own random `transferId`, so ids do NOT match
     * across peers. What does match is the content identity: the reader sends
     * `authMessage` describing the event it wants, and the provider registered
     * `metadata.eventId`. Correlate on that, and fall back to the id only when
     * the message carries no identity at all (provider-side authorization).
     */
    bus.acceptReticulumChatResourceDetailed = async (payload) => {
      const transferId = String(payload?.transferId || '');
      const savePath = String(payload?.savePath || '');
      if (!savePath) return { ok: false, reason: 'send-command-failed' };

      const provider = peers.get(
        String(payload?.peerPresenceHash || '').toLowerCase()
      );
      if (!provider) return { ok: false, reason: 'unknown-peer-presence-hash' };

      // A history-page fetch is requester-initiated: the reader opens the link
      // with the signed request in `authMessage`, and only then does the
      // provider register the bytes.
      //
      // The real bridge tells the provider through the provider manager's
      // `authorizeResource`, NOT through a wire message. Emitting a fabricated
      // wire kind here was silently ignored, so the provider never registered
      // anything and every page request failed `unknown-resource`.
      const authType = String(payload?.authMessage?.type || '');
      if (authType === 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST') {
        stats.historyPageRequests += 1;
        const providerManager = managersByPresence.get(
          String(payload?.peerPresenceHash || '').toLowerCase()
        );
        if (providerManager) {
          await providerManager.authorizeResource({
            linkId: `link-${transferId}`,
            transferId,
            peerPresenceHash: identity.presence,
            metadata: payload.metadata,
            auth: payload.authMessage,
          });
        }
      }

      const wantedEventId = String(payload?.authMessage?.eventId || '');
      const wantedGroupId = Number(payload?.authMessage?.groupId);
      const wantedLogicalType = String(
        payload?.metadata?.logicalResourceType || ''
      );

      // The provider serves the page from an async queue, so the registration
      // can land after `authorizeResource` resolves. Poll rather than sampling
      // once — a single check reported `unknown-resource` even though the
      // provider had already logged the page as authorized.
      const findResource = () => {
        const direct = resources.get(transferId);
        if (direct) return direct;
        for (const candidate of resources.values()) {
          if (
            wantedLogicalType &&
            candidate.metadata?.logicalResourceType !== wantedLogicalType
          ) {
            continue;
          }
          if (wantedEventId && candidate.metadata?.eventId !== wantedEventId) {
            continue;
          }
          if (
            Number.isFinite(wantedGroupId) &&
            Number(candidate.metadata?.groupId) !== wantedGroupId
          ) {
            continue;
          }
          return candidate;
        }
        return null;
      };

      let resource = findResource();
      for (let attempt = 0; !resource && attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        resource = findResource();
      }
      if (!resource) {
        return { ok: false, reason: 'unknown-resource' };
      }

      try {
        mkdirSync(dirname(savePath), { recursive: true });
        if (existsSync(resource.filePath)) {
          copyFileSync(resource.filePath, savePath);
        } else {
          // Byte-range resources are assembled by the bridge from a provider;
          // a scenario that registers inline content has no source file.
          writeFileSync(savePath, resource.inlineBody ?? '');
        }
        const size = existsSync(savePath)
          ? readFileSync(savePath).byteLength
          : 0;
        const received = {
          transferId,
          status: 'received',
          path: savePath,
          size,
          fileName: resource.fileName,
          metadata: resource.metadata,
          resourceType: resource.metadata?.resourceType,
          auth: payload?.auth,
        };
        stats.resourceReceived += 1;
        emitResourceTo(identity, received);

        // Tell the provider its transfer completed, so it releases its source.
        setImmediate(() => {
          provider.bus.emit('reticulum-chat-resource', {
            transferId,
            status: 'sent',
            size,
            fileName: resource.fileName,
            metadata: resource.metadata,
            resourceType: resource.metadata?.resourceType,
          });
        });
        return { ok: true };
      } catch (error) {
        emitResourceTo(identity, {
          transferId,
          status: 'failed',
          reason: 'resource-copy-failed',
          metadata: resource.metadata,
        });
        return {
          ok: false,
          reason: 'resource-copy-failed',
          error: String(error),
        };
      }
    };

    bus.authorizeReticulumChatResourceDetailed = async () => ({ ok: true });
    bus.rejectReticulumChatResourceDetailed = async () => ({ ok: true });

    return bus;
  }

  const bridges = new Map();
  /** presence hash -> manager, so auth can be delivered the way the bridge does. */
  const managersByPresence = new Map();

  return {
    resources,
    stats,

    register(identity) {
      const bus = makeBridge(identity);
      bridges.set(identity.presence, bus);
      peers.set(identity.presence, { identity, bus });
      return bus;
    },

    /**
     * Associate a manager with its identity.
     *
     * The real bridge does not tell the provider about a resource over a wire —
     * it calls the provider manager's `authorizeResource`. A fake that only
     * speaks wires can therefore never make a provider register a history page,
     * which is exactly why every page request failed with `unknown-resource`.
     */
    attachManager(identity, manager) {
      managersByPresence.set(identity.presence, manager);
    },

    managerFor(identity) {
      return managersByPresence.get(identity.presence) ?? null;
    },

    bridgeFor(identity) {
      const bus = bridges.get(identity.presence);
      if (!bus) throw new Error(`no bridge registered for ${identity.label}`);
      return bus;
    },

    /** Deliver a wire as if it arrived from the network. */
    deliverTo(identity, wire, senderIdentity) {
      const entry = peers.get(identity.presence);
      if (!entry) throw new Error(`no peer registered for ${identity.label}`);
      const from = senderIdentity ?? identity;
      setImmediate(() => {
        entry.bus.emit(
          'reticulum-chat-message',
          wire,
          from.presence,
          from.presence
        );
      });
    },
  };
}

/**
 * Fail loudly when the manager calls a bridge method the fake lacks. Called by
 * the runner before each scenario so a real-bridge change surfaces here rather
 * than as an unexplained scenario failure.
 */
export function checkBridgeContract(bridge) {
  const missing = REQUIRED_BRIDGE_SURFACE.filter(
    (name) => typeof bridge[name] !== 'function'
  );
  if (missing.length) {
    throw new Error(
      `fake bridge is missing: ${missing.join(', ')}. ` +
        'Update electron/scenarios/router.mjs to match the real bridge.'
    );
  }
  return true;
}

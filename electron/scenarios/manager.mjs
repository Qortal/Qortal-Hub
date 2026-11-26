/**
 * Manager construction and event delivery for scenarios.
 *
 * `makeManager` builds a real `ReticulumChatManager` over the real compiled
 * output with an injected bridge, clock and validators. `deliverEventDirect`
 * hands an already-built event to a manager's receive path without the
 * transport — see design D7.
 */

import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ELECTRON_DIR = new URL('..', import.meta.url).pathname;
const req = createRequire(join(ELECTRON_DIR, 'package.json'));

export const chat = req('./build/src/reticulum-chat.js');
export const dbModule = req('./build/src/reticulum-chat-db.js');
export const Database = req('better-sqlite3');

export const { ReticulumChatManager } = chat;
export const { RETICULUM_CHAT_DEFAULT_CHANNEL_ID } = dbModule;
export const { hashReticulumChatMentionAddress } = dbModule;

/** A temp directory that the runner removes in teardown. */
export function makeWorkDir(label = 'qchat-scenario') {
  return mkdtempSync(join(tmpdir(), `${label}-`));
}

/**
 * @param {object} options
 * @param {object} options.identity
 * @param {object} options.bridge
 * @param {string} options.dbPath
 * @param {boolean} [options.canSign]
 * @param {(groupId: number, address: string) => Promise<boolean>} [options.validateGroupMember]
 * @param {(groupId: number, address: string) => Promise<boolean>} [options.validateGroupAdmin]
 * @param {() => number} [options.now]
 */
export function makeManager(options) {
  const {
    identity,
    bridge,
    dbPath,
    canSign = false,
    validateGroupMember = async () => true,
    validateGroupAdmin = async () => false,
    now = () => Date.now(),
  } = options;

  const manager = new ReticulumChatManager({
    dbPath,
    bridge,
    now,
    validateGroupMember,
    validateGroupAdmin,
    hasGoodOverlayHealth: () => true,
    getVerifiedReticulumPeers: () => [
      { destinationHash: identity.presence, lastSeen: now() },
    ],
    ...(canSign ? { signLocalFields: identity.signLocalFields } : {}),
  });

  // The manager does not expose its identity, and scenarios constantly need to
  // know whose presence hash to announce to. Record it alongside.
  Object.defineProperty(manager, 'scenarioIdentity', {
    value: identity,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(manager, 'scenarioBridge', {
    value: bridge,
    enumerable: false,
    configurable: true,
  });

  return manager;
}

/**
 * Join a group and subscribe, so the manager has a local interest route.
 *
 * `localAddress` is not optional in practice: `eventForRenderer` reads
 * `localGroupAddresses.get(groupId)` to decide whether a post mentions the local
 * user, and that map is only populated from memberships that carry an address.
 * Joining with a bare number leaves it empty, so `directMentionAuthorized` is
 * never set and every mention silently resolves to a generic message.
 */
export function joinGroup(manager, groupId, localAddress) {
  joinGroups(manager, [groupId], localAddress);
}

/**
 * Join several groups in one membership call.
 *
 * `setLocalGroupMemberships` **replaces** the membership set, so joining in a loop
 * leaves only the final group and publishes to the earlier ones fail with "Local
 * user is not a member of this group".
 */
export function joinGroups(manager, groupIds, localAddress) {
  manager.setLocalGroupMemberships(
    groupIds.map((groupId) =>
      localAddress
        ? { groupId, localAddress, isPrivate: false, isAdmin: false }
        : groupId
    )
  );
  for (const groupId of groupIds) manager.subscribeGroup(groupId);
}

/**
 * Make two managers aware of each other's group subscriptions. Without this the
 * publish path finds no next hop: it reports success while delivering nothing.
 */
export function exchangeSubscriptions(a, b) {
  a.announceSubscriptionsToPeer(b.scenarioIdentity.presence);
  b.announceSubscriptionsToPeer(a.scenarioIdentity.presence);
}

/** Resolve once `manager` emits an event matching `predicate`, or time out. */
export function waitForEvent(
  manager,
  predicate = () => true,
  timeoutMs = 4000
) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      manager.off('event', handler);
      resolve(null);
    }, timeoutMs);
    function handler(payload) {
      const event = payload?.event ?? payload;
      if (!predicate(event)) return;
      clearTimeout(timer);
      manager.off('event', handler);
      resolve(event);
    }
    manager.on('event', handler);
  });
}

/** Every event id the manager reports in local history for a channel. */
export function historyIds(
  manager,
  groupId,
  channelId = RETICULUM_CHAT_DEFAULT_CHANNEL_ID
) {
  const history = manager.getHistory(groupId, channelId);
  const list = Array.isArray(history) ? history : (history?.events ?? []);
  return list.map((event) => event.eventId);
}

/**
 * Deliver an event to `manager` as though it had already been fetched over the
 * network, skipping the transport.
 *
 * The event *body* never travels as a wire message: publishing sends an
 * `event_notice_v3`, and the body is fetched as a resource. So there is no wire
 * shape that means "here is an event", and emitting a fabricated one would test
 * nothing. This instead runs the same two steps the resource-accept path runs
 * once it has a verified body (`acceptEvent` then `emitGroupEventIfVisible`),
 * which is exactly the boundary the notification and read-state decisions sit
 * behind.
 *
 * Use this for scenarios that assert on what the reader does with an
 * already-received event. Do NOT use it for a scenario that claims to test
 * delivery; those go through the router so the send and receive paths both run.
 *
 * @returns {Promise<boolean>} whether the event was accepted and stored.
 */
export async function deliverEventDirect(manager, event, senderIdentity) {
  const sender = senderIdentity?.presence ?? '0'.repeat(32);
  const accepted = await manager.acceptEvent(event, false);
  if (accepted) {
    manager.noteEventSourcePeer(event.eventId, sender);
    manager.emitGroupEventIfVisible(event);
  }
  return accepted === true;
}

/**
 * Create a channel in a manager's database.
 *
 * `publishEvent` rejects a post to a non-`general` channel that does not exist
 * ("archived or unknown channel"), which is correct but easy to trip over: the
 * shipping app creates channels from signed metadata events before anyone posts
 * in them. Scenarios that publish to a named channel have to seed it the same way
 * a real group would have it.
 */
export function createChannel(manager, groupId, channelId, options = {}) {
  const db = manager.db;
  if (!db || typeof db.upsertChannel !== 'function') {
    throw new Error('createChannel needs a manager with an attached database');
  }
  const now = options.now ?? Date.now();
  db.upsertChannel({
    groupId,
    channelId,
    name: options.name ?? channelId,
    position: options.position ?? 1,
    archived: false,
    writeMode: 'members',
    readMode: 'members',
    writeModeUpdatedAt: now,
    expiryDurationMs: options.expiryDurationMs ?? 0,
    createdBy: options.createdBy ?? '',
    createdAt: now,
    updatedAt: now,
  });
}

/** Let queued microtasks, timers and event delivery settle. */
export function settle(ms = 150) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

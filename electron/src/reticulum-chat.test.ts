import { describe, expect, it, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as nodeCrypto from 'crypto';
import nacl from 'tweetnacl';
import {
  buildReticulumChatAuthorTreeSnapshot,
  createReticulumPublicGroupActivityState,
  buildReticulumChatSignedFields,
  buildReticulumChatEventRequestSignedFields,
  buildReticulumChatGroupKeyDigestSignedFields,
  buildReticulumChatGroupKeyRequestSignedFields,
  buildReticulumChatGroupKeyResponseSignedFields,
  buildReticulumChatHistoryPageRequestSignedFields,
  buildReticulumMetadataSnapshotRequestSignedFields,
  buildReticulumStateHeadsRequestSignedFields,
  buildReticulumChatResourceAuthSignedFields,
  buildReticulumChatResourceFindSignedFields,
  buildReticulumChatResourceReceiptSignedFields,
  buildReticulumChatResourceRequestSignedFields,
  buildReticulumLandActionSignedFields,
  buildReticulumLandAuthSignedFields,
  buildReticulumLandCallV2SignedFields,
  buildReticulumLandSessionRouteSignedFields,
  buildReticulumLandStateSignedFields,
  buildReticulumDmSignedFields,
  buildReticulumDmNotifyAckSignedFields,
  buildReticulumDmNotifySignedFields,
  buildReticulumDmProbeSignedFields,
  buildReticulumDmRequestSignedFields,
  getReticulumDmResourceFindRejectReason,
  getReticulumLandAuthRejectionReason,
  hashReticulumChatPayload,
  isDisabledRelayCache,
  metadataSnapshotHasConsistentRevisions,
  ReticulumChatManager,
  recordReticulumPublicGroupActivity,
  serializeReticulumChatEvent,
  summarizeReticulumPublicGroupActivity,
  type ReticulumChatEvent,
  type ReticulumChatWire,
  type ReticulumDmEvent,
  validateReticulumDmEventShape,
  validateReticulumChatEventShape,
  verifyReticulumChatEvent,
  verifyReticulumChatResourceReceipt,
  verifyReticulumDmEvent,
  verifyReticulumDmNotify,
  verifyReticulumDmProbe,
  verifyReticulumDmRequest,
  verifyReticulumDmResourceReceipt,
  verifyReticulumMetadataSnapshotRequest,
  verifyReticulumChatReadSyncWire,
  verifyReticulumDirectCallHistoryWire,
  verifyReticulumLandSessionRouteWire,
  verifyReticulumLandCallV2Wire,
  type ReticulumChatManagerOptions,
} from './reticulum-chat';
import {
  base58Decode,
  base58Encode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';
import {
  buildReticulumDiscussionIndex,
  hashReticulumChatMentionAddress,
  hashReticulumChatMetadataEntityState,
  ReticulumChatDatabase,
  ReticulumChatSequenceLeaseBusyError,
  RETICULUM_CHAT_AUTHOR_SEQUENCE_LEASE_TTL_MS,
  RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
  RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS,
  RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
  RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
  RETICULUM_CHAT_RELAY_CACHE_MAX_AGE_MS,
  reticulumChatPayloadHasPrivilegedMention,
  reticulumDmConversationId,
  type ReticulumGroupChannel,
} from './reticulum-chat-db';
import {
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
  byteLengthUtf8JsonWithBridgeSender,
  byteLengthUtf8JsonWithBridgeSenderOnly,
  wireFitsReticulum,
  wireFitsReticulumChat,
} from './reticulum-wire-size';
import {
  ReticulumResourceStore,
  RETICULUM_RESOURCE_RANGE_SIZE,
} from './reticulum-resource-store';
import { verifyCallRequestDetached } from './ed25519-verify-common';
import {
  RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE,
  RETICULUM_RESOURCE_TRANSFER_IN_FLIGHT_STALE_MS,
  RETICULUM_RESOURCE_TRANSFER_MAX_RANGE_ATTEMPTS,
  RETICULUM_RESOURCE_TRANSFER_OVERLAY_THROTTLE_RETRY_MS,
  RETICULUM_RESOURCE_TRANSFER_PULL_THROTTLE_MS,
} from './reticulum-resource-transfer';

const relayCacheIt = isDisabledRelayCache ? it.skip : it;
const relayCacheDisabledIt = isDisabledRelayCache ? it : it.skip;
const TEST_AUTHOR_STREAM_ID = 'f'.repeat(32);

function signedEvent(
  overrides: Partial<ReticulumChatEvent> = {}
): ReticulumChatEvent {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  const encryptedPayload = overrides.encryptedPayload ?? 'ciphertext';
  const event: ReticulumChatEvent = {
    eventId:
      overrides.eventId ?? `event-${Math.random().toString(16).slice(2)}`,
    groupId: overrides.groupId ?? 7,
    channelId: overrides.channelId ?? 'general',
    authorAddress:
      overrides.authorAddress ?? deriveAddressFromPublicKey(publicKey),
    authorPublicKey: overrides.authorPublicKey ?? publicKey,
    authorStreamId: overrides.authorStreamId ?? TEST_AUTHOR_STREAM_ID,
    authorSeq: overrides.authorSeq ?? 1,
    timestamp: overrides.timestamp ?? Date.now(),
    eventType: overrides.eventType ?? 'message',
    ...(overrides.targetEventId
      ? { targetEventId: overrides.targetEventId }
      : {}),
    ...(overrides.replyToEventId
      ? { replyToEventId: overrides.replyToEventId }
      : {}),
    encryptedPayload,
    payloadHash:
      overrides.payloadHash ?? hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: overrides.mentionAddressHashes ?? [],
    ...(overrides.mentionTargets
      ? { mentionTargets: overrides.mentionTargets }
      : {}),
    signature: '',
  };
  const signedBytes = canonicalizeForSigning(
    buildReticulumChatSignedFields(event)
  );
  const sig = nacl.sign.detached(new Uint8Array(signedBytes), kp.secretKey);
  event.signature = overrides.signature ?? base58Encode(sig);
  return event;
}

function signedAuthorEvents(
  events: Array<Partial<ReticulumChatEvent>>
): ReticulumChatEvent[] {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(publicKey);
  return events.map((overrides) => {
    const encryptedPayload = overrides.encryptedPayload ?? 'ciphertext';
    const event: ReticulumChatEvent = {
      eventId:
        overrides.eventId ?? `event-${Math.random().toString(16).slice(2)}`,
      groupId: overrides.groupId ?? 7,
      channelId: overrides.channelId ?? 'general',
      authorAddress,
      authorPublicKey: publicKey,
      authorStreamId: overrides.authorStreamId ?? TEST_AUTHOR_STREAM_ID,
      authorSeq: overrides.authorSeq ?? 1,
      timestamp: overrides.timestamp ?? Date.now(),
      eventType: overrides.eventType ?? 'message',
      ...(overrides.targetEventId
        ? { targetEventId: overrides.targetEventId }
        : {}),
      ...(overrides.replyToEventId
        ? { replyToEventId: overrides.replyToEventId }
        : {}),
      encryptedPayload,
      payloadHash:
        overrides.payloadHash ?? hashReticulumChatPayload(encryptedPayload),
      mentionAddressHashes: overrides.mentionAddressHashes ?? [],
      ...(overrides.mentionTargets
        ? { mentionTargets: overrides.mentionTargets }
        : {}),
      signature: '',
    };
    const sig = nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning(buildReticulumChatSignedFields(event))
      ),
      kp.secretKey
    );
    event.signature = overrides.signature ?? base58Encode(sig);
    return event;
  });
}

function createDmIdentity() {
  const kp = nacl.sign.keyPair();
  const publicKey = base58Encode(kp.publicKey);
  return {
    address: deriveAddressFromPublicKey(publicKey),
    publicKey,
    secretKey: kp.secretKey,
  };
}

function createLandAuthSigner() {
  const identity = createDmIdentity();
  const landKeyPair = nacl.sign.keyPair();
  const landPublicKey = base58Encode(landKeyPair.publicKey);
  const signLocalFields: NonNullable<
    ReticulumChatManagerOptions['signLocalFields']
  > = async (fields) => {
    const fullFields = {
      ...fields,
      authorAddress: identity.address,
      authorPublicKey: identity.publicKey,
    };
    const signature = nacl.sign.detached(
      new Uint8Array(canonicalizeForSigning(fullFields)),
      identity.secretKey
    );
    return {
      authorAddress: identity.address,
      authorPublicKey: identity.publicKey,
      signature: base58Encode(signature),
    };
  };
  const landAuthWire = (
    groupId: number,
    sessionId: string,
    timestamp: number
  ) => {
    const fields = buildReticulumLandAuthSignedFields({
      groupId,
      authorAddress: identity.address,
      authorPublicKey: identity.publicKey,
      ephemeralPublicKey: landPublicKey,
      sessionId,
      timestamp,
    });
    const signature = nacl.sign.detached(
      new Uint8Array(canonicalizeForSigning(fields)),
      identity.secretKey
    );
    return {
      t: 'RCHAT' as const,
      k: 'land_auth' as const,
      g: groupId,
      s: sessionId,
      n: timestamp,
      p: identity.publicKey,
      e: landPublicKey,
      z: base58Encode(signature),
    };
  };
  const landRouteWire = (
    groupId: number,
    sessionId: string,
    destinationHash: string,
    timestamp: number,
    expiresAt = timestamp + 120_000
  ) => {
    const fields = buildReticulumLandSessionRouteSignedFields({
      groupId,
      authorAddress: identity.address,
      authorPublicKey: identity.publicKey,
      sessionId,
      destinationHash,
      timestamp,
      expiresAt,
    });
    const signature = nacl.sign.detached(
      new Uint8Array(canonicalizeForSigning(fields)),
      identity.secretKey
    );
    return {
      t: 'RCHAT' as const,
      k: 'land_route_v1' as const,
      g: groupId,
      s: sessionId,
      d: destinationHash,
      n: timestamp,
      e: expiresAt,
      p: identity.publicKey,
      z: base58Encode(signature),
    };
  };
  const landStateWire = (input: {
    groupId: number;
    sessionId: string;
    sequence: number;
    x: number;
    y: number;
    roomId?: string;
    direction?: string;
    movement?: string;
    afk?: boolean;
    dnd?: boolean;
    voiceEnabled?: boolean;
    voiceMuted?: boolean;
    skinId?: number;
    timestamp: number;
  }) => {
    const afk = input.afk === true;
    const dnd = input.dnd === true;
    const voiceEnabled = input.voiceEnabled === true;
    const voiceMuted = voiceEnabled && input.voiceMuted === true;
    const skinId = input.skinId ?? 1;
    const fields = buildReticulumLandStateSignedFields({
      groupId: input.groupId,
      authorAddress: identity.address,
      sessionId: input.sessionId,
      sequence: input.sequence,
      x: input.x,
      y: input.y,
      roomId: input.roomId ?? '',
      direction: input.direction ?? '',
      movement: input.movement ?? '',
      afk,
      dnd,
      ...(voiceEnabled || voiceMuted ? { voiceEnabled, voiceMuted } : {}),
      skinId,
      timestamp: input.timestamp,
    });
    const signature = nacl.sign.detached(
      new Uint8Array(canonicalizeForSigning(fields)),
      landKeyPair.secretKey
    );
    return {
      t: 'RCHAT' as const,
      k: 'land_state' as const,
      g: input.groupId,
      a: identity.address,
      s: input.sessionId,
      q: input.sequence,
      x: input.x,
      y: input.y,
      ...(input.roomId ? { u: input.roomId } : {}),
      ...(input.direction ? { d: input.direction } : {}),
      ...(input.movement ? { m: input.movement } : {}),
      ...(afk || dnd || voiceEnabled || voiceMuted
        ? {
            v:
              (afk ? 1 : 0) |
              (dnd ? 2 : 0) |
              (voiceEnabled ? 4 : 0) |
              (voiceMuted ? 8 : 0),
          }
        : {}),
      i: skinId,
      ts: input.timestamp,
      z: base58Encode(signature),
    };
  };
  const landActionWire = (input: {
    groupId: number;
    actionId: string;
    actionType: string;
    sourceSessionId: string;
    sequence: number;
    toAddress: string;
    targetSessionId: string;
    amount?: number;
    roomId?: string;
    timestamp: number;
  }) => {
    const amount = input.amount ?? 0;
    const fields = buildReticulumLandActionSignedFields({
      groupId: input.groupId,
      actionId: input.actionId,
      actionType: input.actionType,
      fromAddress: identity.address,
      sourceSessionId: input.sourceSessionId,
      sequence: input.sequence,
      toAddress: input.toAddress,
      targetSessionId: input.targetSessionId,
      amount,
      roomId: '',
      timestamp: input.timestamp,
    });
    const signature = nacl.sign.detached(
      new Uint8Array(canonicalizeForSigning(fields)),
      landKeyPair.secretKey
    );
    return {
      t: 'RCHAT' as const,
      k: 'la' as const,
      g: input.groupId,
      id: input.actionId,
      y:
        (
          {
            qort_received: 'q',
            buzz: 'b',
            love: 'l',
            devil: 'd',
            angel: 'a',
            rain: 'r',
            sunshine: 's',
          } as Record<string, string>
        )[input.actionType] ?? '',
      a: identity.address,
      f: input.sourceSessionId,
      q: input.sequence,
      s: input.targetSessionId,
      ...(amount > 0 ? { amt: amount } : {}),
      ts: input.timestamp,
      z: base58Encode(signature),
    };
  };
  return {
    ...identity,
    signLocalFields,
    landAuthWire,
    landRouteWire,
    landActionWire,
    landStateWire,
  };
}

function createDmSigner(
  identity: ReturnType<typeof createDmIdentity>
): NonNullable<ReticulumChatManagerOptions['signLocalFields']> {
  return async (fields) => {
    const fullFields = {
      ...fields,
      authorAddress: identity.address,
      authorPublicKey: identity.publicKey,
    };
    let signedFields: Record<string, unknown> = fullFields;
    if (
      fullFields.type === 'RCHAT_DM_REQ' &&
      typeof fullFields.peerAddress === 'string' &&
      typeof fullFields.after === 'number' &&
      typeof fullFields.limit === 'number' &&
      typeof fullFields.requesterPeerHash === 'string' &&
      typeof fullFields.requestId === 'string' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumDmRequestSignedFields({
        peerAddress: fullFields.peerAddress,
        after: fullFields.after,
        limit: fullFields.limit,
        requesterPeerHash: fullFields.requesterPeerHash,
        requestId: fullFields.requestId,
        authorAddress: identity.address,
        authorPublicKey: identity.publicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_DM_NOTIFY' &&
      typeof fullFields.peerAddress === 'string' &&
      typeof fullFields.sourcePeerHash === 'string' &&
      typeof fullFields.requestId === 'string' &&
      typeof fullFields.maxHops === 'number' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumDmNotifySignedFields({
        peerAddress: fullFields.peerAddress,
        sourcePeerHash: fullFields.sourcePeerHash,
        requestId: fullFields.requestId,
        latestCursor:
          typeof fullFields.latestCursor === 'string'
            ? fullFields.latestCursor
            : undefined,
        probeRequestId:
          typeof fullFields.probeRequestId === 'string'
            ? fullFields.probeRequestId
            : undefined,
        maxHops: fullFields.maxHops,
        authorAddress: identity.address,
        authorPublicKey: identity.publicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_DM_PROBE' &&
      typeof fullFields.requestId === 'string' &&
      typeof fullFields.maxHops === 'number' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumDmProbeSignedFields({
        requestId: fullFields.requestId,
        maxHops: fullFields.maxHops,
        authorAddress: identity.address,
        authorPublicKey: identity.publicKey,
        timestamp: fullFields.timestamp,
      });
    }
    return {
      authorAddress: identity.address,
      authorPublicKey: identity.publicKey,
      signature: base58Encode(
        nacl.sign.detached(
          new Uint8Array(canonicalizeForSigning(signedFields)),
          identity.secretKey
        )
      ),
    };
  };
}

function signedDmEvent(params: {
  sender: ReturnType<typeof createDmIdentity>;
  recipient: ReturnType<typeof createDmIdentity>;
  eventId: string;
  senderStreamId?: string;
  senderSeq: number;
  timestamp: number;
  payload?: string;
}): ReticulumDmEvent {
  const payload = params.payload ?? `message-${params.senderSeq}`;
  const event: ReticulumDmEvent = {
    eventId: params.eventId,
    conversationId: reticulumDmConversationId(
      params.sender.address,
      params.recipient.address
    ),
    senderAddress: params.sender.address,
    recipientAddress: params.recipient.address,
    senderPublicKey: params.sender.publicKey,
    ...(params.senderStreamId ? { senderStreamId: params.senderStreamId } : {}),
    senderSeq: params.senderSeq,
    timestamp: params.timestamp,
    eventType: 'message',
    payload,
    payloadHash: hashReticulumChatPayload(payload),
    signature: '',
  };
  event.signature = base58Encode(
    nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning(buildReticulumDmSignedFields(event))
      ),
      params.sender.secretKey
    )
  );
  if (event.senderStreamId) {
    const legacyEvent = { ...event, senderStreamId: undefined };
    event.legacySignature = base58Encode(
      nacl.sign.detached(
        new Uint8Array(
          canonicalizeForSigning(buildReticulumDmSignedFields(legacyEvent))
        ),
        params.sender.secretKey
      )
    );
  }
  return event;
}

function createReticulumChatTestSigner(): NonNullable<
  ReticulumChatManagerOptions['signLocalFields']
> {
  const kp = nacl.sign.keyPair();
  const authorPublicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
  return async (fields) => {
    const fullFields = {
      ...fields,
      authorAddress,
      authorPublicKey,
    };
    let signedFields = fullFields;
    if (
      fullFields.type === 'RCHAT_EVENT_REQ' &&
      typeof fullFields.groupId === 'number' &&
      typeof fullFields.eventId === 'string' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumChatEventRequestSignedFields({
        groupId: fullFields.groupId,
        eventId: fullFields.eventId,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_RESOURCE_REQ' &&
      typeof fullFields.groupId === 'number' &&
      typeof fullFields.fileHash === 'string' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumChatResourceRequestSignedFields({
        groupId: fullFields.groupId,
        eventId:
          typeof fullFields.eventId === 'string'
            ? fullFields.eventId
            : undefined,
        fileHash: fullFields.fileHash,
        byteRanges: Array.isArray(fullFields.byteRanges)
          ? (fullFields.byteRanges.filter(
              (range): range is [number, number] =>
                Array.isArray(range) &&
                range.length === 2 &&
                Number.isInteger(range[0]) &&
                Number.isInteger(range[1])
            ) as Array<[number, number]>)
          : undefined,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_HISTORY_PAGE_REQ' &&
      typeof fullFields.groupId === 'number' &&
      typeof fullFields.channelId === 'string' &&
      (fullFields.direction === 'after' || fullFields.direction === 'before') &&
      typeof fullFields.limit === 'number' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumChatHistoryPageRequestSignedFields({
        groupId: fullFields.groupId,
        channelId: fullFields.channelId,
        direction: fullFields.direction,
        priority: fullFields.priority === 'metadata' ? 'metadata' : undefined,
        after:
          fullFields.after && typeof fullFields.after === 'object'
            ? (fullFields.after as any)
            : undefined,
        before:
          fullFields.before && typeof fullFields.before === 'object'
            ? (fullFields.before as any)
            : undefined,
        includeCursor: fullFields.includeCursor === true,
        limit: fullFields.limit,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_METADATA_SNAPSHOT_REQ' &&
      typeof fullFields.groupId === 'number' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumMetadataSnapshotRequestSignedFields({
        groupId: fullFields.groupId,
        snapshotHash:
          typeof fullFields.snapshotHash === 'string'
            ? fullFields.snapshotHash
            : undefined,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_STATE_HEADS_REQ' &&
      typeof fullFields.groupId === 'number' &&
      typeof fullFields.cursor === 'string' &&
      typeof fullFields.limit === 'number' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumStateHeadsRequestSignedFields({
        groupId: fullFields.groupId,
        cursor: fullFields.cursor,
        limit: fullFields.limit,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_RESOURCE_AUTH' &&
      typeof fullFields.groupId === 'number' &&
      typeof fullFields.transferId === 'string' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumChatResourceAuthSignedFields({
        groupId: fullFields.groupId,
        transferId: fullFields.transferId,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_GROUP_KEY_DIGEST' &&
      typeof fullFields.groupId === 'number' &&
      typeof fullFields.epoch === 'number' &&
      typeof fullFields.keyId === 'string' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumChatGroupKeyDigestSignedFields({
        groupId: fullFields.groupId,
        epoch: fullFields.epoch,
        keyId: fullFields.keyId,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_GROUP_KEY_REQ' &&
      typeof fullFields.groupId === 'number' &&
      typeof fullFields.epoch === 'number' &&
      typeof fullFields.keyId === 'string' &&
      typeof fullFields.requestId === 'string' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumChatGroupKeyRequestSignedFields({
        groupId: fullFields.groupId,
        epoch: fullFields.epoch,
        keyId: fullFields.keyId,
        requestId: fullFields.requestId,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_GROUP_KEY_RES' &&
      typeof fullFields.groupId === 'number' &&
      typeof fullFields.epoch === 'number' &&
      typeof fullFields.keyId === 'string' &&
      typeof fullFields.keyBytesBase64 === 'string' &&
      typeof fullFields.requestId === 'string' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumChatGroupKeyResponseSignedFields({
        groupId: fullFields.groupId,
        epoch: fullFields.epoch,
        keyId: fullFields.keyId,
        keyBytesBase64: fullFields.keyBytesBase64,
        requestId: fullFields.requestId,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_RESOURCE_FIND' &&
      typeof fullFields.groupId === 'number' &&
      typeof fullFields.requestId === 'string' &&
      typeof fullFields.fileHash === 'string' &&
      typeof fullFields.sizeBytes === 'number' &&
      typeof fullFields.maxHops === 'number' &&
      typeof fullFields.expiresAt === 'number' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumChatResourceFindSignedFields({
        groupId: fullFields.groupId,
        requestId: fullFields.requestId,
        fileHash: fullFields.fileHash,
        sizeBytes: fullFields.sizeBytes,
        maxHops: fullFields.maxHops,
        expiresAt: fullFields.expiresAt,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_DM_NOTIFY' &&
      typeof fullFields.peerAddress === 'string' &&
      typeof fullFields.sourcePeerHash === 'string' &&
      typeof fullFields.requestId === 'string' &&
      typeof fullFields.maxHops === 'number' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumDmNotifySignedFields({
        peerAddress: fullFields.peerAddress,
        sourcePeerHash: fullFields.sourcePeerHash,
        requestId: fullFields.requestId,
        latestCursor:
          typeof fullFields.latestCursor === 'string'
            ? fullFields.latestCursor
            : undefined,
        probeRequestId:
          typeof fullFields.probeRequestId === 'string'
            ? fullFields.probeRequestId
            : undefined,
        maxHops: fullFields.maxHops,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_DM_PROBE' &&
      typeof fullFields.requestId === 'string' &&
      typeof fullFields.maxHops === 'number' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumDmProbeSignedFields({
        requestId: fullFields.requestId,
        maxHops: fullFields.maxHops,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    } else if (
      fullFields.type === 'RCHAT_DM_REQ' &&
      typeof fullFields.peerAddress === 'string' &&
      typeof fullFields.after === 'number' &&
      typeof fullFields.limit === 'number' &&
      typeof fullFields.requesterPeerHash === 'string' &&
      typeof fullFields.requestId === 'string' &&
      typeof fullFields.timestamp === 'number'
    ) {
      signedFields = buildReticulumDmRequestSignedFields({
        peerAddress: fullFields.peerAddress,
        after: fullFields.after,
        limit: fullFields.limit,
        requesterPeerHash: fullFields.requesterPeerHash,
        requestId: fullFields.requestId,
        authorAddress,
        authorPublicKey,
        timestamp: fullFields.timestamp,
      });
    }
    const signature = nacl.sign.detached(
      new Uint8Array(canonicalizeForSigning(signedFields)),
      kp.secretKey
    );
    return {
      authorAddress,
      authorPublicKey,
      signature: base58Encode(signature),
    };
  };
}

function signedEventRequestWire(params: {
  groupId: number;
  eventId: string;
  timestamp: number;
}): {
  id: string;
  a: string;
  pk: string;
  ts: number;
  sig: string;
} {
  const kp = nacl.sign.keyPair();
  const authorPublicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
  const fields = buildReticulumChatEventRequestSignedFields({
    groupId: params.groupId,
    eventId: params.eventId,
    authorAddress,
    authorPublicKey,
    timestamp: params.timestamp,
  });
  return {
    id: params.eventId,
    a: authorAddress,
    pk: authorPublicKey,
    ts: params.timestamp,
    sig: base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(fields)),
        kp.secretKey
      )
    ),
  };
}

function signedResourceRequestWire(params: {
  groupId: number;
  eventId?: string;
  fileHash: string;
  byteRanges: Array<[number, number]>;
  timestamp: number;
}): {
  fh: string;
  eid?: string;
  b: Array<[number, number]>;
  pk: string;
  ts: number;
  sig: string;
} {
  const kp = nacl.sign.keyPair();
  const authorPublicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
  const ranges = [...params.byteRanges].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1]
  );
  const fields = buildReticulumChatResourceRequestSignedFields({
    groupId: params.groupId,
    eventId: params.eventId,
    fileHash: params.fileHash,
    byteRanges: ranges,
    authorAddress,
    authorPublicKey,
    timestamp: params.timestamp,
  });
  return {
    fh: params.fileHash,
    ...(params.eventId ? { eid: params.eventId } : {}),
    b: ranges,
    pk: authorPublicKey,
    ts: params.timestamp,
    sig: base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(fields)),
        kp.secretKey
      )
    ),
  };
}

function signedHistoryPageRequestWire(params: {
  groupId: number;
  channelId: string;
  direction: 'after' | 'before';
  priority?: 'metadata';
  cursor?: { id: string; ts: number };
  includeCursor?: boolean;
  limit: number;
  timestamp: number;
}): {
  c: string;
  d: 'after' | 'before';
  p?: 'm';
  after?: { id: string; ts: number };
  before?: { id: string; ts: number };
  inc?: 1;
  limit: number;
  a: string;
  pk: string;
  ts: number;
  sig: string;
} {
  const kp = nacl.sign.keyPair();
  const authorPublicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
  const fields = buildReticulumChatHistoryPageRequestSignedFields({
    groupId: params.groupId,
    channelId: params.channelId,
    direction: params.direction,
    priority: params.priority,
    after: params.direction === 'after' ? params.cursor : undefined,
    before: params.direction === 'before' ? params.cursor : undefined,
    includeCursor: params.includeCursor === true,
    limit: params.limit,
    authorAddress,
    authorPublicKey,
    timestamp: params.timestamp,
  });
  return {
    c: params.channelId,
    d: params.direction,
    ...(params.priority === 'metadata' ? { p: 'm' as const } : {}),
    ...(params.direction === 'after' && params.cursor
      ? { after: params.cursor }
      : {}),
    ...(params.direction === 'before' && params.cursor
      ? { before: params.cursor }
      : {}),
    ...(params.includeCursor ? { inc: 1 as const } : {}),
    limit: params.limit,
    a: authorAddress,
    pk: authorPublicKey,
    ts: params.timestamp,
    sig: base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(fields)),
        kp.secretKey
      )
    ),
  };
}

function signedResourceFindWire(params: {
  groupId: number;
  requestId: string;
  fileHash: string;
  sizeBytes: number;
  hop: number;
  maxHops: number;
  expiresAt: number;
  timestamp: number;
}): Extract<ReticulumChatWire, { k: 'rf' }> {
  const kp = nacl.sign.keyPair();
  const authorPublicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
  const fields = buildReticulumChatResourceFindSignedFields({
    groupId: params.groupId,
    requestId: params.requestId,
    fileHash: params.fileHash,
    sizeBytes: params.sizeBytes,
    maxHops: params.maxHops,
    expiresAt: params.expiresAt,
    authorAddress,
    authorPublicKey,
    timestamp: params.timestamp,
  });
  const wire: Extract<ReticulumChatWire, { k: 'rf' }> = {
    t: 'RCHAT',
    k: 'rf',
    g: params.groupId,
    q: params.requestId,
    f: params.fileHash,
    s: params.sizeBytes,
    x: params.expiresAt,
    p: authorPublicKey,
    n: params.timestamp,
    z: base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(fields)),
        kp.secretKey
      )
    ),
  };
  if (params.hop > 0) wire.h = params.hop;
  if (params.maxHops !== 5) wire.m = params.maxHops;
  return wire;
}

function signedDmNotifyWire(params: {
  addressB: string;
  sourcePeerHash: string;
  requestId: string;
  probeRequestId?: string;
  timestamp: number;
}) {
  const kp = nacl.sign.keyPair();
  const authorPublicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
  const fields = buildReticulumDmNotifySignedFields({
    peerAddress: params.addressB,
    sourcePeerHash: params.sourcePeerHash,
    requestId: params.requestId,
    probeRequestId: params.probeRequestId,
    maxHops: 5,
    authorAddress,
    authorPublicKey,
    timestamp: params.timestamp,
  });
  return {
    b: params.addressB,
    sp: params.sourcePeerHash,
    q: params.requestId,
    ...(params.probeRequestId ? { r: params.probeRequestId } : {}),
    p: authorPublicKey,
    n: params.timestamp,
    z: base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(fields)),
        kp.secretKey
      )
    ),
  };
}

function signedDmProbeWire(params: { requestId: string; timestamp: number }) {
  const kp = nacl.sign.keyPair();
  const authorPublicKey = base58Encode(kp.publicKey);
  const requesterAddress = deriveAddressFromPublicKey(authorPublicKey);
  const fields = buildReticulumDmProbeSignedFields({
    requestId: params.requestId,
    maxHops: 5,
    authorAddress: requesterAddress,
    authorPublicKey,
    timestamp: params.timestamp,
  });
  return {
    q: params.requestId,
    p: authorPublicKey,
    n: params.timestamp,
    z: base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(fields)),
        kp.secretKey
      )
    ),
  };
}

function signedDmRequestWire(params: {
  addressB: string;
  after: number;
  limit: number;
  requesterPeerHash: string;
  requestId: string;
  timestamp: number;
}) {
  const kp = nacl.sign.keyPair();
  const authorPublicKey = base58Encode(kp.publicKey);
  const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
  const fields = buildReticulumDmRequestSignedFields({
    peerAddress: params.addressB,
    after: params.after,
    limit: params.limit,
    requesterPeerHash: params.requesterPeerHash,
    requestId: params.requestId,
    authorAddress,
    authorPublicKey,
    timestamp: params.timestamp,
  });
  return {
    b: params.addressB,
    after: params.after,
    limit: params.limit,
    q: params.requestId,
    rp: params.requesterPeerHash,
    p: authorPublicKey,
    n: params.timestamp,
    z: base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(fields)),
        kp.secretKey
      )
    ),
  };
}

function upsertTestChannel(
  manager: ReticulumChatManager,
  input: {
    groupId: number;
    channelId: string;
    writeMode?: 'members' | 'admins';
    readMode?: 'members' | 'admins';
    categoryId?: string;
  }
): void {
  (manager as any).db.upsertChannel({
    groupId: input.groupId,
    channelId: input.channelId,
    name: input.channelId,
    position: input.channelId === 'general' ? 0 : 1,
    archived: false,
    writeMode: input.writeMode ?? 'members',
    readMode: input.readMode ?? 'members',
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    createdBy: 'Qcreator',
    createdAt: 10_000,
    updatedAt: 10_000,
  });
}

function upsertTestCategory(
  manager: ReticulumChatManager,
  input: {
    groupId: number;
    categoryId: string;
    name?: string;
    position?: number;
  }
): void {
  (manager as any).db.upsertCategory({
    groupId: input.groupId,
    categoryId: input.categoryId,
    name: input.name ?? input.categoryId,
    position: input.position ?? 0,
    createdBy: 'Qcreator',
    createdAt: 10_000,
    updatedAt: 10_000,
  });
}

function tempDbPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-chat-test-')),
    'reticulum-chat.db'
  );
}

async function flushAsyncWork(ticks = 8): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
  }
}

async function flushQueuedWork(ticks = 8): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('reticulum chat protocol', () => {
  it('rejects DM participants that are names rather than Qortal addresses', () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const event = signedDmEvent({
      sender,
      recipient,
      eventId: 'dm-invalid-recipient-name',
      senderSeq: 1,
      timestamp: Date.now(),
    });
    const malformed = {
      ...event,
      recipientAddress: 'Qortal Justin',
      conversationId: reticulumDmConversationId(
        event.senderAddress,
        'Qortal Justin'
      ),
    };

    expect(validateReticulumDmEventShape(event)).toBe(true);
    expect(validateReticulumDmEventShape(malformed)).toBe(false);
  });

  it('accepts a correctly signed self-DM with the canonical conversation id', () => {
    const owner = createDmIdentity();
    const event = signedDmEvent({
      sender: owner,
      recipient: owner,
      eventId: 'dm-self-valid-event',
      senderSeq: 1,
      timestamp: Date.now(),
    });

    expect(event.senderAddress).toBe(event.recipientAddress);
    expect(validateReticulumDmEventShape(event)).toBe(true);
    expect(verifyReticulumDmEvent(event)).toBe(true);
  });

  it('stores self-DMs as sent and only notifies upgraded verified own devices', async () => {
    const owner = createDmIdentity();
    const localPeerHash = '1'.repeat(32);
    const upgradedPeerHash = '2'.repeat(32);
    const legacyPeerHash = '3'.repeat(32);
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const pinned: Array<
      Array<{
        accountAddress: string;
        destinationHash: string;
        expiresAt: number;
      }>
    > = [];
    const bridge = Object.assign(new EventEmitter(), {
      getState: () => 'ready',
      getLocalDestinationHash: () => localPeerHash,
      configureReticulumChatPinnedPeers: async (
        peers: Array<{
          accountAddress: string;
          destinationHash: string;
          expiresAt: number;
        }>
      ) => {
        pinned.push(peers);
        return true;
      },
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        sent.push({ peer, wire });
        return { ok: true as const };
      },
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      signLocalFields: createDmSigner(owner),
      hasGoodOverlayHealth: () => false,
      getAccountEndpointLeases: () => [
        {
          destinationHash: upgradedPeerHash,
          address: owner.address,
          sessionId: 'upgraded',
          lastSeen: Date.now(),
          expiresAt: Date.now() + 60_000,
          verification: 'direct-bound',
        },
        {
          destinationHash: legacyPeerHash,
          address: owner.address,
          sessionId: 'legacy',
          lastSeen: Date.now(),
          expiresAt: Date.now() + 60_000,
          verification: 'direct-bound',
        },
      ],
    });
    manager.setLocalDmAddresses([owner.address]);
    (manager as any).peerProtocolFeatures.set(
      upgradedPeerHash,
      new Set(['dm', 'dm_author_streams_v1', 'self_dm_v1'])
    );
    (manager as any).peerProtocolFeatures.set(
      legacyPeerHash,
      new Set(['dm', 'dm_author_streams_v1'])
    );
    manager.refreshSelfDmWarmLinks();
    await flushQueuedWork();
    expect(pinned.at(-1)?.map((peer) => peer.accountAddress)).toEqual([
      owner.address,
    ]);
    expect(pinned.at(-1)?.map((peer) => peer.destinationHash)).toEqual([
      upgradedPeerHash,
    ]);
    sent.length = 0;
    const event = signedDmEvent({
      sender: owner,
      recipient: owner,
      eventId: 'dm-self-publish-event',
      senderSeq: 2,
      timestamp: Date.now(),
    });

    expect(await manager.publishDirectEvent(event)).toEqual({ ok: true });
    await flushQueuedWork();

    expect((manager as any).db.getDirectEvent(event.eventId)).toMatchObject({
      localDeliveryStatus: 'sent',
    });
    expect(
      manager.getDirectSummaries(owner.address, owner.address)[0]
    ).toMatchObject({
      peerAddress: owner.address,
      unreadCount: 0,
    });
    expect(
      sent
        .filter((item) => item.wire.k === 'dm_notify')
        .map((item) => item.peer)
    ).toEqual([upgradedPeerHash]);
    await (manager as any).broadcastSelfDmNotifications();
    await (manager as any).broadcastSelfDmNotifications();
    expect(sent.filter((item) => item.wire.k === 'dm_notify')).toHaveLength(1);

    const foreignPeerHash = '4'.repeat(32);
    (manager as any).peerProtocolFeatures.set(
      foreignPeerHash,
      new Set(['dm', 'self_dm_v1'])
    );
    const remoteEvent = signedDmEvent({
      sender: owner,
      recipient: owner,
      eventId: 'dm-self-remote-event',
      senderSeq: 3,
      timestamp: Date.now() + 1,
    });
    manager.handleWire(
      { t: 'RCHAT', k: 'dm_event', e: remoteEvent },
      foreignPeerHash
    );
    expect((manager as any).db.getDirectEvent(remoteEvent.eventId)).toBeNull();
    manager.handleWire(
      { t: 'RCHAT', k: 'dm_event', e: remoteEvent },
      upgradedPeerHash
    );
    expect(
      (manager as any).db.getDirectEvent(remoteEvent.eventId)
    ).toMatchObject({ localDeliveryStatus: 'received' });
    expect(
      manager.getDirectSummaries(owner.address, owner.address)[0]
    ).toMatchObject({ unreadCount: 0 });
    manager.setLocalDmAddresses([]);
    await flushQueuedWork();
    expect(pinned.at(-1)).toEqual([]);
    manager.close();
  });

  it('privately synchronizes a DM read watermark between verified devices and keeps late history read', async () => {
    const owner = createDmIdentity();
    const peer = createDmIdentity();
    const deviceAHash = '1'.repeat(32);
    const deviceBHash = '2'.repeat(32);
    let captured: Extract<ReticulumChatWire, { k: 'read_sync' }> | null = null;
    let readSyncSendCount = 0;
    const deviceA = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(owner),
      hasGoodOverlayHealth: () => false,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: deviceBHash,
          address: owner.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => deviceAHash,
        sendReticulumChatDetailed: async (
          _target: string,
          wire: ReticulumChatWire
        ) => {
          if (wire.k === 'read_sync') {
            captured = wire;
            readSyncSendCount += 1;
          }
          return { ok: true as const };
        },
      } as any,
    });
    const deviceB = new ReticulumChatManager({
      dbPath: tempDbPath(),
      hasGoodOverlayHealth: () => false,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: deviceAHash,
          address: owner.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => deviceBHash,
      } as any,
    });
    try {
      deviceA.setLocalDmAddresses([owner.address]);
      deviceB.setLocalDmAddresses([owner.address]);
      const first = signedDmEvent({
        sender: peer,
        recipient: owner,
        eventId: 'read-sync-first',
        senderStreamId: 'a'.repeat(32),
        senderSeq: 1,
        timestamp: Date.now() - 1_000,
      });
      expect((deviceB as any).acceptDirectEvent(first, false)).toBe(true);
      expect(deviceB.getDirectSummaries(owner.address)[0]?.unreadCount).toBe(1);

      deviceA.markDirectRead(owner.address, peer.address, first.timestamp);
      await flushQueuedWork();
      expect(captured).not.toBeNull();
      // `r` belongs to the Python bridge and is replaced by the authenticated
      // hop sender. Application read data must remain under `w`, and the DM
      // conversation id is derived from the two signed account addresses.
      expect(captured).not.toHaveProperty('r');
      expect(captured!.w).not.toHaveProperty('c');
      expect(wireFitsReticulumChat(captured!)).toBe(true);
      const bridgeStamped = {
        ...captured!,
        r: deviceAHash,
      };
      expect(bridgeStamped.w).toEqual(captured!.w);
      expect(verifyReticulumChatReadSyncWire(captured!.w)?.ownerAddress).toBe(
        owner.address
      );
      expect((deviceB as any).localDmAddresses.has(owner.address)).toBe(true);
      expect((deviceB as any).getVerifiedDmPeerHashes(owner.address)).toEqual([
        deviceAHash,
      ]);

      deviceB.handleWire(captured as any, '3'.repeat(32));
      expect((deviceB as any).db.getDeviceReadStates(owner.address)).toEqual(
        []
      );
      expect(deviceB.getDirectSummaries(owner.address)[0]?.unreadCount).toBe(1);

      deviceB.handleWire(captured as any, deviceAHash);
      expect(
        (deviceB as any).db.getDeviceReadStates(owner.address)
      ).toHaveLength(1);
      expect(
        (deviceB as any).db.getDirectReadWatermark(
          first.conversationId,
          owner.address
        )
      ).toBe(first.timestamp);
      expect(deviceB.getDirectSummaries(owner.address)[0]?.unreadCount).toBe(0);

      const sendsBeforeAckCheck = readSyncSendCount;
      const ack: Extract<ReticulumChatWire, { k: 'read_sync_ack' }> = {
        t: 'RCHAT',
        k: 'read_sync_ack',
        w: {
          y: 'd',
          c: first.conversationId,
          u: first.timestamp,
        },
      };
      deviceA.handleWire(ack, '3'.repeat(32));
      await (deviceA as any).replayReadStatesToOwnDevices();
      expect(readSyncSendCount).toBeGreaterThan(sendsBeforeAckCheck);

      deviceA.handleWire(ack, deviceBHash);
      const sendsAfterValidAck = readSyncSendCount;
      await (deviceA as any).replayReadStatesToOwnDevices();
      expect(readSyncSendCount).toBe(sendsAfterValidAck);

      const observed: ReticulumDmEvent[] = [];
      deviceB.on('directEvent', ({ event }) => observed.push(event));
      const late = signedDmEvent({
        sender: peer,
        recipient: owner,
        eventId: 'read-sync-late',
        senderStreamId: 'a'.repeat(32),
        senderSeq: 2,
        timestamp: first.timestamp - 1,
      });
      expect((deviceB as any).acceptDirectEvent(late, false)).toBe(true);
      expect(deviceB.getDirectSummaries(owner.address)[0]?.unreadCount).toBe(0);
      expect(observed.at(-1)?.readByOwner).toBe(true);
    } finally {
      deviceA.close();
      deviceB.close();
    }
  });

  it('synchronizes group-channel read state only from a verified device of the local account', async () => {
    const owner = createDmIdentity();
    const deviceAHash = '4'.repeat(32);
    const deviceBHash = '5'.repeat(32);
    const groupId = 1144;
    let captured: Extract<ReticulumChatWire, { k: 'read_sync' }> | null = null;
    const commonMembership = {
      groupId,
      isPrivate: false,
      localAddress: owner.address,
    };
    const deviceA = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(owner),
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: deviceBHash,
          address: owner.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => deviceAHash,
        sendReticulumChatDetailed: async (
          _target: string,
          wire: ReticulumChatWire
        ) => {
          if (wire.k === 'read_sync') captured = wire;
          return { ok: true as const };
        },
      } as any,
    });
    const deviceB = new ReticulumChatManager({
      dbPath: tempDbPath(),
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: deviceAHash,
          address: owner.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => deviceBHash,
      } as any,
    });
    try {
      deviceA.setLocalGroupMemberships([commonMembership]);
      deviceB.setLocalGroupMemberships([commonMembership]);
      const event = signedEvent({
        eventId: 'group-read-sync-first',
        groupId,
        channelId: 'general',
        timestamp: Date.now() - 1_000,
        mentionAddressHashes: [hashReticulumChatMentionAddress(owner.address)],
      });
      expect((deviceB as any).acceptValidatedEvent(event, false)).toBe(true);
      expect(deviceB.getChatSummaries(owner.address)[0]?.unreadCount).toBe(1);

      deviceA.markRead(groupId, 'general', event.timestamp, owner.address);
      await flushQueuedWork();
      expect(captured).not.toBeNull();
      expect(verifyReticulumChatReadSyncWire(captured!.w)?.ownerAddress).toBe(
        owner.address
      );
      expect((deviceB as any).localGroupAddresses.get(groupId)).toBe(
        owner.address
      );
      expect((deviceB as any).getVerifiedDmPeerHashes(owner.address)).toEqual([
        deviceAHash,
      ]);

      deviceB.handleWire(captured as any, '6'.repeat(32));
      expect((deviceB as any).db.getDeviceReadStates(owner.address)).toEqual(
        []
      );
      expect(deviceB.getChatSummaries(owner.address)[0]?.unreadCount).toBe(1);
      deviceB.handleWire(captured as any, deviceAHash);
      expect(
        (deviceB as any).db.getDeviceReadStates(owner.address)
      ).toHaveLength(1);
      expect(
        (deviceB as any).db.getReadWatermark(groupId, 'general', owner.address)
      ).toBe(event.timestamp);
      expect(deviceB.getChatSummaries(owner.address)[0]?.unreadCount).toBe(0);

      const observed: Array<ReticulumChatEvent & { readByOwner?: true }> = [];
      deviceB.on('event', ({ event: emitted }) => observed.push(emitted));
      const late = signedEvent({
        eventId: 'group-read-sync-late',
        groupId,
        channelId: 'general',
        timestamp: event.timestamp - 1,
      });
      expect((deviceB as any).acceptValidatedEvent(late, false)).toBe(true);
      expect(deviceB.getChatSummaries(owner.address)[0]?.unreadCount).toBe(0);
      (deviceB as any).emitGroupEventIfVisible(late);
      expect(observed.at(-1)?.readByOwner).toBe(true);
    } finally {
      deviceA.close();
      deviceB.close();
    }
  });

  it('accepts signed own-device call history and rejects tampered outcomes', () => {
    const ownerKeys = nacl.sign.keyPair();
    const peerKeys = nacl.sign.keyPair();
    const ownerPublicKey = base58Encode(ownerKeys.publicKey);
    const ownerAddress = deriveAddressFromPublicKey(ownerPublicKey);
    const peerAddress = deriveAddressFromPublicKey(
      base58Encode(peerKeys.publicKey)
    );
    const now = Date.now();
    const signedFields = {
      type: 'RCHAT_DIRECT_CALL_HISTORY_V1',
      ownerAddress,
      callId: 'call_history_security_1',
      peerAddress,
      direction: 'incoming',
      outcome: 'missed',
      startedAt: now - 10_000,
      endedAt: now - 1_000,
      updatedAt: now,
      authorAddress: ownerAddress,
      authorPublicKey: ownerPublicKey,
    };
    const signature = base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(signedFields)),
        ownerKeys.secretKey
      )
    );
    const wire = {
      c: 'call_history_security_1',
      q: peerAddress,
      d: 'i' as const,
      o: 'm' as const,
      b: now - 10_000,
      e: now - 1_000,
      n: now,
      p: ownerPublicKey,
      z: signature,
    };
    expect(verifyReticulumDirectCallHistoryWire(wire, now)).toMatchObject({
      ownerAddress,
      peerAddress,
      outcome: 'missed',
    });
    expect(
      verifyReticulumDirectCallHistoryWire({ ...wire, o: 'a' }, now)
    ).toBeNull();
  });

  it('finishes a pending read synchronization after the app restarts', async () => {
    const owner = createDmIdentity();
    const peer = createDmIdentity();
    const dbPath = tempDbPath();
    const upToTimestamp = Date.now() - 500;
    const beforeRestart = new ReticulumChatManager({
      dbPath,
      signLocalFields: async () => null,
      hasGoodOverlayHealth: () => false,
    });
    beforeRestart.setLocalDmAddresses([owner.address]);
    beforeRestart.markDirectRead(owner.address, peer.address, upToTimestamp);
    beforeRestart.close();

    const remoteHash = '7'.repeat(32);
    const sent: ReticulumChatWire[] = [];
    const afterRestart = new ReticulumChatManager({
      dbPath,
      signLocalFields: createDmSigner(owner),
      hasGoodOverlayHealth: () => false,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: remoteHash,
          address: owner.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => '8'.repeat(32),
        sendReticulumChatDetailed: async (
          _target: string,
          wire: ReticulumChatWire
        ) => {
          sent.push(wire);
          return { ok: true as const };
        },
      } as any,
    });
    try {
      afterRestart.setLocalDmAddresses([owner.address]);
      await flushQueuedWork();
      const readWires = sent.filter(
        (wire): wire is Extract<ReticulumChatWire, { k: 'read_sync' }> =>
          wire.k === 'read_sync'
      );
      expect(readWires).toHaveLength(1);
      expect(readWires[0].w.u).toBe(upToTimestamp);
      expect(
        (afterRestart as any).db.getPendingDeviceReadStates(owner.address)
      ).toEqual([]);
    } finally {
      afterRestart.close();
    }
  });

  it('retries a transient read-state signing failure without requiring a restart', async () => {
    vi.useFakeTimers();
    const owner = createDmIdentity();
    const peer = createDmIdentity();
    const remoteHash = '9'.repeat(32);
    const signed = createDmSigner(owner);
    let signingAttempts = 0;
    const sent: ReticulumChatWire[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: async (fields) => {
        if (fields.type !== 'RCHAT_READ_SYNC_V1') return signed(fields);
        signingAttempts += 1;
        return signingAttempts === 1 ? null : signed(fields);
      },
      hasGoodOverlayHealth: () => false,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: remoteHash,
          address: owner.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => '8'.repeat(32),
        sendReticulumChatDetailed: async (
          _target: string,
          wire: ReticulumChatWire
        ) => {
          sent.push(wire);
          return { ok: true as const };
        },
      } as any,
    });
    try {
      manager.setLocalDmAddresses([owner.address]);
      manager.markDirectRead(owner.address, peer.address, Date.now() - 500);
      await flushAsyncWork(16);
      expect(signingAttempts).toBe(1);
      expect(sent.filter((wire) => wire.k === 'read_sync')).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1_000);
      await flushAsyncWork(16);
      expect(signingAttempts).toBe(2);
      expect(sent.filter((wire) => wire.k === 'read_sync')).toHaveLength(1);
      expect(
        (manager as any).db.getPendingDeviceReadStates(owner.address)
      ).toEqual([]);
    } finally {
      manager.close();
      vi.useRealTimers();
    }
  });

  it('does not resume a pending read-state signature into a closed database', async () => {
    const owner = createDmIdentity();
    const peer = createDmIdentity();
    const signed = createDmSigner(owner);
    let releaseSigner!: () => void;
    const signerGate = new Promise<void>((resolve) => {
      releaseSigner = resolve;
    });
    let signerStarted!: () => void;
    const signerDidStart = new Promise<void>((resolve) => {
      signerStarted = resolve;
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: async (fields) => {
        signerStarted();
        await signerGate;
        return signed(fields);
      },
      hasGoodOverlayHealth: () => false,
    });
    manager.setLocalDmAddresses([owner.address]);
    const conversationId = reticulumDmConversationId(
      owner.address,
      peer.address
    );
    (manager as any).pendingReadSync.set(
      `${owner.address}:d:${conversationId}`,
      {
        scopeType: 'dm',
        ownerAddress: owner.address,
        conversationId,
        peerAddress: peer.address,
        upToTimestamp: Date.now() - 500,
      }
    );

    const flush = (manager as any).flushReadSyncQueue() as Promise<void>;
    await signerDidStart;
    manager.close();
    releaseSigner();

    await expect(flush).resolves.toBeUndefined();
  });

  it('invalidates an in-flight account read sync during logout without losing its durable watermark', async () => {
    const owner = createDmIdentity();
    const peer = createDmIdentity();
    const signed = createDmSigner(owner);
    let releaseSigner!: () => void;
    const signerGate = new Promise<void>((resolve) => {
      releaseSigner = resolve;
    });
    let signerStarted!: () => void;
    const signerDidStart = new Promise<void>((resolve) => {
      signerStarted = resolve;
    });
    const sent: ReticulumChatWire[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: async (fields) => {
        signerStarted();
        await signerGate;
        return signed(fields);
      },
      hasGoodOverlayHealth: () => false,
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => '8'.repeat(32),
        sendReticulumChatDetailed: async (
          _target: string,
          wire: ReticulumChatWire
        ) => {
          sent.push(wire);
          return { ok: true as const };
        },
      } as any,
    });
    try {
      manager.setLocalDmAddresses([owner.address]);
      const conversationId = reticulumDmConversationId(
        owner.address,
        peer.address
      );
      (manager as any).queueReadSync({
        scopeType: 'dm',
        ownerAddress: owner.address,
        conversationId,
        peerAddress: peer.address,
        upToTimestamp: Date.now() - 500,
      });

      await signerDidStart;
      await manager.clearLocalAccountState();
      releaseSigner();
      await flushAsyncWork(8);

      expect((manager as any).localDmAddresses.size).toBe(0);
      expect((manager as any).localGroupIds.size).toBe(0);
      expect(sent.filter((wire) => wire.k === 'read_sync')).toHaveLength(0);
      expect(
        (manager as any).db.getDeviceReadStates(owner.address, 10)
      ).toEqual([]);
      expect(
        (manager as any).db.getPendingDeviceReadStates(owner.address)
      ).toEqual([
        expect.objectContaining({
          ownerAddress: owner.address,
          scopeType: 'dm',
          conversationId,
        }),
      ]);
    } finally {
      releaseSigner();
      manager.close();
    }
  });

  it('keeps public group activity in bounded rolling counters', () => {
    const now = 20 * 24 * 60 * 60_000;
    const state = createReticulumPublicGroupActivityState();

    expect(
      recordReticulumPublicGroupActivity(state, now - 1_000, 'Qauthor-a', now)
    ).toBe(true);
    expect(
      recordReticulumPublicGroupActivity(state, now - 2_000, 'Qauthor-a', now)
    ).toBe(true);
    expect(
      recordReticulumPublicGroupActivity(state, now - 3_000, 'Qauthor-b', now)
    ).toBe(true);
    expect(
      recordReticulumPublicGroupActivity(
        state,
        now - 8 * 24 * 60 * 60_000,
        'Qauthor-old',
        now
      )
    ).toBe(false);

    expect(
      summarizeReticulumPublicGroupActivity(716, state, now)
    ).toMatchObject({
      groupId: 716,
      messages24h: 3,
      messages7d: 3,
      activeAuthors7d: 2,
    });
    expect(
      summarizeReticulumPublicGroupActivity(716, state, now + 25 * 60 * 60_000)
    ).toMatchObject({ messages24h: 0, messages7d: 3 });
  });

  it('keeps a full public activity top page within the control wire limit', () => {
    const wire: Extract<ReticulumChatWire, { k: 'public_activity_top_v1' }> = {
      t: 'RCHAT',
      k: 'public_activity_top_v1',
      q: 'a'.repeat(16),
      e: Array.from({ length: 4 }, (_, index) => [
        2_147_483_647 - index,
        1_000_000,
        10_000_000,
        1_000_000,
        Date.now(),
      ]),
    };

    expect(wireFitsReticulum(wire)).toBe(true);
  });

  it('builds deterministic uncapped author trees and detects changes past ten thousand streams', () => {
    const heads = Array.from({ length: 20_001 }, (_, index) => ({
      authorAddress: `Qauthor-${String(index).padStart(6, '0')}`,
      authorStreamId: index.toString(16).padStart(32, '0'),
      maxSeq: index + 1,
    }));
    const first = buildReticulumChatAuthorTreeSnapshot(716, heads, 1);
    const reordered = buildReticulumChatAuthorTreeSnapshot(
      716,
      [...heads].reverse(),
      2
    );
    const changedHeads = [...heads];
    changedHeads[20_000] = { ...changedHeads[20_000], maxSeq: 99_999 };
    const changed = buildReticulumChatAuthorTreeSnapshot(716, changedHeads, 3);

    expect(first.count).toBe(20_001);
    expect(first.root).toBe(reordered.root);
    expect(first.root).not.toBe(changed.root);
    expect(first.nodeHashes.size).toBe(511);
  });

  it('validates event shape and signature', () => {
    const event = signedEvent();
    expect(validateReticulumChatEventShape(event)).toBe(true);
    expect(verifyReticulumChatEvent(event)).toBe(true);
  });

  it('rejects payload hash mismatches before signature verification', () => {
    const event = signedEvent({ payloadHash: '0'.repeat(64) });
    expect(validateReticulumChatEventShape(event)).toBe(false);
  });

  it('rejects signatures when signed fields are mutated', () => {
    const event = signedEvent();
    event.authorSeq += 1;
    expect(validateReticulumChatEventShape(event)).toBe(true);
    expect(verifyReticulumChatEvent(event)).toBe(false);
  });

  it('signs and validates the author stream identity', () => {
    const event = signedEvent({ authorStreamId: 'a'.repeat(32) });
    expect(validateReticulumChatEventShape(event)).toBe(true);
    expect(verifyReticulumChatEvent(event)).toBe(true);
    event.authorStreamId = 'b'.repeat(32);
    expect(verifyReticulumChatEvent(event)).toBe(false);
    event.authorStreamId = 'not-a-valid-stream';
    expect(validateReticulumChatEventShape(event)).toBe(false);
    event.authorStreamId = 'legacy';
    expect(validateReticulumChatEventShape(event)).toBe(false);
    (event as unknown as { authorStreamId: unknown }).authorStreamId = 123;
    expect(() => validateReticulumChatEventShape(event)).not.toThrow();
    expect(validateReticulumChatEventShape(event)).toBe(false);
    delete (event as unknown as { authorStreamId?: unknown }).authorStreamId;
    expect(validateReticulumChatEventShape(event)).toBe(false);
  });

  it('validates compact signed DM discovery controls', () => {
    const now = Date.now();
    const notify = signedDmNotifyWire({
      addressB: 'Qrecipient',
      sourcePeerHash: 'a'.repeat(32),
      requestId: 'b'.repeat(8),
      timestamp: now,
    });
    const probe = signedDmProbeWire({
      requestId: 'c'.repeat(8),
      timestamp: now,
    });
    const request = signedDmRequestWire({
      addressB: 'Qrecipient',
      after: now - 10_000,
      limit: 50,
      requesterPeerHash: 'd'.repeat(32),
      requestId: 'e'.repeat(16),
      timestamp: now,
    });

    expect(verifyReticulumDmNotify(notify, now)).toBe(true);
    expect(verifyReticulumDmProbe(probe, now)).toBe(true);
    expect(verifyReticulumDmRequest(request, now)).toBe(true);
    expect(wireFitsReticulum({ t: 'RCHAT', k: 'dm_notify', d: notify })).toBe(
      true
    );
    expect(wireFitsReticulum({ t: 'RCHAT', k: 'dm_probe', q: probe })).toBe(
      true
    );
    expect(wireFitsReticulum({ t: 'RCHAT', k: 'dm_req', q: request })).toBe(
      true
    );
  });

  it('validates signed resource retention receipts and rejects tampering', () => {
    const now = Date.now();
    const groupId = 716;
    const keyPair = nacl.sign.keyPair();
    const authorPublicKey = base58Encode(keyPair.publicKey);
    const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
    const fields = buildReticulumChatResourceReceiptSignedFields({
      groupId,
      fileHash: 'f'.repeat(64),
      sizeBytes: 1_024,
      providerPeerHash: 'a'.repeat(32),
      retentionUntil: now + 60_000,
      authorAddress,
      authorPublicKey,
      timestamp: now,
    });
    const receipt: Extract<ReticulumChatWire, { k: 'resource_receipt' }>['w'] =
      {
        f: 'f'.repeat(64),
        s: 1_024,
        l: now + 60_000,
        sp: 'a'.repeat(32),
        p: authorPublicKey,
        n: now,
        z: base58Encode(
          nacl.sign.detached(
            new Uint8Array(canonicalizeForSigning(fields)),
            keyPair.secretKey
          )
        ),
      };

    expect(verifyReticulumChatResourceReceipt(groupId, receipt, now)).toBe(
      true
    );
    expect(
      verifyReticulumChatResourceReceipt(groupId, { ...receipt, s: 2_048 }, now)
    ).toBe(false);
    expect(
      verifyReticulumChatResourceReceipt(groupId, receipt, receipt.l + 1)
    ).toBe(false);
  });

  it('binds signed DM resource receipts to the exact conversation', () => {
    const now = Date.now();
    const provider = createDmIdentity();
    const peer = createDmIdentity();
    const conversationId = reticulumDmConversationId(
      provider.address,
      peer.address
    );
    const fields = buildReticulumChatResourceReceiptSignedFields({
      conversationId,
      peerAddress: peer.address,
      fileHash: 'e'.repeat(64),
      sizeBytes: 2_048,
      providerPeerHash: 'b'.repeat(32),
      retentionUntil: now + 60_000,
      authorAddress: provider.address,
      authorPublicKey: provider.publicKey,
      timestamp: now,
    });
    const receipt: Extract<
      ReticulumChatWire,
      { k: 'dm_resource_receipt' }
    >['w'] = {
      c: conversationId,
      b: peer.address,
      f: 'e'.repeat(64),
      s: 2_048,
      l: now + 60_000,
      sp: 'b'.repeat(32),
      p: provider.publicKey,
      n: now,
      z: base58Encode(
        nacl.sign.detached(
          new Uint8Array(canonicalizeForSigning(fields)),
          provider.secretKey
        )
      ),
    };

    expect(verifyReticulumDmResourceReceipt(receipt, now)).toBe(true);
    expect(
      verifyReticulumDmResourceReceipt(
        { ...receipt, b: createDmIdentity().address },
        now
      )
    ).toBe(false);
  });

  it('keeps DM resource discovery as a compact locator packet', () => {
    const now = Date.now();
    const authorKeyPair = nacl.sign.keyPair();
    const peerKeyPair = nacl.sign.keyPair();
    const authorPublicKey = base58Encode(authorKeyPair.publicKey);
    const peerAddress = deriveAddressFromPublicKey(
      base58Encode(peerKeyPair.publicKey)
    );
    const authorAddress = deriveAddressFromPublicKey(authorPublicKey);
    const requestId = 'a1b2c3d4';
    const fileHash = 'f'.repeat(64);
    const expiresAt = now + 60_000;
    const wire = {
      t: 'RCHAT' as const,
      k: 'dm_resource_find' as const,
      q: {
        a: authorAddress,
        b: peerAddress,
        q: requestId,
        f: fileHash,
        x: expiresAt,
      },
    };

    expect(getReticulumDmResourceFindRejectReason(wire.q, now)).toBeNull();
    expect(wire.q).not.toHaveProperty('c');
    expect(wire.q).not.toHaveProperty('p');
    expect(wire.q).not.toHaveProperty('z');
    expect(byteLengthUtf8JsonWithBridgeSenderOnly(wire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    expect(wireFitsReticulum(wire)).toBe(true);
  });

  it('keeps DM resource provider replies compact', () => {
    const wire = {
      t: 'RCHAT' as const,
      k: 'dm_resource_have' as const,
      c: 'c'.repeat(64),
      fh: 'f'.repeat(64),
      s: 194_393,
      rid: 'a1b2c3d4',
      sp: 'b'.repeat(32),
    };

    expect(wire).not.toHaveProperty('rk');
    expect(byteLengthUtf8JsonWithBridgeSenderOnly(wire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    expect(wireFitsReticulum(wire)).toBe(true);
  });

  it('targets DM resource discovery at candidate providers before opening ranges', async () => {
    vi.useFakeTimers();
    try {
      const requester = createDmIdentity();
      const peer = createDmIdentity();
      const localPeerHash = 'a'.repeat(32);
      const providerPeerHash = 'b'.repeat(32);
      const conversationId = reticulumDmConversationId(
        requester.address,
        peer.address
      );
      const direct: Array<{ peer: string; wire: ReticulumChatWire }> = [];
      const fanout: ReticulumChatWire[] = [];
      const accepts: unknown[] = [];
      const tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'reticulum-dm-resource-discovery-')
      );
      const resourceStore = new ReticulumResourceStore({
        dbPath: path.join(tempRoot, 'resources.db'),
        rootDir: path.join(tempRoot, 'resources'),
      });
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        signLocalFields: createDmSigner(requester),
        resourceStore,
        getVerifiedReticulumPeers: () => [
          {
            destinationHash: providerPeerHash,
            address: peer.address,
            lastSeenAt: Date.now(),
          },
        ],
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getLocalDestinationHash: () => localPeerHash,
          sendReticulumChatDetailed: async (
            targetPeer: string,
            wire: ReticulumChatWire
          ) => {
            direct.push({ peer: targetPeer, wire });
            return { ok: true as const };
          },
          fanoutReticulumChatDetailed: async (
            messages: ReticulumChatWire[]
          ) => {
            fanout.push(...messages);
            return { ok: true as const };
          },
          acceptReticulumResourceDetailed: async (payload: unknown) => {
            accepts.push(payload);
            return { ok: true as const };
          },
        } as any,
      });
      const manifest = {
        namespace: 'reticulum-dm',
        ownerId: `dm:${conversationId}:image.png`,
        fileName: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 194_393,
        fileHash:
          'a46a783ffa63a444bfb46b0ccdd4e3368700ef3932a4e072f9c04470fd23c0a8',
        encrypted: false,
        createdAt: Date.now(),
        metadata: {
          conversationId,
          senderAddress: peer.address,
          recipientAddress: requester.address,
        },
      };

      const result = await manager.requestDirectResource(
        requester.address,
        peer.address,
        manifest,
        'dm-resource-event-id'
      );
      await flushAsyncWork();
      await vi.advanceTimersByTimeAsync(0);

      expect(result).toEqual({ ok: true });
      expect(direct).toHaveLength(1);
      expect(direct[0]).toMatchObject({
        peer: providerPeerHash,
        wire: {
          t: 'RCHAT',
          k: 'dm_resource_find',
        },
      });
      expect(
        (
          direct[0].wire as Extract<
            ReticulumChatWire,
            { k: 'dm_resource_find' }
          >
        ).q
      ).toMatchObject({
        a: requester.address,
        b: peer.address,
        f: manifest.fileHash,
        e: 'dm-resource-event-id',
      });
      expect(fanout).toHaveLength(0);
      expect(accepts).toHaveLength(0);
      manager.close();
      resourceStore.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to fanout when direct DM resource discovery gets no provider response', async () => {
    vi.useFakeTimers();
    try {
      const requester = createDmIdentity();
      const peer = createDmIdentity();
      const localPeerHash = 'a'.repeat(32);
      const providerPeerHash = 'b'.repeat(32);
      const conversationId = reticulumDmConversationId(
        requester.address,
        peer.address
      );
      const direct: Array<{ peer: string; wire: ReticulumChatWire }> = [];
      const fanout: ReticulumChatWire[] = [];
      const tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'reticulum-dm-resource-fallback-')
      );
      const resourceStore = new ReticulumResourceStore({
        dbPath: path.join(tempRoot, 'resources.db'),
        rootDir: path.join(tempRoot, 'resources'),
      });
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        signLocalFields: createDmSigner(requester),
        resourceStore,
        getVerifiedReticulumPeers: () => [
          {
            destinationHash: providerPeerHash,
            address: peer.address,
            lastSeenAt: Date.now(),
          },
        ],
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getLocalDestinationHash: () => localPeerHash,
          sendReticulumChatDetailed: async (
            targetPeer: string,
            wire: ReticulumChatWire
          ) => {
            direct.push({ peer: targetPeer, wire });
            return { ok: true as const };
          },
          fanoutReticulumChatDetailed: async (
            messages: ReticulumChatWire[]
          ) => {
            fanout.push(...messages);
            return { ok: true as const };
          },
        } as any,
      });
      const manifest = {
        namespace: 'reticulum-dm',
        ownerId: `dm:${conversationId}:image.png`,
        fileName: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 194_393,
        fileHash:
          'a46a783ffa63a444bfb46b0ccdd4e3368700ef3932a4e072f9c04470fd23c0a8',
        encrypted: false,
        createdAt: Date.now(),
        metadata: {
          conversationId,
          senderAddress: peer.address,
          recipientAddress: requester.address,
        },
      };

      const result = await manager.requestDirectResource(
        requester.address,
        peer.address,
        manifest,
        'dm-resource-event-id'
      );
      await flushAsyncWork();
      await vi.advanceTimersByTimeAsync(0);

      expect(result).toEqual({ ok: true });
      expect(direct).toHaveLength(1);
      expect(fanout).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(2_000);
      await flushAsyncWork();

      expect(fanout).toHaveLength(1);
      expect(fanout[0]).toMatchObject({
        t: 'RCHAT',
        k: 'dm_resource_find',
      });

      manager.close();
      resourceStore.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects rewritten signed DM discovery controls', () => {
    const now = Date.now();
    const notify = signedDmNotifyWire({
      addressB: 'Qrecipient',
      sourcePeerHash: 'a'.repeat(32),
      requestId: 'b'.repeat(8),
      timestamp: now,
    });
    const request = signedDmRequestWire({
      addressB: 'Qrecipient',
      after: now - 10_000,
      limit: 50,
      requesterPeerHash: 'd'.repeat(32),
      requestId: 'e'.repeat(16),
      timestamp: now,
    });

    expect(
      verifyReticulumDmNotify({ ...notify, sp: 'f'.repeat(32) }, now)
    ).toBe(false);
    expect(
      verifyReticulumDmRequest({ ...request, rp: 'f'.repeat(32) }, now)
    ).toBe(false);
  });
});

describe('reticulum chat database', () => {
  const dbs: ReticulumChatDatabase[] = [];
  afterEach(() => {
    while (dbs.length) dbs.pop()?.close();
  });

  it('persists local and cached public activity in one bounded table', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const localStateJson = JSON.stringify(
      createReticulumPublicGroupActivityState()
    );
    db.upsertPublicGroupActivityLocalState(
      716,
      localStateJson,
      {
        groupId: 716,
        messages24h: 4,
        messages7d: 9,
        activeAuthors7d: 3,
        observedAt: 10_000,
        confidence: 1,
      },
      10_000
    );
    db.upsertPublicGroupActivityCache(
      [
        {
          groupId: 716,
          messages24h: 5,
          messages7d: 10,
          activeAuthors7d: 4,
          observedAt: 11_000,
          confidence: 2,
        },
        {
          groupId: 717,
          messages24h: 2,
          messages7d: 3,
          activeAuthors7d: 2,
          observedAt: 11_000,
          confidence: 1,
        },
      ],
      1,
      11_000
    );

    const records = db.getPublicGroupActivityRecords(10);
    expect(records.find((record) => record.groupId === 716)).toMatchObject({
      localStateJson,
      messages24h: 5,
      messages7d: 10,
      activeAuthors7d: 4,
      confidence: 2,
    });
    expect(
      records.filter((record) => record.localStateJson === null)
    ).toHaveLength(1);
  });

  it('dedupes events by eventId and builds sync state', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({ groupId: 11, authorSeq: 3 });
    expect(db.insertEvent(event, false)).toBe(true);
    expect(db.insertEvent(event, false)).toBe(false);
    expect(db.hasEvent(event.eventId)).toBe(true);
    expect(db.getSyncState(11)).toEqual({
      [`${event.authorAddress}:${TEST_AUTHOR_STREAM_ID}`]: 3,
    });
  });

  it('persists missing author range retry backoff', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const author = 'QauthorBackoff';

    db.ensureMissingRange(11, author, TEST_AUTHOR_STREAM_ID, 2, 5, 'peer-a');
    const first = db.claimMissingRangeAttempt(
      11,
      author,
      TEST_AUTHOR_STREAM_ID,
      2,
      5,
      'peer-a',
      1_000,
      31_000
    );

    expect(first).toMatchObject({
      groupId: 11,
      authorAddress: author,
      fromSeq: 2,
      toSeq: 5,
      preferredPeer: 'peer-a',
      attempts: 1,
      nextAttemptAt: 31_000,
    });
    expect(
      db.claimMissingRangeAttempt(
        11,
        author,
        TEST_AUTHOR_STREAM_ID,
        2,
        5,
        'peer-a',
        2_000,
        122_000
      )
    ).toBeNull();

    const second = db.claimMissingRangeAttempt(
      11,
      author,
      TEST_AUTHOR_STREAM_ID,
      2,
      5,
      'peer-b',
      31_000,
      151_000
    );
    expect(second).toMatchObject({
      preferredPeer: 'peer-b',
      attempts: 2,
      nextAttemptAt: 151_000,
    });

    const deferred = db.deferMissingRange(
      11,
      author,
      TEST_AUTHOR_STREAM_ID,
      2,
      5,
      'peer-c',
      600_000,
      3
    );
    expect(deferred).toMatchObject({
      preferredPeer: 'peer-c',
      attempts: 3,
      nextAttemptAt: 600_000,
    });
    db.ensureMissingRange(11, author, TEST_AUTHOR_STREAM_ID, 2, 5, 'peer-d');
    expect(
      db.getMissingRange(11, author, TEST_AUTHOR_STREAM_ID, 2, 5)
    ).toMatchObject({
      preferredPeer: 'peer-c',
      attempts: 3,
      nextAttemptAt: 600_000,
    });

    const scheduled = db.scheduleMissingRange(
      11,
      author,
      TEST_AUTHOR_STREAM_ID,
      2,
      5,
      'peer-e',
      200_000
    );
    expect(scheduled).toMatchObject({
      preferredPeer: 'peer-e',
      attempts: 3,
      nextAttemptAt: 600_000,
    });

    const rotated = db.rescheduleMissingRange(
      11,
      author,
      TEST_AUTHOR_STREAM_ID,
      2,
      5,
      'peer-f',
      201_000
    );
    expect(rotated).toMatchObject({
      preferredPeer: 'peer-f',
      attempts: 3,
      nextAttemptAt: 201_000,
    });

    const staleRotation = db.rescheduleMissingRange(
      11,
      author,
      TEST_AUTHOR_STREAM_ID,
      2,
      5,
      'peer-stale',
      100,
      'peer-e'
    );
    expect(staleRotation).toMatchObject({
      preferredPeer: 'peer-f',
      nextAttemptAt: 201_000,
    });
  });

  it('never persists already-known author sequences as missing', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const [second, fourth] = signedAuthorEvents([
      {
        eventId: 'known-gap-sequence-2',
        groupId: 11,
        authorSeq: 2,
        timestamp: 2_000,
      },
      {
        eventId: 'known-gap-sequence-4',
        groupId: 11,
        authorSeq: 4,
        timestamp: 4_000,
      },
    ]);
    expect(db.insertEvent(second, false)).toBe(true);
    expect(db.insertEvent(fourth, false)).toBe(true);

    db.ensureMissingRange(
      11,
      second.authorAddress,
      second.authorStreamId,
      2,
      5,
      'peer-a'
    );

    expect(
      db.getMissingRangeOverlaps(
        11,
        second.authorAddress,
        second.authorStreamId,
        2,
        5
      )
    ).toEqual([
      expect.objectContaining({ fromSeq: 3, toSeq: 3 }),
      expect.objectContaining({ fromSeq: 5, toSeq: 5 }),
    ]);

    db.upsertMissingRange(
      11,
      second.authorAddress,
      second.authorStreamId,
      2,
      2,
      'peer-b'
    );
    expect(
      db.getMissingRangeOverlaps(
        11,
        second.authorAddress,
        second.authorStreamId,
        2,
        2
      )
    ).toEqual([]);
  });

  it('clears a missing range when its late event is already expired', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const now = Date.now();
    db.upsertChannel({
      groupId: 13,
      channelId: 'expired-gap',
      name: 'expired-gap',
      position: 2,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      expiryDurationMs: 1_000,
      createdBy: 'Qadmin',
      createdAt: now - 10_000,
      updatedAt: now - 10_000,
    });
    const expired = signedEvent({
      eventId: 'late-expired-gap-event',
      groupId: 13,
      channelId: 'expired-gap',
      authorSeq: 2,
      timestamp: now - 2_000,
    });
    db.ensureMissingRange(
      expired.groupId,
      expired.authorAddress,
      expired.authorStreamId,
      expired.authorSeq,
      expired.authorSeq,
      'peer-expired'
    );

    expect(db.insertEvent(expired, false)).toBe(false);
    expect(
      db.getMissingRange(
        expired.groupId,
        expired.authorAddress,
        expired.authorStreamId,
        expired.authorSeq,
        expired.authorSeq
      )
    ).toBeNull();
  });

  it('expires peer-unavailable observations before retrying a missing range', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const groupId = 12;
    const authorAddress = 'QmissingObservationAuthor';
    const peerHash = 'a'.repeat(32);

    expect(
      db.recordMissingRangePeerUnavailable(
        groupId,
        authorAddress,
        TEST_AUTHOR_STREAM_ID,
        7,
        9,
        peerHash,
        10_000,
        5_000
      )
    ).toBe(1);
    expect(
      db.recordMissingRangePeerUnavailable(
        groupId,
        authorAddress,
        TEST_AUTHOR_STREAM_ID,
        7,
        10,
        peerHash,
        10_000,
        5_000
      )
    ).toBe(1);
    expect(
      db.hasMissingRangePeerUnavailable(
        groupId,
        authorAddress,
        TEST_AUTHOR_STREAM_ID,
        7,
        9,
        peerHash,
        10_000
      )
    ).toBe(true);
    expect(
      db.hasMissingRangePeerUnavailable(
        groupId,
        authorAddress,
        TEST_AUTHOR_STREAM_ID,
        8,
        8,
        peerHash,
        10_000
      )
    ).toBe(true);
    expect(
      db.hasMissingRangePeerUnavailable(
        groupId,
        authorAddress,
        TEST_AUTHOR_STREAM_ID,
        6,
        8,
        peerHash,
        10_000
      )
    ).toBe(false);
    expect(
      db.hasMissingRangePeerUnavailable(
        groupId,
        authorAddress,
        TEST_AUTHOR_STREAM_ID,
        7,
        9,
        peerHash,
        10_001
      )
    ).toBe(false);
    expect(
      db.recordMissingRangePeerUnavailable(
        groupId,
        authorAddress,
        TEST_AUTHOR_STREAM_ID,
        7,
        9,
        'b'.repeat(32),
        20_000,
        5_000
      )
    ).toBe(1);
  });

  it('does not rescan an unchanged missing range on every retry update', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const pruneSatisfiedMissingRange = vi.spyOn(
      db as any,
      'pruneSatisfiedMissingRange'
    );

    db.ensureMissingRange(
      14,
      'QstableMissingRange',
      TEST_AUTHOR_STREAM_ID,
      4,
      8,
      'peer-a'
    );
    db.ensureMissingRange(
      14,
      'QstableMissingRange',
      TEST_AUTHOR_STREAM_ID,
      4,
      8,
      'peer-a'
    );
    db.scheduleMissingRange(
      14,
      'QstableMissingRange',
      TEST_AUTHOR_STREAM_ID,
      4,
      8,
      'peer-a',
      10_000
    );

    expect(pruneSatisfiedMissingRange).toHaveBeenCalledTimes(1);
  });

  it('does not let an inbound digest replace the peer for an in-flight missing range', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([14]);
    manager.subscribeGroup(14);
    const db = (manager as any).db as ReticulumChatDatabase;
    db.ensureMissingRange(
      14,
      'QstableInflightRange',
      TEST_AUTHOR_STREAM_ID,
      7,
      7,
      'peer-a'
    );
    expect(
      db.claimMissingRangeAttempt(
        14,
        'QstableInflightRange',
        TEST_AUTHOR_STREAM_ID,
        7,
        7,
        'peer-a',
        100_000,
        100_000 + 2 * 60 * 60_000
      )
    ).toBeTruthy();

    (manager as any).recordAuthorGapRanges(
      14,
      'peer-b',
      [
        {
          a: 'QstableInflightRange',
          s: TEST_AUTHOR_STREAM_ID,
          from: 7,
          to: 7,
        },
      ],
      'test-digest-race'
    );

    expect(
      db.getMissingRange(
        14,
        'QstableInflightRange',
        TEST_AUTHOR_STREAM_ID,
        7,
        7
      )
    ).toMatchObject({
      preferredPeer: 'peer-a',
      nextAttemptAt: 100_000 + 2 * 60 * 60_000,
    });
    manager.close();
  });

  it('persists global missing-range quarantine despite a stale preferred peer', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => 100_000,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: 'peer-a',
          address: 'QrangeProvider',
          lastSeen: 100_000,
        },
      ],
    });
    manager.setLocalGroupMemberships([14]);
    manager.subscribeGroup(14);
    const db = (manager as any).db as ReticulumChatDatabase;
    const range = {
      a: 'QquarantineRange',
      s: TEST_AUTHOR_STREAM_ID,
      from: 9,
      to: 9,
    };
    db.ensureMissingRange(14, range.a, range.s, 9, 9, 'peer-a');
    db.rescheduleMissingRange(14, range.a, range.s, 9, 9, 'peer-b', 120_000);
    const requestId = 'a'.repeat(16);
    (manager as any).pendingAuthorRangeRequests.set(requestId, {
      groupId: 14,
      peerHash: 'peer-a',
      ranges: [range],
      persistedRanges: [range],
      expiresAt: 120_000,
    });

    (manager as any).handleRangeNone(
      14,
      { id: requestId, ranges: [range] },
      'peer-a'
    );

    expect(db.getMissingRange(14, range.a, range.s, 9, 9)).toMatchObject({
      preferredPeer: 'peer-a',
      nextAttemptAt: 100_000 + 6 * 60 * 60_000,
    });
    manager.close();
  });

  it('shortens legacy author gap backoff once for peer-aware retry', () => {
    const legacyDb = new ReticulumChatDatabase(tempDbPath());
    dbs.push(legacyDb);
    const author = 'QlegacyGapBackoff';
    legacyDb.ensureMissingRange(
      11,
      author,
      TEST_AUTHOR_STREAM_ID,
      2,
      5,
      'peer-a'
    );
    legacyDb.deferMissingRange(
      11,
      author,
      TEST_AUTHOR_STREAM_ID,
      2,
      5,
      'peer-a',
      Date.now() + 2 * 60 * 60_000,
      106
    );
    const retryAt = Date.now() + 60_000;
    (legacyDb as any).shortenLegacyAuthorGapRetryBackoff(retryAt);
    const migrated = legacyDb.getMissingRange(
      11,
      author,
      TEST_AUTHOR_STREAM_ID,
      2,
      5
    );

    expect(migrated).toMatchObject({ attempts: 106 });
    expect(migrated?.nextAttemptAt).toBe(retryAt);
  });

  it('does not count own events against the relay cache budget', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    db.insertEvent(signedEvent({ eventId: 'own-event' }), true);
    expect(db.getRelayCacheBytes()).toBe(0);
    db.insertEvent(signedEvent({ eventId: 'relay-event' }), false);
    expect(db.getRelayCacheBytes()).toBeGreaterThan(0);
  });

  it('creates built-in channels with their fixed expiry policies', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);

    const general = db.getChannel(11, RETICULUM_CHAT_DEFAULT_CHANNEL_ID);
    const qortalLand = db.getChannel(11, RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID);

    expect(general?.expiryDurationMs).toBe(
      RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS
    );
    expect(qortalLand?.expiryDurationMs).toBe(
      RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS
    );
  });

  it('keeps built-in channel expiry policies fixed', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const general = db.getChannel(11, RETICULUM_CHAT_DEFAULT_CHANNEL_ID)!;
    const qortalLand = db.getChannel(
      11,
      RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID
    )!;

    db.upsertChannel({
      ...general,
      expiryDurationMs: 7 * RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
      updatedAt: 1,
    });
    db.upsertChannel({
      ...qortalLand,
      expiryDurationMs: undefined,
      updatedAt: 1,
    });

    expect(
      db.getChannel(11, RETICULUM_CHAT_DEFAULT_CHANNEL_ID)?.expiryDurationMs
    ).toBe(RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS);
    expect(
      db.getChannel(11, RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID)?.expiryDurationMs
    ).toBe(RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS);
  });

  it('gives legacy general messages a migration grace period', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const policyAppliedAt = Number(
      (db as any).generalChannelExpiryPolicyAppliedAt
    );
    const legacyEvent = signedEvent({
      eventId: 'legacy-general-expiry-grace',
      groupId: 11,
      channelId: RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      timestamp: 1_000,
    });
    const newEvent = signedEvent({
      eventId: 'new-general-expiry-policy',
      groupId: 11,
      channelId: RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      timestamp: policyAppliedAt + 1_000,
    });

    expect(policyAppliedAt).toBeGreaterThan(0);
    expect(db.insertEvent(legacyEvent, true)).toBe(true);
    expect(db.insertEvent(newEvent, true)).toBe(true);
    expect(db.getEventExpiresAt(legacyEvent.eventId)).toBe(
      policyAppliedAt + RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS
    );
    expect(db.getEventExpiresAt(newEvent.eventId)).toBe(
      newEvent.timestamp + RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS
    );
  });

  it('migrates stored general channels and queues legacy history reconciliation', () => {
    const dbPath = tempDbPath();
    const legacyDb = new ReticulumChatDatabase(dbPath);
    const legacyEvent = signedEvent({
      eventId: 'legacy-general-expiry-migration',
      groupId: 12,
      channelId: RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      timestamp: 1_000,
    });
    expect(legacyDb.insertEvent(legacyEvent, true)).toBe(true);
    legacyDb.upsertChannel({
      ...legacyDb.getChannel(12, RETICULUM_CHAT_DEFAULT_CHANNEL_ID)!,
      updatedAt: 1,
    });
    const rawLegacyDb = (legacyDb as any).db;
    rawLegacyDb
      .prepare('DELETE FROM rchat_schema_migrations WHERE name = ?')
      .run('general-channel-expiry-policy-v1');
    rawLegacyDb
      .prepare(
        'UPDATE reticulum_chat_channels SET expiry_duration_ms = ? WHERE group_id = ? AND channel_id = ?'
      )
      .run(null, 12, RETICULUM_CHAT_DEFAULT_CHANNEL_ID);
    rawLegacyDb
      .prepare(
        'UPDATE reticulum_chat_events SET expires_at = ? WHERE event_id = ?'
      )
      .run(null, legacyEvent.eventId);
    rawLegacyDb
      .prepare(
        'UPDATE rchat_message_projection SET expires_at = ? WHERE root_event_id = ?'
      )
      .run(null, legacyEvent.eventId);
    rawLegacyDb
      .prepare(
        'DELETE FROM rchat_channel_expiry_reconciliation WHERE group_id = ? AND channel_id = ?'
      )
      .run(12, RETICULUM_CHAT_DEFAULT_CHANNEL_ID);
    expect(
      rawLegacyDb
        .prepare(
          'SELECT applied_at FROM rchat_schema_migrations WHERE name = ? LIMIT 1'
        )
        .get('general-channel-expiry-policy-v1')
    ).toBeUndefined();
    legacyDb.close();

    const migratedDb = new ReticulumChatDatabase(dbPath);
    dbs.push(migratedDb);
    const policyAppliedAt = Number(
      (migratedDb as any).generalChannelExpiryPolicyAppliedAt
    );
    expect(policyAppliedAt).toBeGreaterThan(0);
    expect(
      migratedDb.getChannel(12, RETICULUM_CHAT_DEFAULT_CHANNEL_ID)
        ?.expiryDurationMs
    ).toBe(RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS);
    expect(migratedDb.getChannelExpiryReconciliationTargets(12)).toContainEqual(
      {
        groupId: 12,
        channelId: RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      }
    );

    const reconciled = migratedDb.reconcileChannelMessageExpiries(
      12,
      RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      10,
      policyAppliedAt
    );
    expect(reconciled.resolutions).toContainEqual({
      eventId: legacyEvent.eventId,
      expiresAt: policyAppliedAt + RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS,
    });
  });

  it('keeps built-in channels open on database writes and reads', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);

    for (const channelId of [
      RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
    ]) {
      const channel = db.getChannel(11, channelId)!;
      db.upsertChannel({
        ...channel,
        archived: true,
        writeMode: 'admins',
        readMode: 'admins',
        writeModeUpdatedAt: 1,
        updatedAt: 1,
      });
      expect(db.getChannel(11, channelId)).toMatchObject({
        archived: false,
        writeMode: 'members',
        readMode: 'members',
      });
    }
  });

  it('expires messages using message-level expiry when the channel has none', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const now = Date.now();
    const event = signedEvent({
      eventId: 'message-expiry-root',
      groupId: 12,
      authorSeq: 7,
      timestamp: now - 2_000,
      encryptedPayload: JSON.stringify({
        messageText: 'short lived',
        expiryDurationMs: 1_000,
      }),
    });

    expect(db.insertEvent(event, true)).toBe(false);
    expect(db.getRecentMessageEvents(12, 10, 'general')).toHaveLength(0);
    expect(
      db.getSyncState(12)[`${event.authorAddress}:${TEST_AUTHOR_STREAM_ID}`]
    ).toBe(7);
  });

  it('uses the shorter channel expiry when message-level expiry is longer', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const now = Date.now();
    db.upsertChannel({
      groupId: 13,
      channelId: 'short-lived',
      name: 'short-lived',
      position: 2,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      expiryDurationMs: 1_000,
      createdBy: 'Qadmin',
      createdAt: now - 10_000,
      updatedAt: now - 10_000,
    });
    const event = signedEvent({
      eventId: 'channel-expiry-root',
      groupId: 13,
      channelId: 'short-lived',
      authorSeq: 9,
      timestamp: now - 2_000,
      encryptedPayload: JSON.stringify({
        messageText: 'channel wins',
        expiryDurationMs: 60_000,
      }),
    });

    expect(db.insertEvent(event, true)).toBe(false);
    expect(db.getRecentMessageEvents(13, 10, 'short-lived')).toHaveLength(0);
    expect(
      db.getSyncState(13)[`${event.authorAddress}:${TEST_AUTHOR_STREAM_ID}`]
    ).toBe(9);
  });

  it('uses the shorter message-level expiry when channel expiry is longer', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const timestamp = Date.now();
    db.upsertChannel({
      groupId: 14,
      channelId: 'message-shorter',
      name: 'message-shorter',
      position: 2,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      expiryDurationMs: 60_000,
      createdBy: 'Qadmin',
      createdAt: timestamp - 10_000,
      updatedAt: timestamp - 10_000,
    });
    const event = signedEvent({
      eventId: 'message-shorter-expiry-root',
      groupId: 14,
      channelId: 'message-shorter',
      authorSeq: 10,
      timestamp,
      encryptedPayload: JSON.stringify({
        messageText: 'message expiry wins',
        expiryDurationMs: 1_000,
      }),
    });

    expect(db.insertEvent(event, true)).toBe(true);
    expect(db.getEventExpiresAt(event.eventId)).toBe(timestamp + 1_000);
  });

  it('applies channel expiry when metadata arrives after the message', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const timestamp = Date.now();
    const event = signedEvent({
      eventId: 'delayed-channel-expiry-root',
      groupId: 15,
      channelId: 'delayed-expiry',
      authorSeq: 11,
      timestamp,
      encryptedPayload: JSON.stringify({
        messageText: 'metadata arrives later',
      }),
    });

    expect(db.insertEvent(event, false)).toBe(true);
    expect(db.getEventExpiresAt(event.eventId)).toBeNull();
    expect(db.getChannelExpiryReconciliationTargets(15)).toEqual([]);

    db.upsertChannel({
      groupId: 15,
      channelId: 'delayed-expiry',
      name: 'delayed-expiry',
      position: 2,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      expiryDurationMs: 60_000,
      createdBy: 'Qadmin',
      createdAt: timestamp - 1_000,
      updatedAt: timestamp - 1_000,
    });
    expect(db.getChannelExpiryReconciliationTargets(15)).toEqual([
      { groupId: 15, channelId: 'delayed-expiry' },
    ]);
    const resolved = db.reconcileChannelMessageExpiries(15, 'delayed-expiry');

    expect(resolved).toMatchObject({ hasMore: false, pruned: 0 });
    expect(resolved.resolutions).toEqual([
      { eventId: event.eventId, expiresAt: timestamp + 60_000 },
    ]);
    expect(db.getEventExpiresAt(event.eventId)).toBe(timestamp + 60_000);
    expect(db.getChannelExpiryReconciliationTargets(15)).toEqual([]);
  });

  it('applies later channel expiry changes to existing messages', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const timestamp = Date.now();
    const channel = {
      groupId: 16,
      channelId: 'stable-expiry',
      name: 'stable-expiry',
      position: 2,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      expiryDurationMs: 60_000,
      createdBy: 'Qadmin',
      createdAt: timestamp - 1_000,
      updatedAt: timestamp - 1_000,
    };
    db.upsertChannel(channel);
    const [root, edit] = signedAuthorEvents([
      {
        eventId: 'stable-channel-expiry-root',
        groupId: 16,
        channelId: channel.channelId,
        authorSeq: 12,
        timestamp,
        encryptedPayload: JSON.stringify({ messageText: 'original' }),
      },
      {
        eventId: 'stable-channel-expiry-edit',
        groupId: 16,
        channelId: channel.channelId,
        authorSeq: 13,
        timestamp: timestamp + 1,
        eventType: 'edit',
        targetEventId: 'stable-channel-expiry-root',
        encryptedPayload: JSON.stringify({ messageText: 'edited' }),
      },
    ]);

    expect(db.insertEvent(root, true)).toBe(true);
    db.upsertChannel({
      ...channel,
      expiryDurationMs: 1_000,
      updatedAt: timestamp + 1,
    });
    expect(db.insertEvent(edit, true)).toBe(true);
    expect(
      db.reconcileChannelMessageExpiries(16, channel.channelId).resolutions
    ).toEqual([{ eventId: root.eventId, expiresAt: timestamp + 1_000 }]);

    expect(db.getEventExpiresAt(root.eventId)).toBe(timestamp + 1_000);
    expect(db.getRecentMessageEvents(16, 10, channel.channelId)).toMatchObject([
      {
        eventId: root.eventId,
        encryptedPayload: edit.encryptedPayload,
      },
    ]);
    expect(db.getChannelExpiryReconciliationTargets(16)).toEqual([]);
  });

  it('applies a later channel expiry to messages that previously had none', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const timestamp = Date.now();
    const event = signedEvent({
      eventId: 'resolved-no-expiry-root',
      groupId: 17,
      channelId: 'resolved-no-expiry',
      authorSeq: 14,
      timestamp,
      encryptedPayload: JSON.stringify({ messageText: 'keep this message' }),
    });
    const channel = {
      groupId: 17,
      channelId: 'resolved-no-expiry',
      name: 'resolved-no-expiry',
      position: 2,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      createdBy: 'Qadmin',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(db.insertEvent(event, false)).toBe(true);
    db.upsertChannel(channel);
    expect(
      db.reconcileChannelMessageExpiries(17, channel.channelId).resolutions
    ).toEqual([{ eventId: event.eventId, expiresAt: null }]);

    db.upsertChannel({
      ...channel,
      expiryDurationMs: 1_000,
      updatedAt: timestamp + 1,
    });
    expect(
      db.reconcileChannelMessageExpiries(17, channel.channelId).resolutions
    ).toEqual([{ eventId: event.eventId, expiresAt: timestamp + 1_000 }]);
    expect(db.getEventExpiresAt(event.eventId)).toBe(timestamp + 1_000);
  });

  it('applies a delayed channel cap to an explicit message expiry', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const timestamp = Date.now();
    const messageExpiryDurationMs = 72 * 60 * 60 * 1_000;
    const channelExpiryDurationMs = 48 * 60 * 60 * 1_000;
    const event = signedEvent({
      eventId: 'delayed-channel-cap-root',
      groupId: 18,
      channelId: 'delayed-channel-cap',
      authorSeq: 15,
      timestamp,
      encryptedPayload: JSON.stringify({
        messageText: 'channel cap wins',
        expiryDurationMs: messageExpiryDurationMs,
      }),
    });

    expect(db.insertEvent(event, false)).toBe(true);
    expect(db.getEventExpiresAt(event.eventId)).toBe(
      timestamp + messageExpiryDurationMs
    );
    db.upsertChannel({
      groupId: 18,
      channelId: 'delayed-channel-cap',
      name: 'delayed-channel-cap',
      position: 2,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      expiryDurationMs: channelExpiryDurationMs,
      createdBy: 'Qadmin',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(
      db.reconcileChannelMessageExpiries(18, 'delayed-channel-cap').resolutions
    ).toEqual([
      {
        eventId: event.eventId,
        expiresAt: timestamp + channelExpiryDurationMs,
      },
    ]);
    expect(db.getEventExpiresAt(event.eventId)).toBe(
      timestamp + channelExpiryDurationMs
    );
  });

  it('extends and removes channel expiry for messages that still exist', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const timestamp = Date.now();
    const channel = {
      groupId: 19,
      channelId: 'changing-expiry',
      name: 'changing-expiry',
      position: 2,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      expiryDurationMs: 60_000,
      createdBy: 'Qadmin',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.upsertChannel(channel);
    const event = signedEvent({
      eventId: 'changing-expiry-root',
      groupId: channel.groupId,
      channelId: channel.channelId,
      authorSeq: 16,
      timestamp,
      encryptedPayload: JSON.stringify({
        messageText: 'policy follows channel',
      }),
    });

    expect(db.insertEvent(event, false)).toBe(true);
    expect(db.getEventExpiresAt(event.eventId)).toBe(timestamp + 60_000);

    db.upsertChannel({
      ...channel,
      expiryDurationMs: 120_000,
      updatedAt: timestamp + 1,
    });
    db.reconcileChannelMessageExpiries(channel.groupId, channel.channelId);
    expect(db.getEventExpiresAt(event.eventId)).toBe(timestamp + 120_000);

    db.upsertChannel({
      ...channel,
      expiryDurationMs: undefined,
      updatedAt: timestamp + 2,
    });
    db.reconcileChannelMessageExpiries(channel.groupId, channel.channelId);
    expect(db.getEventExpiresAt(event.eventId)).toBeNull();
  });

  it('never extends a message beyond its own shorter expiry', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const timestamp = Date.now();
    const channel = {
      groupId: 20,
      channelId: 'message-cap',
      name: 'message-cap',
      position: 2,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      expiryDurationMs: 60_000,
      createdBy: 'Qadmin',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.upsertChannel(channel);
    const event = signedEvent({
      eventId: 'message-cap-root',
      groupId: channel.groupId,
      channelId: channel.channelId,
      authorSeq: 17,
      timestamp,
      encryptedPayload: JSON.stringify({
        messageText: 'message remains shorter',
        expiryDurationMs: 1_000,
      }),
    });

    expect(db.insertEvent(event, false)).toBe(true);
    db.upsertChannel({
      ...channel,
      expiryDurationMs: 120_000,
      updatedAt: timestamp + 1,
    });
    db.reconcileChannelMessageExpiries(channel.groupId, channel.channelId);
    expect(db.getEventExpiresAt(event.eventId)).toBe(timestamp + 1_000);

    db.upsertChannel({
      ...channel,
      expiryDurationMs: undefined,
      updatedAt: timestamp + 2,
    });
    db.reconcileChannelMessageExpiries(channel.groupId, channel.channelId);
    expect(db.getEventExpiresAt(event.eventId)).toBe(timestamp + 1_000);
  });

  it('persists and resumes bounded channel expiry reconciliation', () => {
    const dbPath = tempDbPath();
    const writer = new ReticulumChatDatabase(dbPath);
    dbs.push(writer);
    const timestamp = Date.now();
    const channel = {
      groupId: 21,
      channelId: 'bounded-expiry',
      name: 'bounded-expiry',
      position: 2,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      expiryDurationMs: 60_000,
      createdBy: 'Qadmin',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writer.upsertChannel(channel);
    const events = signedAuthorEvents(
      Array.from({ length: 3 }, (_, index) => ({
        eventId: `bounded-expiry-${index}`,
        groupId: channel.groupId,
        channelId: channel.channelId,
        authorSeq: index + 1,
        timestamp: timestamp + index,
        encryptedPayload: JSON.stringify({ messageText: `message ${index}` }),
      }))
    );
    for (const event of events)
      expect(writer.insertEvent(event, false)).toBe(true);
    writer.upsertChannel({
      ...channel,
      expiryDurationMs: 120_000,
      updatedAt: timestamp + 10,
    });

    const first = writer.reconcileChannelMessageExpiries(
      channel.groupId,
      channel.channelId,
      2
    );
    expect(first).toMatchObject({ hasMore: true, pruned: 0 });
    expect(first.resolutions.map((item) => item.eventId)).toEqual([
      events[0].eventId,
      events[1].eventId,
    ]);
    expect(
      (writer as any).db
        .prepare(
          `
          SELECT group_id, channel_id, after_timestamp, after_event_id
          FROM rchat_channel_expiry_reconciliation
          WHERE group_id = ? AND channel_id = ?
          LIMIT 1
        `
        )
        .get(channel.groupId, channel.channelId)
    ).toMatchObject({
      after_timestamp: events[1].timestamp,
      after_event_id: events[1].eventId,
    });

    const reader = new ReticulumChatDatabase(dbPath);
    dbs.push(reader);
    expect(
      reader.getChannelExpiryReconciliationTargets(channel.groupId)
    ).toEqual([{ groupId: channel.groupId, channelId: channel.channelId }]);
    const second = reader.reconcileChannelMessageExpiries(
      channel.groupId,
      channel.channelId,
      2
    );
    expect(second).toMatchObject({ hasMore: false, pruned: 0 });
    expect(second.resolutions).toEqual([
      {
        eventId: events[2].eventId,
        expiresAt: events[2].timestamp + 120_000,
      },
    ]);
    expect(
      reader.getChannelExpiryReconciliationTargets(channel.groupId)
    ).toEqual([]);
  });

  it('restarts reconciliation when channel expiry changes between batches', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const timestamp = Date.now();
    const channel = {
      groupId: 22,
      channelId: 'restart-expiry',
      name: 'restart-expiry',
      position: 2,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      expiryDurationMs: 60_000,
      createdBy: 'Qadmin',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.upsertChannel(channel);
    const events = signedAuthorEvents(
      Array.from({ length: 3 }, (_, index) => ({
        eventId: `restart-expiry-${index}`,
        groupId: channel.groupId,
        channelId: channel.channelId,
        authorSeq: index + 1,
        timestamp: timestamp + index,
        encryptedPayload: JSON.stringify({ messageText: `message ${index}` }),
      }))
    );
    for (const event of events) expect(db.insertEvent(event, false)).toBe(true);
    db.upsertChannel({
      ...channel,
      expiryDurationMs: 120_000,
      updatedAt: timestamp + 10,
    });
    expect(
      db.reconcileChannelMessageExpiries(channel.groupId, channel.channelId, 2)
        .resolutions
    ).toHaveLength(2);

    db.upsertChannel({
      ...channel,
      expiryDurationMs: 30_000,
      updatedAt: timestamp + 20,
    });
    const restarted = db.reconcileChannelMessageExpiries(
      channel.groupId,
      channel.channelId,
      2
    );
    expect(restarted.resolutions.map((item) => item.eventId)).toEqual([
      events[0].eventId,
      events[1].eventId,
    ]);
    db.reconcileChannelMessageExpiries(channel.groupId, channel.channelId, 2);
    for (const event of events) {
      expect(db.getEventExpiresAt(event.eventId)).toBe(
        event.timestamp + 30_000
      );
    }
  });

  it('does not resurrect messages removed by a shorter channel expiry', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const now = Date.now();
    const channel = {
      groupId: 23,
      channelId: 'no-resurrection',
      name: 'no-resurrection',
      position: 2,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      createdBy: 'Qadmin',
      createdAt: now - 10_000,
      updatedAt: now - 10_000,
    };
    db.upsertChannel(channel);
    const event = signedEvent({
      eventId: 'no-resurrection-root',
      groupId: channel.groupId,
      channelId: channel.channelId,
      authorSeq: 18,
      timestamp: now - 2_000,
      encryptedPayload: JSON.stringify({ messageText: 'expires permanently' }),
    });
    expect(db.insertEvent(event, false)).toBe(true);

    db.upsertChannel({
      ...channel,
      expiryDurationMs: 1_000,
      updatedAt: now,
    });
    expect(
      db.reconcileChannelMessageExpiries(
        channel.groupId,
        channel.channelId,
        100,
        now
      ).pruned
    ).toBe(1);
    expect(db.getEvent(event.eventId)).toBeNull();

    db.upsertChannel({
      ...channel,
      expiryDurationMs: undefined,
      updatedAt: now + 1,
    });
    db.reconcileChannelMessageExpiries(channel.groupId, channel.channelId);
    expect(db.getEvent(event.eventId)).toBeNull();
  });

  it('shares inserted events across open database connections', () => {
    const dbPath = tempDbPath();
    const writer = new ReticulumChatDatabase(dbPath);
    const reader = new ReticulumChatDatabase(dbPath);
    dbs.push(writer, reader);
    const event = signedEvent({ groupId: 44, authorSeq: 1 });
    expect(writer.insertEvent(event, true)).toBe(true);
    expect(reader.getEvent(event.eventId)?.eventId).toBe(event.eventId);
    expect(
      reader.getRecentEvents(44, 10).map((item) => item.eventId)
    ).toContain(event.eventId);
  });

  it('projects many edits into one visible message history row', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const events = signedAuthorEvents([
      {
        eventId: 'root-message',
        groupId: 45,
        channelId: 'general',
        authorSeq: 1,
        timestamp: 1000,
        eventType: 'message',
        encryptedPayload: JSON.stringify({ messageText: 'original' }),
      },
      ...Array.from({ length: 199 }, (_, index) => ({
        eventId: `edit-${index + 1}`,
        groupId: 45,
        channelId: 'general',
        authorSeq: index + 2,
        timestamp: 1001 + index,
        eventType: 'edit' as const,
        targetEventId: 'root-message',
        encryptedPayload: JSON.stringify({ messageText: `edit-${index + 1}` }),
      })),
    ]);
    for (const event of events) {
      db.insertEvent(event, true);
    }

    expect(db.getRecentEvents(45, 200, 'general')).toHaveLength(200);
    const visible = db.getRecentMessageEvents(45, 200, 'general');
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      eventId: 'root-message',
      eventType: 'message',
      encryptedPayload: JSON.stringify({ messageText: 'edit-199' }),
    });
  });

  it('hides deleted messages from visible message history', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const events = signedAuthorEvents([
      {
        eventId: 'delete-root-message',
        groupId: 46,
        channelId: 'general',
        authorSeq: 1,
        timestamp: 1000,
        eventType: 'message',
      },
      {
        eventId: 'delete-event',
        groupId: 46,
        channelId: 'general',
        authorSeq: 2,
        timestamp: 1001,
        eventType: 'delete',
        targetEventId: 'delete-root-message',
      },
    ]);
    for (const event of events) {
      db.insertEvent(event, true);
    }

    expect(db.getRecentMessageEvents(46, 200, 'general')).toEqual([]);
  });

  it('rejects message mutations outside the root author and scope', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const [root, wrongGroupDelete, wrongChannelEdit] = signedAuthorEvents([
      {
        eventId: 'authorized-mutation-root',
        groupId: 146,
        channelId: 'general',
        authorSeq: 1,
        timestamp: 1_000,
        eventType: 'message',
        encryptedPayload: JSON.stringify({ messageText: 'keep me' }),
      },
      {
        eventId: 'wrong-group-delete',
        groupId: 147,
        channelId: 'general',
        authorSeq: 2,
        timestamp: 1_001,
        eventType: 'delete',
        targetEventId: 'authorized-mutation-root',
      },
      {
        eventId: 'wrong-channel-edit',
        groupId: 146,
        channelId: 'other',
        authorSeq: 3,
        timestamp: 1_002,
        eventType: 'edit',
        targetEventId: 'authorized-mutation-root',
        encryptedPayload: JSON.stringify({ messageText: 'wrong channel' }),
      },
    ]);
    const attackerDelete = signedEvent({
      eventId: 'cross-author-delete',
      groupId: 146,
      channelId: 'general',
      authorSeq: 1,
      timestamp: 1_003,
      eventType: 'delete',
      targetEventId: root.eventId,
    });

    expect(db.insertEvent(root, true)).toBe(true);
    expect(db.insertEvent(attackerDelete, false)).toBe(false);
    expect(db.insertEvent(wrongGroupDelete, false)).toBe(false);
    expect(db.insertEvent(wrongChannelEdit, false)).toBe(false);
    expect(db.getRecentMessageEvents(146, 10, 'general')).toMatchObject([
      { eventId: root.eventId, encryptedPayload: root.encryptedPayload },
    ]);
  });

  it('stores an out-of-order mutation but applies it only after author and scope match', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const [root, validEdit] = signedAuthorEvents([
      {
        eventId: 'out-of-order-root',
        groupId: 148,
        channelId: 'general',
        authorSeq: 1,
        timestamp: 2_000,
        eventType: 'message',
        encryptedPayload: JSON.stringify({ messageText: 'original' }),
      },
      {
        eventId: 'out-of-order-edit',
        groupId: 148,
        channelId: 'general',
        authorSeq: 2,
        timestamp: 2_001,
        eventType: 'edit',
        targetEventId: 'out-of-order-root',
        encryptedPayload: JSON.stringify({ messageText: 'updated' }),
      },
    ]);
    const attackerDelete = signedEvent({
      eventId: 'out-of-order-attacker-delete',
      groupId: 148,
      channelId: 'general',
      authorSeq: 1,
      timestamp: 1_999,
      eventType: 'delete',
      targetEventId: root.eventId,
    });

    expect(db.insertEvent(attackerDelete, false)).toBe(true);
    expect(db.insertEvent(validEdit, false)).toBe(true);
    expect(db.getRecentMessageEvents(148, 10, 'general')).toEqual([]);
    expect(db.insertEvent(root, false)).toBe(true);
    expect(db.getRecentMessageEvents(148, 10, 'general')).toMatchObject([
      { eventId: root.eventId, encryptedPayload: validEdit.encryptedPayload },
    ]);
  });

  it('scrubs deleted message payloads while keeping a tombstone row', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionHash = hashReticulumChatMentionAddress('Qmentioned');
    const events = signedAuthorEvents([
      {
        eventId: 'scrub-root-message',
        groupId: 46,
        channelId: 'general',
        authorSeq: 1,
        timestamp: 1000,
        eventType: 'message',
        encryptedPayload: JSON.stringify({
          messageText: 'delete me permanently',
        }),
        mentionAddressHashes: [mentionHash],
      },
      {
        eventId: 'scrub-edit-message',
        groupId: 46,
        channelId: 'general',
        authorSeq: 2,
        timestamp: 1001,
        eventType: 'edit',
        targetEventId: 'scrub-root-message',
        encryptedPayload: JSON.stringify({
          messageText: 'edited private text',
        }),
      },
      {
        eventId: 'scrub-delete-event',
        groupId: 46,
        channelId: 'general',
        authorSeq: 3,
        timestamp: 1002,
        eventType: 'delete',
        targetEventId: 'scrub-root-message',
        encryptedPayload: JSON.stringify({ type: 'delete' }),
      },
    ]);

    for (const event of events) db.insertEvent(event, true);

    expect(db.hasEvent('scrub-root-message')).toBe(true);
    expect(db.isEventPayloadScrubbed('scrub-root-message')).toBe(true);
    expect(db.isEventPayloadScrubbed('scrub-edit-message')).toBe(true);
    expect(db.isEventPayloadScrubbed('scrub-delete-event')).toBe(false);
    expect(db.getRecentMessageEvents(46, 200, 'general')).toEqual([]);
    expect(
      db.getGroupFeedPageAfter(46, null, 10).map((event) => event.eventId)
    ).toEqual(['scrub-delete-event']);
    expect(
      db
        .getAuthorEventsRange(
          46,
          events[0].authorAddress,
          events[0].authorStreamId,
          1,
          3,
          10
        )
        .map((event) => event.eventId)
    ).toEqual(['scrub-delete-event']);
    expect(db.searchEvents('permanently', { groupIds: [46] })).toEqual([]);
    expect(db.searchEvents('private', { groupIds: [46] })).toEqual([]);

    const scrubbedRoot = db.getEvent('scrub-root-message');
    const scrubbedEdit = db.getEvent('scrub-edit-message');
    expect(scrubbedRoot?.encryptedPayload).not.toContain(
      'delete me permanently'
    );
    expect(scrubbedEdit?.encryptedPayload).not.toContain('edited private text');
    expect(scrubbedRoot?.mentionAddressHashes).toEqual([]);
    expect(scrubbedRoot && verifyReticulumChatEvent(scrubbedRoot)).toBe(false);
    expect(
      db.getEvent('scrub-delete-event') &&
        verifyReticulumChatEvent(db.getEvent('scrub-delete-event')!)
    ).toBe(true);
  });

  it('scrubs late-arriving original payloads when the delete tombstone already exists', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const events = signedAuthorEvents([
      {
        eventId: 'late-root-message',
        groupId: 146,
        channelId: 'general',
        authorSeq: 1,
        timestamp: 1000,
        eventType: 'message',
        encryptedPayload: JSON.stringify({ messageText: 'late deleted text' }),
      },
      {
        eventId: 'late-delete-event',
        groupId: 146,
        channelId: 'general',
        authorSeq: 2,
        timestamp: 1001,
        eventType: 'delete',
        targetEventId: 'late-root-message',
        encryptedPayload: JSON.stringify({ type: 'delete' }),
      },
    ]);

    db.insertEvent(events[1], true);
    db.insertEvent(events[0], true);

    expect(db.hasEvent('late-root-message')).toBe(true);
    expect(db.isEventPayloadScrubbed('late-root-message')).toBe(true);
    expect(db.getEvent('late-root-message')?.encryptedPayload).not.toContain(
      'late deleted text'
    );
    expect(db.getRecentMessageEvents(146, 200, 'general')).toEqual([]);
  });

  it('keeps deleted message payloads scrubbed when reopening the database', () => {
    const dbPath = tempDbPath();
    const initialDb = new ReticulumChatDatabase(dbPath);
    const events = signedAuthorEvents([
      {
        eventId: 'existing-root-message',
        groupId: 246,
        channelId: 'general',
        authorSeq: 1,
        timestamp: 1000,
        eventType: 'message',
        encryptedPayload: JSON.stringify({
          messageText: 'existing deleted text',
        }),
      },
      {
        eventId: 'existing-delete-event',
        groupId: 246,
        channelId: 'general',
        authorSeq: 2,
        timestamp: 1001,
        eventType: 'delete',
        targetEventId: 'existing-root-message',
        encryptedPayload: JSON.stringify({ type: 'delete' }),
      },
    ]);

    for (const event of events) {
      initialDb.insertEvent(event, true);
    }
    expect(initialDb.isEventPayloadScrubbed('existing-root-message')).toBe(
      true
    );
    initialDb.close();

    const reopenedDb = new ReticulumChatDatabase(dbPath);
    dbs.push(reopenedDb);

    expect(reopenedDb.hasEvent('existing-root-message')).toBe(true);
    expect(
      reopenedDb.getEvent('existing-root-message')?.encryptedPayload
    ).not.toContain('existing deleted text');
    expect(reopenedDb.isEventPayloadScrubbed('existing-root-message')).toBe(
      true
    );
    expect(
      reopenedDb.getEvent('existing-delete-event') &&
        verifyReticulumChatEvent(reopenedDb.getEvent('existing-delete-event')!)
    ).toBe(true);
    expect(reopenedDb.getRecentMessageEvents(246, 200, 'general')).toEqual([]);
  });

  it('removes projected messages when raw message events are evicted', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({
      eventId: 'evicted-root-message',
      groupId: 47,
      channelId: 'general',
      eventType: 'message',
    });
    db.insertEvent(event, false);
    expect(db.getRecentMessageEvents(47, 200, 'general')).toHaveLength(1);

    (db as any).deleteCachedEvent(event.eventId);

    expect(db.getEvent(event.eventId)).toBeNull();
    expect(db.getRecentMessageEvents(47, 200, 'general')).toEqual([]);
  });

  it('keeps author sequence heads stable after raw relay payload eviction', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({
      eventId: 'evicted-author-head',
      groupId: 48,
      authorSeq: 37,
    });
    expect(db.insertEvent(event, false)).toBe(true);
    const before = db.getAllAuthorSequenceHeads(48);

    (db as any).deleteCachedEvent(event.eventId);

    expect(db.getEvent(event.eventId)).toBeNull();
    expect(db.getAllAuthorSequenceHeads(48)).toEqual(before);
    expect(
      db.getAuthorMaxSeq(48, event.authorAddress, event.authorStreamId)
    ).toBe(37);
    expect(
      db.getSyncState(48)[`${event.authorAddress}:${event.authorStreamId}`]
    ).toBe(37);
  });

  it('searches indexed public event payloads by group', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const matching = signedEvent({
      eventId: 'event-search-match',
      groupId: 42,
      encryptedPayload: JSON.stringify({
        messageText: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'alpha searchable phrase' }],
            },
          ],
        },
        specialId: 'internal-tracking-id',
        repliedTo: 'internal-reply-event-id',
        mentionedAddresses: ['QinternalMentionAddress'],
      }),
    });
    const otherGroup = signedEvent({
      eventId: 'event-search-other-group',
      groupId: 43,
      encryptedPayload: JSON.stringify({
        messageText: 'alpha searchable phrase',
      }),
    });
    db.insertEvent(matching, true);
    db.insertEvent(otherGroup, true);

    expect(
      db
        .searchEvents('searchable', { groupIds: [42] })
        .map((item) => item.event.eventId)
    ).toEqual([matching.eventId]);
    expect(db.searchEvents('alpha phrase', { groupIds: [99] })).toEqual([]);
    expect(db.searchEvents('tracking', { groupIds: [42] })).toEqual([]);
    expect(db.searchEvents('reply-event', { groupIds: [42] })).toEqual([]);
    expect(db.searchEvents('internalMention', { groupIds: [42] })).toEqual([]);
  });

  it('filters message search by author, channel, type, link, date and sort', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const [aliceGeneral, aliceAttachment, aliceLink, aliceImage, aliceFile] =
      signedAuthorEvents([
        {
          eventId: 'event-search-filter-alice-general',
          groupId: 420,
          channelId: 'general',
          authorSeq: 1,
          timestamp: 1_000,
          encryptedPayload: JSON.stringify({
            messageText: 'alpha general note',
          }),
        },
        {
          eventId: 'event-search-filter-alice-attachment',
          groupId: 420,
          channelId: 'ops',
          authorSeq: 2,
          timestamp: 2_000,
          eventType: 'attachment_manifest',
          encryptedPayload: JSON.stringify({
            messageText: 'alpha attachment manifest',
            attachments: [{ name: 'report.pdf' }],
          }),
        },
        {
          eventId: 'event-search-filter-alice-link',
          groupId: 420,
          channelId: 'ops',
          authorSeq: 3,
          timestamp: 3_000,
          encryptedPayload: JSON.stringify({
            messageText: 'alpha link https://example.com',
          }),
        },
        {
          eventId: 'event-search-filter-alice-image',
          groupId: 420,
          channelId: 'general',
          authorSeq: 4,
          timestamp: 5_000,
          encryptedPayload: JSON.stringify({
            messageText: 'alpha image resource',
            images: [
              {
                reticulumResource: true,
                fileHash: 'a'.repeat(64),
                fileName: 'photo.webp',
              },
            ],
          }),
        },
        {
          eventId: 'event-search-filter-alice-file',
          groupId: 420,
          channelId: 'general',
          authorSeq: 5,
          timestamp: 6_000,
          encryptedPayload: JSON.stringify({
            messageText: 'alpha file resource',
            attachments: [
              {
                reticulumResource: true,
                fileHash: 'b'.repeat(64),
                fileName: 'report.pdf',
              },
            ],
          }),
        },
      ]);
    const bobGeneral = signedEvent({
      eventId: 'event-search-filter-bob-general',
      groupId: 420,
      channelId: 'general',
      timestamp: 4_000,
      encryptedPayload: JSON.stringify({ messageText: 'alpha bob note' }),
    });
    [
      aliceGeneral,
      aliceAttachment,
      aliceLink,
      aliceImage,
      aliceFile,
      bobGeneral,
    ].forEach((event) => db.insertEvent(event, true));

    expect(
      db
        .searchEvents('', {
          groupIds: [420],
          authorAddresses: [aliceGeneral.authorAddress],
          sort: 'oldest',
        })
        .map((item) => item.event.eventId)
    ).toEqual([
      aliceGeneral.eventId,
      aliceAttachment.eventId,
      aliceLink.eventId,
      aliceImage.eventId,
      aliceFile.eventId,
    ]);
    expect(
      db
        .searchEvents('alpha', {
          groupIds: [420],
          channelIds: ['ops'],
          sort: 'oldest',
        })
        .map((item) => item.event.eventId)
    ).toEqual([aliceAttachment.eventId, aliceLink.eventId]);
    expect(
      db
        .searchEvents('', { groupIds: [420], hasAttachment: true })
        .map((item) => item.event.eventId)
    ).toEqual([aliceFile.eventId, aliceAttachment.eventId]);
    expect(
      db
        .searchEvents('', { groupIds: [420], hasLink: true })
        .map((item) => item.event.eventId)
    ).toEqual([aliceLink.eventId]);
    expect(
      db
        .searchEvents('', {
          groupIds: [420],
          sort: 'oldest',
          limit: 2,
          offset: 2,
        })
        .map((item) => item.event.eventId)
    ).toEqual([aliceLink.eventId, bobGeneral.eventId]);
    const oldestFirstPage = db.searchEvents('', {
      groupIds: [420],
      sort: 'oldest',
      limit: 2,
    });
    expect(oldestFirstPage.map((item) => item.event.eventId)).toEqual([
      aliceGeneral.eventId,
      aliceAttachment.eventId,
    ]);
    expect(
      db
        .searchEvents('', {
          groupIds: [420],
          sort: 'oldest',
          limit: 2,
          cursor: oldestFirstPage[1]?.cursor,
        })
        .map((item) => item.event.eventId)
    ).toEqual([aliceLink.eventId, bobGeneral.eventId]);
    expect(
      db
        .searchEvents('', {
          groupIds: [420],
          afterTimestamp: 2_000,
          beforeTimestamp: 4_000,
          sort: 'oldest',
        })
        .map((item) => item.event.eventId)
    ).toEqual([aliceAttachment.eventId, aliceLink.eventId]);
  });

  it('indexes decrypted search text for encrypted/private events', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({
      eventId: 'event-private-search',
      groupId: 51,
      encryptedPayload: 'opaque-ciphertext',
    });
    db.insertEvent(event, true);
    expect(db.searchEvents('private needle')).toEqual([]);

    expect(
      db.indexSearchText(event.eventId, 'private needle after decrypt')
    ).toBe(true);
    expect(
      db.searchEvents('needle', { groupIds: [51] })[0]?.event.eventId
    ).toBe(event.eventId);
  });

  it('replaces and deletes search text for edit and delete events', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({
      eventId: 'event-search-delete-target',
      groupId: 62,
      encryptedPayload: JSON.stringify({
        messageText: 'original searchable text',
      }),
    });
    db.insertEvent(event, true);

    expect(db.indexSearchText(event.eventId, 'edited replacement text')).toBe(
      true
    );
    expect(db.searchEvents('original', { groupIds: [62] })).toEqual([]);
    expect(
      db.searchEvents('replacement', { groupIds: [62] })[0]?.event.eventId
    ).toBe(event.eventId);

    expect(db.deleteSearchText(event.eventId)).toBe(true);
    expect(db.searchEvents('replacement', { groupIds: [62] })).toEqual([]);
  });

  it('updates projected search text once when edits and deletes are stored', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const timestamp = Date.now();
    const [root, edit, deleteEvent] = signedAuthorEvents([
      {
        eventId: 'event-ingested-search-root',
        groupId: 262,
        authorSeq: 1,
        timestamp,
        encryptedPayload: JSON.stringify({
          messageText: 'original ingestion text',
          mentionedAddresses: [],
        }),
      },
      {
        eventId: 'event-ingested-search-edit',
        groupId: 262,
        authorSeq: 2,
        timestamp: timestamp + 1,
        eventType: 'edit',
        targetEventId: 'event-ingested-search-root',
        encryptedPayload: JSON.stringify({
          messageText: 'replacement ingestion text',
          mentionedAddresses: [],
        }),
      },
      {
        eventId: 'event-ingested-search-delete',
        groupId: 262,
        authorSeq: 3,
        timestamp: timestamp + 2,
        eventType: 'delete',
        targetEventId: 'event-ingested-search-root',
        encryptedPayload: JSON.stringify({ messageText: '' }),
      },
    ]);

    expect(db.insertEvent(root, true)).toBe(true);
    expect(db.searchEvents('original', { groupIds: [262] })).toHaveLength(1);
    expect(db.insertEvent(edit, true)).toBe(true);
    expect(db.searchEvents('original', { groupIds: [262] })).toEqual([]);
    expect(
      db.searchEvents('replacement', { groupIds: [262] })[0]?.event.eventId
    ).toBe(root.eventId);
    expect(db.insertEvent(deleteEvent, true)).toBe(true);
    expect(db.searchEvents('replacement', { groupIds: [262] })).toEqual([]);
  });

  it('does not let stale rendered message events overwrite projected search text', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const baseTimestamp = Date.now();
    const [root, olderEdit, newerEdit] = signedAuthorEvents([
      {
        eventId: 'event-search-projection-root',
        groupId: 262,
        authorSeq: 1,
        timestamp: baseTimestamp,
        encryptedPayload: JSON.stringify({
          messageText: 'original stale text',
        }),
      },
      {
        eventId: 'event-search-projection-old-edit',
        groupId: 262,
        authorSeq: 2,
        timestamp: baseTimestamp + 1,
        eventType: 'edit',
        targetEventId: 'event-search-projection-root',
        encryptedPayload: JSON.stringify({ messageText: 'older edit text' }),
      },
      {
        eventId: 'event-search-projection-new-edit',
        groupId: 262,
        authorSeq: 3,
        timestamp: baseTimestamp + 2,
        eventType: 'edit',
        targetEventId: 'event-search-projection-root',
        encryptedPayload: JSON.stringify({ messageText: 'newer winning text' }),
      },
    ]);

    db.insertEvent(root, true);
    db.insertEvent(newerEdit, true);
    expect(db.indexSearchText(newerEdit.eventId, 'newer winning text')).toBe(
      true
    );
    expect(db.indexSearchText(root.eventId, 'original stale text')).toBe(false);
    db.insertEvent(olderEdit, true);
    expect(db.indexSearchText(olderEdit.eventId, 'older edit text')).toBe(
      false
    );

    expect(
      db.searchEvents('winning', { groupIds: [262] })[0]?.event.eventId
    ).toBe(root.eventId);
    expect(db.searchEvents('older', { groupIds: [262] })).toEqual([]);
    expect(db.searchEvents('original', { groupIds: [262] })).toEqual([]);
  });

  it('does not re-index search text for deleted projected messages', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const baseTimestamp = Date.now();
    const [root, deleteEvent] = signedAuthorEvents([
      {
        eventId: 'event-search-deleted-root',
        groupId: 263,
        authorSeq: 1,
        timestamp: baseTimestamp,
        encryptedPayload: JSON.stringify({
          messageText: 'deleted searchable text',
        }),
      },
      {
        eventId: 'event-search-delete-root',
        groupId: 263,
        authorSeq: 2,
        timestamp: baseTimestamp + 1,
        eventType: 'delete',
        targetEventId: 'event-search-deleted-root',
        encryptedPayload: JSON.stringify({ messageText: '' }),
      },
    ]);

    db.insertEvent(root, true);
    db.insertEvent(deleteEvent, true);

    expect(db.indexSearchText(root.eventId, 'deleted searchable text')).toBe(
      false
    );
    expect(db.searchEvents('deleted', { groupIds: [263] })).toEqual([]);
  });

  it('tracks unread mentions by mentioned address', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({
      eventId: 'event-mention-target',
      groupId: 63,
      authorAddress: 'Qauthor',
      mentionAddressHashes: [hashReticulumChatMentionAddress('Qmentioned')],
    });
    db.insertEvent(event, true);

    expect(db.replaceMentionsForEvent(event.eventId, ['Qmentioned'])).toBe(
      true
    );
    expect(db.getChatSummaries('Qmentioned')[0]).toMatchObject({
      groupId: 63,
      mentionCount: 1,
      hasUnreadMention: true,
    });

    db.markRead(63, event.timestamp, 'Qmentioned');
    expect(db.getChatSummaries('Qmentioned')[0]).toMatchObject({
      mentionCount: 0,
      hasUnreadMention: false,
    });
  });

  it('indexes payload mention addresses when an event is stored', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = 'QpayloadMention';
    const event = signedEvent({
      eventId: 'event-payload-mention',
      groupId: 263,
      authorAddress: 'Qauthor',
      encryptedPayload: JSON.stringify({
        messageText: 'hello',
        mentionedAddresses: [mentionedAddress],
      }),
      mentionAddressHashes: [hashReticulumChatMentionAddress(mentionedAddress)],
    });

    expect(db.insertEvent(event, true)).toBe(true);
    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      groupId: 263,
      mentionCount: 1,
      hasUnreadMention: true,
    });
  });

  it('keeps read watermarks separate for local accounts sharing one db', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const accountA = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const accountB = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const event = signedEvent({
      eventId: 'event-shared-db-unread',
      groupId: 65,
      timestamp: Date.now(),
    });
    expect(db.insertEvent(event, true)).toBe(true);

    expect(db.getChatSummaries(accountA)[0]?.unreadCount).toBe(1);
    expect(db.getChatSummaries(accountB)[0]?.unreadCount).toBe(1);

    db.markRead(65, event.timestamp, accountB);

    expect(db.getChatSummaries(accountB)[0]?.unreadCount).toBe(0);
    expect(db.getChatSummaries(accountA)[0]?.unreadCount).toBe(1);
  });

  it('counts unread replies to local messages separately from ordinary unread messages', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const groupId = 165;
    const baseTimestamp = Date.now() - 10_000;
    const [localRoot, localReply] = signedAuthorEvents([
      {
        eventId: 'reply-count-local-root',
        groupId,
        channelId: 'general',
        authorSeq: 1,
        timestamp: baseTimestamp,
      },
      {
        eventId: 'reply-count-local-reply',
        groupId,
        channelId: 'general',
        authorSeq: 2,
        timestamp: baseTimestamp + 4_000,
        replyToEventId: 'reply-count-local-root',
      },
    ]);
    const [ordinaryMessage, remoteReply, deleteRemoteReply] =
      signedAuthorEvents([
        {
          eventId: 'reply-count-ordinary-message',
          groupId,
          channelId: 'general',
          authorSeq: 1,
          timestamp: baseTimestamp + 1_000,
        },
        {
          eventId: 'reply-count-remote-reply',
          groupId,
          channelId: 'general',
          authorSeq: 2,
          timestamp: baseTimestamp + 2_000,
          replyToEventId: 'reply-count-local-root',
        },
        {
          eventId: 'reply-count-delete-remote-reply',
          groupId,
          channelId: 'general',
          authorSeq: 3,
          timestamp: baseTimestamp + 5_000,
          eventType: 'delete',
          targetEventId: 'reply-count-remote-reply',
        },
      ]);
    const crossChannelReply = signedEvent({
      eventId: 'reply-count-cross-channel-reply',
      groupId,
      channelId: 'other',
      timestamp: baseTimestamp + 3_000,
      replyToEventId: 'reply-count-local-root',
    });
    const readerAddress = localRoot.authorAddress;

    expect(db.insertEvent(localRoot, true)).toBe(true);
    db.markRead(groupId, 'general', localRoot.timestamp, readerAddress);
    expect(db.insertEvent(ordinaryMessage, false)).toBe(true);
    expect(db.insertEvent(remoteReply, false)).toBe(true);
    expect(db.insertEvent(crossChannelReply, false)).toBe(true);
    expect(db.insertEvent(localReply, true)).toBe(true);

    const summary = db
      .getChatSummaries(readerAddress)
      .find((entry) => entry.groupId === groupId);
    expect(summary).toMatchObject({
      unreadCount: 3,
      replyCount: 1,
    });
    expect(
      summary?.channels.find((channel) => channel.channelId === 'general')
    ).toMatchObject({
      unreadCount: 2,
      replyCount: 1,
    });
    expect(
      summary?.channels.find((channel) => channel.channelId === 'other')
    ).toMatchObject({
      unreadCount: 1,
      replyCount: 0,
    });

    expect(db.insertEvent(deleteRemoteReply, false)).toBe(true);
    expect(
      db
        .getChatSummaries(readerAddress)
        .find((entry) => entry.groupId === groupId)
        ?.channels.find((channel) => channel.channelId === 'general')
    ).toMatchObject({
      unreadCount: 1,
      replyCount: 0,
    });

    db.markRead(groupId, 'general', deleteRemoteReply.timestamp, readerAddress);
    expect(
      db
        .getChatSummaries(readerAddress)
        .find((entry) => entry.groupId === groupId)
        ?.channels.find((channel) => channel.channelId === 'general')
    ).toMatchObject({
      unreadCount: 0,
      replyCount: 0,
    });
  });

  it('does not count archived channels in unread group summaries', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const reader = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const groupId = 164;
    const baseTimestamp = Date.now() - 10_000;
    db.upsertChannel({
      groupId,
      channelId: 'archived',
      name: 'archived',
      position: 1,
      archived: true,
      createdBy: 'Qadmin',
      createdAt: baseTimestamp,
      updatedAt: baseTimestamp,
    });
    const visibleEvent = signedEvent({
      eventId: 'event-visible-read',
      groupId,
      channelId: 'general',
      timestamp: baseTimestamp,
    });
    const archivedMention = signedEvent({
      eventId: 'event-archived-unread',
      groupId,
      channelId: 'archived',
      timestamp: baseTimestamp + 1_000,
      mentionAddressHashes: [hashReticulumChatMentionAddress(reader)],
    });
    expect(db.insertEvent(visibleEvent, true)).toBe(true);
    expect(db.insertEvent(archivedMention, true)).toBe(true);
    db.markRead(groupId, 'general', visibleEvent.timestamp, reader);

    const summary = db
      .getChatSummaries(reader)
      .find((entry) => entry.groupId === groupId);
    expect(summary).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
      hasUnreadMention: false,
    });
    expect(summary?.lastEvent?.eventId).toBe(visibleEvent.eventId);
    expect(
      summary?.channels?.map((channel) => channel.channelId)
    ).not.toContain('archived');
  });

  it('tracks unread mention hints from event address hashes', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const event = signedEvent({
      eventId: 'event-mention-hash-target',
      groupId: 66,
      authorAddress: 'Qauthor',
      mentionAddressHashes: [hashReticulumChatMentionAddress(mentionedAddress)],
    });
    db.insertEvent(event, true);

    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      groupId: 66,
      mentionCount: 1,
      hasUnreadMention: true,
    });

    db.markRead(66, event.timestamp, mentionedAddress);
    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      mentionCount: 0,
      hasUnreadMention: false,
    });
  });

  it('stores events while bounding effective direct mention hashes', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const event = signedEvent({
      eventId: 'event-bounded-direct-mention-hashes',
      groupId: 266,
      mentionAddressHashes: [
        ...Array.from({ length: 32 }, (_, index) =>
          nodeCrypto
            .createHash('sha256')
            .update(`other-mention-${index}`)
            .digest('hex')
        ),
        hashReticulumChatMentionAddress(mentionedAddress),
      ],
    });

    expect(validateReticulumChatEventShape(event)).toBe(true);
    expect(db.insertEvent(event, false)).toBe(true);
    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      mentionCount: 0,
      hasUnreadMention: false,
    });
  });

  it('tracks authorized semantic @everyone mention targets', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const event = signedEvent({
      eventId: 'event-semantic-everyone-target',
      groupId: 166,
      mentionTargets: [{ type: 'everyone', groupId: 166 }],
    });
    expect(validateReticulumChatEventShape(event)).toBe(true);
    expect(verifyReticulumChatEvent(event)).toBe(true);
    expect(db.insertEvent(event, true, 1)).toBe(true);
    expect(db.getPrivilegedMentionStatus(event.eventId)).toBe(1);

    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      groupId: 166,
      mentionCount: 1,
      hasUnreadMention: true,
    });
  });

  it('fails closed until a privileged mention is locally authorized', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const event = signedEvent({
      eventId: 'event-semantic-everyone-pending',
      groupId: 266,
      mentionTargets: [{ type: 'everyone', groupId: 266 }],
    });
    expect(db.insertEvent(event, false, 2)).toBe(true);

    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      mentionCount: 0,
      hasUnreadMention: false,
    });

    expect(db.updatePrivilegedMentionStatus(event.eventId, 1)).toBe(true);
    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      mentionCount: 1,
      hasUnreadMention: true,
    });
  });

  it('does not let direct hashes bypass rejected privileged mentions', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const event = signedEvent({
      eventId: 'event-rejected-everyone-with-direct-hash',
      groupId: 267,
      mentionAddressHashes: [hashReticulumChatMentionAddress(mentionedAddress)],
      mentionTargets: [{ type: 'everyone', groupId: 267 }],
    });
    expect(db.insertEvent(event, false, 0)).toBe(true);
    expect(db.replaceMentionsForEvent(event.eventId, [mentionedAddress])).toBe(
      true
    );

    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      mentionCount: 0,
      hasUnreadMention: false,
    });
  });

  it('does not trust legacy persisted mention rows without signed local authorization', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const authorAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const row = {
      author_address: authorAddress,
      encrypted_payload: 'ciphertext',
      mention_address_hashes: JSON.stringify([
        hashReticulumChatMentionAddress(mentionedAddress),
      ]),
      mention_targets: JSON.stringify([{ type: 'everyone', groupId: 267 }]),
      privileged_mention_status: 0,
      projection_author_address: authorAddress,
      timestamp: Date.now(),
    };
    (db as any).stmtGetUnreadMentionRecords = {
      all: () => [row],
    };

    const countStoredMentions = () =>
      (db as any).countValidatedStoredUnreadMentions(
        267,
        'general',
        mentionedAddress,
        0,
        Date.now(),
        new Set(),
        new Map()
      );

    expect(countStoredMentions()).toBe(0);
    row.privileged_mention_status = 1;
    expect(countStoredMentions()).toBe(1);
    row.mention_address_hashes = '[]';
    expect(countStoredMentions()).toBe(0);
  });

  it('detects privileged markup even when a modified sender omits semantic targets', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const event = signedEvent({
      eventId: 'event-privileged-markup-without-target',
      groupId: 268,
      encryptedPayload: JSON.stringify({
        messageText:
          '<p><span class="mention" data-type="mention" data-id="ordinary-user">@everyone</span></p>',
      }),
      mentionAddressHashes: [hashReticulumChatMentionAddress(mentionedAddress)],
      mentionTargets: [],
    });
    expect(db.insertEvent(event, false, 0)).toBe(true);
    expect(db.replaceMentionsForEvent(event.eventId, [mentionedAddress])).toBe(
      true
    );

    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      mentionCount: 0,
      hasUnreadMention: false,
    });
  });

  it('detects a structured privileged label even when its mention id is forged', () => {
    expect(
      reticulumChatPayloadHasPrivilegedMention(
        JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'mention',
              attrs: { id: 'ordinary-user', label: 'everyone' },
            },
          ],
        })
      )
    ).toBe(true);
  });

  it('does not treat unrelated HTML metadata as a privileged mention', () => {
    expect(
      reticulumChatPayloadHasPrivilegedMention(
        JSON.stringify({
          messageText: '<div data-label="everyone">ordinary content</div>',
        })
      )
    ).toBe(false);
  });

  it('fails closed for excessively complex structured mention payloads', () => {
    expect(
      reticulumChatPayloadHasPrivilegedMention(
        JSON.stringify({ content: Array.from({ length: 4096 }, () => null) })
      )
    ).toBe(true);
  });

  it('only applies @here targets for messages created during this app session', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const onlineSince = Date.now();
    const beforeOnline = signedEvent({
      eventId: 'event-here-before-online',
      groupId: 167,
      authorSeq: 1,
      timestamp: onlineSince - 5_000,
      mentionTargets: [
        {
          type: 'here',
          groupId: 167,
          channelId: 'general',
          createdAt: onlineSince - 5_000,
        },
      ],
    });
    const afterOnline = signedEvent({
      eventId: 'event-here-after-online',
      groupId: 167,
      authorSeq: 2,
      timestamp: onlineSince + 5_000,
      mentionTargets: [
        {
          type: 'here',
          groupId: 167,
          channelId: 'general',
          createdAt: onlineSince + 5_000,
        },
      ],
    });
    db.insertEvent(beforeOnline, true, 1);
    db.insertEvent(afterOnline, true, 1);

    expect(db.getChatSummaries(mentionedAddress, onlineSince)[0]).toMatchObject(
      {
        groupId: 167,
        mentionCount: 1,
        hasUnreadMention: true,
      }
    );
  });

  it('applies edit and delete state to semantic mention target summaries', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const baseTimestamp = Date.now();
    const [original, editAddsEveryone, editRemovesEveryone] =
      signedAuthorEvents([
        {
          eventId: 'event-semantic-edit-original',
          groupId: 168,
          authorSeq: 1,
          timestamp: baseTimestamp,
          mentionTargets: [],
        },
        {
          eventId: 'event-semantic-edit-adds',
          groupId: 168,
          authorSeq: 2,
          timestamp: baseTimestamp + 1,
          eventType: 'edit',
          targetEventId: 'event-semantic-edit-original',
          mentionTargets: [{ type: 'everyone', groupId: 168 }],
        },
        {
          eventId: 'event-semantic-edit-removes',
          groupId: 168,
          authorSeq: 3,
          timestamp: baseTimestamp + 2,
          eventType: 'edit',
          targetEventId: 'event-semantic-edit-original',
          mentionTargets: [],
        },
      ]);
    db.insertEvent(original, true);
    db.insertEvent(editAddsEveryone, true, 1);
    expect(
      db
        .getChatSummaries(mentionedAddress)
        .find((summary) => summary.groupId === 168)
    ).toMatchObject({
      mentionCount: 1,
      hasUnreadMention: true,
    });
    db.insertEvent(editRemovesEveryone, true);
    expect(
      db
        .getChatSummaries(mentionedAddress)
        .find((summary) => summary.groupId === 168)
    ).toMatchObject({
      mentionCount: 0,
      hasUnreadMention: false,
    });
  });

  it('does not count legacy group or channel targets as mentions', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const event = signedEvent({
      eventId: 'event-semantic-channel-target',
      groupId: 169,
      channelId: 'general',
      mentionTargets: [
        {
          type: 'group',
          groupId: 169,
          groupName: 'test-group',
        },
        {
          type: 'channel',
          groupId: 169,
          channelId: 'general-devs',
          channelName: 'general-devs',
        },
      ],
    });
    db.insertEvent(event, true);

    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      groupId: 169,
      mentionCount: 0,
      hasUnreadMention: false,
    });
  });

  it('tracks semantic mention targets beyond the recent summary window', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const baseTimestamp = Date.now() - 60_000;
    const semanticMention = signedEvent({
      eventId: 'event-semantic-old-unread-target',
      groupId: 170,
      authorSeq: 1,
      timestamp: baseTimestamp,
      mentionTargets: [{ type: 'everyone', groupId: 170 }],
    });
    db.insertEvent(semanticMention, true, 1);

    const fillerTemplate = signedEvent({
      eventId: 'event-semantic-window-filler-template',
      groupId: 170,
      authorSeq: 2,
      timestamp: baseTimestamp + 1,
      mentionTargets: [],
    });
    for (let index = 0; index < 501; index += 1) {
      db.insertEvent(
        {
          ...fillerTemplate,
          eventId: `event-semantic-window-filler-${index}`,
          authorSeq: index + 2,
          timestamp: baseTimestamp + index + 1,
          mentionTargets: [],
        },
        true
      );
    }

    expect(db.getChatSummaries(mentionedAddress)[0]).toMatchObject({
      groupId: 170,
      mentionCount: 1,
      hasUnreadMention: true,
    });
  });

  it('applies edit and delete state to event mention hash summaries', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const mentionHash = hashReticulumChatMentionAddress(mentionedAddress);

    const original = signedEvent({
      eventId: 'event-mention-edit-original',
      groupId: 67,
      authorAddress: 'Qauthor',
      authorSeq: 1,
      timestamp: Date.now(),
      mentionAddressHashes: [],
    });
    const editAddsMention = signedEvent({
      eventId: 'event-mention-edit-adds',
      groupId: 67,
      authorAddress: 'Qauthor',
      authorSeq: 2,
      timestamp: original.timestamp + 1,
      eventType: 'edit',
      targetEventId: original.eventId,
      mentionAddressHashes: [mentionHash],
    });
    const editRemovesMention = signedEvent({
      eventId: 'event-mention-edit-removes',
      groupId: 67,
      authorAddress: 'Qauthor',
      authorSeq: 3,
      timestamp: original.timestamp + 2,
      eventType: 'edit',
      targetEventId: original.eventId,
      mentionAddressHashes: [],
    });
    db.insertEvent(original, true);
    db.insertEvent(editAddsMention, true);
    expect(
      db
        .getChatSummaries(mentionedAddress)
        .find((summary) => summary.groupId === 67)
    ).toMatchObject({
      mentionCount: 1,
      hasUnreadMention: true,
    });
    db.insertEvent(editRemovesMention, true);
    expect(
      db
        .getChatSummaries(mentionedAddress)
        .find((summary) => summary.groupId === 67)
    ).toMatchObject({
      mentionCount: 0,
      hasUnreadMention: false,
    });

    const deletedOriginal = signedEvent({
      eventId: 'event-mention-delete-original',
      groupId: 68,
      authorAddress: 'Qauthor',
      authorSeq: 1,
      timestamp: Date.now(),
      mentionAddressHashes: [mentionHash],
    });
    const deleteEvent = signedEvent({
      eventId: 'event-mention-delete',
      groupId: 68,
      authorAddress: 'Qauthor',
      authorSeq: 2,
      timestamp: deletedOriginal.timestamp + 1,
      eventType: 'delete',
      targetEventId: deletedOriginal.eventId,
      mentionAddressHashes: [],
    });
    db.insertEvent(deletedOriginal, true);
    expect(
      db
        .getChatSummaries(mentionedAddress)
        .find((summary) => summary.groupId === 68)
    ).toMatchObject({
      groupId: 68,
      mentionCount: 1,
      hasUnreadMention: true,
    });
    db.insertEvent(deleteEvent, true);
    const deletedSummary = db
      .getChatSummaries(mentionedAddress)
      .find((summary) => summary.groupId === 68);
    expect(deletedSummary?.mentionCount ?? 0).toBe(0);
    expect(deletedSummary?.hasUnreadMention ?? false).toBe(false);
  });

  it('exposes an edit-aware read boundary so edited mentions can be cleared', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const mentionedAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    const mentionHash = hashReticulumChatMentionAddress(mentionedAddress);
    const original = signedEvent({
      eventId: 'event-edited-mention-read-original',
      groupId: 269,
      authorAddress: 'Qauthor',
      authorSeq: 1,
      timestamp: Date.now(),
      mentionAddressHashes: [],
    });
    const edit = signedEvent({
      eventId: 'event-edited-mention-read-edit',
      groupId: 269,
      authorAddress: 'Qauthor',
      authorSeq: 2,
      timestamp: original.timestamp + 10_000,
      eventType: 'edit',
      targetEventId: original.eventId,
      mentionAddressHashes: [mentionHash],
    });
    db.insertEvent(original, true);
    db.insertEvent(edit, true);
    db.replaceMentionsForEvent(original.eventId, [mentionedAddress]);

    const unreadSummary = db
      .getChatSummaries(mentionedAddress)
      .find((summary) => summary.groupId === 269)?.channels[0];
    expect(unreadSummary).toMatchObject({
      mentionCount: 1,
      updatedAt: original.timestamp,
      readThroughTimestamp: edit.timestamp,
    });

    db.markRead(
      269,
      'general',
      unreadSummary?.readThroughTimestamp ?? 0,
      mentionedAddress
    );
    expect(
      db
        .getChatSummaries(mentionedAddress)
        .find((summary) => summary.groupId === 269)
    ).toMatchObject({ mentionCount: 0, hasUnreadMention: false });
  });

  it('does not let renderer mention rows replace signed mention metadata', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({
      eventId: 'event-mention-replace',
      groupId: 64,
      authorAddress: 'Qauthor',
      mentionAddressHashes: [hashReticulumChatMentionAddress('Qfirst')],
    });
    db.insertEvent(event, true);

    db.replaceMentionsForEvent(event.eventId, ['Qfirst']);
    expect(db.getChatSummaries('Qfirst')[0]?.mentionCount).toBe(1);
    db.replaceMentionsForEvent(event.eventId, ['Qsecond']);
    expect(db.getChatSummaries('Qfirst')[0]?.mentionCount).toBe(1);
    expect(db.getChatSummaries('Qsecond')[0]?.mentionCount ?? 0).toBe(0);
    db.deleteMentionsForEvent(event.eventId);
    expect(db.getChatSummaries('Qfirst')[0]?.mentionCount).toBe(1);
  });

  it('does not let stale rendered edits overwrite projected mentions', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const root = signedEvent({
      eventId: 'event-mention-projection-root',
      groupId: 264,
      authorAddress: 'Qauthor',
      authorSeq: 1,
      timestamp: Date.now(),
      mentionAddressHashes: [],
    });
    const olderEdit = signedEvent({
      eventId: 'event-mention-projection-old-edit',
      groupId: 264,
      authorAddress: 'Qauthor',
      authorSeq: 2,
      timestamp: root.timestamp + 1,
      eventType: 'edit',
      targetEventId: root.eventId,
      mentionAddressHashes: [],
    });
    const newerEdit = signedEvent({
      eventId: 'event-mention-projection-new-edit',
      groupId: 264,
      authorAddress: 'Qauthor',
      authorSeq: 3,
      timestamp: root.timestamp + 2,
      eventType: 'edit',
      targetEventId: root.eventId,
      mentionAddressHashes: [hashReticulumChatMentionAddress('QnewerMention')],
    });

    db.insertEvent(root, true);
    db.insertEvent(newerEdit, true);
    expect(
      db.replaceMentionsForEvent(newerEdit.eventId, ['QnewerMention'])
    ).toBe(true);
    expect(db.replaceMentionsForEvent(root.eventId, ['QrootMention'])).toBe(
      false
    );
    db.insertEvent(olderEdit, true);
    expect(
      db.replaceMentionsForEvent(olderEdit.eventId, ['QolderMention'])
    ).toBe(false);

    expect(db.getChatSummaries('QnewerMention')[0]?.mentionCount).toBe(1);
    expect(db.getChatSummaries('QrootMention')[0]?.mentionCount ?? 0).toBe(0);
    expect(db.getChatSummaries('QolderMention')[0]?.mentionCount ?? 0).toBe(0);
  });

  it('returns recent group events when requester has empty sync state', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({ groupId: 45, authorSeq: 1 });
    db.insertEvent(event, true);
    expect(db.getMissingEvents(45, {}, 10).map((item) => item.eventId)).toEqual(
      [event.eventId]
    );
  });

  it('includes authors missing from requester sync state', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const first = signedEvent({ groupId: 46, authorSeq: 2 });
    const second = signedEvent({ groupId: 46, authorSeq: 1 });
    db.insertEvent(first, true);
    db.insertEvent(second, true);
    const missing = db.getMissingEvents(46, { [first.authorAddress]: 2 }, 10);
    expect(missing.map((item) => item.eventId)).toEqual([second.eventId]);
  });

  it('returns bounded timestamp windows for scalable sync', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const events = [1, 2, 3, 4].map((seq) =>
      signedEvent({
        eventId: `event-window-${seq}`,
        groupId: 47,
        authorSeq: seq,
        timestamp: 1_000 + seq * 100,
      })
    );
    for (const event of events) db.insertEvent(event, true);

    expect(db.getRecentEvents(47, 2).map((item) => item.eventId)).toEqual([
      'event-window-3',
      'event-window-4',
    ]);
    expect(
      db.getEventsAfter(47, 1_250, 10).map((item) => item.eventId)
    ).toEqual(['event-window-3', 'event-window-4']);
    expect(
      db
        .getEventsAfter(47, 1_300, 10, 'event-window-3')
        .map((item) => item.eventId)
    ).toEqual(['event-window-4']);
    expect(
      db.getEventsBefore(47, 1_350, 10).map((item) => item.eventId)
    ).toEqual(['event-window-1', 'event-window-2', 'event-window-3']);
    expect(
      db
        .getEventsBefore(47, 1_300, 10, 'event-window-3')
        .map((item) => item.eventId)
    ).toEqual(['event-window-1', 'event-window-2']);
  });

  it('returns newest inclusive feed pages for cold sync repair', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const events = [1, 2, 3].map((seq) =>
      signedEvent({
        eventId: `event-inclusive-page-${seq}`,
        groupId: 47,
        channelId: seq === 2 ? 'ch-inclusive-page' : 'general',
        authorSeq: seq,
        timestamp: 2_000 + seq,
      })
    );
    for (const event of events) db.insertEvent(event, true);

    expect(
      db
        .getFeedPageAtOrBefore(
          47,
          'general',
          { eventId: 'event-inclusive-page-3', feedTimestamp: 2_003 },
          2
        )
        .map((item) => item.eventId)
    ).toEqual(['event-inclusive-page-1', 'event-inclusive-page-3']);
    expect(
      db
        .getGroupFeedPageAtOrBefore(
          47,
          { eventId: 'event-inclusive-page-3', feedTimestamp: 2_003 },
          2
        )
        .map((item) => item.eventId)
    ).toEqual(['event-inclusive-page-2', 'event-inclusive-page-3']);
  });

  it('allows one extra feed row as a continuation probe', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const events = Array.from({ length: 102 }, (_unused, index) =>
      signedEvent({
        eventId: `event-feed-probe-${String(index + 1).padStart(3, '0')}`,
        groupId: 47,
        channelId: 'general',
        authorSeq: index + 1,
        timestamp: 3_000 + index,
      })
    );
    for (const event of events) db.insertEvent(event, true);

    const latest = events[events.length - 1];
    expect(
      db.getGroupFeedPageAtOrBefore(
        47,
        { eventId: latest.eventId, feedTimestamp: latest.timestamp },
        101
      )
    ).toHaveLength(101);
    expect(
      db.getFeedPageAtOrBefore(
        47,
        'general',
        { eventId: latest.eventId, feedTimestamp: latest.timestamp },
        101
      )
    ).toHaveLength(101);
  });

  it('keeps event-bearing channels hidden until channel metadata arrives', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({
      eventId: 'event-metadata-missing-channel',
      groupId: 48,
      channelId: 'ch-missing-metadata',
      authorSeq: 1,
      timestamp: 3_000,
    });
    db.insertEvent(event, true);

    expect(
      db.getChannels(48).map((channel) => channel.channelId)
    ).not.toContain('ch-missing-metadata');
    expect(
      db
        .getRecentMessageEvents(48, 10, 'ch-missing-metadata')
        .map((item) => item.eventId)
    ).toEqual([event.eventId]);
  });

  it('returns author heads and author ranges for gap repair', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const [first, second] = signedAuthorEvents([
      {
        eventId: 'event-author-1',
        groupId: 57,
        authorSeq: 1,
        timestamp: 1_000,
      },
      {
        eventId: 'event-author-2',
        groupId: 57,
        authorSeq: 2,
        timestamp: 2_000,
      },
    ]);
    db.insertEvent(first, true);
    db.insertEvent(second, true);

    expect(
      db.getAuthorMaxSeq(57, first.authorAddress, TEST_AUTHOR_STREAM_ID)
    ).toBe(2);
    expect(
      db
        .getAuthorEventsAfter(
          57,
          first.authorAddress,
          TEST_AUTHOR_STREAM_ID,
          0,
          10
        )
        .map((event) => event.eventId)
    ).toEqual(['event-author-1', 'event-author-2']);
    expect(db.getAuthorHeads(57, 10)).toEqual([
      {
        authorAddress: first.authorAddress,
        authorStreamId: TEST_AUTHOR_STREAM_ID,
        maxSeq: 2,
        eventId: 'event-author-2',
        timestamp: 2_000,
      },
    ]);
  });

  it('paginates author heads', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const [firstAuthor] = signedAuthorEvents([
      {
        eventId: 'event-head-page-1',
        groupId: 61,
        authorSeq: 1,
        timestamp: 1_000,
      },
    ]);
    const [secondAuthor] = signedAuthorEvents([
      {
        eventId: 'event-head-page-2',
        groupId: 61,
        authorSeq: 1,
        timestamp: 2_000,
      },
    ]);
    db.insertEvent(firstAuthor, true);
    db.insertEvent(secondAuthor, true);

    expect(db.getAuthorHeads(61, 1, 0).map((head) => head.eventId)).toEqual([
      'event-head-page-2',
    ]);
    expect(db.getAuthorHeads(61, 1, 1).map((head) => head.eventId)).toEqual([
      'event-head-page-1',
    ]);
  });

  it('keeps sequence heads and gaps independent for two device streams on one account', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const streamA = 'a'.repeat(32);
    const streamB = 'b'.repeat(32);
    const events = signedAuthorEvents([
      {
        eventId: 'stream-a-1',
        groupId: 62,
        authorStreamId: streamA,
        authorSeq: 1,
        timestamp: 1_000,
      },
      {
        eventId: 'stream-a-3',
        groupId: 62,
        authorStreamId: streamA,
        authorSeq: 3,
        timestamp: 3_000,
      },
      {
        eventId: 'stream-b-1',
        groupId: 62,
        authorStreamId: streamB,
        authorSeq: 1,
        timestamp: 2_000,
      },
      {
        eventId: 'stream-b-2',
        groupId: 62,
        authorStreamId: streamB,
        authorSeq: 2,
        timestamp: 4_000,
      },
    ]);
    for (const event of events) expect(db.insertEvent(event, true)).toBe(true);

    expect(db.getAuthorHeads(62, 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authorStreamId: streamA, maxSeq: 3 }),
        expect.objectContaining({ authorStreamId: streamB, maxSeq: 2 }),
      ])
    );
    expect(db.getAuthorSequenceGaps(62, 10)).toEqual([
      {
        authorAddress: events[0].authorAddress,
        authorStreamId: streamA,
        fromSeq: 2,
        toSeq: 2,
      },
    ]);
    expect(db.getSyncState(62)).toMatchObject({
      [`${events[0].authorAddress}:${streamA}`]: 3,
      [`${events[0].authorAddress}:${streamB}`]: 2,
    });
  });

  it('returns known group ids from persisted and memory events', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    db.insertEvent(
      signedEvent({ eventId: 'known-group-persisted', groupId: 62 }),
      true
    );
    (db as any).memoryEvents.set(
      'known-group-memory',
      signedEvent({ eventId: 'known-group-memory', groupId: 63 })
    );

    expect(db.getKnownGroupIds()).toEqual([62, 63]);
  });

  it('persists offline relay cache blobs separately from normal chat events', () => {
    const dbPath = tempDbPath();
    const event = signedEvent({
      eventId: 'relay-db-persist-event',
      groupId: 64,
    });
    const payloadJson = serializeReticulumChatEvent(event);
    const first = new ReticulumChatDatabase(dbPath);
    const stored = first.storeRelayEventBlob(
      event,
      payloadJson,
      'relay-source'
    );
    expect(stored).toMatchObject({ ok: true });
    expect(first.hasEvent(event.eventId)).toBe(false);
    first.close();

    const second = new ReticulumChatDatabase(dbPath);
    const cached = second.getRelayEventBlob(event.groupId, event.eventId);
    expect(cached).toMatchObject({
      eventId: event.eventId,
      groupId: event.groupId,
      encoding: 'plain-json-v1',
      encryption: 'none',
      payloadJson,
    });
    expect(second.hasEvent(event.eventId)).toBe(false);
    second.close();
  });

  it('expires offline relay cache blobs after the relay retention window', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({
      eventId: 'relay-db-expiring-event',
      groupId: 65,
    });
    const payloadJson = serializeReticulumChatEvent(event);
    expect(
      db.storeRelayEventBlob(event, payloadJson, 'relay-source', 10_000)
    ).toMatchObject({
      ok: true,
    });
    expect(db.getRelayEventBlob(65, event.eventId, 10_000)).toMatchObject({
      eventId: event.eventId,
    });
    expect(
      db.getRelayEventBlob(
        65,
        event.eventId,
        10_000 + RETICULUM_CHAT_RELAY_CACHE_MAX_AGE_MS + 1
      )
    ).toBeNull();
  });

  it('does not store attachment manifests in the offline relay cache', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const event = signedEvent({
      eventId: 'relay-db-attachment-event',
      groupId: 66,
      eventType: 'attachment_manifest',
    });
    const payloadJson = serializeReticulumChatEvent(event);
    expect(
      db.storeRelayEventBlob(event, payloadJson, 'relay-source')
    ).toMatchObject({
      ok: false,
      reason: 'attachment-events-not-relayed',
    });
    expect(db.getRelayEventBlob(66, event.eventId)).toBeNull();
  });

  it('removes relay-cached message payloads when a delete is relayed', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const [original, edit, deleteEvent] = signedAuthorEvents([
      {
        eventId: 'relay-delete-root',
        groupId: 67,
        authorSeq: 1,
        eventType: 'message',
        encryptedPayload: JSON.stringify({
          messageText: 'relay cached secret',
        }),
      },
      {
        eventId: 'relay-delete-edit',
        groupId: 67,
        authorSeq: 2,
        eventType: 'edit',
        targetEventId: 'relay-delete-root',
        encryptedPayload: JSON.stringify({ messageText: 'relay cached edit' }),
      },
      {
        eventId: 'relay-delete-tombstone',
        groupId: 67,
        authorSeq: 3,
        eventType: 'delete',
        targetEventId: 'relay-delete-root',
        encryptedPayload: JSON.stringify({ type: 'delete' }),
      },
    ]);

    expect(
      db.storeRelayEventBlob(
        original,
        serializeReticulumChatEvent(original),
        'relay-source'
      )
    ).toMatchObject({ ok: true });
    expect(
      db.storeRelayEventBlob(
        edit,
        serializeReticulumChatEvent(edit),
        'relay-source'
      )
    ).toMatchObject({ ok: true });
    expect(db.getRelayEventBlob(67, original.eventId)).toMatchObject({
      eventId: original.eventId,
    });
    expect(db.getRelayEventBlob(67, edit.eventId)).toMatchObject({
      eventId: edit.eventId,
    });

    expect(
      db.storeRelayEventBlob(
        deleteEvent,
        serializeReticulumChatEvent(deleteEvent),
        'relay-source'
      )
    ).toMatchObject({ ok: true });
    expect(db.getRelayEventBlob(67, original.eventId)).toBeNull();
    expect(db.getRelayEventBlob(67, edit.eventId)).toBeNull();
    expect(db.getRelayEventBlob(67, deleteEvent.eventId)).toMatchObject({
      eventId: deleteEvent.eventId,
    });
  });

  it('stores and retrieves active group keys', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    dbs.push(db);
    const key = {
      groupId: 91,
      epoch: 1,
      keyId: 'a'.repeat(64),
      keyBytesBase64: Buffer.alloc(32, 7).toString('base64'),
      createdBy: 'Qadmin',
      createdAt: 10_000,
      status: 'active' as const,
      adminPublicKey: 'admin-public-key',
      adminSignature: 'admin-signature',
    };
    db.upsertGroupKey(key);
    expect(db.getActiveGroupKey(91)).toMatchObject(key);
    expect(db.getGroupKey(91, 1, key.keyId)).toMatchObject(key);
  });
});

describe('QortalLand state wire sizing', () => {
  it('fits a fully populated routed state inside the encrypted MDU', () => {
    const signer = createLandAuthSigner();
    const wire = {
      ...signer.landStateWire({
        groupId: 2_147_483_647,
        sessionId: '0123456789abcdef',
        sequence: 0xffff_ffff,
        x: 4095,
        y: 2047,
        roomId: 'skywalk',
        direction: 'r',
        movement: 'leave',
        afk: true,
        dnd: true,
        skinId: 31,
        timestamp: 9_999_999_999_999,
      }),
      o: '0123456789abcdef012345',
      h: 9,
    };

    expect(wire).toMatchObject({ v: 3, i: 31 });
    expect(byteLengthUtf8JsonWithBridgeSenderOnly(wire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    expect(wireFitsReticulumChat(wire)).toBe(true);
    const { o: _origin, h: _hops, ...unroutedWire } = wire;
    expect(wireFitsReticulum(unroutedWire)).toBe(true);
  });
});

describe('reticulum chat manager', () => {
  function waitForEvent(manager: ReticulumChatManager, timeoutMs = 500) {
    return new Promise<ReticulumChatEvent>((resolve, reject) => {
      const timeout = setTimeout(() => {
        manager.off('event', onEvent);
        reject(new Error('Timed out waiting for Reticulum chat event'));
      }, timeoutMs);
      const onEvent = (payload: { event?: ReticulumChatEvent }) => {
        if (!payload.event) return;
        clearTimeout(timeout);
        manager.off('event', onEvent);
        resolve(payload.event);
      };
      manager.on('event', onEvent);
    });
  }

  async function waitForCondition(
    predicate: () => boolean,
    timeoutMs = 500,
    intervalMs = 10
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for condition');
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  it('exchanges bounded public activity directly and excludes admin-only channels', async () => {
    const providerPeer = 'a'.repeat(32);
    const requesterPeer = 'b'.repeat(32);
    const sent: Array<{ from: string; to: string; wire: ReticulumChatWire }> =
      [];
    let provider!: ReticulumChatManager;
    let requester!: ReticulumChatManager;
    provider = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          target: string,
          wire: ReticulumChatWire
        ) => {
          sent.push({ from: providerPeer, to: target, wire });
          requester.handleWire(wire as any, providerPeer);
          return { ok: true as const };
        },
      } as any,
    });
    requester = new ReticulumChatManager({
      dbPath: tempDbPath(),
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: providerPeer,
          address: 'Qprovider',
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          target: string,
          wire: ReticulumChatWire
        ) => {
          sent.push({ from: requesterPeer, to: target, wire });
          provider.handleWire(wire as any, requesterPeer);
          return { ok: true as const };
        },
      } as any,
    });
    provider.setLocalGroupMemberships([{ groupId: 716, isOpen: true }]);
    upsertTestChannel(provider, {
      groupId: 716,
      channelId: 'staff',
      readMode: 'admins',
    });
    (provider as any).acceptValidatedEvent(
      signedEvent({
        groupId: 716,
        channelId: 'general',
        timestamp: Date.now(),
      }),
      false
    );
    (provider as any).acceptValidatedEvent(
      signedEvent({ groupId: 716, channelId: 'staff', timestamp: Date.now() }),
      false
    );
    (provider as any).db.upsertPublicGroupActivityCache(
      [
        {
          groupId: 717,
          messages24h: 100,
          messages7d: 200,
          activeAuthors7d: 50,
          observedAt: Date.now(),
          confidence: 3,
        },
      ],
      200,
      Date.now()
    );
    requester.setPublicGroupDirectory([716, 717]);
    const scheduled = (requester as any).publicGroupActivityRefreshTimer;
    if (scheduled) clearTimeout(scheduled);
    (requester as any).publicGroupActivityRefreshTimer = null;
    (requester as any).publicGroupActivityRefreshDueAt = 0;

    await (requester as any).runPublicActivityRefresh();

    expect(sent.map((item) => item.wire.k)).toEqual([
      'public_activity_req_v1',
      'public_activity_top_v1',
    ]);
    expect(requester.getPublicGroupActivitySummaries()).toMatchObject([
      {
        groupId: 716,
        messages24h: 1,
        messages7d: 1,
        activeAuthors7d: 1,
      },
    ]);
    const response = sent.find(
      (item) => item.wire.k === 'public_activity_top_v1'
    )?.wire as Extract<ReticulumChatWire, { k: 'public_activity_top_v1' }>;
    expect(response.e.map(([groupId]) => groupId)).toEqual([716]);
    requester.close();
    provider.close();
  });

  it('applies large membership sets immediately and defers deduplicated initialization work', async () => {
    vi.useFakeTimers();
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    try {
      const repair = vi
        .spyOn(manager as any, 'queueChannelMetadataProjectionRepair')
        .mockImplementation(() => undefined);
      const recentEvents = vi
        .spyOn((manager as any).db, 'getRecentEvents')
        .mockReturnValue([]);
      const ensureKey = vi
        .spyOn(manager as any, 'ensureGroupKeyState')
        .mockResolvedValue(undefined);
      const memberships = Array.from({ length: 54 }, (_, index) => ({
        groupId: index + 1,
        isPrivate: true,
      }));

      manager.setLocalGroupMemberships(memberships);

      expect((manager as any).localGroupIds.size).toBe(54);
      expect(repair).not.toHaveBeenCalled();
      expect(recentEvents).not.toHaveBeenCalled();
      expect(ensureKey).not.toHaveBeenCalled();
      expect((manager as any).membershipInitializationQueue).toHaveLength(54);

      manager.setLocalGroupMemberships(memberships);
      expect((manager as any).membershipInitializationQueue).toHaveLength(54);

      await vi.runAllTimersAsync();

      expect(repair).toHaveBeenCalledTimes(54);
      expect(recentEvents).toHaveBeenCalledTimes(54);
      expect(ensureKey).toHaveBeenCalledTimes(54);
      expect((manager as any).membershipInitializationQueue).toHaveLength(0);
    } finally {
      manager.close();
      vi.useRealTimers();
    }
  });

  it('preserves synchronous initialization for small membership sets', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    try {
      const repair = vi
        .spyOn(manager as any, 'queueChannelMetadataProjectionRepair')
        .mockImplementation(() => undefined);
      const recentEvents = vi
        .spyOn((manager as any).db, 'getRecentEvents')
        .mockReturnValue([]);
      const ensureKey = vi
        .spyOn(manager as any, 'ensureGroupKeyState')
        .mockResolvedValue(undefined);

      manager.setLocalGroupMemberships([
        { groupId: 1, isPrivate: true },
        { groupId: 2, isPrivate: true },
      ]);

      expect(repair).toHaveBeenCalledTimes(2);
      expect(recentEvents).toHaveBeenCalledTimes(2);
      expect(ensureKey).toHaveBeenCalledTimes(2);
      expect((manager as any).membershipInitializationQueue).toHaveLength(0);
    } finally {
      manager.close();
    }
  });

  it('cancels an in-flight metadata snapshot lookup when shutdown closes the database', async () => {
    let resolveValidationStarted: (() => void) | null = null;
    const validationStarted = new Promise<void>((resolve) => {
      resolveValidationStarted = resolve;
    });
    let resolveValidation: ((isAdmin: boolean) => void) | null = null;
    const validationResult = new Promise<boolean>((resolve) => {
      resolveValidation = resolve;
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: async () => null,
      validateGroupAdmin: async () => {
        resolveValidationStarted?.();
        return validationResult;
      },
    });
    let closed = false;
    try {
      const groupId = 901;
      (manager as any).localGroupIds.add(groupId);
      (manager as any).localGroupAddresses.set(groupId, 'Qlocal');

      const pending = (manager as any).getBestMetadataSnapshotForSend(groupId);
      await validationStarted;
      manager.close();
      closed = true;
      resolveValidation?.(true);

      await expect(pending).resolves.toBeNull();
    } finally {
      resolveValidation?.(false);
      if (!closed) manager.close();
    }
  });

  it('marks replies whose parent message was deleted in renderer history', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([149]);
    const [root, reply, deletion] = signedAuthorEvents([
      {
        eventId: 'deleted-reply-root',
        groupId: 149,
        channelId: 'general',
        authorSeq: 1,
        timestamp: 1_000,
        eventType: 'message',
      },
      {
        eventId: 'reply-to-deleted-root',
        groupId: 149,
        channelId: 'general',
        authorSeq: 2,
        timestamp: 1_001,
        eventType: 'message',
        replyToEventId: 'deleted-reply-root',
      },
      {
        eventId: 'delete-reply-root',
        groupId: 149,
        channelId: 'general',
        authorSeq: 3,
        timestamp: 1_002,
        eventType: 'delete',
        targetEventId: 'deleted-reply-root',
      },
    ]);
    const db = (manager as unknown as { db: ReticulumChatDatabase }).db;
    expect(db.insertEvent(root, false)).toBe(true);
    expect(db.insertEvent(reply, false)).toBe(true);
    expect(db.insertEvent(deletion, false)).toBe(true);

    expect(manager.getMessageHistory(149, 'general', 10)).toMatchObject([
      {
        eventId: reply.eventId,
        replyToEventId: root.eventId,
        replyTargetDeleted: true,
      },
    ]);
    manager.close();
  });

  it('includes reactions for projected messages when renderer history reloads', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([150]);
    const [message, add, remove, currentAdd] = signedAuthorEvents([
      {
        eventId: 'reaction-history-message',
        groupId: 150,
        channelId: 'general',
        authorSeq: 1,
        timestamp: 1_000,
        eventType: 'message',
      },
      {
        eventId: 'reaction-history-old-add',
        groupId: 150,
        channelId: 'general',
        authorSeq: 2,
        timestamp: 1_001,
        eventType: 'reaction_add',
        targetEventId: 'reaction-history-message',
        encryptedPayload: JSON.stringify({ content: '👍' }),
      },
      {
        eventId: 'reaction-history-remove',
        groupId: 150,
        channelId: 'general',
        authorSeq: 3,
        timestamp: 1_002,
        eventType: 'reaction_remove',
        targetEventId: 'reaction-history-message',
        encryptedPayload: JSON.stringify({ content: '👍' }),
      },
      {
        eventId: 'reaction-history-current-add',
        groupId: 150,
        channelId: 'general',
        authorSeq: 4,
        timestamp: 1_003,
        eventType: 'reaction_add',
        targetEventId: 'reaction-history-message',
        encryptedPayload: JSON.stringify({ content: '👍' }),
      },
    ]);
    const db = (manager as unknown as { db: ReticulumChatDatabase }).db;
    expect(db.insertEvent(message, false)).toBe(true);
    expect(db.insertEvent(add, false)).toBe(true);
    expect(db.insertEvent(remove, false)).toBe(true);
    expect(db.insertEvent(currentAdd, false)).toBe(true);

    expect(manager.getMessageHistory(150, 'general', 10)).toMatchObject([
      { eventId: message.eventId, eventType: 'message' },
      { eventId: add.eventId, eventType: 'reaction_add' },
      { eventId: remove.eventId, eventType: 'reaction_remove' },
      { eventId: currentAdd.eventId, eventType: 'reaction_add' },
    ]);
    manager.close();
  });

  it('builds a compact index from aggregated discussion counts', () => {
    expect(
      buildReticulumDiscussionIndex([
        {
          discussion_root_id: 'discussion-root',
          reply_count: 2,
        },
      ])
    ).toEqual({
      replyCounts: { 'discussion-root': 2 },
      rootByEventId: {
        'discussion-root': 'discussion-root',
      },
    });
  });

  it('briefly backs off unavailable membership validation without caching it as not-member', async () => {
    let calls = 0;
    let now = 1_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => now,
      validateGroupMember: async () => {
        calls += 1;
        return calls === 1 ? null : true;
      },
    });
    const validate = (
      manager as unknown as {
        isValidatedGroupMember: (
          groupId: number,
          address: string
        ) => Promise<boolean | null>;
      }
    ).isValidatedGroupMember.bind(manager);

    await expect(
      validate(716, 'QaU2XUB6iMgM9YUJnYRkxwVKJd322hJh91')
    ).resolves.toBeNull();
    await expect(
      validate(716, 'QaU2XUB6iMgM9YUJnYRkxwVKJd322hJh91')
    ).resolves.toBeNull();
    expect(calls).toBe(1);
    now += 10_000;
    await expect(
      validate(716, 'QaU2XUB6iMgM9YUJnYRkxwVKJd322hJh91')
    ).resolves.toBe(true);
    expect(calls).toBe(2);
    manager.close();
  });

  it('uses an authoritative local admin snapshot without remote validation', async () => {
    const groupId = 717;
    const localAddress = 'QlocalValidationSnapshot';
    const validateMember = vi.fn(async () => false);
    const validateAdmin = vi.fn(async () => false);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupMember: validateMember,
      validateGroupAdmin: validateAdmin,
    });
    manager.setLocalGroupMemberships([
      {
        groupId,
        localAddress,
        isAdmin: true,
        adminStatusAuthoritative: true,
      },
    ]);

    await expect(
      (manager as any).isValidatedGroupMember(groupId, localAddress)
    ).resolves.toBe(false);
    await expect(
      (manager as any).getValidatedGroupAdminStatus(groupId, localAddress)
    ).resolves.toBe('admin');
    expect(validateMember).toHaveBeenCalledTimes(1);
    expect(validateAdmin).not.toHaveBeenCalled();
    manager.close();
  });

  it('defers the first direct DM probe until overlay health is good', async () => {
    const local = createDmIdentity();
    let healthy = false;
    const fanout: ReticulumChatWire[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(local),
      hasGoodOverlayHealth: () => healthy,
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        fanoutReticulumChatDetailed: async (messages: ReticulumChatWire[]) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
      } as any,
    });

    manager.setLocalDmAddresses([local.address]);
    await flushAsyncWork();
    expect(fanout.some((wire) => wire.k === 'dm_probe')).toBe(false);

    healthy = true;
    manager.notifyOverlayHealthChanged(true);
    await flushAsyncWork();

    const probes = fanout.filter(
      (wire): wire is Extract<ReticulumChatWire, { k: 'dm_probe' }> =>
        wire.k === 'dm_probe'
    );
    expect(probes).toHaveLength(1);
    expect(probes[0].q.q).toHaveLength(16);
    expect(verifyReticulumDmProbe(probes[0].q, Date.now())).toBe(true);

    manager.handleWire(
      {
        ...probes[0],
        q: { ...probes[0].q, h: 2 },
      },
      'b'.repeat(32)
    );
    await flushAsyncWork();
    expect(fanout.filter((wire) => wire.k === 'dm_probe')).toHaveLength(1);
    manager.close();
  });

  it('does not bypass explicit unhealthy overlay state with verified peers', async () => {
    const local = createDmIdentity();
    const fanout: ReticulumChatWire[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(local),
      hasGoodOverlayHealth: () => false,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: 'b'.repeat(32),
          address: 'Qpeer',
          lastSeenAt: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        fanoutReticulumChatDetailed: async (messages: ReticulumChatWire[]) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
      } as any,
    });

    manager.setLocalDmAddresses([local.address]);
    await flushAsyncWork();
    manager.notifyOverlayHealthChanged(true);
    await flushAsyncWork();

    expect(fanout.some((wire) => wire.k === 'dm_probe')).toBe(false);
    manager.close();
  });

  it('warms the selected direct DM peer with a direct probe', async () => {
    const local = createDmIdentity();
    const peer = createDmIdentity();
    const peerHash = 'b'.repeat(32);
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(local),
      hasGoodOverlayHealth: () => false,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: peerHash,
          address: peer.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          targetPeer: string,
          wire: ReticulumChatWire
        ) => {
          sent.push({ peer: targetPeer, wire });
          return { ok: true as const };
        },
      } as any,
    });

    manager.setLocalDmAddresses([local.address]);
    manager.setActiveDirectChat(local.address, peer.address, true);
    await flushAsyncWork();

    expect(sent).toHaveLength(1);
    expect(sent[0].peer).toBe(peerHash);
    expect(sent[0].wire.k).toBe('dm_probe');
    expect(
      verifyReticulumDmProbe(
        (sent[0].wire as Extract<ReticulumChatWire, { k: 'dm_probe' }>).q,
        Date.now()
      )
    ).toBe(true);
    manager.close();
  });

  it('sends direct DM typing to every verified endpoint for the active conversation', async () => {
    const local = createDmIdentity();
    const peer = createDmIdentity();
    const peerHash = 'b'.repeat(32);
    const secondPeerHash = 'c'.repeat(32);
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(local),
      hasGoodOverlayHealth: () => false,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: peerHash,
          lastSeen: Date.now(),
        },
        {
          destinationHash: secondPeerHash,
          lastSeen: Date.now() - 1,
        },
      ],
      getAccountEndpointLeases: () => [
        {
          destinationHash: peerHash,
          address: peer.address,
          sessionId: 'peer-device-1',
          lastSeen: Date.now(),
          expiresAt: Date.now() + 45_000,
          verification: 'direct-bound',
        },
        {
          destinationHash: secondPeerHash,
          address: peer.address,
          sessionId: 'peer-device-2',
          lastSeen: Date.now() - 1,
          expiresAt: Date.now() + 45_000,
          verification: 'relayed-bound',
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          targetPeer: string,
          wire: ReticulumChatWire
        ) => {
          sent.push({ peer: targetPeer, wire });
          return { ok: true as const };
        },
        fanoutReticulumChatDetailed: async () => {
          throw new Error('DM typing must not use fanout');
        },
      } as any,
    });

    manager.setLocalDmAddresses([local.address]);
    manager.setActiveDirectChat(local.address, peer.address, true);
    await flushAsyncWork();
    sent.length = 0;

    const result = await manager.sendDirectTyping(
      local.address,
      peer.address,
      true
    );

    expect(result).toEqual({ ok: true });
    expect(sent).toHaveLength(2);
    expect(sent.map(({ peer: target }) => target)).toEqual([
      peerHash,
      secondPeerHash,
    ]);
    expect(sent.every(({ wire }) => wire.k === 'dm_typing')).toBe(true);
    expect(
      (sent[0].wire as Extract<ReticulumChatWire, { k: 'dm_typing' }>).active
    ).toBe(true);
    expect(wireFitsReticulum(sent[0].wire)).toBe(true);
    manager.close();
  });

  it('does not send direct DM typing without an active direct DM preference', async () => {
    const local = createDmIdentity();
    const peer = createDmIdentity();
    const sent: ReticulumChatWire[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: 'b'.repeat(32),
          address: peer.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          _targetPeer: string,
          wire: ReticulumChatWire
        ) => {
          sent.push(wire);
          return { ok: true as const };
        },
      } as any,
    });

    manager.setLocalDmAddresses([local.address]);
    const result = await manager.sendDirectTyping(
      local.address,
      peer.address,
      true
    );

    expect(result).toMatchObject({ ok: false, reason: 'no-route' });
    expect(sent).toHaveLength(0);
    manager.close();
  });

  it('accepts direct DM typing only from the verified Reticulum peer for that address', async () => {
    const local = createDmIdentity();
    const peer = createDmIdentity();
    const peerHash = 'b'.repeat(32);
    const conversationId = reticulumDmConversationId(
      local.address,
      peer.address
    );
    const typing: unknown[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: peerHash,
          lastSeen: Date.now(),
        },
      ],
      getAccountEndpointLeases: () => [
        {
          destinationHash: peerHash,
          address: peer.address,
          sessionId: 'peer-device-1',
          lastSeen: Date.now(),
          expiresAt: Date.now() + 45_000,
          verification: 'direct-bound',
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
      } as any,
    });
    manager.on('directTyping', (payload) => typing.push(payload));
    manager.setLocalDmAddresses([local.address]);

    (manager as any).handleWire(
      {
        t: 'RCHAT',
        k: 'dm_typing',
        c: conversationId,
        a: peer.address,
        ts: Date.now(),
        active: true,
      },
      'c'.repeat(32),
      'c'.repeat(32)
    );
    (manager as any).handleWire(
      {
        t: 'RCHAT',
        k: 'dm_typing',
        c: conversationId,
        a: peer.address,
        ts: Date.now(),
        active: true,
      },
      peerHash,
      peerHash
    );

    expect(typing).toHaveLength(1);
    expect(typing[0]).toMatchObject({
      conversationId,
      authorAddress: peer.address,
      active: true,
    });
    manager.close();
  });

  it('keeps an account typing while any verified device session is active', () => {
    const local = createDmIdentity();
    const peer = createDmIdentity();
    const firstPeerHash = 'b'.repeat(32);
    const secondPeerHash = 'c'.repeat(32);
    const conversationId = reticulumDmConversationId(
      local.address,
      peer.address
    );
    const typing: Array<{ active?: boolean }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: firstPeerHash,
          address: peer.address,
          lastSeen: Date.now(),
        },
        {
          destinationHash: secondPeerHash,
          address: peer.address,
          lastSeen: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
      } as any,
    });
    manager.on('directTyping', (payload) => typing.push(payload));
    manager.setLocalDmAddresses([local.address]);

    const receive = (
      sourcePeerHash: string,
      sessionId: string,
      active: boolean
    ) =>
      (manager as any).handleWire(
        {
          t: 'RCHAT',
          k: 'dm_typing',
          c: conversationId,
          a: peer.address,
          s: sessionId,
          ts: Date.now(),
          active,
        },
        sourcePeerHash,
        sourcePeerHash
      );

    receive(firstPeerHash, 'session-one', true);
    receive(secondPeerHash, 'session-two', true);
    receive(firstPeerHash, 'session-one', false);
    expect(typing.filter(({ active }) => active === false)).toHaveLength(0);

    receive(secondPeerHash, 'session-two', false);
    expect(typing.filter(({ active }) => active === false)).toHaveLength(1);
    manager.close();
  });

  it('keeps expiring maximum-size direct DMs out of the live wire packet', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const recipientPeerHash = 'b'.repeat(32);
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(sender),
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: recipientPeerHash,
          address: recipient.address,
          lastSeenAt: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: ReticulumChatWire
        ) => {
          sent.push({ peer, wire });
          return { ok: true as const };
        },
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
    });
    manager.setLocalDmAddresses([sender.address]);
    await flushAsyncWork();
    const payload = JSON.stringify({
      messageText: 'x'.repeat(4_000),
      expiryDurationMs: 30 * 24 * 60 * 60 * 1_000,
    });
    const event = signedDmEvent({
      sender,
      recipient,
      eventId: '0123456789abcdef',
      senderSeq: Date.now() * 1000,
      timestamp: Date.now(),
      payload,
    });

    const result = await manager.publishDirectEvent(event);

    expect(result).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].peer).toBe(recipientPeerHash);
    expect(sent[0].wire.k).toBe('dm_notify');
    expect(JSON.stringify(sent[0].wire)).not.toContain('expiryDurationMs');
    expect(JSON.stringify(sent[0].wire)).not.toContain('x'.repeat(100));
    expect(wireFitsReticulum(sent[0].wire)).toBe(true);
    expect(
      byteLengthUtf8JsonWithBridgeSender(sent[0].wire)
    ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    const page = (manager as any).buildDirectDmPageResourceBlob(
      event.conversationId,
      [event],
      0,
      false,
      true
    );
    expect(page).not.toBeNull();
    expect(page.sizeBytes).toBeLessThanOrEqual(1024 * 1024);
    manager.close();
  });

  it('stores equal DM sequences from separate installation streams without collision', () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const first = signedDmEvent({
      sender,
      recipient,
      eventId: 'dm-stream-one-event',
      senderStreamId: '1'.repeat(32),
      senderSeq: 1,
      timestamp: Date.now(),
    });
    const second = signedDmEvent({
      sender,
      recipient,
      eventId: 'dm-stream-two-event',
      senderStreamId: '2'.repeat(32),
      senderSeq: 1,
      timestamp: Date.now() + 1,
    });

    expect((manager as any).db.insertDirectEvent(first, false)).toBe(true);
    expect((manager as any).db.insertDirectEvent(second, false)).toBe(true);
    expect(
      manager.getDirectHistory(sender.address, recipient.address, 10)
    ).toEqual([
      expect.objectContaining({
        eventId: first.eventId,
        senderStreamId: first.senderStreamId,
        senderSeq: 1,
      }),
      expect.objectContaining({
        eventId: second.eventId,
        senderStreamId: second.senderStreamId,
        senderSeq: 1,
      }),
    ]);
    manager.close();
  });

  it('serves streamed DMs in a signature-valid legacy form during rolling upgrades', () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const event = signedDmEvent({
      sender,
      recipient,
      eventId: 'dm-stream-compatible',
      senderStreamId: '3'.repeat(32),
      senderSeq: 9,
      timestamp: Date.now(),
    });
    const producer = new ReticulumChatManager({ dbPath: tempDbPath() });
    const legacyPage = (producer as any).buildDirectDmPageResourceBlob(
      event.conversationId,
      [event],
      0,
      false,
      false
    );
    const streamPage = (producer as any).buildDirectDmPageResourceBlob(
      event.conversationId,
      [event],
      0,
      false,
      true
    );
    expect(JSON.parse(legacyPage.blob).events[0][0]).toBe('v2');
    expect(JSON.parse(streamPage.blob).events[0][0]).toBe('v3');

    const legacyReceiver = new ReticulumChatManager({ dbPath: tempDbPath() });
    legacyReceiver.setLocalDmAddresses([recipient.address]);
    (legacyReceiver as any).handleDirectPage(
      {
        t: 'RCHAT',
        k: 'dm_page',
        c: event.conversationId,
        e: JSON.parse(legacyPage.blob).events,
      },
      'legacy-peer'
    );
    const [legacyImported] = legacyReceiver.getDirectHistory(
      recipient.address,
      sender.address,
      10
    );
    expect(legacyImported).toMatchObject({ eventId: event.eventId });
    expect(legacyImported).not.toHaveProperty('senderStreamId');

    const streamReceiver = new ReticulumChatManager({ dbPath: tempDbPath() });
    streamReceiver.setLocalDmAddresses([recipient.address]);
    (streamReceiver as any).handleDirectPage(
      {
        t: 'RCHAT',
        k: 'dm_page',
        c: event.conversationId,
        e: JSON.parse(streamPage.blob).events,
      },
      'stream-peer'
    );
    expect(
      streamReceiver.getDirectHistory(recipient.address, sender.address, 10)
    ).toEqual([
      expect.objectContaining({
        eventId: event.eventId,
        senderStreamId: event.senderStreamId,
      }),
    ]);
    producer.close();
    legacyReceiver.close();
    streamReceiver.close();
  });

  it('records outgoing DM attachment references from the nested message payload', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const conversationId = reticulumDmConversationId(
      sender.address,
      recipient.address
    );
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-dm-nested-resource-reference-')
    );
    const sourcePath = path.join(tempRoot, 'image.png');
    fs.writeFileSync(sourcePath, Buffer.from('nested DM image'));
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
    });
    const manifest = resourceStore.importLocalFile({
      sourcePath,
      namespace: 'reticulum-dm-resource',
      ownerId: `dm:${conversationId}:${sender.address}`,
      fileName: 'image.png',
      mimeType: 'image/png',
      encrypted: false,
      metadata: {
        conversationId,
        senderAddress: sender.address,
        recipientAddress: recipient.address,
      },
    });
    const event = signedDmEvent({
      sender,
      recipient,
      eventId: 'dmnestedresource1',
      senderSeq: Date.now() * 1000,
      timestamp: Date.now(),
      payload: JSON.stringify({
        messageText: '<p>image</p>',
        otherData: { images: [manifest] },
      }),
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      resourceStore,
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
    });
    manager.setLocalDmAddresses([sender.address]);

    await expect(manager.publishDirectEvent(event)).resolves.toEqual({
      ok: true,
    });
    expect(
      resourceStore.hasLiveReference(
        manifest.fileHash,
        'dm',
        conversationId,
        event.eventId
      )
    ).toBe(true);

    manager.close();
    resourceStore.close();
  });

  it('repairs a missing DM attachment reference before advertising the file', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const conversationId = reticulumDmConversationId(
      sender.address,
      recipient.address
    );
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-dm-resource-reference-repair-')
    );
    const sourcePath = path.join(tempRoot, 'image.png');
    fs.writeFileSync(sourcePath, Buffer.from('recoverable DM image'));
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
    });
    const manifest = resourceStore.importLocalFile({
      sourcePath,
      namespace: 'reticulum-dm-resource',
      ownerId: `dm:${conversationId}:${sender.address}`,
      fileName: 'image.png',
      mimeType: 'image/png',
      encrypted: false,
      metadata: {
        conversationId,
        senderAddress: sender.address,
        recipientAddress: recipient.address,
      },
    });
    const event = signedDmEvent({
      sender,
      recipient,
      eventId: 'dmrepairresource1',
      senderSeq: Date.now() * 1000,
      timestamp: Date.now(),
      payload: JSON.stringify({
        messageText: '<p>image</p>',
        otherData: { images: [manifest] },
      }),
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      resourceStore,
      bridge: { on: () => undefined, off: () => undefined } as any,
    });
    manager.setLocalDmAddresses([sender.address]);
    expect((manager as any).db.insertDirectEvent(event, true)).toBe(true);
    expect(
      resourceStore.hasLiveReference(
        manifest.fileHash,
        'dm',
        conversationId,
        event.eventId
      )
    ).toBe(false);

    await expect(
      (manager as any).checkLocalDirectResourceServeAvailability(
        conversationId,
        manifest.fileHash,
        manifest.sizeBytes,
        event.eventId
      )
    ).resolves.toEqual({ ok: true });
    expect(
      resourceStore.hasLiveReference(
        manifest.fileHash,
        'dm',
        conversationId,
        event.eventId
      )
    ).toBe(true);

    manager.close();
    resourceStore.close();
  });

  it('still fanouts direct DM notify when the direct peer send has no route', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const recipientPeerHash = 'b'.repeat(32);
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const fanouts: Array<{
      messages: ReticulumChatWire[];
      exclude?: string[];
      options?: { maxPeerCount?: number; selectionKey?: string };
    }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(sender),
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: recipientPeerHash,
          address: recipient.address,
          lastSeenAt: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: ReticulumChatWire
        ) => {
          sent.push({ peer, wire });
          return { ok: false as const, reason: 'no-route' as const };
        },
        fanoutReticulumChatDetailed: async (
          messages: ReticulumChatWire[],
          exclude?: string[],
          options?: { maxPeerCount?: number; selectionKey?: string }
        ) => {
          fanouts.push({ messages, exclude, options });
          return { ok: true as const };
        },
      } as any,
    });
    manager.setLocalDmAddresses([sender.address]);
    await flushAsyncWork();
    const event = signedDmEvent({
      sender,
      recipient,
      eventId: '0123456789abcdea',
      senderSeq: Date.now() * 1000,
      timestamp: Date.now(),
      payload: 'hello',
    });

    const result = await manager.publishDirectEvent(event);

    expect(result).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].peer).toBe(recipientPeerHash);
    const notifyFanout = fanouts.find((call) =>
      call.messages.some((wire) => wire.k === 'dm_notify')
    );
    expect(notifyFanout).toBeTruthy();
    expect(notifyFanout?.exclude ?? []).not.toContain(recipientPeerHash);
    expect(notifyFanout?.exclude ?? []).toContain('a'.repeat(32));
    expect(notifyFanout?.options).toMatchObject({ maxPeerCount: 4 });
    manager.close();
  });

  it('does not fanout a direct DM notify after the destination acknowledges it', async () => {
    vi.useFakeTimers();
    try {
      const sender = createDmIdentity();
      const recipient = createDmIdentity();
      const senderPeerHash = 'a'.repeat(32);
      const recipientPeerHash = 'b'.repeat(32);
      const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
      const fanout: ReticulumChatWire[] = [];
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        signLocalFields: createDmSigner(sender),
        getVerifiedReticulumPeers: () => [
          {
            destinationHash: recipientPeerHash,
            address: recipient.address,
            lastSeenAt: Date.now(),
          },
        ],
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getLocalDestinationHash: () => senderPeerHash,
          sendReticulumChatDetailed: async (
            peer: string,
            wire: ReticulumChatWire
          ) => {
            sent.push({ peer, wire });
            return { ok: true as const };
          },
          fanoutReticulumChatDetailed: async (
            messages: ReticulumChatWire[]
          ) => {
            fanout.push(...messages);
            return { ok: true as const };
          },
        } as any,
      });
      manager.setLocalDmAddresses([sender.address]);
      await flushAsyncWork();
      fanout.length = 0;

      const event = signedDmEvent({
        sender,
        recipient,
        eventId: 'dm-notify-ack-event',
        senderSeq: Date.now() * 1000,
        timestamp: Date.now(),
        payload: 'hello',
      });
      await manager.publishDirectEvent(event);
      const notify = sent.find(
        ({ peer, wire }) =>
          peer === recipientPeerHash && wire.k === 'dm_notify'
      )?.wire as Extract<ReticulumChatWire, { k: 'dm_notify' }> | undefined;
      expect(notify).toBeDefined();

      const timestamp = Date.now();
      const signedFields = buildReticulumDmNotifyAckSignedFields({
        notifyRequestId: notify!.d.q,
        latestCursor: notify!.d.lc,
        peerAddress: sender.address,
        sourcePeerHash: recipientPeerHash,
        authorAddress: recipient.address,
        authorPublicKey: recipient.publicKey,
        timestamp,
      });
      manager.handleWire(
        {
          t: 'RCHAT',
          k: 'dm_notify_ack',
          d: {
            q: notify!.d.q,
            lc: notify!.d.lc,
            b: sender.address,
            sp: recipientPeerHash,
            p: recipient.publicKey,
            n: timestamp,
            z: base58Encode(
              nacl.sign.detached(
                new Uint8Array(canonicalizeForSigning(signedFields)),
                recipient.secretKey
              )
            ),
          },
        },
        recipientPeerHash
      );

      await vi.advanceTimersByTimeAsync(4_000);
      expect(fanout.some((wire) => wire.k === 'dm_notify')).toBe(false);
      manager.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a locally stored DM valid when discovery bridge calls throw', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const recipientPeerHash = 'b'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(sender),
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: recipientPeerHash,
          address: recipient.address,
          lastSeenAt: Date.now(),
        },
      ],
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async () => {
          throw new Error('simulated direct bridge failure');
        },
        fanoutReticulumChatDetailed: async () => {
          throw new Error('simulated fanout bridge failure');
        },
      } as any,
    });
    manager.setLocalDmAddresses([sender.address]);
    await flushAsyncWork();
    const event = signedDmEvent({
      sender,
      recipient,
      eventId: 'dm-discovery-bridge-throws',
      senderSeq: Date.now() * 1000,
      timestamp: Date.now(),
      payload: 'hello',
    });

    await expect(manager.publishDirectEvent(event)).resolves.toEqual({
      ok: true,
    });
    expect((manager as any).db.hasDirectEvent(event.eventId)).toBe(true);
    expect((manager as any).pendingDmNotifyDeliveries.size).toBe(1);

    manager.close();
    expect((manager as any).pendingDmNotifyDeliveries.size).toBe(0);
  });

  it('requests direct DM pages from the notified sender cursor instead of the conversation latest', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const sourcePeerHash = 'a'.repeat(32);
    const requesterPeerHash = 'b'.repeat(32);
    const conversationId = reticulumDmConversationId(
      sender.address,
      recipient.address
    );
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(recipient),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => requesterPeerHash,
        sendReticulumChatDetailed: async (
          peer: string,
          wire: ReticulumChatWire
        ) => {
          sent.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
    });
    manager.setLocalDmAddresses([recipient.address]);
    await flushAsyncWork();

    const lastIncomingFromSender = signedDmEvent({
      sender,
      recipient,
      eventId: 'dm-remote-known-before-gap',
      senderSeq: 1,
      timestamp: 1_000,
    });
    const newerLocalOutgoing = signedDmEvent({
      sender: recipient,
      recipient: sender,
      eventId: 'dm-local-newer-than-missing-remote',
      senderSeq: 1,
      timestamp: 3_000,
    });
    (manager as any).db.getDirectLatestEvent = () => newerLocalOutgoing;
    (manager as any).db.getDirectLatestEventFromSender = () =>
      lastIncomingFromSender;

    await (manager as any).requestDirectMissingEvents(
      conversationId,
      sender.address,
      recipient.address,
      sourcePeerHash,
      '',
      Number.MAX_SAFE_INTEGER
    );
    await flushAsyncWork();

    const request = sent.find(
      (item) => item.peer === sourcePeerHash && item.wire.k === 'dm_req'
    );
    expect(request).toBeDefined();
    expect(
      (request!.wire as Extract<ReticulumChatWire, { k: 'dm_req' }>).q.a
    ).toBe(999);
    manager.close();
  });

  it('runs recurring direct DM probes while overlay health stays good', async () => {
    vi.useFakeTimers();
    try {
      const local = createDmIdentity();
      const fanout: ReticulumChatWire[] = [];
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        signLocalFields: createDmSigner(local),
        hasGoodOverlayHealth: () => true,
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getLocalDestinationHash: () => 'a'.repeat(32),
          fanoutReticulumChatDetailed: async (
            messages: ReticulumChatWire[]
          ) => {
            fanout.push(...messages);
            return { ok: true as const };
          },
        } as any,
      });

      manager.setLocalDmAddresses([local.address]);
      await flushAsyncWork();
      expect(fanout.some((wire) => wire.k === 'dm_probe')).toBe(true);

      fanout.length = 0;
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      expect(fanout.some((wire) => wire.k === 'dm_probe')).toBe(true);
      manager.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps periodic DM discovery sparse while refreshing summaries', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const local = createDmIdentity();
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        signLocalFields: createDmSigner(local),
        hasGoodOverlayHealth: () => true,
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getLocalDestinationHash: () => 'a'.repeat(32),
          fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        } as any,
      });
      const broadcastSummaries = vi
        .spyOn(manager as any, 'broadcastDmNotificationsForLocalAddresses')
        .mockResolvedValue(undefined);

      manager.setLocalDmAddresses([local.address]);
      await flushAsyncWork();
      expect(broadcastSummaries).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(broadcastSummaries).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(16 * 60_000);
      expect(broadcastSummaries).toHaveBeenCalledTimes(2);
      manager.close();
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('marks direct DM pages as continued when more events remain', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const sourcePeerHash = 'a'.repeat(32);
    const requesterPeerHash = 'b'.repeat(32);
    const conversationId = reticulumDmConversationId(
      sender.address,
      recipient.address
    );
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const sentResources: Array<Record<string, any>> = [];
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => sourcePeerHash,
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        sentResources.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        sent.push({ peer, wire });
        return { ok: true as const };
      },
    });
    const source = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
    });
    source.setLocalDmAddresses([sender.address]);
    await flushQueuedWork();
    sent.length = 0;

    const first = signedDmEvent({
      sender,
      recipient,
      eventId: 'dm-source-page-1',
      senderSeq: 1,
      timestamp: Date.now() - 2_000,
    });
    const second = signedDmEvent({
      sender,
      recipient,
      eventId: 'dm-source-page-2',
      senderSeq: 2,
      timestamp: Date.now() - 1_000,
    });
    expect(validateReticulumDmEventShape(first)).toBe(true);
    expect(verifyReticulumDmEvent(first)).toBe(true);
    expect((source as any).localDmAddresses.has(sender.address)).toBe(true);
    (source as any).db.getDirectEventsAfter = () => [first, second];

    const requestId = 'c'.repeat(8);
    const timestamp = Date.now();
    const signedFields = buildReticulumDmRequestSignedFields({
      peerAddress: sender.address,
      after: 0,
      limit: 1,
      requesterPeerHash,
      requestId,
      authorAddress: recipient.address,
      authorPublicKey: recipient.publicKey,
      timestamp,
    });
    await (source as any).handleDirectRequest(
      {
        t: 'RCHAT',
        k: 'dm_req',
        q: {
          b: sender.address,
          after: 0,
          limit: 1,
          q: requestId,
          rp: requesterPeerHash,
          p: recipient.publicKey,
          n: timestamp,
          z: base58Encode(
            nacl.sign.detached(
              new Uint8Array(canonicalizeForSigning(signedFields)),
              recipient.secretKey
            )
          ),
        },
      },
      requesterPeerHash
    );
    await flushQueuedWork();

    expect(sent).toHaveLength(1);
    expect(sent[0].peer).toBe(requesterPeerHash);
    expect(sent[0].wire).toMatchObject({
      t: 'RCHAT',
      k: 'dm_page_offer',
      p: {
        c: conversationId,
        more: 1,
        n: 1,
      },
    });
    expect(sentResources).toHaveLength(1);
    expect(sentResources[0].metadata).toMatchObject({
      logicalResourceType: 'reticulum_chat_dm_page',
      conversationId,
      eventCount: 1,
    });
    source.close();
  });

  it('continues direct DM pulls after importing a partial page', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const sourcePeerHash = 'a'.repeat(32);
    const requesterPeerHash = 'b'.repeat(32);
    const conversationId = reticulumDmConversationId(
      sender.address,
      recipient.address
    );
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => requesterPeerHash,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        sent.push({ peer, wire });
        return { ok: true as const };
      },
    });
    const receiver = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(recipient),
      bridge: bridge as any,
    });
    receiver.setLocalDmAddresses([recipient.address]);
    await flushQueuedWork();
    sent.length = 0;
    expect((receiver as any).localDmAddresses.has(recipient.address)).toBe(
      true
    );

    const first = signedDmEvent({
      sender,
      recipient,
      eventId: 'dm-receiver-page-1',
      senderSeq: 1,
      timestamp: Date.now() - 1_000,
    });
    (receiver as any).acceptDirectEvent = () => true;
    (receiver as any).db.getDirectLatestEvent = () => first;
    (receiver as any).handleDirectPage(
      {
        t: 'RCHAT',
        k: 'dm_page',
        c: conversationId,
        m: 1,
        e: [first],
      },
      sourcePeerHash
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const request = sent.find(
      (item) => item.peer === sourcePeerHash && item.wire.k === 'dm_req'
    );
    expect(request).toBeDefined();
    expect(request?.wire).toMatchObject({
      t: 'RCHAT',
      k: 'dm_req',
      q: {
        b: sender.address,
        a: first.timestamp - 1,
        l: 50,
      },
    });
    expect(
      verifyReticulumDmRequest(
        (request!.wire as Extract<ReticulumChatWire, { k: 'dm_req' }>).q,
        Date.now()
      )
    ).toBe(true);
    receiver.close();
  });

  it('imports direct DM pages from resource transfers and continues when truncated', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const sourcePeerHash = 'a'.repeat(32);
    const requesterPeerHash = 'b'.repeat(32);
    const transferId = 'dm-page-resource-test';
    const conversationId = reticulumDmConversationId(
      sender.address,
      recipient.address
    );
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => requesterPeerHash,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        sent.push({ peer, wire });
        return { ok: true as const };
      },
    });
    const receiver = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(recipient),
      bridge: bridge as any,
    });
    receiver.setLocalDmAddresses([recipient.address]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const first = signedDmEvent({
      sender,
      recipient,
      eventId: '0123456789abcdf0',
      senderSeq: 1,
      timestamp: Date.now() - 1_000,
    });
    const pagePath = path.join(
      os.tmpdir(),
      `qortal-dm-page-${Date.now()}-${Math.random()}.json`
    );
    fs.writeFileSync(
      pagePath,
      JSON.stringify({
        v: 1,
        c: conversationId,
        after: 0,
        more: true,
        events: [
          [
            'v2',
            first.eventId,
            first.recipientAddress,
            first.senderPublicKey,
            first.senderSeq,
            first.timestamp,
            'm',
            first.payload,
            first.signature,
          ],
        ],
      })
    );
    (receiver as any).directDmPageRequests.set(transferId, {
      transferId,
      conversationId,
      pageHash: '',
      sizeBytes: fs.statSync(pagePath).size,
      eventCount: 1,
      sourcePeerHash,
      requestedAt: Date.now(),
      requesterAddress: recipient.address,
      requesterPeerHash,
      peerAddress: sender.address,
      after: 0,
      limit: 1,
      requestId: 'd'.repeat(8),
    });
    const acceptSpy = vi
      .spyOn(receiver as any, 'acceptDirectEvent')
      .mockReturnValue(true);
    (receiver as any).db.getDirectLatestEvent = () => first;

    receiver.handleResourceEvent({
      status: 'received',
      transferId,
      path: pagePath,
    } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(acceptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: first.eventId,
        conversationId,
        senderAddress: sender.address,
        recipientAddress: recipient.address,
      }),
      false
    );
    const request = sent.find(
      (item) => item.peer === sourcePeerHash && item.wire.k === 'dm_req'
    );
    expect(request).toBeDefined();
    expect(request?.wire).toMatchObject({
      t: 'RCHAT',
      k: 'dm_req',
      q: {
        b: sender.address,
        a: first.timestamp - 1,
        l: 50,
      },
    });
    expect(fs.existsSync(pagePath)).toBe(false);
    receiver.close();
  });

  it('suppresses repeated direct DM page pulls after a no-progress terminal page', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const sourcePeerHash = 'a'.repeat(32);
    const requesterPeerHash = 'b'.repeat(32);
    const transferId = 'dm-page-no-progress-test';
    const conversationId = reticulumDmConversationId(
      sender.address,
      recipient.address
    );
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => requesterPeerHash,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        sent.push({ peer, wire });
        return { ok: true as const };
      },
    });
    const receiver = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(recipient),
      bridge: bridge as any,
      now: () => 100_000,
    });
    receiver.setLocalDmAddresses([recipient.address]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pagePath = path.join(
      os.tmpdir(),
      `qortal-dm-page-empty-${Date.now()}-${Math.random()}.json`
    );
    fs.writeFileSync(
      pagePath,
      JSON.stringify({
        v: 1,
        c: conversationId,
        after: 0,
        more: false,
        events: [],
      }),
      'utf8'
    );
    (receiver as any).directDmPageRequests.set(transferId, {
      transferId,
      conversationId,
      pageHash: '',
      sizeBytes: fs.statSync(pagePath).size,
      eventCount: 0,
      sourcePeerHash,
      requestedAt: Date.now(),
      requesterAddress: recipient.address,
      requesterPeerHash,
      peerAddress: sender.address,
      after: 0,
      limit: 50,
      requestId: 'e'.repeat(8),
      remoteEventId: 'cursor:same-dm-state',
      remoteTimestamp: Number.MAX_SAFE_INTEGER,
    });

    await (receiver as any).importReceivedDirectDmPageResource({
      status: 'received',
      transferId,
      path: pagePath,
    });
    sent.length = 0;

    await (receiver as any).requestDirectMissingEvents(
      conversationId,
      sender.address,
      recipient.address,
      sourcePeerHash,
      'cursor:same-dm-state',
      Number.MAX_SAFE_INTEGER,
      undefined,
      { requestId: 'e'.repeat(8) }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent.find((item) => item.wire.k === 'dm_req')).toBeUndefined();
    await (receiver as any).requestDirectMissingEvents(
      conversationId,
      sender.address,
      recipient.address,
      sourcePeerHash,
      'cursor:same-dm-state',
      Number.MAX_SAFE_INTEGER,
      undefined,
      { requestId: 'f'.repeat(8) }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent.find((item) => item.wire.k === 'dm_req')).toBeUndefined();
    await (receiver as any).requestDirectMissingEvents(
      conversationId,
      sender.address,
      recipient.address,
      sourcePeerHash,
      'new-remote-dm-event',
      100_001,
      undefined,
      { requestId: 'f'.repeat(8) }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent.find((item) => item.wire.k === 'dm_req')).toBeDefined();
    fs.rmSync(pagePath, { force: true });
    receiver.close();
  });

  it('reuses DM notify route ids for missing-event pulls', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const sourcePeerHash = 'a'.repeat(32);
    const requesterPeerHash = 'b'.repeat(32);
    const inboundPeerHash = 'c'.repeat(32);
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => requesterPeerHash,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        sent.push({ peer, wire });
        return { ok: true as const };
      },
    });
    const receiver = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(recipient),
      bridge: bridge as any,
    });
    receiver.setLocalDmAddresses([recipient.address]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    sent.length = 0;

    const requestId = 'd'.repeat(8);
    const timestamp = Date.now();
    const signedFields = buildReticulumDmNotifySignedFields({
      peerAddress: recipient.address,
      sourcePeerHash,
      requestId,
      maxHops: 5,
      authorAddress: sender.address,
      authorPublicKey: sender.publicKey,
      timestamp,
    });
    await (receiver as any).handleDirectNotify(
      {
        t: 'RCHAT',
        k: 'dm_notify',
        d: {
          b: recipient.address,
          sp: sourcePeerHash,
          q: requestId,
          p: sender.publicKey,
          n: timestamp,
          z: base58Encode(
            nacl.sign.detached(
              new Uint8Array(canonicalizeForSigning(signedFields)),
              sender.secretKey
            )
          ),
        },
      },
      inboundPeerHash
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const request = sent.find(
      (item) => item.peer === sourcePeerHash && item.wire.k === 'dm_req'
    );
    expect(request).toBeDefined();
    expect(
      (request!.wire as Extract<ReticulumChatWire, { k: 'dm_req' }>).q.q
    ).toBe(requestId);
    expect(
      verifyReticulumDmRequest(
        (request!.wire as Extract<ReticulumChatWire, { k: 'dm_req' }>).q,
        Date.now()
      )
    ).toBe(true);
    receiver.close();
  });

  it('does not suppress distinct direct DM notifies received close together', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const sourcePeerHash = 'a'.repeat(32);
    const requesterPeerHash = 'b'.repeat(32);
    const inboundPeerHash = 'c'.repeat(32);
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => requesterPeerHash,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        sent.push({ peer, wire });
        return { ok: true as const };
      },
    });
    const receiver = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(recipient),
      bridge: bridge as any,
    });
    receiver.setLocalDmAddresses([recipient.address]);
    await flushAsyncWork();

    const buildNotify = (
      requestId: string,
      timestamp: number
    ): Extract<ReticulumChatWire, { k: 'dm_notify' }> => {
      const signedFields = buildReticulumDmNotifySignedFields({
        peerAddress: recipient.address,
        sourcePeerHash,
        requestId,
        maxHops: 5,
        authorAddress: sender.address,
        authorPublicKey: sender.publicKey,
        timestamp,
      });
      return {
        t: 'RCHAT',
        k: 'dm_notify',
        d: {
          b: recipient.address,
          sp: sourcePeerHash,
          q: requestId,
          p: sender.publicKey,
          n: timestamp,
          z: base58Encode(
            nacl.sign.detached(
              new Uint8Array(canonicalizeForSigning(signedFields)),
              sender.secretKey
            )
          ),
        },
      };
    };

    const timestamp = Date.now();
    await (receiver as any).handleDirectNotify(
      buildNotify('d'.repeat(8), timestamp),
      inboundPeerHash
    );
    await (receiver as any).handleDirectNotify(
      buildNotify('e'.repeat(8), timestamp + 1),
      inboundPeerHash
    );
    await flushAsyncWork();

    const requests = sent.filter(
      (item) => item.peer === sourcePeerHash && item.wire.k === 'dm_req'
    );
    expect(requests).toHaveLength(2);
    expect(
      (requests[0].wire as Extract<ReticulumChatWire, { k: 'dm_req' }>).q.q
    ).toBe('d'.repeat(8));
    expect(
      (requests[1].wire as Extract<ReticulumChatWire, { k: 'dm_req' }>).q.q
    ).toBe('e'.repeat(8));
    receiver.close();
  });

  it('does not retry a relayed DM notify when exclusions leave no overlay route', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const local = createDmIdentity();
    const sourcePeerHash = 'a'.repeat(32);
    const localPeerHash = 'b'.repeat(32);
    const inboundPeerHash = 'c'.repeat(32);
    const fanoutReticulumChatDetailed = vi.fn(async () => ({
      ok: false as const,
      reason: 'no-route' as const,
      error: 'No overlay route',
    }));
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => localPeerHash,
      fanoutReticulumChatDetailed,
    });
    const relay = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(local),
      bridge: bridge as any,
    });
    relay.setLocalDmAddresses([local.address]);
    await flushAsyncWork();
    fanoutReticulumChatDetailed.mockClear();

    const requestId = 'f'.repeat(8);
    const timestamp = Date.now();
    const signedFields = buildReticulumDmNotifySignedFields({
      peerAddress: recipient.address,
      sourcePeerHash,
      requestId,
      maxHops: 5,
      authorAddress: sender.address,
      authorPublicKey: sender.publicKey,
      timestamp,
    });
    await (relay as any).handleDirectNotify(
      {
        t: 'RCHAT',
        k: 'dm_notify',
        d: {
          b: recipient.address,
          sp: sourcePeerHash,
          q: requestId,
          p: sender.publicKey,
          n: timestamp,
          z: base58Encode(
            nacl.sign.detached(
              new Uint8Array(canonicalizeForSigning(signedFields)),
              sender.secretKey
            )
          ),
        },
      },
      inboundPeerHash
    );
    await flushAsyncWork();

    expect(fanoutReticulumChatDetailed).toHaveBeenCalledTimes(1);
    expect((relay as any).controlRetryQueue.size).toBe(0);
    relay.close();
  });

  it('retries transient relayed DM notify failures but quietly stops at an excluded-route dead end', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const local = createDmIdentity();
    const sourcePeerHash = 'a'.repeat(32);
    const localPeerHash = 'b'.repeat(32);
    const inboundPeerHash = 'c'.repeat(32);
    const fanoutReticulumChatDetailed = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        reason: 'bridge-overloaded' as const,
        error: 'Bridge overloaded',
      })
      .mockResolvedValueOnce({
        ok: false as const,
        reason: 'no-route' as const,
        error: 'No overlay route',
      });
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => localPeerHash,
      fanoutReticulumChatDetailed,
    });
    const relay = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(local),
      bridge: bridge as any,
    });
    relay.setLocalDmAddresses([local.address]);
    await flushAsyncWork();
    fanoutReticulumChatDetailed.mockClear();

    const requestId = '1'.repeat(8);
    const timestamp = Date.now();
    const signedFields = buildReticulumDmNotifySignedFields({
      peerAddress: recipient.address,
      sourcePeerHash,
      requestId,
      maxHops: 5,
      authorAddress: sender.address,
      authorPublicKey: sender.publicKey,
      timestamp,
    });
    await (relay as any).handleDirectNotify(
      {
        t: 'RCHAT',
        k: 'dm_notify',
        d: {
          b: recipient.address,
          sp: sourcePeerHash,
          q: requestId,
          p: sender.publicKey,
          n: timestamp,
          z: base58Encode(
            nacl.sign.detached(
              new Uint8Array(canonicalizeForSigning(signedFields)),
              sender.secretKey
            )
          ),
        },
      },
      inboundPeerHash
    );
    await flushAsyncWork();

    const queued = [...(relay as any).controlRetryQueue.values()];
    expect(queued).toHaveLength(1);
    expect(queued[0].dropIfNoRoute).toBe(true);
    queued[0].nextAttemptAt = 0;
    await (relay as any).drainControlRetryQueue();

    expect(fanoutReticulumChatDetailed).toHaveBeenCalledTimes(2);
    expect((relay as any).controlRetryQueue.size).toBe(0);
    relay.close();
  });

  it('answers DM probes from another device using the same local address', async () => {
    const sender = createDmIdentity();
    const recipient = createDmIdentity();
    const providerPeerHash = 'a'.repeat(32);
    const requesterPeerHash = 'b'.repeat(32);
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => providerPeerHash,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        sent.push({ peer, wire });
        return { ok: true as const };
      },
    });
    const provider = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(recipient),
      bridge: bridge as any,
    });
    provider.setLocalDmAddresses([recipient.address]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    sent.length = 0;

    expect((provider as any).localDmAddresses.has(recipient.address)).toBe(
      true
    );
    const unique = nodeCrypto.randomBytes(4).toString('hex');
    const event = signedDmEvent({
      sender,
      recipient,
      eventId: `dm-same-account-probe-event-${unique}`,
      senderSeq: 100_000 + Number.parseInt(unique.slice(0, 4), 16),
      timestamp: Date.now() - 1_000,
    });
    expect(validateReticulumDmEventShape(event)).toBe(true);
    expect(verifyReticulumDmEvent(event)).toBe(true);
    expect((provider as any).acceptsDirectConversation(event)).toBe(true);
    (provider as any).db.getDirectSummaries = (address: string) =>
      address === recipient.address
        ? [
            {
              peerAddress: sender.address,
              conversationId: event.conversationId,
              lastEvent: event,
              unreadCount: 0,
              updatedAt: event.timestamp,
            },
          ]
        : [];

    const requestId = 'e'.repeat(8);
    const timestamp = Date.now();
    const signedFields = buildReticulumDmProbeSignedFields({
      requestId,
      maxHops: 5,
      authorAddress: recipient.address,
      authorPublicKey: recipient.publicKey,
      timestamp,
    });
    await (provider as any).handleDirectProbe(
      {
        t: 'RCHAT',
        k: 'dm_probe',
        q: {
          q: requestId,
          p: recipient.publicKey,
          n: timestamp,
          z: base58Encode(
            nacl.sign.detached(
              new Uint8Array(canonicalizeForSigning(signedFields)),
              recipient.secretKey
            )
          ),
        },
      },
      requesterPeerHash
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const notify = sent.find(
      (item) => item.peer === requesterPeerHash && item.wire.k === 'dm_notify'
    );
    expect(notify).toBeDefined();
    expect(
      (notify!.wire as Extract<ReticulumChatWire, { k: 'dm_notify' }>).d.r
    ).toBe(requestId);
    expect(
      verifyReticulumDmNotify(
        (notify!.wire as Extract<ReticulumChatWire, { k: 'dm_notify' }>).d,
        Date.now()
      )
    ).toBe(true);
    provider.close();
  });

  it('does not retry a relayed DM probe when exclusions leave no overlay route', async () => {
    const requester = createDmIdentity();
    const local = createDmIdentity();
    const localPeerHash = 'a'.repeat(32);
    const inboundPeerHash = 'b'.repeat(32);
    const fanoutReticulumChatDetailed = vi.fn(async () => ({
      ok: false as const,
      reason: 'no-route' as const,
      error: 'No overlay route',
    }));
    const bridge = Object.assign(new EventEmitter(), {
      getLocalDestinationHash: () => localPeerHash,
      fanoutReticulumChatDetailed,
    });
    const relay = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createDmSigner(local),
      bridge: bridge as any,
    });
    relay.setLocalDmAddresses([local.address]);
    await flushAsyncWork();
    fanoutReticulumChatDetailed.mockClear();

    const requestId = '2'.repeat(8);
    const timestamp = Date.now();
    const signedFields = buildReticulumDmProbeSignedFields({
      requestId,
      maxHops: 5,
      authorAddress: requester.address,
      authorPublicKey: requester.publicKey,
      timestamp,
    });
    await (relay as any).handleDirectProbe(
      {
        t: 'RCHAT',
        k: 'dm_probe',
        q: {
          q: requestId,
          p: requester.publicKey,
          n: timestamp,
          z: base58Encode(
            nacl.sign.detached(
              new Uint8Array(canonicalizeForSigning(signedFields)),
              requester.secretKey
            )
          ),
        },
      },
      inboundPeerHash
    );
    await flushAsyncWork();

    expect(fanoutReticulumChatDetailed).toHaveBeenCalledTimes(1);
    expect((relay as any).controlRetryQueue.size).toBe(0);
    relay.close();
  });

  it('publishes durable events as bounded digest when no peers are subscribed', async () => {
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      signLocalFields: createReticulumChatTestSigner(),
    });
    const event = signedEvent({ groupId: 9 });
    manager.setLocalGroupMemberships([9]);
    const result = await manager.publishEvent(event);
    expect(result.ok).toBe(true);
    expect(sent).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'event_notice_v3',
        g: 9,
        n: expect.objectContaining({
          id: event.eventId,
        }),
      })
    );
    const stateDigest = sent.find((wire) => wire.k === 'group_state_digest_v3');
    expect(stateDigest).toMatchObject({
      t: 'RCHAT',
      v: 3,
      k: 'group_state_digest_v3',
      g: 9,
      d: {
        latest: {
          id: event.eventId,
        },
      },
    });
    expect(JSON.stringify(stateDigest)).not.toContain('encryptedPayload');
    expect(
      byteLengthUtf8JsonWithBridgeSender(stateDigest!)
    ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    manager.close();
  });

  it('keeps reticulum group key exchange disabled behind the kill switch', async () => {
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const admin = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    const hello = (admin as any).buildHelloWire();
    admin.setLocalGroupMemberships([{ groupId: 88, isPrivate: true }]);
    const privateKey = await (admin as any).createGroupKeyIfAdmin(88);
    const publicKey = await (admin as any).createGroupKeyIfAdmin(90);
    expect(hello.f).not.toContain('group_keys');
    expect(hello.f).not.toContain('relay_cache');
    expect(privateKey).toBeNull();
    expect(publicKey).toBeNull();
    expect((admin as any).db.getActiveGroupKey(88)).toBeNull();
    expect((admin as any).db.getActiveGroupKey(90)).toBeNull();
    expect(sent.some((wire) => wire.k === 'gkd')).toBe(false);
    admin.close();
  });

  relayCacheDisabledIt(
    'keeps relay cache disabled behind the kill switch',
    async () => {
      const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
      const resources: unknown[] = [];
      const bridge = {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        sendReticulumChatResourceDetailed: async (payload: unknown) => {
          resources.push(payload);
          return { ok: true as const };
        },
      };
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: bridge as any,
        now: () => 100_000,
        validateGroupMember: async () => true,
      });
      const hello = (manager as any).buildHelloWire();
      expect(hello.f).not.toContain('relay_cache');
      manager.setLocalGroupMemberships([702]);
      manager.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [999], mode: 'summary' },
        'relay-peer'
      );
      const event = signedEvent({
        eventId: 'relay-disabled-publish-event',
        groupId: 702,
        timestamp: 100_000,
      });

      await expect(manager.publishEvent(event)).resolves.toMatchObject({
        ok: true,
      });
      await flushQueuedWork();

      expect(resources).toHaveLength(0);
      expect(direct).not.toContainEqual(
        expect.objectContaining({
          peer: 'relay-peer',
          wire: expect.objectContaining({
            k: 'event_offer',
            o: expect.objectContaining({ rs: 1 }),
          }),
        })
      );
      manager.close();
    }
  );

  relayCacheDisabledIt(
    'does not serve relay digests or relay queries while disabled',
    async () => {
      const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
      const resources: unknown[] = [];
      const bridge = {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        sendReticulumChatResourceDetailed: async (payload: unknown) => {
          resources.push(payload);
          return { ok: true as const };
        },
      };
      const now = 100_000;
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: bridge as any,
        now: () => now,
      });
      const event = signedEvent({
        eventId: 'relay-disabled-cached-event',
        groupId: 703,
        timestamp: now,
      });
      (manager as any).db.storeRelayEventBlob(
        event,
        serializeReticulumChatEvent(event),
        'source-peer',
        now
      );

      manager.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [703], mode: 'summary' },
        'requester-peer'
      );
      manager.handleWire(
        {
          t: 'RCHAT',
          k: 'relay_query',
          g: 703,
          q: { ids: [event.eventId] },
        },
        'requester-peer'
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(direct.some((item) => item.wire.k === 'relay_digest')).toBe(false);
      expect(direct.some((item) => item.wire.k === 'event_offer')).toBe(false);
      expect(resources).toHaveLength(0);
      manager.close();
    }
  );

  it('publishes oversized live events as event resource offers and digest discovery', async () => {
    const fanout: Record<string, unknown>[] = [];
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const accepts: Array<Record<string, unknown>> = [];
    const resources: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        fanout.push(...messages);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      acceptReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepts.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (payload: unknown) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
    });
    manager.setLocalGroupMemberships([9]);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [9], mode: 'active' },
      'peer-a'
    );

    const event = signedEvent({ groupId: 9, timestamp: 100_000 });
    const result = await manager.publishEvent(event);

    expect(result.ok).toBe(true);
    expect(resources).toHaveLength(1);
    expect(
      direct.some(({ wire }) => wire.k === 'event_notice_v3') ||
        fanout.some((wire) => wire.k === 'event_notice_v3')
    ).toBe(true);
    expect(fanout.find((wire) => wire.k === 'event_batch')).toBeUndefined();
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'event_offer',
          g: 9,
          o: expect.objectContaining({ id: event.eventId }),
        }),
      })
    );
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'group_state_digest_v3',
          g: 9,
          d: expect.objectContaining({
            latest: expect.objectContaining({
              id: event.eventId,
            }),
          }),
        }),
      })
    );
    expect(
      fanout.find((wire) => wire.k === 'group_state_digest_v3')
    ).toBeUndefined();
    expect(
      direct.some(({ wire }) =>
        JSON.stringify(wire).includes('encryptedPayload')
      )
    ).toBe(false);
    manager.close();
  });

  relayCacheIt(
    'stores relay event resources without importing them into normal chat history',
    async () => {
      const acceptedTransfers: unknown[] = [];
      const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
      const resources: unknown[] = [];
      const bridge = {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (payload: unknown) => {
          acceptedTransfers.push(payload);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        sendReticulumChatResourceDetailed: async (payload: unknown) => {
          resources.push(payload);
          return { ok: true as const };
        },
      };
      const now = Date.now();
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: bridge as any,
        now: () => now,
      });
      const event = signedEvent({
        eventId: 'relay-cache-event',
        groupId: 701,
        timestamp: now,
      });
      const blob = serializeReticulumChatEvent(event);
      const wireHash = nodeCrypto
        .createHash('sha256')
        .update(blob, 'utf8')
        .digest('hex');
      const resourcePath = path.join(
        path.dirname(tempDbPath()),
        'relay-cache-event.json'
      );
      fs.writeFileSync(resourcePath, blob, 'utf8');

      manager.handleWire(
        {
          t: 'RCHAT',
          k: 'event_offer',
          g: 701,
          o: {
            x: 'relay-store-transfer',
            id: event.eventId,
            ph: event.payloadHash,
            wh: wireHash,
            s: Buffer.byteLength(blob, 'utf8'),
            rs: 1,
          },
        },
        'source-peer'
      );
      expect(acceptedTransfers).toHaveLength(1);

      manager.handleResourceEvent({
        status: 'received',
        transferId: 'relay-store-transfer',
        peerPresenceHash: 'source-peer',
        path: resourcePath,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getHistory(701, 10)).toHaveLength(0);
      manager.handleWire(
        {
          t: 'RCHAT',
          k: 'relay_query',
          g: 701,
          q: { ids: [event.eventId] },
        },
        'requester-peer'
      );
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(resources).toHaveLength(1);
      expect(direct).toContainEqual(
        expect.objectContaining({
          wire: expect.objectContaining({
            k: 'event_offer',
            o: expect.objectContaining({
              id: event.eventId,
              rc: 1,
              wh: wireHash,
            }),
          }),
        })
      );
      manager.close();
    }
  );

  relayCacheIt(
    'queues relay-store uploads for eligible published events',
    async () => {
      const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
      const resources: unknown[] = [];
      const bridge = {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        sendReticulumChatResourceDetailed: async (payload: unknown) => {
          resources.push(payload);
          return { ok: true as const };
        },
      };
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: bridge as any,
        now: () => 100_000,
      });
      manager.setLocalGroupMemberships([702]);
      manager.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [999], mode: 'summary' },
        'relay-peer'
      );
      const event = signedEvent({
        eventId: 'relay-publish-event',
        groupId: 702,
        timestamp: 100_000,
      });

      await expect(manager.publishEvent(event)).resolves.toMatchObject({
        ok: true,
      });
      await waitForCondition(() =>
        direct.some((wire) => wire.k === 'event_req')
      );

      expect(resources).toHaveLength(1);
      expect(direct).toContainEqual(
        expect.objectContaining({
          peer: 'relay-peer',
          wire: expect.objectContaining({
            k: 'event_offer',
            o: expect.objectContaining({
              id: event.eventId,
              rs: 1,
            }),
          }),
        })
      );
      manager.close();
    }
  );

  it('does not relay-store admin-private published events', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const resources: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (payload: unknown) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([
      { groupId: 702, isAdmin: true, localAddress: 'Qadmin' },
    ]);
    upsertTestChannel(manager, {
      groupId: 702,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [999], mode: 'summary' },
      'relay-peer'
    );
    const event = signedEvent({
      eventId: 'relay-admin-private-publish-event',
      groupId: 702,
      channelId: 'admin-private',
      timestamp: 100_000,
    });

    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(resources).toHaveLength(0);
    expect(direct).not.toContainEqual(
      expect.objectContaining({
        peer: 'relay-peer',
        wire: expect.objectContaining({
          k: 'event_offer',
          o: expect.objectContaining({
            id: event.eventId,
            rs: 1,
          }),
        }),
      })
    );
    manager.close();
  });

  it('does not offer relay-cached admin-private event resources to non-admin requesters', async () => {
    const resources: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        resources.push(payload);
        return { ok: true as const };
      },
      authorizeReticulumChatResourceDetailed: async () => ({
        ok: true as const,
      }),
      rejectReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => false,
    });
    upsertTestChannel(manager, {
      groupId: 702,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'relay-cached-admin-private-event',
      groupId: 702,
      channelId: 'admin-private',
      timestamp: 100_000,
    });
    (manager as any).db.storeRelayEventBlob(
      event,
      serializeReticulumChatEvent(event),
      'source-peer',
      100_000
    );

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'relay_query',
        g: 702,
        q: { ids: [event.eventId] },
      },
      'requester-peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(resources).toHaveLength(0);
    manager.close();
  });

  relayCacheIt(
    'serves relay digests for cached events after group_sub',
    async () => {
      const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
      const bridge = {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      };
      const now = 100_000;
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: bridge as any,
        now: () => now,
      });
      const event = signedEvent({
        eventId: 'relay-digest-event',
        groupId: 703,
        timestamp: now,
      });
      (manager as any).db.storeRelayEventBlob(
        event,
        serializeReticulumChatEvent(event),
        'source-peer',
        now
      );

      manager.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [703], mode: 'summary' },
        'requester-peer'
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      const digest = direct.find((item) => item.wire.k === 'relay_digest');
      expect(digest).toMatchObject({
        peer: 'requester-peer',
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'relay_digest',
          g: 703,
        }),
      });
      expect((digest?.wire as any).events).toContainEqual(
        expect.objectContaining({
          id: event.eventId,
          ts: event.timestamp,
          c: event.channelId,
        })
      );
      manager.close();
    }
  );

  relayCacheIt(
    'does not serve empty or duplicate relay digests for repeated group_sub',
    async () => {
      const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
      const bridge = {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      };
      let now = 100_000;
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: bridge as any,
        now: () => now,
      });

      manager.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [704], mode: 'summary' },
        'requester-peer'
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(direct.some((item) => item.wire.k === 'relay_digest')).toBe(false);

      const event = signedEvent({
        eventId: 'relay-digest-duplicate-event',
        groupId: 704,
        timestamp: now,
      });
      (manager as any).db.storeRelayEventBlob(
        event,
        serializeReticulumChatEvent(event),
        'source-peer',
        now
      );
      now += 31_000;
      manager.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [704], mode: 'summary' },
        'requester-peer'
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        direct.filter((item) => item.wire.k === 'relay_digest')
      ).toHaveLength(1);

      manager.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [704], mode: 'summary' },
        'requester-peer'
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        direct.filter((item) => item.wire.k === 'relay_digest')
      ).toHaveLength(1);
      manager.close();
    }
  );

  relayCacheIt(
    'keeps relay digest pages inside the Reticulum wire limit',
    async () => {
      const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
      const bridge = {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      };
      const now = 100_000;
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: bridge as any,
        now: () => now,
      });
      for (let index = 0; index < 12; index += 1) {
        const event = signedEvent({
          eventId: `relay-digest-page-${index}`,
          groupId: 705,
          authorSeq: index + 1,
          timestamp: now + index,
        });
        (manager as any).db.storeRelayEventBlob(
          event,
          serializeReticulumChatEvent(event),
          'source-peer',
          now + index
        );
      }

      manager.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [705], mode: 'summary' },
        'requester-peer'
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      const digests = direct.filter((item) => item.wire.k === 'relay_digest');
      expect(digests.length).toBeGreaterThan(0);
      expect(
        digests.reduce(
          (total, item) => total + ((item.wire as any).events ?? []).length,
          0
        )
      ).toBeGreaterThan(0);
      expect(digests.every((item) => wireFitsReticulum(item.wire))).toBe(true);
      manager.close();
    }
  );

  relayCacheIt(
    'uses relay digest discovery to fetch an offline cached event',
    async () => {
      const relayDirect: Array<{
        peer: string;
        wire: Record<string, unknown>;
      }> = [];
      const relayResources: Array<Record<string, any>> = [];
      const receiverDirect: Array<{
        peer: string;
        wire: Record<string, unknown>;
      }> = [];
      const relayBridge = {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          relayDirect.push({ peer, wire });
          return { ok: true as const };
        },
        sendReticulumChatResourceDetailed: async (
          payload: Record<string, any>
        ) => {
          relayResources.push(payload);
          return { ok: true as const };
        },
      };
      const receiverBridge = {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          receiverDirect.push({ peer, wire });
          return { ok: true as const };
        },
        acceptReticulumChatResourceDetailed: async () => ({
          ok: true as const,
        }),
      };
      const now = 100_000;
      const relay = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: relayBridge as any,
        now: () => now,
      });
      const receiver = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: receiverBridge as any,
        now: () => now,
      });
      receiver.setLocalGroupMemberships([706]);
      receiver.subscribeGroup(706);
      receiverDirect.length = 0;
      const event = signedEvent({
        eventId: 'relay-offline-catchup-event',
        groupId: 706,
        timestamp: now,
      });
      (relay as any).db.storeRelayEventBlob(
        event,
        serializeReticulumChatEvent(event),
        'source-peer',
        now
      );

      relay.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [706], mode: 'summary' },
        'receiver-peer'
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      const relayDigest = relayDirect.find(
        (item) => item.wire.k === 'relay_digest'
      );
      expect(relayDigest).toBeDefined();

      receiver.handleWire(relayDigest!.wire, 'relay-peer');
      await new Promise((resolve) => setTimeout(resolve, 20));
      const relayQuery = receiverDirect.find(
        (item) => item.wire.k === 'relay_query'
      );
      expect(relayQuery).toMatchObject({
        peer: 'relay-peer',
        wire: expect.objectContaining({
          k: 'relay_query',
          q: expect.objectContaining({ ids: [event.eventId] }),
        }),
      });

      relay.handleWire(relayQuery!.wire, 'receiver-peer');
      await new Promise((resolve) => setTimeout(resolve, 20));
      const eventOffer = relayDirect.find(
        (item) => item.wire.k === 'event_offer'
      );
      expect(eventOffer).toBeDefined();
      expect(relayResources).toHaveLength(1);

      receiver.handleWire(eventOffer!.wire, 'relay-peer');
      receiver.handleResourceEvent({
        status: 'received',
        transferId: relayResources[0].transferId,
        peerPresenceHash: 'relay-peer',
        path: relayResources[0].filePath,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(
        receiver.getHistory(706, 10).map((item) => item.eventId)
      ).toContain(event.eventId);
      relay.close();
      receiver.close();
    }
  );

  relayCacheIt(
    'routes relay digest fetches through an intermediate overlay peer',
    async () => {
      const receiverPeer = 'aaaaaaaaaaaaaaaa';
      const intermediatePeer = 'bbbbbbbbbbbbbbbb';
      const relayPeer = 'cccccccccccccccc';
      const receiverDirect: Array<{
        peer: string;
        wire: Record<string, unknown>;
      }> = [];
      const intermediateDirect: Array<{
        peer: string;
        wire: Record<string, unknown>;
      }> = [];
      const intermediateFanout: Array<{
        messages: Record<string, unknown>[];
        excludes: string[];
      }> = [];
      const relayDirect: Array<{
        peer: string;
        wire: Record<string, unknown>;
      }> = [];
      const relayResources: Array<Record<string, any>> = [];
      const receiver = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getLocalDestinationHash: () => receiverPeer,
          fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
          sendReticulumChatDetailed: async (
            peer: string,
            wire: Record<string, unknown>
          ) => {
            receiverDirect.push({ peer, wire });
            return { ok: true as const };
          },
          acceptReticulumChatResourceDetailed: async () => ({
            ok: true as const,
          }),
        } as any,
        now: () => 100_000,
      });
      const intermediate = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getLocalDestinationHash: () => intermediatePeer,
          fanoutReticulumChatDetailed: async (
            messages: Record<string, unknown>[],
            excludes: string[] = []
          ) => {
            intermediateFanout.push({ messages, excludes });
            return { ok: true as const };
          },
          sendReticulumChatDetailed: async (
            peer: string,
            wire: Record<string, unknown>
          ) => {
            intermediateDirect.push({ peer, wire });
            return { ok: true as const };
          },
        } as any,
        now: () => 100_000,
      });
      const relay = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getLocalDestinationHash: () => relayPeer,
          fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
          sendReticulumChatDetailed: async (
            peer: string,
            wire: Record<string, unknown>
          ) => {
            relayDirect.push({ peer, wire });
            return { ok: true as const };
          },
          sendReticulumChatResourceDetailed: async (
            payload: Record<string, any>
          ) => {
            relayResources.push(payload);
            return { ok: true as const };
          },
        } as any,
        now: () => 100_000,
      });
      receiver.setLocalGroupMemberships([707]);
      receiver.subscribeGroup(707);
      receiverDirect.length = 0;
      const event = signedEvent({
        eventId: 'relay-multihop-catchup-event',
        groupId: 707,
        timestamp: 100_000,
      });
      (relay as any).db.storeRelayEventBlob(
        event,
        serializeReticulumChatEvent(event),
        'dddddddddddddddd',
        100_000
      );

      intermediate.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [707], mode: 'summary' },
        receiverPeer
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      const forwardedSub = intermediateFanout
        .flatMap((item) => item.messages)
        .find((wire) => wire.k === 'group_sub');
      expect(forwardedSub).toMatchObject({
        k: 'group_sub',
      });
      expect(typeof forwardedSub?.o).toBe('string');

      relay.handleWire(forwardedSub!, intermediatePeer);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const relayDigest = relayDirect.find(
        (item) => item.wire.k === 'relay_digest'
      );
      expect(relayDigest).toMatchObject({
        peer: intermediatePeer,
        wire: expect.objectContaining({ k: 'relay_digest', g: 707 }),
      });

      intermediate.handleWire(relayDigest!.wire, relayPeer);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const forwardedDigest = intermediateDirect.find(
        (item) => item.wire.k === 'relay_digest'
      );
      expect(forwardedDigest).toMatchObject({
        peer: receiverPeer,
        wire: expect.objectContaining({ k: 'relay_digest', g: 707 }),
      });

      receiver.handleWire(forwardedDigest!.wire, intermediatePeer);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const relayQuery = receiverDirect.find(
        (item) => item.wire.k === 'relay_query'
      );
      expect(relayQuery).toMatchObject({
        peer: intermediatePeer,
        wire: expect.objectContaining({ k: 'relay_query', g: 707 }),
      });

      intermediateFanout.length = 0;
      intermediate.handleWire(relayQuery!.wire, receiverPeer);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const forwardedQuery = intermediateFanout
        .flatMap((item) => item.messages)
        .find((wire) => wire.k === 'relay_query');
      expect(forwardedQuery).toMatchObject({
        k: 'relay_query',
        g: 707,
      });
      expect(typeof forwardedQuery?.o).toBe('string');

      relay.handleWire(forwardedQuery!, intermediatePeer);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const relayOffer = relayDirect.find(
        (item) => item.wire.k === 'event_offer'
      );
      expect(relayOffer).toMatchObject({
        peer: intermediatePeer,
        wire: expect.objectContaining({ k: 'event_offer', g: 707 }),
      });
      expect(relayResources[0]).toMatchObject({
        allowedRecipientAddress: receiverPeer,
      });

      intermediate.handleWire(relayOffer!.wire, relayPeer);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const forwardedOffer = intermediateDirect.find(
        (item) => item.wire.k === 'event_offer'
      );
      expect(forwardedOffer).toMatchObject({
        peer: receiverPeer,
        wire: expect.objectContaining({ k: 'event_offer', g: 707 }),
      });

      receiver.handleWire(forwardedOffer!.wire, intermediatePeer);
      receiver.handleResourceEvent({
        status: 'received',
        transferId: relayResources[0].transferId,
        peerPresenceHash: relayPeer,
        path: relayResources[0].filePath,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(
        receiver.getHistory(707, 10).map((item) => item.eventId)
      ).toContain(event.eventId);
      receiver.close();
      intermediate.close();
      relay.close();
    }
  );

  relayCacheIt(
    'prefers established overlay peers for relay-store uploads and randomizes selection',
    async () => {
      const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
      const resources: unknown[] = [];
      const bridge = {
        on: () => undefined,
        off: () => undefined,
        getOverlayLinkSnapshots: () => [
          {
            linkId: 'link-alpha',
            peerPresenceHash: 'alpha-peer',
            incoming: false,
            connectedAt: 1,
            lastRxAt: 100_000,
            lastActivityAt: 100_000,
          },
          {
            linkId: 'link-gamma',
            peerPresenceHash: 'gamma-peer',
            incoming: false,
            connectedAt: 2,
            lastRxAt: 100_000,
            lastActivityAt: 100_000,
          },
        ],
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        sendReticulumChatResourceDetailed: async (payload: unknown) => {
          resources.push(payload);
          return { ok: true as const };
        },
      };
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: bridge as any,
        now: () => 100_000,
      });
      (manager as any).shuffleRelayPeers = (peers: string[]) =>
        [...peers].reverse();
      manager.setLocalGroupMemberships([702]);
      for (const peer of [
        'alpha-peer',
        'beta-peer',
        'gamma-peer',
        'delta-peer',
      ]) {
        manager.handleWire(
          { t: 'RCHAT', k: 'group_sub', groups: [999], mode: 'summary' },
          peer
        );
      }
      const event = signedEvent({
        eventId: 'relay-established-randomized-event',
        groupId: 702,
        timestamp: 100_000,
      });

      await expect(manager.publishEvent(event)).resolves.toMatchObject({
        ok: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(resources).toHaveLength(3);
      expect(direct.map((item) => item.peer)).toEqual([
        'gamma-peer',
        'alpha-peer',
        'delta-peer',
      ]);
      manager.close();
    }
  );

  it('keeps mentioned message digest fanout under the Reticulum wire limit', async () => {
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
    });
    const mentionHash = hashReticulumChatMentionAddress('QmentionedAddress');
    const channelId = 'ch-00000000-0000-4000-8000-000000000000';
    const event = signedEvent({
      groupId: 91,
      channelId,
      mentionAddressHashes: [mentionHash],
    });
    manager.setLocalGroupMemberships([91]);
    (manager as any).db.upsertChannel({
      groupId: 91,
      channelId,
      name: 'mentions',
      position: 1,
      archived: false,
      createdBy: event.authorAddress,
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
    });
    expect((manager as any).db.getChannel(91, channelId)?.channelId).toBe(
      channelId
    );

    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: true,
    });

    expect(manager.getHistory(91, event.channelId, 10)[0]).toMatchObject({
      eventId: event.eventId,
      mentionAddressHashes: [mentionHash],
    });
    const stateDigest = sent.find((wire) => wire.k === 'group_state_digest_v3');
    expect(stateDigest).toMatchObject({
      t: 'RCHAT',
      v: 3,
      k: 'group_state_digest_v3',
      g: 91,
      d: expect.objectContaining({
        latest: expect.objectContaining({
          id: event.eventId,
        }),
      }),
    });
    expect(JSON.stringify(stateDigest)).not.toContain(mentionHash);
    expect(
      byteLengthUtf8JsonWithBridgeSender(stateDigest!)
    ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    manager.close();
  });

  it('treats local persistence as send success when live fanout has no route', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({
          ok: false as const,
          reason: 'no-route' as const,
          error: 'No overlay route',
        }),
      } as any,
    });
    const event = signedEvent({ groupId: 52 });
    manager.setLocalGroupMemberships([52]);

    const result = await manager.publishEvent(event);

    expect(result).toEqual({ ok: true });
    expect(manager.getHistory(52, 10).map((item) => item.eventId)).toContain(
      event.eventId
    );
    manager.close();
  });

  it('refuses privileged mentions from non-admin senders', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupAdmin: async () => false,
    });
    const event = signedEvent({
      groupId: 252,
      mentionTargets: [{ type: 'everyone', groupId: 252 }],
    });
    manager.setLocalGroupMemberships([252]);

    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: false,
      error: 'Only group admins can use @here or @everyone',
    });
    expect(manager.getHistory(252, 10)).toHaveLength(0);
    manager.close();
  });

  it('keeps an already validated local privileged mention authorized', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupAdmin: async () => true,
    });
    const event = signedEvent({
      groupId: 252,
      mentionTargets: [{ type: 'everyone', groupId: 252 }],
    });
    manager.setLocalGroupMemberships([252]);

    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: true,
    });
    expect((manager as any).db.getPrivilegedMentionStatus(event.eventId)).toBe(
      1
    );
    expect((manager as any).eventForRenderer(event)).toMatchObject({
      privilegedMentionAuthorized: true,
    });
    manager.close();
  });

  it('refuses privileged markup when a modified sender omits mention targets', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupAdmin: async () => false,
    });
    const event = signedEvent({
      groupId: 255,
      encryptedPayload: JSON.stringify({
        messageText:
          '<p><span class="mention" data-type="mention" data-id="ordinary-user">@here</span></p>',
      }),
      mentionTargets: [],
    });
    manager.setLocalGroupMemberships([255]);

    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: false,
      error: 'Only group admins can use @here or @everyone',
    });
    expect(manager.getHistory(255, 10)).toHaveLength(0);
    manager.close();
  });

  it('exposes privileged mention authorization to the renderer only from local state', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const event = signedEvent({
      groupId: 253,
      mentionTargets: [{ type: 'everyone', groupId: 253 }],
    });
    manager.setLocalGroupMemberships([253]);
    expect((manager as any).db.insertEvent(event, false, 0)).toBe(true);

    expect(
      (manager as any).eventForRenderer({
        ...event,
        privilegedMentionAuthorized: true,
      }).privilegedMentionAuthorized
    ).toBeUndefined();

    expect(
      (manager as any).db.updatePrivilegedMentionStatus(event.eventId, 1)
    ).toBe(true);
    expect(
      (manager as any).eventForRenderer(event).privilegedMentionAuthorized
    ).toBe(true);
    manager.close();
  });

  it('exposes resolved message expiry to the renderer without changing stored wire events', async () => {
    const dbPath = tempDbPath();
    let manager = new ReticulumChatManager({ dbPath });
    const groupId = 257;
    const timestamp = Date.now();
    const channelExpiryDurationMs = 60 * 60 * 1_000;
    const messageExpiryDurationMs = 10 * 60 * 1_000;
    manager.setLocalGroupMemberships([groupId]);
    (manager as any).db.upsertChannel({
      groupId,
      channelId: 'expiring',
      name: 'expiring',
      position: 2,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      expiryDurationMs: channelExpiryDurationMs,
      createdBy: 'Qadmin',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    (manager as any).db.upsertChannel({
      groupId,
      channelId: 'durable',
      name: 'durable',
      position: 3,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      createdBy: 'Qadmin',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const channelExpiryEvent = signedEvent({
      eventId: 'renderer-channel-expiry',
      groupId,
      channelId: 'expiring',
      authorSeq: 1,
      timestamp,
      encryptedPayload: JSON.stringify({ messageText: 'channel default' }),
    });
    const messageExpiryEvent = signedEvent({
      eventId: 'renderer-message-expiry',
      groupId,
      channelId: 'expiring',
      authorSeq: 2,
      timestamp: timestamp + 1,
      encryptedPayload: JSON.stringify({
        messageText: 'message override',
        expiryDurationMs: messageExpiryDurationMs,
      }),
    });
    const durableEvent = signedEvent({
      eventId: 'renderer-no-expiry',
      groupId,
      channelId: 'durable',
      authorSeq: 3,
      timestamp: timestamp + 2,
      encryptedPayload: JSON.stringify({ messageText: 'no expiry' }),
    });
    expect((manager as any).db.insertEvent(channelExpiryEvent, false)).toBe(
      true
    );
    expect((manager as any).db.insertEvent(messageExpiryEvent, false)).toBe(
      true
    );
    expect((manager as any).db.insertEvent(durableEvent, false)).toBe(true);

    expect(manager.getMessageHistory(groupId, 'expiring', 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: channelExpiryEvent.eventId,
          expiresAt: timestamp + channelExpiryDurationMs,
        }),
        expect.objectContaining({
          eventId: messageExpiryEvent.eventId,
          expiresAt: timestamp + 1 + messageExpiryDurationMs,
        }),
      ])
    );
    expect(manager.getMessageHistory(groupId, 'durable', 10)).toEqual([
      expect.objectContaining({
        eventId: durableEvent.eventId,
        expiresAt: null,
      }),
    ]);
    expect(
      manager.indexSearchText(
        channelExpiryEvent.eventId,
        'renderer channel expiry'
      )
    ).toBe(true);
    await expect(
      manager.searchEvents('renderer channel expiry', { groupIds: [groupId] })
    ).resolves.toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          eventId: channelExpiryEvent.eventId,
          expiresAt: timestamp + channelExpiryDurationMs,
        }),
      }),
    ]);
    expect(
      JSON.stringify(
        (manager as any).db.getRecentMessageEvents(groupId, 10, 'expiring')
      )
    ).not.toContain('expiresAt');
    manager.close();

    manager = new ReticulumChatManager({ dbPath });
    manager.setLocalGroupMemberships([groupId]);
    const fallbackExpiryLookup = vi.spyOn(
      (manager as any).db,
      'getEventExpiresAt'
    );
    expect(manager.getMessageHistory(groupId, 'expiring', 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: channelExpiryEvent.eventId,
          expiresAt: timestamp + channelExpiryDurationMs,
        }),
        expect.objectContaining({
          eventId: messageExpiryEvent.eventId,
          expiresAt: timestamp + 1 + messageExpiryDurationMs,
        }),
      ])
    );
    expect(fallbackExpiryLookup).not.toHaveBeenCalled();
    manager.close();
  });

  it('uses the current edit authorization when rendering projected history', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const [root, edit] = signedAuthorEvents([
      {
        eventId: 'event-projected-mention-root',
        groupId: 256,
        authorSeq: 1,
        timestamp: 1_784_961_005_000,
      },
      {
        eventId: 'event-projected-mention-edit',
        groupId: 256,
        authorSeq: 2,
        timestamp: 1_784_961_005_001,
        eventType: 'edit',
        targetEventId: 'event-projected-mention-root',
        mentionTargets: [{ type: 'everyone', groupId: 256 }],
      },
    ]);
    manager.setLocalGroupMemberships([256]);
    expect((manager as any).db.insertEvent(root, false, 0)).toBe(true);
    expect((manager as any).db.insertEvent(edit, false, 1)).toBe(true);
    expect((manager as any).db.getCurrentProjectedEventId(root.eventId)).toBe(
      edit.eventId
    );
    expect((manager as any).db.getPrivilegedMentionStatus(edit.eventId)).toBe(
      1
    );

    expect(manager.getMessageHistory(256, 'general', 10)).toContainEqual(
      expect.objectContaining({
        eventId: root.eventId,
        privilegedMentionAuthorized: true,
      })
    );
    manager.close();
  });

  it('stores privileged messages before admin validation and updates renderer state after validation', async () => {
    let resolveValidation: ((value: boolean) => void) | undefined;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupAdmin: () =>
        new Promise<boolean>((resolve) => {
          resolveValidation = resolve;
        }),
    });
    const event = signedEvent({
      eventId: 'event-pending-everyone-validation',
      groupId: 254,
      mentionTargets: [{ type: 'everyone', groupId: 254 }],
    });
    manager.setLocalGroupMemberships([254]);

    expect((manager as any).acceptEvent(event, false)).toBe(true);
    expect(manager.getHistory(254, 10)).toContainEqual(
      expect.objectContaining({
        eventId: event.eventId,
        privilegedMentionAuthorized: undefined,
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolveValidation).toBeTypeOf('function');
    resolveValidation?.(true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(manager.getHistory(254, 10)).toContainEqual(
      expect.objectContaining({
        eventId: event.eventId,
        privilegedMentionAuthorized: true,
      })
    );
    manager.close();
  });

  it('loads older history pages by cursor and asks subscribed peers for more history', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createReticulumChatTestSigner(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
    });
    manager.setLocalGroupMemberships([53]);
    manager.subscribeGroup(53);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [53], mode: 'summary' },
      'peer-history'
    );
    await flushQueuedWork();
    direct.length = 0;
    const baseTimestamp = Date.now();
    (manager as any).db.upsertChannel({
      groupId: 53,
      channelId: 'general',
      name: 'general',
      position: 0,
      archived: false,
      createdBy: 'tester',
      createdAt: baseTimestamp,
      updatedAt: baseTimestamp,
    });
    const older = signedEvent({
      eventId: 'history-cursor-older',
      groupId: 53,
      channelId: 'general',
      timestamp: baseTimestamp,
      authorSeq: 1,
      encryptedPayload: 'older local page',
    });
    const newer = signedEvent({
      eventId: 'history-cursor-newer',
      groupId: 53,
      channelId: 'general',
      timestamp: baseTimestamp + 1_000,
      authorSeq: 2,
      encryptedPayload: 'newer cursor page',
    });
    expect((manager as any).db.insertEvent(older, true)).toBe(true);
    expect((manager as any).db.insertEvent(newer, true)).toBe(true);

    const page = manager.getHistory(53, 'general', 25, {
      beforeTimestamp: newer.timestamp,
      beforeEventId: newer.eventId,
    });
    await flushQueuedWork();

    expect(page.map((event) => event.eventId)).toEqual([older.eventId]);
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-history',
        wire: expect.objectContaining({
          k: 'feed_req',
          g: 53,
          c: 'general',
          before: expect.objectContaining({
            id: newer.eventId,
            ts: newer.timestamp,
          }),
        }),
      })
    );
    expect(direct.some((item) => item.wire.k === 'state_heads_req_v3')).toBe(
      true
    );
    manager.close();
  });

  it('requests network history and state heads when search has no local hits', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createReticulumChatTestSigner(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
    });
    manager.setLocalGroupMemberships([54]);
    manager.subscribeGroup(54);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [54], mode: 'summary' },
      'peer-search'
    );
    await flushQueuedWork();
    direct.length = 0;

    await expect(
      manager.searchEvents('missing search phrase', {
        groupIds: [54],
        channelIds: ['general'],
        limit: 20,
      })
    ).resolves.toEqual([]);

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-search',
        wire: expect.objectContaining({
          k: 'feed_req',
          g: 54,
          c: 'general',
        }),
      })
    );
    expect(
      direct
        .filter((item) => item.wire.k === 'state_heads_req_v3')
        .map((item) => (item.wire.q as any)?.type)
    ).toEqual(['channels']);
    manager.close();
  });

  it('returns a network-repaired message from the active search request', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
    });
    manager.setLocalGroupMemberships([154]);
    manager.subscribeGroup(154);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [154], mode: 'summary' },
      'peer-search-repair'
    );
    await flushQueuedWork();
    const repaired = signedEvent({
      eventId: 'network-search-repaired-event',
      groupId: 154,
      channelId: 'general',
      encryptedPayload: JSON.stringify({
        messageText: 'needle from network repair',
      }),
    });
    const insertTimer = setTimeout(() => {
      (manager as any).db.insertEvent(repaired, false);
    }, 50);

    const results = await manager.searchEvents('needle from network repair', {
      groupIds: [154],
      channelIds: ['general'],
      limit: 20,
    });

    clearTimeout(insertTimer);
    expect(results.map((result) => result.event.eventId)).toContain(
      repaired.eventId
    );
    manager.close();
  });

  it('records peer group subscriptions from group_sub and serves a digest', async () => {
    let now = 100_000;
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    await flushQueuedWork();
    direct.length = 0;
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [69], mode: 'summary' },
      'peer-a'
    );
    await flushQueuedWork();

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          t: 'RCHAT',
          v: 3,
          k: 'group_state_digest_v3',
          g: 69,
        }),
      })
    );

    direct.length = 0;
    now += 15 * 60_000 + 1;
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [69], mode: 'summary' },
      'peer-a'
    );
    await flushQueuedWork();
    expect(
      direct.find(
        (item) =>
          item.peer === 'peer-a' && item.wire.k === 'group_state_digest_v3'
      )
    ).toBeDefined();
    manager.close();
  });

  it('uses digest-only sync for new and renewed summary group_sub messages', async () => {
    let now = 100_000;
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    await flushQueuedWork();
    direct.length = 0;
    const metadataPush = vi
      .spyOn(manager as any, 'sendMetadataSnapshotToPeer')
      .mockResolvedValue(undefined);
    const newestPush = vi
      .spyOn(manager as any, 'pushNewestHistoryPageToPeer')
      .mockResolvedValue(undefined);
    const summary = {
      t: 'RCHAT',
      k: 'group_sub',
      groups: [69],
      mode: 'summary',
    };

    manager.handleWire(summary, 'peer-a');
    await flushQueuedWork();

    expect(metadataPush).not.toHaveBeenCalled();
    expect(newestPush).not.toHaveBeenCalled();
    expect(
      direct.filter((item) => item.wire.k === 'group_state_digest_v3')
    ).toHaveLength(1);

    now += 60_000;
    manager.handleWire(summary, 'peer-a');
    await flushQueuedWork();

    expect(metadataPush).not.toHaveBeenCalled();
    expect(newestPush).not.toHaveBeenCalled();
    expect(
      direct.filter((item) => item.wire.k === 'group_state_digest_v3')
    ).toHaveLength(1);

    now += 15 * 60_000 + 1;
    manager.handleWire(summary, 'peer-a');
    await flushQueuedWork();

    expect(metadataPush).not.toHaveBeenCalled();
    expect(newestPush).not.toHaveBeenCalled();
    expect(
      direct.filter((item) => item.wire.k === 'group_state_digest_v3')
    ).toHaveLength(2);
    manager.close();
  });

  it('cold-starts missing background history from the peer state digest', async () => {
    const direct: Record<string, unknown>[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          _peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push(wire);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    await flushQueuedWork();
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        v: 3,
        k: 'group_state_digest_v3',
        g: 69,
        d: {
          latest: { id: 'remote-background-latest', ts: 99_000 },
          eventHash: 'a'.repeat(64),
        },
      },
      'b'.repeat(32)
    );

    await vi.waitUntil(() => direct.some((wire) => wire.k === 'event_req'), {
      timeout: 1_000,
    });
    expect(direct).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'event_req',
        g: 69,
        q: expect.objectContaining({ id: 'remote-background-latest' }),
      })
    );
    manager.close();
  });

  it('uses routed group_sub messages only to maintain forwarding routes when relay features are disabled', async () => {
    let now = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    await flushQueuedWork();
    const enqueueSync = vi.spyOn(manager as any, 'enqueueGroupSubSync');
    const authorGapRepair = vi.spyOn(manager as any, 'requestKnownAuthorGaps');
    const enqueueDigest = vi.spyOn(manager as any, 'enqueueDigestSend');
    const metadataPush = vi.spyOn(manager as any, 'sendMetadataSnapshotToPeer');
    const newestPush = vi.spyOn(manager as any, 'pushNewestHistoryPageToPeer');
    const relayDigest = vi
      .spyOn(manager as any, 'serveRelayDigestForGroup')
      .mockResolvedValue(undefined);
    const groupKeyDigest = vi
      .spyOn(manager as any, 'serveGroupKeyDigestForGroup')
      .mockResolvedValue(undefined);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_sub',
        groups: [69],
        mode: 'active',
        o: 'origin-peer',
        h: 1,
      },
      'relay-peer'
    );
    await flushQueuedWork();

    expect(enqueueSync).not.toHaveBeenCalled();
    expect(authorGapRepair).not.toHaveBeenCalled();
    expect(enqueueDigest).not.toHaveBeenCalled();
    expect(metadataPush).not.toHaveBeenCalled();
    expect(newestPush).not.toHaveBeenCalled();
    expect(relayDigest).not.toHaveBeenCalled();
    expect(groupKeyDigest).not.toHaveBeenCalled();
    expect((manager as any).groupInterestRoutes.get('69:origin-peer')).toEqual(
      expect.objectContaining({
        reversePeerHash: 'relay-peer',
        hops: 1,
      })
    );

    now += 60_001;
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_sub',
        groups: [69],
        mode: 'active',
        o: 'origin-peer',
        h: 1,
      },
      'relay-peer'
    );
    await flushQueuedWork();

    expect(enqueueSync).not.toHaveBeenCalled();
    expect(relayDigest).not.toHaveBeenCalled();
    expect(groupKeyDigest).not.toHaveBeenCalled();
    manager.close();
  });

  it('keeps relay-only group_sub work out of full state repair', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    const authorGapRepair = vi.spyOn(manager as any, 'requestKnownAuthorGaps');
    const enqueueDigest = vi.spyOn(manager as any, 'enqueueDigestSend');
    const metadataPush = vi.spyOn(manager as any, 'sendMetadataSnapshotToPeer');
    const newestPush = vi.spyOn(manager as any, 'pushNewestHistoryPageToPeer');
    const relayDigest = vi
      .spyOn(manager as any, 'serveRelayDigestForGroup')
      .mockResolvedValue(undefined);
    const groupKeyDigest = vi
      .spyOn(manager as any, 'serveGroupKeyDigestForGroup')
      .mockResolvedValue(undefined);

    (manager as any).processGroupSubSyncQueueItem({
      key: 'relay-peer:69',
      peerHash: 'relay-peer',
      originPeerHash: 'origin-peer',
      inboundPeerHash: 'relay-peer',
      groupId: 69,
      hops: 1,
      stateSyncRequested: false,
      bootstrapRequested: false,
      enqueuedAt: 100_000,
      coalescedCount: 0,
    });

    expect(authorGapRepair).not.toHaveBeenCalled();
    expect(enqueueDigest).not.toHaveBeenCalled();
    expect(metadataPush).not.toHaveBeenCalled();
    expect(newestPush).not.toHaveBeenCalled();
    expect(relayDigest).toHaveBeenCalledWith('relay-peer', 69);
    expect(groupKeyDigest).toHaveBeenCalledWith('relay-peer', 69);
    manager.close();
  });

  it('keeps a direct summary group_sub digest-only after learning it through a relay', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    await flushQueuedWork();
    const metadataPush = vi
      .spyOn(manager as any, 'sendMetadataSnapshotToPeer')
      .mockResolvedValue(undefined);
    const newestPush = vi
      .spyOn(manager as any, 'pushNewestHistoryPageToPeer')
      .mockResolvedValue(undefined);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_sub',
        groups: [69],
        mode: 'summary',
        o: 'origin-peer',
        h: 1,
      },
      'relay-peer'
    );
    await flushQueuedWork();
    expect(metadataPush).not.toHaveBeenCalled();
    expect(newestPush).not.toHaveBeenCalled();

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [69], mode: 'summary' },
      'origin-peer'
    );
    await flushQueuedWork();

    expect(metadataPush).not.toHaveBeenCalled();
    expect(newestPush).not.toHaveBeenCalled();
    manager.close();
  });

  it('keeps active group_sub entry eligible for fast history bootstrap', async () => {
    let now = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    await flushQueuedWork();
    const metadataPush = vi
      .spyOn(manager as any, 'sendMetadataSnapshotToPeer')
      .mockResolvedValue(undefined);
    const newestPush = vi
      .spyOn(manager as any, 'pushNewestHistoryPageToPeer')
      .mockResolvedValue(undefined);

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [69], mode: 'summary' },
      'peer-a'
    );
    await flushQueuedWork();
    now += 31_000;
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [69], mode: 'active' },
      'peer-a'
    );
    await flushQueuedWork();

    expect(metadataPush).toHaveBeenCalledTimes(1);
    expect(newestPush).toHaveBeenCalledTimes(1);
    manager.close();
  });

  it('does not bulk-bootstrap a multi-group active subscription', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([69, 70]);
    manager.subscribeGroup(69);
    manager.subscribeGroup(70);
    await flushQueuedWork();
    const metadataPush = vi
      .spyOn(manager as any, 'sendMetadataSnapshotToPeer')
      .mockResolvedValue(undefined);
    const newestPush = vi
      .spyOn(manager as any, 'pushNewestHistoryPageToPeer')
      .mockResolvedValue(undefined);

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [69, 70], mode: 'active' },
      'peer-a'
    );
    await flushQueuedWork();

    expect(metadataPush).not.toHaveBeenCalled();
    expect(newestPush).not.toHaveBeenCalled();
    manager.close();
  });

  it('keeps coalesced direct and relayed summary subscriptions digest-only', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    await flushQueuedWork();
    const metadataPush = vi
      .spyOn(manager as any, 'sendMetadataSnapshotToPeer')
      .mockResolvedValue(undefined);
    const newestPush = vi
      .spyOn(manager as any, 'pushNewestHistoryPageToPeer')
      .mockResolvedValue(undefined);

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [69], mode: 'summary' },
      'peer-a'
    );
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_sub',
        groups: [69],
        mode: 'summary',
        o: 'peer-b',
        h: 1,
      },
      'peer-a'
    );
    await flushQueuedWork();

    expect(metadataPush).not.toHaveBeenCalled();
    expect(newestPush).not.toHaveBeenCalled();
    manager.close();
  });

  it('does not finish a metadata bootstrap after the peer unsubscribes', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    await flushQueuedWork();
    direct.length = 0;
    (manager as any).notePeerSubscription('peer-a', 69, true);
    let resolveSnapshot!: (value: Record<string, unknown>) => void;
    const snapshotReady = new Promise<Record<string, unknown>>((resolve) => {
      resolveSnapshot = resolve;
    });
    vi.spyOn(
      manager as any,
      'getPublicMetadataSnapshotForSend'
    ).mockReturnValue(snapshotReady);

    const pending = (manager as any).sendMetadataSnapshotToPeer(
      'peer-a',
      69,
      'test-unsubscribe-race'
    );
    await Promise.resolve();
    (manager as any).notePeerSubscription('peer-a', 69, false);
    resolveSnapshot({
      snapshot: {
        groupId: 69,
        snapshotHash: 'a'.repeat(64),
      },
    });
    await pending;

    expect(direct).toEqual([]);
    expect((manager as any).metadataSnapshotPushHashes.size).toBe(0);
    expect((manager as any).metadataSnapshotPushInflight.size).toBe(0);
    manager.close();
  });

  it('does not queue a group-state digest from cached history without current membership', async () => {
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    const cachedEvent = signedEvent({
      eventId: 'cached-history-without-membership',
      groupId: 69,
      timestamp: 99_000,
    });
    expect((manager as any).db.insertEvent(cachedEvent, false)).toBe(true);
    const buildDigest = vi.spyOn(manager as any, 'buildGroupStateDigestWire');

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [69], mode: 'summary' },
      'peer-a'
    );
    await flushQueuedWork();

    expect(buildDigest).not.toHaveBeenCalled();
    manager.close();
  });

  it('pushes newest history page resource immediately for active group_sub peers', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const resources: Array<{
      filePath: string;
      metadata?: Record<string, unknown>;
    }> = [];
    const publicKey = Buffer.alloc(64, 6).toString('base64');
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      getLocalIdentityPublicKeyBase64: async () => publicKey,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (payload: {
        filePath: string;
        metadata?: Record<string, unknown>;
      }) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    await flushQueuedWork();
    const events = signedAuthorEvents(
      Array.from({ length: 105 }, (_, index) => ({
        eventId: `sub-history-${String(index + 1).padStart(3, '0')}`,
        groupId: 69,
        authorSeq: index + 1,
        timestamp: 80_000 + index,
      }))
    );
    for (const event of events) {
      expect((manager as any).db.insertEvent(event, true)).toBe(true);
    }
    (manager as any).invalidateGroupDigestSnapshot(69);
    direct.length = 0;

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [69], mode: 'active' },
      'peer-a'
    );
    await flushQueuedWork();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushQueuedWork();

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          v: 3,
          k: 'group_state_digest_v3',
          g: 69,
        }),
      })
    );
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          k: 'event_page_offer',
          g: 69,
          p: expect.objectContaining({
            n: 100,
            sd: expect.any(String),
          }),
        }),
      })
    );
    const pagePayload = resources.find(
      (payload) =>
        payload.metadata?.resourceType === 'reticulum_chat_event_page'
    );
    expect(pagePayload).toBeTruthy();
    const page = JSON.parse(fs.readFileSync(pagePayload!.filePath, 'utf8')) as {
      d: string;
      more?: boolean;
      events: ReticulumChatEvent[];
    };
    expect(page.d).toBe('before');
    expect(page.more).toBe(true);
    expect(page.events.map((event) => event.eventId)).toHaveLength(100);
    expect(page.events[0].eventId).toBe('sub-history-006');
    expect(page.events[99].eventId).toBe('sub-history-105');
    const pageOffer = direct.find((item) => item.wire.k === 'event_page_offer')
      ?.wire as any;
    expect(wireFitsReticulum(pageOffer)).toBe(true);
    expect(pageOffer?.p?.sd).toEqual(expect.any(String));
    expect(pageOffer?.p?.rk).toBeUndefined();
    expect(pageOffer?.p?.sid).toBeUndefined();
    expect(pageOffer?.p?.eid).toBeUndefined();
    expect(pageOffer?.p?.sp).toBeUndefined();
    manager.close();
  });

  it('does not advertise cached history after local group membership is removed', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const resources: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([999]);
    const event = signedEvent({
      eventId: 'cached-provider-digest-event',
      groupId: 69,
      timestamp: 80_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [69], mode: 'summary' },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      direct.some(
        (item) =>
          item.wire.k === 'group_state_digest_v3' ||
          item.wire.k === 'group_digest'
      )
    ).toBe(false);
    expect(direct.some((item) => item.wire.k === 'event_page_offer')).toBe(
      false
    );
    expect(resources).toEqual([]);
    manager.close();
  });

  it.skip('requests the exact latest event when a group digest shows missing recent history', async () => {
    const providerHash = 'c'.repeat(32);
    const accepts: Array<Record<string, unknown>> = [];
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      ensurePeerIdentityKnown: async () => true,
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepts.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 69,
        latest: { id: 'remote-latest-event', ts: 99_000 },
        digestHash: 'f'.repeat(64),
        sd: providerHash,
      },
      'overlay-hop'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(accepts).toHaveLength(0);
    expect(direct.find((item) => item.wire.k === 'event_req')).toMatchObject({
      peer: providerHash,
      wire: expect.objectContaining({
        t: 'RCHAT',
        k: 'event_req',
        g: 69,
        q: expect.objectContaining({ id: 'remote-latest-event' }),
      }),
    });
    expect(direct.some((item) => item.wire.k === 'feed_req')).toBe(false);
    manager.close();
  });

  it('dedupes concurrent linked history page requests for the same cursor', async () => {
    const providerHash = 'c'.repeat(32);
    const accepts: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      ensurePeerIdentityKnown: async () => true,
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepts.push(payload);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);

    await Promise.all([
      (manager as any).requestLinkedHistoryPage(
        providerHash,
        69,
        '*',
        { eventId: 'same-cursor-event', feedTimestamp: 99_000 },
        'before',
        false,
        'test-dedupe'
      ),
      (manager as any).requestLinkedHistoryPage(
        providerHash,
        69,
        '*',
        { eventId: 'same-cursor-event', feedTimestamp: 99_000 },
        'before',
        false,
        'test-dedupe'
      ),
    ]);

    expect(accepts).toHaveLength(1);
    expect(accepts[0]).toEqual(
      expect.objectContaining({
        peerPresenceHash: providerHash,
        metadata: expect.objectContaining({
          logicalResourceType: 'reticulum_chat_history_page',
          groupId: 69,
          channelId: '*',
          direction: 'before',
        }),
        authMessage: expect.objectContaining({
          type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
          groupId: 69,
          c: '*',
          d: 'before',
          before: { id: 'same-cursor-event', ts: 99_000 },
        }),
      })
    );
    manager.close();
  });

  it('opens the reusable history session before signing and dispatching auth', async () => {
    const providerHash = 'c'.repeat(32);
    const order: string[] = [];
    const sessionPayloads: Array<Record<string, unknown>> = [];
    const baseSigner = createReticulumChatTestSigner();
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      ensurePeerIdentityKnown: async () => true,
      ensureReticulumResourceSessionDetailed: async (
        payload: Record<string, unknown>
      ) => {
        order.push('session');
        sessionPayloads.push(payload);
        return { ok: true as const };
      },
      acceptReticulumChatResourceDetailed: async () => {
        order.push('accept');
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: async (fields) => {
        if ((fields as { type?: string }).type === 'RCHAT_HISTORY_PAGE_REQ') {
          order.push('sign');
        }
        return baseSigner(fields);
      },
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);

    await (manager as any).requestLinkedHistoryPage(
      providerHash,
      69,
      '*',
      { eventId: 'jit-auth-cursor', feedTimestamp: 99_000 },
      'before',
      false,
      'test-jit-auth'
    );

    expect(order).toEqual(['session', 'sign', 'accept']);
    expect(sessionPayloads).toEqual([
      expect.objectContaining({
        peerPresenceHash: providerHash,
        resourceType: 'reticulum_chat_event',
        logicalResourceType: 'reticulum_chat_history_page',
      }),
    ]);
    manager.close();
  });

  it('backs off a failed linked history request instead of allocating new transfers', async () => {
    const providerHash = 'c'.repeat(32);
    const accepts: Array<Record<string, unknown>> = [];
    const direct: Array<Record<string, unknown>> = [];
    let now = 100_000;
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      ensurePeerIdentityKnown: async () => true,
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepts.push(payload);
        return {
          ok: false as const,
          reason: 'bridge-overloaded' as const,
          error: 'resource open queue full',
        };
      },
      sendReticulumChatDetailed: async (
        _peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push(wire);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);
    const cursor = { eventId: 'failed-cursor-event', feedTimestamp: 99_000 };

    await (manager as any).requestLinkedHistoryPage(
      providerHash,
      69,
      '*',
      cursor,
      'before',
      false,
      'test-backoff'
    );
    await (manager as any).requestLinkedHistoryPage(
      providerHash,
      69,
      '*',
      cursor,
      'before',
      false,
      'test-backoff'
    );

    expect(accepts).toHaveLength(1);
    expect(direct).toHaveLength(0);

    now += 5_001;
    await (manager as any).requestLinkedHistoryPage(
      providerHash,
      69,
      '*',
      cursor,
      'before',
      false,
      'test-backoff-expired'
    );
    expect(accepts).toHaveLength(2);
    manager.close();
  });

  it('cooldowns latest-event page fallback across repeated digests', async () => {
    vi.useFakeTimers();
    const providerHash = 'c'.repeat(32);
    const eventId = 'latest-fallback-event';
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: { on: () => undefined, off: () => undefined } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    try {
      (manager as any).pendingEventPulls.set(`69:${eventId}`, {
        hint: { eventId, groupId: 69 },
        peerHashes: new Set([providerHash]),
        attempts: 1,
        nextAttemptAt: 0,
        inFlight: false,
      });
      (manager as any).shouldRequestMetadataRepair = () => true;
      (manager as any).shouldRequestGroupRepair = () => true;
      const requestPage = vi.fn(async () => undefined);
      (manager as any).requestLinkedHistoryPage = requestPage;
      const input = {
        groupId: 69,
        peerHash: providerHash,
        providerPeerHash: providerHash,
        latest: { eventId, feedTimestamp: 99_000 },
        reason: 'test-latest-cooldown',
      };

      (manager as any).scheduleLatestEventPullFallback(input);
      (manager as any).scheduleLatestEventPullFallback(input);
      await vi.advanceTimersByTimeAsync(2_001);
      expect(requestPage).toHaveBeenCalledTimes(2);

      (manager as any).scheduleLatestEventPullFallback(input);
      await vi.advanceTimersByTimeAsync(2_001);
      expect(requestPage).toHaveBeenCalledTimes(2);
    } finally {
      manager.close();
      vi.useRealTimers();
    }
  });

  it('does not duplicate a slow linked history request and cancels it before a stale retry', async () => {
    const providerHash = 'c'.repeat(32);
    const accepts: Array<Record<string, unknown>> = [];
    const cancels: Array<Record<string, unknown>> = [];
    let now = 100_000;
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      ensurePeerIdentityKnown: async () => true,
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepts.push(payload);
        return { ok: true as const };
      },
      cancelReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        cancels.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);

    const cursor = { eventId: 'stale-cursor-event', feedTimestamp: 99_000 };
    await (manager as any).requestLinkedHistoryPage(
      providerHash,
      69,
      '*',
      cursor,
      'before',
      false,
      'test-stale'
    );
    await (manager as any).requestLinkedHistoryPage(
      providerHash,
      69,
      '*',
      cursor,
      'before',
      false,
      'test-stale'
    );
    expect(accepts).toHaveLength(1);

    now += 61_000;
    await (manager as any).requestLinkedHistoryPage(
      providerHash,
      69,
      '*',
      cursor,
      'before',
      false,
      'test-stale'
    );
    expect(accepts).toHaveLength(1);

    now += 60_000;
    await (manager as any).requestLinkedHistoryPage(
      providerHash,
      69,
      '*',
      cursor,
      'before',
      false,
      'test-stale'
    );
    expect(accepts).toHaveLength(2);
    expect(accepts[1].transferId).not.toBe(accepts[0].transferId);
    expect(cancels).toHaveLength(1);
    expect(cancels[0].transferId).toBe(accepts[0].transferId);
    manager.close();
  });

  it.skip('requests exact latest before channel metadata when a newer digest differs', async () => {
    const providerHash = 'e'.repeat(32);
    const accepts: Array<Record<string, any>> = [];
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      ensurePeerIdentityKnown: async () => true,
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        accepts.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        _peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push(wire);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 69,
        latest: { id: 'remote-latest-event', ts: 99_000 },
        digestHash: 'f'.repeat(64),
        sd: providerHash,
      },
      'overlay-hop'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(accepts).toHaveLength(0);
    expect(direct.find((wire) => wire.k === 'event_req')).toMatchObject({
      t: 'RCHAT',
      k: 'event_req',
      g: 69,
      q: expect.objectContaining({ id: 'remote-latest-event' }),
    });
    manager.close();
  });

  it('serves a linked history page request with cached group events', async () => {
    const sentResources: Array<Record<string, unknown>> = [];
    const authorizations: Array<Record<string, unknown>> = [];
    const rejections: Array<Record<string, unknown>> = [];
    const requesterPeerHash = 'd'.repeat(32);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        sentResources.push(payload);
        return { ok: true as const };
      },
      authorizeReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        authorizations.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        rejections.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([999]);
    const events = signedAuthorEvents(
      Array.from({ length: 105 }, (_, index) => ({
        eventId: `linked-history-${String(index + 1).padStart(3, '0')}`,
        groupId: 69,
        authorSeq: index + 1,
        timestamp: 80_000 + index,
      }))
    );
    for (const event of events) {
      expect((manager as any).db.insertEvent(event, true)).toBe(true);
    }
    const latest = events[events.length - 1];
    const request = signedHistoryPageRequestWire({
      groupId: 69,
      channelId: '*',
      direction: 'before',
      cursor: { id: latest.eventId, ts: latest.timestamp },
      includeCursor: true,
      limit: 100,
      timestamp: 100_000,
    });

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'history-link-1',
      transferId: 'history-transfer-1',
      peerPresenceHash: requesterPeerHash,
      auth: {
        ...request,
        type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
        transferId: 'history-transfer-1',
        groupId: 69,
        requesterPeerHash,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(rejections).toEqual([]);
    expect(authorizations).toEqual([
      {
        linkId: 'history-link-1',
        transferId: 'history-transfer-1',
      },
    ]);
    expect(sentResources).toHaveLength(1);
    expect(sentResources[0]).toEqual(
      expect.objectContaining({
        allowedRecipientAddress: requesterPeerHash,
        transferId: 'history-transfer-1',
        size: expect.any(Number),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        metadata: expect.objectContaining({
          logicalResourceType: 'reticulum_chat_history_page',
          groupId: 69,
          channelId: '*',
          eventCount: 100,
          variableSize: true,
        }),
      })
    );
    const page = JSON.parse(
      fs.readFileSync(String(sentResources[0].filePath), 'utf8')
    ) as {
      d: string;
      more?: boolean;
      events: ReticulumChatEvent[];
    };
    expect(page.d).toBe('before');
    expect(page.more).toBe(true);
    expect(page.events).toHaveLength(100);
    expect(page.events[0].eventId).toBe('linked-history-006');
    expect(page.events[99].eventId).toBe('linked-history-105');
    manager.close();
  });

  it('rejects cached linked history when the signed requester is not a group member', async () => {
    const sentResources: Array<Record<string, unknown>> = [];
    const authorizations: Array<Record<string, unknown>> = [];
    const rejections: Array<Record<string, unknown>> = [];
    const requesterPeerHash = 'd'.repeat(32);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        sentResources.push(payload);
        return { ok: true as const };
      },
      authorizeReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        authorizations.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        rejections.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => false,
    });
    manager.setLocalGroupMemberships([999]);
    const event = signedEvent({
      eventId: 'linked-history-rejected',
      groupId: 69,
      timestamp: 80_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    const request = signedHistoryPageRequestWire({
      groupId: 69,
      channelId: '*',
      direction: 'before',
      cursor: { id: event.eventId, ts: event.timestamp },
      includeCursor: true,
      limit: 100,
      timestamp: 100_000,
    });

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'history-link-rejected',
      transferId: 'history-transfer-rejected',
      peerPresenceHash: requesterPeerHash,
      auth: {
        ...request,
        type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
        transferId: 'history-transfer-rejected',
        groupId: 69,
        requesterPeerHash,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sentResources).toEqual([]);
    expect(authorizations).toEqual([]);
    expect(rejections).toEqual([
      {
        linkId: 'history-link-rejected',
        transferId: 'history-transfer-rejected',
        reason: 'requester_not_group_member',
      },
    ]);
    manager.close();
  });

  it('serves linked metadata history pages from cached group events without normal messages', async () => {
    const sentResources: Array<Record<string, any>> = [];
    const authorizations: Array<Record<string, unknown>> = [];
    const requesterPeerHash = 'f'.repeat(32);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        sentResources.push(payload);
        return { ok: true as const };
      },
      authorizeReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        authorizations.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([999]);
    const events = signedAuthorEvents([
      {
        eventId: 'linked-meta-1',
        groupId: 70,
        channelId: 'general',
        eventType: 'channel_create',
        authorSeq: 1,
        timestamp: 80_000,
        encryptedPayload: JSON.stringify({ channelId: 'alpha', name: 'alpha' }),
      },
      {
        eventId: 'linked-meta-message',
        groupId: 70,
        channelId: 'alpha',
        eventType: 'message',
        authorSeq: 2,
        timestamp: 80_001,
      },
      {
        eventId: 'linked-meta-2',
        groupId: 70,
        channelId: 'alpha',
        eventType: 'channel_update',
        authorSeq: 3,
        timestamp: 80_002,
        encryptedPayload: JSON.stringify({
          channelId: 'alpha',
          name: 'alpha-renamed',
        }),
      },
    ]);
    for (const event of events) {
      expect((manager as any).db.insertEvent(event, true)).toBe(true);
    }
    const request = signedHistoryPageRequestWire({
      groupId: 70,
      channelId: '*',
      direction: 'before',
      priority: 'metadata',
      cursor: { id: 'linked-meta-2', ts: 80_002 },
      includeCursor: true,
      limit: 100,
      timestamp: 100_000,
    });

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'history-link-meta',
      transferId: 'history-transfer-meta',
      peerPresenceHash: requesterPeerHash,
      auth: {
        ...request,
        type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
        transferId: 'history-transfer-meta',
        groupId: 70,
        requesterPeerHash,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(authorizations).toEqual([
      {
        linkId: 'history-link-meta',
        transferId: 'history-transfer-meta',
      },
    ]);
    expect(sentResources).toHaveLength(1);
    expect(sentResources[0].metadata).toEqual(
      expect.objectContaining({
        logicalResourceType: 'reticulum_chat_history_page',
        groupId: 70,
        channelId: '*',
        p: 'm',
        eventCount: 2,
      })
    );
    const page = JSON.parse(
      fs.readFileSync(String(sentResources[0].filePath), 'utf8')
    ) as {
      p?: string;
      events: ReticulumChatEvent[];
    };
    expect(page.p).toBe('m');
    expect(page.events.map((event) => event.eventId)).toEqual([
      'linked-meta-1',
      'linked-meta-2',
    ]);
    manager.close();
  });

  it('accepts relayed event page resources from the provider Reticulum destination', async () => {
    const providerHash = 'b'.repeat(32);
    const accepts: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          accepts.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_page_offer',
        g: 69,
        p: {
          x: 'relayed-page-provider-identity',
          c: '*',
          d: 'b',
          ph: 'c'.repeat(64),
          s: 123,
          n: 1,
          sd: providerHash,
        },
      },
      'intermediate-peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(accepts).toContainEqual(
      expect.objectContaining({
        peerPresenceHash: providerHash,
        reticulumIdentityPublicKeyBase64: '',
        transferId: 'relayed-page-provider-identity',
      })
    );
    manager.close();
  });

  it('resolves provider identity before accepting a relayed event page resource', async () => {
    const providerHash = 'b'.repeat(32);
    const publicKey = Buffer.alloc(64, 7).toString('base64');
    const fanout: Array<Record<string, unknown>> = [];
    const registrations: Array<Record<string, unknown>> = [];
    const accepts: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        ensurePeerIdentityKnown: async () => false,
        registerPeerIdentityFromGroupJoin: async (
          peerPresenceHash: string,
          reticulumIdentityPublicKeyBase64: string
        ) => {
          registrations.push({
            peerPresenceHash,
            reticulumIdentityPublicKeyBase64,
          });
          return true;
        },
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
        acceptReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          accepts.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
    });
    manager.setLocalGroupMemberships([69]);
    manager.subscribeGroup(69);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_page_offer',
        g: 69,
        p: {
          x: 'relayed-page-provider-identity',
          c: '*',
          d: 'b',
          ph: 'c'.repeat(64),
          s: 123,
          n: 1,
          sd: providerHash,
        },
      },
      'intermediate-peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const identityReq = fanout.find((wire) => wire.k === 'identity_req');
    expect(identityReq).toEqual(
      expect.objectContaining({
        k: 'identity_req',
        d: expect.any(String),
      })
    );

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'identity_offer',
        d: providerHash,
        rk: publicKey,
        rid: identityReq?.rid,
      },
      'intermediate-peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(registrations).toContainEqual({
      peerPresenceHash: providerHash,
      reticulumIdentityPublicKeyBase64: publicKey,
    });
    expect(accepts).toContainEqual(
      expect.objectContaining({
        peerPresenceHash: providerHash,
        reticulumIdentityPublicKeyBase64: publicKey,
        transferId: 'relayed-page-provider-identity',
      })
    );
    manager.close();
  });

  it('relays group subscriptions through non-member overlay peers', async () => {
    const fanout: Array<{
      messages: Record<string, unknown>[];
      excludes: string[];
    }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[],
          excludes: string[] = []
        ) => {
          fanout.push({ messages, excludes });
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [72], mode: 'summary' },
      'peer-a'
    );
    await Promise.resolve();

    expect(fanout).toContainEqual(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            t: 'RCHAT',
            k: 'group_sub',
            groups: [72],
            mode: 'summary',
            o: 'peer-a',
            h: 1,
          }),
        ],
        excludes: expect.arrayContaining(['peer-a']),
      })
    );
    manager.close();
  });

  it('forwards a routed group subscription only once across alternate paths', async () => {
    const fanout: Array<{
      messages: Record<string, unknown>[];
      excludes: string[];
    }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[],
          excludes: string[] = []
        ) => {
          fanout.push({ messages, excludes });
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });
    const enqueueSync = vi.spyOn(manager as any, 'enqueueGroupSubSync');
    const routedSubscription = {
      t: 'RCHAT',
      k: 'group_sub',
      groups: [72],
      mode: 'summary',
      o: 'origin-peer',
      h: 1,
    };

    manager.handleWire(routedSubscription, 'relay-a');
    manager.handleWire(routedSubscription, 'relay-b');
    manager.handleWire(routedSubscription, 'relay-c');
    await flushQueuedWork();

    expect(fanout).toHaveLength(1);
    expect(enqueueSync).not.toHaveBeenCalled();
    expect(fanout[0]).toEqual(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            k: 'group_sub',
            groups: [72],
            o: 'origin-peer',
            h: 2,
          }),
        ],
      })
    );
    manager.close();
  });

  it('propagates a better group subscription route and later renewals', async () => {
    let now = 100_000;
    const fanout: Record<string, unknown>[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
      } as any,
      now: () => now,
    });
    const subscription = (hops: number) => ({
      t: 'RCHAT',
      k: 'group_sub',
      groups: [72],
      mode: 'summary',
      o: 'origin-peer',
      h: hops,
    });

    manager.handleWire(subscription(3), 'relay-a');
    manager.handleWire(subscription(1), 'relay-b');
    manager.handleWire(subscription(2), 'relay-c');
    await flushQueuedWork();

    expect(fanout.map((wire) => wire.h)).toEqual([4, 2]);

    now += 60_001;
    manager.handleWire(subscription(2), 'relay-c');
    await flushQueuedWork();

    expect(fanout.map((wire) => wire.h)).toEqual([4, 2, 3]);
    manager.close();
  });

  it('allows an alternate group subscription path after forwarding fails', async () => {
    const fanout = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        reason: 'no-route' as const,
      })
      .mockResolvedValue({ ok: true as const });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: fanout,
      } as any,
      now: () => 100_000,
    });
    const subscription = {
      t: 'RCHAT',
      k: 'group_sub',
      groups: [72],
      mode: 'summary',
      o: 'origin-peer',
      h: 1,
    };

    manager.handleWire(subscription, 'relay-a');
    await flushQueuedWork();
    manager.handleWire(subscription, 'relay-b');
    await flushQueuedWork();

    expect(fanout).toHaveBeenCalledTimes(2);
    manager.close();
  });

  it('does not let an older failed forward clear a newer better route', async () => {
    let resolveFirst:
      | ((result: { ok: false; reason: 'no-route' }) => void)
      | undefined;
    const fanout = vi.fn(
      () =>
        new Promise<{ ok: true } | { ok: false; reason: 'no-route' }>(
          (resolve) => {
            if (fanout.mock.calls.length === 1) {
              resolveFirst = resolve;
              return;
            }
            resolve({ ok: true });
          }
        )
    );
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: fanout,
      } as any,
      now: () => 100_000,
    });
    const subscription = (hops: number) => ({
      t: 'RCHAT',
      k: 'group_sub',
      groups: [72],
      mode: 'summary',
      o: 'origin-peer',
      h: hops,
    });

    manager.handleWire(subscription(3), 'relay-a');
    await Promise.resolve();
    manager.handleWire(subscription(1), 'relay-b');
    await flushQueuedWork();
    resolveFirst?.({ ok: false, reason: 'no-route' });
    await flushQueuedWork();
    manager.handleWire(subscription(2), 'relay-c');
    await flushQueuedWork();

    expect(fanout).toHaveBeenCalledTimes(2);
    manager.close();
  });

  it('bounds group subscription forwarding leases', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => 100_000,
    });

    for (let index = 0; index < 4_200; index += 1) {
      (manager as any).reserveGroupSubForward(72, `origin-${index}`, 1);
    }

    expect((manager as any).forwardedGroupSubKeys.size).toBe(4_096);
    manager.close();
  });

  it('ignores a relayed copy of the local group subscription', async () => {
    const fanout: Record<string, unknown>[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });
    const enqueueSync = vi.spyOn(manager as any, 'enqueueGroupSubSync');

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_sub',
        groups: [72],
        mode: 'summary',
        o: 'aaaaaaaaaaaaaaaa',
        h: 2,
      },
      'relay-a'
    );
    await flushQueuedWork();

    expect(fanout).toEqual([]);
    expect(enqueueSync).not.toHaveBeenCalled();
    manager.close();
  });

  it('does not trust an advertised relay origin without a positive hop count', async () => {
    const fanout: Record<string, unknown>[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_sub',
        groups: [72],
        mode: 'summary',
        o: 'spoofed-origin',
        h: 0,
      },
      'peer-a'
    );
    await flushQueuedWork();

    expect(fanout).toContainEqual(
      expect.objectContaining({
        k: 'group_sub',
        groups: [72],
        o: 'peer-a',
        h: 1,
      })
    );
    manager.close();
  });

  it.skip('relays group digests back along subscribed interest routes', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
    });

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      'peer-a'
    );
    direct.length = 0;
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 73,
        latest: { id: 'event-latest-73', ts: 1000 },
        channels: [],
      },
      'peer-c'
    );
    await flushQueuedWork();

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'group_digest',
          g: 73,
        }),
      })
    );
    manager.close();
  });

  it('routes published group digests through group interest routes before broad fanout', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const fanout: Record<string, unknown>[] = [];
    const resources: unknown[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        sendReticulumChatResourceDetailed: async (payload: unknown) => {
          resources.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });

    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      'peer-a'
    );
    direct.length = 0;
    fanout.length = 0;

    const result = await manager.publishEvent(
      signedEvent({
        eventId: 'event-routed-publish',
        groupId: 73,
        timestamp: 100_000,
      })
    );

    expect(result).toEqual({ ok: true });
    expect(resources.length).toBeGreaterThan(0);
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'group_state_digest_v3',
          g: 73,
        }),
      })
    );
    expect(
      fanout.some((wire) => wire.k === 'group_state_digest_v3' && wire.g === 73)
    ).toBe(false);
    manager.close();
  });

  it('keeps a directly notified peer available as the next hop for an indirect group member', async () => {
    const now = 100_000;
    const localPeer = 'a'.repeat(32);
    const middlePeer = 'b'.repeat(32);
    const indirectPeer = 'c'.repeat(32);
    const leafPeer = 'd'.repeat(32);
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const fanout: Array<{
      wires: Record<string, unknown>[];
      excluded: string[];
    }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => localPeer,
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          if (wire.k === 'event_offer' && peer === indirectPeer) {
            return {
              ok: false as const,
              reason: 'packet-send-false' as const,
            };
          }
          return { ok: true as const };
        },
        fanoutReticulumChatDetailed: async (
          wires: Record<string, unknown>[],
          excluded: string[] = []
        ) => {
          fanout.push({ wires, excluded });
          return { ok: true as const };
        },
        sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);

    const subscriptions = (manager as any).peerSubscriptions as Map<
      string,
      Map<number, number>
    >;
    subscriptions.set(middlePeer, new Map([[73, now + 60_000]]));
    subscriptions.set(indirectPeer, new Map([[73, now + 60_000]]));
    subscriptions.set(leafPeer, new Map([[73, now + 60_000]]));
    const routes = (manager as any).groupInterestRoutes as Map<
      string,
      Record<string, unknown>
    >;
    routes.set(`73:${middlePeer}`, {
      groupId: 73,
      originPeerHash: middlePeer,
      reversePeerHash: middlePeer,
      hops: 0,
      expiresAt: now + 60_000,
    });
    routes.set(`73:${indirectPeer}`, {
      groupId: 73,
      originPeerHash: indirectPeer,
      reversePeerHash: middlePeer,
      hops: 1,
      expiresAt: now + 60_000,
    });
    routes.set(`73:${leafPeer}`, {
      groupId: 73,
      originPeerHash: leafPeer,
      reversePeerHash: leafPeer,
      hops: 0,
      expiresAt: now + 60_000,
    });

    const result = await manager.publishEvent(
      signedEvent({
        eventId: 'event-middle-peer-remains-forwarder',
        groupId: 73,
        timestamp: now,
      })
    );

    expect(result).toEqual({ ok: true });
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: middlePeer,
        wire: expect.objectContaining({
          k: 'event_offer',
          g: 73,
        }),
      })
    );
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: leafPeer,
        wire: expect.objectContaining({
          k: 'event_offer',
          g: 73,
        }),
      })
    );
    expect(
      direct.some(
        ({ peer, wire }) => peer === leafPeer && wire.k === 'event_notice_v3'
      )
    ).toBe(false);
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: middlePeer,
        wire: expect.objectContaining({
          k: 'event_notice_v3',
          g: 73,
        }),
      })
    );
    expect(
      fanout.some(({ wires }) =>
        wires.some((wire) => wire.k === 'event_notice_v3')
      )
    ).toBe(false);
    manager.close();
  });

  it('prunes failed group interest next hops and falls back to broad fanout', async () => {
    const fanout: Record<string, unknown>[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async () => ({
          ok: false as const,
          reason: 'no-route' as const,
        }),
        sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });

    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      'peer-a'
    );
    fanout.length = 0;

    const result = await manager.publishEvent(
      signedEvent({
        eventId: 'event-routed-publish-fallback',
        groupId: 73,
        timestamp: 100_000,
      })
    );

    expect(result).toEqual({ ok: true });
    expect(fanout).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'group_state_digest_v3',
        g: 73,
      })
    );
    expect((manager as any).getGroupInterestNextHops(73)).toEqual([]);
    manager.close();
  });

  it('routes imported event notices through immediate group next hops without changing the legacy event transfer protocol', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const now = 100_000;
    const sharedNextHop = 'd'.repeat(32);
    const directSubscriber = 'e'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
    });
    const routes = (manager as any).groupInterestRoutes as Map<
      string,
      Record<string, unknown>
    >;
    const routedOriginA = 'b'.repeat(32);
    const routedOriginB = 'c'.repeat(32);
    routes.set(`73:${routedOriginA}`, {
      groupId: 73,
      originPeerHash: routedOriginA,
      reversePeerHash: sharedNextHop,
      hops: 2,
      expiresAt: now + 60_000,
    });
    routes.set(`73:${routedOriginB}`, {
      groupId: 73,
      originPeerHash: routedOriginB,
      reversePeerHash: sharedNextHop,
      hops: 1,
      expiresAt: now + 60_000,
    });
    routes.set(`73:${directSubscriber}`, {
      groupId: 73,
      originPeerHash: directSubscriber,
      reversePeerHash: directSubscriber,
      hops: 0,
      expiresAt: now + 60_000,
    });

    await (manager as any).sendEventHintToInterestedPeers(
      signedEvent({
        eventId: 'event-routed-import-hint',
        groupId: 73,
        timestamp: now,
      })
    );

    expect(direct.map(({ peer }) => peer).sort()).toEqual(
      [directSubscriber, sharedNextHop].sort()
    );
    expect(direct.every(({ wire }) => wire.k === 'event_notice_v3')).toBe(true);
    expect(direct.some(({ wire }) => wire.k === 'event_req')).toBe(false);
    expect(direct.some(({ wire }) => wire.k === 'event_offer')).toBe(false);
    manager.close();
  });

  it('falls back to fanout when an imported event notice next hop fails', async () => {
    const fanout: Record<string, unknown>[] = [];
    const now = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async () => ({
          ok: false as const,
          reason: 'packet-send-false' as const,
        }),
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
      } as any,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
    });
    (manager as any).groupInterestRoutes.set(`73:${'b'.repeat(32)}`, {
      groupId: 73,
      originPeerHash: 'b'.repeat(32),
      reversePeerHash: 'd'.repeat(32),
      hops: 1,
      expiresAt: now + 60_000,
    });

    await (manager as any).sendEventHintToInterestedPeers(
      signedEvent({
        eventId: 'event-routed-import-hint-fallback',
        groupId: 73,
        timestamp: now,
      })
    );

    expect(fanout).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'event_notice_v3',
        g: 73,
      })
    );
    expect((manager as any).getGroupInterestNextHops(73)).toEqual([]);
    manager.close();
  });

  it('forwards signed event notices through non-member intermediaries once per unique next hop', async () => {
    const now = 100_000;
    const sourcePeer = 'a'.repeat(32);
    const inboundPeer = sourcePeer;
    const sharedNextHop = 'd'.repeat(32);
    const otherNextHop = 'e'.repeat(32);
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const source = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => sourcePeer,
      } as any,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
    });
    const event = signedEvent({
      eventId: 'event-multihop-forward-notice',
      groupId: 73,
      timestamp: now,
    });
    const wire = await (source as any).buildEventNoticeWire(event);
    expect(wire).toBeTruthy();

    const intermediate = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'b'.repeat(32),
        sendReticulumChatDetailed: async (
          peer: string,
          forwardedWire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire: forwardedWire });
          return { ok: true as const };
        },
      } as any,
      now: () => now,
    });
    const routes = (intermediate as any).groupInterestRoutes as Map<
      string,
      Record<string, unknown>
    >;
    routes.set(`73:${'c'.repeat(32)}`, {
      groupId: 73,
      originPeerHash: 'c'.repeat(32),
      reversePeerHash: sharedNextHop,
      hops: 1,
      expiresAt: now + 60_000,
    });
    routes.set(`73:${'f'.repeat(32)}`, {
      groupId: 73,
      originPeerHash: 'f'.repeat(32),
      reversePeerHash: sharedNextHop,
      hops: 2,
      expiresAt: now + 60_000,
    });
    routes.set(`73:${otherNextHop}`, {
      groupId: 73,
      originPeerHash: otherNextHop,
      reversePeerHash: otherNextHop,
      hops: 0,
      expiresAt: now + 60_000,
    });

    intermediate.handleWire(wire, inboundPeer);
    await flushQueuedWork();
    expect(direct.map(({ peer }) => peer).sort()).toEqual(
      [sharedNextHop, otherNextHop].sort()
    );
    expect(direct.every(({ wire: sent }) => sent === wire)).toBe(true);
    expect((intermediate as any).pendingEventPulls.size).toBe(0);

    intermediate.handleWire(wire, inboundPeer);
    await flushQueuedWork();
    expect(direct).toHaveLength(2);

    const invalidWire = JSON.parse(JSON.stringify(wire));
    invalidWire.n.z = `${invalidWire.n.z.slice(0, -1)}${
      invalidWire.n.z.endsWith('1') ? '2' : '1'
    }`;
    intermediate.handleWire(invalidWire, inboundPeer);
    await flushQueuedWork();
    expect(direct).toHaveLength(2);

    intermediate.close();
    source.close();
  });

  it('forwards an event notice without starting a duplicate pull while its direct offer is active', async () => {
    const now = 100_000;
    const sourcePeer = 'a'.repeat(32);
    const intermediatePeer = 'b'.repeat(32);
    const downstreamPeer = 'c'.repeat(32);
    const event = signedEvent({
      eventId: 'event-active-direct-offer-forward',
      groupId: 73,
      timestamp: now,
    });
    const source = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => sourcePeer,
      } as any,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
    });
    const wire = await (source as any).buildEventNoticeWire(event);
    expect(wire).toBeTruthy();

    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const intermediate = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => intermediatePeer,
        sendReticulumChatDetailed: async (
          peer: string,
          forwardedWire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire: forwardedWire });
          return { ok: true as const };
        },
      } as any,
      now: () => now,
    });
    intermediate.setLocalGroupMemberships([73]);
    intermediate.subscribeGroup(73);
    (intermediate as any).groupInterestRoutes.set(`73:${downstreamPeer}`, {
      groupId: 73,
      originPeerHash: downstreamPeer,
      reversePeerHash: downstreamPeer,
      hops: 1,
      expiresAt: now + 60_000,
    });
    (intermediate as any).resourceOffers.set('active-event-transfer', {
      transferId: 'active-event-transfer',
      eventId: event.eventId,
      groupId: event.groupId,
      payloadHash: event.payloadHash,
      wireHash: 'f'.repeat(64),
      sizeBytes: 512,
      sourcePeerHash: sourcePeer,
    });

    intermediate.handleWire(wire, sourcePeer);
    await flushQueuedWork();

    expect(direct).toContainEqual({ peer: downstreamPeer, wire });
    expect(direct.some(({ wire: sent }) => sent.k === 'event_req')).toBe(false);
    expect((intermediate as any).pendingEventPulls.size).toBe(1);
    expect(
      (intermediate as any).pendingEventPulls.get(
        `73:${event.eventId}`
      ).inFlight
    ).toBe(true);
    expect([
      ...(intermediate as any).eventSourcePeers.get(event.eventId).peers,
    ]).toEqual([sourcePeer]);

    intermediate.close();
    source.close();
  });

  it('requests a forwarded event through its inbound route before trying the original source', async () => {
    const now = 100_000;
    const sourcePeer = 'a'.repeat(32);
    const relayPeer = 'b'.repeat(32);
    const source = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => sourcePeer,
      } as any,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
    });
    const wire = await (source as any).buildEventNoticeWire(
      signedEvent({
        eventId: 'event-multihop-reverse-request',
        groupId: 73,
        timestamp: now,
      })
    );
    const recipient = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'c'.repeat(32),
      } as any,
      now: () => now,
    });
    recipient.setLocalGroupMemberships([73]);
    recipient.subscribeGroup(73);

    recipient.handleWire(wire, relayPeer);
    const pending = (recipient as any).pendingEventPulls.get(
      '73:event-multihop-reverse-request'
    );
    expect([...pending.peerHashes]).toEqual([relayPeer, sourcePeer]);
    expect([
      ...(recipient as any).eventSourcePeers.get(
        'event-multihop-reverse-request'
      ).peers,
    ]).toEqual([sourcePeer]);

    recipient.close();
    source.close();
  });

  it('coalesces a transient forwarded event-notice failure into one bounded retry', async () => {
    const now = 100_000;
    const sourcePeer = 'a'.repeat(32);
    const nextHop = 'c'.repeat(32);
    const source = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => sourcePeer,
      } as any,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
    });
    const wire = await (source as any).buildEventNoticeWire(
      signedEvent({
        eventId: 'event-multihop-forward-retry',
        groupId: 73,
        timestamp: now,
      })
    );
    const sends: string[] = [];
    const intermediate = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'b'.repeat(32),
        sendReticulumChatDetailed: async (peer: string) => {
          sends.push(peer);
          return { ok: false as const, reason: 'packet-send-false' as const };
        },
      } as any,
      now: () => now,
    });
    (intermediate as any).groupInterestRoutes.set(`73:${nextHop}`, {
      groupId: 73,
      originPeerHash: nextHop,
      reversePeerHash: nextHop,
      hops: 1,
      expiresAt: now + 60_000,
    });

    intermediate.handleWire(wire, sourcePeer);
    intermediate.handleWire(wire, sourcePeer);
    await flushQueuedWork();

    expect(sends).toEqual([nextHop]);
    expect((intermediate as any).controlRetryQueue.size).toBe(1);
    expect([...(intermediate as any).controlRetryQueue.values()][0]).toEqual(
      expect.objectContaining({
        peerHash: nextHop,
        attempts: 0,
        wire,
      })
    );

    intermediate.close();
    source.close();
  });

  it('forwards group state digests once per unique next hop without requiring local membership', async () => {
    const now = 100_000;
    const inboundPeer = 'a'.repeat(32);
    const nextHop = 'c'.repeat(32);
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const intermediate = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'b'.repeat(32),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => now,
    });
    (intermediate as any).groupInterestRoutes.set(`73:${nextHop}`, {
      groupId: 73,
      originPeerHash: nextHop,
      reversePeerHash: nextHop,
      hops: 1,
      expiresAt: now + 60_000,
    });
    const wire: ReticulumChatWire = {
      t: 'RCHAT',
      v: 3,
      k: 'group_state_digest_v3',
      g: 73,
      d: {
        latest: { id: 'event-multihop-digest', ts: now },
        eventHash: 'f'.repeat(64),
      },
    };

    intermediate.handleWire(wire, inboundPeer);
    intermediate.handleWire(wire, inboundPeer);
    await flushQueuedWork();
    expect(direct).toEqual([{ peer: nextHop, wire }]);

    const lateNextHop = 'd'.repeat(32);
    (intermediate as any).groupInterestRoutes.set(`73:${lateNextHop}`, {
      groupId: 73,
      originPeerHash: lateNextHop,
      reversePeerHash: lateNextHop,
      hops: 1,
      expiresAt: now + 60_000,
    });
    intermediate.handleWire(wire, inboundPeer);
    await flushQueuedWork();
    expect(direct).toEqual([
      { peer: nextHop, wire },
      { peer: lateNextHop, wire },
    ]);

    const newerWire: ReticulumChatWire = {
      ...wire,
      d: {
        latest: { id: 'event-multihop-digest-newer', ts: now + 1 },
        eventHash: 'e'.repeat(64),
      },
    };
    await (intermediate as any).sendGroupRoutedControl(73, newerWire, {
      fallbackFanout: false,
    });
    const sentBeforeEcho = direct.length;
    intermediate.handleWire(newerWire, inboundPeer);
    await flushQueuedWork();
    expect(direct).toHaveLength(sentBeforeEcho);

    intermediate.close();
  });

  it('relays group repair requests through subscribed interest routes before broad fanout', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const fanout: Array<{
      messages: Record<string, unknown>[];
      excludes: string[];
    }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[],
          excludes: string[] = []
        ) => {
          fanout.push({ messages, excludes });
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      'peer-a'
    );
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      'peer-c'
    );
    direct.length = 0;
    fanout.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'feed_req',
        g: 73,
        c: '*',
        limit: 100,
      },
      'peer-c'
    );
    await Promise.resolve();

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'feed_req',
          g: 73,
          c: '*',
          o: 'peer-c',
          h: 1,
        }),
      })
    );
    expect(
      fanout.some(({ messages }) =>
        messages.some((wire) => wire.k === 'feed_req')
      )
    ).toBe(false);
    manager.close();
  });

  it('relays typing indicators only along subscribed group interest routes', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
    });

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      'peer-a'
    );
    direct.length = 0;
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'typing',
        g: 73,
        c: 'general',
        a: 'Qsender',
        ts: 100_000,
        active: true,
      },
      'peer-c'
    );
    await Promise.resolve();

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'typing',
          g: 73,
          c: 'general',
          a: 'Qsender',
          active: true,
          o: 'peer-c',
          h: 1,
        }),
      })
    );
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'typing',
        g: 73,
        c: 'general',
        a: 'Qsender',
        ts: 100_000,
        active: true,
        o: 'peer-origin',
        h: 3,
      },
      'peer-d'
    );
    await Promise.resolve();

    expect(direct).toHaveLength(1);
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'typing',
        g: 73,
        c: 'general',
        a: 'Qother',
        ts: 90_000,
        active: true,
      },
      'peer-d'
    );
    await Promise.resolve();
    expect(direct).toHaveLength(1);
    manager.close();
  });

  it('forwards an identity request only along its first valid reverse route', async () => {
    const fanout: Array<{
      messages: Record<string, unknown>[];
      excludes: string[];
    }> = [];
    const localPeerHash = 'a'.repeat(32);
    const destinationHash = 'd'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => localPeerHash,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[],
          excludes: string[] = []
        ) => {
          fanout.push({ messages, excludes });
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });
    const request: ReticulumChatWire = {
      t: 'RCHAT',
      k: 'identity_req',
      d: destinationHash,
      rid: '1'.repeat(24),
      h: 0,
      m: 5,
      x: 130_000,
    };

    manager.handleWire(request, 'b'.repeat(32));
    manager.handleWire({ ...request, h: 2 }, 'c'.repeat(32));
    await flushAsyncWork();

    const requests = fanout.filter(({ messages }) =>
      messages.some((wire) => wire.k === 'identity_req')
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].excludes).not.toContain(destinationHash);
    manager.close();
  });

  it('resolves the local resource identity without a network request', async () => {
    const localPeerHash = 'a'.repeat(32);
    const localPublicKey = Buffer.alloc(64, 7).toString('base64');
    const fanout = vi.fn(async () => ({ ok: true as const }));
    const ensureKnown = vi.fn(async () => false);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => localPeerHash,
        getLocalIdentityPublicKeyBase64: async () => localPublicKey,
        ensurePeerIdentityKnown: ensureKnown,
        fanoutReticulumChatDetailed: fanout,
      } as any,
      now: () => 100_000,
    });

    await expect(
      (manager as any).ensureResourcePeerIdentity(localPeerHash, 'test')
    ).resolves.toBe(localPublicKey);
    expect(ensureKnown).not.toHaveBeenCalled();
    expect(fanout).not.toHaveBeenCalled();
    manager.close();
  });

  it('does not relay a local identity request echo after its waiter finishes', async () => {
    const fanout: ReticulumChatWire[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        fanoutReticulumChatDetailed: async (messages: ReticulumChatWire[]) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });
    const pending = (manager as any).requestReticulumPeerIdentity(
      'd'.repeat(32),
      'test'
    );
    await flushAsyncWork();
    const request = fanout.find(
      (wire): wire is Extract<ReticulumChatWire, { k: 'identity_req' }> =>
        wire.k === 'identity_req'
    );
    expect(request).toBeDefined();

    const waiter = (manager as any).localIdentityRequests.get(request!.rid);
    clearTimeout(waiter.timeout);
    (manager as any).localIdentityRequests.delete(request!.rid);
    waiter.resolve(null);
    await expect(pending).resolves.toBeNull();

    manager.handleWire({ ...request!, h: 2 }, 'b'.repeat(32));
    await flushAsyncWork();
    expect(fanout.filter((wire) => wire.k === 'identity_req')).toHaveLength(1);
    manager.close();
  });

  it('emits and relays QortalLand state only along subscribed group interest routes', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const emitted: Array<Record<string, unknown>> = [];
    const signer = createLandAuthSigner();
    const peerA = 'bbbbbbbbbbbbbbbb';
    const peerC = 'cccccccccccccccc';
    const signerDestination = 'd'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
      // A valid Land route must not depend on the separate presence/DM peer
      // cache being populated in this direction.
      getVerifiedReticulumPeers: () => [],
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });

    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    manager.on('landState', (payload) => {
      emitted.push(payload as Record<string, unknown>);
    });
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      peerA
    );
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'land_state',
        g: 73,
        a: signer.address,
        s: 'session-1',
        q: 6,
        x: 511,
        y: 419,
        d: 'r',
        m: 'walk',
        ts: 100_000,
        z: 'unsigned',
      },
      peerC
    );
    await flushQueuedWork();
    expect(emitted).toHaveLength(0);
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: peerA,
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'land_auth_req',
          g: 73,
          a: signer.address,
          s: 'session-1',
        }),
      })
    );
    direct.length = 0;

    const routeWire = signer.landRouteWire(
      73,
      'session-1',
      signerDestination,
      100_000
    );
    expect(
      verifyReticulumLandSessionRouteWire(routeWire, 100_000)
    ).toMatchObject({
      authorAddress: signer.address,
      destinationHash: signerDestination,
    });
    manager.handleWire({ ...routeWire, d: 'e'.repeat(32) }, peerC);
    await flushQueuedWork();
    expect((manager as any).landSessionRoutes.size).toBe(0);

    manager.handleWire(routeWire, peerC);
    await flushQueuedWork();
    expect((manager as any).landSessionRoutes.size).toBe(1);

    manager.handleWire(signer.landAuthWire(73, 'session-1', 100_000), peerC);
    await flushQueuedWork();

    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'session-1',
        sequence: 7,
        x: 512,
        y: 420,
        roomId: 'skyline',
        direction: 'r',
        movement: 'walk',
        afk: true,
        dnd: false,
        voiceEnabled: true,
        voiceMuted: false,
        skinId: 4,
        timestamp: 100_000,
      }),
      peerC
    );
    await vi.waitFor(() => expect(emitted).toHaveLength(1), {
      timeout: 2_000,
      interval: 10,
    });

    expect(emitted).toContainEqual(
      expect.objectContaining({
        groupId: 73,
        authorAddress: signer.address,
        sessionId: 'session-1',
        destinationHash: signerDestination,
        sequence: 7,
        x: 512,
        y: 420,
        roomId: 'skyline',
        direction: 'r',
        movement: 'walk',
        afk: true,
        dnd: false,
        voiceEnabled: true,
        voiceMuted: false,
        skinId: 4,
      })
    );

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: peerA,
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'land_state',
          g: 73,
          a: signer.address,
          s: 'session-1',
          q: 7,
          u: 'skyline',
          v: 5,
          i: 4,
          o: peerC,
          h: 1,
        }),
      })
    );
    manager.close();
  });

  it('signs outgoing QortalLand social actions with the active Land session key', async () => {
    let now = 100_000;
    const sent: Array<Record<string, unknown>> = [];
    const emitted: Array<Record<string, unknown>> = [];
    const signer = createLandAuthSigner();
    const target = createLandAuthSigner();
    const actionId = '123e4567-e89b-42d3-a456-426614174000';
    const compactActionId = Buffer.from(
      actionId.replace(/-/g, ''),
      'hex'
    ).toString('base64url');
    const sourceSessionId = 'a'.repeat(16);
    const compactSourceSessionId = Buffer.from(sourceSessionId, 'hex').toString(
      'base64url'
    );
    const targetSessionId = 'b'.repeat(16);
    const compactTargetSessionId = Buffer.from(targetSessionId, 'hex').toString(
      'base64url'
    );
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          sent.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          _peer: string,
          wire: Record<string, unknown>
        ) => {
          sent.push(wire);
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => now,
      signLocalFields: signer.signLocalFields,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address || address === target.address,
    });

    manager.setLocalGroupMemberships([
      { groupId: 73, localAddress: signer.address },
    ]);
    manager.subscribeGroup(73);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      'peer-target'
    );
    manager.handleWire(
      target.landAuthWire(73, targetSessionId, 100_000),
      'peer-target'
    );
    await flushQueuedWork();
    sent.length = 0;
    manager.on('landAction', (payload) => {
      emitted.push(payload as Record<string, unknown>);
    });

    const result = await manager.sendLandAction(73, {
      actionId,
      actionType: 'love',
      fromAddress: signer.address,
      sourceSessionId,
      sequence: 1,
      toAddress: target.address,
      targetSessionId,
      roomId: 'skyline',
    });
    expect(result.ok).toBe(true);

    const authWire = sent.find((wire) => wire.k === 'land_auth');
    const actionWire = sent.find((wire) => wire.k === 'la');
    expect(authWire?.e).toEqual(expect.any(String));
    expect(actionWire).toMatchObject({
      y: 'l',
      id: compactActionId,
      a: signer.address,
      f: compactSourceSessionId,
      q: 1,
      s: compactTargetSessionId,
    });
    expect(actionWire).not.toHaveProperty('amt');
    expect(
      byteLengthUtf8JsonWithBridgeSender(actionWire as Record<string, unknown>)
    ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    expect(
      nacl.sign.detached.verify(
        new Uint8Array(
          canonicalizeForSigning(
            buildReticulumLandActionSignedFields({
              groupId: 73,
              actionId: compactActionId,
              actionType: 'love',
              fromAddress: signer.address,
              sourceSessionId,
              sequence: 1,
              toAddress: target.address,
              targetSessionId,
              amount: 0,
              roomId: '',
              timestamp: Number(actionWire?.ts),
            })
          )
        ),
        new Uint8Array(base58Decode(String(actionWire?.z))),
        new Uint8Array(base58Decode(String(authWire?.e)))
      )
    ).toBe(true);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        actionType: 'love',
        actionId,
        fromAddress: signer.address,
        sourceSessionId,
        sequence: 1,
        toAddress: target.address,
        targetSessionId,
      })
    );

    now += 2_000;
    sent.length = 0;
    const selfMoodResult = await manager.sendLandAction(73, {
      actionId: 'self-mood-action',
      actionType: 'sunshine',
      fromAddress: signer.address,
      sourceSessionId,
      sequence: 2,
      toAddress: signer.address,
      targetSessionId: sourceSessionId,
      roomId: 'club',
    });
    expect(selfMoodResult.ok).toBe(true);
    expect(sent).toContainEqual(
      expect.objectContaining({
        k: 'la',
        a: signer.address,
        s: compactSourceSessionId,
      })
    );
    expect(emitted).toContainEqual(
      expect.objectContaining({
        actionType: 'sunshine',
        fromAddress: signer.address,
        toAddress: signer.address,
        sourceSessionId,
        targetSessionId: sourceSessionId,
      })
    );

    sent.length = 0;
    const qortResult = await manager.sendLandAction(73, {
      actionId: 'legacy-qort-action',
      actionType: 'qort_received',
      fromAddress: signer.address,
      sourceSessionId,
      sequence: 3,
      toAddress: target.address,
      targetSessionId,
      amount: 1.25,
      roomId: 'skyline',
    });
    expect(qortResult.ok).toBe(true);
    expect(sent).toContainEqual(
      expect.objectContaining({
        k: 'land_action',
        id: 'legacy-qort-action',
        at: 'qort_received',
        a: signer.address,
        to: target.address,
        s: targetSessionId,
        amt: 1.25,
        u: 'skyline',
      })
    );
    expect(emitted).toContainEqual(
      expect.objectContaining({
        actionId: 'legacy-qort-action',
        actionType: 'qort_received',
        fromAddress: signer.address,
        sourceSessionId: 'legacy',
        toAddress: target.address,
        targetSessionId,
        amount: 1.25,
        roomId: 'skyline',
      })
    );

    await expect(
      manager.sendLandAction(73, {
        actionId: 'self-qort-action',
        actionType: 'qort_received',
        fromAddress: signer.address,
        sourceSessionId,
        sequence: 4,
        toAddress: signer.address,
        targetSessionId: sourceSessionId,
        amount: 1,
      })
    ).resolves.toMatchObject({ ok: false });

    await expect(
      manager.sendLandAction(73, {
        actionId: 'action-spoofed',
        actionType: 'buzz',
        fromAddress: target.address,
        sourceSessionId: 'session-local',
        sequence: 2,
        toAddress: signer.address,
        targetSessionId: 'session-target',
      })
    ).resolves.toMatchObject({ ok: false });
    manager.close();
  });

  it('verifies, rate limits, and replay-protects inbound QortalLand social actions', async () => {
    let now = 100_000;
    const emitted: Array<Record<string, unknown>> = [];
    const forwarded: Array<{ peer: string; wire: Record<string, unknown> }> =
      [];
    const signer = createLandAuthSigner();
    const target = createLandAuthSigner();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          forwarded.push({ peer, wire });
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => now,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address || address === target.address,
    });

    manager.setLocalGroupMemberships([
      { groupId: 73, localAddress: target.address },
    ]);
    manager.subscribeGroup(73);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      'peer-observer'
    );
    manager.on('landAction', (payload) => {
      emitted.push(payload as Record<string, unknown>);
    });
    manager.handleWire(
      target.landAuthWire(73, 'session-target', now),
      'peer-target'
    );
    await flushQueuedWork();
    forwarded.length = 0;

    const first = signer.landActionWire({
      groupId: 73,
      actionId: 'action-inbound-1',
      actionType: 'sunshine',
      sourceSessionId: 'session-source',
      sequence: 1,
      toAddress: target.address,
      targetSessionId: 'session-target',
      roomId: 'park',
      timestamp: now,
    });
    manager.handleWire(first, 'peer-source');
    await flushQueuedWork();
    expect(emitted).toHaveLength(0);
    expect((manager as any).pendingLandActions.size).toBe(1);
    manager.handleWire(
      signer.landAuthWire(73, 'session-source', now),
      'peer-source'
    );
    await vi.waitFor(() => expect(emitted).toHaveLength(1), {
      timeout: 2_000,
      interval: 10,
    });
    expect((manager as any).pendingLandActions.size).toBe(0);
    expect(forwarded).toContainEqual(
      expect.objectContaining({
        peer: 'peer-observer',
        wire: expect.objectContaining({ k: 'la', id: first.id }),
      })
    );

    manager.handleWire(first, 'peer-source-duplicate-route');
    await flushQueuedWork();
    expect(emitted).toHaveLength(1);

    now += 2_000;
    manager.handleWire(
      signer.landActionWire({
        groupId: 73,
        actionId: 'action-inbound-self',
        actionType: 'love',
        sourceSessionId: 'session-source',
        sequence: 2,
        toAddress: signer.address,
        targetSessionId: 'session-source',
        timestamp: now,
      }),
      'peer-source'
    );
    await flushQueuedWork();
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual(
      expect.objectContaining({
        actionType: 'love',
        fromAddress: signer.address,
        toAddress: signer.address,
        sourceSessionId: 'session-source',
        targetSessionId: 'session-source',
      })
    );

    const tampered = signer.landActionWire({
      groupId: 73,
      actionId: 'action-inbound-2',
      actionType: 'angel',
      sourceSessionId: 'session-source',
      sequence: 3,
      toAddress: target.address,
      targetSessionId: 'session-target',
      timestamp: now,
    });
    tampered.y = 'd';
    manager.handleWire(tampered, 'peer-source');
    await flushQueuedWork();
    expect(emitted).toHaveLength(2);

    now += 2_000;
    manager.handleWire(
      signer.landActionWire({
        groupId: 73,
        actionId: 'action-inbound-3',
        actionType: 'rain',
        sourceSessionId: 'session-source',
        sequence: 4,
        toAddress: target.address,
        targetSessionId: 'session-target',
        timestamp: now,
      }),
      'peer-source'
    );
    await flushQueuedWork();
    expect(emitted).toHaveLength(3);

    manager.handleWire(
      signer.landActionWire({
        groupId: 73,
        actionId: 'action-inbound-4',
        actionType: 'buzz',
        sourceSessionId: 'session-source',
        sequence: 5,
        toAddress: target.address,
        targetSessionId: 'session-target',
        timestamp: now,
      }),
      'peer-source'
    );
    await flushQueuedWork();
    expect(emitted).toHaveLength(3);
    manager.close();
  });

  it('enriches an already-rendered Land state when its signed device route arrives later', async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const signer = createLandAuthSigner();
    const destinationHash = 'd'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        getLocalDestinationHash: () => 'a'.repeat(32),
      } as any,
      now: () => 100_000,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });

    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    manager.on('landState', (payload) =>
      emitted.push(payload as Record<string, unknown>)
    );
    manager.handleWire(
      signer.landAuthWire(73, 'late-route', 100_000),
      'peer-source'
    );
    await flushQueuedWork();
    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'late-route',
        sequence: 1,
        x: 50,
        y: 60,
        voiceEnabled: true,
        timestamp: 100_000,
      }),
      'peer-source'
    );
    await vi.waitFor(() => expect(emitted).toHaveLength(1));
    expect(emitted[0]).not.toHaveProperty('destinationHash');

    manager.handleWire(
      signer.landRouteWire(73, 'late-route', destinationHash, 100_000),
      'peer-source'
    );
    await vi.waitFor(() => expect(emitted).toHaveLength(2));
    expect(emitted[1]).toMatchObject({
      sequence: 1,
      destinationHash,
    });
    manager.close();
  });

  it('does not relay a QortalLand state twice after Python fast forwarding', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const emitted: Array<Record<string, unknown>> = [];
    const signer = createLandAuthSigner();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });

    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    manager.on('landState', (payload) =>
      emitted.push(payload as Record<string, unknown>)
    );
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      'peer-a'
    );
    manager.handleWire(
      signer.landAuthWire(73, 'session-fast', 100_000),
      'peer-c'
    );
    await flushQueuedWork();
    direct.length = 0;
    (manager as any).landStateForwardingRevision = 4;
    (manager as any).landStateForwardingAppliedRevision = 4;
    (manager as any).landStateForwardingSnapshotDirty = false;

    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'session-fast',
        sequence: 1,
        x: 50,
        y: 60,
        timestamp: 100_000,
      }),
      'peer-c',
      '',
      true,
      4
    );
    await vi.waitFor(() => expect(emitted).toHaveLength(1));

    expect(direct.some(({ wire }) => wire.k === 'land_state')).toBe(false);
    manager.close();
  });

  it('relays a fast-forwarded Land state only to routes added during a pending refresh', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const signer = createLandAuthSigner();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });

    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    (manager as any).noteGroupInterestRoute(73, 'origin-a', 'peer-a', 1);
    (manager as any).noteGroupInterestRoute(73, 'origin-b', 'peer-b', 1);
    manager.handleWire(
      signer.landAuthWire(73, 'session-refresh', 100_000),
      'peer-c'
    );
    await flushQueuedWork();
    direct.length = 0;
    (manager as any).landStateForwardingAppliedRevision = 4;
    (manager as any).landStateForwardingAppliedTargets = new Map([
      [73, new Map([['peer-a', 200_000]])],
    ]);
    (manager as any).landStateForwardingSnapshotDirty = true;

    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'session-refresh',
        sequence: 1,
        x: 50,
        y: 60,
        timestamp: 100_000,
      }),
      'peer-c',
      '',
      true,
      4
    );

    await vi.waitFor(() =>
      expect(direct.filter(({ wire }) => wire.k === 'land_state')).toHaveLength(
        1
      )
    );
    expect(
      direct.find(({ wire }) => wire.k === 'land_state')?.peer
    ).toBe('peer-b');

    // A target whose bridge lease has expired must return to the JavaScript
    // fallback even if another target made the native fast-forward successful.
    direct.length = 0;
    (manager as any).landStateForwardingAppliedTargets = new Map([
      [
        73,
        new Map([
          ['peer-a', 99_999],
          ['peer-b', 200_000],
        ]),
      ],
    ]);
    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'session-refresh',
        sequence: 2,
        x: 51,
        y: 61,
        timestamp: 100_000,
      }),
      'peer-c',
      '',
      true,
      4
    );
    await vi.waitFor(() =>
      expect(direct.filter(({ wire }) => wire.k === 'land_state')).toHaveLength(
        1
      )
    );
    expect(
      direct.find(({ wire }) => wire.k === 'land_state')?.peer
    ).toBe('peer-a');
    manager.close();
  });

  it('does not rebuild Land forwarding for every unchanged route observation', () => {
    let now = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getState: () => 'ready',
        configureLandStateForwarding: async () => ({ ok: true as const }),
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => now,
    });

    (manager as any).noteGroupInterestRoute(73, 'peer-c', 'peer-a', 1);
    const initialRevision = (manager as any).landStateForwardingRevision;

    for (let index = 0; index < 20; index += 1) {
      (manager as any).noteGroupInterestRoute(73, 'peer-c', 'peer-a', 1);
    }
    expect((manager as any).landStateForwardingRevision).toBe(initialRevision);

    now += 7 * 60_000 + 30_001;
    (manager as any).noteGroupInterestRoute(73, 'peer-c', 'peer-a', 1);
    expect((manager as any).landStateForwardingRevision).toBe(
      initialRevision + 1
    );
    manager.close();
  });

  it('does not resend an unchanged Land forwarding snapshot', async () => {
    const configureLandStateForwarding = vi
      .fn()
      .mockResolvedValue({ ok: true as const });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getState: () => 'ready',
        configureLandStateForwarding,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
    });

    clearTimeout((manager as any).landStateForwardingSyncTimer);
    (manager as any).landStateForwardingSyncTimer = null;
    (manager as any).noteGroupInterestRoute(73, 'peer-c', 'peer-a', 1);
    clearTimeout((manager as any).landStateForwardingSyncTimer);
    (manager as any).landStateForwardingSyncTimer = null;
    await (manager as any).applyLandStateForwardingSnapshot();
    expect(configureLandStateForwarding).toHaveBeenCalledTimes(1);
    const appliedRevision = (manager as any).landStateForwardingAppliedRevision;

    (manager as any).scheduleLandStateForwardingSync();
    clearTimeout((manager as any).landStateForwardingSyncTimer);
    (manager as any).landStateForwardingSyncTimer = null;
    await (manager as any).applyLandStateForwardingSnapshot();

    expect(configureLandStateForwarding).toHaveBeenCalledTimes(1);
    expect((manager as any).landStateForwardingAppliedRevision).toBe(
      appliedRevision
    );
    expect((manager as any).landStateForwardingSnapshotDirty).toBe(false);
    manager.close();
  });

  it('coalesces a burst of Land route changes into one bridge snapshot', async () => {
    vi.useFakeTimers();
    try {
      const configureLandStateForwarding = vi
        .fn()
        .mockResolvedValue({ ok: true as const });
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getState: () => 'ready',
          configureLandStateForwarding,
          fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
          sendReticulumChatDetailed: async () => ({ ok: true as const }),
          getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
        } as any,
        now: () => 100_000,
      });

      clearTimeout((manager as any).landStateForwardingSyncTimer);
      (manager as any).landStateForwardingSyncTimer = null;
      for (let index = 0; index < 40; index += 1) {
        (manager as any).noteGroupInterestRoute(
          73,
          `peer-origin-${index}`,
          `peer-hop-${index % 4}`,
          1
        );
      }

      await vi.advanceTimersByTimeAsync(249);
      expect(configureLandStateForwarding).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(configureLandStateForwarding).toHaveBeenCalledTimes(1);
      expect(configureLandStateForwarding.mock.calls[0]?.[0]).toHaveLength(1);
      expect(
        configureLandStateForwarding.mock.calls[0]?.[0]?.[0]?.targets
      ).toHaveLength(4);
      manager.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces Land route changes that arrive during a bridge snapshot', async () => {
    vi.useFakeTimers();
    try {
      let resolveFirstSnapshot: ((result: { ok: true }) => void) | null = null;
      const configureLandStateForwarding = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<{ ok: true }>((resolve) => {
              resolveFirstSnapshot = resolve;
            })
        )
        .mockResolvedValue({ ok: true as const });
      const manager = new ReticulumChatManager({
        dbPath: tempDbPath(),
        bridge: {
          on: () => undefined,
          off: () => undefined,
          getState: () => 'ready',
          configureLandStateForwarding,
          fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
          sendReticulumChatDetailed: async () => ({ ok: true as const }),
          getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
        } as any,
        now: () => 100_000,
      });

      clearTimeout((manager as any).landStateForwardingSyncTimer);
      (manager as any).landStateForwardingSyncTimer = null;
      (manager as any).noteGroupInterestRoute(73, 'peer-origin-a', 'peer-a', 1);
      clearTimeout((manager as any).landStateForwardingSyncTimer);
      (manager as any).landStateForwardingSyncTimer = null;
      const firstApply = (manager as any).applyLandStateForwardingSnapshot();
      await Promise.resolve();
      expect(configureLandStateForwarding).toHaveBeenCalledTimes(1);

      (manager as any).noteGroupInterestRoute(73, 'peer-origin-b', 'peer-b', 1);
      expect((manager as any).landStateForwardingSnapshotDirty).toBe(true);
      resolveFirstSnapshot?.({ ok: true });
      await firstApply;

      await vi.advanceTimersByTimeAsync(249);
      expect(configureLandStateForwarding).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(configureLandStateForwarding).toHaveBeenCalledTimes(2);
      expect(
        configureLandStateForwarding.mock.calls[1]?.[0]?.[0]?.targets
      ).toHaveLength(2);
      expect((manager as any).landStateForwardingSnapshotDirty).toBe(false);
      manager.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an equal-cost group route stable until it fails', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
    });

    (manager as any).noteGroupInterestRoute(73, 'peer-origin', 'peer-a', 1);
    const initialRevision = (manager as any).landStateForwardingRevision;
    (manager as any).noteGroupInterestRoute(73, 'peer-origin', 'peer-b', 1);

    expect((manager as any).landStateForwardingRevision).toBe(
      initialRevision
    );
    expect((manager as any).groupInterestRoutes.get('73:peer-origin')).toEqual(
      expect.objectContaining({ reversePeerHash: 'peer-a', hops: 1 })
    );

    (manager as any).pruneGroupInterestRoutesForNextHop(
      73,
      'peer-a',
      'no-route'
    );
    (manager as any).noteGroupInterestRoute(73, 'peer-origin', 'peer-b', 1);

    expect((manager as any).groupInterestRoutes.get('73:peer-origin')).toEqual(
      expect.objectContaining({ reversePeerHash: 'peer-b', hops: 1 })
    );
    expect((manager as any).landStateForwardingRevision).toBe(
      initialRevision + 2
    );
    manager.close();
  });

  it('dedupes the same Land auth across relay peers and hop counts', async () => {
    const signer = createLandAuthSigner();
    const validateGroupMember = vi.fn(
      async (_groupId: number, address: string) => address === signer.address
    );
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
      validateGroupMember,
    });
    const auth = signer.landAuthWire(73, 'session-relayed', 100_000);

    manager.handleWire({ ...auth, o: 'origin-peer', h: 0 }, 'peer-a');
    await vi.waitFor(() =>
      expect(validateGroupMember).toHaveBeenCalledTimes(1)
    );
    await flushQueuedWork();
    const initialRevision = (manager as any).landStateForwardingRevision;

    manager.handleWire({ ...auth, o: 'origin-peer', h: 3 }, 'peer-b');
    await flushQueuedWork();

    expect(validateGroupMember).toHaveBeenCalledTimes(1);
    expect((manager as any).landStateForwardingRevision).toBe(initialRevision);

    manager.handleWire(
      {
        ...signer.landAuthWire(73, 'session-relayed', 100_001),
        o: 'origin-peer',
        h: 0,
      },
      'peer-a'
    );
    await flushQueuedWork();
    expect(validateGroupMember).toHaveBeenCalledTimes(1);
    expect((manager as any).landStateForwardingRevision).toBe(
      initialRevision + 1
    );
    manager.close();
  });

  it('classifies expired Land auth separately from signature failures', () => {
    const signer = createLandAuthSigner();
    const auth = signer.landAuthWire(73, 'session-expiry', 100_000);

    expect(getReticulumLandAuthRejectionReason(auth, 100_000)).toBeNull();
    expect(getReticulumLandAuthRejectionReason(auth, 220_000)).toBe(
      'expired'
    );
    expect(getReticulumLandAuthRejectionReason(auth, 220_001)).toBe(
      'expired'
    );
    expect(
      getReticulumLandAuthRejectionReason({ ...auth, g: 74 }, 100_000)
    ).toBe('bad_signature');
  });

  it('keeps the newest queued Land auth for a session', () => {
    const signer = createLandAuthSigner();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_100,
    });
    const newer = signer.landAuthWire(73, 'session-queued', 100_100);
    const older = signer.landAuthWire(73, 'session-queued', 100_000);

    (manager as any).enqueueLandAuthWire(newer, 'peer-new');
    (manager as any).enqueueLandAuthWire(older, 'peer-old');

    const queued = [...(manager as any).landAuthItems.values()][0];
    expect(queued.wire.n).toBe(100_100);
    expect(queued.peerHash).toBe('peer-new');
    manager.close();
  });

  it('expires an accepted Land auth from its signed timestamp', async () => {
    const signer = createLandAuthSigner();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 150_000,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });
    const auth = signer.landAuthWire(73, 'session-delayed', 100_000);

    await (manager as any).handleLandAuthWire(auth, 'peer-delayed');

    const session = [...(manager as any).landAuthSessions.values()][0];
    expect(session.authenticatedAt).toBe(100_000);
    expect(session.expiresAt).toBe(220_000);
    manager.close();
  });

  it('relays a QortalLand state when Python used a stale forwarding revision', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const signer = createLandAuthSigner();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });

    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      'peer-a'
    );
    manager.handleWire(
      signer.landAuthWire(73, 'session-stale', 100_000),
      'peer-c'
    );
    await flushQueuedWork();
    direct.length = 0;
    (manager as any).landStateForwardingRevision = 5;
    (manager as any).landStateForwardingAppliedRevision = 5;
    (manager as any).landStateForwardingSnapshotDirty = false;

    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'session-stale',
        sequence: 1,
        x: 50,
        y: 60,
        timestamp: 100_000,
      }),
      'peer-c',
      '',
      true,
      4
    );

    await vi.waitFor(() => {
      expect(direct.some(({ wire }) => wire.k === 'land_state')).toBe(true);
    });

    direct.length = 0;
    (manager as any).landStateForwardingSnapshotDirty = true;
    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'session-stale',
        sequence: 2,
        x: 51,
        y: 61,
        timestamp: 100_000,
      }),
      'peer-c',
      '',
      true,
      5
    );

    await vi.waitFor(() => {
      expect(direct.some(({ wire }) => wire.k === 'land_state')).toBe(true);
    });
    manager.close();
  });

  it('reapplies Land forwarding after a bridge swap interrupts an in-flight snapshot', async () => {
    let resolveOldSnapshot: ((result: { ok: true }) => void) | null = null;
    const oldConfigure = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            resolveOldSnapshot = resolve;
          })
      )
      .mockResolvedValue({ ok: true as const });
    const newConfigure = vi.fn().mockResolvedValue({ ok: true as const });
    const bridgeShape = {
      on: () => undefined,
      off: () => undefined,
      getState: () => 'ready',
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
      getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };
    const oldBridge = {
      ...bridgeShape,
      configureLandStateForwarding: oldConfigure,
    } as any;
    const newBridge = {
      ...bridgeShape,
      configureLandStateForwarding: newConfigure,
    } as any;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: oldBridge,
      now: () => 100_000,
    });

    clearTimeout((manager as any).landStateForwardingSyncTimer);
    (manager as any).landStateForwardingSyncTimer = null;
    const oldApply = (manager as any).applyLandStateForwardingSnapshot();
    await vi.waitFor(() => expect(oldConfigure).toHaveBeenCalledTimes(1));

    manager.setBridge(newBridge);
    await new Promise((resolve) => setImmediate(resolve));
    expect(newConfigure).not.toHaveBeenCalled();

    expect(resolveOldSnapshot).not.toBeNull();
    resolveOldSnapshot?.({ ok: true });
    await oldApply;
    await vi.waitFor(() => expect(newConfigure).toHaveBeenCalledTimes(1));

    manager.close();
  });

  it('verifies different QortalLand sessions concurrently while serializing and coalescing each session', async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const signer = createLandAuthSigner();
    const pending: Array<{
      task: Record<string, unknown>;
      resolve: (result: Record<string, unknown>) => void;
    }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });
    (manager as any).landStateWorkerPool = {
      run: vi.fn(
        (task: Record<string, unknown>) =>
          new Promise<Record<string, unknown>>((resolve) => {
            pending.push({ task, resolve });
          })
      ),
      stats: () => ({
        pending: pending.length,
        workers: 2,
        fallbackCount: 0,
        crashCount: 0,
      }),
      stop: vi.fn(),
    };

    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    manager.on('landState', (payload) =>
      emitted.push(payload as Record<string, unknown>)
    );
    manager.handleWire(signer.landAuthWire(73, 'session-1', 100_000), 'peer-a');
    manager.handleWire(signer.landAuthWire(73, 'session-2', 100_000), 'peer-a');
    await flushQueuedWork();

    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'session-1',
        sequence: 1,
        x: 100,
        y: 100,
        timestamp: 100_000,
      }),
      'peer-a'
    );
    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'session-2',
        sequence: 1,
        x: 200,
        y: 200,
        timestamp: 100_000,
      }),
      'peer-a'
    );
    await flushQueuedWork(2);
    expect(pending).toHaveLength(2);

    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'session-1',
        sequence: 2,
        x: 101,
        y: 101,
        timestamp: 100_000,
      }),
      'peer-a'
    );
    manager.handleWire(
      signer.landStateWire({
        groupId: 73,
        sessionId: 'session-1',
        sequence: 3,
        x: 102,
        y: 102,
        timestamp: 100_000,
      }),
      'peer-a'
    );
    await flushQueuedWork(2);
    expect(pending).toHaveLength(2);

    pending[1].resolve({
      id: 2,
      ok: true,
      kind: 'verify_land_state_signature',
      valid: true,
      prepMs: 1,
    });
    await flushQueuedWork(2);
    expect(pending).toHaveLength(2);

    pending[0].resolve({
      id: 1,
      ok: true,
      kind: 'verify_land_state_signature',
      valid: true,
      prepMs: 1,
    });
    await flushQueuedWork(2);
    expect(pending).toHaveLength(3);
    pending[2].resolve({
      id: 3,
      ok: true,
      kind: 'verify_land_state_signature',
      valid: true,
      prepMs: 1,
    });
    await flushQueuedWork(2);

    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: 'session-1', sequence: 1 }),
        expect.objectContaining({ sessionId: 'session-1', sequence: 3 }),
        expect.objectContaining({ sessionId: 'session-2', sequence: 1 }),
      ])
    );
    expect(emitted).not.toContainEqual(
      expect.objectContaining({ sessionId: 'session-1', sequence: 2 })
    );
    manager.close();
  });

  it('answers QortalLand auth requests for active local movement sessions', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const fanout: Array<Record<string, unknown>> = [];
    const signer = createLandAuthSigner();
    const peerA = 'bbbbbbbbbbbbbbbb';
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
      signLocalFields: signer.signLocalFields,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });

    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [73], mode: 'summary' },
      peerA
    );
    await flushQueuedWork();

    await manager.sendLandState(73, signer.address, {
      sessionId: 'session-1',
      sequence: 1,
      x: 20,
      y: 30,
      roomId: 'club',
      direction: 'r',
      movement: 'walk',
      afk: true,
      dnd: false,
      skinId: 4,
    });
    await flushQueuedWork();
    const outboundWires = [...direct.map(({ wire }) => wire), ...fanout];
    const authWire = outboundWires.find((wire) => wire.k === 'land_auth');
    const stateWire = outboundWires.find((wire) => wire.k === 'land_state');
    expect(authWire?.e).toEqual(expect.any(String));
    expect(stateWire?.z).toEqual(expect.any(String));
    expect(
      nacl.sign.detached.verify(
        new Uint8Array(
          canonicalizeForSigning(
            buildReticulumLandStateSignedFields({
              groupId: 73,
              authorAddress: signer.address,
              sessionId: 'session-1',
              sequence: 1,
              x: 20,
              y: 30,
              roomId: 'club',
              direction: 'r',
              movement: 'walk',
              afk: true,
              dnd: false,
              skinId: 4,
              timestamp: Number(stateWire?.ts),
            })
          )
        ),
        new Uint8Array(base58Decode(String(stateWire?.z))),
        new Uint8Array(base58Decode(String(authWire?.e)))
      )
    ).toBe(true);
    expect(stateWire).toEqual(expect.objectContaining({ v: 1, i: 4 }));
    expect(stateWire).not.toHaveProperty('af');
    expect(stateWire).not.toHaveProperty('dn');
    direct.length = 0;
    fanout.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'land_auth_req',
        g: 73,
        a: signer.address,
        s: 'session-1',
      },
      peerA
    );
    await Promise.resolve();
    await Promise.resolve();

    await flushQueuedWork();
    expect(
      direct.some(
        ({ peer, wire }) =>
          peer === peerA &&
          wire.t === 'RCHAT' &&
          wire.k === 'land_auth' &&
          wire.g === 73 &&
          wire.s === 'session-1' &&
          wire.p === signer.publicKey
      )
    ).toBe(true);
    expect(fanout).toHaveLength(0);
    expect((manager as any).localLandAuthSessions.size).toBe(1);
    manager.unsubscribeGroup(73);
    expect((manager as any).localLandAuthSessions.size).toBe(0);
    expect((manager as any).localLandAuthSentAt.size).toBe(0);
    expect((manager as any).localLandAuthSessionTimers.size).toBe(0);
    manager.close();
  });

  it('releases idle native QortalLand session keys after their session TTL', async () => {
    vi.useFakeTimers();
    let now = 100_000;
    const signer = createLandAuthSigner();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => now,
      signLocalFields: signer.signLocalFields,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });

    try {
      manager.setLocalGroupMemberships([73]);
      manager.subscribeGroup(73);
      await manager.sendLandState(73, signer.address, {
        sessionId: 'idle-session',
        sequence: 1,
        x: 20,
        y: 30,
      });
      expect((manager as any).localLandAuthSessions.size).toBe(1);
      expect((manager as any).localLandAuthSessionTimers.size).toBe(1);

      now += 2 * 60_000 + 1;
      await vi.advanceTimersByTimeAsync(2 * 60_000 + 1);

      expect((manager as any).localLandAuthSessions.size).toBe(0);
      expect((manager as any).localLandAuthSentAt.size).toBe(0);
      expect((manager as any).localLandAuthSessionTimers.size).toBe(0);
    } finally {
      manager.close();
      vi.useRealTimers();
    }
  });

  it('does not recreate a native QortalLand session after unsubscribe during validation', async () => {
    const signer = createLandAuthSigner();
    let resolveMembership: ((value: boolean) => void) | null = null;
    const sent: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          sent.push(...messages);
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      signLocalFields: signer.signLocalFields,
      validateGroupMember: async () =>
        new Promise<boolean>((resolve) => {
          resolveMembership = resolve;
        }),
    });

    try {
      manager.setLocalGroupMemberships([
        { groupId: 73, localAddress: signer.address },
      ]);
      manager.subscribeGroup(73);
      sent.length = 0;
      const pending = manager.sendLandState(73, signer.address, {
        sessionId: 'pending-session',
        sequence: 1,
        x: 20,
        y: 30,
      });
      await Promise.resolve();
      expect(resolveMembership).not.toBeNull();

      manager.unsubscribeGroup(73);
      resolveMembership?.(true);

      await expect(pending).rejects.toThrow('signing context changed');
      expect((manager as any).localLandAuthSessions.size).toBe(0);
      expect((manager as any).localLandAuthSentAt.size).toBe(0);
      expect((manager as any).localLandAuthSessionTimers.size).toBe(0);
      expect(
        sent.some((wire) => wire.k === 'land_auth' || wire.k === 'land_state')
      ).toBe(false);
    } finally {
      manager.close();
    }
  });

  it('discards a native QortalLand session when the signer changes during auth signing', async () => {
    const signer = createLandAuthSigner();
    const validateGroupMember = async (_groupId: number, address: string) =>
      address === signer.address;
    let releaseSigning: (() => void) | null = null;
    let markSigningStarted: (() => void) | null = null;
    const signingStarted = new Promise<void>((resolve) => {
      markSigningStarted = resolve;
    });
    const signingGate = new Promise<void>((resolve) => {
      releaseSigning = resolve;
    });
    const sent: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          sent.push(...messages);
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      signLocalFields: async (fields) => {
        markSigningStarted?.();
        await signingGate;
        return signer.signLocalFields(fields);
      },
      validateGroupMember,
    });

    try {
      manager.setLocalGroupMemberships([
        { groupId: 73, localAddress: signer.address },
      ]);
      manager.subscribeGroup(73);
      sent.length = 0;
      const pending = manager.sendLandState(73, signer.address, {
        sessionId: 'changing-signer',
        sequence: 1,
        x: 20,
        y: 30,
      });
      await signingStarted;

      manager.setRuntimeCallbacks({
        signLocalFields: signer.signLocalFields,
        validateGroupMember,
      });
      releaseSigning?.();

      await expect(pending).rejects.toThrow('signing context changed');
      expect((manager as any).localLandAuthSessions.size).toBe(0);
      expect((manager as any).localLandAuthSentAt.size).toBe(0);
      expect((manager as any).localLandAuthSessionTimers.size).toBe(0);
      expect(
        sent.some((wire) => wire.k === 'land_auth' || wire.k === 'land_state')
      ).toBe(false);
    } finally {
      releaseSigning?.();
      manager.close();
    }
  });

  it('bounds native QortalLand session keys and expiry timers during session churn', async () => {
    let now = 100_000;
    const signer = createLandAuthSigner();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => now,
      signLocalFields: signer.signLocalFields,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });

    try {
      manager.setLocalGroupMemberships([
        { groupId: 73, localAddress: signer.address },
      ]);
      manager.subscribeGroup(73);
      for (let index = 0; index < 65; index += 1) {
        await manager.sendLandState(73, signer.address, {
          sessionId: `churn-${index}`,
          sequence: 1,
          x: 20,
          y: 30,
        });
        now += 1;
      }

      expect((manager as any).localLandAuthSessions.size).toBe(64);
      expect((manager as any).localLandAuthSentAt.size).toBe(64);
      expect((manager as any).localLandAuthSessionTimers.size).toBe(64);
      expect(
        (manager as any).localLandAuthSessions.has(
          `73:${signer.address}:churn-0`
        )
      ).toBe(false);
      expect(
        (manager as any).localLandAuthSessions.has(
          `73:${signer.address}:churn-64`
        )
      ).toBe(true);
    } finally {
      manager.close();
    }
  });

  it('delivers a signed QortalLand call only to its exact verified Land session endpoint', async () => {
    const caller = createDmIdentity();
    const recipient = createLandAuthSigner();
    const sourceDestinationHash = '1'.repeat(32);
    const targetDestinationHash = '2'.repeat(32);
    const sourceSessionId = '1'.repeat(16);
    const targetSessionId = '2'.repeat(16);
    const timestamp = Date.now();
    const callId = 'land-call-v2-1234';
    const signedFields = buildReticulumLandCallV2SignedFields({
      groupId: 73,
      callType: 'request',
      callId,
      fromAddress: caller.address,
      fromPublicKey: caller.publicKey,
      toAddress: recipient.address,
      sourceSessionId,
      targetSessionId,
      sourceDestinationHash,
      targetDestinationHash,
      roomId: 'lounge',
      timestamp,
    });
    const signature = base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(signedFields)),
        caller.secretKey
      )
    );
    const wire: Extract<ReticulumChatWire, { k: 'lc2' }> = {
      t: 'RCHAT',
      k: 'lc2',
      g: 73,
      y: 'q',
      c: callId,
      b: recipient.address,
      f: Buffer.from(sourceSessionId, 'hex')
        .toString('base64url')
        .replace(/=+$/g, ''),
      j: Buffer.from(targetSessionId, 'hex')
        .toString('base64url')
        .replace(/=+$/g, ''),
      p: caller.publicKey,
      z: signature,
      u: 'lounge',
      s: timestamp,
    };
    expect(
      verifyReticulumLandCallV2Wire(wire, timestamp, {
        sourceDestinationHash,
        targetDestinationHash,
      })
    ).toEqual(
      expect.objectContaining({
        fromAddress: caller.address,
        toAddress: recipient.address,
        sourceSessionId,
        targetSessionId,
        sourceDestinationHash,
        targetDestinationHash,
      })
    );
    expect(byteLengthUtf8JsonWithBridgeSenderOnly(wire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );

    // The bridge always stamps `r` with the authenticated sender endpoint.
    // That transport metadata must not overwrite any signed Land call field.
    const transportedWire = {
      ...wire,
      r: sourceDestinationHash,
    } as Extract<ReticulumChatWire, { k: 'lc2' }>;
    expect(
      verifyReticulumLandCallV2Wire(transportedWire, timestamp, {
        sourceDestinationHash,
        targetDestinationHash,
      })
    ).toEqual(
      expect.objectContaining({
        sourceSessionId,
        targetSessionId,
      })
    );

    const emitted: Array<Record<string, unknown>> = [];
    const direct: Array<{
      peer: string;
      wire: Extract<ReticulumChatWire, { k: 'lc2' }>;
    }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => targetDestinationHash,
        sendReticulumChatDetailed: async (
          peer: string,
          outgoingWire: Extract<ReticulumChatWire, { k: 'lc2' }>
        ) => {
          direct.push({ peer, wire: outgoingWire });
          return { ok: true as const };
        },
      } as any,
      // Direct calls authenticate their source through the wallet signature
      // and actual Reticulum ingress endpoint, even if the general peer cache
      // has not learned the reverse address mapping yet.
      getVerifiedReticulumPeers: () => [],
      now: () => timestamp,
      signLocalFields: recipient.signLocalFields,
      validateGroupMember: async (_groupId, address) =>
        address === caller.address || address === recipient.address,
    });
    try {
      manager.setLocalGroupMemberships([
        { groupId: 73, localAddress: recipient.address },
      ]);
      manager.subscribeGroup(73);
      (manager as any).localLandAuthSessions.set(
        `73:${recipient.address}:${targetSessionId}`,
        {
          authorAddress: recipient.address,
          groupId: 73,
          sessionId: targetSessionId,
          lastUsedAt: timestamp,
        }
      );
      manager.on('landCall', (payload) =>
        emitted.push(payload as Record<string, unknown>)
      );

      // A relayed copy from the wrong endpoint must neither deliver nor poison
      // dedupe for the subsequent authentic direct delivery.
      manager.handleWire(transportedWire, '3'.repeat(32));
      await flushQueuedWork();
      expect(emitted).toHaveLength(0);

      manager.handleWire(transportedWire, sourceDestinationHash);
      await flushQueuedWork();
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(
        expect.objectContaining({
          callType: 'request',
          callId,
          sourceSessionId,
          targetSessionId,
          sourceDestinationHash,
          targetDestinationHash,
        })
      );
      expect(
        manager.getActiveLandCallMediaPeerDestinationHash(
          `direct:${[caller.address, recipient.address].sort().join(':')}`,
          recipient.address,
          callId
        )
      ).toBe(sourceDestinationHash);

      manager.handleWire(transportedWire, sourceDestinationHash);
      await flushQueuedWork();
      expect(emitted).toHaveLength(1);

      // The independent Land route announcement may be missed or expire while
      // the incoming call is still ringing. Its signed request and
      // authenticated ingress endpoint are already sufficient to reply to the
      // exact caller selected by this call.
      expect((manager as any).landSessionRoutes.size).toBe(0);
      const accept = await manager.sendLandCall(73, {
        callType: 'accept',
        callId,
        fromAddress: recipient.address,
        toAddress: caller.address,
        sourceSessionId: targetSessionId,
        targetSessionId: sourceSessionId,
        targetDestinationHash: sourceDestinationHash,
        timestamp,
      });
      expect(accept).toEqual({ ok: true });
      expect(direct).toContainEqual(
        expect.objectContaining({
          peer: sourceDestinationHash,
          wire: expect.objectContaining({ k: 'lc2', y: 'a', c: callId }),
        })
      );
    } finally {
      manager.close();
    }
  });

  it('keeps worst-case direct QortalLand call controls below the encrypted MDU', () => {
    const wire: Extract<ReticulumChatWire, { k: 'lc2' }> = {
      t: 'RCHAT',
      k: 'lc2',
      g: Number.MAX_SAFE_INTEGER,
      y: 'q',
      c: 'c'.repeat(16),
      b: 'Q'.repeat(34),
      f: 's'.repeat(11),
      j: 't'.repeat(11),
      p: 'p'.repeat(44),
      z: 'z'.repeat(88),
      s: 9_999_999_999_999,
    };

    expect(byteLengthUtf8JsonWithBridgeSenderOnly(wire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    expect(
      byteLengthUtf8JsonWithBridgeSenderOnly({ ...wire, u: 'club' })
    ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    // This packet intentionally has no X/L: it is sent to one authenticated
    // endpoint and is not an overlay-fanout control.
    expect(byteLengthUtf8JsonWithBridgeSender(wire)).toBeGreaterThan(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
  });

  it('signs and sends a QortalLand call directly to the selected session endpoint', async () => {
    const caller = createLandAuthSigner();
    const recipient = createLandAuthSigner();
    const sourceDestinationHash = '1'.repeat(32);
    const targetDestinationHash = '2'.repeat(32);
    const sourceSessionId = '1'.repeat(16);
    const targetSessionId = '2'.repeat(16);
    const timestamp = 1_785_329_927_285;
    const direct: Array<{
      peer: string;
      wire: Extract<ReticulumChatWire, { k: 'lc2' }>;
    }> = [];
    const fanout: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => sourceDestinationHash,
        fanoutReticulumChatDetailed: async (
          messages: Array<Record<string, unknown>>
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Extract<ReticulumChatWire, { k: 'lc2' }>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      getVerifiedReticulumPeers: () => [
        {
          destinationHash: targetDestinationHash,
          address: recipient.address,
          lastSeen: timestamp,
        },
      ],
      now: () => timestamp,
      signLocalFields: caller.signLocalFields,
      validateGroupMember: async (_groupId, address) =>
        address === caller.address || address === recipient.address,
    });
    try {
      manager.setLocalGroupMemberships([
        { groupId: 73, localAddress: caller.address },
      ]);
      manager.subscribeGroup(73);
      await manager.sendLandState(73, caller.address, {
        sessionId: sourceSessionId,
        sequence: 1,
        x: 10,
        y: 20,
      });
      direct.length = 0;
      const targetRouteWire = recipient.landRouteWire(
        73,
        targetSessionId,
        targetDestinationHash,
        timestamp
      );
      expect(
        verifyReticulumLandSessionRouteWire(targetRouteWire, timestamp)
      ).toEqual(
        expect.objectContaining({
          authorAddress: recipient.address,
          destinationHash: targetDestinationHash,
        })
      );
      manager.handleWire(targetRouteWire, targetDestinationHash);
      await vi.waitFor(
        () =>
          expect(
            (manager as any).landSessionRoutes.get(
              `73:${recipient.address}:${targetSessionId}`
            )
          ).toEqual(
            expect.objectContaining({
              destinationHash: targetDestinationHash,
            })
          ),
        { timeout: 2_000, interval: 10 }
      );
      fanout.length = 0;

      const result = await manager.sendLandCall(73, {
        callType: 'request',
        callId: 'a'.repeat(16),
        fromAddress: caller.address,
        toAddress: recipient.address,
        sourceSessionId,
        targetSessionId,
        targetDestinationHash,
        roomId: 'lounge',
        timestamp,
      });

      expect(result).toEqual({ ok: true });
      expect(fanout).toHaveLength(0);
      expect(direct).toHaveLength(1);
      expect(direct[0].peer).toBe(targetDestinationHash);
      expect(direct[0].wire).not.toHaveProperty('u');
      expect(direct[0].wire).not.toHaveProperty('n');
      expect(
        verifyReticulumLandCallV2Wire(direct[0].wire, timestamp, {
          sourceDestinationHash,
          targetDestinationHash,
        })
      ).toEqual(
        expect.objectContaining({
          fromAddress: caller.address,
          toAddress: recipient.address,
          sourceSessionId,
          targetSessionId,
          reason: '',
          roomId: '',
        })
      );
      expect(
        byteLengthUtf8JsonWithBridgeSender(direct[0].wire)
      ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
      const chatId = `direct:${[caller.address, recipient.address]
        .sort()
        .join(':')}`;
      expect(
        manager.getActiveLandCallMediaPeerDestinationHash(
          chatId,
          caller.address,
          'a'.repeat(16)
        )
      ).toBe(targetDestinationHash);

      const hangup = await manager.sendLandCall(73, {
        callType: 'hangup',
        callId: 'a'.repeat(16),
        fromAddress: caller.address,
        toAddress: recipient.address,
        sourceSessionId,
        targetSessionId,
        targetDestinationHash,
        timestamp,
      });
      expect(hangup).toEqual({ ok: true });
      expect(
        manager.getActiveLandCallMediaPeerDestinationHash(
          chatId,
          caller.address,
          'a'.repeat(16)
        )
      ).toBeNull();
    } finally {
      manager.close();
    }
  });

  it('retries low-frequency QortalLand auth and route controls after transient transport loss', async () => {
    vi.useFakeTimers();
    const signer = createLandAuthSigner();
    const sentKinds: string[] = [];
    let authFailuresRemaining = 1;
    let routeFailuresRemaining = 1;
    let currentNow = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        fanoutReticulumChatDetailed: async (
          messages: Array<Record<string, unknown>>
        ) => {
          const kind = String(messages[0]?.k || '');
          sentKinds.push(kind);
          if (kind === 'land_auth' && authFailuresRemaining-- > 0) {
            return { ok: false as const, reason: 'bridge-overloaded' as const };
          }
          if (kind === 'land_route_v1' && routeFailuresRemaining-- > 0) {
            return { ok: false as const, reason: 'no-route' as const };
          }
          return { ok: true as const };
        },
      } as any,
      now: () => currentNow,
      signLocalFields: signer.signLocalFields,
      validateGroupMember: async (_groupId, address) =>
        address === signer.address,
    });
    try {
      manager.setLocalGroupMemberships([
        { groupId: 73, localAddress: signer.address },
      ]);
      manager.subscribeGroup(73);
      await manager.sendLandState(73, signer.address, {
        sessionId: 'retry-session',
        sequence: 1,
        x: 10,
        y: 20,
      });
      await flushAsyncWork(16);

      expect(sentKinds.filter((kind) => kind === 'land_auth')).toHaveLength(1);
      expect(sentKinds.filter((kind) => kind === 'land_route_v1')).toHaveLength(
        1
      );

      currentNow += 3_000;
      await vi.advanceTimersByTimeAsync(3_000);
      await flushAsyncWork(16);
      expect(sentKinds.filter((kind) => kind === 'land_auth')).toHaveLength(2);
      expect(sentKinds.filter((kind) => kind === 'land_route_v1')).toHaveLength(
        2
      );
    } finally {
      manager.close();
      vi.useRealTimers();
    }
  });

  it('accepts compact QortalLand call requests and rejections and dedupes relay copies', async () => {
    const caller = createDmIdentity();
    const recipient = createDmIdentity();
    const emitted: Array<Record<string, unknown>> = [];
    const sent: Array<Record<string, unknown>> = [];
    const callId = 'abcdefghijklmnopqrst';
    const timestamp = Date.now();
    const chatId = `direct:${[caller.address, recipient.address].sort().join(':')}`;
    const signature = base58Encode(
      nacl.sign.detached(
        new Uint8Array(
          canonicalizeForSigning({
            type: 'CALL_REQUEST',
            callId,
            chatId,
            fromAddress: caller.address,
            fromPublicKey: caller.publicKey,
            timestamp,
          })
        ),
        caller.secretKey
      )
    );
    const wire: ReticulumChatWire = {
      t: 'RCHAT',
      k: 'lc',
      g: 73,
      y: 'q',
      c: callId,
      b: recipient.address,
      p: caller.publicKey,
      z: signature,
      s: timestamp,
      o: 'bbbbbbbbbbbbbbbb',
      h: 0,
    };
    expect(byteLengthUtf8JsonWithBridgeSender(wire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    expect(
      nacl.sign.detached.verify(
        new Uint8Array(
          canonicalizeForSigning({
            type: 'CALL_REQUEST',
            callId,
            chatId,
            fromAddress: caller.address,
            fromPublicKey: caller.publicKey,
            timestamp,
          })
        ),
        base58Decode(signature),
        base58Decode(caller.publicKey)
      )
    ).toBe(true);
    expect(
      verifyCallRequestDetached(
        {
          type: 'CALL_REQUEST',
          callId,
          chatId,
          fromAddress: caller.address,
          fromPublicKey: caller.publicKey,
          timestamp,
        },
        signature,
        caller.publicKey
      )
    ).toBe(true);

    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Array<Record<string, unknown>>
        ) => {
          sent.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          _targetPeer: string,
          message: Record<string, unknown>
        ) => {
          sent.push(message);
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => timestamp,
      validateGroupMember: async (_groupId, address) =>
        address === caller.address || address === recipient.address,
    });

    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    manager.on('landCall', (payload) => {
      emitted.push(payload as Record<string, unknown>);
    });
    manager.handleWire(wire, 'bbbbbbbbbbbbbbbb');
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(
      expect.objectContaining({
        groupId: 73,
        callType: 'request',
        callId,
        fromAddress: caller.address,
        toAddress: recipient.address,
        chatId,
        fromPublicKey: caller.publicKey,
        signature,
        timestamp,
      })
    );

    manager.handleWire(
      {
        ...wire,
        o: 'cccccccccccccccc',
        h: 3,
      },
      'cccccccccccccccc'
    );
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(emitted).toHaveLength(1);

    const rejectTimestamp = timestamp + 1;
    const rejectSignature = base58Encode(
      nacl.sign.detached(
        new Uint8Array(
          canonicalizeForSigning({
            type: 'CALL_REJECT',
            callId,
            timestamp: rejectTimestamp,
          })
        ),
        recipient.secretKey
      )
    );
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'lc',
        g: 73,
        y: 'j',
        c: callId,
        b: caller.address,
        p: recipient.publicKey,
        z: rejectSignature,
        s: rejectTimestamp,
        o: 'cccccccccccccccc',
        h: 0,
      },
      'cccccccccccccccc'
    );
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual(
      expect.objectContaining({
        groupId: 73,
        callType: 'reject',
        callId,
        fromAddress: recipient.address,
        toAddress: caller.address,
        chatId,
        fromPublicKey: recipient.publicKey,
        signature: rejectSignature,
        timestamp: rejectTimestamp,
      })
    );

    const sendResult = await manager.sendLandCall(73, {
      callType: 'reject',
      callId,
      fromAddress: recipient.address,
      toAddress: caller.address,
      fromPublicKey: recipient.publicKey,
      signature: rejectSignature,
      timestamp: rejectTimestamp,
    });
    expect(sendResult.ok).toBe(true);
    expect(sent).toContainEqual(
      expect.objectContaining({
        k: 'lc',
        y: 'j',
        c: callId,
        b: caller.address,
        p: recipient.publicKey,
        z: rejectSignature,
        s: rejectTimestamp,
      })
    );
    manager.close();
  });

  it('forwards one QortalLand control per next hop without route flapping across duplicate mesh paths', async () => {
    const now = 100_000;
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const emitted: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => now,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([73]);
    manager.subscribeGroup(73);
    manager.on('landCall', (payload) => {
      emitted.push(payload as Record<string, unknown>);
    });

    const routes = (manager as any).groupInterestRoutes as Map<
      string,
      Record<string, unknown>
    >;
    const addRoute = (origin: string, reversePeerHash: string): void => {
      routes.set(`73:${origin}`, {
        groupId: 73,
        originPeerHash: origin,
        reversePeerHash,
        hops: 1,
        expiresAt: now + 60_000,
      });
    };
    addRoute('route-origin-one', 'peer-next-hop');
    addRoute('route-origin-two', 'peer-next-hop');
    addRoute('route-origin-three', 'peer-other-hop');
    const chatControlDedupe = (manager as any).forwardedGroupControlKeys as Map<
      string,
      number
    >;
    chatControlDedupe.set('history-control-sentinel', now + 60_000);
    const chatInboundDedupe = (manager as any).recentInboundControlWires as Map<
      string,
      number
    >;
    chatInboundDedupe.set('history-inbound-sentinel', now);

    const wire = {
      t: 'RCHAT',
      k: 'lc',
      g: 73,
      y: 'g',
      c: 'game-match-id',
      a: 'QplayerOne',
      b: 'QplayerTwo',
      u: 'park',
      s: now,
      r: 'bbbbbbbbbbbbbbbb',
      o: 'bbbbbbbbbbbbbbbb',
      h: 0,
    };
    const initialForwardingRevision = (manager as any)
      .landStateForwardingRevision;
    manager.handleWire(wire, 'peer-inbound-one');
    await flushAsyncWork();

    expect(direct.map(({ peer }) => peer).sort()).toEqual([
      'peer-next-hop',
      'peer-other-hop',
    ]);
    expect(emitted).toHaveLength(1);
    expect((manager as any).landStateForwardingRevision).toBe(
      initialForwardingRevision
    );
    expect([...chatControlDedupe.keys()]).toEqual(['history-control-sentinel']);
    expect([...chatInboundDedupe.keys()]).toEqual(['history-inbound-sentinel']);
    expect((manager as any).recentInboundLandControlWires.size).toBe(1);
    expect((manager as any).forwardedLandControlKeys.size).toBe(2);
    expect(
      new Set((manager as any).forwardedLandControlKeys.values())
    ).toEqual(new Set([now + 8_000]));

    manager.handleWire(
      { ...wire, o: 'bbbbbbbbbbbbbbbb', h: 3 },
      'peer-inbound-two'
    );
    await flushAsyncWork();
    expect(direct).toHaveLength(2);
    expect(emitted).toHaveLength(1);
    expect((manager as any).landStateForwardingRevision).toBe(
      initialForwardingRevision
    );

    addRoute('route-origin-four', 'peer-late-hop');
    manager.handleWire(
      { ...wire, o: 'bbbbbbbbbbbbbbbb', h: 2 },
      'peer-inbound-three'
    );
    await flushAsyncWork();
    expect(direct.map(({ peer }) => peer).sort()).toEqual([
      'peer-late-hop',
      'peer-next-hop',
      'peer-other-hop',
    ]);
    expect(emitted).toHaveLength(1);
    expect([...chatControlDedupe.keys()]).toEqual(['history-control-sentinel']);
    expect((manager as any).forwardedLandControlKeys.size).toBe(3);
    manager.close();
  });

  it('does not forward stale or invalid-hop QortalLand controls', async () => {
    const now = 500_000;
    const direct: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          _peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push(wire);
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => now,
      validateGroupMember: async () => true,
    });
    const routes = (manager as any).groupInterestRoutes as Map<
      string,
      Record<string, unknown>
    >;
    routes.set('73:route-origin', {
      groupId: 73,
      originPeerHash: 'route-origin',
      reversePeerHash: 'peer-next-hop',
      hops: 1,
      expiresAt: now + 60_000,
    });
    const wire = {
      t: 'RCHAT',
      k: 'lc',
      g: 73,
      y: 'g',
      c: 'game-match-id',
      a: 'QplayerOne',
      b: 'QplayerTwo',
      s: now - 2 * 60_000 - 1,
      r: 'bbbbbbbbbbbbbbbb',
      o: 'bbbbbbbbbbbbbbbb',
      h: 0,
    };
    manager.handleWire(wire, 'peer-inbound');
    manager.handleWire({ ...wire, s: now, h: 9 }, 'peer-inbound');
    await flushAsyncWork();
    expect(direct).toHaveLength(0);
    manager.close();
  });

  it('bounds QortalLand relay dedupe without evicting chat control state', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => 100_000,
    });
    const landDedupe = (manager as any).forwardedLandControlKeys as Map<
      string,
      number
    >;
    const chatDedupe = (manager as any).forwardedGroupControlKeys as Map<
      string,
      number
    >;
    const inboundLandDedupe = (manager as any)
      .recentInboundLandControlWires as Map<string, number>;
    const inboundChatDedupe = (manager as any).recentInboundControlWires as Map<
      string,
      number
    >;
    chatDedupe.set('history-control-sentinel', 200_000);
    inboundChatDedupe.set('history-inbound-sentinel', 100_000);
    for (let index = 0; index < 32_768; index += 1) {
      landDedupe.set(`old-land-control-${index}`, 200_000);
      inboundLandDedupe.set(`old-inbound-land-control-${index}`, 100_000);
    }
    (manager as any).lastInboundLandControlPruneAt = 100_000;

    (manager as any).rememberForwardedLandControl('new-land-control', 200_000);
    expect(
      (manager as any).shouldDropRecentInboundLandControl(
        'new-inbound-land-control'
      )
    ).toBe(false);

    expect(landDedupe.size).toBe(32_768);
    expect(landDedupe.has('old-land-control-0')).toBe(false);
    expect(landDedupe.has('new-land-control')).toBe(true);
    expect(inboundLandDedupe.size).toBe(32_768);
    expect(inboundLandDedupe.has('old-inbound-land-control-0')).toBe(false);
    expect(inboundLandDedupe.has('new-inbound-land-control')).toBe(true);
    expect([...chatDedupe.keys()]).toEqual(['history-control-sentinel']);
    expect([...inboundChatDedupe.keys()]).toEqual(['history-inbound-sentinel']);
    manager.close();
  });

  it('recovers QortalLand dedupe after the system clock moves backward', () => {
    let now = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => now,
    });

    (manager as any).pruneLandControlRoutes();
    (manager as any).rememberForwardedLandControl(
      'forwarded-control',
      now + 8_000
    );
    expect(
      (manager as any).shouldDropRecentInboundLandControl('inbound-control')
    ).toBe(false);
    expect(
      (manager as any).shouldDropRecentInboundLandControl('inbound-control')
    ).toBe(true);

    now = 90_000;
    (manager as any).pruneLandControlRoutes();

    expect((manager as any).forwardedLandControlKeys.size).toBe(0);
    expect(
      (manager as any).shouldDropRecentInboundLandControl('inbound-control')
    ).toBe(false);
    manager.close();
  });

  it('accepts compact QortalLand game presence and ended signals', async () => {
    const player = createDmIdentity();
    const opponent = createDmIdentity();
    const emitted: Array<Record<string, unknown>> = [];
    const sent: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Array<Record<string, unknown>>
        ) => {
          sent.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
      validateGroupMember: async (_groupId, address) =>
        address === player.address || address === opponent.address,
    });

    manager.setLocalGroupMemberships([
      { groupId: 73, localAddress: player.address },
    ]);
    manager.subscribeGroup(73);
    const sendResult = await manager.sendLandCall(73, {
      callType: 'game_status',
      callId: 'game-match-id',
      fromAddress: player.address,
      toAddress: opponent.address,
      roomId: 'park',
      timestamp: 100_000,
    });
    expect(sendResult.ok).toBe(true);
    expect(sent).toContainEqual(
      expect.objectContaining({
        k: 'lc',
        y: 'g',
        c: 'game-match-id',
        a: player.address,
        b: opponent.address,
        u: 'park',
      })
    );
    manager.on('landCall', (payload) => {
      emitted.push(payload as Record<string, unknown>);
    });

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'lc',
        g: 73,
        y: 'g',
        c: 'game-match-id',
        a: player.address,
        b: opponent.address,
        u: 'park',
        s: 100_000,
      },
      'bbbbbbbbbbbbbbbb'
    );
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'lc',
        g: 73,
        y: 'x',
        c: 'game-match-id',
        a: player.address,
        b: opponent.address,
        u: 'park',
        s: 100_000,
      },
      'bbbbbbbbbbbbbbbb'
    );
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(emitted).toEqual([
      expect.objectContaining({
        callType: 'game_status',
        callId: 'game-match-id',
        fromAddress: player.address,
        toAddress: opponent.address,
        roomId: 'park',
      }),
      expect.objectContaining({
        callType: 'game_ended',
        callId: 'game-match-id',
        fromAddress: player.address,
        toAddress: opponent.address,
        roomId: 'park',
      }),
    ]);
    manager.close();
  });

  it('requests missing QortalLand auth directly from the inbound relay peer without fanout', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const fanout: Array<Record<string, unknown>> = [];
    const signer = createLandAuthSigner();
    const inboundPeer = 'bbbbbbbbbbbbbbbb';
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
        getLocalDestinationHash: () => 'aaaaaaaaaaaaaaaa',
      } as any,
      now: () => 100_000,
    });

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'land_state',
        g: 73,
        a: signer.address,
        s: 'session-1',
        q: 6,
        x: 511,
        y: 419,
        d: 'r',
        m: 'walk',
        ts: 100_000,
        z: 'unsigned',
      },
      inboundPeer
    );
    await flushQueuedWork();

    expect(direct).toEqual([
      {
        peer: inboundPeer,
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'land_auth_req',
          g: 73,
          a: signer.address,
          s: 'session-1',
        }),
      },
    ]);
    expect(fanout).toHaveLength(0);
    manager.close();
  });

  it('relays event requests and routes event offers back to the origin', async () => {
    const fanout: Array<Record<string, unknown>> = [];
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });
    const request = signedEventRequestWire({
      groupId: 74,
      eventId: 'event-relay-74',
      timestamp: 100_000,
    });

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [74], mode: 'summary' },
      'peer-a'
    );
    fanout.length = 0;
    manager.handleWire(
      { t: 'RCHAT', k: 'event_req', g: 74, q: request },
      'peer-a'
    );
    await Promise.resolve();

    const relayedRequest = fanout.find((wire) => wire.k === 'event_req') as any;
    expect(relayedRequest).toMatchObject({
      t: 'RCHAT',
      k: 'event_req',
      g: 74,
      o: 'peer-a',
      h: 1,
    });

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_offer',
        g: 74,
        o: {
          x: 'transfer-relay-74',
          id: 'event-relay-74',
          ph: 'a'.repeat(64),
          wh: 'b'.repeat(64),
          s: 128,
          sp: 'peer-c',
          ...(typeof relayedRequest.rid === 'string'
            ? { rr: relayedRequest.rid }
            : {}),
        },
      },
      'peer-c'
    );
    await Promise.resolve();

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'event_offer',
          g: 74,
          o: expect.objectContaining({
            id: 'event-relay-74',
            sd: 'peer-c',
            ...(typeof relayedRequest.rid === 'string'
              ? { rr: relayedRequest.rid }
              : {}),
          }),
        }),
      })
    );
    manager.close();
  });

  it('does not relay plain direct event offers through implicit event routes', async () => {
    const fanout: Array<Record<string, unknown>> = [];
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });
    const request = signedEventRequestWire({
      groupId: 75,
      eventId: 'event-direct-offer-not-relayed',
      timestamp: 100_000,
    });

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [75], mode: 'summary' },
      'peer-a'
    );
    manager.handleWire(
      { t: 'RCHAT', k: 'event_req', g: 75, q: request },
      'peer-a'
    );
    await Promise.resolve();
    expect(fanout.some((wire) => wire.k === 'event_req')).toBe(true);

    direct.length = 0;
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_offer',
        g: 75,
        o: {
          x: 'transfer-direct-offer-not-relayed',
          id: 'event-direct-offer-not-relayed',
          ph: 'a'.repeat(64),
          wh: 'b'.repeat(64),
          s: 128,
        },
      },
      'peer-c'
    );
    await Promise.resolve();

    expect(direct).toEqual([]);
    manager.close();
  });

  it('does not exclude peers from fallback fanout when targeted hints fail', async () => {
    let fallbackExcludes: string[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        _messages: Record<string, unknown>[],
        excludePeerPresenceHashes: string[] = []
      ) => {
        fallbackExcludes = excludePeerPresenceHashes;
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async () => ({
        ok: false as const,
        reason: 'no-route' as const,
        error: 'No overlay route',
      }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([70]);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [70], mode: 'summary' },
      'peer-a'
    );

    await manager.publishEvent(
      signedEvent({
        eventId: 'event-targeted-fallback-after-failure',
        groupId: 70,
        authorSeq: 1,
        timestamp: 100_000,
      })
    );

    expect(fallbackExcludes).toEqual([]);
    manager.close();
  });

  it('falls back to digest fanout when only some targeted event offers succeed', async () => {
    const fanout: Record<string, unknown>[] = [];
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        fanout.push(...messages);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push({ peer, wire: message });
        if (peer === 'peer-a') return { ok: true as const };
        return {
          ok: false as const,
          reason: 'no-route' as const,
          error: 'No overlay route',
        };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([71]);
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [71], mode: 'active' },
      'peer-a'
    );
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [71], mode: 'active' },
      'peer-b'
    );

    const result = await manager.publishEvent(
      signedEvent({
        eventId: 'event-partial-targeted-fallback',
        groupId: 71,
        authorSeq: 1,
        timestamp: 100_000,
      })
    );

    expect(result.ok).toBe(true);
    expect(direct.filter(({ wire }) => wire.k === 'event_offer')).toHaveLength(
      2
    );
    expect(fanout).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'group_state_digest_v3',
        g: 71,
      })
    );
    manager.close();
  });

  it.skip('requests a newest inclusive feed page before peer latest when local history is empty', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
    });
    const event = signedEvent({ groupId: 9 });
    manager.setLocalGroupMemberships([9]);
    manager.subscribeGroup(9);
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 9,
        channels: [
          {
            c: 'general',
            latest: {
              id: event.eventId,
              ts: event.timestamp,
            },
          },
        ],
      },
      'peer'
    );
    await flushQueuedWork();
    expect(direct.filter((wire) => wire.k === 'feed_req')).toHaveLength(1);
    expect(direct.find((wire) => wire.k === 'feed_req')).toMatchObject({
      t: 'RCHAT',
      k: 'feed_req',
      g: 9,
      c: 'general',
      before: {
        id: event.eventId,
        ts: event.timestamp,
      },
      inc: 1,
      limit: 100,
    });
    expect(
      byteLengthUtf8JsonWithBridgeSender(
        direct.find((wire) => wire.k === 'feed_req')!
      )
    ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    expect(direct.find((wire) => wire.k === 'event_req')).toBeUndefined();
    manager.close();
  });

  it.skip('requests the exact latest event when a newer group digest has no channel rows', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
    });
    const event = signedEvent({ groupId: 9, timestamp: 90_000 });
    manager.setLocalGroupMemberships([9]);
    manager.subscribeGroup(9);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 9,
        latest: {
          id: event.eventId,
          ts: event.timestamp,
        },
        channels: [],
      },
      'b'.repeat(32)
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(direct.filter((wire) => wire.k === 'event_req')).toHaveLength(1);
    expect(direct.find((wire) => wire.k === 'event_req')).toMatchObject({
      t: 'RCHAT',
      k: 'event_req',
      g: 9,
      q: expect.objectContaining({ id: event.eventId }),
    });
    expect(direct.find((wire) => wire.k === 'feed_req')).toBeUndefined();
    manager.close();
  });

  it.skip('keeps newest feed repair peer-targeted when direct route is unavailable', async () => {
    const direct: Record<string, unknown>[] = [];
    const fanout: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: false as const, reason: 'no-route' as const };
      },
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        fanout.push(...messages);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
    });
    const event = signedEvent({ groupId: 9, timestamp: 90_000 });
    manager.setLocalGroupMemberships([9]);
    manager.subscribeGroup(9);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 9,
        latest: {
          id: event.eventId,
          ts: event.timestamp,
        },
        channels: [],
      },
      'b'.repeat(32)
    );

    let eventReq = direct.find((wire) => wire.k === 'event_req');
    for (let attempt = 0; !eventReq && attempt < 20; attempt += 1) {
      await flushQueuedWork();
      eventReq = direct.find((wire) => wire.k === 'event_req');
    }
    expect(eventReq).toMatchObject({
      k: 'event_req',
      g: 9,
      q: expect.objectContaining({ id: event.eventId }),
    });
    expect(direct.find((wire) => wire.k === 'feed_req')).toBeUndefined();
    expect(fanout.find((wire) => wire.k === 'feed_req')).toBeUndefined();
    manager.close();
  });

  it.skip('requests default feed when a digest hash differs but no cursor details are present', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([9]);
    manager.subscribeGroup(9);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 9,
        channels: [],
        digestHash: 'f'.repeat(64),
      },
      'peer'
    );

    await flushQueuedWork();
    expect(direct.filter((wire) => wire.k === 'feed_req')).toHaveLength(1);
    expect(direct.find((wire) => wire.k === 'feed_req')).toMatchObject({
      t: 'RCHAT',
      k: 'feed_req',
      g: 9,
      c: '*',
      limit: 100,
    });
    manager.close();
  });

  it.skip('pushes newest local history when a cursorless peer digest is behind local history', async () => {
    const direct: Record<string, unknown>[] = [];
    const resources: Array<{
      filePath: string;
      metadata?: Record<string, unknown>;
    }> = [];
    let resolveResourceSent: (() => void) | null = null;
    const resourceSent = new Promise<void>((resolve) => {
      resolveResourceSent = resolve;
    });
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (payload: {
        filePath: string;
        metadata?: Record<string, unknown>;
      }) => {
        resources.push(payload);
        resolveResourceSent?.();
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([9]);
    const events = signedAuthorEvents(
      Array.from({ length: 105 }, (_, index) => ({
        eventId: `history-${String(index + 1).padStart(3, '0')}`,
        groupId: 9,
        authorSeq: index + 1,
        timestamp: 90_000 + index,
      }))
    );
    for (const event of events) {
      (manager as any).acceptEvent(event, false);
    }
    manager.subscribeGroup(9);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 9,
        channels: [],
        digestHash: 'e'.repeat(64),
      },
      'peer'
    );

    await resourceSent;
    await flushAsyncWork();
    expect(direct.filter((wire) => wire.k === 'feed_req')).toHaveLength(0);
    expect(
      direct.some((wire) =>
        ['event_page_offer', 'group_digest'].includes(String(wire.k))
      )
    ).toBe(true);
    const digest = direct.find((wire) => wire.k === 'group_digest') as any;
    if (digest) {
      expect(digest.latest).toEqual({
        id: 'history-105',
        ts: 90_104,
      });
    }
    const pagePayload = resources.find(
      (payload) =>
        payload.metadata?.resourceType === 'reticulum_chat_event_page'
    );
    expect(pagePayload).toBeTruthy();
    const page = JSON.parse(fs.readFileSync(pagePayload!.filePath, 'utf8')) as {
      d: string;
      more?: boolean;
      events: ReticulumChatEvent[];
    };
    expect(page.d).toBe('before');
    expect(page.more).toBe(true);
    expect(page.events.map((event) => event.eventId)).toHaveLength(100);
    expect(page.events[0].eventId).toBe('history-006');
    expect(page.events[99].eventId).toBe('history-105');
    expect(page.events.some((event) => event.eventId === 'history-001')).toBe(
      false
    );
    manager.close();
  });

  it('does not request repair for a matching empty digest hash with no cursor details', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([9]);
    manager.subscribeGroup(9);
    direct.length = 0;
    const localDigest = await (manager as any).buildGroupStateDigestWire(9);

    manager.handleWire(localDigest, 'peer');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(direct.filter((wire) => wire.k === 'feed_req')).toHaveLength(0);
    manager.close();
  });

  it('keeps admin-private events out of generic group digest latest and hash', async () => {
    const groupId = 91;
    const baseManager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
      } as any,
      now: () => 100_000,
    });
    const privateManager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
      } as any,
      now: () => 100_000,
    });
    const publicEvent = signedEvent({
      eventId: 'event-digest-public-latest',
      groupId,
      channelId: 'general',
      timestamp: 50_000,
    });
    const privateEvent = signedEvent({
      eventId: 'event-digest-admin-private-hidden',
      groupId,
      channelId: 'admin-private',
      timestamp: 60_000,
    });

    expect((baseManager as any).db.insertEvent(publicEvent, true)).toBe(true);
    expect((privateManager as any).db.insertEvent(publicEvent, true)).toBe(
      true
    );
    upsertTestChannel(privateManager, {
      groupId,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    expect((privateManager as any).db.insertEvent(privateEvent, true)).toBe(
      true
    );

    const baseDigest = (baseManager as any).buildGroupDigestSnapshot(groupId);
    const privateDigest = (privateManager as any).buildGroupDigestSnapshot(
      groupId
    );

    expect(privateDigest.latest).toMatchObject({
      eventId: publicEvent.eventId,
      feedTimestamp: publicEvent.timestamp,
    });
    expect(privateDigest.digestHash).toBe(baseDigest.digestHash);
    baseManager.close();
    privateManager.close();
  });

  it('keeps admin-private channels out of shared channel state heads', () => {
    const groupId = 911;
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    upsertTestChannel(manager, {
      groupId,
      channelId: 'public-channel',
      readMode: 'members',
    });
    upsertTestChannel(manager, {
      groupId,
      channelId: 'admin-private',
      readMode: 'admins',
      writeMode: 'admins',
    });

    const heads = (manager as any).buildChannelHeads(groupId);

    expect(
      heads.map((head: { channelId: string }) => head.channelId)
    ).toContain('public-channel');
    expect(
      heads.map((head: { channelId: string }) => head.channelId)
    ).not.toContain('admin-private');
    manager.close();
  });

  it('does not request repair when only admin-private digest content differs', async () => {
    const groupId = 92;
    const direct: Record<string, unknown>[] = [];
    const receiver = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          _peer: string,
          message: Record<string, unknown>
        ) => {
          direct.push(message);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });
    const peer = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
      } as any,
      now: () => 100_000,
    });
    receiver.setLocalGroupMemberships([groupId]);
    receiver.subscribeGroup(groupId);
    direct.length = 0;

    const publicEvent = signedEvent({
      eventId: 'event-digest-repair-public',
      groupId,
      channelId: 'general',
      timestamp: 50_000,
    });
    const privateEvent = signedEvent({
      eventId: 'event-digest-repair-admin-private',
      groupId,
      channelId: 'admin-private',
      timestamp: 60_000,
    });
    expect((receiver as any).db.insertEvent(publicEvent, true)).toBe(true);
    expect((peer as any).db.insertEvent(publicEvent, true)).toBe(true);
    upsertTestChannel(peer, {
      groupId,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    expect((peer as any).db.insertEvent(privateEvent, true)).toBe(true);
    const peerDigest = (peer as any).buildGroupDigestSnapshot(groupId);

    receiver.handleWire(
      {
        t: 'RCHAT',
        v: 3,
        k: 'group_state_digest_v3',
        g: groupId,
        d: {
          latest: peerDigest.latest
            ? {
                id: peerDigest.latest.eventId,
                ts: peerDigest.latest.feedTimestamp,
              }
            : undefined,
          eventHash: peerDigest.digestHash,
        },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(direct.filter((wire) => wire.k === 'feed_req')).toHaveLength(0);
    receiver.close();
    peer.close();
  });

  it('builds reduced channel digest variants for tight wire packets', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
      } as any,
    });
    const latest = { eventId: 'latest-event', feedTimestamp: 10_000 };
    const variants = (manager as any).buildDigestChannelWireVariants({
      groupId: 9,
      channelId: 'ch-digest-packing-test',
      latestCursor: latest,
      oldestCursor: { eventId: 'oldest-event', feedTimestamp: 1_000 },
      visibleWindowHash: 'a'.repeat(64),
    });

    expect(variants[0]).toMatchObject({
      c: 'ch-digest-packing-test',
      latest: { id: latest.eventId, ts: latest.feedTimestamp },
      oldest: { id: 'oldest-event', ts: 1_000 },
      wh: 'a'.repeat(64),
    });
    expect(variants).toContainEqual({
      c: 'ch-digest-packing-test',
      latest: { id: latest.eventId, ts: latest.feedTimestamp },
    });
    manager.close();
  });

  it('does not retry summary fanout when the overlay route is not ready', async () => {
    let now = 100_000;
    const sent: Record<string, unknown>[][] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(messages);
        if (sent.length === 1) {
          return {
            ok: false as const,
            reason: 'no-route' as const,
            error: 'No overlay route',
          };
        }
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });

    const result = await (manager as any).fanout({
      t: 'RCHAT',
      k: 'group_digest',
      g: 9,
      latest: { id: 'event-latest', ts: 90_000 },
      channels: [],
    });
    expect(result).toMatchObject({ ok: false, reason: 'no-route' });
    expect(sent).toHaveLength(1);

    now += 3_001;
    await (manager as any).drainControlRetryQueue();

    expect(sent).toHaveLength(1);
    manager.close();
  });

  it('retries repair fanout when the overlay route is not ready', async () => {
    let now = 90_000;
    const sent: Record<string, unknown>[][] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(messages);
        if (sent.length === 1) {
          return {
            ok: false as const,
            reason: 'no-route' as const,
            error: 'No overlay route',
          };
        }
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });

    const result = await (manager as any).fanout({
      t: 'RCHAT',
      k: 'feed_req',
      g: 9,
      c: 'general',
      limit: 25,
    });
    expect(result).toMatchObject({ ok: false, reason: 'no-route' });
    expect(sent).toHaveLength(1);

    now += 3_001;
    await (manager as any).drainControlRetryQueue();

    expect(sent).toHaveLength(2);
    expect(sent[1][0]).toMatchObject({
      t: 'RCHAT',
      k: 'feed_req',
      g: 9,
      c: 'general',
    });
    manager.close();
  });

  it('serves feed results as one event page resource offer', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const resources: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatResourceDetailed: async (payload: unknown) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    const event = signedEvent({
      eventId: 'event-resource-rotate',
      groupId: 71,
      authorSeq: 1,
      timestamp: 100_000,
    });
    manager.setLocalGroupMemberships([71]);
    await manager.publishEvent(event);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'feed_req',
        g: 71,
        c: 'general',
        after: {
          id: event.eventId,
          ts: event.timestamp - 1,
        },
        limit: 25,
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(resources).toHaveLength(1);
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          k: 'event_page_offer',
          p: expect.objectContaining({ n: 1 }),
        }),
      })
    );
    manager.close();
  });

  it('keeps fixed compact event page offers inside the Reticulum wire limit', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 60_000,
    });
    const channelId = `a${'b'.repeat(38)}c`;
    manager.setLocalGroupMemberships([999_999_999]);
    const event = signedEvent({
      eventId: 'event-fixed-page-offer',
      groupId: 999_999_999,
      channelId,
      timestamp: 10_000,
    });
    (manager as any).db.insertEvent(event, true);
    direct.length = 0;

    manager.handleWire(
      { t: 'RCHAT', k: 'feed_req', g: 999_999_999, c: channelId, limit: 10 },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pageOffer = direct.find((item) => item.wire.k === 'event_page_offer')
      ?.wire as any;
    expect(pageOffer).toBeDefined();
    expect(wireFitsReticulum(pageOffer)).toBe(true);
    expect(pageOffer.p).toMatchObject({
      c: channelId,
      d: 'a',
      n: 1,
      sd: expect.any(String),
    });
    expect(pageOffer.p.rk).toBeUndefined();
    expect(pageOffer.p.sid).toBeUndefined();
    expect(pageOffer.p.eid).toBeUndefined();
    expect(pageOffer.p.sp).toBeUndefined();
    manager.close();
  });

  it('keeps event page resources alive for targeted retry when direct send fails', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const fanout: Record<string, unknown>[][] = [];
    const resources: Array<Record<string, any>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: false as const, reason: 'packet-send-false' as const };
      },
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        fanout.push(messages);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    const event = signedEvent({
      eventId: 'event-page-direct-fail',
      groupId: 71,
      authorSeq: 1,
      timestamp: 100_000,
    });
    manager.setLocalGroupMemberships([71]);
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'feed_req',
        g: 71,
        c: 'general',
        limit: 25,
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(resources).toHaveLength(1);
    expect(fs.existsSync(resources[0].filePath)).toBe(true);
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({ k: 'event_page_offer' }),
      })
    );
    expect(
      fanout.flat().find((wire) => wire.k === 'event_page_offer')
    ).toBeUndefined();
    manager.close();
  });

  it('serves event page resources without filtering out third-party cached authors', async () => {
    const direct: Array<{ peer: string; wire: Record<string, any> }> = [];
    const resources: Array<Record<string, any>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, any>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const first = signedEvent({
      eventId: 'event-page-provider-author',
      groupId: 72,
      channelId: 'general',
      authorSeq: 1,
      timestamp: 100_000,
    });
    const second = signedEvent({
      eventId: 'event-page-third-party-author',
      groupId: 72,
      channelId: 'general',
      authorSeq: 1,
      timestamp: 101_000,
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 120_000,
      validateGroupMember: async (_groupId, address) =>
        address === first.authorAddress,
    });
    manager.setLocalGroupMemberships([72]);
    expect((manager as any).db.insertEvent(first, true)).toBe(true);
    expect((manager as any).db.insertEvent(second, false)).toBe(true);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'feed_req',
        g: 72,
        c: 'general',
        limit: 10,
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(resources).toHaveLength(1);
    const page = JSON.parse(fs.readFileSync(resources[0].filePath, 'utf8')) as {
      events: Array<{ eventId: string }>;
    };
    expect(page.events.map((event) => event.eventId)).toEqual([
      first.eventId,
      second.eventId,
    ]);
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          k: 'event_page_offer',
          p: expect.objectContaining({ n: 2 }),
        }),
      })
    );
    manager.close();
  });

  it('accepts event batches and requests exact author range repair for gaps', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    const event = signedEvent({
      eventId: 'event-batch-gap-repair',
      groupId: 72,
      authorSeq: 3,
      timestamp: 100_000,
    });
    manager.setLocalGroupMemberships([72]);
    manager.subscribeGroup(72);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_batch',
        g: 72,
        c: 'general',
        batch: {
          dir: 'after',
          start: { ts: event.timestamp, id: event.eventId },
          end: { ts: event.timestamp, id: event.eventId },
          wh: nodeCrypto
            .createHash('sha256')
            .update(JSON.stringify([event.eventId]), 'utf8')
            .digest('hex'),
          events: [event],
        },
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          k: 'range_req',
          ranges: [
            expect.objectContaining({ a: event.authorAddress, from: 1, to: 2 }),
          ],
        }),
      })
    );
    expect(manager.getHistory(72, 10).map((item) => item.eventId)).toContain(
      event.eventId
    );
    manager.close();
  });

  it('requests the newest page first for large author range gaps', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    const [first, latest] = signedAuthorEvents([
      {
        eventId: 'event-large-gap-first',
        groupId: 72,
        authorSeq: 1,
        timestamp: 50_000,
      },
      {
        eventId: 'event-large-gap-latest',
        groupId: 72,
        authorSeq: 80,
        timestamp: 100_000,
      },
    ]);
    manager.setLocalGroupMemberships([72]);
    manager.subscribeGroup(72);
    await manager.publishEvent(first);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_batch',
        g: 72,
        c: 'general',
        batch: {
          dir: 'after',
          start: { ts: latest.timestamp, id: latest.eventId },
          end: { ts: latest.timestamp, id: latest.eventId },
          wh: nodeCrypto
            .createHash('sha256')
            .update(JSON.stringify([latest.eventId]), 'utf8')
            .digest('hex'),
          events: [latest],
        },
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          k: 'range_req',
          ranges: [
            expect.objectContaining({
              a: latest.authorAddress,
              from: 2,
              to: 79,
            }),
          ],
        }),
      })
    );
    manager.close();
  });

  it('requests exact author range repair when downloaded event resources reveal gaps', async () => {
    const acceptedTransfers: unknown[] = [];
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      acceptReticulumChatResourceDetailed: async (payload: unknown) => {
        acceptedTransfers.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
    });
    manager.setLocalGroupMemberships([72]);
    manager.subscribeGroup(72);
    const event = signedEvent({
      eventId: 'event-resource-gap-repair',
      groupId: 72,
      authorSeq: 3,
      timestamp: 100_000,
    });
    const blob = serializeReticulumChatEvent(event);
    const wireHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const resourcePath = path.join(
      path.dirname(tempDbPath()),
      'event-resource-gap.json'
    );
    fs.writeFileSync(resourcePath, blob, 'utf8');

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_offer',
        g: 72,
        o: {
          x: 'transfer-resource-gap-repair',
          id: event.eventId,
          ph: event.payloadHash,
          wh: wireHash,
          s: Buffer.byteLength(blob, 'utf8'),
        },
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acceptedTransfers).toHaveLength(1);

    manager.handleResourceEvent({
      status: 'received',
      transferId: 'transfer-resource-gap-repair',
      peerPresenceHash: 'peer-a',
      path: resourcePath,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          k: 'range_req',
          ranges: [
            expect.objectContaining({ a: event.authorAddress, from: 1, to: 2 }),
          ],
        }),
      })
    );
    expect(manager.getHistory(72, 10).map((item) => item.eventId)).toContain(
      event.eventId
    );
    manager.close();
  });

  it('requests the next feed page after importing a continuation event resource', async () => {
    const acceptedTransfers: unknown[] = [];
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      acceptReticulumChatResourceDetailed: async (payload: unknown) => {
        acceptedTransfers.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
    });
    manager.setLocalGroupMemberships([72]);
    manager.subscribeGroup(72);
    const event = signedEvent({
      eventId: 'event-resource-continuation',
      groupId: 72,
      authorSeq: 1,
      timestamp: 100_000,
    });
    const blob = serializeReticulumChatEvent(event);
    const wireHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const resourcePath = path.join(
      path.dirname(tempDbPath()),
      'event-resource-continuation.json'
    );
    fs.writeFileSync(resourcePath, blob, 'utf8');

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_offer',
        g: 72,
        o: {
          x: 'transfer-resource-continuation',
          id: event.eventId,
          ph: event.payloadHash,
          wh: wireHash,
          s: Buffer.byteLength(blob, 'utf8'),
          fc: 'general',
          fd: 'a',
          fid: event.eventId,
          fts: event.timestamp,
        },
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acceptedTransfers).toHaveLength(1);

    manager.handleResourceEvent({
      status: 'received',
      transferId: 'transfer-resource-continuation',
      peerPresenceHash: 'peer-a',
      path: resourcePath,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          k: 'feed_req',
          g: 72,
          c: 'general',
          after: { ts: event.timestamp, id: event.eventId },
          limit: 100,
        }),
      })
    );
    expect(manager.getHistory(72, 10).map((item) => item.eventId)).toContain(
      event.eventId
    );
    expect(fs.existsSync(resourcePath)).toBe(false);
    manager.close();
  });

  it('imports signed events from one event page resource', async () => {
    const acceptedTransfers: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      acceptReticulumChatResourceDetailed: async (payload: unknown) => {
        acceptedTransfers.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([72]);
    manager.subscribeGroup(72);
    const events = signedAuthorEvents([
      {
        eventId: 'event-page-resource-1',
        groupId: 72,
        authorSeq: 1,
        timestamp: 90_001,
      },
      {
        eventId: 'event-page-resource-2',
        groupId: 72,
        authorSeq: 2,
        timestamp: 90_002,
      },
    ]);
    const page = {
      v: 1,
      g: 72,
      c: 'general',
      d: 'after',
      start: { ts: events[0].timestamp, id: events[0].eventId },
      end: { ts: events[1].timestamp, id: events[1].eventId },
      wh: nodeCrypto
        .createHash('sha256')
        .update(JSON.stringify(events.map((event) => event.eventId)), 'utf8')
        .digest('hex'),
      events,
    };
    const blob = JSON.stringify(page);
    const pageHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const resourcePath = path.join(
      path.dirname(tempDbPath()),
      'event-page-resource.json'
    );
    fs.writeFileSync(resourcePath, blob, 'utf8');

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_page_offer',
        g: 72,
        p: {
          x: 'transfer-event-page-resource',
          c: 'general',
          d: 'a',
          ph: pageHash,
          s: Buffer.byteLength(blob, 'utf8'),
          n: events.length,
          sid: events[0].eventId,
          sts: events[0].timestamp,
          eid: events[1].eventId,
          ets: events[1].timestamp,
        },
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acceptedTransfers).toHaveLength(1);

    manager.handleResourceEvent({
      status: 'received',
      transferId: 'transfer-event-page-resource',
      peerPresenceHash: 'peer-a',
      path: resourcePath,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(manager.getHistory(72, 10).map((item) => item.eventId)).toEqual([
      'event-page-resource-1',
      'event-page-resource-2',
    ]);
    expect(fs.existsSync(resourcePath)).toBe(false);
    manager.close();
  });

  it('requests the next feed page after importing a continuation event page resource', async () => {
    const acceptedTransfers: unknown[] = [];
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      acceptReticulumChatResourceDetailed: async (payload: unknown) => {
        acceptedTransfers.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([72]);
    manager.subscribeGroup(72);
    const events = signedAuthorEvents([
      {
        eventId: 'event-page-continuation-1',
        groupId: 72,
        authorSeq: 1,
        timestamp: 90_001,
      },
      {
        eventId: 'event-page-continuation-2',
        groupId: 72,
        authorSeq: 2,
        timestamp: 90_002,
      },
    ]);
    const page = {
      v: 1,
      g: 72,
      c: 'general',
      d: 'after',
      more: true,
      start: { ts: events[0].timestamp, id: events[0].eventId },
      end: { ts: events[1].timestamp, id: events[1].eventId },
      wh: nodeCrypto
        .createHash('sha256')
        .update(JSON.stringify(events.map((event) => event.eventId)), 'utf8')
        .digest('hex'),
      events,
    };
    const blob = JSON.stringify(page);
    const pageHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const resourcePath = path.join(
      path.dirname(tempDbPath()),
      'event-page-continuation.json'
    );
    fs.writeFileSync(resourcePath, blob, 'utf8');

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_page_offer',
        g: 72,
        p: {
          x: 'transfer-event-page-continuation',
          c: 'general',
          d: 'a',
          ph: pageHash,
          s: Buffer.byteLength(blob, 'utf8'),
          n: events.length,
          eid: events[1].eventId,
          ets: events[1].timestamp,
          more: 1,
        },
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acceptedTransfers).toHaveLength(1);

    manager.handleResourceEvent({
      status: 'received',
      transferId: 'transfer-event-page-continuation',
      peerPresenceHash: 'peer-a',
      path: resourcePath,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(direct).toEqual([]);
    expect(acceptedTransfers).toHaveLength(2);
    expect(acceptedTransfers[1]).toEqual(
      expect.objectContaining({
        peerPresenceHash: 'peer-a',
        authMessage: expect.objectContaining({
          type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
          groupId: 72,
          c: 'general',
          after: { ts: events[1].timestamp, id: events[1].eventId },
          limit: 100,
        }),
      })
    );
    manager.close();
  });

  it.skip('requests exact author range repair for already-stored sequence holes on peer digest', async () => {
    let now = 100_000;
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([72]);
    manager.subscribeGroup(72);
    const [first, third] = signedAuthorEvents([
      {
        eventId: 'event-known-gap-1',
        groupId: 72,
        authorSeq: 1,
        timestamp: 90_000,
      },
      {
        eventId: 'event-known-gap-3',
        groupId: 72,
        authorSeq: 3,
        timestamp: 91_000,
      },
    ]);
    expect((manager as any).db.insertEvent(first, false)).toBe(true);
    expect((manager as any).db.insertEvent(third, false)).toBe(true);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 72,
        latest: { id: third.eventId, ts: third.timestamp },
        channels: [
          {
            c: 'general',
            latest: { id: third.eventId, ts: third.timestamp },
            oldest: { id: first.eventId, ts: first.timestamp },
            wh: nodeCrypto
              .createHash('sha256')
              .update(JSON.stringify([first.eventId, third.eventId]), 'utf8')
              .digest('hex'),
          },
        ],
        digestHash: 'peer-digest',
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(direct.find((item) => item.wire.k === 'range_req')).toBeUndefined();

    now += 60_000;
    (manager as any).processBackgroundAuthorGapRepair();
    await vi.waitUntil(
      () =>
        direct.some(
          (item) =>
            item.peer === 'peer-a' &&
            item.wire.k === 'range_req' &&
            item.wire.ranges.some(
              (range) =>
                range.a === first.authorAddress &&
                range.from === 2 &&
                range.to === 2
            )
        ),
      { timeout: 1_000 }
    );
    manager.close();
  });

  it('requests exact author range repair for already-stored sequence holes on peer subscription', async () => {
    let now = 100_000;
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([72]);
    manager.subscribeGroup(72);
    const [first, third] = signedAuthorEvents([
      {
        eventId: 'event-known-sub-gap-1',
        groupId: 72,
        authorSeq: 1,
        timestamp: 90_000,
      },
      {
        eventId: 'event-known-sub-gap-3',
        groupId: 72,
        authorSeq: 3,
        timestamp: 91_000,
      },
    ]);
    expect((manager as any).db.insertEvent(first, false)).toBe(true);
    expect((manager as any).db.insertEvent(third, false)).toBe(true);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_sub',
        groups: [72],
        mode: 'active',
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(direct.find((item) => item.wire.k === 'range_req')).toBeUndefined();

    now += 60_000;
    (manager as any).processBackgroundAuthorGapRepair();
    await flushQueuedWork();

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-a',
        wire: expect.objectContaining({
          k: 'range_req',
          ranges: [
            expect.objectContaining({ a: first.authorAddress, from: 2, to: 2 }),
          ],
        }),
      })
    );
    manager.close();
  });

  it('keeps author range repair peer-targeted when direct route is unavailable', async () => {
    let now = 100_000;
    const directWires: Record<string, unknown>[] = [];
    const fanoutWires: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (wires: Record<string, unknown>[]) => {
        fanoutWires.push(...wires);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        _peer: string,
        wire: Record<string, unknown>
      ) => {
        directWires.push(wire);
        return {
          ok: false as const,
          reason: 'no-route' as const,
        };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([72]);
    manager.subscribeGroup(72);
    const [first, third] = signedAuthorEvents([
      {
        eventId: 'event-known-fallback-gap-1',
        groupId: 72,
        authorSeq: 1,
        timestamp: 90_000,
      },
      {
        eventId: 'event-known-fallback-gap-3',
        groupId: 72,
        authorSeq: 3,
        timestamp: 91_000,
      },
    ]);
    expect((manager as any).db.insertEvent(first, false)).toBe(true);
    expect((manager as any).db.insertEvent(third, false)).toBe(true);
    fanoutWires.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_sub',
        groups: [72],
        mode: 'active',
      },
      'peer-a'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(directWires.find((wire) => wire.k === 'range_req')).toBeUndefined();

    now += 60_000;
    (manager as any).processBackgroundAuthorGapRepair();
    await flushQueuedWork();

    expect(directWires).toContainEqual(
      expect.objectContaining({
        k: 'range_req',
        ranges: [
          expect.objectContaining({ a: first.authorAddress, from: 2, to: 2 }),
        ],
      })
    );
    expect(fanoutWires.find((wire) => wire.k === 'range_req')).toBeUndefined();
    manager.close();
  });

  it('accepts group-wide event batches without filtering events to general', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([72]);
    manager.subscribeGroup(72);
    const event = signedEvent({
      eventId: 'event-group-wide-import-channel',
      groupId: 72,
      channelId: 'ch-00000000-0000-4000-8000-000000000000',
      timestamp: 50_000,
    });

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_batch',
        g: 72,
        c: '*',
        batch: {
          start: { id: event.eventId, ts: event.timestamp },
          end: { id: event.eventId, ts: event.timestamp },
          dir: 'after',
          more: false,
          wh: (manager as any).db.computeWindowHash([event]),
          events: [event],
        },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      manager.getHistory(72, event.channelId, 10).map((item) => item.eventId)
    ).toEqual([event.eventId]);
    manager.close();
  });

  it('serves linked byte-range auth requests on the established resource link', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-linked-auth-')
    );
    const sourcePath = path.join(tempRoot, 'source.bin');
    const sourceBytes = Buffer.concat([
      Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 21),
      Buffer.from('linked tail'),
    ]);
    fs.writeFileSync(sourcePath, sourceBytes);
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const manifest = resourceStore.importLocalFile({
      sourcePath,
      namespace: 'reticulum-chat-file',
      ownerId: '81:sender',
      fileName: 'source.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 81 },
    });
    resourceStore.recordGroupReference({
      fileHash: manifest.fileHash,
      groupId: 81,
      eventId: 'event-linked-resource',
      ownerId: manifest.ownerId,
    });

    const offeredResources: Array<Record<string, unknown>> = [];
    const authorizations: Array<Record<string, unknown>> = [];
    const rejections: Array<Record<string, unknown>> = [];
    const requesterPeerHash = 'd'.repeat(32);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        offeredResources.push(payload);
        return { ok: true as const };
      },
      authorizeReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        authorizations.push(payload);
        return { ok: true as const };
      },
      rejectReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        rejections.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([999]);

    const range: [number, number] = [0, RETICULUM_RESOURCE_RANGE_SIZE];
    const request = signedResourceRequestWire({
      groupId: 81,
      fileHash: manifest.fileHash,
      byteRanges: [range],
      timestamp: 100_000,
    });
    const authRequest = {
      ...request,
      type: 'RETICULUM_GROUP_RESOURCE_AUTH',
      transferId: 'linked-transfer-1',
      groupId: 81,
      contextId: 81,
      fileHash: manifest.fileHash,
      totalSizeBytes: manifest.sizeBytes,
      byteRanges: [range],
      requesterPeerHash,
    };
    manager.handleGenericResourceEvent({
      status: 'auth',
      linkId: 'resource-link-1',
      transferId: 'linked-transfer-1',
      peerPresenceHash: requesterPeerHash,
      auth: authRequest,
    });
    manager.handleGenericResourceEvent({
      status: 'auth',
      linkId: 'resource-link-1-resource',
      transferId: 'linked-transfer-1',
      peerPresenceHash: requesterPeerHash,
      auth: authRequest,
    });
    await vi.waitFor(() => expect(authorizations).toHaveLength(2));

    const expectedPayloadHash = nodeCrypto
      .createHash('sha256')
      .update(sourceBytes.subarray(range[0], range[1]))
      .digest('hex');
    expect(rejections).toHaveLength(0);
    expect(offeredResources).toHaveLength(1);
    expect(offeredResources[0]).toEqual(
      expect.objectContaining({
        allowedRecipientAddress: requesterPeerHash,
        transferId: 'linked-transfer-1',
        resourceType: 'reticulum_group_resource_range',
        size: RETICULUM_RESOURCE_RANGE_SIZE,
        sha256: expectedPayloadHash,
      })
    );
    expect(authorizations).toEqual([
      {
        linkId: 'resource-link-1',
        transferId: 'linked-transfer-1',
      },
      {
        linkId: 'resource-link-1-resource',
        transferId: 'linked-transfer-1',
      },
    ]);

    resourceStore.setReferenceState({
      fileHash: manifest.fileHash,
      scopeType: 'group',
      scopeId: 81,
      eventId: 'event-linked-resource',
      state: 'deleted',
    });
    manager.handleGenericResourceEvent({
      status: 'auth',
      linkId: 'resource-link-deleted',
      transferId: 'linked-transfer-deleted',
      peerPresenceHash: requesterPeerHash,
      auth: {
        ...authRequest,
        transferId: 'linked-transfer-deleted',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(offeredResources).toHaveLength(1);
    expect(rejections).toContainEqual(
      expect.objectContaining({
        transferId: 'linked-transfer-deleted',
        reason: 'request_not_allowed',
      })
    );
    manager.close();
    resourceStore.close();
  });

  it('refuses linked byte-range resource requests for admin-private channel events from non-admin requesters', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-admin-private-deny-')
    );
    const sourcePath = path.join(tempRoot, 'source.bin');
    fs.writeFileSync(
      sourcePath,
      Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 17)
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const manifest = resourceStore.importLocalFile({
      sourcePath,
      namespace: 'reticulum-chat-file',
      ownerId: '81:sender',
      fileName: 'source.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 81 },
    });

    const offeredResources: Array<Record<string, unknown>> = [];
    const rejections: Array<Record<string, unknown>> = [];
    const requesterPeerHash = 'd'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          offeredResources.push(payload);
          return { ok: true as const };
        },
        authorizeReticulumResourceDetailed: async () => ({ ok: true as const }),
        rejectReticulumResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          rejections.push(payload);
          return { ok: true as const };
        },
      } as any,
      resourceStore,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => false,
    });
    upsertTestChannel(manager, {
      groupId: 81,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-admin-private-byte-range-hidden',
      groupId: 81,
      channelId: 'admin-private',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    resourceStore.recordGroupReference({
      fileHash: manifest.fileHash,
      groupId: 81,
      eventId: event.eventId,
    });

    const range: [number, number] = [0, RETICULUM_RESOURCE_RANGE_SIZE];
    const request = signedResourceRequestWire({
      groupId: 81,
      eventId: event.eventId,
      fileHash: manifest.fileHash,
      byteRanges: [range],
      timestamp: 100_000,
    });
    manager.handleGenericResourceEvent({
      status: 'auth',
      linkId: 'resource-link-admin-private-deny',
      transferId: 'linked-transfer-admin-private-deny',
      peerPresenceHash: requesterPeerHash,
      auth: {
        ...request,
        type: 'RETICULUM_GROUP_RESOURCE_AUTH',
        transferId: 'linked-transfer-admin-private-deny',
        groupId: 81,
        contextId: 81,
        fileHash: manifest.fileHash,
        totalSizeBytes: manifest.sizeBytes,
        byteRanges: [range],
        requesterPeerHash,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(offeredResources).toEqual([]);
    expect(rejections).toContainEqual(
      expect.objectContaining({
        transferId: 'linked-transfer-admin-private-deny',
        reason: 'request_not_allowed',
      })
    );
    manager.close();
    resourceStore.close();
  });

  it('serves linked byte-range resource requests for admin-private channel events to admin requesters', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-admin-private-allow-')
    );
    const sourcePath = path.join(tempRoot, 'source.bin');
    fs.writeFileSync(
      sourcePath,
      Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 19)
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const manifest = resourceStore.importLocalFile({
      sourcePath,
      namespace: 'reticulum-chat-file',
      ownerId: '81:sender',
      fileName: 'source.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 81 },
    });

    const offeredResources: Array<Record<string, unknown>> = [];
    const rejections: Array<Record<string, unknown>> = [];
    const requesterPeerHash = 'd'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          offeredResources.push(payload);
          return { ok: true as const };
        },
        authorizeReticulumResourceDetailed: async () => ({ ok: true as const }),
        rejectReticulumResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          rejections.push(payload);
          return { ok: true as const };
        },
      } as any,
      resourceStore,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    upsertTestChannel(manager, {
      groupId: 81,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-admin-private-byte-range-visible',
      groupId: 81,
      channelId: 'admin-private',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    resourceStore.recordGroupReference({
      fileHash: manifest.fileHash,
      groupId: 81,
      eventId: event.eventId,
    });

    const range: [number, number] = [0, RETICULUM_RESOURCE_RANGE_SIZE];
    const request = signedResourceRequestWire({
      groupId: 81,
      eventId: event.eventId,
      fileHash: manifest.fileHash,
      byteRanges: [range],
      timestamp: 100_000,
    });
    manager.handleGenericResourceEvent({
      status: 'auth',
      linkId: 'resource-link-admin-private-allow',
      transferId: 'linked-transfer-admin-private-allow',
      peerPresenceHash: requesterPeerHash,
      auth: {
        ...request,
        type: 'RETICULUM_GROUP_RESOURCE_AUTH',
        transferId: 'linked-transfer-admin-private-allow',
        groupId: 81,
        contextId: 81,
        fileHash: manifest.fileHash,
        totalSizeBytes: manifest.sizeBytes,
        byteRanges: [range],
        requesterPeerHash,
      },
    });
    await vi.waitFor(() => expect(offeredResources).toHaveLength(1));

    expect(rejections).toEqual([]);
    expect(offeredResources).toHaveLength(1);
    expect(offeredResources[0]).toEqual(
      expect.objectContaining({
        allowedRecipientAddress: requesterPeerHash,
        transferId: 'linked-transfer-admin-private-allow',
        resourceType: 'reticulum_group_resource_range',
      })
    );
    manager.close();
    resourceStore.close();
  });

  it('does not serve byte ranges for resources outside the requested group', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-wrong-group-')
    );
    const sourcePath = path.join(tempRoot, 'source.bin');
    const sourceBytes = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 17);
    fs.writeFileSync(sourcePath, sourceBytes);
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const manifest = resourceStore.importLocalFile({
      sourcePath,
      namespace: 'reticulum-chat-file',
      ownerId: '81:sender',
      fileName: 'source.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 81 },
    });

    const offeredResources: Array<Record<string, unknown>> = [];
    const rejections: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        offeredResources.push(payload);
        return { ok: true as const };
      },
      rejectReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        rejections.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([82]);

    const range: [number, number] = [0, RETICULUM_RESOURCE_RANGE_SIZE];
    const request = signedResourceRequestWire({
      groupId: 82,
      fileHash: manifest.fileHash,
      byteRanges: [range],
      timestamp: 100_000,
    });
    manager.handleGenericResourceEvent({
      status: 'auth',
      linkId: 'resource-link-wrong-group',
      transferId: 'wrong-group-transfer',
      peerPresenceHash: 'a'.repeat(32),
      auth: {
        ...request,
        type: 'RETICULUM_GROUP_RESOURCE_AUTH',
        transferId: 'wrong-group-transfer',
        groupId: 82,
        contextId: 82,
        fileHash: manifest.fileHash,
        totalSizeBytes: manifest.sizeBytes,
        byteRanges: [range],
        requesterPeerHash: 'a'.repeat(32),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(offeredResources).toHaveLength(0);
    expect(rejections).toEqual([
      {
        linkId: 'resource-link-wrong-group',
        transferId: 'wrong-group-transfer',
        reason: 'request_not_allowed',
      },
    ]);
    manager.close();
    resourceStore.close();
  });

  it('serves a reused file hash through any group reference for that resource', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-multi-group-')
    );
    const sourcePath = path.join(tempRoot, 'shared.bin');
    const sourceBytes = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 19);
    fs.writeFileSync(sourcePath, sourceBytes);
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const manifest = resourceStore.importLocalFile({
      sourcePath,
      namespace: 'reticulum-chat-file',
      ownerId: '81:sender',
      fileName: 'shared.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 81, eventId: 'event-file-group-81' },
    });
    const secondManifest = resourceStore.importLocalFile({
      sourcePath,
      namespace: 'reticulum-chat-file',
      ownerId: '82:sender',
      fileName: 'shared.bin',
      mimeType: 'application/octet-stream',
      encrypted: false,
      metadata: { groupId: 82, eventId: 'event-file-group-82' },
    });
    resourceStore.recordReference({
      manifest,
      scopeType: 'group',
      scopeId: 81,
      eventId: 'event-file-group-81',
      locallyAuthored: true,
    });
    resourceStore.recordReference({
      manifest: secondManifest,
      scopeType: 'group',
      scopeId: 82,
      eventId: 'event-file-group-82',
      locallyAuthored: true,
    });

    const offeredResources: Array<Record<string, unknown>> = [];
    const authorizations: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      sendReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        offeredResources.push(payload);
        return { ok: true as const };
      },
      authorizeReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        authorizations.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([81]);

    const range: [number, number] = [0, RETICULUM_RESOURCE_RANGE_SIZE];
    const request = signedResourceRequestWire({
      groupId: 81,
      fileHash: manifest.fileHash,
      byteRanges: [range],
      timestamp: 100_000,
    });
    manager.handleGenericResourceEvent({
      status: 'auth',
      linkId: 'resource-link-multi-group',
      transferId: 'multi-group-transfer',
      peerPresenceHash: 'a'.repeat(32),
      auth: {
        ...request,
        type: 'RETICULUM_GROUP_RESOURCE_AUTH',
        transferId: 'multi-group-transfer',
        groupId: 81,
        contextId: 81,
        fileHash: manifest.fileHash,
        totalSizeBytes: manifest.sizeBytes,
        byteRanges: [range],
        requesterPeerHash: 'a'.repeat(32),
      },
    });
    await vi.waitFor(() => expect(offeredResources).toHaveLength(1));

    expect(
      resourceStore.getManifest(manifest.fileHash)?.metadata?.groupId
    ).toBe(81);
    expect(resourceStore.hasLiveReference(manifest.fileHash, 'group', 81)).toBe(
      true
    );
    expect(resourceStore.hasLiveReference(manifest.fileHash, 'group', 82)).toBe(
      true
    );
    expect(offeredResources).toHaveLength(1);
    expect(offeredResources[0].metadata).toEqual(
      expect.objectContaining({
        fileHash: manifest.fileHash,
        byteRanges: [range],
      })
    );
    expect(authorizations).toEqual([
      {
        linkId: 'resource-link-multi-group',
        transferId: 'multi-group-transfer',
      },
    ]);
    manager.close();
    resourceStore.close();
  });

  it('starts resource discovery after Core validates the local signer even when local membership cache is stale', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-stale-local-membership-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.concat([
      Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 4),
      Buffer.from('remaining bytes'),
    ]);
    const fileHash = nodeCrypto
      .createHash('sha256')
      .update(contents)
      .digest('hex');
    const manifest = {
      namespace: 'reticulum-chat-image',
      ownerId: '78:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 78 },
    };
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'f'.repeat(32),
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });

    await expect(
      manager.requestResource(
        78,
        manifest,
        'b5941e04-b24f-4443-bcc7-05271585737b'
      )
    ).resolves.toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const findWire = sent.find((wire) => wire.k === 'rf') as any;
    expect(findWire).toEqual(
      expect.objectContaining({ t: 'RCHAT', k: 'rf', g: 78 })
    );
    expect(findWire.f).toBe(fileHash);
    expect(findWire.s).toBe(manifest.sizeBytes);
    expect(byteLengthUtf8JsonWithBridgeSender(findWire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    manager.close();
    resourceStore.close();
  });

  it('uses event sources for discovery without treating them as resource providers', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-owner-peer-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 9);
    const ownerAddress = 'QownerAddress';
    const ownerPeer = 'a'.repeat(32);
    const relayPeer = 'b'.repeat(32);
    const localPeer = 'f'.repeat(32);
    const manifest = {
      namespace: 'reticulum-chat-image',
      ownerId: `78:${ownerAddress}`,
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash: nodeCrypto.createHash('sha256').update(contents).digest('hex'),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 78 },
    };
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const accepts: Array<Record<string, unknown>> = [];
    const fanouts: Array<{
      messages: Record<string, unknown>[];
      exclude?: string[];
    }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => localPeer,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      acceptReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepts.push(payload);
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[],
        exclude?: string[]
      ) => {
        fanouts.push({ messages, exclude });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
      getVerifiedReticulumPeers: () => [
        { address: ownerAddress, destinationHash: ownerPeer, lastSeen: 99_000 },
      ],
    });
    manager.setLocalGroupMemberships([78]);
    manager.subscribeGroup(78);
    (manager as any).noteEventSourcePeer('event-with-image', relayPeer);

    await expect(
      manager.requestResource(78, manifest, 'event-with-image')
    ).resolves.toMatchObject({
      ok: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(accepts).toHaveLength(0);
    const directFind = direct.find(
      (item) => item.peer === relayPeer && item.wire.k === 'rf'
    );
    expect(directFind?.wire).toMatchObject({
      k: 'rf',
      g: 78,
      f: manifest.fileHash,
      s: manifest.sizeBytes,
    });
    expect(direct.some((item) => item.peer === ownerPeer)).toBe(false);
    const findFanout = fanouts.find((call) =>
      call.messages.some((wire) => wire.k === 'rf')
    );
    expect(findFanout?.exclude).toEqual([relayPeer, localPeer]);
    const findWire = findFanout?.messages.find((wire) => wire.k === 'rf') as
      | Record<string, unknown>
      | undefined;
    expect(findWire).toMatchObject({
      k: 'rf',
      g: 78,
      f: manifest.fileHash,
      s: manifest.sizeBytes,
    });
    expect(findWire?.h).toBeUndefined();
    expect(findWire?.m).toBeUndefined();

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 78,
        fh: manifest.fileHash,
        s: manifest.sizeBytes,
        rid: directFind?.wire.q,
      },
      relayPeer
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(accepts).toHaveLength(1);
    expect(accepts[0]).toMatchObject({
      peerPresenceHash: relayPeer,
      resourceType: 'reticulum_group_resource_range',
    });
    expect((accepts[0].authMessage as Record<string, unknown>)?.type).toBe(
      'RETICULUM_GROUP_RESOURCE_AUTH'
    );
    manager.close();
    resourceStore.close();
  });

  it('adds resource_have responders as candidates without counting them as proven sources', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-have-peer-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 10);
    const manifest = {
      namespace: 'reticulum-chat-image',
      ownerId: '78:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash: nodeCrypto.createHash('sha256').update(contents).digest('hex'),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 78 },
    };
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const accepts: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      acceptReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepts.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([78]);
    manager.subscribeGroup(78);

    await expect(
      manager.requestResource(78, manifest, 'event-with-image')
    ).resolves.toMatchObject({
      ok: true,
    });
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 78,
        fh: manifest.fileHash,
        s: manifest.sizeBytes,
      },
      'c'.repeat(32)
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const status = manager.getResourceDownloadStatus(manifest.fileHash);
    expect(status.candidatePeerCount).toBe(1);
    expect(status.peerCount).toBe(0);
    expect(
      accepts.some((item) => item.peerPresenceHash === 'c'.repeat(32))
    ).toBe(true);
    manager.close();
    resourceStore.close();
  });

  it('removes a resource provider candidate after resource_unavailable', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-unavailable-peer-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 11);
    const manifest = {
      namespace: 'reticulum-chat-image',
      ownerId: '78:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash: nodeCrypto.createHash('sha256').update(contents).digest('hex'),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 78 },
    };
    const providerPeer = 'd'.repeat(32);
    const accepts: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
      acceptReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepts.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([78]);
    manager.subscribeGroup(78);

    await expect(
      manager.requestResource(78, manifest, 'event-with-image')
    ).resolves.toMatchObject({
      ok: true,
    });
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 78,
        fh: manifest.fileHash,
        s: manifest.sizeBytes,
      },
      providerPeer
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(accepts).toHaveLength(1);
    expect(
      manager.getResourceDownloadStatus(manifest.fileHash).candidatePeerCount
    ).toBe(1);

    manager.handleGenericResourceEvent({
      status: 'failed',
      transferId: String(accepts[0].transferId),
      reason: 'resource_unavailable',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      manager.getResourceDownloadStatus(manifest.fileHash).candidatePeerCount
    ).toBe(0);
    manager.close();
    resourceStore.close();
  });

  it('clears exhausted range attempts when a user retries a resource download', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-user-retry-')
    );
    let nowMs = 100_000;
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => nowMs,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 12);
    const manifest = {
      namespace: 'reticulum-chat-file',
      ownerId: '78:sender',
      fileName: 'retry.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash: nodeCrypto.createHash('sha256').update(contents).digest('hex'),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 78 },
    };
    const accepts: Array<Record<string, unknown>> = [];
    const bridge = new EventEmitter() as EventEmitter & Record<string, unknown>;
    bridge.on = bridge.on.bind(bridge);
    bridge.off = bridge.off.bind(bridge);
    bridge.fanoutReticulumChatDetailed = async () => ({ ok: true as const });
    bridge.acceptReticulumResourceDetailed = async (
      payload: Record<string, unknown>
    ) => {
      accepts.push(payload);
      return { ok: true as const };
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => nowMs,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([78]);
    manager.subscribeGroup(78);

    await expect(
      manager.requestResource(78, manifest, 'event-with-file')
    ).resolves.toMatchObject({
      ok: true,
    });
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 78,
        fh: manifest.fileHash,
        s: manifest.sizeBytes,
      },
      'd'.repeat(32)
    );

    for (
      let attempt = 0;
      attempt < RETICULUM_RESOURCE_TRANSFER_MAX_RANGE_ATTEMPTS;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(accepts).toHaveLength(attempt + 1);
      bridge.emit('reticulum-resource', {
        status: 'failed',
        transferId: accepts[attempt].transferId,
      });
      nowMs += RETICULUM_RESOURCE_TRANSFER_PULL_THROTTLE_MS + 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(accepts).toHaveLength(
      RETICULUM_RESOURCE_TRANSFER_MAX_RANGE_ATTEMPTS
    );

    await expect(
      manager.requestResource(78, manifest, 'event-with-file')
    ).resolves.toMatchObject({
      ok: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(accepts).toHaveLength(
      RETICULUM_RESOURCE_TRANSFER_MAX_RANGE_ATTEMPTS + 1
    );
    manager.close();
    resourceStore.close();
  });

  it('does not rate-limit resource discovery when the discovery fanout fails', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-discovery-retry-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 11);
    const manifest = {
      namespace: 'reticulum-chat-image',
      ownerId: '78:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash: nodeCrypto.createHash('sha256').update(contents).digest('hex'),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 78 },
    };
    const discoveryResults = [
      {
        ok: false as const,
        reason: 'no-overlay-route' as const,
        error: 'No overlay route',
      },
      { ok: true as const },
    ];
    const discoveryCalls: Record<string, unknown>[][] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'f'.repeat(32),
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        if (messages.some((wire) => wire.k === 'rf')) {
          discoveryCalls.push(messages);
          return discoveryResults.shift() ?? { ok: true as const };
        }
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });

    await expect(
      manager.requestResource(78, manifest, 'event-with-image')
    ).resolves.toMatchObject({
      ok: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(
      manager.requestResource(78, manifest, 'event-with-image')
    ).resolves.toMatchObject({
      ok: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(discoveryCalls).toHaveLength(2);
    manager.close();
    resourceStore.close();
  });

  it('forwards signed resource discovery and routes provider replies back to the origin', async () => {
    const localPeer = '4'.repeat(32);
    const reversePeer = '2'.repeat(32);
    const providerHop = '3'.repeat(32);
    const providerPeer = '9'.repeat(32);
    const fileHash = 'a'.repeat(64);
    const direct: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const accepts: Array<Record<string, unknown>> = [];
    const fanouts: Array<{
      messages: ReticulumChatWire[];
      exclude?: string[];
    }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => localPeer,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      acceptReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepts.push(payload);
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async (
        messages: ReticulumChatWire[],
        exclude?: string[]
      ) => {
        fanouts.push({ messages, exclude });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async (groupId, address) =>
        groupId === 78 && Boolean(address),
    });
    const findWire = signedResourceFindWire({
      groupId: 78,
      requestId: 'b'.repeat(16),
      eventId: 'event-with-image',
      fileHash,
      sizeBytes: 1_048_576,
      hop: 0,
      maxHops: 5,
      expiresAt: 130_000,
      timestamp: 100_000,
    });

    manager.handleWire(findWire, reversePeer);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const forwarded = fanouts.find((call) =>
      call.messages.some((wire) => wire.k === 'rf')
    );
    expect(forwarded?.exclude).toEqual([reversePeer, localPeer]);
    expect(forwarded?.messages[0]).toMatchObject({
      k: 'rf',
      q: findWire.q,
      h: 1,
    });
    expect(forwarded?.messages[0]?.m).toBeUndefined();

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 78,
        fh: fileHash,
        s: 1_048_576,
        rid: findWire.q,
        sp: providerPeer,
      },
      providerHop
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      direct.some(
        (item) =>
          item.peer === reversePeer &&
          item.wire.k === 'resource_have' &&
          item.wire.rid === findWire.q &&
          typeof item.wire.sp === 'string'
      )
    ).toBe(true);
    manager.close();
  });

  it('forwards signed resource discovery without validating membership on relay-only hops', async () => {
    const localPeer = '4'.repeat(32);
    const reversePeer = '2'.repeat(32);
    const fileHash = 'a'.repeat(64);
    const fanouts: Array<{
      messages: ReticulumChatWire[];
      exclude?: string[];
    }> = [];
    const validateGroupMember = vi.fn(async () => false);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => localPeer,
      fanoutReticulumChatDetailed: async (
        messages: ReticulumChatWire[],
        exclude?: string[]
      ) => {
        fanouts.push({ messages, exclude });
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember,
    });
    const findWire = signedResourceFindWire({
      groupId: 78,
      requestId: 'd'.repeat(16),
      fileHash,
      sizeBytes: 1_048_576,
      hop: 0,
      maxHops: 5,
      expiresAt: 130_000,
      timestamp: 100_000,
    });

    manager.handleWire(findWire, reversePeer);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(validateGroupMember).not.toHaveBeenCalled();
    expect(
      fanouts.some((call) => call.messages.some((wire) => wire.k === 'rf'))
    ).toBe(true);
    manager.close();
  });

  it('validates membership before answering resource discovery as a provider', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-find-provider-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 18);
    const fileHash = nodeCrypto
      .createHash('sha256')
      .update(contents)
      .digest('hex');
    const manifest = {
      namespace: 'reticulum-chat-image',
      ownerId: '78:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 78 },
    };
    resourceStore.storeManifest(manifest);
    resourceStore.storeByteRange(fileHash, 0, contents.length, contents);
    const direct: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const fanouts: Array<{
      messages: ReticulumChatWire[];
      exclude?: string[];
    }> = [];
    const validateGroupMember = vi.fn(async () => false);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => '4'.repeat(32),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async (
        messages: ReticulumChatWire[],
        exclude?: string[]
      ) => {
        fanouts.push({ messages, exclude });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      validateGroupMember,
    });
    manager.setLocalGroupMemberships([78]);
    const findWire = signedResourceFindWire({
      groupId: 78,
      requestId: 'e'.repeat(16),
      fileHash,
      sizeBytes: contents.length,
      hop: 0,
      maxHops: 5,
      expiresAt: 130_000,
      timestamp: 100_000,
    });

    manager.handleWire(findWire, '2'.repeat(32));
    await vi.waitFor(() =>
      expect(validateGroupMember).toHaveBeenCalledTimes(1)
    );

    expect(direct.some((item) => item.wire.k === 'resource_have')).toBe(false);
    expect(
      fanouts.some((call) => call.messages.some((wire) => wire.k === 'rf'))
    ).toBe(false);
    manager.close();
    resourceStore.close();
  });

  it('answers resource discovery from cached data even when the provider account is not locally in the group', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-cache-provider-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.from('cached image bytes');
    const fileHash = nodeCrypto
      .createHash('sha256')
      .update(contents)
      .digest('hex');
    resourceStore.storeManifest({
      namespace: 'reticulum-chat-image',
      ownerId: '78:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 78 },
    });
    resourceStore.storeByteRange(fileHash, 0, contents.length, contents);

    const direct: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const validateGroupMember = vi.fn(
      async (groupId, address) => groupId === 78 && Boolean(address)
    );
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => '4'.repeat(32),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      validateGroupMember,
    });
    const findWire = signedResourceFindWire({
      groupId: 78,
      requestId: 'f'.repeat(16),
      fileHash,
      sizeBytes: contents.length,
      hop: 0,
      maxHops: 5,
      expiresAt: 130_000,
      timestamp: 100_000,
    });

    manager.handleWire(findWire, '2'.repeat(32));
    await vi.waitFor(() =>
      expect(validateGroupMember).toHaveBeenCalledTimes(1)
    );

    expect(
      direct.some(
        (item) =>
          item.peer === '2'.repeat(32) &&
          item.wire.k === 'resource_have' &&
          item.wire.rid === findWire.q
      )
    ).toBe(true);

    manager.close();
    resourceStore.close();
  });

  it('routes byte-range requests through the discovered provider path', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-provider-route-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 17);
    const manifest = {
      namespace: 'reticulum-chat-image',
      ownerId: '78:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash: nodeCrypto.createHash('sha256').update(contents).digest('hex'),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 78 },
    };
    const localPeer = 'f'.repeat(32);
    const nextHop = '5'.repeat(32);
    const providerPeer = '6'.repeat(32);
    const direct: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const accepts: Array<Record<string, unknown>> = [];
    const resourceOrder: string[] = [];
    const fanouts: Array<{
      messages: ReticulumChatWire[];
      exclude?: string[];
    }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => localPeer,
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      acceptReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        resourceOrder.push('accept');
        accepts.push(payload);
        return { ok: true as const };
      },
      ensureReticulumResourceSessionDetailed: async (
        payload: Record<string, unknown>
      ) => {
        resourceOrder.push('session');
        expect(payload).toEqual(
          expect.objectContaining({
            peerPresenceHash: providerPeer,
            resourceType: 'reticulum_group_resource_range',
          })
        );
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async (
        messages: ReticulumChatWire[],
        exclude?: string[]
      ) => {
        fanouts.push({ messages, exclude });
        return { ok: true as const };
      },
    };
    const baseSigner = createReticulumChatTestSigner();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: async (fields) => {
        if ((fields as { type?: string }).type === 'RCHAT_RESOURCE_REQ') {
          resourceOrder.push('sign');
        }
        return baseSigner(fields);
      },
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([78]);
    manager.subscribeGroup(78);

    await expect(
      manager.requestResource(78, manifest, 'event-with-image')
    ).resolves.toMatchObject({
      ok: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const findWire = fanouts
      .flatMap((call) => call.messages)
      .find(
        (wire): wire is Extract<ReticulumChatWire, { k: 'rf' }> =>
          wire.k === 'rf'
      );
    expect(findWire).toBeTruthy();
    resourceOrder.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 78,
        fh: manifest.fileHash,
        s: manifest.sizeBytes,
        rid: findWire!.q,
        sp: providerPeer,
      },
      nextHop
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(accepts).toHaveLength(1);
    expect(resourceOrder).toEqual(['session', 'sign', 'accept']);
    expect(accepts[0]).toMatchObject({
      peerPresenceHash: providerPeer,
      resourceType: 'reticulum_group_resource_range',
    });
    manager.close();
    resourceStore.close();
  });

  it('does not reset a throttled resource download retry when the same resource is requested again', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-throttle-repeat-')
    );
    let nowMs = 100_000;
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => nowMs,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE * 2, 7);
    const providerPeer = 'a'.repeat(32);
    const manifest = {
      namespace: 'reticulum-chat-image',
      ownerId: '78:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash: nodeCrypto.createHash('sha256').update(contents).digest('hex'),
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 78 },
    };
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getOverlayLinkSnapshots: () => [
        {
          peerPresenceHash: providerPeer,
          lastRxAt: nowMs - 31_000,
        },
      ],
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => nowMs,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([78]);
    manager.subscribeGroup(78);

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [78], mode: 'summary' },
      providerPeer
    );
    (manager as any).noteEventSourcePeer(
      'b5941e04-b24f-4443-bcc7-05271585737b',
      providerPeer
    );
    await expect(
      manager.requestResource(
        78,
        manifest,
        'b5941e04-b24f-4443-bcc7-05271585737b'
      )
    ).resolves.toMatchObject({ ok: true });
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 78,
        fh: manifest.fileHash,
        s: manifest.sizeBytes,
      },
      providerPeer
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    const firstRetryAt = manager.getResourceDownloadStatus(
      manifest.fileHash
    ).nextRequestAt;
    expect(firstRetryAt).toBe(
      nowMs + RETICULUM_RESOURCE_TRANSFER_OVERLAY_THROTTLE_RETRY_MS
    );

    nowMs += 100;
    await expect(
      manager.requestResource(
        78,
        manifest,
        'b5941e04-b24f-4443-bcc7-05271585737b'
      )
    ).resolves.toMatchObject({ ok: true });

    expect(
      manager.getResourceDownloadStatus(manifest.fileHash).nextRequestAt
    ).toBe(firstRetryAt);
    manager.close();
    resourceStore.close();
  });

  it('opens a direct byte-range link to a resource_have provider', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-relayed-source-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 9);
    const fileHash = nodeCrypto
      .createHash('sha256')
      .update(contents)
      .digest('hex');
    const manifest = {
      namespace: 'reticulum-chat-file',
      ownerId: '92:sender',
      fileName: 'source.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 92 },
    };
    const accepted: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      acceptReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepted.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([92]);
    manager.subscribeGroup(92);

    await expect(manager.requestResource(92, manifest)).resolves.toMatchObject({
      ok: true,
    });
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 92,
        fh: fileHash,
        s: contents.length,
      },
      '8'.repeat(32)
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toEqual(
      expect.objectContaining({
        peerPresenceHash: '8'.repeat(32),
        resourceType: 'reticulum_group_resource_range',
      })
    );
    expect(accepted[0].metadata).toEqual(
      expect.objectContaining({
        fileHash,
        totalSizeBytes: contents.length,
        byteRanges: [[0, contents.length]],
      })
    );
    expect((accepted[0].authMessage as Record<string, unknown>)?.type).toBe(
      'RETICULUM_GROUP_RESOURCE_AUTH'
    );
    manager.close();
    resourceStore.close();
  });

  it('resolves provider identity before opening a byte-range resource link', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-identity-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 4);
    const fileHash = nodeCrypto
      .createHash('sha256')
      .update(contents)
      .digest('hex');
    const providerHash = '8'.repeat(32);
    const publicKey = Buffer.alloc(64, 9).toString('base64');
    const manifest = {
      namespace: 'reticulum-chat-file',
      ownerId: '92:sender',
      fileName: 'identity.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 92 },
    };
    const fanout: Array<Record<string, unknown>> = [];
    const accepted: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      ensurePeerIdentityKnown: async () => false,
      registerPeerIdentityFromGroupJoin: async () => true,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        fanout.push(...messages);
        return { ok: true as const };
      },
      acceptReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepted.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([92]);
    manager.subscribeGroup(92);

    await expect(manager.requestResource(92, manifest)).resolves.toMatchObject({
      ok: true,
    });
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 92,
        fh: fileHash,
        s: contents.length,
      },
      providerHash
    );
    await new Promise((resolve) => setTimeout(resolve, 40));

    const identityReq = fanout.find((wire) => wire.k === 'identity_req');
    expect(identityReq).toEqual(
      expect.objectContaining({
        k: 'identity_req',
        d: expect.any(String),
      })
    );
    expect(accepted).toHaveLength(0);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'identity_offer',
        d: providerHash,
        rk: publicKey,
        rid: identityReq?.rid,
      },
      providerHash
    );
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(accepted).toContainEqual(
      expect.objectContaining({
        peerPresenceHash: providerHash,
        reticulumIdentityPublicKeyBase64: publicKey,
        resourceType: 'reticulum_group_resource_range',
      })
    );
    manager.close();
    resourceStore.close();
  });

  it('uses a resource_have provider public key without an extra identity request', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-have-key-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 5);
    const fileHash = nodeCrypto
      .createHash('sha256')
      .update(contents)
      .digest('hex');
    const providerHash = '8'.repeat(32);
    const publicKey = Buffer.alloc(64, 10).toString('base64');
    const manifest = {
      namespace: 'reticulum-chat-file',
      ownerId: '92:sender',
      fileName: 'provider-key.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 92 },
    };
    const fanout: Array<Record<string, unknown>> = [];
    const accepted: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      ensurePeerIdentityKnown: async () => false,
      registerPeerIdentityFromGroupJoin: async () => true,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        fanout.push(...messages);
        return { ok: true as const };
      },
      acceptReticulumResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        accepted.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([92]);
    manager.subscribeGroup(92);

    await expect(manager.requestResource(92, manifest)).resolves.toMatchObject({
      ok: true,
    });
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 92,
        fh: fileHash,
        s: contents.length,
        rk: publicKey,
      },
      providerHash
    );
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(fanout.find((wire) => wire.k === 'identity_req')).toBeUndefined();
    expect(accepted).toContainEqual(
      expect.objectContaining({
        peerPresenceHash: providerHash,
        reticulumIdentityPublicKeyBase64: publicKey,
        resourceType: 'reticulum_group_resource_range',
      })
    );
    manager.close();
    resourceStore.close();
  });

  it('opens each missing byte range once for repeated resource_have from the same provider', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-duplicate-range-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.concat([
      Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 5),
      Buffer.from('tail'),
    ]);
    const fileHash = nodeCrypto
      .createHash('sha256')
      .update(contents)
      .digest('hex');
    const manifest = {
      namespace: 'reticulum-chat-image',
      ownerId: '80:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 80 },
    };
    let accepts = 0;
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      acceptReticulumResourceDetailed: async () => {
        accepts += 1;
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([80]);
    manager.subscribeGroup(80);

    await expect(manager.requestResource(80, manifest)).resolves.toMatchObject({
      ok: true,
    });
    for (let index = 0; index < 2; index += 1) {
      manager.handleWire(
        {
          t: 'RCHAT',
          k: 'resource_have',
          g: 80,
          fh: fileHash,
          s: contents.length,
        },
        'd'.repeat(32)
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(accepts).toBe(2);
    expect(manager.getResourceDownloadStatus(fileHash)).toMatchObject({
      activeTransfers: 2,
      inFlightRangeCount: 2,
    });
    manager.close();
    resourceStore.close();
  });

  it('emits live progress while a byte-range transfer is receiving', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-live-progress-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const contents = Buffer.concat([
      Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 1),
      Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 2),
    ]);
    const fileHash = nodeCrypto
      .createHash('sha256')
      .update(contents)
      .digest('hex');
    const manifest = {
      namespace: 'reticulum-chat-file',
      ownerId: '83:receiver',
      fileName: 'bundle.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 83 },
    };
    const bridge = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const accepted: Array<Record<string, unknown>> = [];
    bridge.fanoutReticulumChatDetailed = async () => ({ ok: true as const });
    bridge.acceptReticulumResourceDetailed = async (
      payload: Record<string, unknown>
    ) => {
      accepted.push(payload);
      return { ok: true as const };
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    const progressEvents: Array<Record<string, unknown>> = [];
    manager.on('resource', (payload) =>
      progressEvents.push(payload as Record<string, unknown>)
    );
    manager.setLocalGroupMemberships([83]);
    manager.subscribeGroup(83);

    await expect(manager.requestResource(83, manifest)).resolves.toMatchObject({
      ok: true,
    });
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 83,
        fh: fileHash,
        s: contents.length,
      },
      'e'.repeat(32)
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(accepted).toHaveLength(2);

    bridge.emit('reticulum-resource', {
      status: 'receiving',
      transferId: accepted[0].transferId,
      progress: 0.5,
      bytesTransferred: RETICULUM_RESOURCE_RANGE_SIZE / 2,
      bytesPerSecond: 12_345,
    });

    expect(progressEvents).toContainEqual(
      expect.objectContaining({
        fileHash,
        bytesTransferred: RETICULUM_RESOURCE_RANGE_SIZE / 2,
        totalBytes: contents.length,
        progress: 0.25,
      })
    );
    manager.close();
    resourceStore.close();
  });

  it('cancels an active resource download and deletes partial byte ranges', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-cancel-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const first = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 21);
    const second = Buffer.from('tail bytes');
    const contents = Buffer.concat([first, second]);
    const fileHash = nodeCrypto
      .createHash('sha256')
      .update(contents)
      .digest('hex');
    const manifest = {
      namespace: 'reticulum-chat-file',
      ownerId: '86:receiver',
      fileName: 'cancel.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: contents.length,
      fileHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 86 },
    };
    resourceStore.storeManifest(manifest);
    resourceStore.storeByteRange(fileHash, 0, first.length, first);
    const partialPath = resourceStore.getPartialPath(fileHash);
    expect(partialPath && fs.existsSync(partialPath)).toBe(true);
    const bridge = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const accepted: Array<Record<string, unknown>> = [];
    bridge.fanoutReticulumChatDetailed = vi.fn(async () => ({
      ok: true as const,
    }));
    bridge.acceptReticulumResourceDetailed = vi.fn(
      async (payload: Record<string, unknown>) => {
        accepted.push(payload);
        return { ok: true as const };
      }
    );
    bridge.cancelReticulumResourceDetailed = vi.fn(async () => ({
      ok: true as const,
    }));
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    const progressEvents: Array<Record<string, unknown>> = [];
    manager.on('resource', (payload) =>
      progressEvents.push(payload as Record<string, unknown>)
    );
    manager.setLocalGroupMemberships([86]);
    manager.subscribeGroup(86);

    await expect(manager.requestResource(86, manifest)).resolves.toMatchObject({
      ok: true,
    });
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 86,
        fh: fileHash,
        s: contents.length,
      },
      'f'.repeat(32)
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(accepted).toHaveLength(1);

    expect(manager.getResourceDownloadStatus(fileHash)).toMatchObject({
      active: true,
      activeTransfers: 1,
      inFlightRangeCount: 1,
    });
    await expect(manager.cancelResource(fileHash)).resolves.toBe(true);
    expect(bridge.cancelReticulumResourceDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        transferId: accepted[0].transferId,
        peerPresenceHash: 'f'.repeat(32),
        reason: 'user_cancelled',
      })
    );
    expect(manager.getResourceDownloadStatus(fileHash)).toMatchObject({
      active: false,
      activeTransfers: 0,
      pendingTransfers: 0,
      inFlightRangeCount: 0,
    });
    expect(progressEvents).toContainEqual(
      expect.objectContaining({
        fileHash,
        canceled: true,
        failed: false,
      })
    );
    expect(resourceStore.getCompletedRanges(fileHash)).toEqual([]);
    expect(partialPath && fs.existsSync(partialPath)).toBe(false);
    manager.close();
    resourceStore.close();
  });

  it('keeps active direct ranges per provider within the configured resource cap', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-one-peer-link-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const parts = Array.from(
      { length: RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE + 2 },
      (_, index) => Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, index + 7)
    );
    const contents = Buffer.concat(parts);
    const fileHash = nodeCrypto
      .createHash('sha256')
      .update(contents)
      .digest('hex');
    const manifest = {
      namespace: 'reticulum-chat-image',
      ownerId: '80:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: contents.length,
      fileHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 80 },
    };
    let now = 100_000;
    let accepts = 0;
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      acceptReticulumResourceDetailed: async () => {
        accepts += 1;
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([80]);
    manager.subscribeGroup(80);

    await expect(manager.requestResource(80, manifest)).resolves.toMatchObject({
      ok: true,
    });
    for (let index = 0; index < 3; index += 1) {
      manager.handleWire(
        {
          t: 'RCHAT',
          k: 'resource_have',
          g: 80,
          fh: fileHash,
          s: contents.length,
        },
        'a'.repeat(32)
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(accepts).toBe(RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE);
    expect(manager.getResourceDownloadStatus(fileHash)).toMatchObject({
      activeTransfers: RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE,
      pendingTransfers: 0,
      inFlightRangeCount: RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE,
    });

    now += RETICULUM_RESOURCE_TRANSFER_IN_FLIGHT_STALE_MS + 1;
    manager.getResourceDownloadStatus(fileHash);
    await expect(manager.requestResource(80, manifest)).resolves.toMatchObject({
      ok: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(accepts).toBe(RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE * 2);
    expect(manager.getResourceDownloadStatus(fileHash)).toMatchObject({
      activeTransfers: RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE,
      pendingTransfers: 0,
    });
    manager.close();
    resourceStore.close();
  });

  it('keeps active transfer limits scoped per resource so an image is not blocked by a large file', async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-peer-resource-link-')
    );
    const resourceStore = new ReticulumResourceStore({
      dbPath: path.join(tempRoot, 'resources.db'),
      rootDir: path.join(tempRoot, 'resources'),
      now: () => 100_000,
    });
    const largeParts = Array.from(
      { length: RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE },
      (_, index) => Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, index + 14)
    );
    const imageBytes = Buffer.alloc(RETICULUM_RESOURCE_RANGE_SIZE, 18);
    const largeBytes = Buffer.concat(largeParts);
    const largeHash = nodeCrypto
      .createHash('sha256')
      .update(largeBytes)
      .digest('hex');
    const imageHash = nodeCrypto
      .createHash('sha256')
      .update(imageBytes)
      .digest('hex');
    const largeManifest = {
      namespace: 'reticulum-chat-file',
      ownerId: '82:sender',
      fileName: 'large.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: largeBytes.length,
      fileHash: largeHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 82 },
    };
    const imageManifest = {
      namespace: 'reticulum-chat-image',
      ownerId: '82:sender',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      sizeBytes: imageBytes.length,
      fileHash: imageHash,
      encrypted: false,
      createdAt: 100_000,
      metadata: { groupId: 82 },
    };
    let accepts = 0;
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      acceptReticulumResourceDetailed: async () => {
        accepts += 1;
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      resourceStore,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([82]);
    manager.subscribeGroup(82);

    await expect(
      manager.requestResource(82, largeManifest)
    ).resolves.toMatchObject({ ok: true });
    await expect(
      manager.requestResource(82, imageManifest)
    ).resolves.toMatchObject({ ok: true });
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 82,
        fh: largeHash,
        s: largeBytes.length,
      },
      'a'.repeat(32)
    );
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'resource_have',
        g: 82,
        fh: imageHash,
        s: imageBytes.length,
      },
      'a'.repeat(32)
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(accepts).toBe(RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE + 1);
    expect(manager.getResourceDownloadStatus(largeHash)).toMatchObject({
      activeTransfers: RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE,
      pendingTransfers: 0,
      inFlightRangeCount: RETICULUM_RESOURCE_TRANSFER_ACCEPTS_PER_RESOURCE,
    });
    expect(manager.getResourceDownloadStatus(imageHash)).toMatchObject({
      activeTransfers: 1,
      pendingTransfers: 0,
      inFlightRangeCount: 1,
    });
    manager.close();
    resourceStore.close();
  });

  it('subscribes with hello, group_sub, and bounded digest only', async () => {
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
    });
    manager.setLocalGroupMemberships([48]);
    manager.subscribeGroup(48);
    await flushQueuedWork();
    expect(sent).toContainEqual(
      expect.objectContaining({ t: 'RCHAT', k: 'hello_v3', v: 3 })
    );
    expect(
      (sent.find((wire) => wire.k === 'hello_v3')?.f as string[]) ?? []
    ).not.toContain('public_activity_v1');
    expect(sent).toContainEqual(expect.objectContaining({
      t: 'RCHAT',
      k: 'group_sub',
      groups: [48],
      mode: 'summary',
    }));
    expect(sent).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        v: 3,
        k: 'group_state_digest_v3',
        g: 48,
      })
    );
    expect(sent.find((wire) => wire.k === 'sync_req')).toBeUndefined();
    expect(sent.find((wire) => wire.k === 'author_heads_req')).toBeUndefined();
    manager.close();
  });

  it('retries a failed group-state digest with the newest coalesced state', async () => {
    let now = 60_000;
    const sent: Record<string, unknown>[] = [];
    let shouldFail = true;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          sent.push(...messages);
          return shouldFail
            ? { ok: false as const, reason: 'bridge-overloaded' as const }
            : { ok: true as const };
        },
      } as any,
      now: () => now,
    });
    const firstDigest = {
      t: 'RCHAT',
      v: 3,
      k: 'group_state_digest_v3',
      g: 48,
      d: { eventHash: 'a'.repeat(64) },
    };
    const newestDigest = {
      ...firstDigest,
      d: { eventHash: 'b'.repeat(64) },
    };

    await (manager as any).fanout(firstDigest);
    await (manager as any).fanout(newestDigest);

    expect((manager as any).controlRetryQueue.size).toBe(1);
    shouldFail = false;
    now += 3_001;
    await (manager as any).drainControlRetryQueue();

    expect(sent.at(-1)).toEqual(newestDigest);
    expect((manager as any).controlRetryQueue.size).toBe(0);
    manager.close();
  });

  it('cancels a queued group-state digest retry after leaving the group', async () => {
    let now = 60_000;
    let sendCount = 0;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => {
          sendCount += 1;
          return { ok: false as const, reason: 'bridge-overloaded' as const };
        },
      } as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([48]);
    (manager as any).subscribedGroups.add(48);
    sendCount = 0;
    await (manager as any).fanout({
      t: 'RCHAT',
      v: 3,
      k: 'group_state_digest_v3',
      g: 48,
      d: { eventHash: 'a'.repeat(64) },
    });
    expect((manager as any).controlRetryQueue.size).toBe(1);

    manager.unsubscribeGroup(48);
    const sendsAfterUnsubscribe = sendCount;
    now += 3_001;
    await (manager as any).drainControlRetryQueue();

    expect(sendCount).toBe(sendsAfterUnsubscribe);
    expect((manager as any).controlRetryQueue.size).toBe(0);
    manager.close();
  });

  it('does not let an older successful digest cancel a newer digest retry', async () => {
    const newerDigest = {
      t: 'RCHAT',
      v: 3,
      k: 'group_state_digest_v3',
      g: 48,
      d: { eventHash: 'b'.repeat(64) },
    };
    const olderDigest = {
      ...newerDigest,
      d: { eventHash: 'a'.repeat(64) },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) =>
          messages[0] === newerDigest
            ? { ok: false as const, reason: 'bridge-overloaded' as const }
            : { ok: true as const },
      } as any,
      now: () => 60_000,
    });

    await (manager as any).fanout(newerDigest);
    await (manager as any).fanout(olderDigest);

    expect((manager as any).controlRetryQueue.size).toBe(1);
    expect([...(manager as any).controlRetryQueue.values()][0].wire).toEqual(
      newerDigest
    );
    manager.close();
  });

  it('keeps a newer digest queued when an in-flight older retry succeeds', async () => {
    let now = 60_000;
    let resolveRetry!: (result: { ok: true }) => void;
    const retryResult = new Promise<{ ok: true }>((resolve) => {
      resolveRetry = resolve;
    });
    let retryStarted = false;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => {
          retryStarted = true;
          return retryResult;
        },
      } as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([48]);
    (manager as any).subscribedGroups.add(48);
    const olderDigest = {
      t: 'RCHAT',
      v: 3,
      k: 'group_state_digest_v3',
      g: 48,
      d: { eventHash: 'a'.repeat(64) },
    };
    const newerDigest = {
      ...olderDigest,
      d: { eventHash: 'b'.repeat(64) },
    };
    (manager as any).enqueueControlRetry({ wire: olderDigest });
    now += 3_001;

    const drain = (manager as any).drainControlRetryQueue();
    await vi.waitUntil(() => retryStarted, { timeout: 1_000 });
    (manager as any).enqueueControlRetry({ wire: newerDigest });
    resolveRetry({ ok: true });
    await drain;

    expect((manager as any).controlRetryQueue.size).toBe(1);
    expect([...(manager as any).controlRetryQueue.values()][0].wire).toEqual(
      newerDigest
    );
    manager.close();
  });

  it('does not retry a digest when fanout has no route', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({
          ok: false as const,
          reason: 'no-route' as const,
        }),
      } as any,
    });

    await (manager as any).fanout({
      t: 'RCHAT',
      v: 3,
      k: 'group_state_digest_v3',
      g: 48,
      d: { eventHash: 'a'.repeat(64) },
    });

    expect((manager as any).controlRetryQueue.size).toBe(0);
    manager.close();
  });

  it('reserves shared retry capacity by bounding queued digest retries', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => 60_000,
    });

    for (let groupId = 1; groupId <= 200; groupId += 1) {
      (manager as any).enqueueControlRetry({
        wire: {
          t: 'RCHAT',
          v: 3,
          k: 'group_state_digest_v3',
          g: groupId,
          d: { eventHash: String(groupId).padStart(64, '0') },
        },
      });
    }

    expect((manager as any).controlRetryQueue.size).toBe(128);
    manager.close();
  });

  it('cancels a direct digest retry after the peer unsubscribes', async () => {
    let now = 60_000;
    let sendCount = 0;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async () => {
          sendCount += 1;
          return { ok: false as const, reason: 'bridge-overloaded' as const };
        },
      } as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([48]);
    manager.subscribeGroup(48);
    (manager as any).notePeerSubscription('peer-a', 48, true);
    await (manager as any).sendToPeer('peer-a', {
      t: 'RCHAT',
      v: 3,
      k: 'group_state_digest_v3',
      g: 48,
      d: { eventHash: 'a'.repeat(64) },
    });
    expect((manager as any).controlRetryQueue.size).toBe(1);

    (manager as any).notePeerSubscription('peer-a', 48, false);
    now += 3_001;
    await (manager as any).drainControlRetryQueue();

    expect(sendCount).toBe(1);
    expect((manager as any).controlRetryQueue.size).toBe(0);
    manager.close();
  });

  it('subscription digest exposes latest cursor without requesting history', async () => {
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 60_000,
    });
    manager.setLocalGroupMemberships([49]);
    const event = signedEvent({ groupId: 49, timestamp: 50_000 });
    await manager.publishEvent(event);
    sent.length = 0;

    manager.subscribeGroup(49);
    await flushQueuedWork();
    expect(sent.find((wire) => wire.k === 'sync_req')).toBeUndefined();
    expect(
      sent.find((wire) => wire.k === 'group_state_digest_v3')
    ).toMatchObject({
      t: 'RCHAT',
      v: 3,
      k: 'group_state_digest_v3',
      g: 49,
      d: { latest: { id: event.eventId, ts: event.timestamp } },
    });
    manager.close();
  });

  it('does not trust persisted group history as a current subscription', async () => {
    const dbPath = tempDbPath();
    const persistedDb = new ReticulumChatDatabase(dbPath);
    persistedDb.insertEvent(signedEvent({ groupId: 58 }), false);
    persistedDb.close();
    const direct: Record<string, unknown>[] = [];
    const fanout: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        fanout.push(...messages);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
    };
    const localSigner = createReticulumChatTestSigner();
    const localIdentity = await localSigner({});
    if (!localIdentity) throw new Error('Expected test signer identity');
    const manager = new ReticulumChatManager({
      dbPath,
      bridge: bridge as any,
      now: () => 60_000,
      signLocalFields: localSigner,
      validateGroupMember: async () => true,
    });

    try {
      expect(manager.getSubscriptions()).toEqual([]);
      expect(fanout).toEqual([]);

      manager.subscribeGroup(58);
      manager.subscribeChannel(58, 'general');
      await flushQueuedWork();
      expect(manager.getSubscriptions()).toEqual([]);
      expect(fanout).toEqual([]);

      manager.handleWire(
        {
          t: 'RCHAT',
          v: 3,
          k: 'group_state_digest_v3',
          g: 58,
          d: { metadataSnapshotHash: 'a'.repeat(64) },
        },
        'peer'
      );
      await flushQueuedWork();
      expect(direct).toEqual([]);

      manager.setLocalGroupMemberships([]);
      manager.handleWire(
        {
          t: 'RCHAT',
          v: 3,
          k: 'group_state_digest_v3',
          g: 58,
          d: { metadataSnapshotHash: 'a'.repeat(64) },
        },
        'peer'
      );
      await flushQueuedWork();
      expect(direct).toEqual([]);

      manager.setLocalGroupMemberships([
        { groupId: 58, localAddress: 'QdifferentAccount' },
      ]);
      expect(manager.getSubscriptions()).toEqual([]);
      manager.subscribeGroup(58);
      await flushQueuedWork();
      expect(manager.getSubscriptions()).toEqual([58]);
      expect(fanout).toContainEqual(expect.objectContaining({
        t: 'RCHAT',
        k: 'group_sub',
        groups: [58],
        mode: 'summary',
      }));

      direct.length = 0;
      manager.handleWire(
        {
          t: 'RCHAT',
          v: 3,
          k: 'group_state_digest_v3',
          g: 58,
          d: { metadataSnapshotHash: 'a'.repeat(64) },
        },
        'peer'
      );
      await flushQueuedWork();
      expect(direct).toEqual([]);

      manager.setLocalGroupMemberships([
        { groupId: 58, localAddress: localIdentity.authorAddress },
      ]);
      manager.handleWire(
        {
          t: 'RCHAT',
          v: 3,
          k: 'group_state_digest_v3',
          g: 58,
          d: { metadataSnapshotHash: 'a'.repeat(64) },
        },
        'peer'
      );
      await vi.waitUntil(
        () => direct.some((wire) => wire.k === 'metadata_snapshot_req_v3'),
        {
          timeout: 1_000,
        }
      );
      expect(direct).toContainEqual(
        expect.objectContaining({
          t: 'RCHAT',
          v: 3,
          k: 'metadata_snapshot_req_v3',
          g: 58,
        })
      );

      direct.length = 0;
      manager.handleWire(
        { t: 'RCHAT', k: 'group_sub', groups: [58], mode: 'summary' },
        'peer'
      );
      await vi.waitUntil(
        () =>
          direct.some(
            (wire) => wire.k === 'group_state_digest_v3' && wire.g === 58
          ),
        { timeout: 1_000 }
      );
      expect(direct).toContainEqual(
        expect.objectContaining({
          t: 'RCHAT',
          v: 3,
          k: 'group_state_digest_v3',
          g: 58,
        })
      );
    } finally {
      manager.close();
    }
  });

  it('promotes a pre-sync subscription only after membership confirms it', async () => {
    const fanout: Record<string, unknown>[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
      } as any,
      now: () => 60_000,
    });

    manager.subscribeGroup(58);
    await flushQueuedWork();
    expect(manager.getSubscriptions()).toEqual([]);
    expect(fanout).toEqual([]);

    manager.setLocalGroupMemberships([58]);
    await flushQueuedWork();
    expect(manager.getSubscriptions()).toEqual([58]);
    expect(fanout).toContainEqual(expect.objectContaining({
      t: 'RCHAT',
      k: 'group_sub',
      groups: [58],
      mode: 'summary',
    }));
    manager.close();
  });

  it('active channel subscription still emits digest, not before/after sync requests', async () => {
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 80_000,
    });
    manager.setLocalGroupMemberships([56]);
    const firstLocal = signedEvent({
      eventId: 'event-partial-local-1',
      groupId: 56,
      authorSeq: 1,
      timestamp: 50_000,
    });
    const secondLocal = signedEvent({
      eventId: 'event-partial-local-2',
      groupId: 56,
      authorSeq: 2,
      timestamp: 60_000,
    });
    await manager.publishEvent(firstLocal);
    await manager.publishEvent(secondLocal);
    sent.length = 0;

    manager.subscribeChannel(56, 'general');
    await flushQueuedWork();

    expect(sent.filter((wire) => wire.k === 'sync_req')).toEqual([]);
    expect(sent).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'group_sub',
        groups: [56],
        mode: 'active',
      })
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        v: 3,
        k: 'group_state_digest_v3',
        g: 56,
      })
    );
    manager.close();
  });

  it('collapses repeated active channel subscription fanouts inside the debounce window', async () => {
    let now = 80_000;
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([56]);

    manager.subscribeChannel(56, 'general');
    const groupSubCountAfterFirst = sent.filter(
      (wire) => wire.k === 'group_sub'
    ).length;
    const digestCountAfterFirst = sent.filter(
      (wire) => wire.k === 'group_state_digest_v3'
    ).length;
    manager.subscribeChannel(56, 'general');
    manager.subscribeChannel(56, 'general');

    expect(sent.filter((wire) => wire.k === 'group_sub')).toHaveLength(
      groupSubCountAfterFirst
    );
    expect(
      sent.filter((wire) => wire.k === 'group_state_digest_v3')
    ).toHaveLength(digestCountAfterFirst);

    now += 31_000;
    manager.subscribeChannel(56, 'general');

    expect(sent.filter((wire) => wire.k === 'group_sub')).toHaveLength(
      groupSubCountAfterFirst
    );
    expect(
      sent.filter((wire) => wire.k === 'group_state_digest_v3')
    ).toHaveLength(digestCountAfterFirst);
    manager.close();
  });

  it('reannounces subscriptions with one batched group_sub instead of one per group', async () => {
    let now = 80_000;
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([56, 57, 58]);
    manager.subscribeGroup(56);
    manager.subscribeGroup(57);
    manager.subscribeGroup(58);
    await flushQueuedWork();
    sent.length = 0;

    now += 31_000;
    manager.reannounceSubscriptions();
    await new Promise((resolve) => setTimeout(resolve, 250));

    const groupSubs = sent.filter((wire) => wire.k === 'group_sub');
    expect(sent.filter((wire) => wire.k === 'hello_v3')).toHaveLength(1);
    expect(groupSubs).toHaveLength(1);
    expect(groupSubs[0]).toMatchObject({
      t: 'RCHAT',
      k: 'group_sub',
      groups: [56, 57, 58],
      mode: 'summary',
    });
    expect(
      sent.filter((wire) => wire.k === 'group_state_digest_v3')
    ).toHaveLength(3);
    manager.close();
  });

  it('sends refreshed group digests through known interest routes', async () => {
    let now = 80_000;
    const fanout: Record<string, unknown>[] = [];
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'local-peer',
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          fanout.push(...messages);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => now,
    });

    manager.setLocalGroupMemberships([56]);
    manager.subscribeGroup(56);
    await flushQueuedWork();
    now += 31_000;
    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [56], mode: 'summary' },
      'peer-a'
    );
    await flushQueuedWork();
    fanout.length = 0;
    direct.length = 0;

    manager.reannounceSubscriptions();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(
      direct.some(
        ({ peer, wire }) =>
          peer === 'peer-a' && wire.k === 'group_state_digest_v3'
      )
    ).toBe(true);
    expect(
      fanout.some((wire) => wire.k === 'group_state_digest_v3')
    ).toBe(false);
    manager.close();
  });

  it('debounces repeated subscription group digests during reannounce bursts', async () => {
    let now = 80_000;
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([56, 57, 58]);
    manager.subscribeGroup(56);
    manager.subscribeGroup(57);
    manager.subscribeGroup(58);
    await flushQueuedWork();
    sent.length = 0;

    manager.reannounceSubscriptions();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(sent.filter((wire) => wire.k === 'group_sub')).toHaveLength(1);
    expect(
      sent.filter((wire) => wire.k === 'group_state_digest_v3')
    ).toHaveLength(0);

    now += 31_000;
    manager.reannounceSubscriptions();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(
      sent.filter((wire) => wire.k === 'group_state_digest_v3')
    ).toHaveLength(3);
    manager.close();
  });

  it('reopening an already-subscribed channel still sends one active digest', async () => {
    let now = 80_000;
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });

    try {
      manager.setLocalGroupMemberships([716]);
      manager.subscribeGroup(716);
      await flushQueuedWork();
      expect(manager.getSubscriptions()).toEqual([716]);
      sent.length = 0;
      now += 31_000;

      manager.subscribeChannel(716, 'general');
      await flushQueuedWork();

      expect(sent).toContainEqual(expect.objectContaining({
        t: 'RCHAT',
        k: 'group_sub',
        groups: [716],
        mode: 'active',
      }));
      expect(sent).toContainEqual(
        expect.objectContaining({
          t: 'RCHAT',
          v: 3,
          k: 'group_state_digest_v3',
          g: 716,
        })
      );
    } finally {
      manager.close();
    }
  });

  it('rotates background digest refreshes beyond the first digest page', async () => {
    const groupIds = Array.from({ length: 25 }, (_value, index) => index + 1);
    let now = 80_000;
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });

    try {
      manager.setLocalGroupMemberships(groupIds);
      for (const groupId of groupIds) manager.subscribeGroup(groupId);
      (manager as any).activeDigestGroups.clear();
      manager.reannounceSubscriptions();
      await vi.waitFor(
        () => {
          const digestGroupIds = new Set(
            sent
              .filter(
                (wire) =>
                  wire.k === 'group_state_digest_v3' ||
                  wire.k === 'group_digest'
              )
              .map((wire) => Number(wire.g))
          );
          expect(digestGroupIds.size).toBeGreaterThanOrEqual(20);
        },
        { timeout: 2_000, interval: 25 }
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      sent.length = 0;
      now += 31_000;

      manager.reannounceSubscriptions();
      await vi.waitFor(
        () => {
          const digestGroupIds = sent
            .filter(
              (wire) =>
                wire.k === 'group_state_digest_v3' || wire.k === 'group_digest'
            )
            .map((wire) => Number(wire.g));
          expect(digestGroupIds).toContain(21);
          expect(digestGroupIds).toContain(25);
        },
        { timeout: 2_000, interval: 25 }
      );
    } finally {
      manager.close();
    }
  });

  it('does not repeatedly serve digests for direct group_sub renewals', async () => {
    let now = 80_000;
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([56]);
    manager.subscribeGroup(56);
    const groupSub = {
      t: 'RCHAT',
      k: 'group_sub',
      groups: [56],
      mode: 'summary',
    };

    manager.handleWire(groupSub, 'peer-hash');
    await new Promise((resolve) => setTimeout(resolve, 10));
    manager.handleWire(groupSub, 'peer-hash');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      direct.filter((wire) => wire.k === 'group_state_digest_v3')
    ).toHaveLength(1);

    now += 31_000;
    manager.handleWire(groupSub, 'peer-hash');
    await flushQueuedWork();

    expect(
      direct.filter((wire) => wire.k === 'group_state_digest_v3')
    ).toHaveLength(1);
    manager.close();
  });

  it('defers old author-gap repair from inbound group_sub until background repair', async () => {
    let now = 100_000;
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([56]);
    manager.subscribeGroup(56);
    const [first, latest] = signedAuthorEvents([
      {
        eventId: 'event-group-sub-gap-first',
        groupId: 56,
        authorSeq: 1,
        timestamp: 10_001,
      },
      {
        eventId: 'event-group-sub-gap-latest',
        groupId: 56,
        authorSeq: 10,
        timestamp: 10_010,
      },
    ]);
    expect((manager as any).db.insertEvent(first, true)).toBe(true);
    expect((manager as any).db.insertEvent(latest, true)).toBe(true);
    direct.length = 0;

    manager.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [56], mode: 'summary' },
      'peer-gap'
    );
    await flushQueuedWork();

    expect(direct.filter((item) => item.wire.k === 'range_req')).toHaveLength(
      0
    );
    const missing = (manager as any).db.getMissingRange(
      56,
      first.authorAddress,
      TEST_AUTHOR_STREAM_ID,
      2,
      9
    );
    expect(missing?.nextAttemptAt).toBeGreaterThanOrEqual(100_000 + 60_000);

    now += 60_000;
    (manager as any).processBackgroundAuthorGapRepair();
    await flushQueuedWork();

    expect(direct.filter((item) => item.wire.k === 'range_req')).toHaveLength(
      1
    );
    expect(
      direct.find((item) => item.wire.k === 'range_req')?.wire
    ).toMatchObject({
      t: 'RCHAT',
      k: 'range_req',
      g: 56,
      ranges: [
        { a: first.authorAddress, s: TEST_AUTHOR_STREAM_ID, from: 2, to: 9 },
      ],
    });
    manager.close();
  });

  it('does not postpone an existing deferred author-gap retry when the gap is rediscovered', () => {
    let now = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => now,
    });
    manager.setLocalGroupMemberships([57]);
    manager.subscribeGroup(57);
    const [first, latest] = signedAuthorEvents([
      {
        eventId: 'event-repeat-gap-first',
        groupId: 57,
        authorSeq: 1,
        timestamp: 10_001,
      },
      {
        eventId: 'event-repeat-gap-latest',
        groupId: 57,
        authorSeq: 3,
        timestamp: 10_003,
      },
    ]);
    expect((manager as any).db.insertEvent(first, true)).toBe(true);
    expect((manager as any).db.insertEvent(latest, true)).toBe(true);
    const range = {
      a: first.authorAddress,
      s: TEST_AUTHOR_STREAM_ID,
      from: 2,
      to: 2,
    };

    expect(
      (manager as any).recordAuthorGapRanges(57, 'peer-gap', [range], 'first')
    ).toBe(1);
    expect(
      (manager as any).db.getMissingRange(
        57,
        first.authorAddress,
        TEST_AUTHOR_STREAM_ID,
        2,
        2
      )?.nextAttemptAt
    ).toBe(160_000);

    now = 120_000;
    expect(
      (manager as any).recordAuthorGapRanges(57, 'peer-gap', [range], 'repeat')
    ).toBe(1);
    expect(
      (manager as any).db.getMissingRange(
        57,
        first.authorAddress,
        TEST_AUTHOR_STREAM_ID,
        2,
        2
      )?.nextAttemptAt
    ).toBe(160_000);
    (manager as any).processBackgroundAuthorGapRepair();
    expect((manager as any).backgroundAuthorGapRepairTimer).not.toBeNull();
    expect((manager as any).backgroundAuthorGapRepairDueAt).toBe(160_000);
    (manager as any).scheduleBackgroundAuthorGapRepair(10_000);
    expect((manager as any).backgroundAuthorGapRepairDueAt).toBe(130_000);
    manager.close();
  });

  it('does not let an unrelated author gap suppress a fresh digest repair', async () => {
    const direct: Record<string, unknown>[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          _peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push(wire);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([59]);
    manager.subscribeGroup(59);
    const [first, latest] = signedAuthorEvents([
      {
        eventId: 'event-digest-gap-first',
        groupId: 59,
        authorSeq: 1,
        timestamp: 10_001,
      },
      {
        eventId: 'event-digest-gap-latest',
        groupId: 59,
        authorSeq: 3,
        timestamp: 10_003,
      },
    ]);
    expect((manager as any).db.insertEvent(first, true)).toBe(true);
    expect((manager as any).db.insertEvent(latest, true)).toBe(true);
    const localDigest = (manager as any).buildGroupDigestSnapshot(59);
    direct.length = 0;

    const stats = (manager as any).processGroupDigestRepair({
      key: 'peer-gap:59',
      peerHash: 'peer-gap',
      providerPeerHash: 'peer-gap',
      groupId: 59,
      wire: { channels: [] },
      remoteGroupLatest: localDigest.latest,
      remoteDigestHash: 'f'.repeat(64),
      enqueuedAt: 100_000,
      coalescedCount: 0,
    });
    await flushQueuedWork();

    expect(stats).toMatchObject({
      authorGapRequested: true,
      metadataRepairRequested: true,
    });
    expect(
      direct.some(
        (wire) => wire.k === 'feed_req' && wire.c === '*' && wire.p === 'm'
      )
    ).toBe(true);
    expect(
      (manager as any).db.getMissingRange(
        59,
        first.authorAddress,
        TEST_AUTHOR_STREAM_ID,
        2,
        2
      )
    ).toMatchObject({ nextAttemptAt: 160_000 });
    manager.close();
  });

  it('ignores malformed and duplicate channel rows in a group digest', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([61]);
    manager.subscribeGroup(61);
    const upsertPeerChannelState = vi.spyOn(
      (manager as any).db,
      'upsertPeerChannelState'
    );

    (manager as any).processGroupDigestRepair({
      key: 'peer-digest-rows:61',
      peerHash: 'peer-digest-rows',
      providerPeerHash: 'peer-digest-rows',
      groupId: 61,
      wire: {
        channels: [{ c: '../general' }, { c: 'general' }, { c: 'GENERAL' }],
      },
      remoteGroupLatest: null,
      remoteDigestHash: '',
      enqueuedAt: Date.now(),
      coalescedCount: 0,
    });

    expect(upsertPeerChannelState).toHaveBeenCalledTimes(1);
    expect(upsertPeerChannelState).toHaveBeenCalledWith(
      'peer-digest-rows',
      expect.objectContaining({ groupId: 61, channelId: 'general' }),
      expect.any(Number)
    );
    manager.close();
  });

  it('suppresses repeated equal-head digest repair only after terminal no progress', async () => {
    const dbPath = tempDbPath();
    const manager = new ReticulumChatManager({
      dbPath,
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        acceptReticulumChatResourceDetailed: async () => ({
          ok: true as const,
        }),
      } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([59]);
    manager.subscribeGroup(59);
    const event = signedEvent({
      eventId: 'event-digest-no-progress-known',
      groupId: 59,
      timestamp: 90_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    const localDigest = (manager as any).buildGroupDigestSnapshot(59);
    const remoteDigestHash = 'f'.repeat(64);
    const fingerprint = (manager as any).digestRepairFingerprint(
      remoteDigestHash,
      localDigest.digestHash,
      localDigest.latest
    );
    const page = {
      v: 1,
      g: 59,
      c: '*',
      d: 'before',
      p: 'm',
      more: true,
      start: { id: event.eventId, ts: event.timestamp },
      end: { id: event.eventId, ts: event.timestamp },
      wh: (manager as any).db.computeWindowHash([event]),
      events: [event],
    };
    const blob = JSON.stringify(page);
    const pageHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const transferId = 'digest-no-progress-direct-page';
    const filePath = path.join(path.dirname(dbPath), `${transferId}.json`);
    fs.writeFileSync(filePath, blob, 'utf8');
    (manager as any).directHistoryPageRequests.set(transferId, {
      transferId,
      groupId: 59,
      channelId: '*',
      direction: 'before',
      priority: 'metadata',
      pageHash: '',
      sizeBytes: Buffer.byteLength(blob, 'utf8'),
      eventCount: 100,
      start: { eventId: event.eventId, feedTimestamp: event.timestamp },
      sourcePeerHash: 'peer-digest',
      requestedAt: 100_000,
      digestRepairFingerprint: fingerprint,
    });

    (manager as any).handleEventPageOffer(
      {
        transferId,
        groupId: 59,
        channelId: '*',
        direction: 'before',
        priority: 'metadata',
        pageHash,
        sizeBytes: Buffer.byteLength(blob, 'utf8'),
        eventCount: 1,
        hasMore: true,
      },
      'peer-digest'
    );
    await flushQueuedWork();
    expect(
      (manager as any).eventPageOffers.get(transferId)?.digestRepairFingerprint
    ).toBe(fingerprint);

    await (manager as any).importReceivedEventPageResource({
      status: 'received',
      path: filePath,
      transferId,
      peerPresenceHash: 'peer-digest',
    });
    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(
        'peer-digest',
        59,
        fingerprint
      )
    ).toBe(false);

    const terminalPage = { ...page, more: false };
    const terminalBlob = JSON.stringify(terminalPage);
    const terminalPageHash = nodeCrypto
      .createHash('sha256')
      .update(terminalBlob, 'utf8')
      .digest('hex');
    const terminalTransferId = 'digest-no-progress-terminal-page';
    const terminalFilePath = path.join(
      path.dirname(dbPath),
      `${terminalTransferId}.json`
    );
    fs.writeFileSync(terminalFilePath, terminalBlob, 'utf8');
    (manager as any).directHistoryPageRequests.set(terminalTransferId, {
      transferId: terminalTransferId,
      groupId: 59,
      channelId: '*',
      direction: 'before',
      priority: 'metadata',
      pageHash: '',
      sizeBytes: Buffer.byteLength(terminalBlob, 'utf8'),
      eventCount: 100,
      start: { eventId: event.eventId, feedTimestamp: event.timestamp },
      sourcePeerHash: 'peer-digest',
      requestedAt: 100_000,
      digestRepairFingerprint: fingerprint,
    });
    (manager as any).handleEventPageOffer(
      {
        transferId: terminalTransferId,
        groupId: 59,
        channelId: '*',
        direction: 'before',
        priority: 'metadata',
        pageHash: terminalPageHash,
        sizeBytes: Buffer.byteLength(terminalBlob, 'utf8'),
        eventCount: 1,
        hasMore: false,
      },
      'peer-digest'
    );
    await flushQueuedWork();
    await (manager as any).importReceivedEventPageResource({
      status: 'received',
      path: terminalFilePath,
      transferId: terminalTransferId,
      peerPresenceHash: 'peer-digest',
    });
    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(
        'peer-digest',
        59,
        fingerprint
      )
    ).toBe(true);

    const stats = (manager as any).processGroupDigestRepair({
      key: 'peer-digest:59',
      peerHash: 'peer-digest',
      providerPeerHash: 'peer-digest',
      groupId: 59,
      wire: { channels: [] },
      remoteGroupLatest: localDigest.latest,
      remoteDigestHash,
      enqueuedAt: 100_000,
      coalescedCount: 0,
    });
    expect(stats.metadataRepairRequested).toBe(false);
    expect(stats.newestRepairRequested).toBe(false);
    manager.close();
  });

  it('suppresses an unchanged no-progress digest repair when the peer head is behind', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([59]);
    manager.subscribeGroup(59);
    const localEvent = signedEvent({
      eventId: 'event-local-newer-than-peer',
      groupId: 59,
      timestamp: 90_000,
    });
    expect((manager as any).db.insertEvent(localEvent, true)).toBe(true);
    const localDigest = (manager as any).buildGroupDigestSnapshot(59);
    const remoteLatest = {
      eventId: 'event-remote-older-head',
      feedTimestamp: 80_000,
    };
    const remoteDigestHash = 'e'.repeat(64);
    const fingerprint = (manager as any).digestRepairFingerprint(
      remoteDigestHash,
      localDigest.digestHash,
      remoteLatest,
      localDigest.latest
    );
    expect(
      (manager as any).digestRepairFingerprint(
        remoteDigestHash,
        'd'.repeat(64),
        remoteLatest,
        { eventId: 'event-even-newer-local-head', feedTimestamp: 95_000 }
      )
    ).toBe(fingerprint);
    (manager as any).markDigestRepairNoProgress(
      'peer-behind-no-progress',
      59,
      fingerprint
    );

    const stats = (manager as any).processGroupDigestRepair({
      key: 'peer-behind-no-progress:59',
      peerHash: 'peer-behind-no-progress',
      providerPeerHash: 'peer-behind-no-progress',
      groupId: 59,
      wire: { channels: [] },
      remoteGroupLatest: remoteLatest,
      remoteDigestHash,
      enqueuedAt: 100_000,
      coalescedCount: 0,
    });

    expect(stats.metadataRepairRequested).toBe(false);
    expect(stats.windowRepairRequests).toBe(0);
    expect(stats.peerBehindPushes).toBe(1);
    manager.close();
  });

  it('closes the parent digest repair when its continuation is already suppressed', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: { on: () => undefined, off: () => undefined } as any,
      now: () => 100_000,
    });
    const peer = 'peer-blocked-continuation';
    const groupId = 59;
    const cursor = { eventId: 'event-known-cursor', feedTimestamp: 90_000 };
    const fingerprint = 'digest-blocked-continuation';
    const requestKey = (manager as any).directHistoryPageRequestKey(
      peer,
      groupId,
      '*',
      'before',
      cursor,
      false,
      'metadata'
    );
    (manager as any).historyPageNoProgressSuppressions.set(requestKey, 200_000);

    await (manager as any).requestLinkedHistoryPage(
      peer,
      groupId,
      '*',
      cursor,
      'before',
      false,
      'metadata-page-more-known-overlap',
      peer,
      'metadata',
      fingerprint,
      2
    );

    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(
        peer,
        groupId,
        fingerprint
      )
    ).toBe(true);
    manager.close();
  });

  it('bounds an unchanged digest compatibility scan to the digest window', async () => {
    const dbPath = tempDbPath();
    const manager = new ReticulumChatManager({
      dbPath,
      bridge: { on: () => undefined, off: () => undefined } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([59]);
    manager.subscribeGroup(59);
    const event = signedEvent({
      eventId: 'event-digest-budget-known',
      groupId: 59,
      timestamp: 90_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    const page = {
      v: 1,
      g: 59,
      c: '*',
      d: 'before',
      more: true,
      start: { id: event.eventId, ts: event.timestamp },
      end: { id: event.eventId, ts: event.timestamp },
      wh: (manager as any).db.computeWindowHash([event]),
      events: [event],
    };
    const blob = JSON.stringify(page);
    const pageHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const transferId = 'digest-page-budget-terminal';
    const filePath = path.join(path.dirname(dbPath), `${transferId}.json`);
    const fingerprint = 'digest-page-budget-fingerprint';
    fs.writeFileSync(filePath, blob, 'utf8');
    (manager as any).eventPageOffers.set(transferId, {
      transferId,
      groupId: 59,
      channelId: '*',
      direction: 'before',
      pageHash,
      sizeBytes: Buffer.byteLength(blob, 'utf8'),
      eventCount: 1,
      sourcePeerHash: 'peer-digest-budget',
      digestRepairFingerprint: fingerprint,
      digestRepairPageCount: 2,
    });

    await (manager as any).importReceivedEventPageResource({
      status: 'received',
      path: filePath,
      transferId,
      peerPresenceHash: 'peer-digest-budget',
    });

    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(
        'peer-digest-budget',
        59,
        fingerprint
      )
    ).toBe(true);
    manager.close();
  });

  it('preserves the digest repair budget across legacy event batches', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: { on: () => undefined, off: () => undefined } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([59]);
    manager.subscribeGroup(59);
    const event = signedEvent({
      eventId: 'event-legacy-digest-budget-known',
      groupId: 59,
      timestamp: 90_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    const peer = 'peer-legacy-digest-budget';
    const fingerprint = 'legacy-digest-budget-fingerprint';
    const sendRepairFeedRequest = vi
      .spyOn(manager as any, 'sendRepairFeedRequest')
      .mockImplementation(() => undefined);
    const wire = {
      c: '*',
      batch: {
        dir: 'before',
        more: true,
        start: { id: event.eventId, ts: event.timestamp },
        end: { id: event.eventId, ts: event.timestamp },
        wh: (manager as any).db.computeWindowHash([event]),
        events: [event],
      },
    };

    (manager as any).trackPendingDigestRepairFingerprint(
      peer,
      59,
      fingerprint,
      1,
      '*',
      'before'
    );
    await (manager as any).handleEventBatch(59, wire, peer);

    expect(sendRepairFeedRequest).toHaveBeenCalledTimes(1);
    const continuation = (manager as any).takePendingDigestRepairFingerprint(
      peer,
      59,
      '*',
      'before'
    );
    expect(continuation).toEqual({ fingerprint, pageCount: 2 });

    (manager as any).trackPendingDigestRepairFingerprint(
      peer,
      59,
      continuation.fingerprint,
      continuation.pageCount,
      '*',
      'before'
    );
    await (manager as any).handleEventBatch(59, wire, peer);

    expect(sendRepairFeedRequest).toHaveBeenCalledTimes(1);
    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(peer, 59, fingerprint)
    ).toBe(true);
    manager.close();
  });

  it('does not refresh an unanswered legacy digest fallback forever', async () => {
    let now = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: { on: () => undefined, off: () => undefined } as any,
      now: () => now,
    });
    const sendRepairFeedRequest = vi
      .spyOn(manager as any, 'sendRepairFeedRequest')
      .mockImplementation(() => undefined);
    const peer = 'peer-unanswered-legacy-digest';
    const fingerprint = 'unanswered-legacy-digest-fingerprint';
    const request = () =>
      (manager as any).requestLinkedHistoryPage(
        peer,
        59,
        '*',
        { eventId: 'event-unanswered-legacy-head', feedTimestamp: 90_000 },
        'before',
        true,
        'legacy-digest-fallback',
        peer,
        undefined,
        fingerprint
      );

    await request();
    const firstPending = [
      ...(manager as any).pendingDigestRepairFingerprints.values(),
    ][0];
    expect(firstPending).toMatchObject({
      fingerprint,
      attempts: 1,
      nextRetryAt: 130_000,
      expiresAt: 220_000,
    });
    expect(sendRepairFeedRequest).toHaveBeenCalledTimes(1);

    now = 110_000;
    await request();
    const duplicatePending = [
      ...(manager as any).pendingDigestRepairFingerprints.values(),
    ][0];
    expect(duplicatePending).toMatchObject({
      fingerprint,
      attempts: 1,
      expiresAt: 220_000,
    });
    expect(sendRepairFeedRequest).toHaveBeenCalledTimes(1);

    now = 130_001;
    await request();
    const retriedPending = [
      ...(manager as any).pendingDigestRepairFingerprints.values(),
    ][0];
    expect(retriedPending).toMatchObject({
      fingerprint,
      attempts: 2,
      expiresAt: 220_000,
    });
    expect(sendRepairFeedRequest).toHaveBeenCalledTimes(2);

    now = 140_000;
    await request();
    expect(sendRepairFeedRequest).toHaveBeenCalledTimes(2);

    now = 220_001;
    await request();
    expect(sendRepairFeedRequest).toHaveBeenCalledTimes(2);
    expect((manager as any).pendingDigestRepairFingerprints.size).toBe(0);
    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(peer, 59, fingerprint)
    ).toBe(true);
    manager.close();
  });

  it('bounds linked digest repair requests that never receive an offer', async () => {
    let now = 100_000;
    const acceptReticulumChatResourceDetailed = vi
      .fn()
      .mockResolvedValue({ ok: true as const });
    const cancelReticulumResourceDetailed = vi
      .fn()
      .mockResolvedValue({ ok: true as const });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed,
        cancelReticulumResourceDetailed,
        getLocalDestinationHash: () => 'a'.repeat(32),
      } as any,
      now: () => now,
    });
    vi.spyOn(manager as any, 'ensureResourcePeerIdentity').mockResolvedValue(
      'resource-identity'
    );
    vi.spyOn(manager as any, 'ensureResourceSession').mockResolvedValue({
      ok: true as const,
    });
    vi.spyOn(manager as any, 'buildSignedHistoryPageRequest').mockResolvedValue(
      {
        c: '*',
        d: 'before',
        before: { id: 'event-unanswered-linked-head', ts: 90_000 },
        inc: 1,
        limit: 100,
        a: 'Qrequester',
        pk: 'public-key',
        ts: now,
        sig: 'signature',
      }
    );
    const peer = 'peer-unanswered-linked-digest';
    const fingerprint = 'unanswered-linked-digest-fingerprint';
    const request = () =>
      (manager as any).requestLinkedHistoryPage(
        peer,
        59,
        '*',
        { eventId: 'event-unanswered-linked-head', feedTimestamp: 90_000 },
        'before',
        true,
        'linked-digest-no-response',
        peer,
        undefined,
        fingerprint
      );

    await request();
    expect(acceptReticulumChatResourceDetailed).toHaveBeenCalledTimes(1);
    expect(
      [...(manager as any).directHistoryPageRequests.values()][0]
    ).toMatchObject({
      digestRepairFingerprint: fingerprint,
      digestRepairRequestAttempt: 1,
    });

    now = 220_001;
    await request();
    expect(acceptReticulumChatResourceDetailed).toHaveBeenCalledTimes(2);
    expect(cancelReticulumResourceDetailed).toHaveBeenCalledTimes(1);
    expect(
      [...(manager as any).directHistoryPageRequests.values()][0]
    ).toMatchObject({
      digestRepairFingerprint: fingerprint,
      digestRepairRequestAttempt: 2,
    });

    now = 340_002;
    await request();
    expect(acceptReticulumChatResourceDetailed).toHaveBeenCalledTimes(2);
    expect(cancelReticulumResourceDetailed).toHaveBeenCalledTimes(2);
    expect((manager as any).directHistoryPageRequests.size).toBe(0);
    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(peer, 59, fingerprint)
    ).toBe(true);
    manager.close();
  });

  it('does not apply a digest retry budget to a normal history request', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: { on: () => undefined, off: () => undefined } as any,
      now: () => 340_002,
    });
    const sendRepairFeedRequest = vi
      .spyOn(manager as any, 'sendRepairFeedRequest')
      .mockImplementation(() => undefined);
    const peer = 'peer-normal-history-after-digest';
    const cursor = {
      eventId: 'event-normal-history-after-digest',
      feedTimestamp: 90_000,
    };
    const requestKey = (manager as any).directHistoryPageRequestKey(
      peer,
      59,
      '*',
      'before',
      cursor,
      true
    );
    const transferId = 'stale-digest-request-before-normal-history';
    (manager as any).trackDirectHistoryPageRequest(requestKey, {
      transferId,
      groupId: 59,
      channelId: '*',
      direction: 'before',
      includeCursor: true,
      pageHash: '',
      sizeBytes: 1024,
      eventCount: 100,
      start: cursor,
      sourcePeerHash: peer,
      requestedAt: 100_000,
      digestRepairFingerprint: 'old-digest-repair-fingerprint',
      digestRepairPageCount: 1,
      digestRepairRequestAttempt: 2,
    });

    await (manager as any).requestLinkedHistoryPage(
      peer,
      59,
      '*',
      cursor,
      'before',
      true,
      'normal-history-request'
    );

    expect(sendRepairFeedRequest).toHaveBeenCalledTimes(1);
    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(
        peer,
        59,
        'old-digest-repair-fingerprint'
      )
    ).toBe(false);
    manager.close();
  });

  it('treats a provider with no history as terminal for the unchanged digest state', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: { on: () => undefined, off: () => undefined } as any,
      now: () => 100_000,
    });
    const transferId = 'digest-no-history-terminal';
    const fingerprint = 'digest-no-history-fingerprint';
    (manager as any).directHistoryPageRequests.set(transferId, {
      transferId,
      groupId: 59,
      channelId: '*',
      direction: 'before',
      pageHash: '',
      sizeBytes: 1024,
      eventCount: 100,
      sourcePeerHash: 'peer-no-history',
      digestRepairFingerprint: fingerprint,
    });

    (manager as any).handleEventPageResourceFailure(
      transferId,
      'no_history_events'
    );

    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(
        'peer-no-history',
        59,
        fingerprint
      )
    ).toBe(true);
    manager.close();
  });

  it('keeps metadata and message history requests semantically separate', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: { on: () => undefined, off: () => undefined } as any,
    });
    const args = [
      'peer-priority-dedupe',
      59,
      '*',
      'before',
      { eventId: 'event-priority-dedupe', feedTimestamp: 90_000 },
      true,
    ] as const;
    const normalKey = (manager as any).directHistoryPageRequestKey(
      ...args,
      undefined
    );
    const metadataKey = (manager as any).directHistoryPageRequestKey(
      ...args,
      'metadata'
    );

    expect(metadataKey).not.toBe(normalKey);
    manager.close();
  });

  it('attaches digest repair state to the normal visible-window scan', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: { on: () => undefined, off: () => undefined } as any,
      now: () => 100_000,
    });
    const requestPage = vi
      .spyOn(manager as any, 'requestLinkedHistoryPage')
      .mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'sendFeedPageToPeer').mockResolvedValue(undefined);
    const remoteLatest = {
      eventId: 'event-remote-window',
      feedTimestamp: 80_000,
    };
    const localLatest = {
      eventId: 'event-local-window',
      feedTimestamp: 90_000,
    };

    expect(
      (manager as any).requestVisibleWindowRepair(
        'peer-window-repair',
        59,
        '*',
        remoteLatest,
        localLatest,
        'group-window-mismatch',
        'digest-window-fingerprint'
      )
    ).toBe(true);
    expect(requestPage).toHaveBeenCalledWith(
      'peer-window-repair',
      59,
      '*',
      remoteLatest,
      'before',
      true,
      'group-window-mismatch',
      'peer-window-repair',
      undefined,
      'digest-window-fingerprint'
    );
    manager.close();
  });

  it('correlates fallback message-history pages with their pending digest repair', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async () => ({
          ok: true as const,
        }),
      } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([59]);
    manager.subscribeGroup(59);
    const fingerprint = 'digest-repair-fingerprint';
    (manager as any).trackPendingDigestRepairFingerprint(
      'peer-fallback',
      59,
      fingerprint
    );

    (manager as any).handleEventPageOffer(
      {
        transferId: 'fallback-history-page',
        groupId: 59,
        channelId: '*',
        direction: 'before',
        pageHash: 'a'.repeat(64),
        sizeBytes: 100,
        eventCount: 1,
      },
      'peer-fallback'
    );

    expect(
      (manager as any).eventPageOffers.get('fallback-history-page')
        ?.digestRepairFingerprint
    ).toBe(fingerprint);
    manager.close();
  });

  it('invalidates digest no-progress suppression when local digest state changes', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
    });
    const latest = { eventId: 'event-latest', feedTimestamp: 90_000 };
    const original = (manager as any).digestRepairFingerprint(
      'a'.repeat(64),
      'b'.repeat(64),
      latest
    );
    const afterLocalProgress = (manager as any).digestRepairFingerprint(
      'a'.repeat(64),
      'c'.repeat(64),
      latest
    );

    (manager as any).markDigestRepairNoProgress('peer-gap', 59, original);
    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(
        'peer-gap',
        59,
        original
      )
    ).toBe(true);
    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(
        'peer-gap',
        59,
        afterLocalProgress
      )
    ).toBe(false);
    expect(
      (manager as any).isDigestRepairNoProgressSuppressed(
        'peer-gap',
        59,
        original
      )
    ).toBe(true);
    manager.close();
  });

  it('verifies a targeted author tree path before deferring its history gap', async () => {
    let now = 200_000;
    const localDirect: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const remoteDirect: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    let local!: ReticulumChatManager;
    let remote!: ReticulumChatManager;
    const localBridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        localDirect.push({ peer, wire });
        setImmediate(() => remote.handleWire(wire, 'peer-local'));
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const remoteBridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'b'.repeat(32),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: ReticulumChatWire
      ) => {
        remoteDirect.push({ peer, wire });
        setImmediate(() => local.handleWire(wire, 'peer-remote'));
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    local = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: localBridge as any,
      now: () => now,
    });
    remote = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: remoteBridge as any,
      now: () => now,
    });
    local.setLocalGroupMemberships([56]);
    remote.setLocalGroupMemberships([56]);
    local.subscribeGroup(56);
    remote.subscribeGroup(56);
    const remoteEvent = signedEvent({
      eventId: 'author-tree-remote-head',
      groupId: 56,
      authorSeq: 250,
      timestamp: 180_000,
    });
    expect((remote as any).db.insertEvent(remoteEvent, true)).toBe(true);
    (remote as any).clearAuthorTreeGroupState(56);
    const digest = await (remote as any).buildGroupStateDigestWire(56);
    localDirect.length = 0;
    remoteDirect.length = 0;

    local.handleWire(digest, 'peer-remote');
    await flushQueuedWork(24);

    expect(
      localDirect.some((item) => item.wire.k === 'author_tree_req_v3')
    ).toBe(true);
    expect(
      localDirect.some(
        (item) =>
          item.wire.k === 'state_heads_req_v3' &&
          (item.wire as any).q?.type === 'authors'
      )
    ).toBe(false);
    expect(
      (local as any).db.getMissingRange(
        56,
        remoteEvent.authorAddress,
        TEST_AUTHOR_STREAM_ID,
        1,
        250
      )
    ).toMatchObject({ preferredPeer: 'peer-remote' });
    for (const item of [...localDirect, ...remoteDirect]) {
      if (!item.wire.k.startsWith('author_tree_')) continue;
      expect(byteLengthUtf8JsonWithBridgeSender(item.wire)).toBeLessThanOrEqual(
        RT_RETICULUM_MAX_WIRE_JSON_BYTES
      );
    }

    now += 60_000;
    (local as any).processBackgroundAuthorGapRepair();
    await flushQueuedWork();

    expect(
      localDirect.filter((item) => item.wire.k === 'range_req')
    ).toHaveLength(1);
    expect(
      localDirect.find((item) => item.wire.k === 'range_req')?.wire
    ).toMatchObject({
      t: 'RCHAT',
      k: 'range_req',
      g: 56,
      ranges: [
        {
          a: remoteEvent.authorAddress,
          s: TEST_AUTHOR_STREAM_ID,
          from: 151,
          to: 250,
        },
      ],
    });
    local.close();
    remote.close();
  });

  it('serves a retained author tree snapshot while newer events update the current root', async () => {
    const direct: ReticulumChatWire[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          _peer: string,
          wire: ReticulumChatWire
        ) => {
          direct.push(wire);
          return { ok: true as const };
        },
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 200_000,
    });
    manager.setLocalGroupMemberships([56]);
    manager.subscribeGroup(56);
    const first = signedEvent({ groupId: 56, authorSeq: 1 });
    expect((manager as any).db.insertEvent(first, true)).toBe(true);
    (manager as any).clearAuthorTreeGroupState(56);
    const oldDigest = (await (manager as any).buildGroupStateDigestWire(
      56
    )) as any;
    const oldRoot = oldDigest.d.authorTreeRoot as string;
    const second = signedEvent({ groupId: 56, authorSeq: 1 });
    expect((manager as any).db.insertEvent(second, true)).toBe(true);
    (manager as any).updateAuthorTreeCacheForEvent(second);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        v: 3,
        k: 'author_tree_req_v3',
        g: 56,
        q: { r: oldRoot },
      },
      'peer-snapshot'
    );
    await flushQueuedWork();

    expect(direct).toContainEqual(
      expect.objectContaining({
        k: 'author_tree_node_v3',
        n: expect.objectContaining({ r: oldRoot, p: '' }),
      })
    );
    expect(direct.some((wire) => wire.k === 'author_tree_reset_v3')).toBe(
      false
    );
    manager.close();
  });

  it('rejects author tree branches that do not prove the advertised root', async () => {
    const direct: ReticulumChatWire[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          _peer: string,
          wire: ReticulumChatWire
        ) => {
          direct.push(wire);
          return { ok: true as const };
        },
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
    });
    manager.setLocalGroupMemberships([56]);
    manager.subscribeGroup(56);
    const remoteTree = buildReticulumChatAuthorTreeSnapshot(56, [
      {
        authorAddress: 'QremoteAuthor',
        authorStreamId: TEST_AUTHOR_STREAM_ID,
        maxSeq: 10,
      },
    ]);
    (manager as any).requestAuthorTreeNode(
      'peer-proof',
      56,
      remoteTree.root,
      ''
    );
    await flushAsyncWork();
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        v: 3,
        k: 'author_tree_node_v3',
        g: 56,
        n: {
          r: remoteTree.root,
          p: '',
          c: 1,
          l: ['1'.repeat(64), 1],
          x: ['2'.repeat(64), 0],
        },
      },
      'peer-proof'
    );
    await flushQueuedWork();

    expect(direct.some((wire) => wire.k === 'author_tree_req_v3')).toBe(false);
    expect(
      (manager as any).db.getMissingRange(
        56,
        'QremoteAuthor',
        TEST_AUTHOR_STREAM_ID,
        1,
        10
      )
    ).toBeNull();
    manager.close();
  });

  it('bounds incomplete author tree leaves by their reserved total size', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
    });
    manager.setLocalGroupMemberships([56]);
    manager.subscribeGroup(56);
    const peer = 'peer-pressure';
    const path = '00000000';
    const expectedHash = 'a'.repeat(64);
    const addPendingLeaf = async (root: string, authorAddress: string) => {
      const requestKey = (manager as any).authorTreeRequestKey(
        peer,
        56,
        root,
        path,
        0
      );
      (manager as any).authorTreeRequests.set(requestKey, {
        expiresAt: Date.now() + 10_000,
        expectedHash,
      });
      await (manager as any).handleAuthorTreeNode(
        56,
        {
          r: root,
          p: path,
          c: 60_000,
          a: [[authorAddress, TEST_AUTHOR_STREAM_ID, 1]],
          m: true,
          next: 1,
        },
        peer
      );
    };

    await addPendingLeaf('1'.repeat(64), 'QpressureOne');
    await addPendingLeaf('2'.repeat(64), 'QpressureTwo');

    const pending = [...(manager as any).authorTreeLeafResponses.values()];
    expect(pending).toHaveLength(1);
    expect(pending[0].totalCount).toBe(60_000);
    manager.close();
  });

  it('does not let inactive ready ranges block active background author repair', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      sendReticulumChatDetailed: async (
        peer: string,
        wire: Record<string, unknown>
      ) => {
        direct.push({ peer, wire });
        return { ok: true as const };
      },
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 300_000,
    });
    manager.setLocalGroupMemberships([56]);
    manager.subscribeGroup(56);
    const db = (manager as any).db as ReticulumChatDatabase;
    for (let index = 0; index < 100; index += 1) {
      db.scheduleMissingRange(
        1,
        `QinactiveAuthor${index}`,
        TEST_AUTHOR_STREAM_ID,
        1,
        5,
        'peer-inactive',
        300_000
      );
    }
    db.scheduleMissingRange(
      56,
      'QactiveAuthor',
      TEST_AUTHOR_STREAM_ID,
      1,
      5,
      'peer-active',
      300_000
    );
    direct.length = 0;

    (manager as any).processBackgroundAuthorGapRepair();
    await flushQueuedWork();

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-active',
        wire: expect.objectContaining({
          k: 'range_req',
          g: 56,
          ranges: [
            { a: 'QactiveAuthor', s: TEST_AUTHOR_STREAM_ID, from: 1, to: 5 },
          ],
        }),
      })
    );
    manager.close();
  });

  it.skip('requests the peer continuation page when an inbound digest has more channels', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 80_000,
    });
    manager.setLocalGroupMemberships([56]);
    manager.subscribeGroup(56);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 56,
        channels: [],
        more: true,
        nextOffset: 16,
        digestHash: 'remote-page-0',
      },
      'peer-hash'
    );
    await flushQueuedWork();

    expect(direct).toContainEqual({
      t: 'RCHAT',
      k: 'digest_req',
      g: 56,
      offset: 16,
      limit: 16,
    });
    expect(direct.some((wire) => wire.k === 'group_digest')).toBe(false);
    manager.close();
  });

  it.skip('serves digest requests as compact group beacons without channel arrays', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 80_000,
    });
    manager.setLocalGroupMemberships([57]);
    for (let index = 0; index < 20; index += 1) {
      const channelId = `channel-${String(index).padStart(2, '0')}`;
      (manager as any).db.upsertChannel({
        groupId: 57,
        channelId,
        name: channelId,
        position: index,
        archived: false,
        createdBy: 'Qcreator',
        createdAt: 10_000,
        updatedAt: 10_000,
      });
      await manager.publishEvent(
        signedEvent({
          groupId: 57,
          channelId,
          timestamp: 10_000 + index,
        })
      );
    }
    direct.length = 0;

    manager.handleWire(
      { t: 'RCHAT', k: 'digest_req', g: 57, offset: 16, limit: 16 },
      'peer-hash'
    );
    await vi.waitFor(
      () => expect(direct.some((wire) => wire.k === 'group_digest')).toBe(true),
      {
        timeout: 1_000,
        interval: 10,
      }
    );

    const digest = direct.find((wire) => wire.k === 'group_digest') as any;
    expect(digest).toBeDefined();
    expect(digest.g).toBe(57);
    expect(digest.channels).toBeUndefined();
    expect(digest.more).toBeUndefined();
    expect(digest.nextOffset).toBeUndefined();
    expect(digest.latest?.id).toBeTruthy();
    expect(digest.digestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(digest.sd).toBeTruthy();
    expect(byteLengthUtf8JsonWithBridgeSender(digest)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    manager.close();
  });

  it('responds to feed requests with resource offers and a digest', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 60_000,
    });
    manager.setLocalGroupMemberships([50]);
    const event = signedEvent({ groupId: 50, timestamp: 10_000 });
    await manager.publishEvent(event);

    manager.handleWire(
      { t: 'RCHAT', k: 'feed_req', g: 50, c: 'general', limit: 10 },
      'peer'
    );
    await flushQueuedWork();

    expect(direct.some((wire) => wire.k === 'event_page_offer')).toBe(true);
    expect(direct.some((wire) => wire.k === 'group_state_digest_v3')).toBe(
      true
    );
    expect(direct.every((wire) => wire.k !== 'event_batch')).toBe(true);
    expect(
      Math.max(
        ...direct.map((wire) => byteLengthUtf8JsonWithBridgeSender(wire))
      )
    ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    manager.close();
  });

  it('responds to group-wide feed requests without filtering to general', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([50]);
    (manager as any).db.upsertChannel({
      groupId: 50,
      channelId: 'ch-00000000-0000-4000-8000-000000000000',
      name: 'channel',
      position: 0,
      archived: false,
      createdBy: 'Qcreator',
      createdAt: 10_000,
      updatedAt: 10_000,
    });
    await manager.publishEvent(
      signedEvent({
        eventId: 'event-group-feed-channel',
        groupId: 50,
        channelId: 'ch-00000000-0000-4000-8000-000000000000',
        timestamp: 11_000,
      })
    );
    direct.length = 0;

    manager.handleWire(
      { t: 'RCHAT', k: 'feed_req', g: 50, c: '*', limit: 10 },
      'peer'
    );
    await flushQueuedWork();

    expect(
      (manager as any).db
        .getGroupFeedPageAfter(50, null, 10)
        .map((event: ReticulumChatEvent) => event.eventId)
    ).toEqual(['event-group-feed-channel']);
    expect(direct.some((wire) => wire.k === 'event_page_offer')).toBe(true);
    expect(direct.some((wire) => wire.k === 'group_state_digest_v3')).toBe(
      true
    );
    expect(direct.every((wire) => wire.k !== 'event_batch')).toBe(true);
    expect(direct).toEqual(
      expect.arrayContaining([expect.objectContaining({ t: 'RCHAT', g: 50 })])
    );
    manager.close();
  });

  it('treats an empty transferable page as terminal without scheduling another digest', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
      } as any,
    });
    manager.setLocalGroupMemberships([50]);
    const enqueueDigestSend = vi.spyOn(manager as any, 'enqueueDigestSend');

    await (manager as any).sendEventBatchOrResourceDigest(
      'peer-empty-page',
      50,
      'general',
      [],
      false
    );

    expect(enqueueDigestSend).not.toHaveBeenCalled();
    manager.close();
  });

  it('sends a relayed range offer that fits the actual RCHAT bridge envelope', async () => {
    const direct: Record<string, unknown>[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async (
          _peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push(wire);
          return { ok: true as const };
        },
      } as any,
    });
    manager.setLocalGroupMemberships([50]);
    const event = signedEvent({
      eventId: 'range-offer-actual-envelope',
      groupId: 50,
      channelId: 'general',
      timestamp: 20_000,
    });

    const result = await (manager as any).offerEventPageResource(
      'peer-range-offer',
      50,
      '*',
      [event],
      false,
      'range',
      {
        relayRequestId: 'b'.repeat(16),
        repairRange: {
          a: event.authorAddress,
          s: event.authorStreamId,
          from: event.authorSeq,
          to: event.authorSeq,
        },
      }
    );

    expect(result).toEqual({ ok: true });
    const offer = direct.find((wire) => wire.k === 'event_page_offer');
    expect(offer).toBeTruthy();
    expect(wireFitsReticulumChat(offer!)).toBe(true);
    manager.close();
  });

  it('releases an event page provider blob when the bridge reports completion', async () => {
    let resourceFilePath = '';
    let transferId = '';
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatResourceDetailed: async (payload: any) => {
          resourceFilePath = payload.filePath;
          transferId = payload.transferId;
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
    });
    manager.setLocalGroupMemberships([50]);
    const event = signedEvent({
      eventId: 'event-page-temp-cleanup',
      groupId: 50,
      channelId: 'general',
      timestamp: 20_500,
    });

    const result = await (manager as any).offerEventPageResource(
      'peer-temp-cleanup',
      50,
      'general',
      [event],
      false,
      'before'
    );

    expect(result).toEqual({ ok: true });
    expect(transferId).not.toBe('');
    expect(fs.existsSync(resourceFilePath)).toBe(true);

    manager.handleResourceEvent({
      status: 'sent',
      transferId,
      resourceType: 'reticulum_chat_event_page',
    });

    expect(fs.existsSync(resourceFilePath)).toBe(false);
    expect((manager as any).outboundEventPageResources.has(transferId)).toBe(
      false
    );
    expect((manager as any).tempEventBlobs.has(transferId)).toBe(false);
    manager.close();
  });

  it('reports a full temp volume as a retryable page-offer failure', async () => {
    const registerResource = vi.fn(async () => ({ ok: true as const }));
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatResourceDetailed: registerResource,
      } as any,
    });
    manager.setLocalGroupMemberships([50]);
    const diskError = Object.assign(new Error('no space left on device'), {
      code: 'ENOSPC',
    });
    vi.spyOn(manager as any, 'writeTempEventBlob').mockImplementation(() => {
      throw diskError;
    });
    const event = signedEvent({
      eventId: 'event-page-temp-volume-full',
      groupId: 50,
      channelId: 'general',
      timestamp: 20_750,
    });

    const result = await (manager as any).offerEventPageResource(
      'peer-temp-volume-full',
      50,
      'general',
      [event],
      false,
      'before'
    );

    expect(result).toEqual({
      ok: false,
      reason: 'send-command-failed',
      error: 'Temporary event page write failed (ENOSPC)',
    });
    expect(registerResource).not.toHaveBeenCalled();
    manager.close();
  });

  it('sweeps abandoned receive blobs without touching a recent transfer', async () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const suffix = nodeCrypto.randomBytes(8).toString('hex');
    const stalePath = (manager as any).tempEventBlobPath(
      `${suffix}.page.recv`
    );
    const recentPath = (manager as any).tempEventBlobPath(
      `${suffix}-recent.page.recv`
    );
    fs.writeFileSync(stalePath, 'stale');
    fs.writeFileSync(recentPath, 'recent');
    const staleTime = new Date(Date.now() - 31 * 60_000);
    fs.utimesSync(stalePath, staleTime, staleTime);

    await (manager as any).sweepStaleTempEventBlobs();

    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.existsSync(recentPath)).toBe(true);
    fs.unlinkSync(recentPath);
    manager.close();
  });

  it('does not advertise another digest for a permanently oversized page offer', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
      } as any,
    });
    manager.setLocalGroupMemberships([50]);
    const enqueueDigestSend = vi.spyOn(manager as any, 'enqueueDigestSend');
    const event = signedEvent({
      eventId: 'range-offer-permanently-oversized',
      groupId: 50,
      timestamp: 21_000,
    });

    await (manager as any).sendEventBatchOrResourceDigest(
      'peer-oversized-page',
      50,
      '*',
      [event],
      false,
      'range',
      {
        relayRequestId: 'c'.repeat(64),
        repairRange: {
          a: event.authorAddress,
          s: event.authorStreamId,
          from: event.authorSeq,
          to: event.authorSeq,
        },
      }
    );

    expect(enqueueDigestSend).not.toHaveBeenCalled();
    manager.close();
  });

  it('does not create digest feedback when a page offer fails transiently', async () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([50]);
    const enqueueDigestSend = vi.spyOn(manager as any, 'enqueueDigestSend');

    await (manager as any).sendEventBatchOrResourceDigest(
      'peer-transient-page',
      50,
      'general',
      [
        signedEvent({
          eventId: 'page-transient-failure',
          groupId: 50,
          timestamp: 22_000,
        }),
      ],
      false
    );

    expect(enqueueDigestSend).not.toHaveBeenCalled();
    manager.close();
  });

  it('filters admin-private events from unsigned group-wide feed responses', async () => {
    const direct: Record<string, unknown>[] = [];
    const resources: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([50]);
    upsertTestChannel(manager, {
      groupId: 50,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const publicEvent = signedEvent({
      eventId: 'event-unsigned-feed-public-visible',
      groupId: 50,
      channelId: 'general',
      timestamp: 10_000,
    });
    const privateEvent = signedEvent({
      eventId: 'event-unsigned-feed-admin-private-hidden',
      groupId: 50,
      channelId: 'admin-private',
      timestamp: 11_000,
    });
    expect((manager as any).db.insertEvent(publicEvent, true)).toBe(true);
    expect((manager as any).db.insertEvent(privateEvent, true)).toBe(true);

    manager.handleWire(
      { t: 'RCHAT', k: 'feed_req', g: 50, c: '*', limit: 10 },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(direct.some((wire) => wire.k === 'event_page_offer')).toBe(true);
    expect(resources).toHaveLength(1);
    const page = JSON.parse(
      fs.readFileSync(String(resources[0].filePath), 'utf8')
    ) as {
      events: ReticulumChatEvent[];
    };
    expect(page.events.map((event) => event.eventId)).toEqual([
      publicEvent.eventId,
    ]);
    manager.close();
  });

  it('responds to author range requests with events for that author only', async () => {
    const direct: Record<string, unknown>[] = [];
    const resources: Record<string, any>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([60]);
    const [first, second] = signedAuthorEvents([
      {
        eventId: 'event-gap-response-1',
        groupId: 60,
        authorSeq: 1,
        timestamp: 40_000,
      },
      {
        eventId: 'event-gap-response-2',
        groupId: 60,
        authorSeq: 2,
        timestamp: 41_000,
      },
    ]);
    await manager.publishEvent(first);
    await manager.publishEvent(second);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'range_req',
        g: 60,
        ranges: [
          { a: first.authorAddress, s: TEST_AUTHOR_STREAM_ID, from: 1, to: 2 },
        ],
        limit: 10,
      },
      'peer'
    );
    await flushQueuedWork();

    expect(direct.some((wire) => wire.k === 'event_page_offer')).toBe(true);
    const offer = direct.find((wire) => wire.k === 'event_page_offer') as any;
    expect(offer?.p).toMatchObject({
      c: '*',
      d: 'r',
      n: 2,
      r: [first.authorAddress, TEST_AUTHOR_STREAM_ID, 1, 2],
    });
    expect(resources).toHaveLength(1);
    expect(direct.some((wire) => wire.k === 'group_state_digest_v3')).toBe(
      true
    );
    expect(direct.every((wire) => wire.k !== 'event_batch')).toBe(true);
    manager.close();
  });

  it('answers correlated author range misses explicitly', async () => {
    const direct: Record<string, unknown>[] = [];
    const missingAuthorAddress = createDmIdentity().address;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          _peer: string,
          message: Record<string, unknown>
        ) => {
          direct.push(message);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([60]);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'range_req',
        g: 60,
        id: '0123456789abcdef',
        ranges: [
          {
            a: missingAuthorAddress,
            s: TEST_AUTHOR_STREAM_ID,
            from: 7,
            to: 9,
          },
        ],
        limit: 10,
      },
      'b'.repeat(32)
    );
    await flushQueuedWork();

    const response = {
      t: 'RCHAT',
      k: 'range_none',
      g: 60,
      id: '0123456789abcdef',
      ranges: [
        {
          a: missingAuthorAddress,
          s: TEST_AUTHOR_STREAM_ID,
          from: 7,
          to: 9,
        },
      ],
    };
    expect(direct).toContainEqual(response);
    expect(wireFitsReticulum(response)).toBe(true);
    manager.close();
  });

  it('uses signed requester access when repairing an admin-private range', async () => {
    const peer = 'b'.repeat(32);
    const requester = createDmIdentity();
    const resources: Array<Record<string, any>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatResourceDetailed: async (
          payload: Record<string, any>
        ) => {
          resources.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      validateGroupMember: async (_groupId, address) =>
        address === requester.address,
      validateGroupAdmin: async (_groupId, address) =>
        address === requester.address,
    });
    manager.setLocalGroupMemberships([60]);
    upsertTestChannel(manager, {
      groupId: 60,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-private-range-repair',
      groupId: 60,
      channelId: 'admin-private',
      authorSeq: 1,
      timestamp: 40_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    const requestId = 'fedcba9876543210';
    const ranges = [
      {
        a: event.authorAddress,
        s: event.authorStreamId,
        from: 1,
        to: 1,
      },
    ];
    const signedFields = {
      type: 'RCHAT_RANGE_REQ',
      groupId: 60,
      ranges,
      limit: 10,
      sourcePeerHash: peer,
      timestamp: 100_000,
      authorAddress: requester.address,
      authorPublicKey: requester.publicKey,
    };
    const signature = base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(signedFields)),
        requester.secretKey
      )
    );

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'range_req',
        g: 60,
        id: requestId,
        ranges: [[event.authorAddress, event.authorStreamId, 1, 1]],
        limit: 10,
        q: [peer, requester.publicKey, 100_000, signature],
      },
      peer
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(resources).toHaveLength(1);
    const page = JSON.parse(
      fs.readFileSync(String(resources[0].filePath), 'utf8')
    ) as { events: ReticulumChatEvent[] };
    expect(page.events.map((item) => item.eventId)).toEqual([event.eventId]);
    manager.close();
  });

  it('rotates an unavailable author range to another verified peer immediately', async () => {
    const firstPeer = 'b'.repeat(32);
    const secondPeer = 'c'.repeat(32);
    const direct: Array<{ peer: string; wire: Record<string, any> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      getVerifiedReticulumPeers: () => [
        { destinationHash: firstPeer, address: 'Qfirst', lastSeen: 2 },
        { destinationHash: secondPeer, address: 'Qsecond', lastSeen: 1 },
      ],
    });
    manager.setLocalGroupMemberships([60]);
    manager.subscribeGroup(60);
    const range = {
      a: 'QmissingAuthor',
      s: TEST_AUTHOR_STREAM_ID,
      from: 7,
      to: 9,
    };

    expect(
      (manager as any).sendAuthorRangeRepairRequests(
        60,
        firstPeer,
        [range],
        'test'
      )
    ).toBe(1);
    await flushQueuedWork();
    const request = direct.find((item) => item.peer === firstPeer);
    expect(request?.wire.k).toBe('range_req');

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'range_none',
        g: 60,
        id: request?.wire.id,
        ranges: request?.wire.ranges,
      },
      firstPeer
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushQueuedWork();

    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: secondPeer,
        wire: expect.objectContaining({ k: 'range_req', g: 60 }),
      })
    );
    manager.close();
  });

  it('quarantines a gap after all known verified peers report it unavailable', async () => {
    let now = 100_000;
    const firstPeer = 'b'.repeat(32);
    const secondPeer = 'c'.repeat(32);
    const direct: Array<{ peer: string; wire: Record<string, any> }> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => now,
      getVerifiedReticulumPeers: () => [
        { destinationHash: firstPeer, address: 'Qfirst', lastSeen: 2 },
        { destinationHash: secondPeer, address: 'Qsecond', lastSeen: 1 },
      ],
    });
    manager.setLocalGroupMemberships([60]);
    manager.subscribeGroup(60);
    const range = {
      a: 'QpermanentlyMissing',
      s: TEST_AUTHOR_STREAM_ID,
      from: 12,
      to: 12,
    };

    expect(
      (manager as any).sendAuthorRangeRepairRequests(
        60,
        firstPeer,
        [range],
        'test'
      )
    ).toBe(1);
    await flushQueuedWork();
    const firstRequest = direct.find((item) => item.peer === firstPeer)!;
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'range_none',
        g: 60,
        id: firstRequest.wire.id,
        ranges: firstRequest.wire.ranges,
      },
      firstPeer
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushQueuedWork();
    const secondRequest = direct.find((item) => item.peer === secondPeer)!;
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'range_none',
        g: 60,
        id: secondRequest.wire.id,
        ranges: secondRequest.wire.ranges,
      },
      secondPeer
    );
    await flushQueuedWork();

    expect(
      (manager as any).db.getMissingRange(
        60,
        range.a,
        range.s,
        range.from,
        range.to
      )
    ).toMatchObject({ nextAttemptAt: 100_000 + 6 * 60 * 60_000 });
    expect(direct).toHaveLength(2);

    now += 6 * 60 * 60_000 + 1;
    (manager as any).processBackgroundAuthorGapRepair();
    await flushQueuedWork();

    expect(direct).toHaveLength(3);
    manager.close();
  });

  it('rotates an unanswered author range request instead of retrying the same peer', async () => {
    const firstPeer = 'b'.repeat(32);
    const secondPeer = 'c'.repeat(32);
    const { signLocalFields, address: rangeAuthorAddress } =
      createLandAuthSigner();
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    let now = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => now,
      signLocalFields,
      getVerifiedReticulumPeers: () => [
        { destinationHash: firstPeer, address: 'Qfirst', lastSeen: 2 },
        { destinationHash: secondPeer, address: 'Qsecond', lastSeen: 1 },
      ],
    });
    manager.setLocalGroupMemberships([60]);
    manager.subscribeGroup(60);
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'hello_v3',
        v: 3,
        f: [
          'hello_v3',
          'state_digest_v3',
          'event_notice_v3',
          'metadata_snapshot_v3',
          'state_heads_v3',
          'delta_req_v3',
          'range_auth_v1',
          'author_streams',
          'author_merkle_v1',
          'dm',
        ],
      },
      firstPeer
    );
    const range = {
      a: rangeAuthorAddress,
      s: TEST_AUTHOR_STREAM_ID,
      from: 12,
      to: 12,
    };

    expect(
      (manager as any).sendAuthorRangeRepairRequests(
        60,
        firstPeer,
        [range],
        'test'
      )
    ).toBe(1);
    await flushQueuedWork();
    now += 20_001;
    (manager as any).processBackgroundAuthorGapRepair();
    await flushQueuedWork();

    expect(direct.map((item) => item.peer)).toEqual([firstPeer, secondPeer]);
    expect(Array.isArray(direct[0].wire.q)).toBe(true);
    expect(direct[0].wire.id).toBeUndefined();
    expect(wireFitsReticulum(direct[0].wire)).toBe(true);
    manager.close();
  });

  it('keeps author range requests compatible with peers that do not advertise authenticated ranges', async () => {
    const peer = 'b'.repeat(32);
    const { signLocalFields, address } = createLandAuthSigner();
    const direct: Record<string, unknown>[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          _peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push(wire);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields,
    });
    manager.setLocalGroupMemberships([60]);
    const range = {
      a: address,
      s: TEST_AUTHOR_STREAM_ID,
      from: 12,
      to: 12,
    };

    expect(
      (manager as any).sendAuthorRangeRepairRequests(60, peer, [range], 'test')
    ).toBe(1);
    await flushQueuedWork();

    expect(direct).toHaveLength(1);
    expect(direct[0].q).toBeUndefined();
    expect(direct[0].id).toEqual(expect.any(String));
    expect(direct[0].ranges).toEqual([range]);
    manager.close();
  });

  it('does not recreate or rotate an author gap repaired before its response timeout', async () => {
    const firstPeer = 'b'.repeat(32);
    const secondPeer = 'c'.repeat(32);
    const { signLocalFields } = createLandAuthSigner();
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    let now = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
        sendReticulumChatDetailed: async (
          peer: string,
          wire: Record<string, unknown>
        ) => {
          direct.push({ peer, wire });
          return { ok: true as const };
        },
      } as any,
      now: () => now,
      signLocalFields,
      getVerifiedReticulumPeers: () => [
        { destinationHash: firstPeer, address: 'Qfirst', lastSeen: 2 },
        { destinationHash: secondPeer, address: 'Qsecond', lastSeen: 1 },
      ],
    });
    manager.setLocalGroupMemberships([60]);
    manager.subscribeGroup(60);
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'hello_v3',
        v: 3,
        f: [
          'hello_v3',
          'state_digest_v3',
          'event_notice_v3',
          'metadata_snapshot_v3',
          'state_heads_v3',
          'delta_req_v3',
          'range_auth_v1',
          'author_streams',
          'author_merkle_v1',
          'dm',
        ],
      },
      firstPeer
    );
    const event = signedEvent({
      eventId: 'event-repaired-before-range-timeout',
      groupId: 60,
      channelId: 'general',
      authorSeq: 12,
      timestamp: 90_000,
    });
    const range = {
      a: event.authorAddress,
      s: event.authorStreamId,
      from: 12,
      to: 12,
    };

    expect(
      (manager as any).sendAuthorRangeRepairRequests(
        60,
        firstPeer,
        [range],
        'test'
      )
    ).toBe(1);
    await flushQueuedWork();
    expect((manager as any).db.insertEvent(event, false)).toBe(true);

    now += 20_001;
    (manager as any).processBackgroundAuthorGapRepair();
    await flushQueuedWork();

    expect(direct.map((item) => item.peer)).toEqual([firstPeer]);
    expect(
      (manager as any).db.getMissingRangeOverlaps(
        60,
        range.a,
        range.s,
        range.from,
        range.to
      )
    ).toEqual([]);
    manager.close();
  });

  it('serves author range repairs as newest all-channel pages with more when truncated', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([60]);
    const authorStreamId = 'c'.repeat(32);
    const events = signedAuthorEvents(
      Array.from({ length: 105 }, (_unused, index) => {
        const seq = index + 1;
        return {
          eventId: `event-gap-response-large-${seq}`,
          groupId: 60,
          channelId: seq % 2 === 0 ? 'general' : 'dev',
          authorStreamId,
          authorSeq: seq,
          timestamp: 40_000 + seq,
        };
      })
    );
    for (const event of events) {
      expect((manager as any).db.insertEvent(event, true)).toBe(true);
    }
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'range_req',
        g: 60,
        ranges: [
          { a: events[0].authorAddress, s: authorStreamId, from: 1, to: 105 },
        ],
        limit: 100,
      },
      'peer'
    );
    await flushQueuedWork();

    const offer = direct.find((wire) => wire.k === 'event_page_offer') as any;
    expect(offer?.p).toMatchObject({
      c: '*',
      d: 'r',
      n: 100,
      more: 1,
      r: [events[0].authorAddress, authorStreamId, 1, 105],
    });
    manager.close();
  });

  it('serves author range repairs from newest missing sequence first', async () => {
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([60]);
    const events = signedAuthorEvents([
      {
        eventId: 'event-gap-response-1',
        groupId: 60,
        authorSeq: 1,
        timestamp: 40_000,
      },
      {
        eventId: 'event-gap-response-2',
        groupId: 60,
        authorSeq: 2,
        timestamp: 41_000,
      },
      {
        eventId: 'event-gap-response-3',
        groupId: 60,
        authorSeq: 3,
        timestamp: 42_000,
      },
    ]);
    for (const event of events) {
      await manager.publishEvent(event);
    }

    expect(
      (manager as any).db
        .getAuthorEventsRange(
          60,
          events[0].authorAddress,
          TEST_AUTHOR_STREAM_ID,
          1,
          3,
          2
        )
        .map((event: ReticulumChatEvent) => event.authorSeq)
    ).toEqual([3, 2]);
    manager.close();
  });

  it('continues bounded feed windows forward until catch-up is complete', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 60_000,
    });
    manager.setLocalGroupMemberships([51]);
    manager.subscribeGroup(51);
    const events = [1, 2, 3].map((seq) =>
      signedEvent({
        eventId: `event-page-${seq}`,
        groupId: 51,
        authorSeq: seq,
        timestamp: 20_000 + seq,
      })
    );
    for (const event of events) await manager.publishEvent(event);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'feed_req',
        g: 51,
        c: 'general',
        after: { ts: 20_001, id: 'event-page-1' },
        limit: 1,
      },
      'peer'
    );
    await flushQueuedWork();

    const eventPageOffer = direct.find(
      (wire) => wire.k === 'event_page_offer'
    ) as Record<string, any> | undefined;
    expect(eventPageOffer).toBeDefined();
    expect(eventPageOffer?.p).toMatchObject({
      c: 'general',
      d: 'a',
      n: 1,
    });
    expect(eventPageOffer?.p?.eid).toBeUndefined();
    expect(eventPageOffer?.p?.ets).toBeUndefined();
    expect(direct.filter((wire) => wire.k === 'feed_req')).toHaveLength(0);
    expect(direct.some((wire) => wire.k === 'group_state_digest_v3')).toBe(
      true
    );
    expect(direct.every((wire) => wire.k !== 'event_batch')).toBe(true);
    manager.close();
  });

  it('serves older history with feed_req before', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 60_000,
    });
    manager.setLocalGroupMemberships([53]);
    manager.subscribeGroup(53);
    const events = [1, 2, 3].map((seq) =>
      signedEvent({
        eventId: `event-history-${seq}`,
        groupId: 53,
        authorSeq: seq,
        timestamp: 30_000 + seq,
      })
    );
    for (const event of events) await manager.publishEvent(event);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'feed_req',
        g: 53,
        c: 'general',
        before: { ts: 30_003, id: 'event-history-3' },
        limit: 2,
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      direct.some(
        (wire) => wire.k === 'event_page_offer' || wire.k === 'group_digest'
      )
    ).toBe(true);
    manager.close();
  });

  it('serves group-wide newest inclusive feed pages across channels', async () => {
    const direct: Record<string, unknown>[] = [];
    const resources: Array<Record<string, any>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 60_000,
    });
    manager.setLocalGroupMemberships([53]);
    manager.subscribeGroup(53);
    const older = signedEvent({
      eventId: 'event-group-wide-inclusive-old',
      groupId: 53,
      channelId: 'general',
      authorSeq: 1,
      timestamp: 30_001,
    });
    const latest = signedEvent({
      eventId: 'event-group-wide-inclusive-latest',
      groupId: 53,
      channelId: 'ch-other-channel',
      authorSeq: 2,
      timestamp: 30_002,
    });
    expect((manager as any).db.insertEvent(older, true)).toBe(true);
    expect((manager as any).db.insertEvent(latest, true)).toBe(true);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'feed_req',
        g: 53,
        c: '*',
        before: { ts: latest.timestamp, id: latest.eventId },
        inc: 1,
        limit: 2,
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resources).toHaveLength(1);
    const page = JSON.parse(fs.readFileSync(resources[0].filePath, 'utf8')) as {
      c: string;
      events: Array<{ eventId: string; channelId: string }>;
    };
    expect(page.c).toBe('*');
    expect(page.events.map((event) => event.eventId)).toEqual([
      older.eventId,
      latest.eventId,
    ]);
    expect(page.events.map((event) => event.channelId)).toContain(
      'ch-other-channel'
    );
    expect(direct.some((wire) => wire.k === 'event_page_offer')).toBe(true);
    manager.close();
  });

  it('marks full group-wide newest feed pages as continued', async () => {
    const direct: Record<string, unknown>[] = [];
    const resources: Array<Record<string, any>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        resources.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 80_000,
    });
    manager.setLocalGroupMemberships([53]);
    manager.subscribeGroup(53);
    const events = signedAuthorEvents(
      Array.from({ length: 101 }, (_unused, index) => ({
        eventId: `event-group-page-more-${String(index + 1).padStart(3, '0')}`,
        groupId: 53,
        channelId: index % 2 === 0 ? 'general' : 'ch-more',
        authorSeq: index + 1,
        timestamp: 40_000 + index,
      }))
    );
    for (const event of events) {
      expect((manager as any).db.insertEvent(event, true)).toBe(true);
    }
    const latest = events[events.length - 1];
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'feed_req',
        g: 53,
        c: '*',
        before: { ts: latest.timestamp, id: latest.eventId },
        inc: 1,
        limit: 100,
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resources).toHaveLength(1);
    const page = JSON.parse(fs.readFileSync(resources[0].filePath, 'utf8')) as {
      more?: boolean;
      events: Array<{ eventId: string }>;
    };
    expect(page.events).toHaveLength(100);
    expect(page.more).toBe(true);
    expect(direct).toContainEqual(
      expect.objectContaining({
        k: 'event_page_offer',
        p: expect.objectContaining({ n: 100, more: 1 }),
      })
    );
    manager.close();
  });

  it.skip('pushes and requests visible window repair when digest latest matches but window hash differs', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 90_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([54]);
    manager.subscribeGroup(54);
    const olderLocal = signedEvent({
      eventId: 'event-visible-window-local',
      groupId: 54,
      timestamp: 30_000,
    });
    const latestShared = signedEvent({
      eventId: 'event-visible-window-latest',
      groupId: 54,
      timestamp: 40_000,
    });
    expect((manager as any).db.insertEvent(olderLocal, true)).toBe(true);
    expect((manager as any).db.insertEvent(latestShared, true)).toBe(true);
    const latestCursor = {
      eventId: latestShared.eventId,
      feedTimestamp: latestShared.timestamp,
    };
    const getLatestSpy = vi
      .spyOn((manager as any).db, 'getLatestFeedCursor')
      .mockReturnValue(latestCursor);
    expect(
      (manager as any).db
        .getFeedPageBefore(54, 'general', latestCursor, 10)
        .map((event: ReticulumChatEvent) => event.eventId)
    ).toContain(olderLocal.eventId);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 54,
        latest: { id: latestCursor.eventId, ts: latestCursor.feedTimestamp },
        channels: [
          {
            c: 'general',
            latest: {
              id: latestCursor.eventId,
              ts: latestCursor.feedTimestamp,
            },
            oldest: { id: 'event-visible-window-remote', ts: 31_000 },
            wh: 'different-remote-window-hash',
          },
        ],
        digestHash: 'different-remote-digest-hash',
      },
      'peer-window-mismatch'
    );
    await flushQueuedWork();

    expect(direct).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'feed_req',
        g: 54,
        c: '*',
        before: { id: latestCursor.eventId, ts: latestCursor.feedTimestamp },
      })
    );
    const repairResponse = direct.find(
      (wire) => wire.k === 'event_page_offer' || wire.k === 'group_digest'
    ) as any;
    expect(repairResponse?.k).toBeTruthy();
    expect(direct.every((wire) => wire.k !== 'event_batch')).toBe(true);
    if (repairResponse.k === 'event_page_offer') {
      expect(repairResponse.p).toMatchObject({ c: '*', d: 'b' });
      expect(repairResponse.p?.eid).toBeUndefined();
    }
    getLatestSpy.mockRestore();
    manager.close();
  });

  it.skip('uses group-wide backward repair when digest hashes differ and channel window hashes are omitted', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 90_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([55]);
    manager.subscribeGroup(55);
    const olderLocal = signedEvent({
      eventId: 'event-group-window-local',
      groupId: 55,
      timestamp: 30_000,
    });
    const latestShared = signedEvent({
      eventId: 'event-group-window-latest',
      groupId: 55,
      timestamp: 40_000,
    });
    expect((manager as any).db.insertEvent(olderLocal, true)).toBe(true);
    expect((manager as any).db.insertEvent(latestShared, true)).toBe(true);
    const latestCursor = {
      eventId: latestShared.eventId,
      feedTimestamp: latestShared.timestamp,
    };
    const getLatestSpy = vi
      .spyOn((manager as any).db, 'getLatestFeedCursor')
      .mockReturnValue(latestCursor);
    expect(
      (manager as any).db
        .getGroupFeedPageBefore(55, latestCursor, 10)
        .map((event: ReticulumChatEvent) => event.eventId)
    ).toContain(olderLocal.eventId);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 55,
        latest: { id: latestCursor.eventId, ts: latestCursor.feedTimestamp },
        channels: [
          {
            c: 'general',
            latest: {
              id: latestCursor.eventId,
              ts: latestCursor.feedTimestamp,
            },
          },
        ],
        digestHash: 'different-remote-digest-hash',
      },
      'peer-group-window-mismatch'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(direct).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'feed_req',
        g: 55,
        c: '*',
        before: { id: latestCursor.eventId, ts: latestCursor.feedTimestamp },
      })
    );
    const repairResponse = direct.find(
      (wire) => wire.k === 'event_page_offer' || wire.k === 'group_digest'
    ) as any;
    expect(repairResponse?.k).toBeTruthy();
    expect(direct.every((wire) => wire.k !== 'event_batch')).toBe(true);
    if (repairResponse.k === 'event_page_offer') {
      expect(repairResponse.p).toMatchObject({ c: '*', d: 'b' });
      expect(repairResponse.p?.eid).toBeUndefined();
    }
    getLatestSpy.mockRestore();
    manager.close();
  });

  it.skip('starts cold digest catch-up from the exact newest event before channel pages', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 90_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([56]);
    manager.subscribeGroup(56);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 56,
        latest: { id: 'event-newest-group', ts: 90_000 },
        channels: [
          { c: 'old-channel', latest: { id: 'event-old-channel', ts: 10_000 } },
          {
            c: 'new-channel',
            latest: { id: 'event-newest-group', ts: 90_000 },
          },
        ],
        digestHash: 'remote-digest',
      },
      'peer-cold-newest'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const eventRequests = direct.filter((wire) => wire.k === 'event_req');
    expect(eventRequests).toHaveLength(1);
    expect(eventRequests[0]).toMatchObject({
      t: 'RCHAT',
      k: 'event_req',
      g: 56,
      q: expect.objectContaining({ id: 'event-newest-group' }),
    });
    expect(direct.find((wire) => wire.k === 'feed_req')).toBeUndefined();
    manager.close();
  });

  it('continues remaining author gaps after importing a partial range page', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const dbPath = tempDbPath();
    const manager = new ReticulumChatManager({
      dbPath,
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([57]);
    manager.subscribeGroup(57);
    const events = signedAuthorEvents([
      {
        eventId: 'event-gap-local-1',
        groupId: 57,
        authorSeq: 1,
        timestamp: 10_001,
      },
      ...Array.from({ length: 3 }, (_unused, index) => {
        const seq = index + 4;
        return {
          eventId: `event-gap-page-${seq}`,
          groupId: 57,
          channelId: seq % 2 === 0 ? 'general' : 'dev',
          authorSeq: seq,
          timestamp: 10_000 + seq,
        };
      }),
      {
        eventId: 'event-gap-local-103',
        groupId: 57,
        authorSeq: 103,
        timestamp: 10_103,
      },
    ]);
    const localFirst = events[0];
    const localLatest = events[events.length - 1];
    expect((manager as any).db.insertEvent(localFirst, true)).toBe(true);
    expect((manager as any).db.insertEvent(localLatest, true)).toBe(true);
    const pageEvents = events
      .slice(1, -1)
      .sort((a, b) => b.authorSeq - a.authorSeq);
    const ordered = [...pageEvents].sort(
      (a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)
    );
    const page = {
      v: 1,
      g: 57,
      c: '*',
      d: 'range',
      more: true,
      start: { id: ordered[0].eventId, ts: ordered[0].timestamp },
      end: {
        id: ordered[ordered.length - 1].eventId,
        ts: ordered[ordered.length - 1].timestamp,
      },
      wh: (manager as any).db.computeWindowHash(ordered),
      events: pageEvents,
    };
    const blob = JSON.stringify(page);
    const pageHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const transferId = 'range-page-continuation-transfer';
    const filePath = path.join(path.dirname(dbPath), `${transferId}.json`);
    fs.writeFileSync(filePath, blob, 'utf8');
    (manager as any).eventPageOffers.set(transferId, {
      transferId,
      groupId: 57,
      channelId: '*',
      direction: 'range',
      pageHash,
      sizeBytes: Buffer.byteLength(blob, 'utf8'),
      eventCount: pageEvents.length,
      sourcePeerHash: 'peer-range',
      hasMore: true,
      repairRange: {
        a: localFirst.authorAddress,
        s: TEST_AUTHOR_STREAM_ID,
        from: 2,
        to: 102,
      },
    });
    direct.length = 0;

    await (manager as any).importReceivedEventPageResource({
      status: 'received',
      path: filePath,
      transferId,
      peerPresenceHash: 'peer-range',
    });

    expect(direct).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'range_req',
        g: 57,
        ranges: [
          {
            a: localFirst.authorAddress,
            s: TEST_AUTHOR_STREAM_ID,
            from: 2,
            to: 3,
          },
        ],
      })
    );
    manager.close();
  });

  it('suppresses no-progress author gap range pages only for the serving peer', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push({ peer, wire: message });
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const dbPath = tempDbPath();
    const manager = new ReticulumChatManager({
      dbPath,
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([57]);
    manager.subscribeGroup(57);
    const events = signedAuthorEvents([
      {
        eventId: 'event-gap-suppress-local-1',
        groupId: 57,
        authorSeq: 1,
        timestamp: 10_001,
      },
      {
        eventId: 'event-gap-suppress-local-103',
        groupId: 57,
        authorSeq: 103,
        timestamp: 10_103,
      },
    ]);
    const localFirst = events[0];
    const localLatest = events[1];
    expect((manager as any).db.insertEvent(localFirst, true)).toBe(true);
    expect((manager as any).db.insertEvent(localLatest, true)).toBe(true);
    const page = {
      v: 1,
      g: 57,
      c: '*',
      d: 'range',
      more: true,
      start: { id: localLatest.eventId, ts: localLatest.timestamp },
      end: { id: localLatest.eventId, ts: localLatest.timestamp },
      wh: (manager as any).db.computeWindowHash([localLatest]),
      events: [localLatest],
    };
    const blob = JSON.stringify(page);
    const pageHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const transferId = 'range-page-no-progress-transfer';
    const filePath = path.join(path.dirname(dbPath), `${transferId}.json`);
    fs.writeFileSync(filePath, blob, 'utf8');
    (manager as any).eventPageOffers.set(transferId, {
      transferId,
      groupId: 57,
      channelId: '*',
      direction: 'range',
      pageHash,
      sizeBytes: Buffer.byteLength(blob, 'utf8'),
      eventCount: 1,
      sourcePeerHash: 'peer-range',
      hasMore: true,
      repairRange: {
        a: localFirst.authorAddress,
        s: TEST_AUTHOR_STREAM_ID,
        from: 3,
        to: 102,
      },
    });
    direct.length = 0;

    await (manager as any).importReceivedEventPageResource({
      status: 'received',
      path: filePath,
      transferId,
      peerPresenceHash: 'peer-range',
    });

    expect(direct).toHaveLength(0);

    expect(
      (manager as any).requestKnownAuthorGaps(57, 'peer-range', 'test', true)
    ).toBe(false);
    expect(direct).toHaveLength(0);

    expect(
      (manager as any).requestKnownAuthorGaps(57, 'peer-other', 'test', true)
    ).toBe(true);
    expect(direct).toContainEqual(
      expect.objectContaining({
        peer: 'peer-other',
        wire: expect.objectContaining({
          t: 'RCHAT',
          k: 'range_req',
          g: 57,
          ranges: [
            {
              a: localFirst.authorAddress,
              s: TEST_AUTHOR_STREAM_ID,
              from: 3,
              to: 102,
            },
          ],
        }),
      })
    );
    manager.close();
  });

  it('backs off repeated known author gap repair requests', async () => {
    const direct: Array<{ peer: string; wire: Record<string, unknown> }> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push({ peer, wire: message });
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    let now = 100_000;
    const dbPath = tempDbPath();
    const manager = new ReticulumChatManager({
      dbPath,
      bridge: bridge as any,
      now: () => now,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([58]);
    manager.subscribeGroup(58);
    const events = signedAuthorEvents([
      {
        eventId: 'event-gap-backoff-local-1',
        groupId: 58,
        authorSeq: 1,
        timestamp: 10_001,
      },
      {
        eventId: 'event-gap-backoff-local-10',
        groupId: 58,
        authorSeq: 10,
        timestamp: 10_010,
      },
    ]);
    const localFirst = events[0];
    expect((manager as any).db.insertEvent(localFirst, true)).toBe(true);
    expect((manager as any).db.insertEvent(events[1], true)).toBe(true);

    expect(
      (manager as any).requestKnownAuthorGaps(58, 'peer-backoff', 'test', true)
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(direct.filter((item) => item.wire.k === 'range_req')).toHaveLength(
      1
    );
    expect(direct[0].wire).toMatchObject({
      t: 'RCHAT',
      k: 'range_req',
      g: 58,
      ranges: [
        {
          a: localFirst.authorAddress,
          s: TEST_AUTHOR_STREAM_ID,
          from: 2,
          to: 9,
        },
      ],
    });

    expect(
      (manager as any).requestKnownAuthorGaps(58, 'peer-backoff', 'test', true)
    ).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(direct.filter((item) => item.wire.k === 'range_req')).toHaveLength(
      1
    );

    now += 30_000;
    expect(
      (manager as any).requestKnownAuthorGaps(58, 'peer-backoff', 'test', true)
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(direct.filter((item) => item.wire.k === 'range_req')).toHaveLength(
      2
    );
    manager.close();
  });

  it('skips already imported event pages before expensive validation', async () => {
    const dbPath = tempDbPath();
    const validateGroupMember = vi.fn(async () => true);
    const manager = new ReticulumChatManager({
      dbPath,
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
        sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
      validateGroupMember,
    });
    manager.setLocalGroupMemberships([57]);
    manager.subscribeGroup(57);
    const events = signedAuthorEvents(
      Array.from({ length: 40 }, (_unused, index) => {
        const seq = index + 1;
        return {
          eventId: `event-page-known-${seq}`,
          groupId: 57,
          channelId: 'general',
          authorSeq: seq,
          timestamp: 10_000 + seq,
        };
      })
    );
    for (const event of events) {
      expect((manager as any).db.insertEvent(event, false)).toBe(true);
    }
    const page = {
      v: 1,
      g: 57,
      c: 'general',
      d: 'before',
      more: false,
      start: { id: events[0].eventId, ts: events[0].timestamp },
      end: {
        id: events[events.length - 1].eventId,
        ts: events[events.length - 1].timestamp,
      },
      wh: (manager as any).db.computeWindowHash(events),
      events,
    };
    const blob = JSON.stringify(page);
    const pageHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const transferId = 'known-page-transfer';
    const filePath = path.join(path.dirname(dbPath), `${transferId}.json`);
    fs.writeFileSync(filePath, blob, 'utf8');
    const eventSpy = vi.fn();
    manager.on('event', eventSpy);
    (manager as any).eventPageOffers.set(transferId, {
      transferId,
      groupId: 57,
      channelId: 'general',
      direction: 'before',
      pageHash,
      sizeBytes: Buffer.byteLength(blob, 'utf8'),
      eventCount: events.length,
      sourcePeerHash: 'peer-known',
      hasMore: false,
    });

    await (manager as any).importReceivedEventPageResource({
      status: 'received',
      path: filePath,
      transferId,
      peerPresenceHash: 'peer-known',
    });

    expect(validateGroupMember).not.toHaveBeenCalled();
    expect(eventSpy).not.toHaveBeenCalled();
    manager.close();
  });

  it('stops and suppresses automatic history pages that contain only known events', async () => {
    const dbPath = tempDbPath();
    const acceptedTransfers: unknown[] = [];
    const manager = new ReticulumChatManager({
      dbPath,
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (payload: unknown) => {
          acceptedTransfers.push(payload);
          return { ok: true as const };
        },
        sendReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([57]);
    manager.subscribeGroup(57);
    const events = signedAuthorEvents(
      Array.from({ length: 5 }, (_unused, index) => {
        const seq = index + 1;
        return {
          eventId: `event-page-known-more-${seq}`,
          groupId: 57,
          channelId: 'general',
          authorSeq: seq,
          timestamp: 10_000 + seq,
        };
      })
    );
    for (const event of events) {
      expect((manager as any).db.insertEvent(event, false)).toBe(true);
    }
    const page = {
      v: 1,
      g: 57,
      c: 'general',
      d: 'before',
      more: true,
      start: { id: events[0].eventId, ts: events[0].timestamp },
      end: {
        id: events[events.length - 1].eventId,
        ts: events[events.length - 1].timestamp,
      },
      wh: (manager as any).db.computeWindowHash(events),
      events,
    };
    const blob = JSON.stringify(page);
    const pageHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const transferId = 'known-page-more-transfer';
    const filePath = path.join(path.dirname(dbPath), `${transferId}.json`);
    fs.writeFileSync(filePath, blob, 'utf8');
    (manager as any).eventPageOffers.set(transferId, {
      transferId,
      groupId: 57,
      channelId: 'general',
      direction: 'before',
      pageHash,
      sizeBytes: Buffer.byteLength(blob, 'utf8'),
      eventCount: events.length,
      sourcePeerHash: 'peer-known-more',
      hasMore: true,
    });

    await (manager as any).importReceivedEventPageResource({
      status: 'received',
      path: filePath,
      transferId,
      peerPresenceHash: 'peer-known-more',
    });

    expect(acceptedTransfers).toHaveLength(0);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_page_offer',
        g: 57,
        p: {
          x: 'known-page-more-repeat-transfer',
          c: 'general',
          d: 'b',
          ph: pageHash,
          s: Buffer.byteLength(blob, 'utf8'),
          n: events.length,
          more: 1,
        },
      },
      'peer-known-more'
    );

    expect(acceptedTransfers).toHaveLength(0);
    manager.close();
  });

  it('does not continue a direct history page when the page cursor does not advance', async () => {
    const dbPath = tempDbPath();
    const acceptedTransfers: unknown[] = [];
    const manager = new ReticulumChatManager({
      dbPath,
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (payload: unknown) => {
          acceptedTransfers.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([57]);
    manager.subscribeGroup(57);
    const events = signedAuthorEvents(
      Array.from({ length: 5 }, (_unused, index) => {
        const seq = index + 1;
        return {
          eventId: `event-page-stalled-${seq}`,
          groupId: 57,
          channelId: 'general',
          authorSeq: seq,
          timestamp: 10_000 + seq,
        };
      })
    );
    for (const event of events) {
      expect((manager as any).db.insertEvent(event, false)).toBe(true);
    }
    const page = {
      v: 1,
      g: 57,
      c: 'general',
      d: 'before',
      more: true,
      start: { id: events[0].eventId, ts: events[0].timestamp },
      end: {
        id: events[events.length - 1].eventId,
        ts: events[events.length - 1].timestamp,
      },
      wh: (manager as any).db.computeWindowHash(events),
      events,
    };
    const blob = JSON.stringify(page);
    const pageHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const transferId = 'stalled-direct-page-transfer';
    const filePath = path.join(path.dirname(dbPath), `${transferId}.json`);
    fs.writeFileSync(filePath, blob, 'utf8');
    (manager as any).directHistoryPageRequests.set(transferId, {
      transferId,
      groupId: 57,
      channelId: 'general',
      direction: 'before',
      pageHash,
      sizeBytes: Buffer.byteLength(blob, 'utf8'),
      eventCount: events.length,
      start: { eventId: events[0].eventId, feedTimestamp: events[0].timestamp },
      sourcePeerHash: 'peer-known',
      hasMore: true,
    });

    await (manager as any).importReceivedEventPageResource({
      status: 'received',
      path: filePath,
      transferId,
      peerPresenceHash: 'peer-known',
    });

    expect(acceptedTransfers).toHaveLength(0);
    manager.close();
  });

  it.skip('repairs bidirectionally when digest hashes differ and local latest is newer', async () => {
    const direct: Record<string, unknown>[] = [];
    const acceptedHistoryLinks: Record<string, unknown>[] = [];
    const peerHash = 'd'.repeat(32);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        acceptedHistoryLinks.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([58]);
    manager.subscribeGroup(58);
    (manager as any).db.upsertChannel({
      groupId: 58,
      channelId: 'general',
      name: 'general',
      position: 0,
      archived: false,
      createdBy: 'test',
      createdAt: 30_000,
      updatedAt: 30_000,
    });
    const [olderLocal, latestLocal] = signedAuthorEvents([
      {
        eventId: 'event-bidirectional-local-old',
        groupId: 58,
        authorSeq: 1,
        timestamp: 30_000,
      },
      {
        eventId: 'event-bidirectional-local-latest',
        groupId: 58,
        authorSeq: 2,
        timestamp: 50_000,
      },
    ]);
    expect((manager as any).db.insertEvent(olderLocal, true)).toBe(true);
    expect((manager as any).db.insertEvent(latestLocal, true)).toBe(true);
    expect(
      manager.getHistory(58, 'general', 10).map((event) => event.eventId)
    ).toContain(latestLocal.eventId);
    const remoteLatest = {
      id: 'event-bidirectional-remote-missing',
      ts: 40_000,
    };
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 58,
        latest: remoteLatest,
        channels: [
          {
            c: 'general',
            latest: remoteLatest,
          },
        ],
        digestHash: 'different-remote-digest-hash',
      },
      peerHash
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(direct.find((wire) => wire.k === 'event_req')).toBeUndefined();
    expect(direct.find((wire) => wire.k === 'feed_req')).toBeUndefined();
    expect(acceptedHistoryLinks).toContainEqual(
      expect.objectContaining({
        peerPresenceHash: peerHash,
        metadata: expect.objectContaining({
          logicalResourceType: 'reticulum_chat_history_page',
          groupId: 58,
          channelId: 'general',
          direction: 'before',
        }),
        authMessage: expect.objectContaining({
          type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
          groupId: 58,
          c: 'general',
          d: 'before',
          before: remoteLatest,
          inc: 1,
        }),
      })
    );
    expect(direct).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'event_page_offer',
        g: 58,
        p: expect.objectContaining({ c: '*', d: 'b' }),
      })
    );
    expect(direct.every((wire) => wire.k !== 'event_batch')).toBe(true);
    manager.close();
  });

  it.skip('requests exact missing group latest before linked history repair', async () => {
    const direct: Record<string, unknown>[] = [];
    const acceptedHistoryLinks: Record<string, unknown>[] = [];
    const peerHash = 'b'.repeat(32);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        acceptedHistoryLinks.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 200_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([716]);
    manager.subscribeGroup(716);
    const [localLatest] = signedAuthorEvents([
      {
        eventId: 'event-local-latest-before-remote',
        groupId: 716,
        authorSeq: 1,
        timestamp: 100_000,
      },
    ]);
    expect((manager as any).db.insertEvent(localLatest, true)).toBe(true);
    const remoteLatest = {
      id: 'event-remote-latest-no-channel-rows',
      ts: 120_000,
    };

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 716,
        latest: remoteLatest,
        channels: [],
        digestHash: 'different-remote-digest-hash',
      },
      peerHash
    );
    await vi.waitUntil(() => direct.some((wire) => wire.k === 'event_req'), {
      timeout: 1_000,
    });
    expect(direct.find((wire) => wire.k === 'event_req')).toMatchObject({
      t: 'RCHAT',
      k: 'event_req',
      g: 716,
      q: expect.objectContaining({ id: remoteLatest.id }),
    });
    expect(direct.find((wire) => wire.k === 'feed_req')).toBeUndefined();
    expect(acceptedHistoryLinks).toHaveLength(0);
    manager.close();
  });

  it.skip('falls back to linked history repair when exact latest request is too large', async () => {
    const acceptedHistoryLinks: Record<string, unknown>[] = [];
    const peerHash = 'b'.repeat(32);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => 'a'.repeat(32),
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async () => ({
        ok: false as const,
        reason: 'wire-too-large' as const,
      }),
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        acceptedHistoryLinks.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 200_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([716]);
    manager.subscribeGroup(716);
    const remoteLatest = {
      id: 'event-remote-latest-too-large-request',
      ts: 120_000,
    };

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'group_digest',
        g: 716,
        latest: remoteLatest,
        channels: [],
        digestHash: 'different-remote-digest-hash',
      },
      peerHash
    );
    await new Promise((resolve) => setTimeout(resolve, 2_200));

    expect(acceptedHistoryLinks.length).toBeGreaterThan(0);
    expect(acceptedHistoryLinks).toContainEqual(
      expect.objectContaining({
        peerPresenceHash: peerHash,
        metadata: expect.objectContaining({
          logicalResourceType: 'reticulum_chat_history_page',
          groupId: 716,
          channelId: '*',
          direction: 'before',
        }),
        authMessage: expect.objectContaining({
          type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
          groupId: 716,
          c: '*',
          d: 'before',
          before: remoteLatest,
          inc: 1,
        }),
      })
    );
    manager.close();
  });

  it('continues backward feed pages with a before cursor', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
    });
    manager.setLocalGroupMemberships([53]);
    manager.subscribeGroup(53);
    direct.length = 0;

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_batch',
        g: 53,
        c: 'general',
        batch: {
          dir: 'before',
          start: { ts: 30_001, id: 'event-history-1' },
          end: { ts: 30_002, id: 'event-history-2' },
          more: true,
          wh: 'hash',
          events: [],
        },
      },
      'peer'
    );

    expect(direct).toContainEqual({
      t: 'RCHAT',
      k: 'feed_req',
      g: 53,
      c: 'general',
      before: { ts: 30_001, id: 'event-history-1' },
      limit: 100,
    });
    manager.close();
  });

  it.skip('serves cached group history for groups the local user belongs to even when not currently open', async () => {
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 60_000,
    });
    manager.setLocalGroupMemberships([54]);
    const event = signedEvent({
      eventId: 'event-archived-openless',
      groupId: 54,
      timestamp: 50_000,
    });
    await manager.publishEvent(event);
    direct.length = 0;

    manager.handleWire(
      { t: 'RCHAT', k: 'feed_req', g: 54, c: 'general', limit: 10 },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      direct.some(
        (wire) => wire.k === 'event_page_offer' || wire.k === 'group_digest'
      )
    ).toBe(true);
    manager.close();
  });

  it('does not publish, type, or serve cached history before local membership is known', async () => {
    const sent: Record<string, unknown>[] = [];
    const direct: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async (
        _peer: string,
        message: Record<string, unknown>
      ) => {
        direct.push(message);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 60_000,
    });
    manager.setLocalGroupMemberships([57]);
    const event = signedEvent({
      eventId: 'event-non-member-cached',
      groupId: 57,
      timestamp: 50_000,
    });
    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: true,
    });

    manager.setLocalGroupMemberships([]);
    sent.length = 0;
    direct.length = 0;

    await expect(
      manager.publishEvent(
        signedEvent({ eventId: 'event-non-member-publish', groupId: 57 })
      )
    ).resolves.toMatchObject({ ok: false });
    expect(() => manager.sendTyping(57, 'Qsender', true)).toThrow(
      /not a member/i
    );

    manager.handleWire(
      { t: 'RCHAT', k: 'feed_req', g: 57, c: 'general', limit: 10 },
      'peer'
    );
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_req',
        g: 57,
        q: signedEventRequestWire({
          groupId: 57,
          eventId: event.eventId,
          timestamp: 60_000,
        }),
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent).toEqual([]);
    expect(direct).toEqual([]);
    expect(() => manager.subscribeGroup(57)).toThrow(/not a member/i);
    manager.close();
  });

  it('refuses to publish when Core membership validation rejects the author', async () => {
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      validateGroupMember: async () => false,
    });
    manager.setLocalGroupMemberships([73]);
    const event = signedEvent({
      eventId: 'event-core-non-member-author',
      groupId: 73,
    });

    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: false,
    });
    expect(manager.getHistory(73, 10)).toEqual([]);
    expect(sent).toEqual([]);
    manager.close();
  });

  it('publishes when Core validates the author even if the local membership cache is not populated yet', async () => {
    const sent: Record<string, unknown>[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async (
        messages: Record<string, unknown>[]
      ) => {
        sent.push(...messages);
        return { ok: true as const };
      },
    };
    const event = signedEvent({
      eventId: 'event-core-member-author-with-empty-local-cache',
      groupId: 77,
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      validateGroupMember: async (_groupId, address) =>
        address === event.authorAddress,
    });

    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: true,
    });
    expect(manager.getHistory(77, 10)).toContainEqual(
      expect.objectContaining({ eventId: event.eventId })
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'group_state_digest_v3',
        g: 77,
      })
    );
    manager.close();
  });

  it('applies channel metadata only when the author is a group admin', async () => {
    const payload = {
      channelId: 'support',
      name: 'support',
      position: 1,
    };
    const nonAdminEvent = signedEvent({
      eventId: 'event-channel-non-admin',
      groupId: 78,
      channelId: 'support',
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify(payload),
    });
    const nonAdminManager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 20_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => false,
    });
    nonAdminManager.setLocalGroupMemberships([78]);
    expect((nonAdminManager as any).db.insertEvent(nonAdminEvent, true)).toBe(
      true
    );
    await expect(
      nonAdminManager.applyChannelMetadataEvent(nonAdminEvent.eventId, payload)
    ).resolves.toBe(false);
    expect(
      nonAdminManager.getChannels(78, true).map((channel) => channel.channelId)
    ).toEqual(['general', RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID]);
    nonAdminManager.close();

    const adminEvent = signedEvent({
      eventId: 'event-channel-admin',
      groupId: 79,
      channelId: 'support',
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify(payload),
    });
    const adminManager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 20_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    adminManager.setLocalGroupMemberships([79]);
    expect((adminManager as any).db.insertEvent(adminEvent, true)).toBe(true);
    await expect(
      adminManager.applyChannelMetadataEvent(adminEvent.eventId, payload)
    ).resolves.toBe(true);
    expect(
      adminManager.getChannels(79, true).map((channel) => channel.channelId)
    ).toContain('support');
    adminManager.close();
  });

  it('applies custom channel expiry metadata but preserves built-in policies', async () => {
    const groupId = 791;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([groupId]);

    const createPayload = {
      channelId: 'expiring-channel',
      name: 'expiring-channel',
      position: 2,
      expiryDurationMs: 2 * RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
    };
    const createEvent = signedEvent({
      eventId: 'event-expiring-channel-create',
      groupId,
      channelId: createPayload.channelId,
      eventType: 'channel_create',
      timestamp: 10_000,
      encryptedPayload: JSON.stringify(createPayload),
    });
    expect((manager as any).db.insertEvent(createEvent, true)).toBe(true);
    await expect(
      manager.applyChannelMetadataEvent(createEvent.eventId, createPayload)
    ).resolves.toBe(true);
    expect(
      manager
        .getChannels(groupId, true)
        .find((channel) => channel.channelId === createPayload.channelId)
        ?.expiryDurationMs
    ).toBe(createPayload.expiryDurationMs);

    const removePayload = {
      ...createPayload,
      expiryDurationMs: 0,
    };
    const removeEvent = signedEvent({
      eventId: 'event-expiring-channel-remove-expiry',
      groupId,
      channelId: createPayload.channelId,
      eventType: 'channel_update',
      timestamp: 20_000,
      encryptedPayload: JSON.stringify(removePayload),
    });
    expect((manager as any).db.insertEvent(removeEvent, true)).toBe(true);
    await expect(
      manager.applyChannelMetadataEvent(removeEvent.eventId, removePayload)
    ).resolves.toBe(true);
    expect(
      manager
        .getChannels(groupId, true)
        .find((channel) => channel.channelId === createPayload.channelId)
        ?.expiryDurationMs
    ).toBeUndefined();

    const builtInPayload = {
      channelId: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
      name: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
      position: 1,
      writeMode: 'admins',
      readMode: 'admins',
      expiryDurationMs: 7 * RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
    };
    const builtInEvent = signedEvent({
      eventId: 'event-qortal-land-expiry-update-ignored',
      groupId,
      channelId: builtInPayload.channelId,
      eventType: 'channel_update',
      timestamp: 30_000,
      encryptedPayload: JSON.stringify(builtInPayload),
    });
    expect((manager as any).db.insertEvent(builtInEvent, true)).toBe(true);
    await expect(
      manager.applyChannelMetadataEvent(builtInEvent.eventId, builtInPayload)
    ).resolves.toBe(true);
    const builtInChannel = manager
      .getChannels(groupId, true)
      .find((channel) => channel.channelId === builtInPayload.channelId);
    expect(builtInChannel?.expiryDurationMs).toBe(
      RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS
    );
    expect(builtInChannel).toMatchObject({
      writeMode: 'members',
      readMode: 'members',
    });
    manager.close();
  });

  it('retries channel metadata projection when admin validation is temporarily unavailable', async () => {
    const payload = {
      channelId: 'deferred-admin-channel',
      name: 'deferred-admin-channel',
      position: 1,
    };
    const event = signedEvent({
      eventId: 'event-channel-admin-validation-deferred',
      groupId: 80,
      channelId: 'deferred-admin-channel',
      eventType: 'channel_create',
      timestamp: 20_000,
      encryptedPayload: JSON.stringify(payload),
    });
    let attempts = 0;
    let now = 20_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => now,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary validation failure');
        return true;
      },
    });
    manager.setLocalGroupMemberships([80]);
    expect(await (manager as any).acceptEvent(event, false)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      manager.getChannels(80, true).map((channel) => channel.channelId)
    ).not.toContain('deferred-admin-channel');

    now += 10_000;
    manager.subscribeGroup(80);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(
      manager.getChannels(80, true).map((channel) => channel.channelId)
    ).toContain('deferred-admin-channel');
    manager.close();
  });

  it('stores channel write mode from admin metadata', async () => {
    const payload = {
      channelId: 'announcements',
      name: 'announcements',
      position: 1,
      writeMode: 'admins',
    };
    const event = signedEvent({
      eventId: 'event-channel-admin-write-mode',
      groupId: 79,
      channelId: 'announcements',
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify(payload),
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([79]);
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    await expect(
      manager.applyChannelMetadataEvent(event.eventId, payload)
    ).resolves.toBe(true);
    expect(manager.getChannels(79, true)).toContainEqual(
      expect.objectContaining({
        channelId: 'announcements',
        writeMode: 'admins',
      })
    );
    manager.close();
  });

  it('stores admin-only channel read mode from admin metadata', async () => {
    const payload = {
      channelId: 'admin-private',
      name: 'admin-private',
      position: 1,
      writeMode: 'admins',
      readMode: 'admins',
    };
    const event = signedEvent({
      eventId: 'event-channel-admin-read-mode',
      groupId: 79,
      channelId: 'admin-private',
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify(payload),
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([{ groupId: 79, isAdmin: true }]);
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    await expect(
      manager.applyChannelMetadataEvent(event.eventId, payload)
    ).resolves.toBe(true);
    expect(manager.getChannels(79, true)).toContainEqual(
      expect.objectContaining({
        channelId: 'admin-private',
        writeMode: 'admins',
        readMode: 'admins',
      })
    );
    manager.close();
  });

  it('rejects non-admin linked history requests for admin-private channels', async () => {
    const sentResources: Array<Record<string, unknown>> = [];
    const rejections: Array<Record<string, unknown>> = [];
    const requesterPeerHash = 'd'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          sentResources.push(payload);
          return { ok: true as const };
        },
        authorizeReticulumChatResourceDetailed: async () => ({
          ok: true as const,
        }),
        rejectReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          rejections.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => false,
    });
    upsertTestChannel(manager, {
      groupId: 79,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-admin-private-history-hidden',
      groupId: 79,
      channelId: 'admin-private',
      timestamp: 90_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    const request = signedHistoryPageRequestWire({
      groupId: 79,
      channelId: 'admin-private',
      direction: 'before',
      cursor: { id: event.eventId, ts: event.timestamp },
      includeCursor: true,
      limit: 10,
      timestamp: 100_000,
    });
    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'admin-private-history-link',
      transferId: 'admin-private-history-transfer',
      peerPresenceHash: requesterPeerHash,
      auth: {
        ...request,
        type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
        groupId: 79,
        requesterPeerHash,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sentResources).toEqual([]);
    expect(rejections).toContainEqual(
      expect.objectContaining({
        transferId: 'admin-private-history-transfer',
        reason: 'channel_read_forbidden',
      })
    );
    manager.close();
  });

  it('allows admin linked history requests for admin-private channels', async () => {
    const sentResources: Array<Record<string, unknown>> = [];
    const rejections: Array<Record<string, unknown>> = [];
    const requesterPeerHash = 'd'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          sentResources.push(payload);
          return { ok: true as const };
        },
        authorizeReticulumChatResourceDetailed: async () => ({
          ok: true as const,
        }),
        rejectReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          rejections.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    upsertTestChannel(manager, {
      groupId: 79,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-admin-private-history-visible',
      groupId: 79,
      channelId: 'admin-private',
      timestamp: 90_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    const request = signedHistoryPageRequestWire({
      groupId: 79,
      channelId: 'admin-private',
      direction: 'before',
      cursor: { id: event.eventId, ts: event.timestamp },
      includeCursor: true,
      limit: 10,
      timestamp: 100_000,
    });
    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'admin-private-history-link-admin',
      transferId: 'admin-private-history-transfer-admin',
      peerPresenceHash: requesterPeerHash,
      auth: {
        ...request,
        type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
        groupId: 79,
        requesterPeerHash,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(rejections).toEqual([]);
    expect(sentResources).toHaveLength(1);
    const page = JSON.parse(
      fs.readFileSync(String(sentResources[0].filePath), 'utf8')
    ) as {
      events: ReticulumChatEvent[];
    };
    expect(page.events.map((item) => item.eventId)).toEqual([event.eventId]);
    manager.close();
  });

  it('filters admin-private channel events from non-admin all-channel history pages', async () => {
    const sentResources: Array<Record<string, unknown>> = [];
    const requesterPeerHash = 'd'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          sentResources.push(payload);
          return { ok: true as const };
        },
        authorizeReticulumChatResourceDetailed: async () => ({
          ok: true as const,
        }),
        rejectReticulumChatResourceDetailed: async () => ({
          ok: true as const,
        }),
      } as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => false,
    });
    upsertTestChannel(manager, {
      groupId: 79,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const publicEvent = signedEvent({
      eventId: 'event-all-channel-public-visible',
      groupId: 79,
      channelId: 'general',
      timestamp: 80_000,
    });
    const privateEvent = signedEvent({
      eventId: 'event-all-channel-admin-private-hidden',
      groupId: 79,
      channelId: 'admin-private',
      timestamp: 90_000,
    });
    expect((manager as any).db.insertEvent(publicEvent, true)).toBe(true);
    expect((manager as any).db.insertEvent(privateEvent, true)).toBe(true);

    const request = signedHistoryPageRequestWire({
      groupId: 79,
      channelId: '*',
      direction: 'before',
      cursor: { id: privateEvent.eventId, ts: privateEvent.timestamp },
      includeCursor: true,
      limit: 10,
      timestamp: 100_000,
    });
    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'all-channel-history-link',
      transferId: 'all-channel-history-transfer',
      peerPresenceHash: requesterPeerHash,
      auth: {
        ...request,
        type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
        groupId: 79,
        requesterPeerHash,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sentResources).toHaveLength(1);
    const page = JSON.parse(
      fs.readFileSync(String(sentResources[0].filePath), 'utf8')
    ) as {
      events: ReticulumChatEvent[];
    };
    expect(page.events.map((item) => item.eventId)).toEqual([
      publicEvent.eventId,
    ]);
    manager.close();
  });

  it('includes admin-private channel events in admin all-channel history pages', async () => {
    const sentResources: Array<Record<string, unknown>> = [];
    const requesterPeerHash = 'd'.repeat(32);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          sentResources.push(payload);
          return { ok: true as const };
        },
        authorizeReticulumChatResourceDetailed: async () => ({
          ok: true as const,
        }),
        rejectReticulumChatResourceDetailed: async () => ({
          ok: true as const,
        }),
      } as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    upsertTestChannel(manager, {
      groupId: 79,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const publicEvent = signedEvent({
      eventId: 'event-all-channel-admin-public-visible',
      groupId: 79,
      channelId: 'general',
      timestamp: 80_000,
    });
    const privateEvent = signedEvent({
      eventId: 'event-all-channel-admin-private-visible',
      groupId: 79,
      channelId: 'admin-private',
      timestamp: 90_000,
    });
    expect((manager as any).db.insertEvent(publicEvent, true)).toBe(true);
    expect((manager as any).db.insertEvent(privateEvent, true)).toBe(true);

    const request = signedHistoryPageRequestWire({
      groupId: 79,
      channelId: '*',
      direction: 'before',
      cursor: { id: privateEvent.eventId, ts: privateEvent.timestamp },
      includeCursor: true,
      limit: 10,
      timestamp: 100_000,
    });
    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'all-channel-history-link-admin',
      transferId: 'all-channel-history-transfer-admin',
      peerPresenceHash: requesterPeerHash,
      auth: {
        ...request,
        type: 'RETICULUM_CHAT_HISTORY_PAGE_REQUEST',
        groupId: 79,
        requesterPeerHash,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sentResources).toHaveLength(1);
    const page = JSON.parse(
      fs.readFileSync(String(sentResources[0].filePath), 'utf8')
    ) as {
      events: ReticulumChatEvent[];
    };
    expect(page.events.map((item) => item.eventId)).toEqual([
      publicEvent.eventId,
      privateEvent.eventId,
    ]);
    manager.close();
  });

  it('does not import admin-private event batches for local non-admins', async () => {
    const groupId = 89;
    const localAddress = 'QlocalNonAdminReadHidden';
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async (_groupId, address) => address !== localAddress,
    });
    manager.setLocalGroupMemberships([{ groupId, localAddress }]);
    manager.subscribeGroup(groupId);
    upsertTestChannel(manager, {
      groupId,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const privateEvent = signedEvent({
      eventId: 'event-batch-admin-private-hidden',
      groupId,
      channelId: 'admin-private',
      timestamp: 10_000,
    });

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_batch',
        g: groupId,
        c: 'admin-private',
        batch: { events: [privateEvent] },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((manager as any).db.hasEvent(privateEvent.eventId)).toBe(false);
    manager.close();
  });

  it('imports admin-private event batches for local admins', async () => {
    const groupId = 90;
    const localAddress = 'QlocalAdminReadPrivate';
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([
      { groupId, localAddress, isAdmin: true },
    ]);
    manager.subscribeGroup(groupId);
    upsertTestChannel(manager, {
      groupId,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const privateEvent = signedEvent({
      eventId: 'event-batch-admin-private-visible',
      groupId,
      channelId: 'admin-private',
      timestamp: 10_000,
    });

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_batch',
        g: groupId,
        c: 'admin-private',
        batch: { events: [privateEvent] },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((manager as any).db.hasEvent(privateEvent.eventId)).toBe(true);
    manager.close();
  });

  it('keeps admin-only write mode effective time across later channel updates', async () => {
    const groupId = 79;
    const channelId = 'announcements';
    const createPayload = {
      channelId,
      name: channelId,
      position: 1,
      writeMode: 'admins',
    };
    const createEvent = signedEvent({
      eventId: 'event-channel-admin-write-mode-created',
      groupId,
      channelId,
      timestamp: 5_000,
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify(createPayload),
    });
    const updatePayload = {
      channelId,
      name: 'announcements-renamed',
      position: 1,
    };
    const updateEvent = signedEvent({
      eventId: 'event-channel-admin-write-mode-renamed',
      groupId,
      channelId,
      timestamp: 20_000,
      eventType: 'channel_update',
      encryptedPayload: JSON.stringify(updatePayload),
    });
    const nonAdminMessage = signedEvent({
      eventId: 'event-channel-non-admin-between-write-mode-and-rename',
      groupId,
      channelId,
      timestamp: 10_000,
    });
    const adminAddresses = new Set([
      createEvent.authorAddress,
      updateEvent.authorAddress,
    ]);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 30_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async (_groupId, address) =>
        adminAddresses.has(address),
    });
    manager.setLocalGroupMemberships([groupId]);
    manager.subscribeGroup(groupId);
    expect((manager as any).db.insertEvent(createEvent, true)).toBe(true);
    await expect(
      manager.applyChannelMetadataEvent(createEvent.eventId, createPayload)
    ).resolves.toBe(true);
    expect((manager as any).db.insertEvent(updateEvent, true)).toBe(true);
    await expect(
      manager.applyChannelMetadataEvent(updateEvent.eventId, updatePayload)
    ).resolves.toBe(true);
    expect(manager.getChannels(groupId, true)).toContainEqual(
      expect.objectContaining({
        channelId,
        writeMode: 'admins',
        writeModeUpdatedAt: 5_000,
        updatedAt: 20_000,
      })
    );

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_batch',
        g: groupId,
        c: channelId,
        batch: {
          events: [nonAdminMessage],
        },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(manager.getHistory(groupId, channelId, 10)).not.toContainEqual(
      expect.objectContaining({ eventId: nonAdminMessage.eventId })
    );
    manager.close();
  });

  it('rejects non-admin writes in admin-only write channels', async () => {
    const sent: Record<string, unknown>[] = [];
    const groupId = 79;
    const channelId = 'announcements';
    const event = signedEvent({
      eventId: 'event-non-admin-announcement-write',
      groupId,
      channelId,
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          sent.push(...messages);
          return { ok: true as const };
        },
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => false,
    });
    manager.setLocalGroupMemberships([groupId]);
    (manager as any).db.upsertChannel({
      groupId,
      channelId,
      name: channelId,
      position: 1,
      archived: false,
      writeMode: 'admins',
      createdBy: 'admin',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(manager.getChannels(groupId, true)).toContainEqual(
      expect.objectContaining({ channelId, writeMode: 'admins' })
    );

    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: false,
    });
    expect(manager.getHistory(groupId, channelId, 10)).toEqual([]);
    expect(sent).toEqual([]);
    manager.close();
  });

  it('allows admin writes in admin-only write channels', async () => {
    const sent: Record<string, unknown>[] = [];
    const groupId = 79;
    const channelId = 'announcements';
    const event = signedEvent({
      eventId: 'event-admin-announcement-write',
      groupId,
      channelId,
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async (
          messages: Record<string, unknown>[]
        ) => {
          sent.push(...messages);
          return { ok: true as const };
        },
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([groupId]);
    (manager as any).db.upsertChannel({
      groupId,
      channelId,
      name: channelId,
      position: 1,
      archived: false,
      writeMode: 'admins',
      createdBy: 'admin',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(manager.getChannels(groupId, true)).toContainEqual(
      expect.objectContaining({ channelId, writeMode: 'admins' })
    );

    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: true,
    });
    expect(manager.getHistory(groupId, channelId, 10)).toContainEqual(
      expect.objectContaining({ eventId: event.eventId })
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        t: 'RCHAT',
        k: 'group_state_digest_v3',
        g: groupId,
      })
    );
    manager.close();
  });

  it('rejects synced non-admin writes in admin-only write channels', async () => {
    const groupId = 79;
    const channelId = 'announcements';
    const event = signedEvent({
      eventId: 'event-synced-non-admin-announcement-write',
      groupId,
      channelId,
      timestamp: 10_000,
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 20_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => false,
    });
    manager.setLocalGroupMemberships([groupId]);
    manager.subscribeGroup(groupId);
    (manager as any).db.upsertChannel({
      groupId,
      channelId,
      name: channelId,
      position: 1,
      archived: false,
      writeMode: 'admins',
      createdBy: 'admin',
      createdAt: 1,
      updatedAt: 5_000,
    });

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_batch',
        g: groupId,
        c: channelId,
        batch: {
          events: [event],
        },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(manager.getHistory(groupId, channelId, 10)).toEqual([]);
    manager.close();
  });

  it('accepts synced admin writes in admin-only write channels', async () => {
    const groupId = 79;
    const channelId = 'announcements';
    const event = signedEvent({
      eventId: 'event-synced-admin-announcement-write',
      groupId,
      channelId,
      timestamp: 10_000,
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      now: () => 20_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([groupId]);
    manager.subscribeGroup(groupId);
    (manager as any).db.upsertChannel({
      groupId,
      channelId,
      name: channelId,
      position: 1,
      archived: false,
      writeMode: 'admins',
      createdBy: 'admin',
      createdAt: 1,
      updatedAt: 5_000,
    });

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_batch',
        g: groupId,
        c: channelId,
        batch: {
          events: [event],
        },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(manager.getHistory(groupId, channelId, 10)).toContainEqual(
      expect.objectContaining({ eventId: event.eventId })
    );
    manager.close();
  });

  it('projects channel metadata when events are accepted by sync import', async () => {
    const payload = {
      channelId: 'sync-channel',
      name: 'sync-channel',
      position: 1,
    };
    const event = signedEvent({
      eventId: 'event-channel-sync-import',
      groupId: 80,
      channelId: 'sync-channel',
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify(payload),
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([80]);

    expect(await (manager as any).acceptEvent(event, false)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(manager.getChannels(80, true)).toContainEqual(
      expect.objectContaining({ channelId: 'sync-channel' })
    );
    manager.close();
  });

  it('repairs persisted channel metadata projection on subscription', async () => {
    const payload = {
      channelId: 'persisted-channel',
      name: 'persisted-channel',
      position: 1,
    };
    const event = signedEvent({
      eventId: 'event-channel-persisted-import',
      groupId: 82,
      channelId: 'persisted-channel',
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify(payload),
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([82]);
    expect((manager as any).db.insertEvent(event, false)).toBe(true);
    expect(
      manager.getChannels(82, true).map((channel) => channel.channelId)
    ).not.toContain('persisted-channel');

    manager.subscribeGroup(82);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(manager.getChannels(82, true)).toContainEqual(
      expect.objectContaining({ channelId: 'persisted-channel' })
    );
    manager.close();
  });

  it('rebuilds a missing channel projection before applying newer incremental metadata', async () => {
    const groupId = 820;
    const channelId = 'persisted-reordered-channel';
    const now = Date.now();
    const createEvent = signedEvent({
      eventId: 'event-channel-persisted-create',
      groupId,
      channelId,
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify({
        channelId,
        name: 'original-name',
        position: 8,
        writeMode: 'members',
        readMode: 'members',
      }),
      timestamp: now - 3_000,
    });
    const updateEvent = signedEvent({
      eventId: 'event-channel-persisted-update',
      groupId,
      channelId,
      eventType: 'channel_update',
      encryptedPayload: JSON.stringify({
        channelId,
        name: 'current-name',
        position: 8,
        writeMode: 'members',
        readMode: 'members',
      }),
      timestamp: now - 2_000,
    });
    const reorderEvent = signedEvent({
      eventId: 'event-channel-persisted-reorder',
      groupId,
      channelId,
      eventType: 'channel_reorder',
      encryptedPayload: JSON.stringify({
        channelId,
        categoryId: 'cat-current-category',
        position: 2,
      }),
      timestamp: now - 1_000,
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([groupId]);
    upsertTestCategory(manager, {
      groupId,
      categoryId: 'cat-current-category',
    });
    expect((manager as any).db.insertEvent(createEvent, false)).toBe(true);
    expect((manager as any).db.insertEvent(updateEvent, false)).toBe(true);
    expect((manager as any).db.insertEvent(reorderEvent, false)).toBe(true);

    manager.subscribeGroup(groupId);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(manager.getChannels(groupId, true)).toContainEqual(
      expect.objectContaining({
        channelId,
        categoryId: 'cat-current-category',
        name: 'current-name',
        position: 2,
      })
    );
    expect(
      (manager as any).db.getMetadataEntityRevision(
        groupId,
        'channel',
        channelId
      )
    ).toMatchObject({
      eventId: reorderEvent.eventId,
      eventType: 'channel_reorder',
    });
    manager.close();
  });

  it('rebuilds built-in qortal-land metadata without a channel-create event', async () => {
    const groupId = 822;
    const channelId = RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID;
    const now = Date.now();
    const [reorderEvent, updateEvent] = signedAuthorEvents([
      {
        eventId: 'event-qortal-land-reorder-without-create',
        groupId,
        channelId,
        authorSeq: 1,
        eventType: 'channel_reorder',
        encryptedPayload: JSON.stringify({ channelId, position: 3 }),
        timestamp: now - 2_000,
      },
      {
        eventId: 'event-qortal-land-update-without-create',
        groupId,
        channelId,
        authorSeq: 2,
        eventType: 'channel_update',
        encryptedPayload: JSON.stringify({
          channelId,
          name: '🎲︱qortal-land',
          position: 0,
          writeMode: 'members',
          readMode: 'members',
        }),
        timestamp: now - 1_000,
      },
    ]);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([groupId]);
    (manager as any).db.upsertChannel({
      groupId,
      channelId,
      name: 'general',
      position: 1,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      writeModeUpdatedAt: 0,
      expiryDurationMs: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
      createdBy: '',
      createdAt: 0,
      updatedAt: 0,
    });
    expect((manager as any).db.insertEvent(reorderEvent, false)).toBe(true);
    expect((manager as any).db.insertEvent(updateEvent, false)).toBe(true);

    manager.subscribeGroup(groupId);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(
      manager
        .getChannels(groupId, true)
        .find((channel) => channel.channelId === channelId)
    ).toEqual(
      expect.objectContaining({
        channelId,
        name: '🎲︱qortal-land',
        position: 0,
        expiryDurationMs: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
      })
    );
    expect(
      (manager as any).db.getMetadataEntityRevisionRecord(
        groupId,
        'channel',
        channelId
      )
    ).toMatchObject({
      source: 'event',
      revision: {
        eventId: updateEvent.eventId,
        eventType: updateEvent.eventType,
      },
    });
    manager.close();
  });

  it('lets a same-head snapshot repair event-derived channel state', () => {
    const groupId = 823;
    const channelId = RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID;
    const eventId = 'event-qortal-land-same-head-update';
    const timestamp = 200;
    const db = new ReticulumChatDatabase(tempDbPath());
    const badChannel = {
      groupId,
      channelId,
      name: 'general',
      position: 0,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      writeModeUpdatedAt: timestamp,
      expiryDurationMs: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: timestamp,
    };
    const snapshotChannel = {
      ...badChannel,
      name: '🎲︱qortal-land',
    };
    const snapshotStateHash = hashReticulumChatMetadataEntityState(
      'channel',
      channelId,
      snapshotChannel
    );
    db.upsertChannel(badChannel);
    db.upsertMetadataEntityRevision(groupId, {
      entityType: 'channel',
      entityId: channelId,
      eventId,
      eventType: 'channel_update',
      timestamp,
      deleted: false,
      stateHash: 'f'.repeat(64),
    });
    expect(
      db.getMetadataEntityRevisionRecord(groupId, 'channel', channelId)?.source
    ).toBe('event');

    expect(
      db.applyMetadataSnapshot({
        groupId,
        snapshotId: 'snapshot-repairs-event-derived-state',
        scope: 'public',
        parentSnapshotHash: '',
        version: 1,
        createdAt: 300,
        latestEventId: eventId,
        latestFeedTimestamp: timestamp,
        snapshotHash: 'd'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [snapshotChannel],
        categories: [],
        revisions: [
          {
            entityType: 'channel',
            entityId: channelId,
            eventId,
            eventType: 'channel_update',
            timestamp,
            deleted: false,
            stateHash: snapshotStateHash,
          },
        ],
      })
    ).toBe(true);

    expect(
      db
        .getChannels(groupId, true)
        .find((channel) => channel.channelId === channelId)
    ).toEqual(expect.objectContaining({ name: '🎲︱qortal-land' }));
    expect(
      db.getMetadataEntityRevisionRecord(groupId, 'channel', channelId)
    ).toMatchObject({
      source: 'snapshot',
      revision: { stateHash: snapshotStateHash },
    });
    db.close();
  });

  it('requires built-in snapshot revisions to match their advertised channel state', () => {
    const channel = {
      groupId: 824,
      channelId: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
      name: '🎲︱qortal-land',
      position: 1,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      writeModeUpdatedAt: 100,
      expiryDurationMs: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 100,
    };
    const snapshot = {
      groupId: 824,
      snapshotId: 'built-in-revision-mismatch',
      scope: 'public' as const,
      parentSnapshotHash: '',
      version: 1,
      createdAt: 100,
      latestEventId: 'qortal-land-update',
      latestFeedTimestamp: 100,
      snapshotHash: 'a'.repeat(64),
      adminAddress: 'Qadmin',
      adminPublicKey: 'public-key',
      signature: 'signature',
      channels: [channel],
      categories: [],
      revisions: [
        {
          entityType: 'channel' as const,
          entityId: channel.channelId,
          eventId: 'qortal-land-update',
          eventType: 'channel_update',
          timestamp: 100,
          deleted: false,
          stateHash: hashReticulumChatMetadataEntityState(
            'channel',
            channel.channelId,
            {
              ...channel,
              name: 'wrong-name',
            }
          ),
        },
      ],
    };

    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(false);
    snapshot.revisions[0].stateHash = hashReticulumChatMetadataEntityState(
      'channel',
      channel.channelId,
      channel
    );
    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(true);

    const restrictedChannel = {
      ...channel,
      writeMode: 'admins' as const,
      readMode: 'admins' as const,
    };
    expect(
      metadataSnapshotHasConsistentRevisions({
        ...snapshot,
        channels: [restrictedChannel],
        revisions: [
          {
            ...snapshot.revisions[0],
            stateHash: hashReticulumChatMetadataEntityState(
              'channel',
              channel.channelId,
              restrictedChannel
            ),
          },
        ],
      })
    ).toBe(false);

    snapshot.channels = [
      {
        ...channel,
        expiryDurationMs: 7 * RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
      },
    ];
    snapshot.revisions[0].stateHash = hashReticulumChatMetadataEntityState(
      'channel',
      channel.channelId,
      snapshot.channels[0]
    );
    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(false);
    snapshot.channels = [channel];
    snapshot.revisions[0].stateHash = hashReticulumChatMetadataEntityState(
      'channel',
      channel.channelId,
      channel
    );

    snapshot.revisions = [];
    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(false);
    snapshot.channels = [
      {
        ...channel,
        name: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
        position: 1,
        writeModeUpdatedAt: 0,
        createdBy: '',
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(true);
  });

  it('accepts legacy general snapshots but rejects an altered expiry', () => {
    const channel = {
      groupId: 825,
      channelId: RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      name: RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      position: 0,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      writeModeUpdatedAt: 0,
      expiryDurationMs: RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS,
      createdBy: '',
      createdAt: 0,
      updatedAt: 0,
    };
    const snapshot = {
      groupId: channel.groupId,
      snapshotId: 'general-fixed-expiry',
      scope: 'public' as const,
      parentSnapshotHash: '',
      version: 1,
      createdAt: 100,
      latestEventId: '',
      latestFeedTimestamp: 0,
      snapshotHash: 'b'.repeat(64),
      adminAddress: 'Qadmin',
      adminPublicKey: 'public-key',
      signature: 'signature',
      channels: [channel],
      categories: [],
      revisions: [],
    };

    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(true);
    expect(
      metadataSnapshotHasConsistentRevisions({
        ...snapshot,
        channels: [{ ...channel, expiryDurationMs: undefined }],
      })
    ).toBe(true);
    const legacyChannel = { ...channel, expiryDurationMs: undefined };
    expect(
      metadataSnapshotHasConsistentRevisions({
        ...snapshot,
        channels: [legacyChannel],
        revisions: [
          {
            entityType: 'channel' as const,
            entityId: legacyChannel.channelId,
            eventId: 'legacy-general-update',
            eventType: 'channel_update',
            timestamp: 100,
            deleted: false,
            stateHash: hashReticulumChatMetadataEntityState(
              'channel',
              legacyChannel.channelId,
              legacyChannel
            ),
          },
        ],
      })
    ).toBe(true);
    expect(
      metadataSnapshotHasConsistentRevisions({
        ...snapshot,
        channels: [
          {
            ...channel,
            expiryDurationMs: RETICULUM_CHAT_QORTAL_LAND_CHANNEL_EXPIRY_MS,
          },
        ],
      })
    ).toBe(false);
  });

  it('rejects malformed snapshot channel records instead of normalizing them', () => {
    const groupId = 829;
    const channel = {
      groupId,
      channelId: 'valid-channel',
      name: 'Valid channel',
      position: 1,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      writeModeUpdatedAt: 100,
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 100,
    };
    const snapshot = {
      groupId,
      snapshotId: 'malformed-channel-record',
      scope: 'public' as const,
      parentSnapshotHash: '',
      version: 1,
      createdAt: 100,
      latestEventId: 'valid-channel-create',
      latestFeedTimestamp: 100,
      snapshotHash: 'e'.repeat(64),
      adminAddress: 'Qadmin',
      adminPublicKey: 'public-key',
      signature: 'signature',
      channels: [channel],
      categories: [],
      revisions: [
        {
          entityType: 'channel' as const,
          entityId: channel.channelId,
          eventId: 'valid-channel-create',
          eventType: 'channel_create',
          timestamp: 100,
          deleted: false,
          stateHash: hashReticulumChatMetadataEntityState(
            'channel',
            channel.channelId,
            channel
          ),
        },
      ],
    };
    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(true);

    snapshot.channels = [{ ...channel, channelId: 'INVALID CHANNEL' }];
    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(false);
    snapshot.channels = [{ ...channel, name: ' Valid channel ' }];
    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(false);
  });

  it('rejects snapshot channels that reference a missing category', () => {
    const channel = {
      groupId: 825,
      channelId: 'orphaned-channel',
      categoryId: 'cat-missing',
      name: 'orphaned-channel',
      position: 1,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      writeModeUpdatedAt: 100,
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 100,
    };
    expect(
      metadataSnapshotHasConsistentRevisions({
        groupId: 825,
        snapshotId: 'orphaned-channel-snapshot',
        scope: 'full',
        parentSnapshotHash: '',
        version: 1,
        createdAt: 100,
        latestEventId: 'orphaned-channel-create',
        latestFeedTimestamp: 100,
        snapshotHash: 'b'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [channel],
        categories: [],
        revisions: [
          {
            entityType: 'channel',
            entityId: channel.channelId,
            eventId: 'orphaned-channel-create',
            eventType: 'channel_create',
            timestamp: 100,
            deleted: false,
            stateHash: hashReticulumChatMetadataEntityState(
              'channel',
              channel.channelId,
              channel
            ),
          },
        ],
      })
    ).toBe(false);
  });

  it('keeps category deletion and affected channel snapshot revisions consistent', async () => {
    const groupId = 826;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => 1_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([
      {
        groupId,
        isAdmin: true,
        localAddress: 'QlocalAdmin',
      },
    ]);
    const summaryChanges: Array<Record<string, unknown>> = [];
    manager.on('summaryChanged', (payload) => {
      summaryChanges.push(payload as Record<string, unknown>);
    });
    const apply = async (
      eventId: string,
      eventType: ReticulumChatEvent['eventType'],
      payload: Record<string, unknown>,
      timestamp: number,
      channelId = 'general'
    ) => {
      const event = signedEvent({
        eventId,
        groupId,
        channelId,
        eventType,
        timestamp,
        encryptedPayload: JSON.stringify(payload),
      });
      expect((manager as any).db.insertEvent(event, true)).toBe(true);
      await expect(
        manager.applyChannelMetadataEvent(eventId, payload)
      ).resolves.toBe(true);
      return event;
    };
    await apply(
      'category-cascade-create',
      'category_create',
      {
        categoryId: 'cat-cascade',
        name: 'Cascade',
        position: 0,
      },
      100
    );
    await apply(
      'category-cascade-channel',
      'channel_create',
      {
        channelId: 'cascade-channel',
        categoryId: 'cat-cascade',
        name: 'Cascade channel',
        position: 0,
      },
      200,
      'cascade-channel'
    );
    const deleteEvent = await apply(
      'category-cascade-delete',
      'category_delete',
      {
        categoryId: 'cat-cascade',
      },
      300
    );

    const channel = (manager as any).db.getChannel(groupId, 'cascade-channel');
    const revision = (manager as any).db.getMetadataEntityRevision(
      groupId,
      'channel',
      'cascade-channel'
    );
    expect(channel).toMatchObject({
      channelId: 'cascade-channel',
      categoryId: undefined,
    });
    expect(revision).toMatchObject({
      eventId: deleteEvent.eventId,
      eventType: 'channel_reorder',
      timestamp: deleteEvent.timestamp,
      stateHash: hashReticulumChatMetadataEntityState(
        'channel',
        'cascade-channel',
        channel
      ),
    });
    expect(summaryChanges).toContainEqual(
      expect.objectContaining({
        groupId,
        eventId: deleteEvent.eventId,
        metadataChanged: true,
      })
    );
    const snapshot = await (manager as any).ensureLocalMetadataSnapshot(
      groupId
    );
    expect(snapshot).toBeTruthy();
    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(true);
    manager.close();
  });

  it('rebuilds a custom channel from a complete update and preserves omitted fields', async () => {
    const groupId = 827;
    const now = Date.now();
    const [updateEvent, partialEvent] = signedAuthorEvents([
      {
        eventId: 'channel-update-without-create',
        groupId,
        channelId: 'updates-only-channel',
        authorSeq: 1,
        eventType: 'channel_update',
        encryptedPayload: JSON.stringify({
          channelId: 'updates-only-channel',
          name: 'Updates only',
          description: 'Keep this description',
          position: 2,
          writeMode: 'members',
          readMode: 'members',
        }),
        timestamp: now - 1_000,
      },
      {
        eventId: 'channel-partial-update',
        groupId,
        channelId: 'updates-only-channel',
        authorSeq: 2,
        eventType: 'channel_update',
        encryptedPayload: JSON.stringify({
          channelId: 'updates-only-channel',
          position: 4,
        }),
        timestamp: now,
      },
    ]);
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([groupId]);
    expect((manager as any).db.insertEvent(updateEvent, false)).toBe(true);
    expect((manager as any).db.insertEvent(partialEvent, false)).toBe(true);

    manager.subscribeGroup(groupId);
    await vi.waitUntil(
      () =>
        manager
          .getChannels(groupId, true)
          .some((channel) => channel.channelId === 'updates-only-channel'),
      { timeout: 1_000 }
    );

    expect(manager.getChannels(groupId, true)).toContainEqual(
      expect.objectContaining({
        channelId: 'updates-only-channel',
        name: 'Updates only',
        description: 'Keep this description',
        position: 4,
      })
    );
    manager.close();
  });

  it('does not map malformed metadata channel ids onto general', async () => {
    const groupId = 830;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([groupId]);
    const event = signedEvent({
      eventId: 'malformed-channel-id-update',
      groupId,
      channelId: 'general',
      eventType: 'channel_update',
      encryptedPayload: JSON.stringify({
        channelId: 'INVALID CHANNEL',
        name: 'Wrong general name',
      }),
    });
    expect((manager as any).db.insertEvent(event, false)).toBe(true);

    await expect(
      manager.applyChannelMetadataEvent(
        event.eventId,
        JSON.parse(event.encryptedPayload)
      )
    ).resolves.toBe(false);
    expect((manager as any).db.getChannel(groupId, 'general')).toEqual(
      expect.objectContaining({ name: 'general' })
    );
    expect(
      (manager as any).db.getMetadataEntityRevision(
        groupId,
        'channel',
        'general'
      )
    ).toBeNull();
    manager.close();
  });

  it('does not let a metadata payload target a different channel than its event', async () => {
    const groupId = 831;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([groupId]);
    const event = signedEvent({
      eventId: 'mismatched-channel-target-update',
      groupId,
      channelId: 'general',
      eventType: 'channel_update',
      encryptedPayload: JSON.stringify({
        channelId: 'qortal-land',
        name: 'Wrong QortalLand name',
      }),
    });
    expect((manager as any).db.insertEvent(event, false)).toBe(true);

    await expect(
      manager.applyChannelMetadataEvent(
        event.eventId,
        JSON.parse(event.encryptedPayload)
      )
    ).resolves.toBe(false);
    expect((manager as any).db.getChannel(groupId, 'qortal-land')).toEqual(
      expect.objectContaining({ name: 'qortal-land' })
    );
    expect(
      (manager as any).db.getMetadataEntityRevision(
        groupId,
        'channel',
        'qortal-land'
      )
    ).toBeNull();
    manager.close();
  });

  it('keeps a late channel event detached from an already deleted category', async () => {
    const groupId = 832;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => 1_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([
      {
        groupId,
        isAdmin: true,
        localAddress: 'QlocalAdmin',
      },
    ]);
    const deleteEvent = signedEvent({
      eventId: 'out-of-order-category-delete',
      groupId,
      eventType: 'category_delete',
      timestamp: 300,
      encryptedPayload: JSON.stringify({ categoryId: 'cat-deleted-first' }),
    });
    const channelEvent = signedEvent({
      eventId: 'out-of-order-channel-create',
      groupId,
      channelId: 'late-channel',
      eventType: 'channel_create',
      timestamp: 200,
      encryptedPayload: JSON.stringify({
        channelId: 'late-channel',
        categoryId: 'cat-deleted-first',
        name: 'Late channel',
        position: 0,
      }),
    });
    expect((manager as any).db.insertEvent(deleteEvent, true)).toBe(true);
    await expect(
      manager.applyChannelMetadataEvent(
        deleteEvent.eventId,
        JSON.parse(deleteEvent.encryptedPayload)
      )
    ).resolves.toBe(true);
    expect((manager as any).db.insertEvent(channelEvent, true)).toBe(true);
    await expect(
      manager.applyChannelMetadataEvent(
        channelEvent.eventId,
        JSON.parse(channelEvent.encryptedPayload)
      )
    ).resolves.toBe(true);

    expect((manager as any).db.getChannel(groupId, 'late-channel')).toEqual(
      expect.objectContaining({
        channelId: 'late-channel',
        categoryId: undefined,
      })
    );
    const snapshot = await (manager as any).ensureLocalMetadataSnapshot(
      groupId
    );
    expect(snapshot).toBeTruthy();
    expect(metadataSnapshotHasConsistentRevisions(snapshot)).toBe(true);
    manager.close();
  });

  it('authenticates metadata snapshot requests before serving full admin state', async () => {
    const groupId = 828;
    const peerHash = '8'.repeat(32);
    const sent: ReticulumChatWire[] = [];
    let requesterIsAdmin = false;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          _peer: string,
          wire: ReticulumChatWire
        ) => {
          sent.push(wire);
          return { ok: true as const };
        },
      } as any,
      now: () => 1_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => requesterIsAdmin,
    });
    const fullSnapshot = {
      groupId,
      snapshotId: 'full-admin-snapshot',
      scope: 'full' as const,
      parentSnapshotHash: '',
      version: 1,
      createdAt: 900,
      latestEventId: '',
      latestFeedTimestamp: 0,
      snapshotHash: 'c'.repeat(64),
      adminAddress: 'Qadmin',
      adminPublicKey: 'public-key',
      signature: 'signature',
      channels: [],
      categories: [],
      revisions: [],
    };
    (manager as any).db.upsertMetadataSnapshot(fullSnapshot);
    const signer = createReticulumChatTestSigner();
    const signed = await signer({
      groupId,
      snapshotHash: fullSnapshot.snapshotHash,
      timestamp: 1_000,
      type: 'RCHAT_METADATA_SNAPSHOT_REQ',
    });
    const request = {
      h: fullSnapshot.snapshotHash,
      p: signed.authorPublicKey,
      ts: 1_000,
      z: signed.signature,
    };
    expect(
      verifyReticulumMetadataSnapshotRequest(groupId, request, 1_000)
    ).toBe(true);

    await (manager as any).handleMetadataSnapshotReq(
      groupId,
      request,
      peerHash
    );
    expect(sent).toEqual([]);

    requesterIsAdmin = true;
    (manager as any).groupAdminValidationCache.clear();
    await (manager as any).handleMetadataSnapshotReq(
      groupId,
      request,
      peerHash
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        k: 'metadata_snapshot_offer_v3',
        g: groupId,
        s: expect.objectContaining({
          h: fullSnapshot.snapshotHash,
          sc: 'full',
        }),
      })
    );
    manager.close();
  });

  it('does not let metadata request cooldown suppress live chat or QortalLand wires', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => 1_000,
    });
    const peerHash = '9'.repeat(32);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      manager.handleWire(
        {
          t: 'RCHAT',
          v: 3,
          k: 'metadata_snapshot_req_v3',
          g: 716,
          q: {},
        },
        peerHash
      );
    }

    expect(
      (manager as any).isPeerProtocolCooledDown(
        peerHash,
        'metadata_snapshot_req_v3'
      )
    ).toBe(true);
    expect(
      (manager as any).isPeerProtocolCooledDown(peerHash, 'event_notice_v3')
    ).toBe(false);
    expect(
      (manager as any).isPeerProtocolCooledDown(peerHash, 'land_auth')
    ).toBe(false);
    expect(
      (manager as any).isPeerProtocolCooledDown(peerHash, 'land_state')
    ).toBe(false);

    const metadataRequest = vi
      .spyOn(manager as any, 'handleMetadataSnapshotReq')
      .mockResolvedValue(undefined);
    const metadataOffer = vi
      .spyOn(manager as any, 'handleMetadataSnapshotOffer')
      .mockResolvedValue(undefined);
    const eventNotice = vi
      .spyOn(manager as any, 'handleEventNotice')
      .mockImplementation(() => undefined);
    const landAuth = vi
      .spyOn(manager as any, 'enqueueLandAuthWire')
      .mockImplementation(() => undefined);
    const landState = vi
      .spyOn(manager as any, 'enqueueLandStateWire')
      .mockImplementation(() => undefined);

    manager.handleWire(
      {
        t: 'RCHAT',
        v: 3,
        k: 'metadata_snapshot_req_v3',
        g: 716,
        q: {},
      },
      peerHash
    );
    manager.handleWire(
      {
        t: 'RCHAT',
        v: 3,
        k: 'metadata_snapshot_offer_v3',
        g: 716,
        s: {},
      },
      peerHash
    );
    manager.handleWire(
      {
        t: 'RCHAT',
        v: 3,
        k: 'event_notice_v3',
        g: 716,
        n: {},
      },
      peerHash
    );
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'land_auth',
        g: 716,
      },
      peerHash
    );
    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'land_state',
        g: 716,
      },
      peerHash
    );

    expect(metadataRequest).not.toHaveBeenCalled();
    expect(metadataOffer).toHaveBeenCalledOnce();
    expect(eventNotice).toHaveBeenCalledOnce();
    expect(landAuth).toHaveBeenCalledOnce();
    expect(landState).toHaveBeenCalledOnce();
    manager.close();
  });

  it('does not let event-log projection repair overwrite a newer snapshot revision', async () => {
    const groupId = 821;
    const channelId = 'snapshot-owned-channel';
    const now = Date.now();
    const createEvent = signedEvent({
      eventId: 'event-channel-before-snapshot-create',
      groupId,
      channelId,
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify({
        channelId,
        name: 'old-event-name',
        position: 8,
      }),
      timestamp: now - 2_000,
    });
    const reorderEvent = signedEvent({
      eventId: 'event-channel-before-snapshot-reorder',
      groupId,
      channelId,
      eventType: 'channel_reorder',
      encryptedPayload: JSON.stringify({ channelId, position: 1 }),
      timestamp: now - 1_000,
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([groupId]);
    expect((manager as any).db.insertEvent(createEvent, false)).toBe(true);
    expect((manager as any).db.insertEvent(reorderEvent, false)).toBe(true);
    const snapshotChannel = {
      groupId,
      channelId,
      name: 'snapshot-name',
      position: 1,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      writeModeUpdatedAt: now - 2_000,
      createdBy: createEvent.authorAddress,
      createdAt: now - 2_000,
      updatedAt: now,
    };
    const snapshotStateHash = hashReticulumChatMetadataEntityState(
      'channel',
      channelId,
      snapshotChannel
    );
    expect(
      (manager as any).db.applyMetadataSnapshot({
        groupId,
        snapshotId: 'snapshot-newer-revision',
        scope: 'public',
        parentSnapshotHash: '',
        version: 1,
        createdAt: now,
        latestEventId: reorderEvent.eventId,
        latestFeedTimestamp: reorderEvent.feedTimestamp,
        snapshotHash: 'c'.repeat(64),
        adminAddress: reorderEvent.authorAddress,
        adminPublicKey: reorderEvent.authorPublicKey,
        signature: 'snapshot-signature',
        channels: [snapshotChannel],
        categories: [],
        revisions: [
          {
            entityType: 'channel',
            entityId: channelId,
            eventId: reorderEvent.eventId,
            eventType: reorderEvent.eventType,
            timestamp: reorderEvent.timestamp,
            deleted: false,
            stateHash: snapshotStateHash,
          },
        ],
      })
    ).toBe(true);

    manager.subscribeGroup(groupId);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect((manager as any).db.getChannel(groupId, channelId)).toEqual(
      expect.objectContaining({ name: 'snapshot-name', position: 1 })
    );
    expect(
      (manager as any).db.getMetadataEntityRevision(
        groupId,
        'channel',
        channelId
      )
    ).toMatchObject({
      eventId: reorderEvent.eventId,
      stateHash: snapshotStateHash,
    });
    manager.close();
  });

  it('does not let older channel metadata override newer channel state', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([83]);
    const now = Date.now();

    const olderPayload = {
      channelId: 'order-test',
      name: 'order-test',
      position: 1,
    };
    const newerPayload = {
      channelId: 'order-test',
      name: 'order-test',
      position: 9,
    };
    const olderEvent = signedEvent({
      eventId: 'event-channel-order-older',
      groupId: 83,
      channelId: 'order-test',
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify(olderPayload),
      timestamp: now - 1000,
    });
    const newerEvent = signedEvent({
      eventId: 'event-channel-order-newer',
      groupId: 83,
      channelId: 'order-test',
      eventType: 'channel_update',
      encryptedPayload: JSON.stringify(newerPayload),
      timestamp: now,
    });

    expect(await (manager as any).acceptEvent(newerEvent, false)).toBe(true);
    expect(await (manager as any).acceptEvent(olderEvent, false)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(manager.getChannels(83, true)).toContainEqual(
      expect.objectContaining({ channelId: 'order-test', position: 9 })
    );
    manager.close();
  });

  it('does not resurrect a category when an older create arrives after a newer delete', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([84]);
    const now = Date.now();

    const createPayload = {
      categoryId: 'cat-order-test',
      name: 'order-test',
      position: 1,
    };
    const deletePayload = {
      categoryId: 'cat-order-test',
      name: 'order-test',
      position: 1,
    };
    const olderCreate = signedEvent({
      eventId: 'event-category-order-older',
      groupId: 84,
      eventType: 'category_create',
      encryptedPayload: JSON.stringify(createPayload),
      timestamp: now - 1000,
    });
    const newerDelete = signedEvent({
      eventId: 'event-category-order-newer',
      groupId: 84,
      eventType: 'category_delete',
      encryptedPayload: JSON.stringify(deletePayload),
      timestamp: now,
    });

    expect(await (manager as any).acceptEvent(newerDelete, false)).toBe(true);
    expect(await (manager as any).acceptEvent(olderCreate, false)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(
      manager.getCategories(84).map((category) => category.categoryId)
    ).not.toContain('cat-order-test');
    manager.close();
  });

  it('applies categories and clears channel category assignments', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([{ groupId: 81, isAdmin: true }]);

    const applyMetadata = async (
      eventId: string,
      eventType: ReticulumChatEvent['eventType'],
      payload: Record<string, unknown>,
      channelId = 'general'
    ) => {
      const event = signedEvent({
        eventId,
        groupId: 81,
        channelId,
        eventType,
        encryptedPayload: JSON.stringify(payload),
      });
      expect((manager as any).db.insertEvent(event, true)).toBe(true);
      await expect(
        manager.applyChannelMetadataEvent(event.eventId, payload)
      ).resolves.toBe(true);
    };

    await applyMetadata('event-category-create', 'category_create', {
      categoryId: 'cat-team',
      name: 'team',
      position: 0,
    });
    expect(manager.getCategories(81)).toContainEqual(
      expect.objectContaining({ categoryId: 'cat-team', name: 'team' })
    );

    await applyMetadata(
      'event-channel-create-with-category',
      'channel_create',
      {
        channelId: 'support',
        categoryId: 'cat-team',
        name: 'support',
        position: 0,
      },
      'support'
    );
    expect(manager.getChannels(81, true)).toContainEqual(
      expect.objectContaining({ channelId: 'support', categoryId: 'cat-team' })
    );

    await applyMetadata(
      'event-channel-clear-category',
      'channel_update',
      {
        channelId: 'support',
        categoryId: '',
        name: 'support',
        position: 0,
      },
      'support'
    );
    expect(
      manager
        .getChannels(81, true)
        .find((channel) => channel.channelId === 'support')
    ).toMatchObject({ channelId: 'support', categoryId: undefined });

    await applyMetadata(
      'event-channel-move-back-to-category',
      'channel_update',
      {
        channelId: 'support',
        categoryId: 'cat-team',
        name: 'support',
        position: 0,
      },
      'support'
    );
    await applyMetadata('event-category-delete', 'category_delete', {
      categoryId: 'cat-team',
    });

    expect(manager.getCategories(81)).toEqual([]);
    expect(
      manager
        .getChannels(81, true)
        .find((channel) => channel.channelId === 'support')
    ).toMatchObject({ channelId: 'support', categoryId: undefined });
    manager.close();
  });

  it('returns channel metadata history across all group channels', () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
    });
    const metadataEvent = signedEvent({
      eventId: 'event-channel-metadata-cross-channel',
      groupId: 80,
      channelId: 'support',
      eventType: 'channel_create',
      timestamp: 10_000,
      encryptedPayload: JSON.stringify({
        channelId: 'support',
        name: 'support',
        position: 1,
      }),
    });
    const messageEvent = signedEvent({
      eventId: 'event-general-message',
      groupId: 80,
      channelId: 'general',
      eventType: 'message',
      timestamp: 11_000,
    });
    manager.setLocalGroupMemberships([80]);
    expect((manager as any).db.insertEvent(metadataEvent, true)).toBe(true);
    expect((manager as any).db.insertEvent(messageEvent, true)).toBe(true);
    (manager as any).db.upsertChannel({
      groupId: 80,
      channelId: 'support',
      name: 'support',
      position: 1,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      writeModeUpdatedAt: 10_000,
      createdBy: metadataEvent.authorAddress,
      createdAt: 10_000,
      updatedAt: 10_000,
    });

    expect(
      manager.getHistory(80, 'general', 10).map((item) => item.eventId)
    ).toEqual([messageEvent.eventId]);
    expect(
      manager.getChannelMetadataHistory(80, 10).map((item) => item.eventId)
    ).toEqual([metadataEvent.eventId]);
    manager.close();
  });

  it('pages channel metadata events independently from normal messages', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    const metadataEvents = signedAuthorEvents([
      {
        eventId: 'event-meta-page-1',
        groupId: 82,
        channelId: 'general',
        eventType: 'channel_create',
        authorSeq: 1,
        timestamp: 10_000,
        encryptedPayload: JSON.stringify({ channelId: 'alpha', name: 'alpha' }),
      },
      {
        eventId: 'event-meta-page-2',
        groupId: 82,
        channelId: 'alpha',
        eventType: 'category_create',
        authorSeq: 2,
        timestamp: 20_000,
        encryptedPayload: JSON.stringify({
          categoryId: 'cat-a',
          name: 'cat-a',
        }),
      },
      {
        eventId: 'event-meta-page-3',
        groupId: 82,
        channelId: 'alpha',
        eventType: 'channel_update',
        authorSeq: 3,
        timestamp: 30_000,
        encryptedPayload: JSON.stringify({
          channelId: 'alpha',
          name: 'alpha-renamed',
        }),
      },
    ]);
    const messageEvent = signedEvent({
      eventId: 'event-meta-page-message',
      groupId: 82,
      channelId: 'alpha',
      timestamp: 25_000,
      authorSeq: 10,
    });
    for (const event of [...metadataEvents, messageEvent]) {
      expect(db.insertEvent(event, true)).toBe(true);
    }

    expect(
      db
        .getChannelMetadataPageAtOrBefore(
          82,
          { eventId: 'event-meta-page-3', feedTimestamp: 30_000 },
          2
        )
        .map((event) => event.eventId)
    ).toEqual(['event-meta-page-2', 'event-meta-page-3']);
    expect(
      db
        .getChannelMetadataPageBefore(
          82,
          { eventId: 'event-meta-page-3', feedTimestamp: 30_000 },
          2
        )
        .map((event) => event.eventId)
    ).toEqual(['event-meta-page-1', 'event-meta-page-2']);
    expect(
      db
        .getChannelMetadataPageAfter(
          82,
          { eventId: 'event-meta-page-1', feedTimestamp: 10_000 },
          5
        )
        .map((event) => event.eventId)
    ).toEqual(['event-meta-page-2', 'event-meta-page-3']);
    expect(
      db.getChannelMetadataEvents(82, 2).map((event) => event.eventId)
    ).toEqual(['event-meta-page-2', 'event-meta-page-3']);
    db.close();
  });

  it('refuses signed event resource requests when Core membership validation rejects the requester', async () => {
    const sentResources: unknown[] = [];
    const signer = createReticulumChatTestSigner();
    const blockedKp = nacl.sign.keyPair();
    const blockedPublicKey = base58Encode(blockedKp.publicKey);
    const blockedAddress = deriveAddressFromPublicKey(blockedPublicKey);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatResourceDetailed: async (payload: unknown) => {
        sentResources.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: signer,
      validateGroupMember: async (_groupId, address) =>
        address !== blockedAddress,
    });
    manager.setLocalGroupMemberships([74]);
    const event = signedEvent({
      eventId: 'event-resource-core-gated',
      groupId: 74,
      timestamp: 100_000,
    });
    await expect(manager.publishEvent(event)).resolves.toMatchObject({
      ok: true,
    });

    const timestamp = 100_000;
    const fields = buildReticulumChatEventRequestSignedFields({
      groupId: 74,
      eventId: event.eventId,
      authorAddress: blockedAddress,
      authorPublicKey: blockedPublicKey,
      timestamp,
    });
    const signature = base58Encode(
      nacl.sign.detached(
        new Uint8Array(canonicalizeForSigning(fields)),
        blockedKp.secretKey
      )
    );

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_req',
        g: 74,
        q: {
          id: event.eventId,
          a: blockedAddress,
          pk: blockedPublicKey,
          ts: timestamp,
          sig: signature,
        },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sentResources).toEqual([]);
    manager.close();
  });

  it('refuses signed event resource requests for admin-private channels from non-admin requesters', async () => {
    const sentResources: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatResourceDetailed: async (payload: unknown) => {
        sentResources.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => false,
    });
    upsertTestChannel(manager, {
      groupId: 74,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-resource-admin-private-hidden',
      groupId: 74,
      channelId: 'admin-private',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_req',
        g: 74,
        q: signedEventRequestWire({
          groupId: 74,
          eventId: event.eventId,
          timestamp: 100_000,
        }),
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sentResources).toEqual([]);
    manager.close();
  });

  it('serves signed event resource requests for admin-private channels to admin requesters', async () => {
    const sentResources: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatResourceDetailed: async (payload: unknown) => {
        sentResources.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    upsertTestChannel(manager, {
      groupId: 74,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-resource-admin-private-visible',
      groupId: 74,
      channelId: 'admin-private',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_req',
        g: 74,
        q: signedEventRequestWire({
          groupId: 74,
          eventId: event.eventId,
          timestamp: 100_000,
        }),
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sentResources).toHaveLength(1);
    expect(sentResources[0]).toMatchObject({
      metadata: expect.objectContaining({
        eventId: event.eventId,
        groupId: 74,
        resourceType: 'reticulum_chat_event',
      }),
    });
    manager.close();
  });

  it('rejects unsigned live event resource auth for normal channels', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    const event = signedEvent({
      eventId: 'event-live-normal-unsigned-hidden',
      groupId: 74,
      channelId: 'general',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'live-normal-link-unsigned',
      transferId: 'live-normal-transfer-unsigned',
      eventId: event.eventId,
      groupId: 74,
      auth: {
        type: 'RETICULUM_CHAT_RESOURCE_AUTH',
        transferId: 'live-normal-transfer-unsigned',
        eventId: event.eventId,
        groupId: 74,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(authorized).toEqual([]);
    expect(rejected).toContainEqual(
      expect.objectContaining({
        transferId: 'live-normal-transfer-unsigned',
        reason: 'signed_request_required',
      })
    );
    manager.close();
  });

  it('rejects signed live event resource auth for normal channels from non-members', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const event = signedEvent({
      eventId: 'event-live-normal-non-member-hidden',
      groupId: 74,
      channelId: 'general',
      timestamp: 100_000,
    });
    const request = signedEventRequestWire({
      groupId: 74,
      eventId: event.eventId,
      timestamp: 100_000,
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async (_groupId, address) => address !== request.a,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'live-normal-link-non-member',
      transferId: 'live-normal-transfer-non-member',
      eventId: event.eventId,
      groupId: 74,
      auth: {
        type: 'RETICULUM_CHAT_RESOURCE_AUTH',
        transferId: 'live-normal-transfer-non-member',
        eventId: event.eventId,
        groupId: 74,
        ...request,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(authorized).toEqual([]);
    expect(rejected).toContainEqual(
      expect.objectContaining({
        transferId: 'live-normal-transfer-non-member',
        reason: 'requester_not_group_member',
      })
    );
    manager.close();
  });

  it('authorizes signed live event resource auth for normal channels from members', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    const event = signedEvent({
      eventId: 'event-live-normal-member-visible',
      groupId: 74,
      channelId: 'general',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'live-normal-link-member',
      transferId: 'live-normal-transfer-member',
      eventId: event.eventId,
      groupId: 74,
      auth: {
        type: 'RETICULUM_CHAT_RESOURCE_AUTH',
        transferId: 'live-normal-transfer-member',
        eventId: event.eventId,
        groupId: 74,
        ...signedEventRequestWire({
          groupId: 74,
          eventId: event.eventId,
          timestamp: 100_000,
        }),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rejected).toEqual([]);
    expect(authorized).toContainEqual(
      expect.objectContaining({
        transferId: 'live-normal-transfer-member',
      })
    );
    manager.close();
  });

  it('authorizes compact signed live event resource auth for normal channels from members', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    const event = signedEvent({
      eventId: 'event-live-normal-compact-member-visible',
      groupId: 74,
      channelId: 'general',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    const authMessage = await (manager as any).buildSignedResourceAuthWire(
      74,
      'live-normal-transfer-compact-member',
      'RCR'
    );

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'live-normal-link-compact-member',
      transferId: 'live-normal-transfer-compact-member',
      eventId: event.eventId,
      groupId: 74,
      metadata: {
        eventId: event.eventId,
        groupId: 74,
      },
      auth: authMessage,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rejected).toEqual([]);
    expect(authorized).toContainEqual(
      expect.objectContaining({
        transferId: 'live-normal-transfer-compact-member',
      })
    );
    manager.close();
  });

  it('authorizes compact live event resource auth from the outbound transfer map when metadata is absent', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    const event = signedEvent({
      eventId: 'event-live-normal-compact-member-no-metadata',
      groupId: 74,
      channelId: 'general',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    (manager as any).outboundEventResources.set(
      'live-normal-transfer-compact-no-metadata',
      {
        groupId: 74,
        eventId: event.eventId,
        expiresAt: 110_000,
      }
    );
    const authMessage = await (manager as any).buildSignedResourceAuthWire(
      74,
      'live-normal-transfer-compact-no-metadata',
      'RCR'
    );

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'live-normal-link-compact-no-metadata',
      transferId: 'live-normal-transfer-compact-no-metadata',
      auth: authMessage,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rejected).toEqual([]);
    expect(authorized).toContainEqual(
      expect.objectContaining({
        transferId: 'live-normal-transfer-compact-no-metadata',
      })
    );
    expect(
      (manager as any).outboundEventResources.has(
        'live-normal-transfer-compact-no-metadata'
      )
    ).toBe(false);
    manager.close();
  });

  it('rejects metadata snapshot resource auth from non-admins when the snapshot contains admin-private channels', async () => {
    const authorized: unknown[] = [];
    const rejected: Array<Record<string, unknown>> = [];
    let requesterIsAdmin = true;
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => requesterIsAdmin,
    });
    manager.setLocalGroupMemberships([
      { groupId: 74, isAdmin: true, localAddress: 'QlocalSnapshotAdmin' },
    ]);
    manager.subscribeGroup(74);
    const privateChannelEvent = signedEvent({
      eventId: 'metadata-snapshot-private-channel-create',
      groupId: 74,
      channelId: 'admin-private',
      eventType: 'channel_create',
      encryptedPayload: JSON.stringify({
        channelId: 'admin-private',
        name: 'Admin private',
        position: 1,
        writeMode: 'admins',
        readMode: 'admins',
      }),
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(privateChannelEvent, true)).toBe(
      true
    );
    await expect(
      manager.applyChannelMetadataEvent(
        privateChannelEvent.eventId,
        JSON.parse(privateChannelEvent.encryptedPayload)
      )
    ).resolves.toBe(true);
    const snapshot = await (manager as any).ensureLocalMetadataSnapshot(74);
    expect(snapshot).toBeTruthy();
    expect(snapshot.channels).toContainEqual(
      expect.objectContaining({
        channelId: 'admin-private',
        readMode: 'admins',
      })
    );
    const transferId = 'metadata-snapshot-private-transfer';
    const fileHash = 'f'.repeat(64);
    (manager as any).outboundMetadataSnapshotResources.set(transferId, {
      groupId: 74,
      peerHash: 'peer-private-snapshot',
      snapshotHash: snapshot.snapshotHash,
      fileHash,
      expiresAt: 120_000,
      hasAdminPrivateChannels: true,
    });
    const requesterKeyPair = nacl.sign.keyPair();
    const requesterPublicKey = base58Encode(requesterKeyPair.publicKey);
    const requesterAddress = deriveAddressFromPublicKey(requesterPublicKey);
    const requesterTimestamp = 100_000;
    const authMessage = {
      t: 'RCP',
      x: transferId,
      g: 74,
      a: requesterAddress,
      p: requesterPublicKey,
      ts: requesterTimestamp,
      z: base58Encode(
        nacl.sign.detached(
          new Uint8Array(
            canonicalizeForSigning(
              buildReticulumChatResourceAuthSignedFields({
                groupId: 74,
                transferId,
                authorAddress: requesterAddress,
                authorPublicKey: requesterPublicKey,
                timestamp: requesterTimestamp,
              })
            )
          ),
          requesterKeyPair.secretKey
        )
      ),
    };
    requesterIsAdmin = false;

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'metadata-snapshot-private-link',
      transferId,
      groupId: 74,
      sha256: fileHash,
      metadata: {
        groupId: 74,
        snapshotHash: snapshot.snapshotHash,
        fileHash,
      },
      auth: authMessage,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(authorized).toEqual([]);
    expect(rejected).toContainEqual(
      expect.objectContaining({
        transferId,
        reason: 'metadata_snapshot_admin_required',
      })
    );
    manager.close();
  });

  it('sends a public metadata snapshot when the full snapshot contains admin-private channels', async () => {
    const sent: Array<{ peer: string; wire: ReticulumChatWire }> = [];
    const resources: Array<Record<string, unknown>> = [];
    const sender = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          peer: string,
          wire: ReticulumChatWire
        ) => {
          sent.push({ peer, wire });
          return { ok: true as const };
        },
        sendReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          resources.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    sender.setLocalGroupMemberships([
      { groupId: 74, isAdmin: true, localAddress: 'QlocalSnapshotAdmin' },
    ]);
    sender.subscribeGroup(74);
    const applyMetadata = async (
      eventId: string,
      eventType: ReticulumChatEvent['eventType'],
      payload: Record<string, unknown>,
      channelId = 'general'
    ) => {
      const event = signedEvent({
        eventId,
        groupId: 74,
        channelId,
        eventType,
        encryptedPayload: JSON.stringify(payload),
      });
      expect((sender as any).db.insertEvent(event, true)).toBe(true);
      await expect(
        sender.applyChannelMetadataEvent(event.eventId, payload)
      ).resolves.toBe(true);
    };
    await applyMetadata('event-public-category-snapshot', 'category_create', {
      categoryId: 'cat-devs',
      name: 'devs',
      position: 1,
    });
    await applyMetadata(
      'event-public-channel-snapshot',
      'channel_create',
      {
        channelId: 'testing',
        categoryId: 'cat-devs',
        name: 'testing',
        position: 1,
      },
      'testing'
    );
    await applyMetadata(
      'event-private-channel-snapshot',
      'channel_create',
      {
        channelId: 'admin-private',
        name: 'admin-private',
        position: 2,
        writeMode: 'admins',
        readMode: 'admins',
      },
      'admin-private'
    );

    (sender as any).notePeerSubscription('peer-public-snapshot', 74, true);

    await (sender as any).sendMetadataSnapshotToPeer(
      'peer-public-snapshot',
      74,
      'test'
    );
    await (sender as any).sendMetadataSnapshotToPeer(
      'peer-public-snapshot',
      74,
      'duplicate-test'
    );

    const publicSnapshotWire = resources
      .map((resource) =>
        JSON.parse(fs.readFileSync(String(resource.filePath), 'utf8'))
      )
      .find(
        (snapshot) =>
          Array.isArray(snapshot.channels) &&
          snapshot.channels.some(
            (channel: Record<string, unknown>) =>
              channel.channelId === 'testing'
          ) &&
          !snapshot.channels.some(
            (channel: Record<string, unknown>) =>
              channel.channelId === 'admin-private'
          )
      );
    expect(publicSnapshotWire).toBeTruthy();
    const snapshotWire = publicSnapshotWire;
    expect(
      snapshotWire.channels.map(
        (channel: Record<string, unknown>) => channel.channelId
      )
    ).toContain('testing');
    expect(
      snapshotWire.channels.map(
        (channel: Record<string, unknown>) => channel.channelId
      )
    ).not.toContain('admin-private');
    expect(
      snapshotWire.categories.map(
        (category: Record<string, unknown>) => category.categoryId
      )
    ).toContain('cat-devs');
    expect(snapshotWire.id).toBeTruthy();
    expect(snapshotWire.h).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotWire.a).toBeTruthy();
    expect(snapshotWire.p).toBeTruthy();
    expect(snapshotWire.z).toBeTruthy();
    expect(resources).toHaveLength(1);

    const [failedTransferId] = Array.from(
      (sender as any).outboundMetadataSnapshotResources.keys()
    ) as string[];
    sender.handleResourceEvent({
      status: 'failed',
      transferId: failedTransferId,
      reason: 'test-transfer-failure',
    });
    await (sender as any).sendMetadataSnapshotToPeer(
      'peer-public-snapshot',
      74,
      'retry-after-failure'
    );
    expect(resources).toHaveLength(2);

    const acceptedSnapshotResources: Array<Record<string, unknown>> = [];
    const receiver = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          acceptedSnapshotResources.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    receiver.setLocalGroupMemberships([74]);
    receiver.subscribeGroup(74);
    expect((receiver as any).db.getLatestMetadataSnapshot(74)).toBeNull();
    const resourceOffer = sent.find(
      ({ wire }) => wire.k === 'metadata_snapshot_offer_v3' && 'w' in wire
    )?.wire as
      | Extract<ReticulumChatWire, { k: 'metadata_snapshot_offer_v3' }>
      | undefined;
    expect(resourceOffer).toBeTruthy();
    expect(resourceOffer).not.toHaveProperty('r');
    await (receiver as any).handleMetadataSnapshotOffer(
      74,
      { ...resourceOffer, r: 'b0f911489514f8f4255e9207755e9157' },
      'peer-public-snapshot'
    );
    await vi.waitUntil(
      () =>
        acceptedSnapshotResources.some(
          (payload) => payload.transferId === resourceOffer?.w?.x
        ),
      { timeout: 1_000 }
    );
    await (receiver as any).handleMetadataSnapshotOffer(
      74,
      snapshotWire,
      'peer-public-snapshot'
    );

    expect(
      receiver.getChannels(74, true).map((channel) => channel.channelId)
    ).toContain('testing');
    expect(
      receiver.getChannels(74, true).map((channel) => channel.channelId)
    ).not.toContain('admin-private');
    expect(
      receiver.getCategories(74).map((category) => category.categoryId)
    ).toContain('cat-devs');
    const adminRequests: ReticulumChatWire[] = [];
    const adminSigner = createReticulumChatTestSigner();
    const adminIdentity = await adminSigner({});
    if (!adminIdentity) throw new Error('Expected test signer identity');
    const adminReceiver = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        sendReticulumChatDetailed: async (
          _peer: string,
          wire: ReticulumChatWire
        ) => {
          adminRequests.push(wire);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: adminSigner,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    adminReceiver.setLocalGroupMemberships([
      {
        groupId: 74,
        isAdmin: true,
        localAddress: adminIdentity.authorAddress,
      },
    ]);
    adminReceiver.subscribeGroup(74);
    await (adminReceiver as any).handleMetadataSnapshotOffer(
      74,
      {
        t: 'RCHAT',
        v: 3,
        k: 'metadata_snapshot_offer_v3',
        g: 74,
        s: snapshotWire,
        fh: (sender as any).db.getLatestMetadataSnapshot(74, 'full')
          .snapshotHash,
      },
      'peer-public-snapshot'
    );
    expect(
      (adminReceiver as any).db.getLatestMetadataSnapshot(74, 'public')
    ).toBeNull();
    await vi.waitUntil(
      () => adminRequests.some((wire) => wire.k === 'metadata_snapshot_req_v3'),
      {
        timeout: 1_000,
      }
    );
    const fullSnapshotRequest = adminRequests.find(
      (
        wire
      ): wire is Extract<
        ReticulumChatWire,
        { k: 'metadata_snapshot_req_v3' }
      > => wire.k === 'metadata_snapshot_req_v3'
    );
    expect(fullSnapshotRequest?.g).toBe(74);
    expect(fullSnapshotRequest?.q.h).toBe(
      (sender as any).db.getLatestMetadataSnapshot(74, 'full').snapshotHash
    );
    expect(fullSnapshotRequest?.q.p).toEqual(expect.any(String));
    expect(fullSnapshotRequest?.q.ts).toBe(100_000);
    expect(fullSnapshotRequest?.q.z).toEqual(expect.any(String));
    sender.close();
    receiver.close();
    adminReceiver.close();
  });

  it('bounds concurrent metadata snapshot downloads', async () => {
    const accepted: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          accepted.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([741, 742, 743]);
    manager.subscribeGroup(741);
    manager.subscribeGroup(742);
    manager.subscribeGroup(743);
    const offer = (groupId: number, transferId: string, peerHash: string) => ({
      transferId,
      groupId,
      snapshotHash: groupId.toString(16).padStart(64, '0'),
      snapshotVersion: 1,
      sizeBytes: 1_024,
      fileHash: transferId.charCodeAt(0).toString(16).padStart(64, '0'),
      sourcePeerHash: peerHash,
    });

    (manager as any).enqueueMetadataSnapshotDownload(
      offer(741, 'a-transfer', 'provider-a')
    );
    (manager as any).enqueueMetadataSnapshotDownload(
      offer(742, 'b-transfer', 'provider-b')
    );
    (manager as any).enqueueMetadataSnapshotDownload(
      offer(743, 'c-transfer', 'provider-c')
    );
    await vi.waitUntil(() => accepted.length === 2, { timeout: 1_000 });
    expect(accepted.map(({ transferId }) => transferId)).toEqual([
      'a-transfer',
      'b-transfer',
    ]);

    manager.handleResourceEvent({
      status: 'failed',
      transferId: 'a-transfer',
      reason: 'resource_provider_busy',
    });
    await vi.waitUntil(
      () => accepted.some(({ transferId }) => transferId === 'c-transfer'),
      { timeout: 1_000 }
    );
    expect((manager as any).metadataSnapshotActiveDownloads.size).toBe(2);
    manager.close();
  });

  it('starts at most one metadata snapshot download per provider', async () => {
    const accepted: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          accepted.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([751, 752, 753]);
    for (const groupId of [751, 752, 753]) manager.subscribeGroup(groupId);
    const enqueue = (groupId: number, transferId: string, peerHash: string) =>
      (manager as any).enqueueMetadataSnapshotDownload({
        transferId,
        groupId,
        snapshotHash: groupId.toString(16).padStart(64, '0'),
        snapshotVersion: 1,
        sizeBytes: 1_024,
        fileHash: groupId.toString(16).padStart(64, '1'),
        sourcePeerHash: peerHash,
      });

    enqueue(751, 'same-provider-first', 'provider-shared');
    enqueue(752, 'same-provider-second', 'provider-shared');
    enqueue(753, 'other-provider', 'provider-other');
    await vi.waitUntil(() => accepted.length === 2, { timeout: 1_000 });

    expect(accepted.map(({ transferId }) => transferId)).toEqual([
      'same-provider-first',
      'other-provider',
    ]);
    manager.close();
  });

  it('does not requeue an active metadata transfer when its offer is repeated', async () => {
    const accepted: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          accepted.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([754]);
    manager.subscribeGroup(754);
    const repeatedOffer = {
      transferId: 'repeated-active-transfer',
      groupId: 754,
      snapshotHash: '7'.repeat(64),
      snapshotVersion: 1,
      sizeBytes: 1_024,
      fileHash: '8'.repeat(64),
      sourcePeerHash: 'provider-repeated',
    };

    (manager as any).enqueueMetadataSnapshotDownload(repeatedOffer);
    await vi.waitUntil(() => accepted.length === 1, { timeout: 1_000 });
    (manager as any).enqueueMetadataSnapshotDownload(repeatedOffer);
    const item = (manager as any).metadataSnapshotDownloadItems.get(
      `754:${repeatedOffer.snapshotHash}`
    );
    expect(item.candidates.size).toBe(0);

    manager.handleResourceEvent({
      status: 'failed',
      transferId: repeatedOffer.transferId,
      reason: 'resource_session_link_closed',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(accepted).toHaveLength(1);
    expect((manager as any).metadataSnapshotDownloadItems.size).toBe(0);
    manager.close();
  });

  it('retains metadata provider failure history across backoff windows', async () => {
    let now = 100_000;
    const accepted: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          accepted.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => now,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([755, 756]);
    manager.subscribeGroup(755);
    manager.subscribeGroup(756);
    const enqueue = (groupId: number, transferId: string) =>
      (manager as any).enqueueMetadataSnapshotDownload({
        transferId,
        groupId,
        snapshotHash: groupId.toString(16).padStart(64, '0'),
        snapshotVersion: 1,
        sizeBytes: 1_024,
        fileHash: groupId.toString(16).padStart(64, '1'),
        sourcePeerHash: 'provider-backoff',
      });

    enqueue(755, 'backoff-first');
    await vi.waitUntil(() => accepted.length === 1, { timeout: 1_000 });
    manager.handleResourceEvent({
      status: 'failed',
      transferId: 'backoff-first',
      reason: 'resource_provider_busy',
    });
    expect(
      (manager as any).metadataSnapshotPeerBackoffs.get('provider-backoff')
    ).toMatchObject({ attempts: 1, nextAttemptAt: 102_000 });

    now = 102_001;
    enqueue(756, 'backoff-second');
    await vi.waitUntil(() => accepted.length === 2, { timeout: 1_000 });
    manager.handleResourceEvent({
      status: 'failed',
      transferId: 'backoff-second',
      reason: 'resource_provider_busy',
    });
    expect(
      (manager as any).metadataSnapshotPeerBackoffs.get('provider-backoff')
    ).toMatchObject({ attempts: 2, nextAttemptAt: 107_001 });
    manager.close();
  });

  it('cleans expired metadata timeout bookkeeping and isolates late terminal events', () => {
    const dbPath = tempDbPath();
    const manager = new ReticulumChatManager({ dbPath });
    const staleTransferId = 'stale-metadata-timeout';
    (manager as any).metadataSnapshotOffers.set(staleTransferId, {
      transferId: staleTransferId,
      groupId: 757,
      snapshotHash: '9'.repeat(64),
      snapshotVersion: 1,
      sizeBytes: 1_024,
      fileHash: 'a'.repeat(64),
      sourcePeerHash: 'provider-stale',
    });
    (manager as any).ignoredMetadataSnapshotTransfers.set(
      staleTransferId,
      99_999
    );
    (manager as any).pruneIgnoredMetadataSnapshotTransfers(100_000);
    expect(
      (manager as any).ignoredMetadataSnapshotTransfers.has(staleTransferId)
    ).toBe(false);
    expect((manager as any).metadataSnapshotOffers.has(staleTransferId)).toBe(
      false
    );

    const genericFailure = vi.spyOn(
      manager as any,
      'handleEventResourceFailure'
    );
    const genericImport = vi.spyOn(
      manager as any,
      'importReceivedEventResource'
    );
    const latePath = path.join(
      path.dirname(dbPath),
      'late-metadata-resource.json'
    );
    fs.writeFileSync(latePath, '{}', 'utf8');
    const metadata = {
      logicalResourceType: 'reticulum_chat_metadata_snapshot',
    };
    manager.handleResourceEvent({
      status: 'failed',
      transferId: 'late-metadata-failure',
      reason: 'resource_session_link_closed',
      metadata,
    });
    manager.handleResourceEvent({
      status: 'received',
      transferId: 'late-metadata-received',
      path: latePath,
      metadata,
    });
    expect(genericFailure).not.toHaveBeenCalled();
    expect(genericImport).not.toHaveBeenCalled();
    expect(fs.existsSync(latePath)).toBe(false);
    manager.close();
  });

  it('deduplicates a metadata snapshot and rotates to its alternate provider', async () => {
    const accepted: Array<Record<string, unknown>> = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (
          payload: Record<string, unknown>
        ) => {
          accepted.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    manager.setLocalGroupMemberships([744]);
    manager.subscribeGroup(744);
    const snapshotHash = 'd'.repeat(64);
    const baseOffer = {
      groupId: 744,
      snapshotHash,
      snapshotVersion: 7,
      sizeBytes: 2_048,
      fileHash: 'e'.repeat(64),
    };

    (manager as any).enqueueMetadataSnapshotDownload({
      ...baseOffer,
      transferId: 'primary-transfer',
      sourcePeerHash: 'provider-primary',
    });
    (manager as any).enqueueMetadataSnapshotDownload({
      ...baseOffer,
      transferId: 'alternate-transfer',
      sourcePeerHash: 'provider-alternate',
    });
    await vi.waitUntil(() => accepted.length === 1, { timeout: 1_000 });
    expect(accepted[0]?.transferId).toBe('primary-transfer');

    manager.handleResourceEvent({
      status: 'failed',
      transferId: 'primary-transfer',
      reason: 'resource_session_link_closed',
    });
    await vi.waitUntil(() => accepted.length === 2, { timeout: 1_000 });
    expect(accepted[1]?.transferId).toBe('alternate-transfer');
    expect((manager as any).metadataSnapshotDownloadItems.size).toBe(1);
    manager.close();
  });

  it('stores metadata snapshot and projection together', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    db.upsertChannel({
      groupId: 740,
      channelId: 'keep-on-failure',
      name: 'keep-on-failure',
      position: 1,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      createdBy: 'Qadmin',
      createdAt: 1,
      updatedAt: 1,
    });
    const snapshotResult = db.applyMetadataSnapshot({
      groupId: 740,
      snapshotId: 'atomic-snapshot-success',
      scope: 'public',
      parentSnapshotHash: '',
      version: 1,
      createdAt: 3,
      latestEventId: '',
      latestFeedTimestamp: 0,
      snapshotHash: 'b'.repeat(64),
      adminAddress: 'Qadmin',
      adminPublicKey: 'public-key',
      signature: 'signature',
      channels: [db.getChannel(740, 'keep-on-failure')!],
      categories: [],
      revisions: [
        {
          entityType: 'channel',
          entityId: 'keep-on-failure',
          eventId: 'keep-on-failure-create',
          eventType: 'channel_create',
          timestamp: 1,
          deleted: false,
          stateHash: hashReticulumChatMetadataEntityState(
            'channel',
            'keep-on-failure',
            db.getChannel(740, 'keep-on-failure')
          ),
        },
      ],
    });
    expect(snapshotResult).toBe(true);
    expect(db.getMetadataSnapshotByHash(740, 'b'.repeat(64))).toBeTruthy();
    db.close();
  });

  it('normalizes legacy general snapshot projections to the fixed expiry', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    const groupId = 741;
    const legacyGeneral = {
      groupId,
      channelId: RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      name: RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      position: 0,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      writeModeUpdatedAt: 0,
      expiryDurationMs: undefined,
      createdBy: '',
      createdAt: 0,
      updatedAt: 0,
    };
    const legacyRevision = {
      entityType: 'channel' as const,
      entityId: legacyGeneral.channelId,
      eventId: 'legacy-general-snapshot-update',
      eventType: 'channel_update',
      timestamp: 100,
      deleted: false,
      stateHash: hashReticulumChatMetadataEntityState(
        'channel',
        legacyGeneral.channelId,
        legacyGeneral
      ),
    };

    expect(
      db.applyMetadataSnapshot({
        groupId,
        snapshotId: 'legacy-general-snapshot',
        scope: 'public',
        parentSnapshotHash: '',
        version: 1,
        createdAt: 100,
        latestEventId: legacyRevision.eventId,
        latestFeedTimestamp: legacyRevision.timestamp,
        snapshotHash: 'c'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [legacyGeneral],
        categories: [],
        revisions: [legacyRevision],
      })
    ).toBe(true);
    const projectedGeneral = db.getChannel(
      groupId,
      RETICULUM_CHAT_DEFAULT_CHANNEL_ID
    );
    expect(projectedGeneral?.expiryDurationMs).toBe(
      RETICULUM_CHAT_GENERAL_CHANNEL_EXPIRY_MS
    );
    expect(
      db.getMetadataEntityRevisionRecord(
        groupId,
        'channel',
        RETICULUM_CHAT_DEFAULT_CHANNEL_ID
      )?.revision.stateHash
    ).toBe(
      hashReticulumChatMetadataEntityState(
        'channel',
        RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
        projectedGeneral
      )
    );
    const upsertChannelSpy = vi.spyOn(db as any, 'upsertChannel');
    expect(
      db.applyMetadataSnapshot({
        groupId,
        snapshotId: 'legacy-general-snapshot-repeat',
        scope: 'public',
        parentSnapshotHash: '',
        version: 1,
        createdAt: 100,
        latestEventId: legacyRevision.eventId,
        latestFeedTimestamp: legacyRevision.timestamp,
        snapshotHash: 'd'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [legacyGeneral],
        categories: [],
        revisions: [legacyRevision],
      })
    ).toBe(true);
    expect(upsertChannelSpy).not.toHaveBeenCalled();
    db.close();
  });

  it('treats a coherent uncategorized metadata snapshot as ready', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const groupId = 752;
    manager.setLocalGroupMemberships([{ groupId, isAdmin: false }]);

    expect(manager.getChannelMetadataBundle(groupId)).toMatchObject({
      ready: false,
      snapshotVersion: 0,
    });
    const builtInChannels = (manager as any).db.getChannels(groupId, true);
    const builtInRevisions = builtInChannels.map(
      (channel: ReticulumGroupChannel, index: number) => ({
        entityType: 'channel' as const,
        entityId: channel.channelId,
        eventId: `uncategorized-built-in-${index}`,
        eventType: 'channel_update',
        timestamp: 100,
        deleted: false,
        stateHash: hashReticulumChatMetadataEntityState(
          'channel',
          channel.channelId,
          channel
        ),
      })
    );
    expect(
      (manager as any).db.applyMetadataSnapshot({
        groupId,
        snapshotId: 'uncategorized-public-snapshot',
        scope: 'public',
        parentSnapshotHash: '',
        version: 7,
        createdAt: 100,
        latestEventId: '',
        latestFeedTimestamp: 0,
        snapshotHash: '7'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: builtInChannels,
        categories: [],
        revisions: builtInRevisions,
      })
    ).toBe(true);

    const bundle = manager.getChannelMetadataBundle(groupId);
    expect(bundle.ready).toBe(true);
    expect(bundle.snapshotVersion).toBe(7);
    expect(bundle.categories).toEqual([]);
    expect(bundle.channels.map((channel) => channel.channelId)).toEqual([
      RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      RETICULUM_CHAT_QORTAL_LAND_CHANNEL_ID,
    ]);

    // An administrator must not treat a public-only snapshot as complete,
    // because it intentionally omits admin-private channels.
    manager.setLocalGroupMemberships([{ groupId, isAdmin: true }]);
    expect(manager.getChannelMetadataBundle(groupId).ready).toBe(false);
    expect(
      (manager as any).db.applyMetadataSnapshot({
        groupId,
        snapshotId: 'uncategorized-full-snapshot',
        scope: 'full',
        parentSnapshotHash: '',
        version: 8,
        createdAt: 101,
        latestEventId: '',
        latestFeedTimestamp: 0,
        snapshotHash: '8'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: builtInChannels,
        categories: [],
        revisions: builtInRevisions,
      })
    ).toBe(true);
    expect(manager.getChannelMetadataBundle(groupId)).toMatchObject({
      ready: true,
      snapshotVersion: 8,
    });
    manager.close();
  });

  it('hides cached admin-private state immediately after local admin access is removed', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const groupId = 753;
    const privateChannel = {
      groupId,
      channelId: 'admin-private',
      categoryId: 'cat-private',
      name: 'admin-private',
      position: 2,
      archived: false,
      writeMode: 'admins' as const,
      readMode: 'admins' as const,
      writeModeUpdatedAt: 100,
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 100,
    };
    (manager as any).db.upsertCategory({
      groupId,
      categoryId: 'cat-private',
      name: 'private',
      position: 1,
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 100,
    });
    (manager as any).db.upsertChannel(privateChannel);
    const privateEvent = signedEvent({
      eventId: 'cached-private-event',
      groupId,
      channelId: privateChannel.channelId,
      timestamp: 200,
      encryptedPayload: 'private payload',
    });
    expect((manager as any).db.insertEvent(privateEvent, true)).toBe(true);

    manager.setLocalGroupMemberships([{ groupId, isAdmin: true }]);
    expect(
      manager.getChannels(groupId, true).map((channel) => channel.channelId)
    ).toContain(privateChannel.channelId);
    expect(
      manager.getHistory(groupId, privateChannel.channelId, 10)
    ).toHaveLength(1);

    manager.setLocalGroupMemberships([{ groupId, isAdmin: false }]);
    expect(
      manager.getChannels(groupId, true).map((channel) => channel.channelId)
    ).not.toContain(privateChannel.channelId);
    expect(
      manager.getCategories(groupId).map((category) => category.categoryId)
    ).not.toContain('cat-private');
    expect(manager.getHistory(groupId, privateChannel.channelId, 10)).toEqual(
      []
    );
    expect(
      manager
        .getChatSummaries()
        .flatMap((summary) => summary.channels)
        .map((channel) => channel.channelId)
    ).not.toContain(privateChannel.channelId);
    manager.close();
  });

  it('treats omission from the latest public snapshot as a visibility revocation', async () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const groupId = 756;
    const channel = {
      groupId,
      channelId: 'formerly-public',
      name: 'formerly-public',
      position: 2,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      writeModeUpdatedAt: 100,
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 100,
    };
    const revision = {
      entityType: 'channel' as const,
      entityId: channel.channelId,
      eventId: 'formerly-public-create',
      eventType: 'channel_create',
      timestamp: 100,
      deleted: false,
      stateHash: hashReticulumChatMetadataEntityState(
        'channel',
        channel.channelId,
        channel
      ),
    };
    const db = (manager as any).db as ReticulumChatDatabase;
    manager.setLocalGroupMemberships([{ groupId, isAdmin: false }]);
    expect(
      db.applyMetadataSnapshot({
        groupId,
        snapshotId: 'public-before-private',
        scope: 'public',
        parentSnapshotHash: '',
        version: 1,
        createdAt: 200,
        latestEventId: revision.eventId,
        latestFeedTimestamp: 100,
        snapshotHash: '6'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [channel],
        categories: [],
        revisions: [revision],
      })
    ).toBe(true);
    const event = signedEvent({
      eventId: 'formerly-public-message',
      groupId,
      channelId: channel.channelId,
      timestamp: 150,
      encryptedPayload: 'cached private payload',
    });
    expect(db.insertEvent(event, true)).toBe(true);
    expect(manager.getHistory(groupId, channel.channelId, 10)).toHaveLength(1);

    expect(
      db.applyMetadataSnapshot({
        groupId,
        snapshotId: 'public-after-private',
        scope: 'public',
        parentSnapshotHash: '6'.repeat(64),
        version: 2,
        createdAt: 300,
        latestEventId: 'formerly-public-private-update',
        latestFeedTimestamp: 300,
        snapshotHash: '7'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [],
        categories: [],
        revisions: [],
      })
    ).toBe(true);

    expect(db.getChannel(groupId, channel.channelId)).toEqual(
      expect.objectContaining({
        channelId: channel.channelId,
        readMode: 'members',
      })
    );
    expect(
      manager.getChannels(groupId, true).map((item) => item.channelId)
    ).not.toContain(channel.channelId);
    expect(manager.getHistory(groupId, channel.channelId, 10)).toEqual([]);
    await expect(
      manager.getMessageWindowAroundEvent(
        groupId,
        channel.channelId,
        event.eventId
      )
    ).resolves.toEqual([]);
    expect(
      manager
        .getChatSummaries()
        .flatMap((summary) => summary.channels)
        .map((item) => item.channelId)
    ).not.toContain(channel.channelId);

    // Losing the projection row must not make an old omitted channel readable
    // again or restore its unread count.
    (db as any).memoryChannels.delete(`${groupId}:${channel.channelId}`);
    (db as any).stmtDeleteChannel.run(groupId, channel.channelId);
    expect(manager.getHistory(groupId, channel.channelId, 10)).toEqual([]);
    expect(
      manager
        .getChatSummaries()
        .flatMap((summary) => summary.channels)
        .map((item) => item.channelId)
    ).not.toContain(channel.channelId);

    // A genuinely new message may arrive before its channel metadata and the
    // next public snapshot. Keep that live delivery race visible.
    const newChannelEvent = signedEvent({
      eventId: 'new-channel-before-metadata',
      groupId,
      channelId: 'new-after-snapshot',
      timestamp: 400,
      encryptedPayload: 'new message',
    });
    expect(db.insertEvent(newChannelEvent, true)).toBe(true);
    expect(
      manager
        .getHistory(groupId, newChannelEvent.channelId, 10)
        .map((item) => item.eventId)
    ).toContain(newChannelEvent.eventId);
    manager.close();
  });

  it('converges conflicting entity states deterministically and replays stored snapshots', () => {
    const groupId = 754;
    const first = {
      groupId,
      channelId: 'tasks',
      name: 'tasks-a',
      position: 1,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      writeModeUpdatedAt: 100,
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 100,
    };
    const second = { ...first, name: 'tasks-b' };
    const firstHash = hashReticulumChatMetadataEntityState(
      'channel',
      'tasks',
      first
    );
    const secondHash = hashReticulumChatMetadataEntityState(
      'channel',
      'tasks',
      second
    );
    const snapshot = (
      channel: typeof first,
      stateHash: string,
      snapshotHash: string
    ) => ({
      groupId,
      snapshotId: snapshotHash.slice(0, 16),
      scope: 'full' as const,
      parentSnapshotHash: '',
      version: 1,
      createdAt: 200,
      latestEventId: 'tasks-update',
      latestFeedTimestamp: 100,
      snapshotHash,
      adminAddress: 'Qadmin',
      adminPublicKey: 'public-key',
      signature: 'signature',
      channels: [channel],
      categories: [],
      revisions: [
        {
          entityType: 'channel' as const,
          entityId: 'tasks',
          eventId: 'tasks-update',
          eventType: 'channel_update',
          timestamp: 100,
          deleted: false,
          stateHash,
        },
      ],
    });
    const snapshotA = snapshot(first, firstHash, 'a'.repeat(64));
    const snapshotB = snapshot(second, secondHash, 'b'.repeat(64));
    const expectedName = firstHash > secondHash ? first.name : second.name;

    const dbA = new ReticulumChatDatabase(tempDbPath());
    const dbB = new ReticulumChatDatabase(tempDbPath());
    expect(dbA.applyMetadataSnapshot(snapshotA)).toBe(true);
    expect(dbA.applyMetadataSnapshot(snapshotB)).toBe(true);
    expect(dbB.applyMetadataSnapshot(snapshotB)).toBe(true);
    expect(dbB.applyMetadataSnapshot(snapshotA)).toBe(true);
    expect(dbA.getChannel(groupId, 'tasks')?.name).toBe(expectedName);
    expect(dbB.getChannel(groupId, 'tasks')?.name).toBe(expectedName);

    const winningSnapshot = firstHash > secondHash ? snapshotA : snapshotB;
    (dbA as any).memoryChannels.delete(`${groupId}:tasks`);
    (dbA as any).stmtDeleteChannel.run(groupId, 'tasks');
    expect(dbA.getChannel(groupId, 'tasks')).toBeNull();
    expect(dbA.applyStoredMetadataSnapshotProjection(winningSnapshot)).toBe(
      true
    );
    expect(dbA.getChannel(groupId, 'tasks')?.name).toBe(expectedName);
    dbA.close();
    dbB.close();
  });

  it('rebuilds snapshot revisions from metadata older than the latest 500 events', async () => {
    const groupId = 755;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupAdmin: async () => true,
      now: () => 1_000_000,
    });
    manager.setLocalGroupMemberships([
      {
        groupId,
        isAdmin: true,
        localAddress: 'QlocalAdmin',
      },
    ]);
    const baseEvent = signedEvent({ groupId, eventType: 'channel_create' });
    const events = Array.from({ length: 501 }, (_, index) => {
      const channelId =
        index === 0 ? 'tasks' : `meta-${String(index).padStart(3, '0')}`;
      const encryptedPayload = JSON.stringify({
        channelId,
        name: channelId,
        position: index + 2,
      });
      return {
        ...baseEvent,
        eventId: `metadata-event-${String(index).padStart(3, '0')}`,
        channelId,
        authorSeq: index + 1,
        timestamp: index + 1,
        encryptedPayload,
        payloadHash: hashReticulumChatPayload(encryptedPayload),
      };
    });
    for (const event of events) {
      expect((manager as any).db.insertEvent(event, true)).toBe(true);
    }
    vi.spyOn(
      manager as any,
      'tryApplyPublicChannelMetadata'
    ).mockImplementation(async (event: ReticulumChatEvent) => {
      if (event.channelId === 'tasks') {
        const channel = {
          groupId,
          channelId: 'tasks',
          name: 'tasks',
          position: 2,
          archived: false,
          writeMode: 'members' as const,
          readMode: 'members' as const,
          writeModeUpdatedAt: event.timestamp,
          createdBy: event.authorAddress,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
        };
        (manager as any).db.upsertChannel(channel);
        (manager as any).db.upsertMetadataEntityRevision(groupId, {
          entityType: 'channel',
          entityId: 'tasks',
          eventId: event.eventId,
          eventType: event.eventType,
          timestamp: event.timestamp,
          deleted: false,
          stateHash: hashReticulumChatMetadataEntityState(
            'channel',
            'tasks',
            channel
          ),
        });
      }
      return 'applied';
    });

    const snapshot = await (manager as any).buildLocalMetadataSnapshot(groupId);
    expect(
      snapshot.channels.map(
        (channel: { channelId: string }) => channel.channelId
      )
    ).toContain('tasks');
    expect(
      snapshot.revisions.some(
        (revision: { entityId: string }) => revision.entityId === 'tasks'
      )
    ).toBe(true);
    manager.close();
  }, 20_000);

  it('does not delete a known channel merely because a snapshot omits it', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    db.upsertChannel({
      groupId: 741,
      channelId: 'tasks',
      name: 'tasks',
      position: 5,
      archived: false,
      writeMode: 'admins',
      readMode: 'admins',
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 100,
    });
    db.upsertMetadataEntityRevision(741, {
      entityType: 'channel',
      entityId: 'tasks',
      eventId: 'tasks-create',
      eventType: 'channel_create',
      timestamp: 100,
      deleted: false,
      stateHash: hashReticulumChatMetadataEntityState(
        'channel',
        'tasks',
        db.getChannel(741, 'tasks')
      ),
    });
    expect(
      db.applyMetadataSnapshot({
        groupId: 741,
        snapshotId: 'snapshot-omitting-tasks',
        scope: 'full',
        parentSnapshotHash: '',
        version: 2,
        createdAt: 200,
        latestEventId: '',
        latestFeedTimestamp: 0,
        snapshotHash: '2'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [],
        categories: [],
        revisions: [],
      })
    ).toBe(true);
    expect(db.getChannel(741, 'tasks')?.name).toBe('tasks');
    db.close();
  });

  it('does not let a stale snapshot reconnect a channel to a deleted category', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    const groupId = 757;
    const categoryId = 'cat-deleted-before-snapshot';
    const channel = {
      groupId,
      channelId: 'snapshot-channel',
      categoryId,
      name: 'Snapshot channel',
      position: 1,
      archived: false,
      writeMode: 'members' as const,
      readMode: 'members' as const,
      writeModeUpdatedAt: 200,
      createdBy: 'Qadmin',
      createdAt: 200,
      updatedAt: 200,
    };
    const category = {
      groupId,
      categoryId,
      name: 'Deleted category',
      position: 1,
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 100,
    };
    db.upsertMetadataEntityRevision(groupId, {
      entityType: 'category',
      entityId: categoryId,
      eventId: 'newer-category-delete',
      eventType: 'category_delete',
      timestamp: 300,
      deleted: true,
      stateHash: hashReticulumChatMetadataEntityState(
        'category',
        categoryId,
        null
      ),
    });

    expect(
      db.applyMetadataSnapshot({
        groupId,
        snapshotId: 'stale-category-snapshot',
        scope: 'full',
        parentSnapshotHash: '',
        version: 1,
        createdAt: 250,
        latestEventId: 'snapshot-channel-create',
        latestFeedTimestamp: 200,
        snapshotHash: '8'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [channel],
        categories: [category],
        revisions: [
          {
            entityType: 'channel',
            entityId: channel.channelId,
            eventId: 'snapshot-channel-create',
            eventType: 'channel_create',
            timestamp: 200,
            deleted: false,
            stateHash: hashReticulumChatMetadataEntityState(
              'channel',
              channel.channelId,
              channel
            ),
          },
          {
            entityType: 'category',
            entityId: categoryId,
            eventId: 'older-category-create',
            eventType: 'category_create',
            timestamp: 100,
            deleted: false,
            stateHash: hashReticulumChatMetadataEntityState(
              'category',
              categoryId,
              category
            ),
          },
        ],
      })
    ).toBe(true);

    const projectedChannel = db.getChannel(groupId, channel.channelId);
    expect(db.getCategory(groupId, categoryId)).toBeNull();
    expect(projectedChannel).toEqual(
      expect.objectContaining({
        channelId: channel.channelId,
        categoryId: undefined,
      })
    );
    expect(
      db.getMetadataEntityRevision(groupId, 'channel', channel.channelId)
        ?.stateHash
    ).toBe(
      hashReticulumChatMetadataEntityState(
        'channel',
        channel.channelId,
        projectedChannel
      )
    );
    db.close();
  });

  it('merges snapshot entities by revision and preserves explicit category tombstones', () => {
    const db = new ReticulumChatDatabase(tempDbPath());
    db.upsertChannel({
      groupId: 742,
      channelId: 'updates',
      name: 'new-name',
      position: 1,
      archived: false,
      writeMode: 'members',
      readMode: 'members',
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 300,
    });
    db.upsertMetadataEntityRevision(742, {
      entityType: 'channel',
      entityId: 'updates',
      eventId: 'updates-newer',
      eventType: 'channel_update',
      timestamp: 300,
      deleted: false,
      stateHash: hashReticulumChatMetadataEntityState(
        'channel',
        'updates',
        db.getChannel(742, 'updates')
      ),
    });
    db.upsertCategory({
      groupId: 742,
      categoryId: 'cat-old',
      name: 'old',
      position: 1,
      createdBy: 'Qadmin',
      createdAt: 100,
      updatedAt: 100,
    });
    expect(
      db.applyMetadataSnapshot({
        groupId: 742,
        snapshotId: 'snapshot-entity-merge',
        scope: 'full',
        parentSnapshotHash: '',
        version: 1,
        createdAt: 400,
        latestEventId: 'category-delete',
        latestFeedTimestamp: 400,
        snapshotHash: '3'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [
          {
            groupId: 742,
            channelId: 'updates',
            name: 'stale-name',
            position: 1,
            archived: false,
            writeMode: 'members',
            readMode: 'members',
            writeModeUpdatedAt: 200,
            createdBy: 'Qadmin',
            createdAt: 100,
            updatedAt: 200,
          },
        ],
        categories: [],
        revisions: [
          {
            entityType: 'channel',
            entityId: 'updates',
            eventId: 'updates-older',
            eventType: 'channel_update',
            timestamp: 200,
            deleted: false,
            stateHash: hashReticulumChatMetadataEntityState(
              'channel',
              'updates',
              {
                groupId: 742,
                channelId: 'updates',
                name: 'stale-name',
                position: 1,
                archived: false,
                writeMode: 'members',
                readMode: 'members',
                writeModeUpdatedAt: 200,
                createdBy: 'Qadmin',
                createdAt: 100,
                updatedAt: 200,
              }
            ),
          },
          {
            entityType: 'category',
            entityId: 'cat-old',
            eventId: 'category-delete',
            eventType: 'category_delete',
            timestamp: 400,
            deleted: true,
            stateHash: hashReticulumChatMetadataEntityState(
              'category',
              'cat-old',
              null
            ),
          },
        ],
      })
    ).toBe(true);
    expect(db.getChannel(742, 'updates')?.name).toBe('new-name');
    expect(db.getCategory(742, 'cat-old')).toBeNull();

    expect(
      db.applyMetadataSnapshot({
        groupId: 742,
        snapshotId: 'snapshot-stale-category',
        scope: 'full',
        parentSnapshotHash: '',
        version: 99,
        createdAt: 500,
        latestEventId: 'category-create-old',
        latestFeedTimestamp: 200,
        snapshotHash: '4'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [],
        categories: [
          {
            groupId: 742,
            categoryId: 'cat-old',
            name: 'resurrected',
            position: 1,
            createdBy: 'Qadmin',
            createdAt: 100,
            updatedAt: 200,
          },
        ],
        revisions: [
          {
            entityType: 'category',
            entityId: 'cat-old',
            eventId: 'category-create-old',
            eventType: 'category_create',
            timestamp: 200,
            deleted: false,
            stateHash: hashReticulumChatMetadataEntityState(
              'category',
              'cat-old',
              {
                groupId: 742,
                categoryId: 'cat-old',
                name: 'resurrected',
                position: 1,
                createdBy: 'Qadmin',
                createdAt: 100,
                updatedAt: 200,
              }
            ),
          },
        ],
      })
    ).toBe(true);
    expect(db.getCategory(742, 'cat-old')).toBeNull();
    db.close();
  });

  it('accepts every unseen metadata snapshot for entity-level merging', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const current = {
      groupId: 743,
      snapshotId: 'current',
      scope: 'public' as const,
      parentSnapshotHash: 'a'.repeat(64),
      version: 2,
      createdAt: 2,
      latestEventId: '',
      latestFeedTimestamp: 0,
      snapshotHash: 'c'.repeat(64),
      adminAddress: 'Qadmin',
      adminPublicKey: 'public-key',
      signature: 'signature',
      channels: [],
      categories: [],
      revisions: [],
    };
    (manager as any).db.getMetadataSnapshotByHash = (
      groupId: number,
      hash: string
    ) => (groupId === 743 && hash === current.snapshotHash ? current : null);
    expect((manager as any).shouldApplyMetadataSnapshot(current)).toBe(false);
    expect(
      (manager as any).shouldApplyMetadataSnapshot({
        ...current,
        snapshotId: 'child',
        parentSnapshotHash: current.snapshotHash,
        version: 3,
        snapshotHash: 'd'.repeat(64),
      })
    ).toBe(true);
    expect(
      (manager as any).shouldApplyMetadataSnapshot({
        ...current,
        snapshotId: 'lower-sibling',
        snapshotHash: 'b'.repeat(64),
      })
    ).toBe(true);
    expect(
      (manager as any).shouldApplyMetadataSnapshot({
        ...current,
        snapshotId: 'higher-sibling',
        snapshotHash: 'd'.repeat(64),
      })
    ).toBe(true);
    expect(
      (manager as any).shouldApplyMetadataSnapshot({
        ...current,
        snapshotId: 'unrelated',
        parentSnapshotHash: 'e'.repeat(64),
        version: 9,
        snapshotHash: 'f'.repeat(64),
      })
    ).toBe(true);
    manager.close();
  });

  it('uses a public snapshot scope even when the full state has no private channels', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupAdmin: async () => true,
    });
    manager.setLocalGroupMemberships([
      {
        groupId: 745,
        isAdmin: true,
        localAddress: 'QsnapshotAdmin',
      },
    ]);
    const selected = await (manager as any).getPublicMetadataSnapshotForSend(
      745
    );
    expect(selected.snapshot.scope).toBe('public');
    expect(selected.fullSnapshot.scope).toBe('full');
    expect(selected.snapshot.snapshotHash).not.toBe(
      selected.fullSnapshot.snapshotHash
    );
    manager.close();
  });

  it('uses validated local admin status when snapshot membership hints are incomplete', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupAdmin: async (_groupId, address) =>
        address === 'QvalidatedAdmin',
    });
    manager.setLocalGroupMemberships([
      {
        groupId: 746,
        isAdmin: false,
        localAddress: 'QvalidatedAdmin',
      },
    ]);

    await expect(
      (manager as any).expectedMetadataSnapshotScope(746)
    ).resolves.toBe('full');
    manager.close();
  });

  it('keeps snapshot application deferred when local admin validation is unavailable', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupAdmin: async () => {
        throw new Error('temporarily unavailable');
      },
    });
    manager.setLocalGroupMemberships([
      {
        groupId: 747,
        isAdmin: false,
        localAddress: 'QunknownAdmin',
      },
    ]);

    await expect(
      (manager as any).expectedMetadataSnapshotScope(747)
    ).resolves.toBeNull();
    manager.close();
  });

  it('does not infer full snapshot access without an admin validator or admin hint', async () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([
      {
        groupId: 748,
        isAdmin: false,
        localAddress: 'QordinaryMember',
      },
    ]);

    await expect(
      (manager as any).expectedMetadataSnapshotScope(748)
    ).resolves.toBe('public');
    manager.close();
  });

  it('dedupes deferred metadata snapshots and retries from the retained record', async () => {
    vi.useFakeTimers();
    try {
      const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
      const retry = vi.fn();
      (manager as any).handleMetadataSnapshotOffer = retry;
      const hash = 'a'.repeat(64);
      const snapshot = {
        groupId: 749,
        snapshotId: 'deferred-snapshot',
        scope: 'public' as const,
        parentSnapshotHash: '',
        version: 1,
        createdAt: 1,
        latestEventId: '',
        latestFeedTimestamp: 0,
        snapshotHash: hash,
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [],
        categories: [],
        revisions: [],
      };
      const fullHash = 'b'.repeat(64);

      (manager as any).deferMetadataSnapshot('peer-retry', snapshot, fullHash);
      (manager as any).deferMetadataSnapshot('peer-retry', snapshot, fullHash);
      expect((manager as any).metadataSnapshotRetryTimers.size).toBe(1);
      expect((manager as any).deferredMetadataSnapshots.size).toBe(1);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(retry).toHaveBeenCalledTimes(1);
      expect(retry).toHaveBeenCalledWith(
        749,
        expect.objectContaining({
          fh: Buffer.from(fullHash, 'hex').toString('base64url'),
          s: expect.objectContaining({ h: hash }),
        }),
        'peer-retry'
      );
      expect((manager as any).metadataSnapshotRetryTimers.size).toBe(0);
      manager.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears deferred metadata snapshots when a group is unsubscribed', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const snapshot = {
      groupId: 750,
      snapshotId: 'removed-group-snapshot',
      scope: 'public' as const,
      parentSnapshotHash: '',
      version: 1,
      createdAt: 1,
      latestEventId: '',
      latestFeedTimestamp: 0,
      snapshotHash: 'c'.repeat(64),
      adminAddress: 'Qadmin',
      adminPublicKey: 'public-key',
      signature: 'signature',
      channels: [],
      categories: [],
      revisions: [],
    };
    (manager as any).deferMetadataSnapshot('peer-cleanup', snapshot);
    manager.unsubscribeGroup(750);
    expect((manager as any).deferredMetadataSnapshots.size).toBe(0);
    expect((manager as any).metadataSnapshotRetryTimers.size).toBe(0);
    manager.close();
  });

  it('clears deferred metadata snapshots for every peer after group recovery', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const snapshot = {
      groupId: 752,
      snapshotId: 'multi-peer-deferred-snapshot',
      scope: 'public' as const,
      parentSnapshotHash: '',
      version: 1,
      createdAt: 1,
      latestEventId: '',
      latestFeedTimestamp: 0,
      snapshotHash: '1'.repeat(64),
      adminAddress: 'Qadmin',
      adminPublicKey: 'public-key',
      signature: 'signature',
      channels: [],
      categories: [],
      revisions: [],
    };
    (manager as any).deferMetadataSnapshot('peer-one', snapshot);
    (manager as any).deferMetadataSnapshot('peer-two', snapshot);
    expect((manager as any).deferredMetadataSnapshots.size).toBe(2);
    expect((manager as any).metadataSnapshotRetryTimers.size).toBe(2);

    (manager as any).clearDeferredMetadataSnapshotsForGroup(752);
    expect((manager as any).deferredMetadataSnapshots.size).toBe(0);
    expect((manager as any).metadataSnapshotRetryTimers.size).toBe(0);
    manager.close();
  });

  it('retains divergent deferred snapshots without mixing their full snapshot hashes', () => {
    vi.useFakeTimers();
    try {
      const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
      const baseSnapshot = {
        groupId: 751,
        snapshotId: 'deferred-v1',
        scope: 'public' as const,
        parentSnapshotHash: '',
        version: 1,
        createdAt: 1,
        latestEventId: '',
        latestFeedTimestamp: 0,
        snapshotHash: 'd'.repeat(64),
        adminAddress: 'Qadmin',
        adminPublicKey: 'public-key',
        signature: 'signature',
        channels: [],
        categories: [],
        revisions: [],
      };
      (manager as any).deferMetadataSnapshot(
        'peer-versioned',
        baseSnapshot,
        'e'.repeat(64)
      );
      (manager as any).deferMetadataSnapshot('peer-versioned', {
        ...baseSnapshot,
        snapshotId: 'deferred-v2',
        version: 2,
        snapshotHash: 'f'.repeat(64),
      });
      const deferred = [...(manager as any).deferredMetadataSnapshots.values()];
      expect(deferred).toHaveLength(2);
      expect(
        deferred.find((item) => item.snapshot.version === 1)?.fullSnapshotHash
      ).toBe('e'.repeat(64));
      expect(
        deferred.find((item) => item.snapshot.version === 2)?.fullSnapshotHash
      ).toBe('');
      manager.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds pending event pulls globally and per source peer', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    for (let index = 0; index < 100; index += 1) {
      (manager as any).enqueueEventPull('peer-a', {
        eventId: `event-peer-a-${index}`,
        groupId: 741,
        channelId: '*',
        authorAddress: '',
        authorSeq: 0,
        timestamp: index,
        eventType: 'message',
        payloadHash: '',
        mentionAddressHashes: [],
      });
    }
    expect((manager as any).pendingEventPulls.size).toBe(64);
    for (let peerIndex = 0; peerIndex < 20; peerIndex += 1) {
      for (let eventIndex = 0; eventIndex < 64; eventIndex += 1) {
        (manager as any).enqueueEventPull(`peer-${peerIndex}`, {
          eventId: `event-${peerIndex}-${eventIndex}`,
          groupId: 741,
          channelId: '*',
          authorAddress: '',
          authorSeq: 0,
          timestamp: eventIndex,
          eventType: 'message',
          payloadHash: '',
          mentionAddressHashes: [],
        });
      }
    }
    expect((manager as any).pendingEventPulls.size).toBeLessThanOrEqual(500);
    manager.close();
  });

  it('accepts only signed v3 event notices', async () => {
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'a'.repeat(32),
      } as any,
      signLocalFields: createReticulumChatTestSigner(),
    });
    manager.setLocalGroupMemberships([744]);
    manager.subscribeGroup(744);
    const event = signedEvent({ groupId: 744 });
    const wire = await (manager as any).buildEventNoticeWire(
      event,
      Buffer.byteLength(JSON.stringify(event), 'utf8')
    );
    expect(wireFitsReticulum(wire)).toBe(true);
    const badWire = JSON.parse(JSON.stringify(wire));
    badWire.n.z = `${badWire.n.z.slice(0, -1)}${badWire.n.z.endsWith('1') ? '2' : '1'}`;
    manager.handleWire(badWire, 'peer-notice');
    expect((manager as any).pendingEventPulls.size).toBe(0);
    manager.handleWire(wire, 'peer-notice');
    expect((manager as any).pendingEventPulls.size).toBe(1);
    manager.close();
  });

  it('repairs a channel when its state-head hash differs at the same cursor', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([742]);
    manager.subscribeGroup(742);
    const event = signedEvent({ groupId: 742, channelId: 'general' });
    expect((manager as any).db.insertEvent(event, false)).toBe(true);
    const requests: unknown[] = [];
    (manager as any).requestLinkedHistoryPage = (...args: unknown[]) => {
      requests.push(args);
      return Promise.resolve();
    };
    (manager as any).pendingStateHeadsRequests.set('peer-channel-hash:742', {
      cursor: '',
      expiresAt: Date.now() + 30_000,
    });
    (manager as any).handleStateHeadsPage(
      742,
      {
        type: 'channels',
        heads: [
          {
            c: 'general',
            latest: { id: event.eventId, ts: event.timestamp },
            h: 'f'.repeat(64),
          },
        ],
        more: false,
      },
      'peer-channel-hash'
    );
    expect(requests).toHaveLength(1);
    manager.close();
  });

  it('ignores unsolicited channel state-head pages', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([748]);
    manager.subscribeGroup(748);
    const requestLinkedHistoryPage = vi.fn();
    (manager as any).requestLinkedHistoryPage = requestLinkedHistoryPage;

    (manager as any).handleStateHeadsPage(
      748,
      {
        type: 'channels',
        heads: [
          {
            c: 'general',
            latest: { id: 'unsolicited-event', ts: Date.now() },
            h: 'f'.repeat(64),
          },
        ],
        more: false,
      },
      'peer-unsolicited-heads'
    );

    expect(requestLinkedHistoryPage).not.toHaveBeenCalled();
    manager.close();
  });

  it('does not map malformed channel state heads onto general', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([753]);
    manager.subscribeGroup(753);
    const requestLinkedHistoryPage = vi.fn();
    (manager as any).requestLinkedHistoryPage = requestLinkedHistoryPage;
    (manager as any).pendingStateHeadsRequests.set('peer-bad-head:753', {
      cursor: '',
      expiresAt: Date.now() + 30_000,
    });

    (manager as any).handleStateHeadsPage(
      753,
      {
        type: 'channels',
        heads: [
          {
            c: '../general',
            latest: { id: 'bad-channel-event', ts: Date.now() },
            h: 'f'.repeat(64),
          },
        ],
        more: false,
      },
      'peer-bad-head'
    );

    expect(requestLinkedHistoryPage).not.toHaveBeenCalled();
    manager.close();
  });

  it('stops channel state-head pagination when the cursor does not advance', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([750]);
    manager.subscribeGroup(750);
    const requestStateHeadsFromPeer = vi.fn();
    (manager as any).requestStateHeadsFromPeer = requestStateHeadsFromPeer;
    (manager as any).pendingStateHeadsRequests.set('peer-stalled-heads:750', {
      cursor: '12',
      expiresAt: Date.now() + 30_000,
    });

    (manager as any).handleStateHeadsPage(
      750,
      {
        type: 'channels',
        heads: [],
        more: true,
        nextCursor: '12',
      },
      'peer-stalled-heads'
    );

    expect(requestStateHeadsFromPeer).not.toHaveBeenCalled();
    manager.close();
  });

  it('releases the state-head debounce when request signing is unavailable', async () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });

    expect((manager as any).shouldRequestStateHeads('peer-retry', 749)).toBe(
      true
    );
    (manager as any).requestStateHeadsFromPeer('peer-retry', 749, 'channels');
    await flushQueuedWork();

    expect((manager as any).shouldRequestStateHeads('peer-retry', 749)).toBe(
      true
    );
    manager.close();
  });

  it('admits only one concurrent state-head request per peer and group', async () => {
    let finishSigning: (() => void) | undefined;
    const signLocalFields = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finishSigning = () => resolve(null);
        })
    );
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      signLocalFields,
    });

    (manager as any).requestStateHeadsFromPeer(
      'peer-concurrent',
      751,
      'channels'
    );
    (manager as any).requestStateHeadsFromPeer(
      'peer-concurrent',
      751,
      'channels'
    );

    expect(signLocalFields).toHaveBeenCalledTimes(1);
    finishSigning?.();
    await flushQueuedWork();
    manager.close();
  });

  it('repairs forward from the newest local message on a normal history read', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([743]);
    manager.subscribeGroup(743);
    const older = signedEvent({
      eventId: 'history-read-older',
      groupId: 743,
      channelId: 'general',
      timestamp: 1_000,
    });
    const newer = signedEvent({
      eventId: 'history-read-newer',
      groupId: 743,
      channelId: 'general',
      timestamp: 2_000,
    });
    (manager as any).getInterestedPeers = () => ['peer-history'];
    (manager as any).shouldRequestGroupRepair = () => true;
    (manager as any).requestStateHeadsFromPeer = vi.fn();
    const requestPage = vi.fn(async () => undefined);
    (manager as any).requestLinkedHistoryPage = requestPage;

    (manager as any).requestNetworkHistoryForRead(
      743,
      'general',
      [older, newer],
      {},
      'message-history-read'
    );

    expect(requestPage).toHaveBeenCalledWith(
      'peer-history',
      743,
      'general',
      { eventId: newer.eventId, feedTimestamp: newer.timestamp },
      'after',
      false,
      'message-history-read',
      'peer-history'
    );
    manager.close();
  });

  it('keeps explicit older-history reads moving backward', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([744]);
    manager.subscribeGroup(744);
    const event = signedEvent({
      eventId: 'history-read-before',
      groupId: 744,
      channelId: 'general',
      timestamp: 2_000,
    });
    (manager as any).getInterestedPeers = () => ['peer-history'];
    (manager as any).shouldRequestGroupRepair = () => true;
    (manager as any).requestStateHeadsFromPeer = vi.fn();
    const requestPage = vi.fn(async () => undefined);
    (manager as any).requestLinkedHistoryPage = requestPage;

    (manager as any).requestNetworkHistoryForRead(
      744,
      'general',
      [event],
      { beforeTimestamp: event.timestamp, beforeEventId: event.eventId },
      'message-history-read'
    );

    expect(requestPage.mock.calls[0]?.[3]).toEqual({
      eventId: event.eventId,
      feedTimestamp: event.timestamp,
    });
    expect(requestPage.mock.calls[0]?.[4]).toBe('before');
    manager.close();
  });

  it('requests the newest available page when a channel has no local history', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([746]);
    manager.subscribeGroup(746);
    (manager as any).getInterestedPeers = () => ['peer-history'];
    (manager as any).shouldRequestGroupRepair = () => true;
    (manager as any).requestStateHeadsFromPeer = vi.fn();
    const requestPage = vi.fn(async () => undefined);
    (manager as any).requestLinkedHistoryPage = requestPage;

    (manager as any).requestNetworkHistoryForRead(
      746,
      'general',
      [],
      {},
      'message-history-read'
    );

    expect(requestPage.mock.calls[0]?.[3]).toBeNull();
    expect(requestPage.mock.calls[0]?.[4]).toBe('before');
    manager.close();
  });

  it('keeps network search walking backward from its oldest local event', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([747]);
    manager.subscribeGroup(747);
    const older = signedEvent({
      eventId: 'search-history-older',
      groupId: 747,
      channelId: 'general',
      timestamp: 1_000,
    });
    const newer = signedEvent({
      eventId: 'search-history-newer',
      groupId: 747,
      channelId: 'general',
      timestamp: 2_000,
    });
    (manager as any).getInterestedPeers = () => ['peer-history'];
    (manager as any).shouldRequestGroupRepair = () => true;
    (manager as any).requestStateHeadsFromPeer = vi.fn();
    const requestPage = vi.fn(async () => undefined);
    (manager as any).requestLinkedHistoryPage = requestPage;

    (manager as any).requestNetworkHistoryForRead(
      747,
      'general',
      [older, newer],
      {},
      'search-read',
      'before'
    );

    expect(requestPage.mock.calls[0]?.[3]).toEqual({
      eventId: older.eventId,
      feedTimestamp: older.timestamp,
    });
    expect(requestPage.mock.calls[0]?.[4]).toBe('before');
    manager.close();
  });

  it('fits a paginated UUID channel state head in an RCHAT control packet', async () => {
    const requester = createDmIdentity();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupMember: async (_groupId, address) =>
        address === requester.address,
    });
    manager.setLocalGroupMemberships([745]);
    manager.subscribeGroup(745);
    const firstChannel = 'ch-25ce35ea-1c06-4621-aae2-399c181b8970';
    const secondChannel = 'ch-c029151a-3a6a-4a07-b39a-1205fa921416';
    upsertTestChannel(manager, { groupId: 745, channelId: firstChannel });
    upsertTestChannel(manager, { groupId: 745, channelId: secondChannel });
    expect(
      (manager as any).db.insertEvent(
        signedEvent({
          eventId: 'a5b14f79-dd51-4dca-8ae7-0d69f09747ac',
          groupId: 745,
          channelId: firstChannel,
          timestamp: 2_000,
        }),
        false
      )
    ).toBe(true);
    const sendToPeer = vi.fn(async () => ({ ok: true }));
    (manager as any).sendToPeer = sendToPeer;

    const timestamp = Date.now();
    const signedFields = buildReticulumStateHeadsRequestSignedFields({
      groupId: 745,
      cursor: '',
      limit: 1,
      authorAddress: requester.address,
      authorPublicKey: requester.publicKey,
      timestamp,
    });
    await (manager as any).handleStateHeadsReq(
      745,
      {
        type: 'channels',
        limit: 1,
        p: requester.publicKey,
        ts: timestamp,
        z: base58Encode(
          nacl.sign.detached(
            new Uint8Array(canonicalizeForSigning(signedFields)),
            requester.secretKey
          )
        ),
      },
      'peer-state-heads'
    );

    expect(sendToPeer).toHaveBeenCalledTimes(1);
    const pageWire = sendToPeer.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(pageWire).toMatchObject({
      k: 'state_heads_page_v3',
      p: { more: true, nextCursor: '1' },
    });
    expect(wireFitsReticulum(pageWire)).toBe(true);
    manager.close();
  });

  it('terminates a signed channel state-head request past the final page', async () => {
    const requester = createDmIdentity();
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      validateGroupMember: async (_groupId, address) =>
        address === requester.address,
    });
    manager.setLocalGroupMemberships([752]);
    manager.subscribeGroup(752);
    const sendToPeer = vi.fn(async () => ({ ok: true }));
    (manager as any).sendToPeer = sendToPeer;
    const timestamp = Date.now();
    const signedFields = buildReticulumStateHeadsRequestSignedFields({
      groupId: 752,
      cursor: '999',
      limit: 1,
      authorAddress: requester.address,
      authorPublicKey: requester.publicKey,
      timestamp,
    });

    await (manager as any).handleStateHeadsReq(
      752,
      {
        type: 'channels',
        cursor: '999',
        limit: 1,
        p: requester.publicKey,
        ts: timestamp,
        z: base58Encode(
          nacl.sign.detached(
            new Uint8Array(canonicalizeForSigning(signedFields)),
            requester.secretKey
          )
        ),
      },
      'peer-state-heads-end'
    );

    expect(sendToPeer).toHaveBeenCalledWith(
      'peer-state-heads-end',
      expect.objectContaining({
        k: 'state_heads_page_v3',
        p: { type: 'channels', more: false, heads: [] },
      })
    );
    manager.close();
  });

  it('rejects unsigned channel state-head requests', async () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    manager.setLocalGroupMemberships([746]);
    manager.subscribeGroup(746);
    const sendToPeer = vi.fn(async () => ({ ok: true }));
    (manager as any).sendToPeer = sendToPeer;

    await (manager as any).handleStateHeadsReq(
      746,
      { type: 'channels', limit: 1 },
      'peer-unsigned-state-heads'
    );

    expect(sendToPeer).not.toHaveBeenCalled();
    expect((manager as any).peerProtocolViolations.size).toBe(0);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await (manager as any).handleStateHeadsReq(
        746,
        { type: 'channels', limit: 1, p: 'malformed-authentication' },
        'peer-malformed-state-heads'
      );
    }
    expect(
      (manager as any).isPeerProtocolCooledDown(
        'peer-malformed-state-heads',
        'event_batch'
      )
    ).toBe(true);
    manager.close();
  });

  it('rejects unsigned live event resource auth for admin-private channels', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupAdmin: async () => true,
    });
    upsertTestChannel(manager, {
      groupId: 74,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-live-admin-private-unsigned-hidden',
      groupId: 74,
      channelId: 'admin-private',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'live-admin-private-link-unsigned',
      transferId: 'live-admin-private-transfer-unsigned',
      eventId: event.eventId,
      groupId: 74,
      auth: {
        type: 'RETICULUM_CHAT_RESOURCE_AUTH',
        transferId: 'live-admin-private-transfer-unsigned',
        eventId: event.eventId,
        groupId: 74,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(authorized).toEqual([]);
    expect(rejected).toContainEqual(
      expect.objectContaining({
        transferId: 'live-admin-private-transfer-unsigned',
        reason: 'signed_request_required',
      })
    );
    manager.close();
  });

  it('includes signed requester fields when accepting live event resources', async () => {
    const accepted: Array<Record<string, any>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        accepted.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });

    await (manager as any).acceptEventResource('peer', {
      transferId: 'live-event-transfer-signed-auth',
      eventId: 'event-live-auth-signed',
      groupId: 74,
      payloadHash: 'a'.repeat(64),
      wireHash: 'b'.repeat(64),
      sizeBytes: 123,
    });

    expect(accepted).toHaveLength(1);
    expect(accepted[0].authMessage).toEqual(
      expect.objectContaining({
        t: 'RCR',
        x: 'live-event-transfer-signed-auth',
        g: 74,
        a: expect.any(String),
        p: expect.any(String),
        ts: 100_000,
        z: expect.any(String),
      })
    );
    expect(
      byteLengthUtf8JsonWithBridgeSender(accepted[0].authMessage)
    ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    manager.close();
  });

  it('keeps signed event page auth messages inside the Reticulum wire limit', async () => {
    const accepted: Array<Record<string, any>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        accepted.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });

    await (manager as any).acceptEventPageResource('peer', {
      transferId: 'event-page-transfer-signed-auth',
      groupId: 74,
      channelId: '*',
      direction: 'before',
      pageHash: 'c'.repeat(64),
      sizeBytes: 123,
      eventCount: 100,
      start: { eventId: 'event-page-auth-start', feedTimestamp: 90_000 },
      end: { eventId: 'event-page-auth-end', feedTimestamp: 100_000 },
    });

    expect(accepted).toHaveLength(1);
    expect(accepted[0].authMessage).toEqual(
      expect.objectContaining({
        t: 'RCP',
        x: 'event-page-transfer-signed-auth',
        g: 74,
        a: expect.any(String),
        p: expect.any(String),
        ts: 100_000,
        z: expect.any(String),
      })
    );
    expect(
      byteLengthUtf8JsonWithBridgeSender(accepted[0].authMessage)
    ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    manager.close();
  });

  it('defers event page resource accept until local signing is available', async () => {
    const accepted: Array<Record<string, any>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        accepted.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    const offer = {
      transferId: 'event-page-transfer-deferred-auth',
      groupId: 74,
      channelId: '*',
      direction: 'before' as const,
      pageHash: 'c'.repeat(64),
      sizeBytes: 123,
      eventCount: 100,
      sourcePeerHash: 'peer',
      start: { eventId: 'event-page-deferred-start', feedTimestamp: 90_000 },
      end: { eventId: 'event-page-deferred-end', feedTimestamp: 100_000 },
    };
    (manager as any).eventPageOffers.set(offer.transferId, offer);

    await (manager as any).acceptEventPageResource('peer', offer);
    expect(accepted).toEqual([]);
    expect((manager as any).eventPageOffers.has(offer.transferId)).toBe(true);

    manager.setRuntimeCallbacks({
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(accepted).toHaveLength(1);
    expect(accepted[0].authMessage).toEqual(
      expect.objectContaining({
        t: 'RCP',
        x: 'event-page-transfer-deferred-auth',
        g: 74,
        a: expect.any(String),
        p: expect.any(String),
        ts: 100_000,
        z: expect.any(String),
      })
    );
    manager.close();
  });

  it('rejects unsigned event page resource auth', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    const event = signedEvent({
      eventId: 'event-page-live-unsigned-event',
      groupId: 74,
      channelId: 'general',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    (manager as any).outboundEventPageResources.set(
      'event-page-transfer-unsigned',
      {
        groupId: 74,
        channelId: 'general',
        pageHash: 'c'.repeat(64),
        eventIds: new Set([event.eventId]),
        expiresAt: 120_000,
      }
    );

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'event-page-link-unsigned',
      transferId: 'event-page-transfer-unsigned',
      groupId: 74,
      auth: {
        type: 'RETICULUM_CHAT_EVENT_PAGE_RESOURCE_AUTH',
        transferId: 'event-page-transfer-unsigned',
        groupId: 74,
        channelId: 'general',
        pageHash: 'c'.repeat(64),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(authorized).toEqual([]);
    expect(rejected).toContainEqual(
      expect.objectContaining({
        transferId: 'event-page-transfer-unsigned',
        reason: 'signed_request_required',
      })
    );
    manager.close();
  });

  it('rejects signed event page resource auth from non-members', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const event = signedEvent({
      eventId: 'event-page-live-non-member-event',
      groupId: 74,
      channelId: 'general',
      timestamp: 100_000,
    });
    const request = signedHistoryPageRequestWire({
      groupId: 74,
      channelId: 'general',
      direction: 'before',
      limit: 100,
      timestamp: 100_000,
    });
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async (_groupId, address) => address !== request.a,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    (manager as any).outboundEventPageResources.set(
      'event-page-transfer-non-member',
      {
        groupId: 74,
        channelId: 'general',
        pageHash: 'd'.repeat(64),
        eventIds: new Set([event.eventId]),
        expiresAt: 120_000,
      }
    );

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'event-page-link-non-member',
      transferId: 'event-page-transfer-non-member',
      groupId: 74,
      auth: {
        type: 'RETICULUM_CHAT_EVENT_PAGE_RESOURCE_AUTH',
        transferId: 'event-page-transfer-non-member',
        groupId: 74,
        channelId: 'general',
        pageHash: 'd'.repeat(64),
        ...request,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(authorized).toEqual([]);
    expect(rejected).toContainEqual(
      expect.objectContaining({
        transferId: 'event-page-transfer-non-member',
        reason: 'requester_not_group_member',
      })
    );
    manager.close();
  });

  it('authorizes signed event page resource auth from members', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
    });
    const event = signedEvent({
      eventId: 'event-page-live-member-event',
      groupId: 74,
      channelId: 'general',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    (manager as any).outboundEventPageResources.set(
      'event-page-transfer-member',
      {
        groupId: 74,
        channelId: 'general',
        pageHash: 'e'.repeat(64),
        eventIds: new Set([event.eventId]),
        expiresAt: 120_000,
      }
    );

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'event-page-link-member',
      transferId: 'event-page-transfer-member',
      groupId: 74,
      auth: {
        type: 'RETICULUM_CHAT_EVENT_PAGE_RESOURCE_AUTH',
        transferId: 'event-page-transfer-member',
        groupId: 74,
        channelId: 'general',
        pageHash: 'e'.repeat(64),
        ...signedHistoryPageRequestWire({
          groupId: 74,
          channelId: 'general',
          direction: 'before',
          limit: 100,
          timestamp: 100_000,
        }),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rejected).toEqual([]);
    expect(authorized).toContainEqual(
      expect.objectContaining({
        transferId: 'event-page-transfer-member',
      })
    );
    manager.close();
  });

  it('rejects signed live event resource auth for admin-private channels from non-admin requesters', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => false,
    });
    upsertTestChannel(manager, {
      groupId: 74,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-live-admin-private-non-admin-hidden',
      groupId: 74,
      channelId: 'admin-private',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'live-admin-private-link-non-admin',
      transferId: 'live-admin-private-transfer-non-admin',
      eventId: event.eventId,
      groupId: 74,
      auth: {
        type: 'RETICULUM_CHAT_RESOURCE_AUTH',
        transferId: 'live-admin-private-transfer-non-admin',
        eventId: event.eventId,
        groupId: 74,
        ...signedEventRequestWire({
          groupId: 74,
          eventId: event.eventId,
          timestamp: 100_000,
        }),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(authorized).toEqual([]);
    expect(rejected).toContainEqual(
      expect.objectContaining({
        transferId: 'live-admin-private-transfer-non-admin',
        reason: 'channel_read_forbidden',
      })
    );
    manager.close();
  });

  it('rejects compact signed live event resource auth for admin-private channels from non-admin requesters', async () => {
    const authorized: unknown[] = [];
    const rejected: Array<Record<string, unknown>> = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (
        payload: Record<string, unknown>
      ) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => false,
    });
    upsertTestChannel(manager, {
      groupId: 74,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-live-admin-private-compact-non-admin-hidden',
      groupId: 74,
      channelId: 'admin-private',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    const authMessage = await (manager as any).buildSignedResourceAuthWire(
      74,
      'live-admin-private-transfer-compact-non-admin',
      'RCR'
    );

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'live-admin-private-link-compact-non-admin',
      transferId: 'live-admin-private-transfer-compact-non-admin',
      eventId: event.eventId,
      groupId: 74,
      metadata: {
        eventId: event.eventId,
        groupId: 74,
      },
      auth: authMessage,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(authorized).toEqual([]);
    expect(rejected).toContainEqual(
      expect.objectContaining({
        transferId: 'live-admin-private-transfer-compact-non-admin',
        reason: 'channel_read_forbidden',
      })
    );
    manager.close();
  });

  it('authorizes signed live event resource auth for admin-private channels from admin requesters', async () => {
    const authorized: unknown[] = [];
    const rejected: unknown[] = [];
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      authorizeReticulumChatResourceDetailed: async (payload: unknown) => {
        authorized.push(payload);
        return { ok: true as const };
      },
      rejectReticulumChatResourceDetailed: async (payload: unknown) => {
        rejected.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
      validateGroupMember: async () => true,
      validateGroupAdmin: async () => true,
    });
    upsertTestChannel(manager, {
      groupId: 74,
      channelId: 'admin-private',
      writeMode: 'admins',
      readMode: 'admins',
    });
    const event = signedEvent({
      eventId: 'event-live-admin-private-admin-visible',
      groupId: 74,
      channelId: 'admin-private',
      timestamp: 100_000,
    });
    expect((manager as any).db.insertEvent(event, true)).toBe(true);

    manager.handleResourceEvent({
      status: 'auth',
      linkId: 'live-admin-private-link-admin',
      transferId: 'live-admin-private-transfer-admin',
      eventId: event.eventId,
      groupId: 74,
      auth: {
        type: 'RETICULUM_CHAT_RESOURCE_AUTH',
        transferId: 'live-admin-private-transfer-admin',
        eventId: event.eventId,
        groupId: 74,
        ...signedEventRequestWire({
          groupId: 74,
          eventId: event.eventId,
          timestamp: 100_000,
        }),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rejected).toEqual([]);
    expect(authorized).toContainEqual(
      expect.objectContaining({
        transferId: 'live-admin-private-transfer-admin',
      })
    );
    manager.close();
  });

  it('refuses downloaded event resources when Core membership validation rejects the event author', async () => {
    const acceptedTransfers: unknown[] = [];
    const dbPath = tempDbPath();
    const blockedKp = nacl.sign.keyPair();
    const blockedPublicKey = base58Encode(blockedKp.publicKey);
    const blockedAddress = deriveAddressFromPublicKey(blockedPublicKey);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      acceptReticulumChatResourceDetailed: async (payload: unknown) => {
        acceptedTransfers.push(payload);
        return { ok: true as const };
      },
    };
    const manager = new ReticulumChatManager({
      dbPath,
      bridge: bridge as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async (_groupId, address) =>
        address !== blockedAddress,
    });
    manager.setLocalGroupMemberships([75]);
    manager.subscribeGroup(75);

    const event = signedEvent({
      eventId: 'event-inbound-non-member-author',
      groupId: 75,
      authorAddress: blockedAddress,
      authorPublicKey: blockedPublicKey,
      timestamp: 100_000,
    });
    const eventForSignature = { ...event, signature: '' };
    event.signature = base58Encode(
      nacl.sign.detached(
        new Uint8Array(
          canonicalizeForSigning(
            buildReticulumChatSignedFields(eventForSignature)
          )
        ),
        blockedKp.secretKey
      )
    );
    const blob = serializeReticulumChatEvent(event);
    const wireHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const resourcePath = path.join(
      path.dirname(tempDbPath()),
      'event-resource.json'
    );
    fs.writeFileSync(resourcePath, blob, 'utf8');

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_offer',
        g: 75,
        o: {
          x: 'transfer-inbound-non-member-author',
          id: event.eventId,
          ph: event.payloadHash,
          wh: wireHash,
          s: Buffer.byteLength(blob, 'utf8'),
        },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acceptedTransfers).toHaveLength(1);

    manager.handleResourceEvent({
      status: 'received',
      transferId: 'transfer-inbound-non-member-author',
      peerPresenceHash: 'peer',
      path: resourcePath,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(manager.getHistory(75, 10)).toEqual([]);
    expect(
      (manager as any).db.getRejectedEventMarker(75, event.eventId)
    ).toEqual(
      expect.objectContaining({
        groupId: 75,
        eventId: event.eventId,
        authorAddress: blockedAddress,
        revalidationAttempts: 1,
      })
    );
    expect(
      (manager as any).rejectedEventMarkerMatches({
        ...event,
        encryptedPayload: `${event.encryptedPayload}-equivocation`,
        payloadHash: 'f'.repeat(64),
        signature: 'different-signed-payload',
      })
    ).toBe('suppressed');
    expect((manager as any).pendingEventPulls.size).toBe(0);

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_offer',
        g: 75,
        o: {
          x: 'transfer-inbound-non-member-author-repeat',
          id: event.eventId,
          ph: event.payloadHash,
          wh: wireHash,
          s: Buffer.byteLength(blob, 'utf8'),
        },
      },
      'other-peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acceptedTransfers).toHaveLength(1);
    manager.close();

    const reopened = new ReticulumChatManager({
      dbPath,
      bridge: bridge as any,
      now: () => 100_001,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    reopened.setLocalGroupMemberships([75]);
    reopened.subscribeGroup(75);
    reopened.handleWire(
      {
        t: 'RCHAT',
        k: 'event_offer',
        g: 75,
        o: {
          x: 'transfer-inbound-non-member-author-after-restart',
          id: event.eventId,
          ph: event.payloadHash,
          wh: wireHash,
          s: Buffer.byteLength(blob, 'utf8'),
        },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acceptedTransfers).toHaveLength(1);
    reopened.close();

    // Joining later must not legitimize this exact event, because it was
    // authoritatively rejected while the author lacked current membership.
    const recovered = new ReticulumChatManager({
      dbPath,
      bridge: bridge as any,
      now: () => 1_000_001,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => true,
    });
    recovered.setLocalGroupMemberships([75]);
    recovered.subscribeGroup(75);
    recovered.handleWire(
      {
        t: 'RCHAT',
        k: 'event_offer',
        g: 75,
        o: {
          x: 'transfer-inbound-non-member-author-revalidated',
          id: event.eventId,
          ph: event.payloadHash,
          wh: wireHash,
          s: Buffer.byteLength(blob, 'utf8'),
        },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acceptedTransfers).toHaveLength(1);
    expect(
      (recovered as any).db.getRejectedEventMarker(75, event.eventId)
    ).toEqual(expect.objectContaining({ eventId: event.eventId }));
    // A distinct event created after joining is not covered by the old
    // event's marker and remains eligible for normal validation.
    expect(
      (recovered as any).rejectedEventMarkerMatches({
        ...event,
        eventId: 'event-created-after-joining',
        authorSeq: event.authorSeq + 1,
        timestamp: 1_000_001,
      })
    ).toBe('none');
    recovered.close();
  });

  it('defers an event without blaming its provider when membership validation is unavailable', async () => {
    const acceptedTransfers: unknown[] = [];
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        acceptReticulumChatResourceDetailed: async (payload: unknown) => {
          acceptedTransfers.push(payload);
          return { ok: true as const };
        },
      } as any,
      now: () => 100_000,
      signLocalFields: createReticulumChatTestSigner(),
      validateGroupMember: async () => null,
    });
    manager.setLocalGroupMemberships([75]);
    manager.subscribeGroup(75);
    const event = signedEvent({
      eventId: 'event-membership-temporarily-unavailable',
      groupId: 75,
      timestamp: 100_000,
    });
    const blob = serializeReticulumChatEvent(event);
    const wireHash = nodeCrypto
      .createHash('sha256')
      .update(blob, 'utf8')
      .digest('hex');
    const resourcePath = path.join(
      path.dirname(tempDbPath()),
      'event-membership-unavailable.json'
    );
    fs.writeFileSync(resourcePath, blob, 'utf8');

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_offer',
        g: 75,
        o: {
          x: 'transfer-membership-unavailable',
          id: event.eventId,
          ph: event.payloadHash,
          wh: wireHash,
          s: Buffer.byteLength(blob, 'utf8'),
        },
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acceptedTransfers).toHaveLength(1);

    manager.handleResourceEvent({
      status: 'received',
      transferId: 'transfer-membership-unavailable',
      peerPresenceHash: 'peer',
      path: resourcePath,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      (manager as any).db.getRejectedEventMarker(75, event.eventId)
    ).toBeNull();
    expect(
      (manager as any).pendingEventPulls.get(`75:${event.eventId}`)
    ).toEqual(
      expect.objectContaining({
        attempts: 0,
        nextAttemptAt: 110_000,
        peerHashes: new Set(['peer']),
      })
    );
    manager.close();
  });

  it('permanently suppresses rejected events across digests and author-gap repair', () => {
    let now = 100_000;
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      now: () => now,
    });
    const event = signedEvent({
      eventId: 'event-rejected-digest-fingerprint',
      groupId: 75,
      authorSeq: 2,
      timestamp: now,
    });
    const rejectedDigest = 'a'.repeat(64);
    const changedDigest = 'b'.repeat(64);

    (manager as any).db.upsertMissingRange(
      75,
      event.authorAddress,
      event.authorStreamId,
      1,
      3,
      'peer-a',
      now
    );
    (manager as any).markAuthoritativeRejectedEvent(event, rejectedDigest);

    expect(
      (manager as any).isRejectedDigestRepairSuppressed(75, rejectedDigest)
    ).toBe(true);
    expect(
      (manager as any).isRejectedDigestRepairSuppressed(75, changedDigest)
    ).toBe(false);
    (manager as any).rememberRejectedEventDigest(event, changedDigest);
    expect(
      (manager as any).isRejectedDigestRepairSuppressed(75, changedDigest)
    ).toBe(true);
    // A concurrent copy from another provider must not rewrite or duplicate
    // the permanent decision.
    (manager as any).markAuthoritativeRejectedEvent(event, rejectedDigest);
    expect(
      (manager as any).db.getRejectedEventMarker(75, event.eventId)
    ).toEqual(
      expect.objectContaining({
        authorStreamId: event.authorStreamId,
        authorSeq: 2,
        revalidationAttempts: 1,
      })
    );
    // Upgrade an intermediate short-lived marker to the complete period in
    // which the event could still pass the protocol's age validation.
    const storedMarker = (manager as any).db.getRejectedEventMarker(
      75,
      event.eventId
    );
    (manager as any).db.upsertRejectedEventMarker({
      ...storedMarker,
      nextRevalidateAt: now + 1_000,
    });
    (manager as any).db.upsertRejectedDigestMarker(
      { ...storedMarker, nextRevalidateAt: now + 1_000 },
      rejectedDigest
    );
    (manager as any).db.maintainRejectedEventMarkers(
      now,
      30 * 24 * 60 * 60_000 + 5 * 60_000 + 1
    );
    expect(
      (manager as any).db.getRejectedEventMarker(75, event.eventId)
        .nextRevalidateAt
    ).toBeGreaterThan(now + 30 * 24 * 60 * 60_000);
    expect(
      (manager as any).db.getMissingRangeOverlaps(
        75,
        event.authorAddress,
        event.authorStreamId,
        1,
        3
      )
    ).toEqual([
      expect.objectContaining({ fromSeq: 1, toSeq: 1 }),
      expect.objectContaining({ fromSeq: 3, toSeq: 3 }),
    ]);
    expect(
      (manager as any).excludeRejectedAuthorSequences(75, {
        a: event.authorAddress,
        s: event.authorStreamId,
        from: 1,
        to: 3,
      })
    ).toEqual([
      expect.objectContaining({ from: 1, to: 1 }),
      expect.objectContaining({ from: 3, to: 3 }),
    ]);

    now = 1_000_001;
    expect(
      (manager as any).isRejectedDigestRepairSuppressed(75, rejectedDigest)
    ).toBe(true);
    expect(
      (manager as any).isRejectedDigestRepairSuppressed(75, changedDigest)
    ).toBe(true);
    expect(
      (manager as any).excludeRejectedAuthorSequences(75, {
        a: event.authorAddress,
        s: event.authorStreamId,
        from: 1,
        to: 3,
      })
    ).toEqual([
      expect.objectContaining({ from: 1, to: 1 }),
      expect.objectContaining({ from: 3, to: 3 }),
    ]);
    manager.close();
  });

  it('serves cached event resources without provider-side author membership filtering', async () => {
    const sentResources: unknown[] = [];
    const blockedKp = nacl.sign.keyPair();
    const blockedPublicKey = base58Encode(blockedKp.publicKey);
    const blockedAddress = deriveAddressFromPublicKey(blockedPublicKey);
    const bridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatResourceDetailed: async (payload: unknown) => {
        sentResources.push(payload);
        return { ok: true as const };
      },
      sendReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const manager = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: bridge as any,
      now: () => 100_000,
    });
    manager.setLocalGroupMemberships([999]);

    const event = signedEvent({
      eventId: 'event-cached-non-member-author',
      groupId: 76,
      authorAddress: blockedAddress,
      authorPublicKey: blockedPublicKey,
      timestamp: 100_000,
    });
    const eventForSignature = { ...event, signature: '' };
    event.signature = base58Encode(
      nacl.sign.detached(
        new Uint8Array(
          canonicalizeForSigning(
            buildReticulumChatSignedFields(eventForSignature)
          )
        ),
        blockedKp.secretKey
      )
    );
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    manager.setRuntimeCallbacks({
      validateGroupMember: async (_groupId, address) =>
        address !== blockedAddress,
    });

    manager.handleWire(
      {
        t: 'RCHAT',
        k: 'event_req',
        g: 76,
        q: signedEventRequestWire({
          groupId: 76,
          eventId: event.eventId,
          timestamp: 100_000,
        }),
      },
      'peer'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sentResources).toHaveLength(1);
    expect(sentResources[0]).toMatchObject({
      transferId: expect.any(String),
      metadata: expect.objectContaining({
        eventId: event.eventId,
        groupId: 76,
        resourceType: 'reticulum_chat_event',
      }),
    });
    manager.close();
  });

  it('emits new shared DB events written by another instance for subscribed groups', async () => {
    const dbPath = tempDbPath();
    const noopBridge = {
      on: () => undefined,
      off: () => undefined,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
    };
    const writer = new ReticulumChatManager({
      dbPath,
      bridge: noopBridge as any,
      localNotifyDebounceMs: 10,
    });
    const reader = new ReticulumChatManager({
      dbPath,
      bridge: noopBridge as any,
      localNotifyDebounceMs: 10,
    });
    writer.setLocalGroupMemberships([33]);
    reader.setLocalGroupMemberships([33]);
    reader.subscribeGroup(33);

    const eventPromise = waitForEvent(reader);
    const event = signedEvent({ groupId: 33, authorSeq: 1 });
    const result = await writer.publishEvent(event);
    expect(result.ok).toBe(true);
    expect(reader.getHistory(33, 10).map((item) => item.eventId)).toContain(
      event.eventId
    );
    await expect(eventPromise).resolves.toMatchObject({
      eventId: event.eventId,
      groupId: 33,
    });

    const landEventPromise = waitForEvent(reader);
    const landEvent = signedEvent({
      eventId: 'shared-qortal-land-event',
      groupId: 33,
      channelId: 'qortal-land',
      authorSeq: 2,
    });
    const landResult = await writer.publishEvent(landEvent);
    expect(landResult.ok).toBe(true);
    await expect(landEventPromise).resolves.toMatchObject({
      eventId: landEvent.eventId,
      groupId: 33,
      channelId: 'qortal-land',
    });

    writer.close();
    reader.close();
  });

  it('marks requested groups read atomically at their current channel boundaries', () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const firstGroupId = 989;
    const secondGroupId = 990;
    const readerAddress = deriveAddressFromPublicKey(
      base58Encode(nacl.sign.keyPair().publicKey)
    );
    manager.setLocalGroupMemberships([firstGroupId, secondGroupId]);

    const firstGeneral = signedEvent({
      eventId: 'mark-groups-read-first-general',
      groupId: firstGroupId,
      channelId: 'general',
      timestamp: 100_000,
      mentionAddressHashes: [hashReticulumChatMentionAddress(readerAddress)],
    });
    const firstOther = signedEvent({
      eventId: 'mark-groups-read-first-other',
      groupId: firstGroupId,
      channelId: 'other',
      timestamp: 101_000,
    });
    const secondGeneral = signedEvent({
      eventId: 'mark-groups-read-second-general',
      groupId: secondGroupId,
      channelId: 'general',
      timestamp: 102_000,
    });
    for (const event of [firstGeneral, firstOther, secondGeneral]) {
      expect((manager as any).db.insertEvent(event, true)).toBe(true);
    }

    expect(manager.markGroupsRead([firstGroupId], readerAddress)).toEqual({
      groupsMarked: 1,
      channelsMarked: 2,
    });
    const afterFirstMark = manager.getChatSummaries(readerAddress);
    expect(
      afterFirstMark.find((summary) => summary.groupId === firstGroupId)
    ).toMatchObject({
      unreadCount: 0,
      mentionCount: 0,
    });
    expect(
      afterFirstMark.find((summary) => summary.groupId === secondGroupId)
    ).toMatchObject({
      unreadCount: 1,
    });

    const newerEvent = signedEvent({
      eventId: 'mark-groups-read-newer-event',
      groupId: firstGroupId,
      channelId: 'general',
      timestamp: 103_000,
    });
    expect((manager as any).db.insertEvent(newerEvent, true)).toBe(true);
    expect(
      manager
        .getChatSummaries(readerAddress)
        .find((summary) => summary.groupId === firstGroupId)
    ).toMatchObject({ unreadCount: 1 });

    expect(
      manager.markGroupsRead([firstGroupId, secondGroupId], readerAddress)
    ).toEqual({
      groupsMarked: 2,
      channelsMarked: 2,
    });
    expect(
      manager
        .getChatSummaries(readerAddress)
        .filter((summary) =>
          [firstGroupId, secondGroupId].includes(summary.groupId)
        )
    ).toEqual([
      expect.objectContaining({ unreadCount: 0, mentionCount: 0 }),
      expect.objectContaining({ unreadCount: 0, mentionCount: 0 }),
    ]);

    manager.close();
  });

  it('returns indexed bidirectional message pages with exact boundaries', async () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const groupId = 990;
    const baseTimestamp = Date.now() - 10_000;
    manager.setLocalGroupMemberships([groupId]);
    manager.subscribeGroup(groupId);
    const messages = Array.from({ length: 6 }, (_, index) =>
      signedEvent({
        eventId: `page-message-${index + 1}`,
        groupId,
        channelId: 'general',
        timestamp: baseTimestamp + (index + 1) * 1_000,
      })
    );
    for (const message of messages) {
      expect((manager as any).db.insertEvent(message, true)).toBe(true);
    }

    expect(manager.getMessageHistoryPage(groupId, 'general', 2)).toMatchObject({
      events: [
        expect.objectContaining({ eventId: 'page-message-5' }),
        expect.objectContaining({ eventId: 'page-message-6' }),
      ],
      oldestCursor: {
        eventId: 'page-message-5',
        timestamp: baseTimestamp + 5_000,
      },
      newestCursor: {
        eventId: 'page-message-6',
        timestamp: baseTimestamp + 6_000,
      },
      hasMore: true,
    });
    expect(
      manager.getMessageHistoryPage(groupId, 'general', 2, {
        beforeTimestamp: baseTimestamp + 5_000,
        beforeEventId: 'page-message-5',
        repairNetwork: false,
      })
    ).toMatchObject({
      events: [
        expect.objectContaining({ eventId: 'page-message-3' }),
        expect.objectContaining({ eventId: 'page-message-4' }),
      ],
      hasMore: true,
    });
    expect(
      manager.getMessageHistoryPage(groupId, 'general', 2, {
        afterTimestamp: Number.NaN,
        afterEventId: 'invalid-cursor',
        repairNetwork: false,
      })
    ).toMatchObject({
      events: [
        expect.objectContaining({ eventId: 'page-message-5' }),
        expect.objectContaining({ eventId: 'page-message-6' }),
      ],
      hasMore: true,
    });
    expect(
      manager.getMessageHistoryPage(groupId, 'general', 2, {
        afterTimestamp: baseTimestamp + 2_000,
        afterEventId: 'page-message-2',
        repairNetwork: false,
      })
    ).toMatchObject({
      events: [
        expect.objectContaining({ eventId: 'page-message-3' }),
        expect.objectContaining({ eventId: 'page-message-4' }),
      ],
      hasMore: true,
    });
    await expect(
      manager.getMessageWindowPageAroundEvent(
        groupId,
        'general',
        'page-message-3',
        { beforeLimit: 1, afterLimit: 1 }
      )
    ).resolves.toMatchObject({
      events: [
        expect.objectContaining({ eventId: 'page-message-2' }),
        expect.objectContaining({ eventId: 'page-message-3' }),
        expect.objectContaining({ eventId: 'page-message-4' }),
      ],
      hasOlder: true,
      hasNewer: true,
    });
    await expect(
      manager.getMessageWindowPageAroundEvent(
        groupId,
        'general',
        'page-message-3',
        { beforeLimit: Number.NaN, afterLimit: Number.NaN }
      )
    ).resolves.toMatchObject({
      events: messages.map((message) =>
        expect.objectContaining({ eventId: message.eventId })
      ),
      hasOlder: false,
      hasNewer: false,
    });
    await expect(
      manager.getMessageWindowAroundEvent(
        groupId,
        'general',
        'page-message-3',
        { beforeLimit: Number.NaN, afterLimit: Number.POSITIVE_INFINITY }
      )
    ).resolves.toEqual(
      messages.map((message) =>
        expect.objectContaining({ eventId: message.eventId })
      )
    );

    manager.close();
  });

  it('revokes renderer-facing cached group access after local membership is removed', async () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const groupId = 991;
    const event = signedEvent({
      eventId: 'departed-group-cached-event',
      groupId,
      timestamp: 100_000,
    });

    manager.setLocalGroupMemberships([groupId]);
    manager.subscribeGroup(groupId);
    expect((manager as any).db.insertEvent(event, true)).toBe(true);
    expect(
      manager.indexSearchText(event.eventId, 'departed group secret')
    ).toBe(true);
    expect(manager.getHistory(groupId, 10)).toContainEqual(
      expect.objectContaining(event)
    );
    await expect(
      manager.searchEvents('departed group secret', { groupIds: [groupId] })
    ).resolves.toHaveLength(1);
    expect(manager.getChatSummaries()).toContainEqual(
      expect.objectContaining({ groupId })
    );

    manager.setLocalGroupMemberships([]);

    expect(() => manager.subscribeGroup(groupId)).toThrow(/not a member/i);
    expect(() => manager.getHistory(groupId, 10)).toThrow(/not a member/i);
    expect(() => manager.getMessageHistory(groupId, 10)).toThrow(
      /not a member/i
    );
    expect(() => manager.getMessageHistoryPage(groupId)).toThrow(
      /not a member/i
    );
    expect(() => manager.getChannelMetadataHistory(groupId)).toThrow(
      /not a member/i
    );
    expect(() => manager.getSyncState(groupId)).toThrow(/not a member/i);
    expect(() => manager.getChannels(groupId)).toThrow(/not a member/i);
    expect(() => manager.getCategories(groupId)).toThrow(/not a member/i);
    expect(() => manager.markRead(groupId, 'general', 100_000)).toThrow(
      /not a member/i
    );
    expect(() => manager.markGroupsRead([groupId])).toThrow(/not a member/i);
    await expect(
      manager.getMessageWindowAroundEvent(groupId, 'general', event.eventId)
    ).rejects.toThrow(/not a member/i);
    await expect(
      manager.getMessageWindowPageAroundEvent(groupId, 'general', event.eventId)
    ).rejects.toThrow(/not a member/i);
    await expect(
      manager.searchEvents('departed group secret', { groupIds: [groupId] })
    ).resolves.toEqual([]);
    expect(manager.getChatSummaries()).toEqual([]);

    manager.close();
  });

  it('serializes group author sequence reservations across shared database instances', () => {
    const dbPath = tempDbPath();
    const first = new ReticulumChatDatabase(dbPath);
    const second = new ReticulumChatDatabase(dbPath);
    const existing = signedEvent({
      eventId: 'existing-author-sequence-399',
      groupId: 992,
      authorSeq: 399,
    });
    expect(first.insertEvent(existing, true)).toBe(true);

    const firstReserved = first.reserveAuthorSequence(
      992,
      existing.authorAddress
    );
    expect(firstReserved.authorStreamId).toMatch(/^[0-9a-f]{32}$/);
    expect(firstReserved.authorSeq).toBe(1);
    expect(() =>
      second.reserveAuthorSequence(992, existing.authorAddress)
    ).toThrow(ReticulumChatSequenceLeaseBusyError);
    expect(
      first.insertEvent(
        {
          ...existing,
          eventId: 'committed-author-sequence-1',
          authorStreamId: firstReserved.authorStreamId,
          authorSeq: firstReserved.authorSeq,
        },
        true
      )
    ).toBe(true);
    const secondReserved = second.reserveAuthorSequence(
      992,
      existing.authorAddress
    );
    expect(secondReserved).toEqual({
      authorStreamId: firstReserved.authorStreamId,
      authorSeq: 2,
    });
    expect(
      second.releaseAuthorSequence(
        992,
        existing.authorAddress,
        secondReserved.authorStreamId,
        secondReserved.authorSeq
      )
    ).toBe(true);
    const reused = second.reserveAuthorSequence(992, existing.authorAddress);
    expect(reused).toEqual(secondReserved);
    expect(
      second.insertEvent(
        {
          ...existing,
          eventId: 'committed-author-sequence-2',
          authorStreamId: reused.authorStreamId,
          authorSeq: reused.authorSeq,
        },
        true
      )
    ).toBe(true);
    expect(
      second.releaseAuthorSequence(
        992,
        existing.authorAddress,
        reused.authorStreamId,
        reused.authorSeq
      )
    ).toBe(false);
    expect(
      first.reserveAuthorSequence(992, existing.authorAddress).authorSeq
    ).toBe(3);

    first.close();
    second.close();
  });

  it('recovers an abandoned group author sequence lease after its timeout', () => {
    const now = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const dbPath = tempDbPath();
    const first = new ReticulumChatDatabase(dbPath);
    const second = new ReticulumChatDatabase(dbPath);
    const authorAddress = 'QabandonedSequenceAuthor';

    const abandoned = first.reserveAuthorSequence(994, authorAddress);
    clock.mockReturnValue(
      now + RETICULUM_CHAT_AUTHOR_SEQUENCE_LEASE_TTL_MS + 1
    );
    expect(second.reserveAuthorSequence(994, authorAddress)).toEqual(abandoned);

    first.close();
    second.close();
    clock.mockRestore();
  });

  it('waits for an in-flight local author sequence instead of failing a concurrent send', async () => {
    const manager = new ReticulumChatManager({ dbPath: tempDbPath() });
    const groupId = 995;
    const authorAddress = 'QconcurrentSequenceAuthor';
    manager.setLocalGroupMemberships([
      { groupId, localAddress: authorAddress },
    ]);

    const first = await manager.reserveAuthorSequence(groupId, authorAddress);
    let secondResolved = false;
    const secondPromise = manager
      .reserveAuthorSequence(groupId, authorAddress)
      .then((reserved) => {
        secondResolved = true;
        return reserved;
      });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(secondResolved).toBe(false);

    expect(
      manager.releaseAuthorSequence(
        groupId,
        authorAddress,
        first.authorStreamId,
        first.authorSeq
      )
    ).toBe(true);
    const second = await secondPromise;
    expect(second).toEqual(first);
    expect(
      manager.releaseAuthorSequence(
        groupId,
        authorAddress,
        second.authorStreamId,
        second.authorSeq
      )
    ).toBe(true);
    manager.close();
  });

  it('allocates independent author streams for the same account on different installations', () => {
    const first = new ReticulumChatDatabase(tempDbPath());
    const second = new ReticulumChatDatabase(tempDbPath());
    const authorAddress = 'QmultiDeviceAuthor';

    const firstReserved = first.reserveAuthorSequence(993, authorAddress);
    const secondReserved = second.reserveAuthorSequence(993, authorAddress);

    expect(firstReserved.authorSeq).toBe(1);
    expect(secondReserved.authorSeq).toBe(1);
    expect(firstReserved.authorStreamId).not.toBe(
      secondReserved.authorStreamId
    );

    first.close();
    second.close();
  });

  it('recovers both installation streams after a recipient reconnects offline', async () => {
    const groupId = 996;
    const providerHash = 'a'.repeat(32);
    const recipientHash = 'b'.repeat(32);
    const identity = createDmIdentity();
    const first = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => providerHash,
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
    });
    const second = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: {
        on: () => undefined,
        off: () => undefined,
        getLocalDestinationHash: () => 'c'.repeat(32),
        fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      } as any,
      validateGroupMember: async () => true,
    });
    let recipient: ReticulumChatManager | null = null;
    const outboundResources = new Map<string, Record<string, any>>();
    const acceptedTransfers = new Set<string>();
    const providerBridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => providerHash,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        wire: ReticulumChatWire
      ) => {
        recipient?.handleWire(wire, providerHash);
        return { ok: true as const };
      },
      sendReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        outboundResources.set(String(payload.transferId), payload);
        return { ok: true as const };
      },
    };
    (first as any).bridge = providerBridge;

    const recipientBridge = {
      on: () => undefined,
      off: () => undefined,
      getLocalDestinationHash: () => recipientHash,
      ensurePeerIdentityKnown: async () => true,
      fanoutReticulumChatDetailed: async () => ({ ok: true as const }),
      sendReticulumChatDetailed: async (
        _peer: string,
        wire: ReticulumChatWire
      ) => {
        first.handleWire(wire, recipientHash);
        return { ok: true as const };
      },
      acceptReticulumChatResourceDetailed: async (
        payload: Record<string, any>
      ) => {
        acceptedTransfers.add(String(payload.transferId || ''));
        return { ok: true as const };
      },
    };
    recipient = new ReticulumChatManager({
      dbPath: tempDbPath(),
      bridge: recipientBridge as any,
      signLocalFields: createDmSigner(identity),
      validateGroupMember: async () => true,
    });
    for (const manager of [first, second, recipient]) {
      manager.setLocalGroupMemberships([
        { groupId, localAddress: identity.address },
      ]);
      manager.subscribeGroup(groupId);
    }

    const signEvent = (
      eventId: string,
      authorStreamId: string,
      authorSeq: number,
      timestamp: number
    ): ReticulumChatEvent => {
      const event: ReticulumChatEvent = {
        eventId,
        groupId,
        channelId: 'general',
        authorAddress: identity.address,
        authorPublicKey: identity.publicKey,
        authorStreamId,
        authorSeq,
        timestamp,
        eventType: 'message',
        encryptedPayload: `ciphertext-${eventId}`,
        payloadHash: hashReticulumChatPayload(`ciphertext-${eventId}`),
        mentionAddressHashes: [],
        signature: '',
      };
      event.signature = base58Encode(
        nacl.sign.detached(
          new Uint8Array(
            canonicalizeForSigning(buildReticulumChatSignedFields(event))
          ),
          identity.secretKey
        )
      );
      return event;
    };

    const firstReservation = await first.reserveAuthorSequence(
      groupId,
      identity.address
    );
    const secondReservation = await second.reserveAuthorSequence(
      groupId,
      identity.address
    );
    expect(firstReservation.authorStreamId).not.toBe(
      secondReservation.authorStreamId
    );
    const firstEvent = signEvent(
      'multi-install-offline-first',
      firstReservation.authorStreamId,
      firstReservation.authorSeq,
      Date.now() - 2_000
    );
    const secondEvent = signEvent(
      'multi-install-offline-second',
      secondReservation.authorStreamId,
      secondReservation.authorSeq,
      Date.now() - 1_000
    );
    expect((await first.publishEvent(firstEvent)).ok).toBe(true);
    expect((await second.publishEvent(secondEvent)).ok).toBe(true);

    // The two online installations exchanged their durable events while the
    // third installation was offline. The provider therefore advertises both
    // independent author streams when that recipient reconnects.
    // Ingest through the manager, exactly as a synced remote event would be,
    // so its digest, author-tree, and state-head caches are updated too.
    expect(await (first as any).acceptEvent(secondEvent, false)).toBe(true);
    expect(recipient.getHistory(groupId, 'general', 10)).toEqual([]);

    // Reconnecting clients announce an active subscription. The provider's
    // immediate bootstrap page must contain events from every installation
    // stream; slower digest/range repair remains only a fallback.
    first.handleWire(
      { t: 'RCHAT', k: 'group_sub', groups: [groupId], mode: 'active' },
      recipientHash
    );
    const deliveredTransfers = new Set<string>();
    await vi.waitUntil(
      () => {
        for (const [transferId, resource] of outboundResources) {
          if (
            deliveredTransfers.has(transferId) ||
            !acceptedTransfers.has(transferId)
          )
            continue;
          deliveredTransfers.add(transferId);
          recipient!.handleResourceEvent({
            status: 'received',
            transferId,
            peerPresenceHash: providerHash,
            path: resource.filePath,
          });
        }
        return recipient!.getHistory(groupId, 'general', 10).length === 2;
      },
      { timeout: 10_000, interval: 10 }
    );
    const recovered = recipient.getHistory(groupId, 'general', 10);
    expect(recovered.map((event) => event.eventId).sort()).toEqual([
      firstEvent.eventId,
      secondEvent.eventId,
    ]);
    expect(new Set(recovered.map((event) => event.authorStreamId))).toEqual(
      new Set([
        firstReservation.authorStreamId,
        secondReservation.authorStreamId,
      ])
    );

    first.close();
    second.close();
    recipient.close();
  }, 15_000);
});

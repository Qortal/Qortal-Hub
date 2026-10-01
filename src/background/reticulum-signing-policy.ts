type SigningSchema = {
  required: readonly string[];
  optional?: readonly string[];
};

const PRESENCE_SIGNING_MAX_BYTES = 256 * 1024;
const RCHAT_SIGNING_MAX_BYTES = 4 * 1024 * 1024;

const schema = (
  required: readonly string[],
  optional: readonly string[] = []
): SigningSchema => ({ required, optional });

const presenceSchemas: Readonly<Record<string, SigningSchema>> = {
  QORTAL_LAND_PROXIMITY_VOICE_SESSION: schema([
    'type',
    'protocolVersion',
    'address',
    'signerPublicKey',
    'ephemeralPublicKey',
    'groupId',
    'landSessionId',
    'destinationHash',
    'instanceId',
    'nonce',
    'createdAt',
    'expiresAt',
  ]),
  QORTAL_LAND_GAME_INVITE: schema([
    'type',
    'protocolVersion',
    'game',
    'gameVersion',
    'rulesVersion',
    'matchId',
    'groupId',
    'requesterAddress',
    'recipientAddress',
    'sourceSessionId',
    'targetSessionId',
    'sourceDestinationHash',
    'targetDestinationHash',
    'signerPublicKey',
    'requesterNonce',
    'linkId',
    'createdAt',
    'expiresAt',
  ]),
  QORTAL_LAND_GAME_ACCEPT: schema([
    'type',
    'inviteHash',
    'matchId',
    'requesterNonce',
    'recipientNonce',
    'responderAddress',
    'signerPublicKey',
    'linkId',
    'createdAt',
  ]),
  QORTAL_LAND_GAME_DECLINE: schema([
    'type',
    'inviteHash',
    'matchId',
    'responderAddress',
    'signerPublicKey',
    'reason',
    'linkId',
    'createdAt',
  ]),
  QORTAL_LAND_GAME_CONFIRM: schema([
    'type',
    'acceptHash',
    'matchId',
    'requesterNonce',
    'recipientNonce',
    'starter',
    'initialStateHash',
    'requesterAddress',
    'signerPublicKey',
    'linkId',
    'createdAt',
  ]),
  QORTAL_LAND_GAME_RESUME_REQUEST: schema([
    'type',
    'matchId',
    'roundId',
    'requesterAddress',
    'signerPublicKey',
    'linkId',
    'sourceSessionId',
    'targetSessionId',
    'sourceDestinationHash',
    'targetDestinationHash',
    'requesterNonce',
    'lastAcknowledgedPly',
    'stateHash',
    'transcriptHash',
    'createdAt',
  ]),
  QORTAL_LAND_GAME_RESUME_ACCEPT: schema([
    'type',
    'matchId',
    'roundId',
    'responderAddress',
    'signerPublicKey',
    'linkId',
    'requesterNonce',
    'recipientNonce',
    'lastAcknowledgedPly',
    'stateHash',
    'transcriptHash',
    'createdAt',
  ]),
  QORTAL_LAND_GAME_RESUME_CONFIRM: schema([
    'type',
    'matchId',
    'roundId',
    'requesterAddress',
    'signerPublicKey',
    'linkId',
    'requesterNonce',
    'recipientNonce',
    'lastAcknowledgedPly',
    'stateHash',
    'transcriptHash',
    'createdAt',
  ]),
  PRESENCE_ANNOUNCE: schema([
    'type',
    'address',
    'clientVersion',
    'publicKey',
    'sessionId',
    'status',
    'timestamp',
  ]),
  PRESENCE_HEARTBEAT: schema([
    'type',
    'address',
    'publicKey',
    'sessionId',
    'status',
    'timestamp',
  ]),
  PRESENCE_OFFLINE: schema([
    'type',
    'address',
    'publicKey',
    'sessionId',
    'timestamp',
  ]),
  CALL_REQUEST: schema([
    'type',
    'callId',
    'chatId',
    'fromAddress',
    'fromPublicKey',
    'timestamp',
  ]),
  CALL_ACCEPT: schema(['type', 'callId', 'timestamp']),
  // `reason` is optional so current clients can authenticate a specific
  // rejection while retaining the legacy reason-less signature for older
  // callers.
  CALL_REJECT: schema(['type', 'callId', 'timestamp'], ['reason']),
  CALL_HANGUP: schema(['type', 'callId', 'timestamp']),
  // WebRTC SDP/ICE payloads are transported separately. The wallet signs
  // only this bounded digest envelope so negotiation remains authenticated
  // without exposing the payload to the signing policy.
  CALL_RTC_SIGNAL: schema([
    'type',
    'callId',
    'generation',
    'signalId',
    'signalType',
    'payloadHash',
    'timestamp',
  ]),
  QCHAT_FILE_LINK_AUTH: schema([
    'type',
    'transferId',
    'senderAddress',
    'downloaderAddress',
    'downloaderPublicKey',
    'downloaderReticulumDestinationHash',
    'downloaderReticulumIdentityPublicKeyBase64',
    'timestamp',
  ]),
  GC_JOIN: schema(
    [
      'type',
      'roomId',
      'chatId',
      'fromAddress',
      'fromPublicKey',
      'timestamp',
      'reticulumDestinationHash',
    ],
    ['joinGeneration']
  ),
  GC_JOIN_RK: schema(
    [
      'type',
      'roomId',
      'chatId',
      'fromAddress',
      'fromPublicKey',
      'timestamp',
      'reticulumDestinationHash',
      'reticulumIdentityPublicKeyBase64',
    ],
    ['joinGeneration']
  ),
  GC_LEAVE: schema([
    'type',
    'roomId',
    'fromAddress',
    'fromPublicKey',
    'timestamp',
  ]),
  GC_TOPOLOGY: schema([
    'type',
    'roomId',
    'topologyEpoch',
    'rootForwarder',
    'standbyForwarder',
    'fromAddress',
    'fromPublicKey',
    'timestamp',
  ]),
  GC_CLUSTER_HEARTBEAT: schema([
    'type',
    'roomId',
    'topologyEpoch',
    'clusterForwarder',
    'clusterIndex',
    'seq',
    'fromAddress',
    'fromPublicKey',
    'timestamp',
  ]),
  GC_KEY: schema([
    'type',
    'roomId',
    'toAddress',
    'fromAddress',
    'fromPublicKey',
    'keyMessageVersion',
    'callSessionId',
    'mediaSessionGeneration',
    'keyCommitment',
    'encryptedKeyDigest',
    'timestamp',
  ]),
  GC_KEY_REQUEST: schema([
    'type',
    'roomId',
    'toAddress',
    'fromAddress',
    'fromPublicKey',
    'callSessionId',
    'mediaSessionGeneration',
    'keyMessageVersion',
    'timestamp',
  ]),
  // Group-call WebRTC SDP/ICE remains outside the wallet signer. As with
  // direct calls, only the bounded routing and payload-digest envelope is
  // signed so peers can authenticate negotiation received over Reticulum.
  GC_RTC_SIGNAL: schema([
    'type',
    'roomId',
    'callSessionId',
    'mediaSessionGeneration',
    'fromAddress',
    'toAddress',
    'connectionId',
    'signalId',
    'signalType',
    'payloadHash',
    'fromPublicKey',
    'timestamp',
  ]),
};

const rchatSchemas: Readonly<Record<string, SigningSchema>> = {
  RETICULUM_CALENDAR_MUTATION_V1: schema([
    'type',
    'version',
    'mutationId',
    'operation',
    'eventId',
    'groupId',
    'timestamp',
    'state',
  ]),
  QORTAL_LAND_CALL_V2: schema([
    'type',
    'groupId',
    'callType',
    'callId',
    'toAddress',
    'sourceSessionId',
    'targetSessionId',
    'sourceDestinationHash',
    'targetDestinationHash',
    'reason',
    'roomId',
    'timestamp',
  ]),
  QORTAL_LAND_SESSION_ROUTE_V1: schema([
    'type',
    'groupId',
    'sessionId',
    'destinationHash',
    'timestamp',
    'expiresAt',
  ]),
  QORTAL_LAND_AUTH: schema([
    'type',
    'ephemeralPublicKey',
    'groupId',
    'sessionId',
    'timestamp',
  ]),
  RCHAT_EVENT_NOTICE_V3: schema([
    'type',
    'eventId',
    'groupId',
    'sourcePeerHash',
    'authorAddress',
    'authorPublicKey',
  ]),
  RCHAT_DM_REQ: schema([
    'type',
    'peerAddress',
    'after',
    'limit',
    'requestId',
    'requesterPeerHash',
    'timestamp',
  ]),
  RCHAT_HISTORY_PAGE_REQ: schema(
    [
      'type',
      'groupId',
      'channelId',
      'direction',
      'after',
      'before',
      'includeCursor',
      'limit',
      'timestamp',
    ],
    ['priority']
  ),
  RCHAT_DM_NOTIFY: schema([
    'type',
    'peerAddress',
    'sourcePeerHash',
    'requestId',
    'latestCursor',
    'probeRequestId',
    'maxHops',
    'timestamp',
  ]),
  RCHAT_DM_PROBE: schema(['type', 'requestId', 'maxHops', 'timestamp']),
  RCHAT_READ_SYNC_V1: schema(
    ['type', 'scopeType', 'ownerAddress', 'upToTimestamp', 'signedAt'],
    ['groupId', 'channelId', 'conversationId', 'peerAddress']
  ),
  RCHAT_DIRECT_CALL_HISTORY_V1: schema([
    'type',
    'ownerAddress',
    'callId',
    'peerAddress',
    'direction',
    'outcome',
    'startedAt',
    'endedAt',
    'updatedAt',
  ]),
  RCHAT_METADATA_SNAPSHOT: schema([
    'type',
    'createdAt',
    'groupId',
    'latestEventId',
    'latestFeedTimestamp',
    'snapshotHash',
    'snapshotId',
    'scope',
    'parentSnapshotHash',
    'version',
  ]),
  RCHAT_METADATA_SNAPSHOT_REQ: schema([
    'type',
    'groupId',
    'snapshotHash',
    'timestamp',
  ]),
  RCHAT_STATE_HEADS_REQ: schema([
    'type',
    'groupId',
    'cursor',
    'limit',
    'timestamp',
  ]),
  RCHAT_EVENT_REQ: schema(['type', 'eventId', 'groupId', 'timestamp']),
  RCHAT_RANGE_REQ: schema([
    'type',
    'groupId',
    'ranges',
    'limit',
    'sourcePeerHash',
    'timestamp',
  ]),
  RCHAT_LINKED_EVENT_REQUEST: schema([
    'type',
    'transferId',
    'eventId',
    'groupId',
    'requesterPeerHash',
    'providerPeerHash',
    'timestamp',
  ]),
  RCHAT_LINKED_AUTHOR_RANGE_REQUEST: schema([
    'type',
    'transferId',
    'groupId',
    'range',
    'limit',
    'requesterPeerHash',
    'providerPeerHash',
    'timestamp',
  ]),
  RCHAT_RESOURCE_AUTH: schema(['type', 'groupId', 'timestamp', 'transferId']),
  RCHAT_GROUP_KEY_DIGEST: schema([
    'type',
    'epoch',
    'groupId',
    'keyId',
    'timestamp',
  ]),
  RCHAT_GROUP_KEY_REQ: schema([
    'type',
    'epoch',
    'groupId',
    'keyId',
    'requestId',
    'timestamp',
  ]),
  RCHAT_GROUP_KEY_RES: schema([
    'type',
    'epoch',
    'groupId',
    'keyBytesBase64',
    'keyId',
    'requestId',
    'timestamp',
  ]),
  RCHAT_RESOURCE_REQ: schema([
    'type',
    'eventId',
    'fileHash',
    'byteRanges',
    'groupId',
    'timestamp',
  ]),
  RCHAT_RESOURCE_FIND: schema([
    'type',
    'expiresAt',
    'fileHash',
    'groupId',
    'maxHops',
    'requestId',
    'sizeBytes',
    'timestamp',
  ]),
  RCHAT_DM_RESOURCE_FIND: schema([
    'type',
    'conversationId',
    'peerAddress',
    'requestId',
    'fileHash',
    'sizeBytes',
    'maxHops',
    'expiresAt',
    'timestamp',
  ]),
  RCHAT_DM_RESOURCE_REQ: schema([
    'type',
    'conversationId',
    'peerAddress',
    'fileHash',
    'byteRanges',
    'requestId',
    'requesterPeerHash',
    'timestamp',
  ]),
};

const p2pChatSchema = schema(
  [
    'authorAddress',
    'authorPublicKey',
    'chatId',
    'content',
    'eventType',
    'id',
    'seq',
    'timestamp',
  ],
  ['targetId', 'replyTo', 'attachmentMeta', 'attachmentDataHash']
);

const groupEventSchema = schema(
  [
    'eventId',
    'groupId',
    'channelId',
    'authorStreamId',
    'authorSeq',
    'timestamp',
    'eventType',
    'targetEventId',
    'replyToEventId',
    'encryptedPayload',
    'payloadHash',
    'mentionAddressHashes',
  ],
  ['mentionTargets']
);

const directEventSchema = schema([
  'conversationId',
  'eventId',
  'eventType',
  'payload',
  'payloadHash',
  'recipientAddress',
  'replyToEventId',
  'senderSeq',
  'targetEventId',
  'timestamp',
]);

const directEventStreamSchema = schema([
  'conversationId',
  'eventId',
  'eventType',
  'payload',
  'payloadHash',
  'recipientAddress',
  'replyToEventId',
  'senderSeq',
  'senderStreamId',
  'targetEventId',
  'timestamp',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function matchesSchema(
  payload: Record<string, unknown>,
  candidate: SigningSchema
): boolean {
  const allowed = new Set([
    ...candidate.required,
    ...(candidate.optional ?? []),
  ]);
  const keys = Object.keys(payload);
  return (
    candidate.required.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(payload, key) &&
        payload[key] !== undefined
    ) && keys.every((key) => allowed.has(key))
  );
}

function serializedSize(payload: Record<string, unknown>): number {
  const serialized = JSON.stringify(payload);
  if (typeof serialized !== 'string')
    throw new Error('Signing payload is not serializable');
  return new TextEncoder().encode(serialized).byteLength;
}

function assertSafeObjectGraph(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('Signing payload nesting is too deep');
  if (value == null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Signing payload contains a non-finite number');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 4_096)
      throw new Error('Signing payload array is too large');
    for (const item of value) assertSafeObjectGraph(item, depth + 1);
    return;
  }
  if (!isRecord(value))
    throw new Error('Signing payload contains an unsupported value');
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error('Signing payload contains a forbidden key');
    }
    assertSafeObjectGraph(child, depth + 1);
  }
}

const GAME_HANDSHAKE_PREFIX = 'QORTAL_LAND_GAME_';
const GAME_HEX_BYTES: Readonly<Record<string, number>> = {
  acceptHash: 32,
  initialStateHash: 32,
  inviteHash: 32,
  linkId: 16,
  recipientNonce: 16,
  requesterNonce: 16,
  stateHash: 32,
  transcriptHash: 32,
  sourceDestinationHash: 16,
  targetDestinationHash: 16,
};

function assertSafeGameHandshake(payload: Record<string, unknown>): void {
  if (serializedSize(payload) > 4 * 1024) {
    throw new Error('Game handshake payload is too large');
  }
  for (const [key, value] of Object.entries(payload)) {
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      typeof value === 'boolean'
    ) {
      throw new Error(`Game handshake field is not scalar: ${key}`);
    }
    if (typeof value === 'string' && value.length > 256) {
      throw new Error(`Game handshake field is too long: ${key}`);
    }
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new Error(`Game handshake field is not an integer: ${key}`);
    }
  }
  if (
    typeof payload.matchId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.matchId
    )
  ) {
    throw new Error('Game handshake matchId is invalid');
  }
  for (const [key, byteLength] of Object.entries(GAME_HEX_BYTES)) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (
      typeof value !== 'string' ||
      !new RegExp(`^[0-9a-f]{${byteLength * 2}}$`, 'i').test(value)
    ) {
      throw new Error(`Game handshake binary field is invalid: ${key}`);
    }
  }
  for (const key of [
    'requesterAddress',
    'recipientAddress',
    'responderAddress',
    'signerPublicKey',
  ]) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (
      typeof value !== 'string' ||
      value.length < 20 ||
      value.length > 64 ||
      !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)
    ) {
      throw new Error(`Game handshake identity field is invalid: ${key}`);
    }
  }
  for (const key of ['createdAt', 'expiresAt']) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (typeof value !== 'number' || value < 0) {
      throw new Error(`Game handshake timestamp is invalid: ${key}`);
    }
  }
  if ('lastAcknowledgedPly' in payload) {
    const ply = payload.lastAcknowledgedPly;
    if (typeof ply !== 'number' || ply < 0 || ply > 600) {
      throw new Error('Game handshake ply is invalid');
    }
  }
  if (payload.type === 'QORTAL_LAND_GAME_INVITE') {
    if (
      payload.protocolVersion !== 2 ||
      !['connect-four', 'checkers', 'chess'].includes(String(payload.game)) ||
      payload.gameVersion !== 1 ||
      payload.rulesVersion !== 1 ||
      typeof payload.groupId !== 'string' ||
      payload.groupId.length === 0 ||
      payload.groupId.length > 64 ||
      typeof payload.sourceSessionId !== 'string' ||
      payload.sourceSessionId.length === 0 ||
      payload.sourceSessionId.length > 16 ||
      typeof payload.targetSessionId !== 'string' ||
      payload.targetSessionId.length === 0 ||
      payload.targetSessionId.length > 16
    ) {
      throw new Error('Game invitation version or group is invalid');
    }
  }
  if (
    'reason' in payload &&
    !['declined', 'busy', 'superseded'].includes(String(payload.reason))
  ) {
    throw new Error('Game decline reason is invalid');
  }
  if (
    'starter' in payload &&
    !['requester', 'recipient'].includes(String(payload.starter))
  ) {
    throw new Error('Game starter is invalid');
  }
}

function assertSafeProximityCapability(payload: Record<string, unknown>): void {
  const now = Date.now();
  if (
    payload.protocolVersion !== 1 ||
    typeof payload.address !== 'string' ||
    payload.address.length < 20 ||
    payload.address.length > 64 ||
    typeof payload.signerPublicKey !== 'string' ||
    payload.signerPublicKey.length < 20 ||
    payload.signerPublicKey.length > 64 ||
    typeof payload.ephemeralPublicKey !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(payload.ephemeralPublicKey) ||
    typeof payload.nonce !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(payload.nonce) ||
    typeof payload.groupId !== 'string' ||
    !/^\d{1,10}$/.test(payload.groupId) ||
    Number(payload.groupId) < 1 ||
    Number(payload.groupId) > 0x7fffffff ||
    typeof payload.landSessionId !== 'string' ||
    payload.landSessionId.length < 1 ||
    payload.landSessionId.length > 24 ||
    typeof payload.destinationHash !== 'string' ||
    !/^[0-9a-f]{32}$/i.test(payload.destinationHash) ||
    typeof payload.instanceId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.instanceId
    ) ||
    typeof payload.createdAt !== 'number' ||
    !Number.isSafeInteger(payload.createdAt) ||
    typeof payload.expiresAt !== 'number' ||
    !Number.isSafeInteger(payload.expiresAt) ||
    Math.abs(payload.createdAt - now) > 2 * 60 * 1000 ||
    payload.expiresAt <= payload.createdAt ||
    payload.expiresAt - payload.createdAt > 4 * 60 * 60 * 1000
  ) {
    throw new Error('Proximity voice session capability is invalid');
  }
}

function assertSafeGroupRtcSignal(payload: Record<string, unknown>): void {
  const now = Date.now();
  const isBoundedString = (key: string, maxLength: number): boolean =>
    typeof payload[key] === 'string' &&
    String(payload[key]).length > 0 &&
    String(payload[key]).length <= maxLength;
  const isQortalIdentity = (key: string): boolean =>
    isBoundedString(key, 64) &&
    String(payload[key]).length >= 20 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(String(payload[key]));
  const expectedConnectionId = `${String(payload.callSessionId)}:${String(
    payload.mediaSessionGeneration
  )}:${[String(payload.fromAddress), String(payload.toAddress)]
    .sort()
    .join(':')}`;

  if (
    !isBoundedString('roomId', 128) ||
    !isBoundedString('callSessionId', 128) ||
    typeof payload.mediaSessionGeneration !== 'number' ||
    !Number.isSafeInteger(payload.mediaSessionGeneration) ||
    payload.mediaSessionGeneration < 0 ||
    payload.mediaSessionGeneration > 0xffffffff ||
    !isQortalIdentity('fromAddress') ||
    !isQortalIdentity('toAddress') ||
    !isBoundedString('connectionId', 160) ||
    payload.connectionId !== expectedConnectionId ||
    typeof payload.signalId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.signalId
    ) ||
    ![
      'capability',
      'offer',
      'answer',
      'candidate',
      'candidates',
      'ack',
      'reconnect',
    ].includes(String(payload.signalType)) ||
    typeof payload.payloadHash !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(payload.payloadHash) ||
    !isQortalIdentity('fromPublicKey') ||
    typeof payload.timestamp !== 'number' ||
    !Number.isSafeInteger(payload.timestamp) ||
    Math.abs(payload.timestamp - now) > 2 * 60 * 1000
  ) {
    throw new Error('Group WebRTC signal envelope is invalid');
  }
}

function assertSafeRchatRangeRequest(payload: Record<string, unknown>): void {
  const ranges = payload.ranges;
  if (
    !Number.isSafeInteger(payload.groupId) ||
    Number(payload.groupId) <= 0 ||
    !Number.isSafeInteger(payload.limit) ||
    Number(payload.limit) < 1 ||
    Number(payload.limit) > 100 ||
    typeof payload.sourcePeerHash !== 'string' ||
    !/^[0-9a-f]{32}$/iu.test(payload.sourcePeerHash) ||
    !Number.isSafeInteger(payload.timestamp) ||
    Number(payload.timestamp) <= 0 ||
    !Array.isArray(ranges) ||
    ranges.length < 1 ||
    ranges.length > 100
  ) {
    throw new Error('Reticulum author range request is invalid');
  }
  for (const range of ranges) {
    if (!isRecord(range)) {
      throw new Error('Reticulum author range request is invalid');
    }
    const keys = Object.keys(range).sort();
    if (
      keys.length !== 4 ||
      keys[0] !== 'a' ||
      keys[1] !== 'from' ||
      keys[2] !== 's' ||
      keys[3] !== 'to' ||
      typeof range.a !== 'string' ||
      range.a.length < 20 ||
      range.a.length > 64 ||
      !/^[1-9A-HJ-NP-Za-km-z]+$/u.test(range.a) ||
      typeof range.s !== 'string' ||
      !/^[0-9a-f]{32}$/iu.test(range.s) ||
      !Number.isSafeInteger(range.from) ||
      Number(range.from) <= 0 ||
      !Number.isSafeInteger(range.to) ||
      Number(range.to) < Number(range.from)
    ) {
      throw new Error('Reticulum author range request is invalid');
    }
  }
}

function assertPayload(
  payload: unknown,
  schemas: Readonly<Record<string, SigningSchema>>,
  untypedSchemas: readonly SigningSchema[],
  maxBytes: number
): asserts payload is Record<string, unknown> {
  if (!isRecord(payload)) throw new Error('Signing payload must be an object');
  assertSafeObjectGraph(payload);
  if (serializedSize(payload) > maxBytes)
    throw new Error('Signing payload is too large');

  const type = typeof payload.type === 'string' ? payload.type : '';
  if (type) {
    const candidate = schemas[type];
    if (!candidate || !matchesSchema(payload, candidate)) {
      throw new Error(`Signing payload type is not allowed: ${type}`);
    }
    if (type.startsWith(GAME_HANDSHAKE_PREFIX)) {
      assertSafeGameHandshake(payload);
    }
    if (type === 'QORTAL_LAND_PROXIMITY_VOICE_SESSION') {
      assertSafeProximityCapability(payload);
    }
    if (type === 'GC_RTC_SIGNAL') {
      assertSafeGroupRtcSignal(payload);
    }
    return;
  }
  if (!untypedSchemas.some((candidate) => matchesSchema(payload, candidate))) {
    throw new Error('Untyped signing payload schema is not allowed');
  }
}

export function assertAllowedPresenceSigningPayload(
  payload: unknown
): asserts payload is Record<string, unknown> {
  assertPayload(
    payload,
    presenceSchemas,
    [p2pChatSchema],
    PRESENCE_SIGNING_MAX_BYTES
  );
  if (
    payload.type === 'CALL_REJECT' &&
    'reason' in payload &&
    (typeof payload.reason !== 'string' || payload.reason.length > 32)
  ) {
    throw new Error('Call rejection reason is invalid');
  }
  if (payload.type === 'CALL_RTC_SIGNAL') {
    const now = Date.now();
    if (
      typeof payload.callId !== 'string' ||
      payload.callId.length < 1 ||
      payload.callId.length > 64 ||
      typeof payload.generation !== 'string' ||
      !/^[A-Za-z0-9_-]{8,64}$/u.test(payload.generation) ||
      typeof payload.signalId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,24}$/u.test(payload.signalId) ||
      !['capability', 'offer', 'answer', 'candidate'].includes(
        String(payload.signalType)
      ) ||
      typeof payload.payloadHash !== 'string' ||
      !/^[0-9a-f]{64}$/iu.test(payload.payloadHash) ||
      typeof payload.timestamp !== 'number' ||
      !Number.isSafeInteger(payload.timestamp) ||
      now - payload.timestamp > 30_000 ||
      now - payload.timestamp < -10_000
    ) {
      throw new Error('WebRTC signal signing envelope is invalid');
    }
  }
  if (
    typeof payload.type === 'string' &&
    payload.type.startsWith('QORTAL_LAND_GAME_') &&
    serializedSize(payload) > 4 * 1024
  ) {
    throw new Error('Game handshake signing payload is too large');
  }
}

export function assertAllowedReticulumSigningPayload(
  payload: unknown
): asserts payload is Record<string, unknown> {
  if (
    payload &&
    typeof payload === 'object' &&
    (payload as Record<string, unknown>).type === 'masque-ticket-issue-v1'
  ) {
    const p = payload as Record<string, unknown>;
    if (
      Object.keys(p).sort().join(',') !==
        'binding,expiresAt,nonce,policy,relayPin,type' ||
      ['binding', 'nonce', 'policy', 'relayPin'].some(
        (key) =>
          typeof p[key] !== 'string' || !/^[a-f0-9]{64}$/.test(p[key] as string)
      ) ||
      !Number.isSafeInteger(p.expiresAt) ||
      Number(p.expiresAt) <= Date.now() ||
      Number(p.expiresAt) > Date.now() + 65_000
    ) {
      throw new Error('Invalid relay authorization proof');
    }
    return;
  }
  assertPayload(
    payload,
    rchatSchemas,
    [groupEventSchema, directEventSchema, directEventStreamSchema],
    RCHAT_SIGNING_MAX_BYTES
  );
  if (payload.type === 'RCHAT_RANGE_REQ') {
    assertSafeRchatRangeRequest(payload);
  }
}

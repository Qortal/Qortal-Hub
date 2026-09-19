import { describe, expect, it } from 'vitest';
import {
  assertAllowedPresenceSigningPayload,
  assertAllowedReticulumSigningPayload,
} from './reticulum-signing-policy';

function expectAllowed(
  validator: (payload: unknown) => void,
  payload: Record<string, unknown>
): void {
  expect(() => validator(payload)).not.toThrow();
}

describe('Reticulum wallet signing policy', () => {
  it('accepts only the exact fresh relay authorization domain', () => {
    const challenge = {
      type: 'masque-ticket-issue-v1',
      binding: 'ab'.repeat(32),
      nonce: 'cd'.repeat(32),
      policy: 'ef'.repeat(32),
      relayPin: '12'.repeat(32),
      expiresAt: Date.now() + 10_000,
    };
    expectAllowed(assertAllowedReticulumSigningPayload, challenge);
    for (const invalid of [
      { ...challenge, extra: 'injected' },
      { ...challenge, expiresAt: 1 },
      { ...challenge, expiresAt: Date.now() + 120_000 },
      { ...challenge, type: 'masque-relay-auth-v1' },
      { ...challenge, binding: 'short' },
    ]) {
      expect(() => assertAllowedReticulumSigningPayload(invalid)).toThrow();
    }
  });
  it('allows only an exact, short-lived Qortal Land proximity capability', () => {
    const now = Date.now();
    const capability = {
      type: 'QORTAL_LAND_PROXIMITY_VOICE_SESSION',
      protocolVersion: 1,
      address: 'QhxqB8rvXYDguai48oNNjfRCUigaXHmf8Q',
      signerPublicKey: '1thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE',
      ephemeralPublicKey: '11'.repeat(32),
      groupId: '123',
      landSessionId: 'land-session',
      destinationHash: 'aa'.repeat(16),
      instanceId: '00112233-4455-4677-8899-aabbccddeeff',
      nonce: '22'.repeat(32),
      createdAt: now,
      expiresAt: now + 4 * 60 * 60 * 1000,
    };
    expectAllowed(assertAllowedPresenceSigningPayload, capability);
    expect(() =>
      assertAllowedPresenceSigningPayload({ ...capability, audio: 'bytes' })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({ ...capability, protocolVersion: 2 })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({ ...capability, nonce: 'short' })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        ...capability,
        destinationHash: 'short',
      })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        ...capability,
        groupId: '2147483648',
      })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        ...capability,
        expiresAt: now + 5 * 60 * 60 * 1000,
      })
    ).toThrow();
  });

  it('allows only the exact Qortal Land game handshake schemas', () => {
    const invite = {
      type: 'QORTAL_LAND_GAME_INVITE',
      protocolVersion: 2,
      game: 'connect-four',
      gameVersion: 1,
      rulesVersion: 1,
      matchId: '00112233-4455-4677-8899-aabbccddeeff',
      groupId: '123',
      requesterAddress: 'QhxqB8rvXYDguai48oNNjfRCUigaXHmf8Q',
      recipientAddress: 'QhxqB8rvXYDguai48oNNjfRCUigaXHmf8Q',
      sourceSessionId: 'source-session',
      targetSessionId: 'target-session',
      sourceDestinationHash: '33'.repeat(16),
      targetDestinationHash: '44'.repeat(16),
      signerPublicKey: '1thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE',
      requesterNonce: '11'.repeat(16),
      linkId: '22'.repeat(16),
      createdAt: 1,
      expiresAt: 2,
    };
    expectAllowed(assertAllowedPresenceSigningPayload, invite);
    expectAllowed(assertAllowedPresenceSigningPayload, {
      ...invite,
      game: 'checkers',
    });
    expectAllowed(assertAllowedPresenceSigningPayload, {
      ...invite,
      game: 'chess',
    });
    expect(() =>
      assertAllowedPresenceSigningPayload({ ...invite, game: 'backgammon' })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({ ...invite, move: 3 })
    ).toThrow();
    const { linkId: _linkId, ...missing } = invite;
    expect(() => assertAllowedPresenceSigningPayload(missing)).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        type: 'QORTAL_LAND_GAME_MOVE',
        matchId: 'm',
        column: 3,
      })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        ...invite,
        signerPublicKey: { value: invite.signerPublicKey },
      })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        ...invite,
        groupId: 'x'.repeat(5_000),
      })
    ).toThrow();
    const resume = {
      type: 'QORTAL_LAND_GAME_RESUME_REQUEST',
      matchId: invite.matchId,
      roundId: '11112233-4455-4677-8899-aabbccddeeff',
      requesterAddress: invite.requesterAddress,
      signerPublicKey: invite.signerPublicKey,
      linkId: invite.linkId,
      sourceSessionId: invite.sourceSessionId,
      targetSessionId: invite.targetSessionId,
      sourceDestinationHash: invite.sourceDestinationHash,
      targetDestinationHash: invite.targetDestinationHash,
      requesterNonce: '33'.repeat(16),
      lastAcknowledgedPly: 4,
      stateHash: '44'.repeat(32),
      transcriptHash: '55'.repeat(32),
      createdAt: 3,
    };
    expectAllowed(assertAllowedPresenceSigningPayload, resume);
    const { roundId: _roundId, ...resumeWithoutRound } = resume;
    expect(() =>
      assertAllowedPresenceSigningPayload(resumeWithoutRound)
    ).toThrow();
  });
  it('allows every current presence, call, and file-auth control type', () => {
    const now = Date.now();
    const address = 'QhxqB8rvXYDguai48oNNjfRCUigaXHmf8Q';
    const peerAddress = 'QaU2XUB6iMgM9YUJnYRkxwVKJd322hJh91';
    const publicKey = '1thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE';
    const rtcSignal = {
      type: 'GC_RTC_SIGNAL',
      roomId: 'gcall-qortal-1144',
      callSessionId: '00112233-4455-4677-8899-aabbccddeeff',
      mediaSessionGeneration: 1,
      fromAddress: address,
      toAddress: peerAddress,
      connectionId: `00112233-4455-4677-8899-aabbccddeeff:1:${[
        address,
        peerAddress,
      ]
        .sort()
        .join(':')}`,
      signalId: '11112233-4455-4677-8899-aabbccddeeff',
      signalType: 'offer',
      payloadHash: 'ab'.repeat(32),
      fromPublicKey: publicKey,
      timestamp: now,
    };
    const payloads: Record<string, unknown>[] = [
      {
        type: 'PRESENCE_ANNOUNCE',
        address: 'a',
        clientVersion: '1',
        publicKey: 'p',
        sessionId: 's',
        status: 'online',
        timestamp: 1,
      },
      {
        type: 'PRESENCE_HEARTBEAT',
        address: 'a',
        publicKey: 'p',
        sessionId: 's',
        status: 'online',
        timestamp: 1,
      },
      {
        type: 'PRESENCE_OFFLINE',
        address: 'a',
        publicKey: 'p',
        sessionId: 's',
        timestamp: 1,
      },
      {
        type: 'CALL_REQUEST',
        callId: 'c',
        chatId: 'd',
        fromAddress: 'a',
        fromPublicKey: 'p',
        timestamp: 1,
      },
      { type: 'CALL_ACCEPT', callId: 'c', timestamp: 1 },
      { type: 'CALL_REJECT', callId: 'c', timestamp: 1 },
      { type: 'CALL_REJECT', callId: 'c', reason: 'not_friend', timestamp: 1 },
      { type: 'CALL_HANGUP', callId: 'c', timestamp: 1 },
      {
        type: 'QCHAT_FILE_LINK_AUTH',
        transferId: 'x',
        senderAddress: 'a',
        downloaderAddress: 'b',
        downloaderPublicKey: 'p',
        downloaderReticulumDestinationHash: 'd',
        downloaderReticulumIdentityPublicKeyBase64: 'r',
        timestamp: 1,
      },
      {
        type: 'GC_JOIN',
        roomId: 'r',
        chatId: 'c',
        fromAddress: 'a',
        fromPublicKey: 'p',
        timestamp: 1,
        reticulumDestinationHash: 'd',
        joinGeneration: 1,
      },
      {
        type: 'GC_JOIN',
        roomId: 'r',
        chatId: 'c',
        fromAddress: 'a',
        fromPublicKey: 'p',
        timestamp: 1,
        reticulumDestinationHash: 'd',
      },
      {
        type: 'GC_JOIN_RK',
        roomId: 'r',
        chatId: 'c',
        fromAddress: 'a',
        fromPublicKey: 'p',
        timestamp: 1,
        reticulumDestinationHash: 'd',
        reticulumIdentityPublicKeyBase64: 'k',
        joinGeneration: 1,
      },
      {
        type: 'GC_JOIN_RK',
        roomId: 'r',
        chatId: 'c',
        fromAddress: 'a',
        fromPublicKey: 'p',
        timestamp: 1,
        reticulumDestinationHash: 'd',
        reticulumIdentityPublicKeyBase64: 'k',
      },
      {
        type: 'GC_LEAVE',
        roomId: 'r',
        fromAddress: 'a',
        fromPublicKey: 'p',
        timestamp: 1,
      },
      {
        type: 'GC_TOPOLOGY',
        roomId: 'r',
        topologyEpoch: 1,
        rootForwarder: 'a',
        standbyForwarder: 'b',
        fromAddress: 'a',
        fromPublicKey: 'p',
        timestamp: 1,
      },
      {
        type: 'GC_CLUSTER_HEARTBEAT',
        roomId: 'r',
        topologyEpoch: 1,
        clusterForwarder: 'a',
        clusterIndex: 0,
        seq: 1,
        fromAddress: 'a',
        fromPublicKey: 'p',
        timestamp: 1,
      },
      {
        type: 'GC_KEY',
        roomId: 'r',
        toAddress: 'b',
        fromAddress: 'a',
        fromPublicKey: 'p',
        keyMessageVersion: 1,
        callSessionId: 'c',
        mediaSessionGeneration: 1,
        keyCommitment: 'k',
        encryptedKeyDigest: 'e',
        timestamp: 1,
      },
      {
        type: 'GC_KEY_REQUEST',
        roomId: 'r',
        toAddress: 'b',
        fromAddress: 'a',
        fromPublicKey: 'p',
        callSessionId: 'c',
        mediaSessionGeneration: 1,
        keyMessageVersion: 1,
        timestamp: 1,
      },
      rtcSignal,
    ];
    for (const payload of payloads) {
      expectAllowed(assertAllowedPresenceSigningPayload, payload);
    }
    expectAllowed(assertAllowedPresenceSigningPayload, {
      ...rtcSignal,
      signalType: 'candidates',
    });
    expectAllowed(assertAllowedPresenceSigningPayload, {
      ...rtcSignal,
      signalType: 'ack',
    });
    expect(() =>
      assertAllowedPresenceSigningPayload({
        type: 'CALL_REJECT',
        callId: 'c',
        reason: 'x'.repeat(33),
        timestamp: 1,
      })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        ...rtcSignal,
        signalType: 'audio',
      })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        ...rtcSignal,
        payloadHash: 'not-a-digest',
      })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        ...rtcSignal,
        connectionId: 'different-edge',
      })
    ).toThrow();
  });

  it('allows the current untyped P2P chat event schema', () => {
    expectAllowed(assertAllowedPresenceSigningPayload, {
      authorAddress: 'a',
      authorPublicKey: 'p',
      chatId: 'c',
      content: 'hello',
      eventType: 'message',
      id: 'i',
      seq: 1,
      timestamp: 1,
    });
    expectAllowed(assertAllowedPresenceSigningPayload, {
      authorAddress: 'a',
      authorPublicKey: 'p',
      chatId: 'c',
      content: 'hello',
      eventType: 'message',
      id: 'i',
      seq: 1,
      timestamp: 1,
      replyTo: 'parent',
      attachmentMeta: { name: 'image.png', size: 10 },
      attachmentDataHash: 'hash',
    });
  });

  it('allows every current typed RCHAT control schema', () => {
    const payloads: Record<string, unknown>[] = [
      {
        type: 'QORTAL_LAND_AUTH',
        ephemeralPublicKey: 'p',
        groupId: 1,
        sessionId: 's',
        timestamp: 1,
      },
      {
        type: 'QORTAL_LAND_SESSION_ROUTE_V1',
        groupId: 1,
        sessionId: 's',
        destinationHash: 'a'.repeat(32),
        timestamp: 1,
        expiresAt: 2,
      },
      {
        type: 'QORTAL_LAND_CALL_V2',
        groupId: 1,
        callType: 'request',
        callId: 'call-12345678',
        toAddress: 'b',
        sourceSessionId: 'source',
        targetSessionId: 'target',
        sourceDestinationHash: 'a'.repeat(32),
        targetDestinationHash: 'b'.repeat(32),
        reason: '',
        roomId: 'lounge',
        timestamp: 1,
      },
      {
        type: 'RCHAT_EVENT_NOTICE_V3',
        eventId: 'e',
        groupId: 1,
        sourcePeerHash: 'h',
        authorAddress: 'a',
        authorPublicKey: 'p',
      },
      {
        type: 'RETICULUM_CALENDAR_MUTATION_V1',
        version: 1,
        mutationId: '00000000-0000-4000-8000-000000000001',
        operation: 'upsert',
        eventId: '00000000-0000-4000-8000-000000000002',
        groupId: 1,
        timestamp: 1,
        state: {
          title: 'Planning',
          startLocal: '2026-08-10T10:00:00',
          endLocal: '2026-08-10T11:00:00',
        },
      },
      {
        type: 'RCHAT_DM_REQ',
        peerAddress: 'b',
        after: 0,
        limit: 10,
        requestId: 'r',
        requesterPeerHash: 'h',
        timestamp: 1,
      },
      {
        type: 'RCHAT_HISTORY_PAGE_REQ',
        groupId: 1,
        channelId: 'c',
        direction: 'before',
        priority: 'm',
        after: null,
        before: { id: 'e', ts: 1 },
        includeCursor: false,
        limit: 25,
        timestamp: 1,
      },
      {
        type: 'RCHAT_HISTORY_PAGE_REQ',
        groupId: 1,
        channelId: 'c',
        direction: 'before',
        priority: undefined,
        after: null,
        before: { id: 'e', ts: 1 },
        includeCursor: false,
        limit: 25,
        timestamp: 1,
      },
      {
        type: 'RCHAT_DM_NOTIFY',
        peerAddress: 'b',
        sourcePeerHash: 'h',
        requestId: 'r',
        latestCursor: { id: 'e', ts: 1 },
        probeRequestId: null,
        maxHops: 3,
        timestamp: 1,
      },
      { type: 'RCHAT_DM_PROBE', requestId: 'r', maxHops: 3, timestamp: 1 },
      {
        type: 'RCHAT_READ_SYNC_V1',
        scopeType: 'dm',
        ownerAddress: 'a',
        conversationId: 'c',
        peerAddress: 'b',
        upToTimestamp: 1,
        signedAt: 1,
      },
      {
        type: 'RCHAT_METADATA_SNAPSHOT',
        createdAt: 1,
        groupId: 1,
        latestEventId: 'e',
        latestFeedTimestamp: 1,
        snapshotHash: 'h',
        snapshotId: 's',
        scope: 'public',
        parentSnapshotHash: '',
        version: 1,
      },
      {
        type: 'RCHAT_METADATA_SNAPSHOT_REQ',
        groupId: 1,
        snapshotHash: 'h',
        timestamp: 1,
      },
      {
        type: 'RCHAT_STATE_HEADS_REQ',
        groupId: 1,
        cursor: '',
        limit: 12,
        timestamp: 1,
      },
      { type: 'RCHAT_EVENT_REQ', eventId: 'e', groupId: 1, timestamp: 1 },
      {
        type: 'RCHAT_LINKED_EVENT_REQUEST',
        transferId: '0123456789abcdef',
        eventId: 'event-linked-request',
        groupId: 1,
        requesterPeerHash: 'a'.repeat(32),
        providerPeerHash: 'b'.repeat(32),
        timestamp: 1,
      },
      {
        type: 'RCHAT_LINKED_AUTHOR_RANGE_REQUEST',
        transferId: '0123456789abcdef',
        groupId: 1,
        range: {
          a: 'Qauthor',
          s: 'a'.repeat(32),
          from: 2,
          to: 4,
        },
        limit: 100,
        requesterPeerHash: 'a'.repeat(32),
        providerPeerHash: 'b'.repeat(32),
        timestamp: 1,
      },
      {
        type: 'RCHAT_RESOURCE_AUTH',
        groupId: 1,
        timestamp: 1,
        transferId: 'x',
      },
      {
        type: 'RCHAT_GROUP_KEY_DIGEST',
        epoch: 1,
        groupId: 1,
        keyId: 'k',
        timestamp: 1,
      },
      {
        type: 'RCHAT_GROUP_KEY_REQ',
        epoch: 1,
        groupId: 1,
        keyId: 'k',
        requestId: 'r',
        timestamp: 1,
      },
      {
        type: 'RCHAT_GROUP_KEY_RES',
        epoch: 1,
        groupId: 1,
        keyBytesBase64: 'k',
        keyId: 'i',
        requestId: 'r',
        timestamp: 1,
      },
      {
        type: 'RCHAT_RESOURCE_REQ',
        eventId: null,
        fileHash: 'f',
        byteRanges: [[0, 10]],
        groupId: 1,
        timestamp: 1,
      },
      {
        type: 'RCHAT_RESOURCE_FIND',
        expiresAt: 2,
        fileHash: 'f',
        groupId: 1,
        maxHops: 3,
        requestId: 'r',
        sizeBytes: 10,
        timestamp: 1,
      },
      {
        type: 'RCHAT_DM_RESOURCE_FIND',
        conversationId: 'c',
        peerAddress: 'b',
        requestId: 'r',
        fileHash: 'f',
        sizeBytes: 10,
        maxHops: 3,
        expiresAt: 2,
        timestamp: 1,
      },
      {
        type: 'RCHAT_DM_RESOURCE_REQ',
        conversationId: 'c',
        peerAddress: 'b',
        fileHash: 'f',
        byteRanges: [[0, 10]],
        requestId: 'r',
        requesterPeerHash: 'h',
        timestamp: 1,
      },
      {
        type: 'RCHAT_RANGE_REQ',
        groupId: 1,
        ranges: [
          {
            a: 'QaU2XUB6iMgM9YUJnYRkxwVKJd322hJh91',
            s: '0123456789abcdef0123456789abcdef',
            from: 2,
            to: 4,
          },
        ],
        limit: 100,
        sourcePeerHash: '0123456789abcdef0123456789abcdef',
        timestamp: 1,
      },
      {
        type: 'RCHAT_DIRECT_CALL_HISTORY_V1',
        ownerAddress: 'Qowner',
        callId: 'call_history_1',
        peerAddress: 'Qpeer',
        direction: 'incoming',
        outcome: 'missed',
        startedAt: 1,
        endedAt: 2,
        updatedAt: 3,
      },
    ];
    for (const payload of payloads) {
      expectAllowed(assertAllowedReticulumSigningPayload, payload);
    }
  });

  it('allows current group and DM event schemas', () => {
    expectAllowed(assertAllowedReticulumSigningPayload, {
      eventId: 'e',
      groupId: 1,
      channelId: 'c',
      authorStreamId: 's',
      authorSeq: 1,
      timestamp: 1,
      eventType: 'message',
      targetEventId: null,
      replyToEventId: null,
      encryptedPayload: '{}',
      payloadHash: 'h',
      mentionAddressHashes: [],
    });
    expectAllowed(assertAllowedReticulumSigningPayload, {
      eventId: 'e',
      groupId: 1,
      channelId: 'c',
      authorStreamId: 's',
      authorSeq: 1,
      timestamp: 1,
      eventType: 'message',
      targetEventId: null,
      replyToEventId: null,
      encryptedPayload: '{}',
      payloadHash: 'h',
      mentionAddressHashes: [],
      mentionTargets: [],
    });
    expectAllowed(assertAllowedReticulumSigningPayload, {
      conversationId: 'c',
      eventId: 'e',
      eventType: 'message',
      payload: '{}',
      payloadHash: 'h',
      recipientAddress: 'b',
      replyToEventId: null,
      senderSeq: 1,
      targetEventId: null,
      timestamp: 1,
    });
  });

  it('rejects unknown types, missing fields, extra fields, and unsafe values', () => {
    expect(() =>
      assertAllowedPresenceSigningPayload({ type: 'SIGN_ANYTHING', value: 'x' })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({ type: 'CALL_ACCEPT', callId: 'c' })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        type: 'CALL_ACCEPT',
        callId: 'c',
        timestamp: 1,
        privateKey: 'x',
      })
    ).toThrow();
    expect(() =>
      assertAllowedReticulumSigningPayload({
        type: 'RCHAT_EVENT_REQ',
        eventId: 'e',
        groupId: 1,
        timestamp: Number.NaN,
      })
    ).toThrow();
    expect(() =>
      assertAllowedReticulumSigningPayload({ arbitrary: true })
    ).toThrow();
    expect(() =>
      assertAllowedReticulumSigningPayload({
        type: 'RCHAT_RANGE_REQ',
        groupId: 1,
        ranges: [
          {
            a: 'QaU2XUB6iMgM9YUJnYRkxwVKJd322hJh91',
            s: 'not-an-author-stream',
            from: 2,
            to: 4,
          },
        ],
        limit: 100,
        sourcePeerHash: '0123456789abcdef0123456789abcdef',
        timestamp: 1,
      })
    ).toThrow('author range request is invalid');
    expect(() =>
      assertAllowedPresenceSigningPayload({
        authorAddress: 'a',
        authorPublicKey: 'p',
        chatId: 'c',
        content: 'hello',
        eventType: 'message',
        id: 'i',
        seq: 1,
        timestamp: 1,
        attachmentMeta: new Date(),
      })
    ).toThrow('unsupported value');
  });

  it('allows only the bounded WebRTC signal digest envelope', () => {
    const signal = {
      type: 'CALL_RTC_SIGNAL',
      callId: 'call-route-bound-id',
      generation: 'generation_1234',
      signalId: 'signal_1234',
      signalType: 'offer',
      payloadHash: 'a'.repeat(64),
      timestamp: Date.now(),
    };

    expectAllowed(assertAllowedPresenceSigningPayload, signal);
    expect(() =>
      assertAllowedPresenceSigningPayload({ ...signal, payload: 'sdp' })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        ...signal,
        type: 'CALL_RTC_SIGNAL_UNKNOWN',
      })
    ).toThrow();
    expect(() =>
      assertAllowedPresenceSigningPayload({
        ...signal,
        signalType: 'arbitrary',
      })
    ).toThrow('WebRTC signal signing envelope is invalid');
  });
});

# Reticulum networking for Q-Apps

This desktop-only API gives a Q-App fetch-like RPC path and a persistent,
message-oriented Reticulum path. Q-Apps never receive an `RNS.Link`, Channel,
Buffer, path-discovery state, or stream chunks.

Backends use the dedicated Reticulum destination aspect
`qortal-hub-v3.qapp-backend.v1`; Qortal presence destinations are not reused.

## API

- `RNS_REQUEST`: `destination`, `path`, `payload`, optional `timeoutMs`,
  `maxResponseBytes`, and application `requestId`.
- `RNS_CONNECT`: `destination`; returns `{ connectionId, state }`.
- `RNS_SEND`: `connectionId`, `payload`; resolves once the complete logical
  message is queued and written.
- `RNS_CLOSE`: `connectionId`.

The host posts `RNS_MESSAGE` and `RNS_CONNECTION_STATE` events to the owning
Q-App view. Desktop Q-Apps use separate Electron web contents and storage
partitions; browser and mobile builds retain the iframe bridge. States are
`CONNECTING`, `CONNECTED`, `RECONNECTING`,
`DISCONNECTED`, `CLOSING`, `CLOSED`, and `ERROR`.

The first operation for a destination in a tab asks whether the app may connect
to its backend and exchange data. This single approval also grants
`PRIVATE_DATA_CHANNEL` for that app's tab, covering private channels and MoQ.
The dialog does not expose transport names or destination hashes. Subsequent
`SESSION_PERMISSIONS` requests for already-approved capabilities return without
another dialog; unrelated capabilities still require approval. Account access
and microphone permission remain separate.

Permission and connections are isolated by trusted tab, service, application
name, and destination. Closing or reloading the tab removes its logical
connections. This initial version does not consume a destination declared in
QDN metadata because no owner-signed metadata field exists yet.

## Pooling and reconnects

RPC and realtime operations for one isolation key share one physical Link.
Concurrent establishment joins one pending Link operation. Logical connection
IDs remain stable when that Link is replaced. Reconnect uses exponential
backoff with jitter. Incomplete stream frames are discarded with the old
Buffer; complete unacknowledged messages are resent from their beginning.

RPC calls are not replayed automatically after submission. Backends should use
the supplied application `requestId` to deduplicate non-idempotent operations.

## Wire protocol version 1

Version 1 is frozen. Incompatible changes require a new destination aspect such
as `qortal-hub-v3.qapp-backend.v2`. The canonical machine-readable vectors are
in [`protocol-v1-vectors.json`](../protocol-v1-vectors.json), with an identical
copy in the Python backend.

Every Buffer frame uses network byte order:

| Field                                 |            Size |
| ------------------------------------- | --------------: |
| version                               |          1 byte |
| type (`DATA=1`, `ACK=2`, `CONTROL=3`) |          1 byte |
| transport message ID                  |         8 bytes |
| payload length                        |         4 bytes |
| payload                               | declared length |

The parser supports partial and coalesced reads. Frames are limited to 256 KiB,
the receive accumulator to twice that, the unacknowledged queue to 64 messages,
and queued bytes to 2 MiB. Received IDs are retained in a bounded 512-entry
deduplication cache. An ACK is returned even for a duplicate DATA frame.

Realtime uses bidirectional RNS Buffer stream ID `7`. Writers loop over partial
writes and flush only after the complete frame is accepted. Each sender starts
at a random nonzero 63-bit message ID, increments modulo `2^64`, and retains
complete pending frames. ACK carries one DATA ID in the header and has an empty
payload. ACK timeout is 120 seconds; there is no timer-driven same-Link retry.

DATA payload is compact UTF-8 JSON:

```json
{ "connectionId": "rns-<UUID>", "payloadBase64": "...", "encoding": "json" }
```

`encoding` is `json` for a Base64-wrapped UTF-8 JSON value and `base64` for
arbitrary bytes. Standard padded Base64 is used. JSON key order and whitespace
are not normative. Multiple stable logical `connectionId` values can share the
Link. The complete envelope, not only the decoded Q-App body, must fit 256 KiB.

CONTROL `3` supports `{"type":"PING"}`, `{"type":"PONG"}`, and
`{"type":"CLOSE","connectionId":"rns-<UUID>"}`. PING receives PONG with the
same header message ID. CLOSE removes only the named logical connection on the
receiving physical Link and is idempotent; a delayed DATA frame for that ID is
acknowledged but not delivered. CONTROL is not ACKed. Other control shapes are
protocol errors. Application authentication/session resume is above transport;
v1 has no WELCOME or RESUME transport control.

RPC `link.request()` data is a native dictionary with `version: 1`, application
`requestId`, `encoding`, and `payloadBase64`. The backend returns a native JSON
value or bytes directly. Requests are limited to 256 KiB decoded; responses are
limited to the requested bound, at most 1 MiB. Submitted RPCs are never replayed
automatically after ambiguous failure.

Reconnect begins at 0.5 seconds, doubles with 0.8–1.2 jitter, and caps at 30
seconds. Partial Buffer bytes are discarded. Complete unacknowledged DATA frames
are resent in message-ID order from byte zero. Closing removes local ownership
immediately and queues the remote CLOSE on a bounded, per-backend worker. A
failed or stalled CLOSE tears down that same physical Link, while a replacement
Link created in the meantime is left untouched. Removing the last logical
connection prevents a pending reconnect timer from reopening the Link.

Transport IDs prevent duplicate delivery across reconnects. They do not prevent
duplicate business operations: Q-Apps must include their own operation IDs for
payments, game actions, or any other non-idempotent operation.

## Backend example and limits

[`examples/qapp-reticulum/backend.py`](../examples/qapp-reticulum/backend.py)
creates a persistent identity, announces the backend destination, serves
`/hello`, and echoes realtime frames. The accompanying `client.js` shows all
four Q-App actions and both event types.

Current limitations:

- Electron only; browser and mobile builds return a native-transport error.
- Backend identity authorization is explicit user approval, not QDN metadata.
- `RNS.Resource` upload/download actions are intentionally deferred. Realtime
  messages and RPC bodies are bounded and are not suitable for large files.
- Request cancellation and a bulk-priority scheduler are not exposed yet.
- Application session/subscription resumption remains the Q-App/backend's job.
## Generic Q-App screen capture

Q-Apps may call `navigator.mediaDevices.getDisplayMedia({video: true, audio: false})`
from a user gesture. Hub requests one-time capture permission before exposing any
screen/window previews. After approval, it sends `QAPP_SCREEN_CAPTURE_SOURCES`
directly to the requesting frame, containing a random one-use `requestId` and
`sources: [{id, name, thumbnail}]`. The Q-App renders its own source picker and
calls `qortalRequest({action: 'SCREEN_CAPTURE_SELECT', requestId, sourceId})`.
Omitting `sourceId` cancels. Completion also emits `QAPP_SCREEN_CAPTURE_CANCEL`
to dismiss any remaining picker. The original browser capture promise resolves
to a local MediaStream; streams are never passed through IPC.

Requests expire after 60 seconds. Native code validates the requesting frame,
unchanged URL, approved source list, main-shell IPC sender, and one-use capability.
Only one pending capture request is allowed across the Hub window. Hub does not encode, encrypt, or
interpret this app's screen frames; application media logic stays in the Q-App.

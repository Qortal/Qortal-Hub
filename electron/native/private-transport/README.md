# Qortal private transport sidecar

The sidecar carries authenticated inner QUIC through RFC 9298 CONNECT-UDP:

```
Electron -> sidecar -> outer QUIC/HTTP3 -> MASQUE -> inner QUIC -> backend
```

It opens no listening socket. `masque-go v0.5.0` supplies the CONNECT-UDP
`net.PacketConn`; `quic-go v0.62.0` dials inner QUIC directly over it. There is
no direct backend dial or fallback.

## Authentication and bootstrap

Electron obtains bootstrap version 1 through the authenticated reserved RNS
request `/qortal/private-transport/bootstrap/v1`. Electron binds that request
to the already-owned logical RNS connection in the internal request envelope.
Its descriptor contains the
logical session, authenticated RNS destination, literal backend endpoint,
backend certificate SHA-256 pin, short-lived single-use attach token, nonce,
owner binding hash, expiry, transport identifier, and supported features. The
backend derives the owner binding from its signed Q-App/application session;
the descriptor is never exposed to the Q-App.

Both relay and backend TLS use pinned leaf-certificate DER hashes, logical
hostname verification, and validity-period checks. Public Web PKI is not
required. Inner QUIC uses ALPN `qortal-private/1`.

After TLS, the client sends ATTACH with protocol version, logical session ID,
attach token, nonce, channel purpose, and owner binding. The backend must return
ATTACHED for the same logical session and transport generation 1.

## Framing and IPC

The reliable lane uses one persistent bidirectional QUIC stream:

```
magic[4] | version[1] | type[1] | metadataLength[2] |
payloadLength[4] | bounded JSON metadata | raw payload
```

Metadata is limited to 4 KiB and raw reliable payloads to 64 KiB. QUIC
DATAGRAMs use a distinct `QP3D` binary frame with protocol version, bounded
message ID, and at most 1024 application bytes. They are not emulated with
streams.

Sidecar IPC version 2 is hybrid: NDJSON controls retain request IDs and coded
errors; a declared `binaryLength` is followed immediately by raw bytes.
Unsolicited reliable/datagram/error events use the same bounded sideband. This
removes base64 expansion from the Step 3 application data path.

Inner QUIC uses a conservative 1200-byte initial packet size and disables PMTU
probing because the generic MASQUE PacketConn cannot expose UDP DF/OOB support.
CONNECT-UDP permits 1500-byte UDP payloads. Larger application datagrams fail
locally rather than being fragmented or converted to streams.

Two congestion controllers are active: inner QUIC to the backend and outer
QUIC to the relay. No nested-congestion tuning is attempted. Metrics include
inner smoothed RTT, application bytes, datagram drops, stream errors, and
connection errors; endpoints are excluded.

## MoQT compatibility

The MOQT compatibility spike pins `github.com/mengelbart/moqtransport` at commit
`9eaf40a4dedd` (MOQT draft 18). The compatibility test in
`internal/moqproof` establishes two real MOQT sessions over MASQUE-provided
`net.PacketConn` instances. It blindly relays an opaque application object
between the clients and verifies that the backend observes relay egress
addresses. Keep MOQT behind the
private-transport boundary; its wire version is not part of the Q-App API.

The pinned source is selected from `third_party/moqtransport` using a Go
`replace` directive. Its previously empty SendDatagram method now encodes
OBJECT_DATAGRAM and sends it using QUIC DATAGRAM. Transport errors propagate;
there is no retry or stream fallback. Provenance and patch scope are recorded
in `third_party/moqtransport/QORTAL-PATCHES.md`.

The production sidecar also owns a generic trusted MOQT client. It:

- consumes the backend's authenticated, one-time `realtime` bootstrap;
- establishes inner `moqt-18` QUIC only through CONNECT-UDP;
- verifies the backend name and exact certificate pin;
- accepts a bounded publication namespace and track instead of embedding any
  application-specific room, participant, or content meaning;
- publishes and receives only opaque application objects;
- caps objects at 1024 bytes, namespace components at eight, and subscriptions
  at 64; and
- emits received objects only to the Electron main process.

The sidecar does not capture, encode, encrypt, decrypt, sign, inspect, or play
application content. Those responsibilities belong to the application using
the generic transport. A capability-scoped Q-App API exposes only logical
session open, track subscribe, opaque object publish, metrics, and close
operations. It requires the existing `PRIVATE_DATA_CHANNEL` session permission,
binds each MOQT session to the requesting Q-App and its owned Reticulum
connection, and never returns backend endpoints, relay endpoints, credentials,
or raw sockets.

The opaque-object two-client test runs both subgroup-stream and datagram delivery.
The datagram case deliberately loses the first object and verifies the next
object arrives as a datagram, with no resend of the lost object. Oversized
sends must return an error. These are local integration tests, not a completed
Q-App/backend integration or a full MoQT interoperability audit.

Run `go test ./...` here and in `third_party/moqtransport`. The latter
includes upstream regression tests and byte-level datagram sender tests.

## Build and scope

The module requires Go 1.26+. The normal build uses local Go when available and
automatically falls back to `golang:1.26-bookworm` through Docker otherwise.

```
npm run build:private-transport --prefix electron
QORTAL_GO_BINARY=/path/to/go npm run test:private-transport
```

The normal development MASQUE path uses the real RNS provider and the companion
`qapp-backend` implementation. Isolated Step 3 tests retain provider injection;
the Step 4 integration test invokes the real backend bootstrap/token service and
Python QUIC listener. Large-file framing and resumability remain out of scope.

## Standalone community MASQUE relay

The operator-run relay is maintained as the separate `qortal-masque-relay`
project. Hub contains only the client, Reticulum discovery, and private-channel
coordination code. Discovered MASQUE relays are the default in development and
packaged builds. `QORTAL_PRIVATE_TRANSPORT=masque-test` exists only for the
explicit local test-relay override.

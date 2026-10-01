# MASQUE relay admission

Hub's relay admission is generic transport infrastructure. QApps and application
backends never receive relay tickets and do not participate in authorization.

## Flow

1. Discover signed availability over Reticulum. Public relays remain v1/v2;
   restricted relays must use v3. Do not fall back to the old account proof.
2. Prefer reusable connections, then public/matching-group relays, then unknown
   membership. Coalesce selection and hedge after 300 ms, at most two concurrent
   candidates and six attempts within a 60-second cold-path budget.
   Fresh membership information excludes nonmatching restricted relays, even
   if none remain. That case returns `RELAY_NO_ELIGIBLE_RELAY` without requesting
   tickets or opening QUIC. Unknown or stale membership still permits trying
   a relay; public relays remain eligible.
3. For restricted relays, fetch the current public ticket descriptor through an
   encrypted Reticulum Link. Check its relay pin, group-policy hash and key
   commitment against the signed advertisement. Native Go additionally validates
   the RSA key, derived key ID and shared hourly expiry.
4. Generate three independent random tickets and blind them with CIRCL v1.6.5
   (RFC 9474 RSABSSA-SHA384-PSS-Deterministic). Sign a one-minute issuance challenge
   in the trusted wallet context. The challenge binds the blinded batch.
5. Send the account proof **only through Reticulum**. The relay checks account
   ownership and group membership, then blind-signs the batch. Unblind and
   verify inside native Go. Store resulting tickets only in Hub main memory.
6. Prepare pinned QUIC and redeem one anonymous ticket. No account address,
   public key or wallet signature goes over QUIC. Only then attach a backend.
7. Use spare single-use tickets for reconnects; refresh batches when exhausted
   or near expiry. Reuse the authorized outer connection across QApps. Renew
   five minutes before expiry without replacing the connection.
8. Logout/account switch clears credentials, pending results, timers and
   connections. There is no direct-to-backend fallback.

Expiry is issuance-hour start plus 12 hours (11–12 hours of actual validity).
Redemption never extends it. The relay commits a spent marker durably before
forwarding, including across crashes/restarts. Existing grants and spare tickets
do not require Core availability. A member removed from a group can retain
access for the remaining window, subject also to Core freshness.

## Protocol and packaging

Sidecar version: **0.7.0**; IPC framing remains version 2. Main-only operations:
`prepareRelayTickets`, `finalizeRelayTickets`, `prepareRelay`, `authorizeRelay`,
`closeRelay`, `clearRelays`. Native ticket blinding state is bounded and expires
after a minute. Prepared connection handles remain process-local.

The Reticulum service uses the persistent discovery identity and destination
`qortal-hub-v3.community-masque-relay.v1`. Request paths are `/catalog`,
`/challenge`, `/issue`; serialized JSON requests are transported as encrypted
RNS Link requests/resources, not announcements. The Hub Python handler uses a
dedicated four-worker bound and tears down each temporary link after response.

A v3 advertisement has a three-byte header (version; IPv6 bit plus name length
minus one; group count), IP, uint16 port, uint32 lease expiry, TLS pin, name,
canonical LEB128 group IDs, full 64-byte Reticulum public identity, 32-byte
ticket-key commitment, and 64-byte Ed25519 signature. Signature domain:
`Qortal-MASQUE-Discovery-v3\\0`. Total is at most 316 bytes, including 16
maximum-size IDs with IPv6 and the default relay name. The shared codec ships
beside the bridge and in frozen/packaged builds.

Policy digest: SHA-256 of compact JSON
`{"Mode":"groups","Groups":[sorted IDs]}`.

Ticket key ID: SHA-256 of
`Qortal-MASQUE-Ticket-v1\\0 || policyHex || relayPinHex || decimalEpoch || PKCS1PublicDER`.
Epoch is floor(Unix seconds / 3600). Ticket signed message:
`Qortal-MASQUE-Ticket-v1\\0 || keyIdHex || random32`.
Redemption JSON contains only epoch, keyId, base64 message and base64 signature.

Issuance proof type: `masque-ticket-issue-v1`, with relayPin, policy, binding,
nonce, expiresAt. Binding is SHA-256 of compact JSON
`{"key":keyId,"blinded":[base64 blinded messages]}`.
The wallet adds authorAddress/authorPublicKey and Ed25519-signs the sorted JSON,
excluding signature. Public key and signature are Base58. This domain is only
available to Hub's own wallet context, not an iframe.

QUIC control still uses `Qortal-Relay-Control: authorize`. A restricted,
unauthorized connection returns 401 and
`Qortal-Relay-Challenge: {"type":"masque-ticket-required-v1"}`.
Main passes a ticket to the sidecar, which transmits `Qortal-Relay-Ticket`.
An authorized connection returns 204 and `Qortal-Relay-Expires`.
Renewal sets `Qortal-Relay-Renew: 1`. Account-shaped proofs are rejected
independently by native Go and the relay.

## Boundaries

This assumes the Reticulum authorization path hides the user's IP. Blind signing
prevents direct transcript-to-ticket matching, not timing correlation, small-group
inference, malicious issuer equivocation, or deliberate ticket sharing. A signed
key commitment is not a global key transparency system. Do not claim full anonymity
or non-transferable membership enforcement.

The standalone relay's ACCESS.md describes operator configuration, persistence,
capacity, Core failover and deployment. Public mode remains the default; enabling
groups requires an explicit operator choice. Update/restart Hub and the relay,
not the Call backend/QApp. Never restore old spent-ticket state alongside retained
signing keys.

## Verification

- `npm run test:private-transport` with `QORTAL_GO_BINARY` when necessary.
- `npx vitest run electron/src/relay-access-coordinator.test.ts electron/src/relay-ticket-wallet.test.ts src/background/reticulum-signing-policy.test.ts`.
- `python3 -m unittest presence_bridge_test` from electron/resources.
- `go test -race ./...` from electron/native/private-transport.
- Relay's cross-project Python test exercises the actual Hub Python handler,
  isolated Reticulum instances, real sidecar/relay binaries and a mock Core,
  including denial, forwarding, spare tickets and replay after restart.

These checks do not replace a real macOS wallet/cross-network smoke test.

# Call update — remaining issues

Handoff document for the Qortal GO calls audit
(`hub-calls-suggestions-for-hub-devs-2026-10-18.md`, 36 items).

> **Status: the three audit changes are archived (2026-10-20).** Everything
> local and testable shipped; the rest was moved to a live follow-up change.
>
> | Change                       | Archived as                                     |
> | ---------------------------- | ----------------------------------------------- |
> | `call-security-hardening`    | `2026-10-20-call-security-hardening` (29/33)    |
> | `call-privacy-stun-overhaul` | `2026-10-20-call-privacy-stun-overhaul` (37/41) |
> | `call-bugs-and-cleanup`      | `2026-10-20-call-bugs-and-cleanup` (57/57)      |
>
> Remaining work now lives in `openspec/changes/call-followups/`, which also
> records the settled P-3 design. The unchecked rows left in the archive are
> exclusively hardware-gated checks; each archived `proposal.md` has a
> `## Verification status` section naming them.
>
> Deltas were written for two capabilities: `group-calls` and a new
> `direct-calls` (1:1 calls were previously undocumented).

Delivered in this round, on top of what the sections below describe:

- **X-3** — the caller now renders "Ringing…" (`stage: 'ringing'` plus a
  `ringingAcknowledged` flag; `CallState` untouched), and the CALL_REQUEST
  re-flood stops as soon as the callee acknowledges. The old task text said the
  opposite; the audit wanted the flood to stop.
- **P-5** — `getIceTransportPolicy` is now an IPC method consumed by all three
  peer-connection sites; ICE servers cross the boundary as full `RTCIceServer`
  objects so TURN credentials survive; a settings panel in
  `HomeProfileCard.tsx` exposes server rows, credentials, and the relay toggle.
- **B-15** — endpoint lists are served from a request handler on a separate
  query destination, queries are throttled to one per 10 minutes inside the
  bridge, answers are packets rather than endpoint re-announces, and a
  cache-less client asks a known contributor directly. New Python coverage:
  `CommunityStunDiscoveryB15Test`.
- **#4 / B-13** — the remaining user-facing call strings in `useVoiceCall.ts`
  and three components are keyed; `en/core.json` carries them (other locales
  still at their previous 4 `voice_call` keys).

The sections below are retained as the original analysis. Where they conflict
with the notes above, the notes win.

---

## 0. Orientation

### The three changes

| Change                       | Path                                           | Done  |
| ---------------------------- | ---------------------------------------------- | ----- |
| `call-security-hardening`    | `openspec/changes/call-security-hardening/`    | 29/33 |
| `call-privacy-stun-overhaul` | `openspec/changes/call-privacy-stun-overhaul/` | 26/38 |
| `call-bugs-and-cleanup`      | `openspec/changes/call-bugs-and-cleanup/`      | 48/57 |

Inspect them with:

```bash
openspec instructions apply --change "<name>" --json
```

### Verification baseline — keep this green

```bash
npx vitest run                                            # 2257 passing, 181 files
cd electron && npx tsc --noEmit -p tsconfig.json           # clean
npx eslint src                                             # 1 pre-existing warning only
python3 -m unittest electron.resources.presence_bridge_test # 283 passing
```

The single ESLint warning is in `src/utils/hasInvisibleCharacters.ts` and is
unrelated to this work.

### What was already implemented (do not redo)

Security: S-1 (cache bypass), S-2 (GA DoS + badge gating), S-3 (hop clamp, map
caps, buffer cap, relay address check), S-4 (link identity latch +
`authenticatedPeerHash`), S-5 (key rotation on leave), S-6 (roster injection),
S-7 + P-7 (protocol version 2, signed `ch`/`pv`, salted election).

Privacy: P-1 (candidate filter + Chromium policy), P-2 / B-5 (pinned CR +
re-flood), P-3 partial (roster-first GJ/GL delivery), P-4 (Reticulum-only
setting), P-6 (STUN opt-in), P-8 (constant bitrate + `hardenOpusSdp`), B-15
partial (advertise cadence + query throttle + lease).

Bugs: B-1, B-2, B-3 partial, B-4, B-5, B-6, B-7, B-8, B-9, B-10, B-11, B-12,
B-13, B-14. Suggestions: X-1, X-3 partial, X-4, X-5, X-2 partial.

---

## 1. P-3 — Salted DM voice room IDs (highest value remaining)

**OpenSpec tasks:** `call-privacy-stun-overhaul` #11, #12

### Problem

`buildDmVoiceRoomId` hashes the direct chat id, which is just the two wallet
addresses:

```ts
// src/lib/call/directVoiceReticulumMedia.ts:23
export async function buildDmVoiceRoomId(
  directChatId: string
): Promise<string> {
  const digest = await sha256Hex(directChatId);
  return `${DM_VOICE_ROOM_PREFIX}${digest.slice(0, DM_VOICE_ROOM_ID_DIGEST_HEX_LEN)}`;
}
```

A GJ frame carries `{ a: <caller address>, R: "dmv:<18 hex>" }`. Because the
input is a function of addresses only, any relaying Hub can recover the callee
offline:

```
for each known Qortal address B:
    if sha256("direct:" + sort(A, B)).slice(0, 18) == R:  → B is the callee
```

This is a dictionary lookup over the address set, not a hash inversion. It
reconstructs the DM-call graph even though P-2 now keeps the CALL_REQUEST
itself off the overlay flood.

### Why it was not shipped

Not a capability problem — every primitive already exists:

- `ed2curve.convertPublicKey` / `convertSecretKey` are imported and used in the
  same file (line 164) to derive room keys, so an X25519 shared secret is
  available.
- `CALL_PROTOCOL_VERSION = 2` in `src/lib/group-call/callProtocolVersion.ts`
  already gates incompatible peers.

The blockers are structural:

1. **Identifier churn.** The DM room id is a first-class key. Touching it means
   auditing at least: `dmRoomIdRef` and the six `isDmVoiceRoomId` guards in
   `src/hooks/useVoiceCall.ts` (lines ~2065, 3012, 3037, 3066, 3108), the GJ `R`
   field, `GC_KEY_REQUEST` targeting, and link-auth room correlation.
2. **Ordering.** Today both sides derive the id from `chatId`, known before any
   exchange. A shared-secret id needs the peer's wallet public key and a shared
   `callId`, so derivation must move to _after_ CALL_REQUEST arrives. That is a
   lifecycle change on both caller and callee paths
   (`useVoiceCall.ts:3404` caller, `:3742` callee).
3. **`callId` alone is not enough.** Relays read `callId` from the CR, so the
   salt must include the X25519 shared secret, not just the call id.
4. **Mixed-version hazard.** A 3.0.x peer computes the old id. Both ends must
   agree on the derivation, so this must ride the version gate, not ship
   unilaterally.

### Suggested implementation

Add alongside the existing function rather than replacing it:

```ts
// src/lib/call/directVoiceReticulumMedia.ts
export async function buildDmVoiceRoomIdV2(
  localKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array },
  peerEd25519PublicKeyBase58: string,
  callId: string
): Promise<string> {
  const peerCurve = ed2curve.convertPublicKey(
    base58ToBytes(peerEd25519PublicKeyBase58)
  );
  if (!peerCurve) throw new Error('dm-room-id-v2: bad peer key');
  const shared = nacl.box.before(
    peerCurve,
    ed2curve.convertSecretKey(localKeyPair.secretKey)
  );
  const digest = await sha256Hex(`dmv2:${toHex(shared)}:${callId}`);
  return `${DM_VOICE_ROOM_PREFIX}${digest.slice(0, DM_VOICE_ROOM_ID_DIGEST_HEX_LEN)}`;
}
```

Then:

1. Gate on `CALL_PROTOCOL_VERSION >= 2` at both derivation sites. When the peer's
   version is unknown or 1, keep `buildDmVoiceRoomId`.
2. Thread the peer's wallet public key into the callee path. The caller learns it
   from the existing GC_JOIN / link-auth flow; the callee learns it from the
   CALL_REQUEST envelope (`fromPublicKey`), which is verified before use.
3. Add a test asserting the v2 id differs for the same pair across two `callId`
   values, and that it cannot be reproduced from addresses alone.
4. Update `docs/group-audio-calls.md` with the derivation.

**Effort:** ~200 lines across room lifecycle with four touchpoints. This is the
one item where an explicit decision from the maintainer is warranted before
coding.

---

## 2. P-5 — User-configurable ICE servers: three concrete gaps

**OpenSpec tasks:** `call-privacy-stun-overhaul` #21, #24

The backend is written. Three things break it in practice.

### 2a. `getIceTransportPolicy()` is never called — relay-only does nothing

`setCustomIceConfiguration` and `getIceTransportPolicy` exist in
`electron/src/stun-coordinator.ts` (lines 259 and 285), the setting is persisted
and pushed from `notifyAppSettingsChanged` (`electron/src/setup.ts:1946`), but
**nothing consumes the policy**:

```bash
grep -rn "getIceTransportPolicy" src electron/src   # only the definition
```

All three PeerConnection constructors pass only `{ iceServers }`:

- `src/lib/call/directVoiceWebRtcTransport.ts:300`
- `src/lib/call/directScreenShareWebRtcTransport.ts:190`
- `src/lib/group-call/groupCallWebRtcDataChannelTransport.ts:338`

**Fix:** thread the policy from main to the renderer (see 2c) and pass
`{ iceServers, iceTransportPolicy }` at all three sites.

### 2b. Credential type erasure

`getIceServersForRenderer(): { urls: string }[]` declares no `username` /
`credential`, and the merge in `stun-coordinator.ts` casts with
`as { urls: string }[]`. The objects carry credentials at runtime through the
spread copy, but the declared type strips them and would let a future consumer
silently drop them, so TURN auth cannot work reliably.

**Fix:** widen the return type to `RTCIceServer[]` and update the IPC signature
in `electron/src/preload.ts`, `src/types/window.d.ts`, and the renderer
transport option types (`getIceServers(): Promise<RTCIceServer[]>`).

### 2c. No UI and no policy plumbing

There is no settings panel for server URLs, username, credential, or the relay
toggle. `HomeProfileCard.tsx:3927` (the `callReticulumOnly` switch added during
this work) is the pattern to copy, but this needs text fields plus add/remove
rows — a small sub-panel, not a switch.

The plumbing is the real work. Policy must travel:

```text
app settings → stun-coordinator (done)
             → IPC handler → preload → window typing
             → renderer transport options
             → all three `new RTCPeerConnection(...)` sites
```

**Effort:** five-file chain plus a new panel. Task #24 (TURN appears in
`getIceServers()`) becomes possible once 2b is fixed.

---

## 3. B-3 — Group allowlist: event-driven refresh only

**OpenSpec task:** `call-bugs-and-cleanup` #10

The core bug is fixed: `syncQortalGroupReticulumTargets` used to run once at
join only. `startMemberGateRefresh(roomId)` in
`src/lib/group-call/groupCallAudioEngineRuntime.ts:9633` now re-fetches
`getGroupMembers(groupId)` every 60 s and re-pushes via
`setQortalGroupReticulumTargets`. Cleared at four teardown sites. Later joiners
are picked up and kicked members are pruned within 60 s.

**What is left:** the report asked for refresh "every 60–90s, **and on GROUP\_\*
chain events**". The event half has no foundation:

- There is no renderer-side group-chain event bus. `useQortalMessageListener.tsx`
  handles wallet/chat types such as `CANCEL_GROUP_BAN`;
  `WebsocketNotifications.tsx` only handles `type === 'history'`. Grepping for
  `GROUP_JOIN`, `GROUP_KICK`, `GROUP_BAN` in `src/` returns nothing relevant.
- The audio runtime runs in a separate hidden `BrowserWindow`
  (`audio-surface.html`), so a main-window DOM event cannot reach it. It would
  need an IPC fan-out or a message through the existing `audioSurface` command
  channel.

**Suggested approach:** if event-driven refresh is wanted, first find what Qortal
Core actually emits for group membership changes, add one listener in the main
shell, and fan it out over the existing `audioSurface:send-command` channel to
trigger `startMemberGateRefresh`'s `refresh` closure. If that proves invasive,
the 60 s timer already bounds staleness — this is a latency optimisation, not a
correctness fix.

---

## 4. X-2 — `fwd: 0` has no producer

**Not tracked as a separate OpenSpec task; add one if the setting is wanted.**

The wire field, decoder, `gcall:participant-joined` relay, runtime set, and
election skip are all implemented and tested:

- `electron/src/group-call-wire-reticulum.ts:163` encodes `fwd: 0` when
  `noForwarderHint === true`; `:382` decodes it back.
- `electron/src/group-call.ts:973` declares the field, `:11531` relays it.
- `src/lib/group-call/groupCallAudioEngineRuntime.ts:1108` holds the set,
  `:5951` populates it, `:7878` skips those peers in the election while another
  eligible peer remains.

**But nothing ever sets it.** Grep finds only consumers:

```bash
grep -rn "noForwarderHint" src electron/src   # no producer
```

`signReticulumJoinSplit` (`src/lib/group-call/groupCallJoinSigning.ts:159`) does
not accept the flag, and its only caller
(`groupCallAudioEngineRuntime.ts:5448`) never passes it.

**Fix:** add a user setting (default `false`), e.g. `callDontForward` alongside
`callReticulumOnly` in `electron/src/setup.ts`, surface it in
`HomeProfileCard.tsx`, plumb it into the runtime, and pass
`noForwarderHint` through `signReticulumJoinSplit` into `encodeJoinWire`. The
field is deliberately unsigned so old Hubs that rebuild the GC_JOIN field set
still verify.

---

## 5. X-3 — Ringing status not yet shown to the caller

**OpenSpec tasks:** `call-bugs-and-cleanup` #50, #51

The message plumbing is complete:

- `CALL_RINGING` (`CG`) in `electron/src/call.ts` — type union, envelope,
  encoder, decoder, `handleRinging`, `sendCallRinging`.
- `call:ringing` event forwarded in `electron/src/setup.ts:6567`.
- `call:ringing` IPC handler and `ringing()` preload method.
- `CALL_RINGING` schema in `src/background/reticulum-signing-policy.ts:160`.

**Two things remain:**

1. **#50 — the caller does not render "Ringing".** `src/hooks/useVoiceCall.ts`
   has no `case 'call:ringing'` in its event switch. Add one that sets a
   `ringing` sub-state, and surface it in `startupStatus` (currently reports
   `'Calling...'` for the whole ring window, at
   `useVoiceCall.ts:4026`). Add a `core:voice_call.ringing` key.
2. **#51 — re-flood should stop once ringing is acknowledged.** B-5 added a 4 s
   `CALL_REQUEST` re-flood (`requestRefloodTimer`). It currently retries for the
   full 60 s window. Clear it in the new `call:ringing` handler so an
   acknowledged call stops flooding.

Note the callee-side send is wired but the flag is only set once
(`call.ringingAcknowledged`), so there is no flood of `CG` frames.

---

## 6. B-15 — Community STUN discovery: request/response rework

**OpenSpec tasks:** `call-privacy-stun-overhaul` #33, #34, #35, #38

Partial work is in. Already done: advertise cadence 120 s → 3600 s, lease 48 min,
discovery query floor 5 s → 10 min (`electron/src/stun-coordinator.ts`), and the
`call-send` scheduler lane.

**Remaining is the structural part of B-15:**

**#33 — RNS packet request handler for the endpoint list.** Contributors should
serve their current list over an RNS link request handler instead of only
announcing individual endpoints, so a new client needs one announce per day to
fetch a whole list. Implement in `electron/resources/presence_bridge.py`
alongside `_announce_community_stun_endpoint`, mirroring the existing MASQUE
handler pattern (`set_packet_callback` / `received_packet`).

**#34 — client-side request-on-demand** in `electron/src/stun-coordinator.ts`:
when announce-driven discovery yields an empty pool, ask a known contributor
directly for its list.

**#35 — query announce throttle in Python.** The coordinator already floors at
10 min, but Python re-announces on every
`get_community_stun_endpoints` request. Add the same floor inside the bridge so
the coordinator's retry loop cannot spend the announce budget (the shared
transport retries an empty list every 750 ms for 12 s).

**#38 — verify** a cache-less client can discover endpoints via the request
handler. This one is testable locally with a loopback RNS instance.

**Compatibility:** packet answers and a request handler are additive. Keep
announcing, less often, for old receivers.

---

## 7. Small leftovers

| Task          | Change                       | What to do                                                                                                                                                                                                           |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #32 (privacy) | `call-privacy-stun-overhaul` | Verify Opus `bitrateMode: 'constant'` in live encoder stats. Needs the audio runtime, not unit-testable.                                                                                                             |
| #22 (bugs)    | `call-bugs-and-cleanup`      | `_audio_link_pick_keep` (`presence_bridge.py:18487`): make the keep rule deterministic (presence hash + direction primary, activity tie-break only).                                                                 |
| #24 (bugs)    | `call-bugs-and-cleanup`      | Send link-auth / GK / GQ over the Channel once GCC1 is acknowledged.                                                                                                                                                 |
| #26 (bugs)    | `call-bugs-and-cleanup`      | Buffer up to 16 control frames per link while link-auth is pending (`group-call.ts:12228`).                                                                                                                          |
| #54 (bugs)    | `call-bugs-and-cleanup`      | X-4 added the last-known-destination fallback in `electron/src/call.ts`; the UI still says "no route". Show "may be asleep" instead. Needs a new reason code end-to-end.                                             |
| #57 (bugs)    | `call-bugs-and-cleanup`      | Diagnostics interval is now 2 s (was 0.5 s). Add an explicit "full diagnostics on request" path so the slim payload is not the only option.                                                                          |
| #4 (bugs)     | `call-bugs-and-cleanup`      | i18n: `useVoiceCall.ts` and `CallSwitchGuardContext.tsx` are done. Audit remaining call strings in `components/Chat/` and `contexts/GroupCallContext.tsx`. Run `python3 .agents/skills/i18n/i18n_scan_hardcoded.py`. |

---

## 8. Live-network tests (cannot be done without hardware)

Seven tasks require two machines and a real Reticulum overlay. They are marked
inline in the task files. Summary:

| Task         | Checks                                                                                  |
| ------------ | --------------------------------------------------------------------------------------- |
| security #17 | Participant leaves → remaining peers get a new key; the leaver's key no longer decrypts |
| security #31 | Group call join/leave/audio between two patched Hubs                                    |
| security #32 | Patched Hub refuses to join a call with an unpatched 3.0.x build (version gate)         |
| security #33 | Room key rotation observed on a live call                                               |
| privacy #9   | CR reaches the callee via the pinned path                                               |
| privacy #13  | Group GJ does not appear in the overlay flood when the roster is populated              |
| privacy #19  | With Reticulum-only on, the call connects with no ICE candidates exchanged              |

Before running these, check whether the GO team's harness (Appendix A of the
audit) can be adapted — security #29 was already satisfied that way, by
adapting it into `electron/src/group-call.test.ts` under
`describe('security hardening (S-1, S-2)')`.

---

## 9. Notes and gotchas

- **Renderer changes are invisible to Electron** until
  `npx cap sync @capacitor-community/electron`.
- **Do not add `callId` alone as a DM room salt** (P-3) — relays read it from the
  CR.
- **The `fwd` field must stay unsigned.** Adding it to the GC_JOIN signed field
  set breaks verification on old Hubs that rebuild that set.
- **Protocol version 2 is a hard gate.** Any wire change must either ride it or
  keep the old form for peers at version 1.
- **`electron/` is a separate npm project.** Run `tsc` and `npm install` from
  inside `electron/`, not the repo root.
- **ESLint only covers `src/**`.** `electron/`has its own project; running`npx eslint electron/src/\*.ts` from the root produces bogus parse errors.
- **`src/components/QortalLand/QortalLand.tsx` is ~11k lines.** Search within it
  rather than reading it whole.

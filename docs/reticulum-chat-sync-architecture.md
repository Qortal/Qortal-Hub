# Reticulum Chat Sync Architecture

## Purpose

This document describes the current Reticulum chat sync model, why it does not scale well, and the target architecture we want for long-term correctness and performance.

The goal is not only to reduce noisy logs. The goal is to make Reticulum chat work well when:

- a user belongs to many groups,
- each group may have many active participants,
- overlay peers appear, disappear, or change often,
- Reticulum wire payloads are small,
- attachments and resource downloads are active,
- background unread/mention summaries must stay fresh,
- the active open chat must stay responsive.

## Current System

Reticulum chat currently uses a custom `RCHAT` protocol over the Reticulum overlay.

At a high level:

```text
Reticulum overlay
  -> RCHAT wire messages
  -> ReticulumChatManager
  -> SQLite event DB
  -> UI summaries / active chat / resource downloads
```

Events are signed and stored locally. The UI reads local history from SQLite and receives live events from the manager.

### History age and message expiry

Authenticated group history pages and exact-event downloads (including reply
recovery) validate old signed events without the live-event 30-day age cutoff.
The request itself must still be fresh. Event payload hashes, signatures,
future timestamp limits, group membership, channel permissions and response
scope checks still apply. Age alone must not count as a peer protocol violation
or abort a history page.

The database separately enforces channel and message expiry, deletion and
deduplication. Expired-event markers prevent a downloaded original from coming
back after expiry settings change. A valid but expired exact-event response
finishes its pending pull without emitting a message or retrying other peers.
Live/control traffic and relay-cache admission retain their existing freshness
limits.

### Current Background Subscription Flow

When the app loads the user's joined groups, the renderer sends all local group memberships to the main process and subscribes to each group.

```text
Group.tsx
  -> setLocalGroupMemberships(all joined group IDs)
  -> subscribeGroup(groupId) for each joined group
```

That means Reticulum chat subscribes to groups before the user opens a specific group chat. This is intentional because background summaries, unread counts, and mentions need to work from the group list.

### Current Subscribe Behavior

Today, `subscribeGroup()` is too eager. A group subscription sends a full sync starter pack:

```text
subscribeGroup(group)
  -> sub
  -> author_heads_req
  -> sync_req after latest local event
  -> sync_req before earliest local event
```

The peer replies with:

```text
author_heads
sync_hints
sync_hints
sync_hints
...
```

If any hinted event is missing locally, we request the full event:

```text
event_hint / sync_hints
  -> event_req for missing event
  -> event_offer / resource transfer for full event payload
```

### Current Active Chat Flow

When the user opens a group/channel:

```text
useReticulumGroupChat(group, channel)
  -> subscribeGroup(group)
  -> subscribeChannel(group, channel)
  -> getHistory(group, channel)
```

The active chat gets local DB history immediately. But the network sync path still overlaps with the same group subscription machinery used by background groups.

### Current Resource Flow

Attachments and large event payloads use the resource transfer path:

```text
resource_find (rf)
  -> resource_have from a verified provider
  -> direct linked byte-range resource transfer
  -> local resource store
```

This is conceptually separate from chat sync. RCHAT overlay messages only discover providers and route provider hints; the byte-range request is sent on the dedicated resource link after a provider is known.

Completed downloads can send signed replica-retention receipts. The wallet
signing policy allows the exact group and DM receipt fields. DM receipts use
a compact positional wire format to fit the 383-byte overlay limit: recipient,
file hash, size, retention deadline, provider peer hash, public key, timestamp,
and signature. File and peer hashes use the existing compact encodings; the
conversation ID is reconstructed from the signer and recipient. The signature
still covers the full original fields, including the conversation ID. Updated
receivers accept both compact and legacy object receipts, with the same
signature, sender, scope, and retention checks. Older receivers cannot process
the compact form; they need an update to record these DM receipts.

## Problems With The Current Model

### 1. Subscription Means Too Much

`sub` currently means:

```text
I am interested in this group.
Also send author heads.
Also send recent history.
Also send older history.
```

That is too much work for a background subscription.

### 2. Background Sync Can Behave Like Active Chat Sync

The app may be joined to many groups. Background group subscriptions are needed for summaries and mentions, but they should not trigger full history sync for every group.

Current behavior can scale like:

```text
joined groups * overlay peers * subscription replay * sync windows
```

That creates unnecessary `sub`, `author_heads_req`, `sync_req`, and `sync_hints` traffic.

### 3. Peer Churn Replays Too Much

When overlay peers change or the bridge recovers, subscriptions can be reannounced. Today that can replay full sync intent, not just liveness.

```text
peer changed
  -> reannounce subscriptions
  -> sub + author_heads_req + sync_req + sync_req
```

Peer churn should not cause history sync storms.

### 4. Sync Happens Before We Prove Anything Is Missing

The current system asks for history windows first, then dedupes after receiving hints.

```text
ask for history
  -> receive many hints
  -> discover most are already known
```

The better model is to exchange state first, then request exact missing data.

### 5. It Does Not Scale To Large Groups Cleanly

A group can have many users. The sync system must never depend on:

- full group membership lists,
- all authors in a group,
- all events in a group,
- all channels in one packet.

Sync must scale with actual missing event activity, not group size or network size.

## Target Architecture

The target architecture is:

```text
Local-first signed event-log replication
  + compact checkpoints/digests
  + cursor-based feed sync
  + exact missing-range repair
  + adaptive peer/source planner
  + strict priority scheduling
  + isolated resource transfer
```

In simpler terms:

```text
Reticulum = transport
RCHAT = replication protocol
SQLite = local source of truth
UI = local projection
resources = large object transfer
```

RCHAT should sync signed event logs, not chat screens.

## Core Concept

Every chat event is immutable and signed.

```text
eventId
groupId
channelId
authorAddress
authorSeq
timestamp
eventType
payloadHash
signature
```

Each author has an append-only event sequence within a group:

```text
Alice in group 716:
  seq 1
  seq 2
  seq 3

Bob in group 716:
  seq 1
  seq 2
```

Nodes do not sync users. They sync events.

There are two sync tools:

```text
Normal sync:
  group/channel feed cursors
  "I have this timeline up to event X"

Gap repair:
  author sequence ranges
  "I saw Bob seq 42 but only have Bob seq 39"
```

Author sequence state is important for integrity repair, but it must not be the main digest for large groups. A group can have many chatters, so the primary sync primitive must be bounded group/channel cursors.

## Cursor And Continuity Semantics

Cursor semantics must be deterministic. Every peer must agree on what "after this event" and "before this event" means.

### Feed Cursor

A feed cursor is a position in a group/channel timeline.

```text
feedCursor
  feedTimestamp
  eventId
```

The canonical feed order is:

```sql
ORDER BY feed_timestamp ASC, event_id ASC
```

All feed queries, feed responses, hashes, and comparisons must use this exact ordering. A cursor means "the position at this feedTimestamp/eventId in the canonical feed order".

The feed cursor is cross-author. It should not include `authorAddress` or `authorSeq`, because those fields describe a single author's append-only sequence, not the mixed channel timeline.

### Timestamp Trust

The signed event timestamp must not be trusted blindly for feed ordering.

The system should distinguish:

```text
signedTimestamp:
  timestamp inside the signed event
  retained as event metadata

acceptedAt:
  local receive/insert time
  useful for abuse handling and local projections

feedTimestamp:
  canonical timestamp used for feed ordering and cursors
```

Rules:

```text
if signedTimestamp is within accepted past/future bounds:
  feedTimestamp = signedTimestamp

if signedTimestamp is too far in the future or past:
  reject or quarantine the event

if suspicious events are accepted for diagnostics:
  feedTimestamp = acceptedAt
  keep signedTimestamp as metadata only
```

The existing event timestamp validation rules should be tightened around this model. A malicious or broken client must not be able to force an event far into the past or future and distort feed cursors, unread summaries, or sync windows.

### Author Cursor

An author cursor is used only for per-author integrity repair.

```text
authorCursor
  authorAddress
  authorSeq
```

Author cursors answer a different question:

```text
Do I have every event for this author up to this sequence?
```

Feed cursors and author cursors must not be treated as interchangeable.

### Latest Does Not Mean Complete

A latest cursor only proves freshness:

```text
I have seen an event at least as new as this cursor.
```

It does not prove continuity:

```text
I have every event before this cursor.
```

The implementation must not assume that having the latest event means there are no holes behind it.

Continuity must be tracked separately:

```text
background summaries:
  latest cursor is enough for freshness

active visible chat:
  visible window should be verified as continuous

author sequence gaps:
  repaired with author range requests
```

### Page Metadata

Every feed response should include page metadata:

```text
pageStartCursor
pageEndCursor
hasMore
windowHash
```

`windowHash` is a deterministic hash of the ordered event IDs in the returned page. It lets peers detect divergence when they believe they are talking about the same cursor window but have different local contents.

## Proposed Protocol Model

### 1. Hello

Peers announce the protocol version and runtime capabilities.

```text
hello
  version: 1
  features:
    digest
    feed_req
    range_req
    event_batch
    resource_v2
```

This is not a backward-compatibility layer. It is a sanity check so peers can reject unknown or incomplete protocol implementations instead of silently falling back to noisy behavior.

### 2. Group Subscription

`sub` becomes liveness and interest only.

```text
group_sub
  groups: [716, 812]
  mode: summary
```

It should not automatically mean "send me history".

### 3. State Digest

A digest says what local event state we already have.

```text
group_digest
  groupId: 716
  latestCursor:
    eventId: abc123
    feedTimestamp: 1782340000
  channels:
    general:
      latestCursor:
        eventId: abc123
        feedTimestamp: 1782340000
      oldestCursor:
        eventId: def456
        feedTimestamp: 1782330000
      visibleWindowHash: ...
  digestHash: ...
```

This is cursor based. A cursor is a bookmark that means "I have events up to this point" or "I have visible history back to this point".

The latest cursor is freshness state only. It is not a promise that all previous events are present locally.

For large groups, the digest remains bounded:

```text
group_digest
  groupId: 716
  latestCursor:
    eventId: abc123
    feedTimestamp: 1782340000
  channelCount: 100
  channels: limited page only
  moreChannels: true
```

The system never sends all authors for a huge group by default.

A small `recentAuthorSample` can exist as an optimization, but it must be optional, bounded, and never required for correctness.

```text
recentAuthorSample:
  max 10-50 authors
  recently observed locally
  used only to detect likely gaps faster
```

### 4. Feed Request

After comparing digests, request only missing feed pages.

```text
feed_req
  groupId: 716
  channelId: general
  after:
    eventId: abc123
    feedTimestamp: 1782340000
  limit: 25
```

The receiver must answer according to the canonical feed order:

```sql
WHERE (feed_timestamp > cursor.feedTimestamp)
   OR (feed_timestamp = cursor.feedTimestamp AND event_id > cursor.eventId)
ORDER BY feed_timestamp ASC, event_id ASC
LIMIT pageLimit
```

For older visible history:

```text
feed_req
  groupId: 716
  channelId: general
  before:
    eventId: def456
    feedTimestamp: 1782330000
  limit: 25
```

Older history uses the inverse cursor comparison but still returns events in canonical ascending order.

### 5. Gap Repair Request

Author sequence ranges are used only when a received event or hint proves a gap for a known author.

```text
range_req
  groupId: 716
  ranges:
    Bob: 19-20
    Carol: 8-12
```

This should not require enumerating every author in the group.

### 6. Event Batch

The peer returns compact event envelopes or full events only when they fit.

```text
event_batch
  groupId: 716
  channelId: general
  pageStartCursor:
    eventId: event-a
    feedTimestamp: 1782340100
  pageEndCursor:
    eventId: event-z
    feedTimestamp: 1782340200
  hasMore: true
  windowHash: ...
  events:
    ...
```

Oversized event payloads continue through the resource path.

The `windowHash` is computed from the ordered event IDs in `events`. It is not a security primitive; event signatures still provide authenticity. It is a cheap divergence detector.

### 7. Resource Transfer

Attachments and large event blobs remain separate:

```text
resource_find (rf)
  -> resource_have
  -> linked byte-range resource transfer
```

Resource transfer should not be starved by background sync traffic. Overlay discovery stays bounded, and bulk/request bytes stay on the direct resource link.

## Background Vs Active Sync

The target design splits sync into two tiers.

### Background Group Sync

Used for:

- unread counts,
- mentions,
- latest summaries,
- notification readiness.

Behavior:

```text
background group membership
  -> group_sub summary
  -> compact cursor digest pages
  -> newest missing feed pages only when needed
```

Background sync must be cheap, low priority, and bounded.

It must not pull full history for every joined group.

### Active Chat Sync

Used when the user opens a group/channel.

Behavior:

```text
active channel opened
  -> load local history immediately
  -> active channel cursor digest
  -> request missing visible feed pages
  -> page older history only when user scrolls
```

Active chat gets higher priority than background group sync.

## Priority Scheduler

RCHAT should have a small internal scheduler so not all work competes equally.

Suggested priorities:

```text
P0 live active chat hints
P1 active chat missing event pulls
P2 channel metadata for open group
P3 resource transfer control
P4 background unread/mention sync
P5 periodic subscription refresh
```

Rules:

- Active chat should stay responsive.
- Background sync must yield during resource transfers.
- Periodic refresh must never flood the bridge.
- Duplicate control messages should be suppressed before sending.

## Peer Planner

Overlay peers are sources, not state owners.

The planner should track:

```text
peer health
groups peer appears useful for
last successful event/resource response
recent failed requests
known digest/cursor state
in-flight requests
```

Then decide:

```text
what is missing?
which peer likely has it?
how urgent is it?
have we asked recently?
will it fit in one wire?
is a resource transfer active?
```

This prevents repeated requests to bad peers and avoids duplicating work across peers.

## Wire Size Strategy

Every control message must be pageable and checked before sending.

```text
Build page:
add next group/channel/range
  check wireFitsReticulum()
  if too large, flush current page
```

If even a single group digest is too large:

```text
send minimal group checkpoint:
  groupId
  latest cursor
  channelCount
  digestHash
```

The peer can request detailed pages only if needed.

## Cursor Edge Cases And Conflict Rules

The cursor rules must be explicit so different implementations do not diverge.

### Same Feed Timestamp

If two events have the same `feedTimestamp`, the canonical tie-breaker is `eventId`.

```text
ORDER BY feed_timestamp ASC, event_id ASC
```

This rule applies everywhere:

- local DB queries,
- digest generation,
- feed requests,
- event batches,
- window hashes,
- cursor comparisons.

### Late Older Event

If a valid event arrives later with a `feedTimestamp` older than the current latest cursor:

```text
insert it into the local event DB normally
do not move latest cursor backward
update or invalidate affected verified windows
trigger repair only if it affects an active visible window or summary range
```

The latest cursor is monotonic forward. It represents freshness, not complete history.

### Overlapping Feed Page

If a feed page overlaps events we already have:

```text
dedupe by eventId
validate any duplicate event if needed
verify windowHash if this is a known comparable window
continue from pageEndCursor
```

The sync cursor advances from the page metadata, not from the last newly inserted event. This prevents getting stuck on pages that are mostly duplicates.

### Peer Sends Events Outside Requested Bounds

If a peer returns events outside the requested `feed_req` bounds:

```text
ignore out-of-bounds events for that response
do not update peer cursor from the invalid page
record a peer protocol violation
penalize the peer if violations repeat
```

This prevents one bad peer from poisoning local cursor state.

### Duplicate Event

If the same `eventId` arrives again:

```text
if stored event hash/signature matches:
  ignore as duplicate

if stored event hash/signature differs:
  reject as conflict/malicious
  record diagnostic evidence
```

The event ID is immutable. A different payload or signature for the same `eventId` must never replace local state.

### Window Hash Mismatch

If two peers claim the same cursor window but provide different `windowHash` values:

```text
do not mark the window verified
request the page from another peer if available
fall back to exact event ID/range repair if needed
penalize peers that repeatedly disagree with valid majority data
```

The window hash is a divergence detector. Event signatures remain the authority for individual event validity.

## Initial Implementation Constants

The protocol must define concrete limits before implementation. Without shared constants, two correct-looking implementations can behave very differently under load.

These are initial defaults. They should be tuned from live metrics, but every implementation should start from the same bounded behavior.

```text
MAX_FEED_PAGE_EVENTS = 25
MAX_DIGEST_GROUPS_PER_PAGE = 20
MAX_GROUPS_PER_SUB_PAGE = 50
MAX_DIGEST_CHANNELS_PER_GROUP = 16
MAX_RECENT_AUTHOR_SAMPLE = 20

MAX_IN_FLIGHT_PER_PEER = 4
MAX_IN_FLIGHT_ACTIVE = 8
MAX_IN_FLIGHT_BACKGROUND = 8
MAX_BACKGROUND_WORK_PER_TICK = 10
SYNC_TICK_MS = 250

DIGEST_DEDUPE_TTL_MS = 30_000
BACKGROUND_DIGEST_REFRESH_MS = 60_000
ACTIVE_DIGEST_REFRESH_MS = 10_000

TIMESTAMP_FUTURE_TOLERANCE_MS = 5 * 60_000
TIMESTAMP_PAST_TOLERANCE_MS = 30 * 24 * 60 * 60_000

PEER_VIOLATION_COOLDOWN_MS = 5 * 60_000
MAX_PEER_VIOLATIONS_BEFORE_COOLDOWN = 3
```

Meaning:

- `MAX_FEED_PAGE_EVENTS` bounds event batch size.
- `MAX_DIGEST_GROUPS_PER_PAGE` and `MAX_GROUPS_PER_SUB_PAGE` prevent group membership replay from becoming one huge packet.
- `MAX_DIGEST_CHANNELS_PER_GROUP` prevents a large group with many channels from filling one digest.
- `MAX_RECENT_AUTHOR_SAMPLE` is only an optimization hint. Correctness must not depend on it.
- `MAX_IN_FLIGHT_*` prevents one peer or background sync from occupying the whole scheduler.
- `MAX_BACKGROUND_WORK_PER_TICK` and `SYNC_TICK_MS` make background sync cooperative.
- timestamp tolerances protect feed ordering from broken or malicious device clocks.
- peer violation cooldown prevents repeated malformed pages from wasting bandwidth.

All message builders must still call `wireFitsReticulum()`. These constants are upper bounds, not permission to exceed the real wire limit.

## Data Model Additions

The immutable event table remains the source of truth.

Useful additions:

```text
rchat_peer_group_state
  peer_hash
  group_id
  latest_event_id
  latest_feed_timestamp
  digest_hash
  updated_at

rchat_peer_channel_state
  peer_hash
  group_id
  channel_id
  latest_event_id
  latest_feed_timestamp
  oldest_event_id
  oldest_feed_timestamp
  visible_window_hash
  updated_at

rchat_verified_windows
  group_id
  channel_id
  start_event_id
  start_feed_timestamp
  end_event_id
  end_feed_timestamp
  window_hash
  verified_at

rchat_missing_ranges
  group_id
  author_address
  from_seq
  to_seq
  preferred_peer
  attempts
  next_attempt_at

rchat_sync_queue
  priority
  group_id
  channel_id
  peer_hash
  operation
  dedupe_key
  next_attempt_at
```

Projection data remains local:

```text
summaries
mentions
search index
channels/categories
read watermarks
```

These are derived from events, not synced as primary state.

## Required Database Indexes

The sync design depends on fast cursor and repair queries. These indexes should exist before enabling the new protocol.

The existing immutable event table should keep `event_id` as its unique event identity. If the table remains named `reticulum_chat_events`, use indexes like:

```sql
CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_feed
ON reticulum_chat_events(group_id, channel_id, feed_timestamp, event_id);

CREATE INDEX IF NOT EXISTS idx_reticulum_chat_events_author_seq
ON reticulum_chat_events(group_id, author_address, author_seq);
```

The new sync state tables should have:

```sql
CREATE INDEX IF NOT EXISTS idx_rchat_sync_queue_ready
ON rchat_sync_queue(priority, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_rchat_peer_channel_state
ON rchat_peer_channel_state(peer_hash, group_id, channel_id);

CREATE INDEX IF NOT EXISTS idx_rchat_peer_group_state
ON rchat_peer_group_state(peer_hash, group_id);

CREATE INDEX IF NOT EXISTS idx_rchat_missing_ranges_ready
ON rchat_missing_ranges(group_id, author_address, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_rchat_verified_windows_lookup
ON rchat_verified_windows(group_id, channel_id, start_feed_timestamp, end_feed_timestamp);
```

If the event table is renamed during the rewrite, keep the same index shapes on the replacement table.

## Current Vs Proposed

### Current

```text
subscribe / replay
  -> send sub
  -> send author_heads_req
  -> send sync_req after
  -> send sync_req before
  -> receive many sync_hints
  -> dedupe after traffic already happened
```

### Proposed

```text
subscribe / replay
  -> send liveness sub
  -> send compact cursor digest
  -> compare state
  -> request missing feed pages or exact repair ranges
  -> transfer only missing events/resources
```

## Implementation Plan

This design should replace the current eager sync model directly. Since this is not production protocol compatibility work, the implementation should remove the old behavior instead of carrying it indefinitely.

### 1. Define The New Wire Protocol

- Define implementation constants and database indexes first.
- Add `hello`.
- Add `group_sub`.
- Add `group_digest`.
- Add `feed_req`.
- Add `range_req`.
- Add `event_batch`.
- Use `resource_find` / `resource_have` for resource provider discovery.
- Send byte-range resource requests only after opening the dedicated provider link.
- Every message builder must use `wireFitsReticulum()` while paging.

### 2. Replace Subscription Semantics

- `subscribeGroup()` becomes background-light.
- Group subscription sends only `group_sub` and bounded summary digest work.
- Subscription replay sends liveness/digest only.
- Remove automatic `author_heads_req`, `sync_req after`, and `sync_req before` from group subscription.
- `subscribeChannel()` becomes the active chat sync trigger.

### 3. Build Cursor Digest Sync

- Add group-level latest cursors.
- Add channel-level latest and oldest cursors.
- Build bounded digest pages by group/channel.
- Store peer digest/cursor state.
- Define and enforce canonical feed ordering everywhere.
- Use validated `feedTimestamp`, not raw signed timestamps, for feed cursors and ordering.
- Reject or quarantine events with timestamps outside accepted bounds.
- Track latest freshness separately from verified continuity.
- Suppress duplicate digest pages per peer/group/channel.

### 4. Build Feed Requests And Event Batches

- Compare peer cursors with local cursors.
- Request newer feed pages with `feed_req after`.
- Request older visible pages with `feed_req before` only for active chat or scrollback.
- Return `event_batch` pages that always fit the wire limit.
- Include `pageStartCursor`, `pageEndCursor`, `hasMore`, and `windowHash` in every event batch.
- Verify active visible windows independently from latest freshness.
- Use resource transfer for oversized event payloads.

### 5. Keep Author Sequence Repair

- Keep `authorSeq` validation on every event.
- When an inbound event proves a known author's sequence gap, enqueue `range_req`.
- Do not enumerate all authors for a group.
- Treat author heads as optional bounded repair/diagnostic data only.

### 6. Add Scheduler And Peer Planner

- Prioritize active chat and resource control.
- Track peer usefulness and failures.
- Add per-peer/per-group dedupe keys.
- Cap background work per tick.
- Keep background sync low priority.
- Make resource transfer control higher priority than background digest chatter.

### 7. Update Resource Transfer Integration

- Keep resource bytes on the existing resource transfer path.
- Keep event/resource manifests as signed chat events.
- Ensure resource progress/events are coalesced so transfer UI does not flood the bridge.
- Ensure background sync yields while large resource transfers are active.

### 8. Remove Legacy Eager Sync Paths

- Remove subscription-triggered `author_heads_req`.
- Remove subscription-triggered `sync_req after`.
- Remove subscription-triggered `sync_req before`.
- Remove automatic continuation behavior that can create unbounded `sync_hints` bursts.
- Replace `sync_hints` with bounded `event_batch` responses.

### 9. Add Diagnostics And Tests

- Log digest pages sent/skipped.
- Log feed requests and event batches.
- Log duplicate suppression.
- Log scheduler queue depth by priority.
- Test many groups, large groups, peer churn, active chat, background summaries, and resource transfer under load.

## Success Criteria

- Subscribing to many groups does not create a sync storm.
- Overlay peer churn causes small digest/liveness traffic only.
- Background summaries remain fresh.
- Active chat receives missing visible events quickly.
- Large resource downloads are not slowed by background sync chatter.
- `sync_hints` volume drops sharply for already-synced peers.
- Bridge event queue does not build multi-second backlogs during normal chat/resource use.
- Wire-size violations are impossible by construction.
- No protocol step depends on enumerating all group members or all group authors.
- Author heads are optional repair/optimization data, not the primary sync state.

## Final Principle

The final system should behave like this:

```text
Local DB is truth.
Peers exchange compact state.
Planner fetches missing feed pages and exact repair gaps.
UI renders local projections.
Large bytes use resource transfer.
```

That is the scalable foundation for Reticulum chat.

# PR #426 — remaining issues

Four items are still open after the fix commits and the Q-Chat review. Three are
provenance gaps: the code behaves correctly but nothing in the change explains
why it exists, so only the author can close them. One is a real correctness
defect whose obvious fix conflicts with another fix in the same PR, so it needs a
decision rather than a patch.

Checked against the working tree on 20 November 2026, with
`PR Reviews/pr-426-fixes-check-2026-11-19.md` as the input.

---

## 1. A remote read can hide a message sent after it

**Severity:** low–medium. **Status: implemented** — per-author coverage, see
"Implementation" at the end of this section.

### What happens

A read receipt from another device is stored as a single sender-time value,
`reticulum_chat_read_watermarks.remote_covered_timestamp`. That one number is
then compared against **event timestamps authored by different people**, in two
places in [`electron/src/reticulum-chat-db.ts`](electron/src/reticulum-chat-db.ts):

- line 11784, the unread branch:
  `if (remoteCoverage > 0 && event.timestamp <= remoteCoverage) return false;`
- line 11795, `const senderTimeBoundary = Math.max(watermark, remoteCoverage)`,
  which feeds the reply and mention counters.

That comparison is only valid if both sides come from the same clock. They do
not: `event.timestamp` is the **authoring sender's** clock, while
`remoteCoverage` arrived from a **different sender's** clock. Sender time is
per-author; the boundary is global to the channel.

### Reproduction, with numbers

Sender S's clock runs 30 seconds ahead.

1. S sends M1 at `T_s = real + 30s`.
2. Device A reads M1. The receipt carries `upToTimestamp = T_s`, signed at
   `signedAt ≈ real`.
3. Device B stores `remoteCoverage = real + 30s`.
4. Member C, whose clock is correct, sends M2 at `real + 1s`.
5. On device B: `M2.timestamp (real+1) <= remoteCoverage (real+30)`, so M2 is
   counted **read**. Nobody has read it.

Device A counts M2 unread, which is right. The two devices disagree about the
same channel, and B's badge is wrong.

### Why the obvious fix does not work

The report suggested capping coverage at the receipt's own `signedAt`, so a
message sent after the read can never be covered. That makes it worse, because
the receipt's two timestamps are deliberately far apart.

`verifyReticulumChatReadSyncWire` allows `upToTimestamp` up to **5 minutes** ahead
of local time (`RETICULUM_CHAT_MAX_FUTURE_SKEW_MS`, `reticulum-chat.ts:2184`) but
`signedAt` only **30 seconds** (`RETICULUM_CHAT_CONTROL_MAX_FUTURE_SKEW_MS`,
`reticulum-chat.ts:2188`). For a fast sender, `upToTimestamp > signedAt` by
design — that gap is what lets a sender whose clock is ahead have their read
recorded at all.

Cap coverage to `signedAt ≈ real` and run the case the #4 fix exists for:

1. S (clock +30 s) sends M1 and M2, at `real+30` and `real+31`.
2. B reads both, so coverage is `real+31`; capped at `signedAt ≈ real`, it
   becomes `real`.
3. M1 and M2 now sit **above** the boundary and are counted **unread** on B,
   although B read them.

That is exactly the false-unread that `remote_covered_timestamp` was added to
prevent, on the case it was added for. Capping does not fix this defect; it
relocates it.

### Proposed fix: record coverage per author, not per channel

The problem is the **key**, not the timestamp. Sender time is comparable only
within one author's stream, so coverage has to be stored per author.

The clock-free identifier already exists: `author_seq`, monotonic per author and
stream. It is already used for gap tracking (`stmtGetAuthorSequenceGaps` reads it
per author out of `reticulum_chat_events`, alongside
`rchat_missing_stream_ranges`), and there is already an index that serves a
per-author lookup: `reticulum_chat_author_stream_seq_idx` on
`(group_id, author_address, author_stream_id, author_seq)`,
[`reticulum-chat-db.ts:13738`](electron/src/reticulum-chat-db.ts:13738).

- The receipt would carry, for each author whose events the reader saw, that
  author's highest `author_seq`.
- A message counts as read when its own `(author, author_seq)` is at or below the
  recorded value.
- M2 from author C has no entry, so it stays unread, whatever any clock says.

This is the pattern the codebase already chose for **local** reads. `markRead`
does not trust sender time either: when the local watermark is unreliable it
falls back to `messageArrivalOrder(event) > readMoment`, an arrival counter that
cannot be skewed by a clock. Local reads are immune to this defect precisely
because they never compare across clocks. Remote reads are the last path still
doing it.

### Tradeoffs

- **Wire format change.** `ReticulumChatReadSyncWire` gains an optional `cov`
  field carrying `[author, stream, seq]` triples, and the signed field set gains
  a `coverage` array. Rather than change `RCHAT_READ_SYNC_V1` in place, which
  would break every unupgraded peer mid-rollout, a receipt that carries coverage
  signs as `RCHAT_READ_SYNC_V2` and one that does not still signs as `V1`. Both
  schemas are in `src/background/reticulum-signing-policy.ts:366` and both are
  accepted. The cost is two receive paths, which is the deliberate trade.
- **Schema and migration.** A companion table,
  `reticulum_chat_read_author_coverage`, keyed
  `(group_id, channel_id, address, author_address, author_stream_id)` holding the
  highest covered `author_seq`. Existing `remote_covered_timestamp` values cannot
  be attributed back to authors, so they stay on the scalar path as the
  fast-sender-only approximation they are. An upgrade therefore re-badges some
  already-read history only until each device performs its next read, and only
  for peers still sending V1.
- **Cost on the hot path.** The per-channel count now needs a per-author lookup
  instead of a single scalar compare. The lookup is bounded by the number of
  authors in a channel, and `reticulum_chat_author_stream_seq_idx` already leads
  with the right columns, so the read side is an index seek rather than new query
  complexity. The write side gains one upsert per author per receipt.
- **Semantic change.** "Read" stops meaning "before this instant" and starts
  meaning "at or before this point in each author's stream". That is more correct
  under clock skew but is a genuine change of meaning across devices, and should
  be agreed before it ships rather than discovered in a bug report.

### Implementation

Built as designed above.

- **Storage.** `reticulum_chat_read_author_coverage`, keyed
  `(group_id, channel_id, address, author_address, author_stream_id)` with a
  monotonic `covered_seq`. One row per author the reader has caught up with.
- **Counting.** `computeChannelSummary` loads the map once and tests
  `coveredSeq >= event.authorSeq` per event, in the unread branch and in every
  reply and mention counter. Sender time is no longer consulted for a V2 receipt.
- **Wire.** `RCHAT_READ_SYNC_V2` carries `cov: [[author, stream, seq], ...]`,
  bounded to 200 entries and validated field by field. `RCHAT_READ_SYNC_V1` is
  still accepted and still applied by sender time, so an unupgraded peer is
  honoured approximately rather than ignored.
- **Signing.** The coverage is part of the signed field set, so it cannot be
  forged or widened in transit. Both versions are in the signing policy.
- **Sender.** The receipt carries each author's highest seq at or below the read
  timestamp. That coverage is recomputed when the receipt is signed rather than
  stored with the pending row, because `rchat_pending_device_read_state` has no
  coverage column and a replay after a restart would otherwise downgrade the
  receipt to V1.
- **Receiver.** A V2 receipt writes per-author rows and deliberately touches
  neither the scalar nor the channel-wide watermark — see the first defect below
  for why the watermark mattered.
- **Render state.** `readByOwner` consults `isEventCoveredByReadState`, which
  checks per-author coverage first and the watermark second. Checking the
  watermark alone left messages already read on another device still rendering
  as unread, because a V2 receipt no longer moves it.

Four tests cover the cases that pull in different directions:

- a fast sender's read no longer covers a different author's later message;
- messages from the same author at or below the covered seq stay read;
- a manager-level round trip that asserts the wire actually carries `cov`, the
  receiving device reads the covered author and not the other, the channel-wide
  watermark stays at 0, and the covered author's mention badge clears. That last
  assertion matters because a V2 receipt sets no `read_at` on the stored mention
  row, so the badge depends entirely on the per-author check;
- a **V1** receipt with no per-author data still over-covers, asserted as
  `unreadCount === 0` with a comment saying so. That is a characterisation of the
  unupgraded path, not a restored defect — there is nothing to compare per author
  on a V1 receipt, so honouring the peer's read approximately is the lesser evil
  versus ignoring it and resurrecting messages they have seen. The test exists so
  that if the behaviour ever changes it changes deliberately.

The DB-level tests were mutation-tested: neutering the per-author predicate made
the first fail with `expected 1 to be +0`, confirming it is bound to the fix
rather than passing incidentally. Full suite 6,206 passing, lint clean,
production build passing.

### Four defects found while verifying this implementation

Worth recording, because the first three were in my own work and none of them
were caught by the tests I had written to that point. All four were found by
driving the real call path instead of the accessors directly.

- **The receiver re-created the bug.** `handleReadSync` called
  `db.markRead(state.upToTimestamp)` on a V2 receipt as well as writing the
  per-author rows. `markRead` writes the channel-wide watermark, so a fast
  sender's timestamp covered a correctly-clocked author's later message again —
  the precise over-coverage the new table exists to remove, restored in the same
  function whose comment claimed to prevent it. The V2 path now writes coverage
  only; V1 keeps the old call. This was invisible to the DB-level tests because
  they never called `markRead`.
- **V2 was dead code in the sender.** `buildSignedReadState` signed the coverage
  but never copied it onto the state object, and `deviceReadStateToWire` only
  emits `cov` when the state has it. Every group receipt therefore shipped as
  V1, with nothing to indicate the coverage had been dropped. The existing
  group read-sync test could not catch it: the sending device holds no events for
  the channel, so its coverage is legitimately empty and it signs V1 anyway.
- **`readByOwner` was never updated.** It compared `event.timestamp` to the
  watermark, so once a V2 receipt stopped moving the watermark, messages the
  account had already read on another device rendered as unread. Added
  `isEventCoveredByReadState`, with a per-scope cache so the render path does not
  issue one query per event; the cache is dropped whenever a receipt writes rows.
- **The test double hid all three.** `src/test/mocks/betterSqlite3.ts` matched
  `FROM rchat_event_headers` with a catch-all handler that treated its arguments
  as a paged feed query. The coverage query — a `GROUP BY author, stream` with
  `MAX(author_seq)` — fell into it and returned `[]`, so coverage was always
  empty under test while the same SQL was correct against real SQLite. A
  handler for that shape now sits ahead of the catch-all.

### Correction after the 20 Nov review: coverage cannot ride the receipt

The 20 November review of `6ec5d82b` raised two design objections to the V2 receipt.
One was right and one led to something bigger.

- **Right, and fixed.** A V2 receipt is unverifiable by every released Hub, because
  each rebuilds the V1 field set and checks the signature against it. Reads taken
  on an updated device therefore stopped reaching that account's other, unupdated
  devices — the direction the first doc did not consider. The receipt now signs
  exactly the frozen V1 fields again, and the coverage is signed separately.
- **Bigger than either review anticipated.** The separate signature was still
  attached to the receipt, and that cannot work: `RT_RETICULUM_MAX_WIRE_JSON_BYTES`
  is 383, a bare group receipt measures 287, and one coverage entry costs 84.
  One entry plus a signature is 468 bytes. `wireFitsReticulumChat` rejected the
  oversized wire, and because `deviceReadStateToWire` returns `null` when that
  happens, **nothing was sent at all** — not the receipt, not the coverage. The
  earlier "verified" item C therefore shipped a version that silently dropped
  every group read receipt on any channel where the reader held an event. The
  DB-level tests could not see it; only driving `buildSignedReadState` and
  checking the wire did.

The shape that fits is one coverage entry per wire. A `read_cov` wire carrying a
single entry is 360 bytes. So:

- the receipt is plain V1 again, byte-identical to what every released Hub
  verifies;
- coverage travels on its own `read_cov` wires, one author each, signed over its
  own payload and bound to the receipt's identity so it cannot be replayed onto
  another channel or another read;
- coverage is sent **before** the receipt, and awaited. The receiver treats
  "this channel already has per-author coverage" as the signal to skip the
  channel-wide watermark, which is the number that caused the original
  over-coverage. Sending the receipt first made that a race.
- neither half is required for the other: a lost or reordered coverage wire
  degrades to the sender-time approximation that shipped before, never to a lost
  read.

Also fixed from the same review: coverage is now bounded by this device's own
arrival record (`stored_at <= local_read_at`) rather than the receipt's sender
timestamp, which was comparing across clocks on the reading device too.

Still open, deliberately: the reply and mention badge counters on the reading
device itself still compare sender time. That is a separate path from remote
reads and is not addressed here.

### Self-correction worth recording

`PR Reviews/pr-426-fixes-check-2026-11-19.md` notes that its side-effect test
"passed before and fails now". The SQL counters already used `senderTimeBoundary`
before any of this work, so the over-coverage existed there. The in-memory
comparisons in the mention counting did not, and aligning them to the same
boundary moved the symptom into a path that had been correct. Aligning them was
still right — the in-memory and SQL counters disagreeing is its own defect — but
it widened where this problem surfaces rather than containing it, and that is
worth knowing before the real fix is sequenced.

---

## 2. Hide-muted-channel behaviour has no stated intent

**Severity:** low, but it is a user-visible feature, not a refactor.
**Status:** open, needs the author's rationale.

- **Where:** [`src/components/Chat/ChatGroup.tsx:2369`](src/components/Chat/ChatGroup.tsx:2369)
  and the effect at 2372–2420.
- **What it does:** when a group has `hideMutedChannels` on, this effect moves
  the reader off a muted channel to the first unmuted one. Alongside it, muted
  channels are filtered out of the sidebar while the selected channel and any
  channel with an unread mention are kept, and muted rows are dimmed with their
  badges dropped.
- **Why it is flagged:** the nearest commit, `c2b0fa0e`, says only that _"Muted
  channels are now excluded from all channel count functions, such as the
  GroupsWidget and the returningUserActivityDashboard"_. That is about counts.
  Nothing in the change describes automatic channel switching, sidebar
  visibility, or badge removal.
- **Why it matters:** a reviewer cannot tell which of these were intended. Three
  separate behaviours are riding on one unmentioned flag, and one of them
  changes where the application takes the user without being asked.
- **What would close it:** one sentence in the PR description or a commit body
  saying whether hide-muted means "hidden from lists", "unreachable by
  automatic selection", or both. If only the first was intended, the auto-switch
  effect should go.
- **Related:** the auto-switch effect now skips a muted channel that holds an
  unread mention, so the row the sidebar deliberately keeps on screen is
  reachable. That inconsistency is fixed; the intent question is not.

---

## 3. The notification bell's Hub section no longer has a settings surface

**Severity:** low, but a toggle disappeared without being mentioned.
**Status:** open, needs the author's rationale.

- **Where:** [`src/components/GeneralNotifications.tsx:744`](src/components/GeneralNotifications.tsx:744).
- **What changed:** the whole `reticulumEnabled ? … : …` block under the `hub`
  tab was replaced with a fixed caption reading _"No Q-Apps have notification
  permission yet."_
- **Why it is flagged:** the removal is not described anywhere. `55a4637` says
  only that _"Q-Chat notifications are cleared when a chat is read"_. Removing a
  user-facing switch is a visible behaviour change, and the bell now tells the
  user nothing about Q-Chat notification settings at all.
- **Additional detail found while checking this:** the helpers
  `getQChatMentionNotificationsEnabled` and
  `setQChatMentionNotificationsEnabled`
  ([`src/utils/qChatMentionNotifications.ts:11`](src/utils/qChatMentionNotifications.ts:11))
  now have **no runtime caller anywhere** in `src/` or `electron/` — only their
  own test imports them. The `q-chat-mention-notifications-disabled` key is by
  now read only by the migration. So mentions are no longer gated by a global
  switch; they are governed by per-channel push levels.
- **Why that matters:** if per-channel settings are the intended replacement,
  this is a coherent migration and only the silence is the problem. If not, a
  user's "don't notify me about mentions" preference has no UI and no effect.
  Those are very different outcomes and the diff does not distinguish them.
- **What would close it:** state whether the global mention switch was retired
  in favour of per-channel push levels. If it was, delete the now-dead helpers
  and their test rather than leaving an exported API nothing calls. If it was
  not, the UI needs restoring.

---

## 4. Bell-entry clicks now also switch tabs, with no stated intent

**Severity:** low. **Status:** open, needs the author's rationale.

- **Where:** [`src/components/GeneralNotifications.tsx:404`](src/components/GeneralNotifications.tsx:404),
  and the same pattern at 422 and 438.
- **What changed:** each of the three click handlers now calls
  `setPendingNotificationNav({...})` immediately before the existing
  `executeEvent(...)`, and follows it with `openQChatTab()`.
- **Why it is flagged:** clicking a bell entry now also switches the active tab.
  No commit sentence describes it. The nearest commit, `55a4637`, covers only
  notification _clearing_ on Linux.
- **Why it matters:** navigation changes are what users notice first, and a
  buffered-navigation mechanism (`src/utils/notificationClickBuffer.ts`) is being
  wired up here whose consumer is outside this diff. Half a mechanism visible in
  a review is not reviewable.
- **What would close it:** a sentence naming the bug this fixes — for example
  "a bell entry clicked while a different tab was open opened the right chat but
  left the wrong tab visible" — plus a pointer to where the buffer is consumed.

---

## Summary

| #   | Item                                             | Kind                                                                                               | Who closes it                                    |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Remote read hides a message sent after it        | correctness — **implemented** (per-author coverage on separate `read_cov` wires; receipt stays V1) | closed, pending review                           |
| 2   | Hide-muted-channel behaviour                     | provenance gap                                                                                     | author states the intent                         |
| 3   | Bell Hub section emptied, mention toggle retired | provenance gap, plus dead exported API                                                             | author states the intent; then delete or restore |
| 4   | Bell clicks switch tabs                          | provenance gap                                                                                     | author states the intent                         |

Item 1 is written and tested. The three provenance gaps still need the author:
each describes code that works but that no commit explains, and only the author
knows whether the behaviour was intended.

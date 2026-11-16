# Q-Chat Notifications

A comprehensive reference for every notification mechanism in Qortal Hub's
Q-Chat system — channel unread indicators, group unread indicators, mention
push notifications, call notifications, missed-call alerts, and more.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Channel Notifications (per-channel unread)](#2-channel-notifications-per-channel-unread)
3. [Group Notifications (per-group unread)](#3-group-notifications-per-group-unread)
4. [Mention / Push Notifications](#4-mention--push-notifications)
5. [Direct Message Notifications](#5-direct-message-notifications)
6. [Call Notifications](#6-call-notifications)
7. [Announcement Notifications](#7-announcement-notifications)
8. [General Bell / Notification Center](#8-general-bell--notification-center)
9. [OS / Desktop Notifications](#9-os--desktop-notifications)
10. [Audio / Sound Notifications](#10-audio--sound-notifications)
11. [App / Dock Badge](#11-app--dock-badge)
12. [Notification Settings](#12-notification-settings)
13. [Quick Reference Table](#13-quick-reference-table)

---

## 1. Overview

Q-Chat notifications span several layers:

- **In-app visual indicators** — red dots, count badges, and colored icons
  rendered in group lists, DM sidebars, the desktop footer, and the
  notification-center bell.
- **OS / desktop push notifications** — system-level notifications fired via the
  browser `Notification` API (or Electron wrapper) for mentions, DM messages,
  and calendar reminders.
- **Audio notifications** — a synthesized ringtone for incoming DM voice calls.
- **App / dock badge** — the OS taskbar/dock badge reflecting total mention
  count.

Notification state is managed through:

- **Jotai atoms** in `src/atoms/global.ts` — derived unread booleans, per-group
  summaries, and the central `paymentNotificationsAtom` notification store.
- **Reticulum chat summaries** — per-group and per-channel `unreadCount`,
  `mentionCount`, and `readThroughTimestamp` maintained by the Electron main
  process and surfaced to the renderer via `window.reticulumChat`.
- **CustomEvent bus** — `executeEvent` / `subscribeToEvent` from
  `src/utils/events` for cross-component signalling (e.g.
  `q-chat-mention-notification`, `markAsRead`).

---

## 2. Channel Notifications (per-channel unread)

### Trigger

When a new message is published to a channel the user has not yet read, the
channel's `unreadCount` in its `reticulumChatSummary` entry increments. The
summary lives in `reticulumChatSummary.channels[]` and the
`reticulumChannelSummariesById` Map in `src/components/Chat/ChatGroup.tsx`.

### Display

- A **small red dot** (or red count badge) appears next to the channel name
  when `unreadCount > 0`.
- The red count badge is rendered by
  `src/components/common/ReticulumUnreadCountBadge.tsx`, which uses the color
  `#f23f42` (`RETICULUM_NOTIFICATION_RED`). When the count exceeds 99, it
  displays `99+`.
- Channel unread state is **aggregated up to the group level** — the group icon
  shows a red badge whenever any channel within the group has unread messages.
  There is no separate channel-level red dot in the sidebar beyond the
  group-level aggregation.

### Clear / Dismiss

- **Auto mark-read** — `src/components/Chat/ChatGroup.tsx` (lines ~5900–5944):
  an effect computes the latest visible message timestamp and calls
  `window.reticulumChat.markRead(groupId, channelId, upToTimestamp, myAddress)`,
  then fires `reticulum-chat-summaries-refresh` to update the summaries.
- **Explicit acknowledge** — `acknowledgeReticulumUnreadMessages` in
  `ChatGroup.tsx` (lines ~5946–6004): same `markRead` call plus a summaries
  refresh.
- **Join unread baseline** —
  `src/components/Chat/reticulumJoinUnreadBaseline.ts` (lines 162–237): when a
  user joins a group, all channels are marked read up to the `joinedAt`
  timestamp so pre-join history does not appear as unread.

### Key Files

| File                                                  | Role                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `src/components/Chat/ChatGroup.tsx`                   | Auto mark-read effect, explicit acknowledge, channel summaries |
| `src/components/common/ReticulumUnreadCountBadge.tsx` | Red count badge component                                      |
| `src/atoms/global.ts`                                 | `isUnreadChatAtomFamily` (per-group unread boolean)            |
| `src/components/Chat/reticulumJoinUnreadBaseline.ts`  | Join-time unread baseline                                      |

---

## 3. Group Notifications (per-group unread)

### Trigger

A group is considered unread when its `reticulumChatSummary` has
`unreadCount > 0`, `mentionCount > 0`, or `hasUnreadMention === true`. For
legacy (non-Reticulum) chats, a 15-minute window
(`TIME_DIFF_UNREAD_CHATS_MS = 900000`, `src/atoms/global.ts` line 836) is used:
if the latest message timestamp is more recent than the user's last
`timestampEnterData` and within 15 minutes, the group is unread.

### Display

Three locations show group-level unread indicators:

1. **Group list — rail mode** (`src/components/Group/GroupList.tsx`, lines
   1861–1897): a `ReticulumUnreadCountBadge` (red, size 8 if no count, 18 with
   count) on the group avatar. An `AlternateEmailIcon` (red) is shown when
   there are mentions.

2. **Group list — list mode** (`GroupList.tsx`, lines 2126–2153): a
   `MarkChatUnreadIcon` in red (`RETICULUM_NOTIFICATION_RED`) for Reticulum
   chats, or blue (`theme.palette.other.unread`) for legacy chats. Mention
   indicator via `AlternateEmailIcon`.

3. **Global chat widget** (`src/components/Group/GlobalChatWidget.tsx`, lines
   1481–1500): `MarkChatUnreadIcon` and `AlternateEmailIcon` per group row.

4. **Desktop footer** (`src/components/Group/DesktopFooter.tsx`, lines 142–173):
   the Groups tab icon turns red (`theme.palette.other.danger`) when
   `hasUnreadGroups` is true.

5. **Left sidebar** (`src/components/Group/DesktopLeftSideBar.tsx`, lines 286,
   305–317): the Q-Chat tab shows `hasUnreadChat = hasUnreadDirects ||
hasUnreadGroups` in a red accent color.

6. **Directs sidebar header** (`src/components/Group/DirectsSidebar.tsx`,
   lines 181–195): a 14px red dot on the "Groups" toggle when
   `groupChatHasUnread || groupsAnnHasUnread`.

### Derived Atoms

| Atom                     | File:Line                 | Description                                                                                           |
| ------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `groupChatHasUnreadAtom` | `src/atoms/global.ts:839` | True if any member group has unread Reticulum messages or mentions (or legacy timestamp-based unread) |
| `groupsAnnHasUnreadAtom` | `src/atoms/global.ts:868` | True if any group announcement is unseen                                                              |
| `hasUnreadGroupsAtom`    | `src/atoms/global.ts:880` | Combined: `groupChatHasUnreadAtom \|\| groupsAnnHasUnreadAtom`                                        |
| `isUnreadChatAtomFamily` | `src/atoms/global.ts:886` | Per-group unread boolean, keyed by `groupId`                                                          |

### Clear / Dismiss

- **Clicking the group** — calls `selectGroupHandler` (`GroupList.tsx` line 1585) which invokes `addTimestampEnterChat`.
- **Right-click "mark as read"** — fires the `markAsRead` event
  (`src/components/Group/ContextMenu.tsx` line 409) → handled in
  `src/components/Group/Group.tsx` `handleMarkAsRead` (lines 3448–3482): marks
  Reticulum read + `addTimestampEnterChat` + `addGroupNotificationTimestamp`.
- **Mark all member groups read** — `markAllMemberGroupsRead` event →
  `Group.tsx` lines 3484–3529.
- **Reticulum API** — `window.reticulumChat.markGroupsRead(groupIds, myAddress)`
  (`Group.tsx` lines 3430–3437).

---

## 4. Mention / Push Notifications

### What Triggers a Mention

A mention occurs when a message contains a structured mention node targeting a
specific user's address, or the special targets `@everyone` or `@here`.

- **Mention UI** — TipTap `Mention` extension (`src/components/Chat/TipTap.tsx`
  line 34) with `MentionList.tsx` (lines 25–27) providing autocomplete
  suggestions of three kinds: `people`, `special` (@everyone / @here), and
  `channels`.
- **Mention hashing** — `src/components/Chat/reticulumMentionNormalization.ts`
  converts typed `@labels` into structured mention nodes. Target addresses are
  hashed via `sha256Hex('reticulum-chat-mention:${address}')`
  (`ChatGroup.tsx` line 804) and attached to the message as
  `mentionAddressHashes` / `mentionTargets` (lines 4536–4562, 5212, 6489).

### Mention Detection (receiver side)

- **`recordReticulumMentionNotification`** — `src/components/Group/Group.tsx`
  (lines 2672–2711): during background event processing, this function checks
  incoming messages for mention hashes matching the current user's address. It
  skips edited messages, messages already read by the owner, the user's own
  messages, non-mentions, and muted groups. If a mention is detected, it
  dispatches `executeEvent('q-chat-mention-notification', { channelId, eventId,
groupId, groupName, timestamp })`.
- **`syncReticulumMentionNotifications`** — `Group.tsx` (lines 1512–1552):
  bulk syncs from summaries for each member group. Dispatches
  `q-chat-mention-notification` with `syncUnreadCount: true` and aggregated
  `mentionCount`.

### Mention Notification Handling

- **`handleQChatMention`** — `src/components/Group/WebsocketNotifications.tsx`
  (lines 402–573): subscribes to the `q-chat-mention-notification` event.
  Checks `getQChatMentionNotificationsEnabled()`. Builds or updates a
  `q-chat-mention-${groupId}` entry in `paymentNotificationsAtom` (deduplicated
  by `eventIds`, capped at 100). Two modes:
  - **Sync mode** (`syncUnreadCount: true`): rebuilds state from `mentionCount`;
    does **not** fire an OS notification (line 541 comment).
  - **New mention mode**: increments count and fires an OS notification via
    `fireOsNotificationPayment` (lines 556–572) with title "Mention in
    {groupName}" and body "You were mentioned in #{channelName}". Deduplication
    by `eventId` (tracked in a set, cap 500).

- **`handleMentionSettingUpdated`** — `WebsocketNotifications.tsx` (lines
  576–585): when mentions are disabled, strips all `q-chat-mention-*`
  notifications from the store.

### Mention Visual Indicators

- **`AlternateEmailIcon`** (red) on the group icon in `GroupList.tsx` (rail
  mode lines 1899–1914, list mode 2126–2153) and `GlobalChatWidget.tsx` (lines
  1491–1500).
- **Bell popover entry** — `src/components/GeneralNotifications.tsx` (lines
  387–601): shows the group name and "1 mention" / "{n} mentions".

### Mention Clear / Dismiss

- **Click the bell entry** — `GeneralNotifications.tsx` (lines 413–430):
  removes the notification and fires `openGroupMessage` to jump to the channel
  and event.
- **Mark channel read** — `window.reticulumChat.markRead(...)` clears the
  underlying `mentionCount` in the summary.

### Mention Toggle

- **`src/utils/qChatMentionNotifications.ts`**:
  - `getQChatMentionNotificationsEnabled()` (line 11) /
    `setQChatMentionNotificationsEnabled()` (line 20): persisted via user-settings
    key `q-chat-mention-notifications-disabled`.
  - Fires `q-chat-mention-notifications-updated` event; refreshes summaries when
    re-enabled (line 34).
  - Constants: `QCHAT_MENTION_NOTIFICATION_APP_NAME = 'q-chat'`,
    `QCHAT_MENTION_NOTIFICATION_EVENT = 'Q_CHAT_MENTION'` (lines 5–6).

---

## 5. Direct Message Notifications

### DM Unread

#### Trigger

When a new DM message arrives and the user has not read it, the
`reticulumDirectSummary.unreadCount` for that peer increments.

#### Display

- `src/components/Group/DirectsSidebar.tsx` (lines 421–430): `hasUnread`
  (legacy) and `hasReticulumUnread` (`unreadCount > 0`) booleans. Renders
  `MarkChatUnreadIcon` in blue (`theme.palette.other.unread`) at lines 697–704.
- **Desktop footer** — Directs tab icon turns red when `hasUnreadDirects`.

#### OS Push (DM messages)

- `src/components/Group/WebsocketNotifications.tsx` (line 178): fires an OS
  notification "New message from {name}" / "Open Q-Chat to view it." — gated by
  `shouldNotifyForReticulumDm`.
- **`src/utils/reticulumDmNotifications.ts`**:
  - `isHubBeingViewed()` (line 14): checks document visibility + window focus.
  - `shouldNotifyForReticulumDm()` (line 18): event must be a `message`, from a
    friend, not own, not already read, hub not focused, and timestamp ≥ listening
    start (minus 60s clock skew tolerance).

#### DM Clear / Dismiss

- **Clicking the DM** — `DirectsSidebar.tsx` (lines 466–476): calls
  `addTimestampEnterChat` and `getTimestampEnterChat()`.
- **Reticulum DM read** — `window.reticulumChat.markDirectRead(...)`.

---

## 6. Call Notifications

### 6.1 DM Incoming Voice Call

#### Trigger

When a direct voice call invitation is received, `callState` transitions to
`'ringing'` in `src/hooks/useVoiceCall.ts` (line 3348) and `incomingCall` is
populated (line 460).

#### Display

- **Full-window overlay** —
  `src/components/Chat/DirectVoiceCallGlobalOverlay.tsx`: a full-window MUI
  `Dialog` (z-index 2000) rendered when `callState === 'ringing'` and
  `isDirectVoiceCallChatId(incomingCall.chatId)`. Shows the caller's avatar and
  name, "Incoming voice call", and Accept (green) / Decline (red) buttons.
- **Ringtone** — `src/lib/call/directIncomingRingtone.ts`: a synthesized Web
  Audio chime (sine waves at C5 523.25 Hz + E5 659.25 Hz, 2.8-second cycle, peak
  amplitude 0.11). `startDirectIncomingRingtone()` (line 14) returns a stop
  function. Started in `DirectVoiceCallGlobalOverlay.tsx` (lines 96–106) while
  ringing; stopped on accept, decline, or stop.
- **Call switch guard** — `src/contexts/CallSwitchGuardContext.tsx` (lines
  99–110): `confirmCallSwitch` prevents dropping a ringing direct call when
  switching between a direct call and a group call.

#### Clear / Dismiss

- **Accept** — `useVoiceCall.ts` (lines 3684–3748): stops ringtone, transitions
  to connected.
- **Decline** — `useVoiceCall.ts` (lines 3766–3803): stops ringtone, sends
  reject, transitions to ended.
- **Stop** — ringtone stop function is called in all teardown paths.

### 6.2 Support / Agent Chat Incoming Call

#### Trigger

Same `callState === 'ringing'` mechanism, but for `support:` prefixed chat IDs.

#### Display

- **`src/components/Chat/SupportChat.tsx`** (lines 1540–1588): inline banner
  with pulsing `CallRoundedIcon`, "Incoming call from {shortAddr}", and
  Accept/Reject buttons.
- **`src/components/Chat/AgentSupportDashboard.tsx`** (lines 1643–1666):
  similar support incoming-call banner.
- The global DM overlay is suppressed for `support:` chat IDs — these use the
  inline banner only, and there is no separate ringtone.

### 6.3 Group Call Active Indicator

Group calls have no ringing or invitation — they are join-based. The
"notification" is a visual indicator that a call is currently active in the
group.

#### Trigger

`showGroupCallIndicator` is true when the user is in a group call
(`imInThisGroupGcall`) or the mesh shows an active call (`meshShowsCall`)
— `src/components/Group/GroupList.tsx` (lines 1646–1647).

#### Display

- **Rail mode** (`GroupList.tsx` lines 1916–1970): green `PhoneIcon` button
  badge (`RETICULUM_CALL_GREEN`) on the group avatar, with tooltip "You're in"
  or "Call active".
- **List mode** (`GroupList.tsx` lines 2164–2209): green `PhoneIcon` +
  participant count (`meshCallParticipantCount` / `meshCallMaxParticipants`).
- **Group header** — `src/components/Group/DesktopHeader.tsx` (lines 198–219):
  group-call button in the selected-group header.

#### Clear / Dismiss

The indicator disappears automatically when the call ends (no longer
`imInThisGroupGcall` / `meshShowsCall`).

### 6.4 Group Call Join Errors

#### Trigger

When the group-call controller fails to join a call, it sets a `gcallJoinError`
with an error code.

#### Display

- **`src/contexts/groupCallContextShared.tsx`** —
  `GroupCallJoinErrorNotifier` (lines 26–82): subscribes to `gcallJoinError`,
  maps error codes to i18n messages, and shows a snackbar via
  `setInfoSnack` / `setOpenSnack`. Mounted in `GroupCallContext.tsx` (lines 50,
  70).
- Error codes include: `group_call_full:{max}`, `members_fetch_failed`,
  `presence_offline`, `reticulum_not_ready`, `p2p_health_not_good`,
  `not_group_member`, `join_sign_failed`, etc.

#### Clear / Dismiss

`clearGcallJoinError` is called after the toast/snackbar auto-hides.

### 6.5 Missed Call Notifications (DM)

#### Trigger

When a direct call-history record has `direction === 'incoming'`,
`outcome === 'missed'`, and `readAt === 0`, a missed-call notification is
created.

- **`src/components/Group/WebsocketNotifications.tsx`**:
  - `addMissedCallNotification` (line 196): adds a `RETICULUM_DM_MISSED_CALL`
    entry to `paymentNotificationsAtom` with message "Missed voice call from
    {name}" (lines 209–227).
  - Loaded on mount: `getDirectCallHistory(myAddress, undefined, 50, true)`
    (lines 229–231, `unreadOnly` flag).
  - `onDirectCallHistory` (lines 233–246): live updates — adds new missed calls;
    removes the notification when a call record is no longer missed (answered or
    returned) by `reticulumDmCallId`.
  - `onDirectSummaryChanged` (lines 247–267): removes the missed-call
    notification when the peer has no remaining unread missed calls.

#### Display

- **DM sidebar** — `DirectsSidebar.tsx` (lines 431–433, 686–695):
  `PhoneMissedRoundedIcon` in red (`theme.palette.error.main`) when
  `unreadMissedCallCount > 0`.
- **Bell popover** — `GeneralNotifications.tsx` (lines 392–446): missed-call
  entry; clicking removes it and fires `openDirectMessageInternal` to open the
  DM.

#### Clear / Dismiss

The underlying `readAt` is set on the Electron/SQLite side when call history is
read; this propagates back via `onDirectCallHistory` / `onDirectSummaryChanged`
which remove the notification. No renderer-side `markDirectCallRead` call
exists — clearing is driven by the Electron chat-db layer.

### 6.6 QortalLand Proximity Voice Call

- `src/components/QortalLand/QortalLand.tsx`: land voice call with
  `incomingCall` / `ringing` state (lines 11066, 11094–11096) and an
  incoming-call dialog (line 13315).

---

## 7. Announcement Notifications

### Trigger

When a group announcement has `!seentimestamp` (i.e., the user has not seen
it), it counts as unread. Only counted when Reticulum chat is disabled — when
Reticulum is enabled, announcements are folded into the group unread state.

### Display

- **Rail mode** — `GroupList.tsx` (lines 1899–1914): `CampaignIcon` on the group
  avatar when `!announcement.seentimestamp`.
- **List mode** — `GroupList.tsx` (lines 2103–2113): same `CampaignIcon`.
- **Derived atom** — `groupsAnnHasUnreadAtom` (`src/atoms/global.ts:868`): true
  if any group announcement is unseen.

### Clear / Dismiss

- `getGroupAnnouncements` refresh after `markAsRead` sets the `seentimestamp`.

---

## 8. General Bell / Notification Center

### Overview

The notification-center bell (`src/components/GeneralNotifications.tsx`) is the
central in-app notification hub. It aggregates Q-Chat mentions, DM missed calls,
payment notifications, Q-App resource publishes, and calendar reminders.

### Unseen Count

- `unseenCount` (lines 166–180): counts notifications not yet "seen in app" and
  newer than `lastSeenTimestamp`. Mentions are counted as
  `Math.max(1, mentionCount)`.
- Renders `ReticulumUnreadCountBadge` over the bell icon (lines 266–279).

### Display

The bell popover (lines 387–601) shows entries for:

- **Q-Chat mentions** — group name + "1 mention" / "{n} mentions".
- **Missed DM calls** — "Missed voice call from {name}".
- **Payments** — payment amount and sender.
- **Q-App publishes** — resource name and app.
- **Calendar reminders** — event title and time.

### Interactions

- **Click a mention entry** (lines 413–430): removes the notification and fires
  `openGroupMessage` to jump to the channel and event.
- **Click a missed-call entry** (lines 392–446): removes the notification and
  fires `openDirectMessageInternal` to open the DM.
- **Close the popover** (line 286, 464): sets `lastSeenTimestamp = Date.now()`,
  which marks all current notifications as "seen" (bell badge clears).

---

## 9. OS / Desktop Notifications

### Central OS Notifier

- **`fireOsNotificationPayment`** — `src/background/background.ts` (lines
  3341–3392):
  - Uses `new window.Notification(title, { body, icon, data })` (line 3374).
  - Auto-closes after 10 seconds (line 3385).
  - Click handler `handleNotificationClick` opens the relevant payload.
  - Honors the global `disable-push-notifications` setting (line 3351) and
    per-app `getNotificationOsPushDisabled` (lines 3354–3362).

### Logical Registry Semantics (`electron/src/notification-registry.ts`)

The Electron main process tracks every Q-Chat OS notification in a **logical
registry** (`NotificationRegistry`). This is the source of truth for whether a
notification is "alive":

- **An entry lives until** the user interacts with it (click → navigates to the
  target), reads it in Q-Chat (existing `dismissNotifications` IPC from the
  group/DM open paths), the app explicitly dismisses it, or the **50-cap**
  evicts it. The OS closing the physical notification does **not** end the
  entry's logical life (see below).
- **`'close'` from the desktop environment is non-destructive.** OS auto-dismiss
  after the display timeout, and closing the shade when the user clicks another
  notification, fire Electron's `'close'`; the registry marks the entry
  `osClosedBySystem` and **retains** it (counting toward the cap) until read,
  dismissed, or evicted.
- **50-cap evicts the oldest.** When the registry is at 50 and a new
  notification must show, the entry with the smallest `createdAt` is closed
  app-initiated and removed, keeping exactly 50 logical entries. OS-closed
  entries still count. Duplicate `notificationId`s are replaced without
  eviction.
- **Clicking does not close notifications.** A click only focuses the window
  and navigates to the target via the existing `NOTIFICATION_OPEN_*` flows; the
  app issues no dismissal on click. The clicked entry is removed when the user
  actually reads it in Q-Chat.
- **Platform constraint (Linux):** the desktop environment owns physical
  Notification-Center retention. DEs may auto-expunge toasts or collapse the
  shade, so the physical center may show fewer than the logical 50 at any
  moment. The app guarantees non-dropping (until click/read/eviction) and the
  50-cap **logically**; physical retention is out of the app's control on
  Linux.
- **Closed-Hub click is a no-op.** If Qortal Hub is fully closed, the renderer
  is not running, so clicking a notification cannot navigate or dismiss. The
  entry stays logically alive until read in Q-Chat, explicit dismissal, or cap
  eviction. There is no pending-click replay.

### What Fires OS Notifications

| Feature                | Title                     | Body                                   | File:Line                        |
| ---------------------- | ------------------------- | -------------------------------------- | -------------------------------- |
| Q-Chat mention         | "Mention in {groupName}"  | "You were mentioned in #{channelName}" | `WebsocketNotifications.tsx:556` |
| DM message             | "New message from {name}" | "Open Q-Chat to view it."              | `WebsocketNotifications.tsx:178` |
| Calendar reminder      | (calendar event title)    | (calendar event body)                  | `WebsocketNotifications.tsx:319` |
| Payment                | (payment title)           | (payment body)                         | `background.ts:834`              |
| Q-App resource publish | (resource title)          | (resource body)                        | `background.ts:860`              |

### Gating

- **Global push toggle** — `disable-push-notifications` setting checked in
  `fireOsNotificationPayment`.
- **Per-app OS push toggle** — `setNotificationOsPushDisabled` /
  `getNotificationOsPushDisabled` (`src/qortal/qortal-requests.ts`), exposed in
  `GeneralNotifications.tsx` settings (lines 970–983) as "Disable OS push"
  per Q-App.
- **Hub focus check** — `isHubBeingViewed()` in
  `src/utils/reticulumDmNotifications.ts` (line 14): OS notifications for DMs
  are only fired when the hub is not being viewed (not visible or not focused).
- **Mention toggle** — `getQChatMentionNotificationsEnabled()` gates
  mention OS notifications.
- **DM friend filter** — `shouldNotifyForReticulumDm()` requires the sender to
  be a friend.

### Permission Handling

- Permission is managed via the Qortal permission system
  (`src/qortal/qortal-requests.ts`: `getNotificationPermissionKey` line 183,
  `getNotificationPermission` get.ts line 603), stored under the
  `qAPPNotification-` prefix — not via a direct `Notification.requestPermission()`
  call.

---

## 10. Audio / Sound Notifications

### DM Call Ringtone

- **`src/lib/call/directIncomingRingtone.ts`**: the only notification sound in
  Q-Chat. A synthesized Web Audio chime using sine oscillators at C5 (523.25
  Hz) and E5 (659.25 Hz), cycling every 2.8 seconds at peak amplitude 0.11.
- `startDirectIncomingRingtone()` (line 14): starts the chime, returns a stop
  function.
- `startDirectOutboundRingtone()` (line 79): reuses the same chime for outgoing
  calls.
- Started in `DirectVoiceCallGlobalOverlay.tsx` (lines 96–106) while the call
  state is `ringing`; stopped on accept, decline, or stop.

### No Chat Message Sound

There is **no general chat-message sound** — incoming text messages do not
play audio. The only `new Audio()` usages in the codebase are the auth intro
music (`NotAuthenticated.tsx`), the earbump music player
(`Group/earbumpSharedAudio.ts`), and game SFX (`ConnectFourGameDialog.tsx`) —
none of which are chat notifications.

---

## 11. App / Dock Badge

### Trigger

The total mention count across all groups is sent to the Electron main process
via `window.reticulumChat.updateMentionBadge(count)`
(`src/types/window.d.ts` line 1099). This sets the desktop app's taskbar/dock
badge.

### Where It's Called

`src/components/Group/Group.tsx` at lines 1042, 1571, 1588, 1602, 1636, 1756,
1838 — updated whenever the aggregated mention count changes.

### Clear

`updateMentionBadge(0)` is called when there are no mentions.

---

## 12. Notification Settings

### Per-Scope Settings Storage (flat channel-override model)

Q-Chat notification settings use a **flat channel-override model** where the
global defaults are the source of truth and channels store only their
deviations.

**Storage keys:**

| Key                            | Content                      | Purpose                                                       |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------- |
| `q-chat-notif-global`          | `GlobalNotificationSettings` | Global defaults with a monotonic `version`                    |
| `q-chat-notif-{groupId}`       | `GroupNotificationStore`     | Per-group: flat `channels{}` override map + group-only fields |
| `q-chat-notification-delivery` | `"native"` / `"ephemeral"`   | Delivery method (unchanged)                                   |

**Semantics — parent always overwrites children:**

- Changing a **global** setting updates `q-chat-notif-global`, increments the
  version, and wipes ALL per-group `channels{}` maps → every channel inherits
  the new defaults. One write, zero iteration.
- Changing a **group** setting writes the value to every channel in that
  group's `channels{}` map (via `applyScopeNotificationSettings`), deleting
  entries that match the global defaults.
- Changing a **section** or **channel** setting writes only to channels in that
  scope.
- A channel with **no entry** in `channels{}` inherits the global defaults
  exactly. `mutedUntil` is stored per-channel; group/section mute is a bulk
  write to every child channel.
- `notifyOnWelcomePosts` and `hideMutedChannels` are group-only fields stored
  at the top of `GroupNotificationStore` — they do not push down per-channel.

**Read path** for a channel: load `q-chat-notif-global`, overlay the channel's
entry from `q-chat-notif-{groupId}` (if any). No scope-chain walk.

**Migration:** On first load after update (when `q-chat-notif-global` is
absent), legacy nested settings (`q-chat-notification-settings-{groupId}`) are
converted once to the flat model, preserving each channel's effective settings
and group-only fields. Old keys are left in place.

### Q-Chat Mention Notifications

- **Toggle**: `setQChatMentionNotificationsEnabled()` in
  `src/utils/qChatMentionNotifications.ts` (line 20), persisted via user-settings
  key `q-chat-mention-notifications-disabled`.
- **UI**: `src/components/GeneralNotifications.tsx` (lines 840–852) — "Q-Chat"
  → "Mentions" Switch in the Hub tab of notification settings.
- When disabled, all `q-chat-mention-*` notifications are stripped from the
  store (`WebsocketNotifications.tsx` lines 576–585).

### Global Push Notifications

- **Toggle**: `disable-push-notifications` setting checked in
  `fireOsNotificationPayment` (`background.ts` line 3351).

### Per-App OS Push

- **Toggle**: `setNotificationOsPushDisabled` /
  `getNotificationOsPushDisabled` (`src/qortal/qortal-requests.ts`), exposed in
  `GeneralNotifications.tsx` settings (lines 970–983) as "Disable OS push" per
  Q-App.

---

## 13. Quick Reference Table

| Notification       | Trigger                                                        | Display                                                                                                 | Clear                                                                                |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Channel unread** | New message in a channel; `channel.unreadCount > 0`            | Red badge on group icon (aggregated from channels)                                                      | `markRead(groupId, channelId, upToTimestamp)` — auto on view or explicit acknowledge |
| **Group unread**   | `reticulumChatSummary.unreadCount > 0` or legacy 15-min window | Red badge / `MarkChatUnreadIcon` on group (GroupList, GlobalChatWidget); red Groups tab (DesktopFooter) | `markGroupsRead` / `markAsRead` event / clicking the group                           |
| **Group mention**  | Incoming message mentions my address (not muted/read/own)      | `AlternateEmailIcon` (red) on group; bell entry "n mentions"; OS notification "Mention in {group}"      | Click bell entry → `openGroupMessage`; `markRead`                                    |

### Welcome-post unread accounting

Welcome posts (`qchatSystem.type === 'group-welcome'`) are tracked separately
from ordinary unread, so that a user with **Notify on welcome posts** switched
off does not get a badge for people joining. The tracking lives in
`unreadWelcomeEventIdsAtom` and is applied by `groupHasUnreadConsideringMute`
and `getGroupUnreadCountConsideringMute` in
`src/utils/qChatNotificationSettings.ts`.

Two rules make that accounting safe. Both were added after a bug where the
group badge and channel count disappeared while messages were genuinely unread:

1. **The subtraction is bounded.** A welcome set can only account for as many
   unread messages as the group actually has. A set that is _equal to or larger
   than_ the unread total is disregarded entirely, not clamped — a clamp would
   subtract every real unread message and re-hide the badge. Equality counts as
   ambiguous rather than as a welcome-only group: the set stores event ids and
   no timestamps, so "3 unread, all welcome posts" and "3 unread: one leftover
   welcome id plus two real messages" are indistinguishable, and subtracting
   resolves that in the direction that hides a real message.
2. **The set is reconciled.** `reconcileWelcomeUnreadForGroup` trims each
   group's set to its unread total on every summaries refresh, dropping the
   oldest entries. Entries are otherwise only cleared when a group reaches zero
   unread or a message is deleted, so a welcome post read on another device
   would leave a permanent entry and the set would grow without bound.

Note the trade-off in rule 1: a group whose only unread posts are welcome posts
will show a dot even with **Notify on welcome posts** off. That is deliberate —
a visible, self-correcting dot is better than silently hiding a real message.
The setting still affects the numeric count whenever the set is unambiguously
smaller than the unread total. Removing this trade-off would mean giving the set
event timestamps, so an entry could be compared against the channel read
watermark instead of inferred from a size comparison.

Verified headlessly by the `unread-badge-visibility` scenario
(`node electron/scenarios/runner.mjs unread-badge-visibility`), which asserts
the bounded subtraction, the mute classification, and that the membership join
baseline never clears a message newer than the member's `joinedAt`.

### Group dot and mute entries

A `mutedUntil` key outlives the mute it recorded: it becomes an expired
timestamp once the mute lapses, and `0` on an explicit unmute. Neither mutes
anything.

`computeFilteredChannelCounts` used to treat _any_ such key as "this group is
muted" and report zero unread whenever the summary had no per-channel
breakdown — so a group the user had once muted, and since let lapse, silently
lost its dot while messages were unread.

When there is no channel breakdown the group is now treated as muted only when
**every** known channel entry is actively muted, which is the shape a
group-wide mute writes. An expired mute, an explicit unmute, a non-mute
override (such as a push level), or a mix all fall back to the aggregate and
show the dot.

### Clock skew between senders

Unread is normally decided by `event.timestamp > read_watermark`. Both values come
from **senders'** clocks, so a participant whose clock runs a few minutes ahead
can drag the watermark into the future and make every later message from a
correctly-clocked sender look already read. The visible symptom is a **push
notification with no red dot** — notifications are generated from live events and
never consult the watermark, so the two paths disagree.

Two columns exist to detect and work around this:

- `reticulum_chat_read_watermarks.local_read_at` — when this device last read the
  channel, from the local clock.
- `rchat_message_projection.stored_at` — local arrival order for each message.

Both are written from a single strictly-increasing counter, not `Date.now()`,
because several messages routinely land in the same millisecond and a tie against
a read moment would read as "already seen".

The rule in `computeChannelSummary` is deliberately narrow:

```
if (watermark > local_read_at)   // dragged forward by another sender's clock
    unread = arrival order > local_read_at
else
    unread = timestamp > watermark        // unchanged
```

Only a poisoned watermark switches to arrival order. Everything else keeps the
sender-timestamp comparison, which is what keeps late-fetched history below the
watermark from appearing unread — the behaviour asserted in
`electron/src/reticulum-chat.test.ts` under device read-state sync.
| **Announcement** | `!announcement.seentimestamp` | `CampaignIcon` on group | `getGroupAnnouncements` after `markAsRead` |
| **DM unread** | `reticulumDirectSummary.unreadCount > 0` | `MarkChatUnreadIcon` (blue) on DM row; red Directs tab | `markDirectRead`; clicking the DM |
| **DM OS push** | New DM from a friend while hub not focused | OS notification "New message from {name}" | N/A (auto-dismiss after 10s) |
| **DM incoming call** | `callState = 'ringing'` for `direct:` chat | Full-window Dialog overlay + Web Audio ringtone | Accept / Decline (stops ringtone) |
| **Support incoming call** | `callState = 'ringing'` for `support:` chat | Inline banner with pulsing icon | Accept / Reject |
| **Group call active** | gcall / mesh call active for group | Green `PhoneIcon` badge + participant count on group | Call ends (indicator auto-clears) |
| **Group call join error** | `gcallJoinError` set by controller | Snackbar toast (error message) | `clearGcallJoinError` after toast |
| **Missed DM call** | Call record `outcome=missed`, `readAt=0` | `PhoneMissedRoundedIcon` (red) on DM; bell entry | Click bell entry; Electron sets `readAt` → notification removed |
| **Mention OS badge** | Total mention count across all groups | App taskbar/dock badge | `updateMentionBadge(0)` when no mentions |
| **Calendar reminder** | `onCalendarReminderDue` | Bell entry + OS notification (when hub not viewed) | Click bell entry → `openGroupMessage` with `openCalendar` |
| **Q-Mail** | New Q-Mail | Red dot (`other.unread` blue) on Q-Mail status | Opening Q-Mail |
| **Payment** | New payment received | Bell entry + OS notification | Click bell entry; closing popover sets `lastSeenTimestamp` |

---

## Key Files Index

| File                                                   | Role                                                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/atoms/global.ts`                                  | Jotai atoms: `paymentNotificationsAtom`, `groupChatHasUnreadAtom`, `groupsAnnHasUnreadAtom`, `hasUnreadGroupsAtom`, `isUnreadChatAtomFamily`, `notificationSeenInAppKeysAtom`, `seenAllNotificationsByAddressAtom` |
| `src/components/common/ReticulumUnreadCountBadge.tsx`  | Red count badge component (`#f23f42`, `99+`)                                                                                                                                                                       |
| `src/components/Group/GroupList.tsx`                   | Group-level unread/mention/call indicators (rail + list mode)                                                                                                                                                      |
| `src/components/Group/GlobalChatWidget.tsx`            | Group unread/mention indicators in chat widget                                                                                                                                                                     |
| `src/components/Group/DirectsSidebar.tsx`              | DM unread + missed-call indicators                                                                                                                                                                                 |
| `src/components/Group/DesktopFooter.tsx`               | Footer tab red indicators for Groups / Directs                                                                                                                                                                     |
| `src/components/Group/DesktopLeftSideBar.tsx`          | Q-Chat tab unread accent                                                                                                                                                                                           |
| `src/components/Group/Group.tsx`                       | `recordReticulumMentionNotification`, `syncReticulumMentionNotifications`, `handleMarkAsRead`, `markGroupsRead`, `updateMentionBadge`                                                                              |
| `src/components/Group/WebsocketNotifications.tsx`      | `handleQChatMention`, `addMissedCallNotification`, DM OS push, `onDirectCallHistory`, `onDirectSummaryChanged`                                                                                                     |
| `src/components/Group/ContextMenu.tsx`                 | Right-click "mark as read" event                                                                                                                                                                                   |
| `src/components/GeneralNotifications.tsx`              | Notification-center bell, popover, unseen count, settings                                                                                                                                                          |
| `src/components/Chat/ChatGroup.tsx`                    | Auto mark-read, explicit acknowledge, channel summaries, mention hashing                                                                                                                                           |
| `src/components/Chat/reticulumJoinUnreadBaseline.ts`   | Join-time unread baseline                                                                                                                                                                                          |
| `src/components/Chat/reticulumMentionNormalization.ts` | Mention node normalization                                                                                                                                                                                         |
| `src/components/Chat/DirectVoiceCallGlobalOverlay.tsx` | DM incoming call overlay + ringtone control                                                                                                                                                                        |
| `src/components/Chat/SupportChat.tsx`                  | Support chat incoming call banner                                                                                                                                                                                  |
| `src/components/Chat/AgentSupportDashboard.tsx`        | Agent support incoming call banner                                                                                                                                                                                 |
| `src/hooks/useVoiceCall.ts`                            | Call state machine (`idle` → `calling` → `ringing` → `connected` → `ended`)                                                                                                                                        |
| `src/contexts/CallSwitchGuardContext.tsx`              | Prevents dropping a ringing call when switching                                                                                                                                                                    |
| `src/contexts/groupCallContextShared.tsx`              | `GroupCallJoinErrorNotifier`                                                                                                                                                                                       |
| `src/contexts/GroupCallContext.tsx`                    | Mounts the join-error notifier                                                                                                                                                                                     |
| `src/lib/call/directIncomingRingtone.ts`               | Synthesized Web Audio ringtone                                                                                                                                                                                     |
| `src/utils/qChatMentionNotifications.ts`               | Mention toggle (enabled/disabled)                                                                                                                                                                                  |
| `src/utils/reticulumDmNotifications.ts`                | `isHubBeingViewed`, `shouldNotifyForReticulumDm`                                                                                                                                                                   |
| `src/utils/events.ts`                                  | `executeEvent` / `subscribeToEvent` / `unsubscribeFromEvent`                                                                                                                                                       |
| `src/background/background.ts`                         | `fireOsNotificationPayment` — central OS notifier                                                                                                                                                                  |
| `src/qortal/qortal-requests.ts`                        | Notification permission keys, per-app push toggle                                                                                                                                                                  |
| `src/types/window.d.ts`                                | `window.reticulumChat` API surface (`markRead`, `markGroupsRead`, `updateMentionBadge`, etc.)                                                                                                                      |
| `src/components/Group/groupConstants.ts`               | `timeDifferenceForNotificationChats` (15-min legacy window)                                                                                                                                                        |

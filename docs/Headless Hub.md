# Headless Hub

What Qortal-Hub can do without a window, what it cannot, and what would make
the headless surface larger.

Written after building the Q-Chat scenario harness (change
`add-qchat-scenario-harness`, archived 2026-11-04). Everything here is measured
against the code at that point, not planned.

---

## 1. Why "headless Hub" is not one thing

Hub is not a two-process Electron app. It is six tiers, and which ones run
headlessly determines what can be tested.

```
┌──────────────────────────────────────────────────────────────┐
│ Tier 0  Renderer (Chromium)   React 19, MUI 7, Jotai         │
│         talks to main only via window.reticulumChat.*        │
├──────────────────────────────────────────────────────────────┤
│ Tier 1  Electron main (Node)                                 │
│         ReticulumChatManager, notification registry,         │
│         better-sqlite3                                       │
├──────────────────────────────────────────────────────────────┤
│ Tier 2  Worker threads                                       │
│         chat / media / resource workers, verify pool         │
├──────────────────────────────────────────────────────────────┤
│ Tier 3  Python presence_bridge.py   fd3/fd4 binary IPC       │
├──────────────────────────────────────────────────────────────┤
│ Tier 4  rnsd  (Reticulum daemon, venv downloaded on 1st run) │
├──────────────────────────────────────────────────────────────┤
│ Tier 5  Qortal Core  (HTTPS, real chain, real account)       │
└──────────────────────────────────────────────────────────────┘
```

There are three distinct "headless" configurations in this repo, and they are
often confused:

| Configuration             | Tiers running                          | Used for                             |
| ------------------------- | -------------------------------------- | ------------------------------------ |
| **A. In-process**         | 1 + 2 (no Electron at all)             | the scenario harness                 |
| **B. Test-mode Electron** | 0 + 1 + 2, background subsystems inert | launching the built app under `xvfb` |
| **C. Packaged**           | all six                                | production                           |

The harness is **A** — plain Node, no Electron binary, no display, no daemon.
Configuration **B** exists and works but is not what the scenarios use.

---

## 2. What headless Hub can do

### 2.1 Two identities with real cryptography and real SQL

A scenario constructs real `ReticulumChatManager` instances over the real
compiled `electron/build/` output, each with its own database file.

Available without a window, a daemon, or a Core account:

- **Real `better-sqlite3`** — the native binary, not the Vitest mock. The
  3,751-line mock is reachable only through the `VITEST` alias branch in
  `vite.config.ts`; anything launched outside Vitest gets the real module.
- **Real Ed25519 signing and verification** — every `verify*` function, every
  `buildReticulumChatSignedFields`, every canonicalisation.
- **Real `ReticulumChatManager`** — the shipping class, unmodified:
  `publishEvent`, `acceptEvent`, `subscribeGroup`, `getHistory`,
  `getMessageHistory`, `authorizeResource`, the digest logic, the pull queue,
  the resource handshake.
- **Synthetic Qortal identities** — an Ed25519 keypair plus the address derived
  by the shipping `deriveAddressFromPublicKey`. No wallet, no Core.
- **Real notification decision** — `planReticulumNotifications` imported from
  `src/components/Group/reticulumNotificationPlan.ts` as source, via Node's
  type stripping. The actual file, not a copy.
- **Real notification sink** — `QChatNotificationSink`, including cap,
  eviction, dedupe, show-time suppression, and a read-only snapshot.

### 2.2 The transport, end to end

Seven of the eight scenarios run the **full transport**: publish → availability
notice → event request → resource offer → byte fetch → store. Not a shortcut.

Verbatim output, captured 2026-11-04:

```
--- scenarios ---
PASS  group-message-roundtrip: 7/7 assertions
PASS  notification-generic: 5/5 assertions
PASS  notification-mention: 6/6 assertions
PASS  notification-own-post: 4/4 assertions
PASS  notification-reaction: 5/5 assertions
PASS  notification-reply: 6/6 assertions
PASS  notification-reply-beats-mention: 7/7 assertions
PASS  transport-roundtrip: 5/5 assertions

8/8 scenarios passed
```

The runner does not print the delivery mode. It is declared in each scenario
file instead:

| Scenario                           | `delivery`   |
| ---------------------------------- | ------------ |
| `group-message-roundtrip`          | `'direct'`   |
| `notification-generic`             | `'resource'` |
| `notification-mention`             | `'resource'` |
| `notification-own-post`            | `'resource'` |
| `notification-push-gate`           | `'direct'`   |
| `notification-reaction`            | `'resource'` |
| `notification-reply`               | `'resource'` |
| `notification-reply-beats-mention` | `'resource'` |
| `transport-roundtrip`              | `'resource'` |

`delivery: 'direct'` (one scenario only) hands an event to the reader's accept
path with the transport skipped. It exists for the harness self-test, not as a
shortcut for the notification cases.

The log is noisy on success — `temp_event_blob_sweep_failed`,
`history_page_link_backoff ... reason=unknown-resource`, and
`latest_event_pull_fallback ... reason=group_state_digest_v3_mismatch` all
appear during a fully green run. They are recovery paths firing against the fake
bridge, not failures. Judge the run by the exit code and the summary block.

### 2.3 Test-mode Electron

The built app can be launched with no display:

```bash
xvfb-run -a electron . --test-mode=/tmp/profile
```

In test mode the app:

- uses an isolated `userData` **and** `appData`, so `app-settings.json` is
  never read from a developer's real installation
- refuses to start if the flag is given without a directory
- never activates in a packaged build
- suppresses every subsystem that would hang or leak state:

| Suppressed                   | Reason recorded in code                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| Reticulum daemon             | downloads or spawns the Python runtime; hangs on a clean machine |
| dev venv ensure-loader       | same download path                                               |
| update checks                | phone home and schedule a 24h interval                           |
| tray                         | owns OS state a headless run must not touch                      |
| audio-surface HTTPS server   | binds a port and needs a certificate                             |
| power monitor                | suspend/resume events never fire headlessly                      |
| OS notification presentation | register entries without showing them                            |

The gate is not one function, and the difference matters if you change it. Only
five of the seven go through `isSuppressedInTestMode` / `isTestModeActive`:

- `isSuppressedInTestMode(isTestMode, …)` — `updateChecks`, `powerMonitor`
  (`index.ts`), `tray` (`setup.ts`)
- `isTestModeActive()` — `audioSurfaceHttpsServer` (`setup.ts:1086`) and OS
  notification presentation (`setup.ts:7100`)

The two Reticulum entries are suppressed by a blunt force setting instead —
`reticulumGloballyEnabled = false` (`index.ts:661`), which also skips
`recoverReticulumStateForAppLaunch` and `registerReticulumAppInstance`
(`index.ts:648`). So those two reason strings are documentation of intent, not
the mechanism that stops the download. Nothing enforces that the setting stays
false; a future change that re-enables Reticulum in test mode would reintroduce
the hang.

This is what made it possible to answer the `contextBridge` question (§3.1)
without a desktop session.

### 2.4 What is proven, today

| Area                                                          | Covered headlessly            |
| ------------------------------------------------------------- | ----------------------------- |
| Group message delivery                                        | Yes, over the real transport  |
| Notification precedence (reply > welcome > mention > generic) | Yes, 8 scenarios              |
| Push level: "all" / "mentions" / "none"                       | Yes, `notification-push-gate` |
| A mention under "all" presents once, not twice                | Yes, `notification-push-gate` |
| Reply and reaction honour their own settings                  | Yes, `notification-push-gate` |
| At most one OS notification per eventId                       | Yes, `OsNotificationClaims`   |
| Mention authorisation derived from signed hashes              | Yes                           |
| Own-post suppression                                          | Yes                           |
| Reaction does not produce a generic notification              | Yes                           |
| Notification registry cap / eviction / dedupe                 | Yes, unit tests               |
| Show-time suppression (viewed channel)                        | Yes, unit tests               |
| Address validators reject malformed input                     | Yes, 6 regression tests       |
| Test-mode gate parsing and refusals                           | Yes, 13 unit tests            |

An earlier version of this table said the push-level gate was covered. It was
not — the harness had a comment saying so, and a real bug shipped through the
gap: with "All Messages" on, a post that mentioned the reader produced two
desktop notifications, one for the mention and one for the generic post. See
§3.7 for what that cost and what closed it.

---

## 3. What headless Hub cannot do

### 3.1 The renderer is not reachable without a production change

`contextBridge` returns a **frozen** object. Measured against the built app:

```
window.reticulumChat  -> isFrozen: true, isSealed: true, isExtensible: false
showNotification      -> writable: false, configurable: false, no setter
rc.showNotification = fn   -> silent no-op
Object.defineProperty(...) -> throws "Cannot redefine property"
isEnabled / onEvent / getHistory / markRead -> also unassignable
```

Consequence: a scenario **cannot** patch a renderer-side function to observe
what the UI did. Any renderer assertion must either go through CDP and read an
IPC return value, or wait for a production change to the preload.

This is why the notification sink was extracted into
`electron/src/qchat-notification-sink.ts`: observation had to move to the main
side because the renderer side is closed.

### 3.2 No real Reticulum, no real Core

Everything about the network is simulated:

- No `rnsd`. No Python `presence_bridge.py`. No fd3/fd4 IPC.
- No Qortal Core. Group membership is satisfied by injecting
  `validateGroupMember`; admin status by `validateGroupAdmin`.
- No wallet. Signing is a synthetic keypair with the same field shape the
  renderer signer produces.

What this means practically: **wire framing, link auth against a real provider,
byte-range assembly for oversized events, peer discovery, and overlay health are
all untested.** The fake copies bytes; the real bridge negotiates for them.

### 3.3 Renderer state is out of reach

These cannot be asserted headlessly, and they are the majority of the remaining
manual Q-Chat checklist:

- `document.visibilityState` and real window focus
- virtualized list contents (`react-virtuoso` — "latest visible message")
- scroll position and its effect on read watermarks
- component-local state, e.g. `selectedReticulumChannelId` in
  `src/components/Chat/ChatGroup.tsx` — 13,546 lines, 80 references and nine
  `setSelectedReticulumChannelId` call sites
- MUI rendering, layout, CSS

### 3.4 Bursty multi-post delivery in one group

Publishing several posts into a single group in **quick succession** does not work
over the transport: the reader's history-page machinery keeps one active pull
window per group, so later posts are deduped
(`history_page_link_deduped ... reason=group-window-mismatch`) and never arrive.

This blocked the combined `notification-push-level-mentions` scenario, which was
removed as redundant. Each case is delivered correctly **one post at a time**, or
in separate groups.

Scope this claim honestly: the attempts that failed all used gaps under two
seconds, which is inside `RETICULUM_CHAT_PULL_THROTTLE_MS` (2 s). So "bursty does
not work" is measured; "any two posts in one group do not work" is **not** — no
attempt used a longer gap. §5.1 describes the sweep that would settle it.

Not resolved; worked around.

### 3.5 Cross-subsystem integration

Not covered headlessly at all:

- Qortal Land (Phaser canvas, games, proximity voice)
- Group voice calls (WebRTC, audio worklets, the audio-surface window)
- Q-Apps (webview guests, their network policy, preload authorisation)
- Wallet, transactions, foreign-coin signing
- The Electron update path, tray, menus, deep links

Some of these have their own harnesses — `test:gcall:e2e:offline` (Vitest, four
files) and `electron/scripts/qapp-guest-smoke.cjs`. They are not part of the
Q-Chat scenario suite and are not driven by it.

### 3.6 The build chain

Scenarios `require('./build/src/...')`. They do not compile it.

```bash
cd electron && npx tsc -p tsconfig.json
```

`npm test`'s `pretest` compiles only the worker threads. CI runs the `tsc` step
explicitly in `.github/workflows/scenarios.yml`. This is a real papercut: a stale
`electron/build/` produces confusing failures — a new module simply does not
exist, or an old signature is used.

### 3.7 The bug that shipped through the gap

Worth recording in full, because the shape recurs.

With push level "All Messages", a post that mentioned the reader produced **two
desktop notifications**: one for the mention, one for the generic "posted in
channel". For a post that also replied, it produced **three**.

The notification scenarios were green throughout. They asserted on
`planReticulumNotifications`, which guarantees `Group.tsx` emits one _event_ per
post — and that was never broken. The duplication was downstream, in
`WebsocketNotifications.tsx`, where four handlers each owned a private "already
notified this eventId" `Set`:

- a mention passed the mention gate _and_ the generic gate, because
  `shouldFirePushNotification` returns `true` unconditionally at push level
  `'all'`;
- reply and reaction never called that function at all, so they ignored both the
  push level and `notifyOnReplies` / `notifyOnReactions` — settings the emitter
  _did_ honour, so the two disagreed;
- `background.ts` keyed the notification id on `Date.now()`, so the main-process
  sink's dedupe could never engage either.

The harness had a comment stating the push gate was out of scope. That comment
was accurate and was the whole problem: **a suite that names its blind spot has
not covered it.**

Closed by: `reticulumNotificationPrecedence.ts` gaining
`resolveOsNotificationKind` + `OsNotificationClaims`, all four handlers asking
that one question, the sync-unread guard moved ahead of the bell-entry rebuild,
and a stable per-event id. Plus `notification-push-gate`, twelve assertions on
the real gate, so the next regression is caught rather than reasoned about.

---

## 4. Where the numbers stand

Of the 21 `## Manual verification` items across the four archived Q-Chat
changes, **7 are now automated**.

| Change                                 | Items  | Automated | Why the rest remain                                                                       |
| -------------------------------------- | ------ | --------- | ----------------------------------------------------------------------------------------- |
| `fix-qchat-notification-precedence`    | 7      | **7**     | None remaining                                                                            |
| `fix-qchat-read-watermark-anchoring`   | 4      | 0         | Context menu, automatic read on scroll, virtualized list, and a peer with a skewed clock  |
| `fix-qchat-viewed-channel-suppression` | 5      | 0         | Two need real visibility/focus; three could be automated on top of already-pure functions |
| `fix-qchat-retained-channel-selection` | 5      | 0         | All turn on component-local selection state                                               |
| **Total**                              | **21** | **7**     | **14**                                                                                    |

The 14 share one cause: they assert on **renderer state** rather than on a
decision with a pure surface.

Note what the 7 did and did not buy. The precedence change was marked fully
automated, and the scenarios were green — yet a real duplicate-notification bug
lived behind them for as long as they existed, because "exactly one event is
emitted" was mistaken for "exactly one notification is shown". Automated counts
measure what a suite asserts, not what the product does.

---

## 5. What would improve it

Ordered by value per unit of work.

### 5.1 Resolve the single-group pull coalescing — highest value

**Problem.** Multiple sequential posts into one group are dropped (§3.4). This is
the only thing that made a scenario impossible rather than merely limited.

**Two possibilities**, and they should be distinguished before fixing:

1. _Intended._ The manager deliberately keeps one pull window per group; a real
   client never receives three notices for one group in the same tick. If so, the
   harness should not attempt it, and the current workaround is correct.
2. _A defect._ If a real client can receive back-to-back posts and the second is
   silently dropped, that is a chat reliability bug users would see.

**Next step — a discriminating experiment.** Publish two posts to one group, then
sweep the gap between them across the constants that govern the pull window, and
record which gaps deliver both:

| Constant                                        | Value     | `electron/src/reticulum-chat.ts` |
| ----------------------------------------------- | --------- | -------------------------------- |
| `RETICULUM_CHAT_PULL_THROTTLE_MS`               | 2 000 ms  | 2275                             |
| `RETICULUM_CHAT_LATEST_PULL_FALLBACK_MS`        | 2 000 ms  | 2503                             |
| `RETICULUM_CHAT_LINKED_EVENT_FALLBACK_GRACE_MS` | 8 000 ms  | 2504                             |
| `RETICULUM_CHAT_ACTIVE_DIGEST_REFRESH_MS`       | 10 000 ms | 2272                             |
| `RETICULUM_CHAT_BACKGROUND_DIGEST_REFRESH_MS`   | 60 000 ms | 2271                             |

Gaps to try: 0, 1 s, 3 s, 9 s, 11 s, 30 s, 65 s. Two outcomes, two conclusions:

- **Every gap delivers both** → the earlier failure was a harness bug (my
  workaround was wrong, and the dropped scenario should come back).
- **Short gaps drop, long gaps deliver, with the transition near a constant above**
  → the coalescing is deliberate and the current workaround is correct. Record the
  transition point in `electron/scenarios/readme.md` so nobody re-derives it.
- **Some gap drops with no explanation in those constants** → treat as a defect
  and open a chat-reliability issue, because a user posting twice in ten seconds
  would lose a message.

Note the earlier single-group attempts used gaps well under 2 s, which is inside
the throttle window — so the observed failure is consistent with option 2 and
would be _correct_ behaviour. That is why the sweep, not another one-off retry,
is the next step.

### 5.2 Automate the three reachable suppression items — cheapest win

`fix-qchat-viewed-channel-suppression` has 5 manual items. Three are decisions
the codebase has **already** extracted into pure functions:

- `shouldSuppressForViewedChannel` — `electron/src/qchat-view-context.ts:35`
- `getReticulumChannelDismissalTarget` —
  `src/components/Chat/reticulumChannelDismissal.ts:41`
- `getReticulumViewChannelPayload` — same file, line 91

They are unit-tested but not scenario-tested end to end through the sink. Wiring
them into the existing harness is mostly assertion-writing.

One caveat, and it is measured rather than hypothetical:

- `qchat-view-context.ts` is under `electron/src/`, so a scenario imports it from
  `electron/build/src/`. Straightforward.
- The other two are renderer modules. Type stripping loads them **only if their
  import graph is empty.** `reticulumNotificationPlan.ts` works because it has
  zero imports. `reticulumChannelDismissal.ts` has one —
  `import { DEFAULT_NOT_VIEWING_GROUP_ID } from '../../utils/qChatViewContextSuppression'` —
  and that import is extensionless, so Node's ESM resolver fails:

  ```
  ERR_MODULE_NOT_FOUND: .../src/utils/qChatViewContextSuppression
  ```

  The dependency itself (`qChatViewContextSuppression.ts`) also has zero imports,
  so the chain terminates — the blocker is the missing `.ts` on the specifier, not
  a deep graph.

  Two ways forward: add an explicit extension to that import (harmless under
  Vite), or copy the two decisions into a `electron/scenarios/` helper and assert
  on those. Prefer the first — it keeps the shipped file the one under test.

### 5.3 A renderer tier — for the three genuinely Chromium-bound items

The remaining blockers are `document.visibilityState`, real focus, and
virtualized-list contents.

Playwright's `_electron` launcher is the practical route. Known costs, all
verified during this work:

- needs `xvfb-run` in CI (now installable and working)
- must delete `ELECTRON_RUN_AS_NODE` from the child environment, or Electron
  runs as plain Node and dies inside `electron-is-dev` before any window exists
- `electron` resolves from `electron/node_modules`, not the project root
- must find the main window by URL (`capacitor-electron://`), not by
  `firstWindow()` — the splash and audio-surface windows come up too
- cannot patch `window.reticulumChat`; assert on IPC return values instead

**Gate this** on the in-process tier having survived real feature work first. A
red-and-ignored E2E job is worse than none, because it looks like coverage.

### 5.4 Make `electron/build/` a build step, not an assumption

**Problem.** Scenarios fail confusingly against a stale build (§3.6).

**Fix.** A `pretest:scenarios` script that compiles `electron/` when the source
is newer than the output, plus a version stamp written by `tsc` and checked by
the runner. Cheap, and removes the most common way a newcomer gets stuck.

### 5.5 `data-testid` discipline, if a renderer tier lands

There are exactly **five** product `data-testid` attributes in `src/`, and none
of them are in the chat surface:

| File                                                        | Value                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/components/PasswordField/PasswordField.tsx`            | `toggle-view-password-btn`, `plain-text-indicator`, `password-text-indicator` |
| `src/components/Onboarding/OnboardingQChatPreview.tsx`      | `onboarding-qchat-preview`                                                    |
| `src/components/QortalLand/games/ConnectFourGameDialog.tsx` | `connect-four-board-status`                                                   |

A Playwright tier would need a sweep across `ChatGroup.tsx`, `Group.tsx`,
`GroupList.tsx`, `DirectsSidebar.tsx`, `MessageItem.tsx`, and the context
menus. The pattern to copy is not `data-testid` — it is the `data-reticulum-*`
convention that already exists in six places in the chat surface:

- `data-reticulum-chat-root` — `ChatList.tsx`, `MessageItem.tsx` (2),
  `ReticulumDiscussionDialog.tsx`
- `data-reticulum-chat-scroll-viewport` — `ChatList.tsx`, `MessageDisplay.tsx`

Prefer extending that convention over adding a parallel attribute vocabulary.

Also: pin `lng: 'en'` in test mode. Accessible-name locators are locale-dependent
and **12 locales** ship (`en`, `ar`, `de`, `es`, `et`, `fi`, `fr`, `it`, `ja`,
`pt`, `ru`, `zh` — `supportedLanguages` in `src/i18n/i18n.ts:11`).

The risk is concrete, not theoretical. `getInitialLanguage()`
(`src/i18n/i18n.ts:45`) reads `localStorage.getItem('i18nextLng')` and defaults to
`'en'`, but an isolated test profile starts with empty `localStorage` and the app
then writes whatever the user picks. A test-mode profile reused across runs, or a
scenario that exercises the language picker, would silently change the text under
every locator. Pin `lng` explicitly rather than relying on the default.

### 5.6 A notification-observation hook for the renderer, if it ever matters

Because the bridge is frozen (§3.1), observing "what would the UI have shown"
from the renderer needs a production seam. Options, in order of preference:

1. **No change** — the main-side sink already answers this. Current approach.
2. A test-only preload switch adding `__hubTestNotificationLog`.
3. A general diagnostics ring buffer exposed over IPC, useful in production too.

Option 3 is the only one that earns its surface outside tests.

### 5.7 Fix `npm run lint`'s history — done, but extend it

`eslint.config.js` previously configured only `src/**/*.{ts,tsx}`, so all 163
`electron/src/**/*.ts` files reported `Parsing error: Unexpected token type` and
lint could never pass. Fixed, and `npm run lint` is now wired into
`npm_tests.yml`. Verified clean: `eslint . --max-warnings 0` exits 0.

Still outstanding: three unrelated specs fail `openspec validate --specs` —
`group-message-no-expiry`, `scope-mute`, and `spell-check-context-menu`, out of
21 items (18 pass, 3 fail). They predate the harness work and appear to be
older-format specs never migrated. All three specs added by this work validate.

### 5.8 Scenario breadth beyond Q-Chat

The harness shape — two real managers + a fake bridge — generalises to anything
that speaks Reticulum chat wires. Worth extending to:

- **DM paths.** The manager has a parallel direct-message stack
  (`publishDirectEvent`, `getDirectHistory`, DM read watermarks). Untested
  headlessly today.
- **Read-sync / watermark convergence.** Two devices, one channel.
- **Silence (mute) behaviour** at the manager level — partially unit-tested.

---

## 6. Operating it

```bash
# one-off: compile the main process (scenarios do NOT compile it)
cd electron && npx tsc -p tsconfig.json && cd ..

# every scenario, each in its own process
npm run test:scenarios

# a subset
node electron/scenarios/run-all.mjs --filter notification-

# one scenario
npm run test:scenario -- notification-reply

# list the available names
node electron/scenarios/runner.mjs --list
```

Adding a scenario: drop a file in `electron/scenarios/scenarios/` default-exporting
`{ name, delivery, run }`. Files whose name ends in `-support` are helpers and are
not listed as scenarios. Read `electron/scenarios/readme.md` first — it records
the failure modes that cost the most time, all of which present as silence rather
than errors:

- presence hashes must be hex, 16–64 chars, or routing fails with no log
- `signLocalFields` must return `authorAddress` **and** `authorPublicKey`, and
  must sign the fields the _verifier_ canonicalises, not the fields it receives
- `payloadHash` must be `hashReticulumChatMessagePayload(encryptedPayload)`;
  `eventId` must be ≥ 8 chars
- subscriptions must be exchanged, or `publishEvent` reports `ok: true` and
  delivers nothing
- a non-`general` channel must exist in the database before publishing to it
- membership is **replaced**, not appended, by `setLocalGroupMemberships`

---

## 7. The lesson worth keeping

Four bugs surfaced while building the transport tier, and **all four were
silence, not errors**:

1. A wire attributed to the recipient instead of the sender — dropped by the
   recipient with no log.
2. A signature covering the fields received rather than the fields verified —
   rejected with a bare `null`.
3. An auth request sent over a wire kind nothing listened for — the provider
   never registered anything.
4. A resource lookup racing an async registration queue — sampled once, found
   nothing.

None threw. None logged. Each looked like "the transport is broken."

That is the argument for making a fake call the **real** code paths rather than
model them. A fake that agrees with itself proves nothing; every one of these was
found only because the fake was made to touch the shipping implementation.

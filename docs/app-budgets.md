# App budgets

A budget is a QORT fee allowance for one Q-App or website, per account, on
one PC. While it lasts, the app's everyday actions run without the approval
window. Hub only keeps count: no QORT moves until each action's own fee is
paid, from the account's own balance, as always.

Code: `src/qortal/appBudgets.ts` (store and rules),
`src/qortal/appBudgetApproval.ts` (where the request handlers ask),
`src/components/AppBudgets/` (the search bar button, its panel and the
approval window's refill section).

## What a budget can pay for

| Request                          | When                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| `PUBLISH_QDN_RESOURCE`           | the resource is new, and there is no app fee                         |
| `PUBLISH_MULTIPLE_QDN_RESOURCES` | every resource is new, and there is no app fee; each one counts once |
| `VOTE_ON_POLL`                   | always                                                               |
| `SEND_CHAT_MESSAGE`              | always; no fee, so it counts toward the limits only                  |

A resource is new when the node answers `NOT_PUBLISHED` for its service, name
and identifier (`/arbitrary/resource/status/...`), it isn't being published
right now, and it wasn't published from this Hub earlier this session (the
node may not list it yet). Publishes the user approved in the window count
too. An answer that can't be read doesn't count as new, so the window asks.
A request that waited its turn in the window's queue is checked with the
node again before a budget pays for it. The identifier
is the one Core publishes to: none, `''` and `default` are the default
resource; the text `null` is an identifier of its own.

Some publishes and votes always ask, even when new:

- a Q-App or website under the user's name (services `APP` and `WEBSITE`,
  widgets too);
- the avatar (`qortal_avatar`);
- records Hub reads back as its own or as the account's: its settings
  (`ext_saved_settings…`), its library's pages, reviews and replies
  (`qhub_…`), group keys (`symmetric-qchat-group-…`,
  `admins-symmetric-qchat-group-…`);
- votes on Hub's library ratings (polls `app-library-…`).

Everything else never looks at a budget: payments in any coin, app fees,
names, trades, group changes, publishing over something that exists,
deleting, signing transactions or foreign fees, encryption and keys.

A budget is never used:

- for Hub's own requests (`HUB_REQUEST`), a private app, a preview of an
  unpublished app (the screenshot capture) or an app in Dev Mode (the tab
  marks them in `appInfo`: `isPrivate`, `isPreview`, `isDevMode`);
- for a request without the tab it came from;
- while Hub is locked;
- when the node's fee for the action can't be read;
- when the signing session changed since the request came in (see below),
  or is changing.

The app is the tab the request came from (`appInfo`, as the approval window
names it), never anything in the request: service `APP` or `WEBSITE` plus the
name. Names match in any case; a Q-App and a website of the same name have
budgets of their own.

Session permissions and the stored "always allow" switches are checked first,
as before; a request they allow doesn't touch the budget.

A request a budget pays for is signed in the signing session it came in, by
the account whose budget took it, or not at all. The signing session is
`getSigningContextRevision` (`src/utils/chromeStorage.ts`): it changes
whenever the wallet, its keys or the node are stored or removed, so a logout,
another account signing in or another node ends it. Right before the request
signs, `checkBudgetSigner` checks the session and that the key it signs with
is that account's: in the vote and chat handlers after they read the key
pair, and in `publishData` through its `beforeSigning`. When either changed,
nothing is signed, the request's fees go back to the budget, and the app gets
`question:message.error.account_changed`. A multi-publish stops there: the
resources after it aren't published either. A request already sent when the
session changes was signed by its own account, and counts.

## Store

`localStorage['app-budgets-v1:<address>']`, on this PC only:

```ts
{
  v: 1,
  budgets: [{
    id: string,         // 16 hex characters
    service: 'APP' | 'WEBSITE',
    name: string,
    total: string,      // all QORT given to it, in 1e-8 units
    used: string,       // fees of the actions it allowed
    actions: number,
    startedAt: number,
    expiresAt: number | null,
    limits: 'standard' | 'higher' | 'none',
    times: number[],    // when the actions of the last 24 h happened
    // the last 50, oldest first; `recipient` for a direct message
    recent: { at, kind, fee, service?, identifier?, poll?, groupId?, recipient? }[],
    notice: { at: number, count: number, seen: boolean } | null,
  }]
}
```

Anything unreadable counts as no budget, so the app asks.

- **Taking** (`takeFromAppBudget`) is synchronous: the fee and a place under
  the limits are held in memory in the same step as the check, so two
  requests can't both take what is left. The ticket's `done()` moves one
  action's fee to `used`; `release()` gives back what wasn't done. A publish
  is built with exactly the fee that was held (`publishData`'s `feeAmount`).
- What is held belongs to that budget (each has an `id`): a budget removed
  and added again starts with nothing held, and an action of the old one
  isn't charged to the new one.
- **Used up** means what is left can't pay the next action; a chat message,
  which has no fee, counts at the usual 0.01 here, as the panel shows it.
- **Ended** is checked when an action happens (`now >= expiresAt`), never with
  a timer.
- **Limits** are rolling: standard 20 a minute and 300 a day, higher 100 and
  1,000, none. Actions under way count too. A request with more actions than
  a minute allows (a multi-publish of 21 on standard) just asks.
- **Top up** adds to what is left. On an ended budget the leftover is dropped:
  what is left is the new amount. `used` and `total` count for the life of the
  budget. **Remove** deletes it.
- **Notice**: the action that brings a budget's last 24 hours to 50 actions
  (`APP_BUDGET_NOTICE_AT`) sets `notice`, unless one was set less than 24
  hours before. `seen` is set when the user closes it or opens the budget
  from it.

## The approval window

When the budget doesn't pay, the window opens as before (same queue,
countdown, Accept delay, lock handling), with `budget` in its payload:

- **used up** or **ended**: a refill section (amount, end, limits) and three
  buttons: Top up and approve, Approve this one only, Decline. get.ts checks
  the choices again (`budgetChoiceFrom`), refills the budget and lets it pay
  for this request; a request waiting behind it in the queue then uses the
  new budget without a window.
- **limit**: one line saying which limit made it ask.
- **replaces** or **publishing**: one line saying why the budget doesn't pay
  for a publish it would otherwise pay for: the node lists one of its
  resources, or this Hub published it earlier this session (`replaces`), or
  the same resource is being published right now (`publishing`, by this app
  or another one, e.g. a second tap on a like before the first one is
  published). When the node
  can't say whether a resource exists, the window says nothing.

A request that waited its turn shows the budget as it is when its window
opens, not as it was when the request came. "Approve this one only" isn't
counted in the budget.

## The panel

The search bar's button (between Pin and Go) opens it. With a Q-App's or
website's tab on screen (not a launcher tab, one of Hub's own pages or a
private app) it starts with that app: add a budget, top it up, change its end
and limits, or remove it. Below that, and on Home, every other budget of the
account, then the ended ones with Renew.

Each budget shows its **recent activity**: its last 50 actions, newest first,
with what each was (the resource published, the poll, the group or the
recipient of a direct message), when, and its fee. What an app named there
(and a coin in a box's label) sits in a Unicode isolate of its own, with the
direction marks it held taken out, so nothing in it can end the isolate early
or turn the words around it.

Under the app on screen, **also allowed without asking** lists what else lets
its requests through without a window, each with **Turn off**:

- remembered for the signed-in account: the "always allow" boxes ticked for
  it (kept per account and per app name, so a Q-App and a website of one name
  share them), the lists box, which covers every app, and its notifications;
- what its tab may do until it closes (session permissions), by the action's
  name, as the approval window showed them, folded under "Until this tab
  closes (n)" until opened. Each one says what it allows in words on hover
  (`sessionPermissionText`; every action in `VALID_SESSION_PERMISSIONS` that
  a request reads has its own), and an (i) by the heading says what the list
  is and that taking one back makes the app ask first, or leaves it unable to
  do it. Permissions no request reads aren't listed
  (`SESSION_PERMISSIONS_NOT_READ`): the group actions ask with or without
  them, and `GET_SERVER_CONNECTION_HISTORY` never asks.

Turn off works only while that account is signed in:

- A box is stored as not allowed. A box's own use gives the tab a session
  permission too (a sign-in gives `GET_USER_ACCOUNT` and the look-ups), so
  turning the box off also takes its counterpart (`SESSION_TWIN`) out of this
  tab. While the box is on, that counterpart isn't listed apart.
- Notifications are turned off as the notification settings do: the stored
  permission is set to false and the websocket reconnects without the app's
  rules. The tab's `NOTIFICATION_PERMISSION` goes too.
- `PRIVATE_DATA_CHANNEL` takes the tab's approved Reticulum destinations with
  it, as reaching one of them would give it back without asking.

The next such request asks again; one already approved finishes. Coins in a
box's key are read only when they look like one (letters and digits, 2 to 10).
At the end of the panel, the boxes ticked for other apps, in a grid of small
tiles: one per app with its picture, and the lists box under Every app. Their
tabs aren't known there, so Turn off leaves the box only.

Nothing turned off leaves the list, so it can be turned on again:

- A box or the notifications stay under the app with **Turn on**
  (`turnOnAccountChoice`, `turnOnNotifications`: stored as allowed again,
  and the websocket reconnects with the app's rules). Only a tick or a Turn
  off is stored, so a box stored as not allowed was turned off. Under other
  apps, a box turned off stays with Turn on while the panel is open.
- What the user took back from the tab stays, greyed, with **Allow again**
  until the tab closes, also across a refresh of the app
  (`revokeSessionPermission(..., { takeBack: true })`,
  `getTakenBackSessionPermissions`, `allowSessionPermissionAgain`). A
  sign-in's look-ups (`AUTO_GRANTED_PERMISSIONS_ON_AUTH`) leave out what was
  taken back from that tab; the sign-in itself is given as before. Allowing
  it again ends that, and so does a window that gives the permission itself:
  a sign-in gives `GET_USER_ACCOUNT`, the notification prompt
  `NOTIFICATION_PERMISSION`, a backend connection `PRIVATE_DATA_CHANNEL`, and
  the app's `SESSION_PERMISSIONS` request what it lists. A request approved
  once in its own window, such as a look-up, is answered without giving it
  back.
- `START_CROSSCHAIN_SERVER` is refused, not asked, without its session
  permission (`SESSION_PERMISSIONS_REFUSED_WITHOUT`): taken back, the app
  can't start a coin's server in that tab until it is allowed again, and its
  chip says so.

## The notice

`AppBudgetNotices`, in Group's card dock at the bottom of the page, shows the
oldest notice the signed-in account hasn't seen: "<app> used its budget for 50
actions in the last day", with See them (the budget, with its activity open,
in a window of its own) and OK. Nothing shows while Hub is locked, and the window
closes when Hub locks or the account changes. Only budget actions count:
the boxes and session permissions keep no record.

## Not covered

- An account switch between the decision and the signature (same as an
  approval answered just before a switch).
- A node that hasn't seen a resource published elsewhere yet reports it as
  new.

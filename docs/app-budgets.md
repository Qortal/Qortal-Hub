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
too. An answer that can't be read counts as "exists". A request that waited
its turn in the window's queue is checked with the node again before a
budget pays for it. The identifier
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
- when the node's fee for the action can't be read.

The app is the tab the request came from (`appInfo`, as the approval window
names it), never anything in the request: service `APP` or `WEBSITE` plus the
name. Names match in any case; a Q-App and a website of the same name have
budgets of their own.

Session permissions and the stored "always allow" switches are checked first,
as before; a request they allow doesn't touch the budget.

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
    recent: { at, kind, fee, service?, identifier?, poll?, groupId? }[], // last 50
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
  the app is publishing the same resource right now (`publishing`, e.g. a
  second tap on a like before the first one is published). When the node
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

## Not covered

- An account switch between the decision and the signature (same as an
  approval answered just before a switch).
- A node that hasn't seen a resource published elsewhere yet reports it as
  new.

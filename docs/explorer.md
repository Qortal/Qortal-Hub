# Explorer

The Explorer looks up Qortal accounts. It takes User search's place: App mounts
`ExplorerWindow` with the props User search had, and every way into User search
opens it through the same event:

```ts
executeEvent('openUserLookupDrawer', { addressOrName }); // a name or an address
executeEvent('openUserLookupDrawer', {}); // the start page
```

Sent while the window is open, the event opens that account in it as one more
step of the trail. A Q-App's `OPEN_USER_LOOKUP` request sends the same event.

## What it shows

- **Start page:** one field for a name or a Q-address (names are suggested from
  2 letters; Enter looks up exactly what was typed), your account, and recent
  explorations.
- **An account:** its picture and name, chips (level, Minter Admin or MINTER
  member, Dev Admin, minting now, a minting penalty, blocked), its address and
  public key with Copy, Send QORT and Block (as User search had them), and the
  trail of accounts opened one from another.
- **Its Overview:** one line of facts (level, MINTER, names, first seen, last
  sent), At a glance (level and progress, blocks minted, balance, first seen,
  groups, QORT received / sent), its groups, MINTER (with a button to
  Q-Mintership), minting now and the last block it signed, notes on how its
  primary name is written, and its newest payments.
- **Its own pages** for a name no one has, an address the node rejects, an
  address never used, an AT address and a transaction signature.

QORT received / sent add up its newest 500 payments, as User search did, and
say so: "in its newest 500 payments" when the node had that many, "in all N of
its payments" otherwise. They count QORT payments only (an (i) says so):
multi-payments, trades and minting aren't in them.

First seen is the oldest confirmed transaction involving the account. The level
progress and the blocks to the next level are measured as in Hub's Minting
window and Home, and Total blocks minted includes the adjustment Core records,
as User search showed it.

## Rules

- **Read-only.** Public GETs to the node Hub uses, no API key. Send QORT and
  Block hand over to Hub's own payment window and block lists. Send QORT hands
  over the address only (a name could change hands before the payment is
  sent), and Block waits until the account's name is known, so the address and
  the name are blocked together.
- **A failed read is never "nothing there".** Each read loads, fails and
  retries on its own; "the node has nothing" is an answer of its own.
- **Answers that arrive late are dropped:** after another account was opened,
  after Refresh, or after the window closed. A new answer reaches every place
  showing it, so Retry in one place fixes the others. Refresh keeps the page as
  it is while it reads again.
- **The trail is kept per step:** Back and Forward show the trail as it was
  when that account was opened.
- **One cache per window,** dropped when Hub's signed-in account changes, and
  when the window has closed: once it has faded out, so a closing window keeps
  showing what it showed and reads nothing on its way out
  (`src/lib/explorer/cache.ts`). Failed reads are never kept.
- **Paths are built from encoded parts only** (`seg` in
  `src/lib/explorer/core.ts`); "." and ".." are refused.
- **Recent explorations** are kept on this device for each Hub account apart
  (`explorer-recent:<address>`), only while "Remember accounts I explore on this
  device" is on (`explorer-remember:<address>`; off forgets them).

## Code

| Where                                   | What                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/lib/explorer/`                     | the reads (`reads.ts`, `firstSeen.ts`), the cache, the small rules (`rules.ts`), recent explorations, formats |
| `src/components/Explorer/`              | the window, start page, account page, header, trail and Overview sections                                     |
| `src/i18n/locales/<lang>/explorer.json` | its text, in all 12 languages                                                                                 |

The levels' maths are Hub's Minting window's (`MintingStats.tsx`).

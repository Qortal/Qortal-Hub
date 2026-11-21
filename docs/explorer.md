# Explorer

The Explorer looks up Qortal accounts and transactions. It takes User search's
place: App mounts `ExplorerWindow` with the props User search had, and every way
into User search opens it through the same event:

```ts
executeEvent('openUserLookupDrawer', { addressOrName }); // a name, an address or a transaction signature
executeEvent('openUserLookupDrawer', {}); // the start page
```

Sent while the window is open, the event opens what it names in it as one more
step of the trail. A Q-App's `OPEN_USER_LOOKUP` request sends the same event.

## What it shows

- **Start page:** one field for a name, an address or a transaction signature
  (names are suggested from 2 letters; Enter looks up exactly what was typed),
  your account, and recent explorations.
- **An account:** its picture and name, chips (level, Minter Admin or MINTER
  member, Dev Admin, minting now, a minting penalty, blocked), its address and
  public key with Copy, Send QORT and Block (as User search had them), the trail
  of accounts opened one from another, then its tabs: Overview and
  Transactions.
- **Its Overview:** one line of facts (level, MINTER, names, first seen, last
  sent), At a glance (level and progress, blocks minted, balance, first seen,
  groups, QORT received / sent), its groups, MINTER (with a button to
  Q-Mintership), minting now and the last block it signed, notes on how its
  primary name is written, and its latest transactions (the newest 5, with a
  link to the Transactions tab).
- **Its Transactions:** everything it did, newest first, each as a sentence
  told from its side ("Sent 15 QORT to Publisher", "Received 2 QORT from
  Second"), with when and in which block. Filters by kind (Payments, Names,
  Minting, Groups, QDN data, Trading, Messages, Other) and by one type of a
  kind. What it sent that waits for a block is shown apart. Each row opens to
  its fields, the accounts involved, its raw API answer and "Open
  transaction".
- **One transaction** (by its signature): its type, its sentence, its block and
  time (or that it waits for one), the fee, its group approval when it needs
  one, its signature with Copy, the accounts involved, for a group approval the
  transaction it answers, its fields and its raw API answer.
- **An AT** (a program on the chain, `A…`): its address and its transactions.
- **Its own pages** for a name no one has, an address the node rejects, an
  address never used and a signature the node doesn't know.

QORT received / sent add up its newest 500 payments, as User search did, and
say so: "in its newest 500 payments" when the node had that many, "in all N of
its payments" otherwise. They count QORT payments only (an (i) says so):
multi-payments, trades and minting aren't in them.

First seen is the oldest confirmed transaction involving the account. The level
progress and the blocks to the next level are measured as in Hub's Minting
window and Home, and Total blocks minted includes the adjustment Core records,
as User search showed it.

## Transactions

- **Read 100 at a time,** newest first, by address
  (`/transactions/search?address=…&confirmationStatus=CONFIRMED&limit=100`,
  each type picked as a `txType`), with "Show more", up to 1,000 of each kind.
  The line under the list says how much is on screen ("Its newest 300
  transactions.", "All 37 of its transactions.") and, at 1,000, that the
  Explorer stops there. A list never holds more than the newest 1,000: a
  Refresh at 1,000 lets the oldest go. One list per account and kind is one
  cache entry (`src/lib/explorer/accountTx.ts`), so the Overview's latest
  transactions and the tab share the All list. "All transactions" on the
  Overview opens the tab showing every kind.
- **Refresh** reads the newest page again and puts what is new on top of the
  rows on screen; the next older page then starts right after the last row
  held: no gap, no repeat. Refresh and "Show more" merge onto one list, the
  one on screen when their answer arrives, so a "Show more" on its way while
  Refresh reads keeps what Refresh found (an older page that no longer follows
  on is left out, and the list starts over when more than a page arrived). A
  failed Refresh keeps the rows on screen and says so; its Retry reads the
  newest page again onto them. A "Show more" still on its way when another
  kind is picked is dropped.
- **Waiting transactions** aren't in an address search (Core records who a
  transaction involves only once it is in a block): the ones the account sent
  are read from the node's list by its public key
  (`/transactions/unconfirmed?creator=…`, at most 100: a full answer counts
  "at least"); ones sent to it show once they are in a block, and the section
  says so. A line says it is reading meanwhile. One that got into a block
  between the two reads shows only among the confirmed.
- **Sentences** (`src/lib/explorer/txWords.ts`) are keys and slots, not text:
  one key per type and side under `explorer:tx.say` (`transfer.out`,
  `group_invite.in_proposed`, …), whose translation places its slots
  (`{{actor}}`, `{{amount}}`, `{{group}}`…) where its language puts them. On
  screen (`transactions/TxSentence.tsx`) the translated sentence is split at
  its slots, so accounts are links (opening them in the Explorer, a step on the
  trail) and names are isolated (`<bdi>`). Slots hold only a name, an address,
  a number or an amount; the nouns around them ("the group", "the
  transaction") are in the sentence, so every language can decline them.
- **A change that waits for, or didn't get, a group's approval** reads as a
  proposal ("Proposed to invite …"), with a note on how it ended.
- **A new asset or group still waiting for a block** has no number yet (Core
  numbers it only then): its sentence names it by the name the transaction
  carries ("Issued the asset “Example Coin”"). What Core's own null account
  made (the genesis assets) reads without a maker ("The asset “QORT” was
  issued"), and any other transaction whose maker can't be named reads as "A
  transaction: …", never "an unknown account …".
- **What is never shown:** a message's content (a MESSAGE's or CHAT's data,
  an AT's message: in its row, its page and its raw answer), and the
  identifier and data of a resource published under a private QDN service
  (Core's `…_PRIVATE` services, and MAIL), which reads as "an encrypted
  resource". Whether a resource under a public service is encrypted (a private
  Q-App is an encrypted DOCUMENT) the transaction can't tell, so it shows as
  that service does. Fields only the raw answer carries (`txGroupId`,
  `timeToLive`…) show only there.
- **Who received a minting level** (TRANSFER_PRIVS) isn't in Core's JSON: it is
  read from the transaction's raw bytes, except in the recipient's own list.
- **Names in a row are read once the row nears the screen,** so a long list
  doesn't read every account's name at once.

## Rules

- **Read-only.** Public GETs to the node Hub uses, no API key. Send QORT and
  Block hand over to Hub's own payment window and block lists. Send QORT hands
  over the address only (a name could change hands before the payment is
  sent), and Block waits until the account's name is known, so the address and
  the name are blocked together.
- **A failed read is never "nothing there".** Each read loads, fails and
  retries on its own; "the node has nothing" is an answer of its own (Core's
  "transaction unknown" for a signature, "group unknown" for a group).
- **Answers that arrive late are dropped:** after another account, transaction
  or kind was opened, after Refresh, or after the window closed. A new answer
  reaches every place showing it, so Retry in one place fixes the others.
  Refresh keeps the page as it is while it reads again.
- **Each step of the history keeps what it showed:** the trail as it was when
  that account was opened, the tab, and the kind picked. Switching tabs or
  kinds changes the step in place; Back and Forward show each step as it was
  left.
- **One cache per window,** dropped when Hub's signed-in account changes, and
  when the window has closed: once it has faded out, so a closing window keeps
  showing what it showed and reads nothing on its way out
  (`src/lib/explorer/cache.ts`). Failed reads are never kept.
- **Paths are built from encoded parts only** (`seg` in
  `src/lib/explorer/core.ts`); "." and ".." are refused. A link in a sentence
  opens a transaction only for a signature.
- **Recent explorations** are kept on this device for each Hub account apart
  (`explorer-recent:<address>`), only while "Remember accounts I explore on this
  device" is on (`explorer-remember:<address>`; off forgets them).

## Code

| Where                                   | What                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/explorer/`                     | the reads (`reads.ts`, `accountTx.ts`), the cache, the small rules (`rules.ts`), the transactions' words, kinds and services (`txWords.ts`, `txFamilies.ts`, `qdnServices.ts`, `rawTx.ts`), recent explorations, formats |
| `src/components/Explorer/`              | the window, start page, account page, header, trail, tabs (`AccountTabs.tsx`) and Overview sections                                                                                                                      |
| `src/components/Explorer/transactions/` | the Transactions tab, its rows and their sentences, one transaction's page                                                                                                                                               |
| `src/i18n/locales/<lang>/explorer.json` | its text, in all 12 languages                                                                                                                                                                                            |

A later part adds its tab as one more entry of `ACCOUNT_TABS` (with `shown` for
a tab only some viewers see). The levels' maths are Hub's Minting window's
(`MintingStats.tsx`).

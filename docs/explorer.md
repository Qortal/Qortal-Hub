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
  of accounts opened one from another, then its tabs: Overview, Transactions
  and Names, and Connections for a viewer the level 5+ rule lets see it (see
  below).
- **Its Overview:** one line of facts (level, MINTER, names, first seen, last
  sent), At a glance (level and progress, blocks minted, balance, first seen,
  groups, QORT received / sent), its groups, MINTER (with a button to
  Q-Mintership), minting now and the last block it signed, notes on how its
  primary name is written and how many of its other names have such notes, and
  its latest transactions (the newest 5, with a link to the Transactions tab).
  "Owns 3 names" in the first line and the line on its other names open the
  Names tab. For a viewer the rule lets in, Direct links come right after the
  first line: the first three things Connections recorded, and "All
  connections (n)", which opens that tab.
- **Its Transactions:** everything it did, newest first, each as a sentence
  told from its side ("Sent 15 QORT to Publisher", "Received 2 QORT from
  Second"), with when and in which block. Filters by kind (Payments, Names,
  Minting, Groups, QDN data, Trading, Messages, Other) and by one type of a
  kind. What it sent that waits for a block is shown apart. Each row opens to
  its fields, the accounts involved, its raw API answer and "Open
  transaction".
- **Its Names:** every name it owns, as cards or a list, its primary name
  first (or in another order: newest or oldest registered, A to Z, Z to A,
  latest activity), each with its record (when it was registered and last
  updated, whether it is for sale and at what price), notes on how it is
  written, what this account did with it, and "Its whole history". Below, the
  names it had: sold, or renamed to something else, each with who has it now.
- **A name's whole history** (from a name on the Names tab or in any
  sentence): its record and owner, then every change to it since it was
  registered, by every account that had it, each row opening to its fields and
  the accounts involved.
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

## The level 5+ rule

Some parts of the Explorer are detailed parts: the Connections tab, the
Overview's Direct links, and exchanges' accounts named as such. They show only
to the signed-in Hub account when it is a Minter Admin (an admin of MINTER,
group 694), a MINTER member at level 5 or above, or a Dev Admin (an admin of
group 1), the same rule as Q-Mintership+'s (`src/lib/explorer/access.ts`).

This hides parts of Hub's screen; it doesn't protect data. Everything the
detailed parts show is public on the chain: any node answers anyone who asks,
and Hub is open source. Like Q-Mintership+, it only keeps chain-analysis tools
out of everyone's way.

- **Reads:** the viewer's account (its level, `/addresses/<viewer>`) and its
  groups (`/groups/member/<viewer>`); the Dev Admins
  (`/groups/members/1?onlyAdmins=true`) only when those two don't settle it. A
  Minter Admin is settled by its groups alone. They go through the window's
  cache, so the viewer's own account page and every page's Dev Admin mark share
  them.
- **When:** read when the window opens, and kept about a minute for that Hub
  account (`ACCESS_TTL_MS`): reopening within it reads nothing again. Another
  Hub account starts again; an answer for the last one that arrives late is
  dropped. Nothing polls.
- **Fail closed:** while it is being read, and when a read fails, the detailed
  parts stay out, and a failed read is never kept, so reopening the window
  reads it again. Nothing flashes in and out.
- **Silent:** for everyone else, the Connections tab isn't in the tab list,
  the Overview has no Direct links, and nothing says anything is left out.
- **Every way in:** the tab list (`AccountTabs.tsx`, `shown`) and the account
  page check it; Direct links (and its "All connections") show only with it; a
  step whose tab was Connections shows the Overview when the rule doesn't let
  the viewer in (and the window starts again when the Hub account changes, so
  Back never returns to one); the trail and links in sentences open accounts on
  their Overview; a Q-App's `OPEN_USER_LOOKUP` opens an account on its Overview
  whatever else it sends.
- **Nothing of a detailed part is read** for a viewer who doesn't see it: the
  parts that read are mounted only for viewers the rule lets in.

## Connections

How the account is linked to other accounts, by its own transactions, as
evidence: each link a sentence with numbers, a date and a block, opening to the
transactions behind it (as the Transactions tab's rows). Never a verdict.

- **QORT sent to exchanges, or got from them**, at the top: what it paid each
  known exchange (`KNOWN_EXCHANGES`: TradeOgre, nonkyc.io) and got from it,
  read exactly by sender and recipient (`/transactions/payments/between`, 100
  a read, up to 1,000 a way; one more row then says whether there are older
  ones), and it says so. On a node without that read, from the payments the
  lists below read, saying so; when those lists stopped short, each line says
  there may be older payments (never that there are). An exchange's row under
  Payments counts only the
  payments read there, and says that every QORT payment with it is added up at
  the top, so the two totals never read as one claim. On an exchange's own
  account it says whose it is.
- **Recorded between them:**
  - minting level moved (to the recipient read from the raw bytes, or from
    the account that sent it, with that account's level now);
  - reward shares: its sponsor (the first account that made it a reward
    share, and how many blocks that ran), minting with another account now
    (its active shares in the online list; when that list couldn't be read, it
    says so, with Retry), and the accounts it sponsored ("48+" when its Minting
    list stopped short);
  - names bought or sold;
  - Q-Asset trades, by the other account: its orders filled at least in part
    (`/assets/orders/<address>`, three reads for Core's exact filters; none for
    an account that never signed a transaction, which Core says it doesn't
    know, as it finds orders by public key), each
    one's trades and who placed the other order, the newest 100 filled orders
    at most, and up to 1,000 trades an order (one more says whether an order
    had more, and the tab says how many were cut off); the two order
    transactions behind a trade are read when its row opens. Trades with itself
    or with an order the node doesn't know aren't listed, and it says how many,
    never "nothing found";
  - payments, Q-Asset transfers and multi-payments by the other account, Sent
    to or Received from, with how much (added exactly, in atomic units) and how
    many, sorted by most payments, most QORT, the latest or the earliest; 20
    accounts at a time, AT addresses after them.
- **In common:** where its first QORT came from (the transaction that first
  gave it something, by the reference chain as Q-Mintership+ finds it:
  `/transactions/creator/<key>` oldest first, `/transactions/signature/…`,
  then the first QORT payment it received), worded by its kind (a
  multi-payment: all the QORT it paid this account); and the
  sponsor it shares with others ("Also sponsored by A (47 others)", from the
  sponsor's own Minting list, "47+" when that stops short).
- **What it checked:** "Also checked, nothing found: …" lists only what was
  read in full; what was read only in part is said apart ("In what was read
  so far, nothing found: …"). Below, what was read of each list ("its newest
  100 payments and asset transfers", "all 12 of its minting transactions"; a
  list that couldn't be read is named in it) and Read older, which reads 100
  more of each list that stopped short, up to 1,000; Retry after a Read older
  that failed reads only the lists that failed.
- **The search** narrows every list to the rows that show what was typed
  (every word, ignoring case and accents; "1200" finds "1,200"): a name, an
  address, an amount, a tag, a date. While it is typed, the primary names of
  the accounts in the rows are read (4 at a time), so a name finds its rows:
  for the first 300 accounts in the order the tab lists them, and the line
  says so when there are more. A line says how many rows match; it never says
  "nothing matches" while a list is still being read ("Looking for …"), nor
  beyond what it could look in: a list or names that couldn't be read stay in
  sight with Retry, and the line says "nothing matches in what could be
  searched".
- **Reads:** its Payments, Minting and Names lists are the Transactions tab's
  kinds (`accountTx.ts`), one cache entry each, so the tabs never disagree and
  nothing is read twice; when its Minting list stops short, its level moves are
  read on their own, so a level move is never left out. A list that couldn't
  be read is named with Retry, and what it would show isn't claimed as checked;
  a Refresh that couldn't read a list again keeps its rows and says "Couldn't
  check for newer transactions", with Retry. More than one sponsor: which one
  Core counts (`/addresses/sponsorship/<address>/sponsor`), as a tag.
- **Direct links** on the Overview read its Payments, Minting and Names lists
  (100 rows each) and the online list, never its Q-Asset trades (about two
  reads per filled order): those only the Connections tab reads, and Direct
  links show them once it has. Opening Connections then reads its Q-Asset
  trades, where its first QORT came from, its payments with exchanges and its
  sponsor's Minting list. "All connections (n+)" while anything it counts is
  still read, failed, or was read only in part, the trades not yet read
  included.
- **Exchanges named:** for a viewer the rule lets in, an exchange's deposit
  account without a name of its own shows the exchange's name wherever an
  account shows (sentences, the people of a transaction, the trail, the start
  page, its header with an "exchange" chip); for anyone else, its address.

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

## Names

- **Its names** are read 100 at a time, up to 500
  (`/names/address/<address>`, in the order they were registered), shared with
  the header; past 500 the tab says "500+ names; the first 500 are listed". The
  tab shows 20 names at first, and "Show more" 20 more (the keyboard goes to
  the first one added). Each name's record (`/names/<name>`) is read once its
  card nears the screen. The order, how many are shown and a history shown in
  full belong to the history step; grid or list is kept on this device
  (`explorer-names-view`).
- **Each name's history** comes from the account's name transactions: the
  Transactions tab's Names kind, one list in the window's cache, so the two
  never disagree and neither reads it twice. When that list stops short (100
  at a time, up to 1,000), the tab says so once, over the names, with how many
  of the names show none for that reason, and reads 100 older on request. A
  rename belongs to both its old and its new name. "Its whole history" is left
  out only for a name whose transactions, read in full, are just its
  registration.
- **No primary name** says so, with Core's rule: an account gets a primary name
  when it registers, buys or renames a name while it has none. A primary name
  past the first 500 listed still comes first. A primary name that couldn't be
  read says that, with Retry; the names still show, in the node's order.
- **The names it had** (in its history, not owned now) show only when every
  name it owns is listed; when its name transactions weren't all read, the
  section says how many were. Each says what it is now, from its record (the
  node matches names ignoring case and look-alike letters): no one has it,
  another account has it, it goes on under another spelling (a rename that
  changed only its case), or it was registered again since (its record is
  newer than this account's last transaction about it: another registration).
  Its whole history is offered only while the registration it had is someone's
  now: not when no one has it, nor when it was registered again since.
- **Refresh** reads the names' records and whole histories again too, under
  any spelling, since names change hands and spelling.
- **A name's whole history** (`src/lib/explorer/nameLife.ts`) is walked back
  from its record, since Core has no history by name: the owner's name
  transactions down to how it got the name (bought it: the seller's come next;
  renamed an earlier name to it: the same account's, under that name;
  registered it: the end). Each account is read a page at a time only as far
  as it takes, at most 1,000 of its name transactions, and an account met
  again goes on from what was read of it; at most 12 owners and spellings. The
  page says where it stops short and why, and when the registration found
  isn't the one the record gives. A name renamed away and registered again is
  a new registration (Core keeps no link). The walk starts from the name as
  registered: a name opened as "maple" walks "Maple", and the page says the
  node matched it. It is one cache entry (`namelife:<name>`), so Refresh on
  the name's page reads the record and all of it again; the walk and the page
  share one read of the record.
- **A name no one has now** has a page of its own ("No one has the name … now",
  and that a name renamed since goes on under its new name); a failed read of
  it says so with Retry. "." and ".." are never asked about.
- **Names in sentences are links** to their whole history, a step of the
  window; an account opened from a name's page goes on from the trail it was
  opened from.

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

| Where                                   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/explorer/`                     | the reads (`reads.ts`, `accountTx.ts`), the cache, the small rules (`rules.ts`), the transactions' words, kinds and services (`txWords.ts`, `txFamilies.ts`, `qdnServices.ts`, `rawTx.ts`), names (`names.ts`) and a name's whole history (`nameLife.ts`), recent explorations, formats; the level 5+ rule (`access.ts`) and what Connections reads and says (`connections.ts`, `findings.ts`, `money.ts`, `exchanges.ts`, `assetTrades.ts`, `connectionReads.ts`, `rowSearch.ts`) |
| `src/components/Explorer/`              | the window, start page, account page, header, trail, tabs (`AccountTabs.tsx`) and Overview sections                                                                                                                                                                                                                                                                                                                                                                                |
| `src/components/Explorer/transactions/` | the Transactions tab, its rows and their sentences, one transaction's page                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/components/Explorer/names/`        | the Names tab, a name's parts and history, a name's own page (`NameLifeView.tsx`)                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/components/Explorer/connections/`  | the Connections tab, its rows, payments, In common and the exchange notice; `useExplorerAccess.ts` runs the rule in the window; the Overview's Direct links (`overview/DirectLinksPreview.tsx`)                                                                                                                                                                                                                                                                                    |
| `src/i18n/locales/<lang>/explorer.json` | its text, in all 12 languages                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

A later part adds its tab as one more entry of `ACCOUNT_TABS` (with `shown` for
a tab only some viewers see). The levels' maths are Hub's Minting window's
(`MintingStats.tsx`).

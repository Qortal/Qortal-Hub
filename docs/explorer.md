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
  connections (n)", which opens that tab; At a glance has QORT minted, QORT
  purchased / sold and QORT received / sent over the whole history, and
  Activity comes right after it (see below).
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
- **Transactions on Qortal** (from the start page, which shows the newest
  five, or from one transaction's block): the whole chain's confirmed
  transactions of the kinds picked, in a range of blocks, newest or oldest
  first, 20 a page, and what waits for a block (see below).
- **Its own pages** for a name no one has, an address the node rejects, an
  address never used and a signature the node doesn't know.

QORT received / sent is one figure for each viewer, never two on one screen.
For anyone the level 5+ rule doesn't let in, it adds up its newest 500
payments, as User search did, and says so: "in its newest 500 payments" when
the node had that many, "in all N of its payments" otherwise. They count QORT
payments only (an (i) says so): multi-payments, trades and minting aren't in
them. For a viewer the rule lets in, its whole history takes their place (see
"QORT figures and Activity"). While it isn't known yet which the viewer sees,
the tile shows neither, and neither is read.

First seen is the oldest confirmed transaction involving the account. The level
progress and the blocks to the next level are measured as in Hub's Minting
window and Home, and Total blocks minted includes the adjustment Core records,
as User search showed it.

## The level 5+ rule

Some parts of the Explorer are detailed parts: the Connections tab (its
circle and Account report too), the Overview's Direct links, its QORT
figures over the whole history (QORT minted, purchased / sold, received /
sent), its Activity, the Activity row of the
settings, and exchanges' accounts named as such. They show only
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
  the Overview has no Direct links, QORT figures over the whole history or
  Activity (QORT received / sent is its newest 500 payments, as before), the
  settings have no Activity row, and nothing says anything is left out.
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
- **As a circle, and the Account report:** see below.

### As a circle

Connections opens with what was recorded between them drawn as a circle, as
Q-Mintership+ does ("Connections circle", from its ConnectionsCircle); the list
("Recorded between them") is one click away, with the List / Circle toggle
beside the search or "See the list" under the circle. The account is in the
middle, the accounts it received payments and transfers from on the left, those
it sent them to on the right, and an account paid both ways (a Q-Asset trade's
partner too: what it got came in, what it gave went out) at the bottom, its
ring and line green and red in proportion to what came in and went out (by
QORT, or by transactions when no QORT moved), with a line under its name for
each asset that moved ("7 QORT in, 542 out"). Each avatar is sized by its
transactions, or with "Most QORT" (the toggle between the two side headings) by
the QORT that moved, and carries that number; at most 10 a side and 4 at the
bottom (8 and 3 in a narrow window, 6 and 1 on a phone), the rest counted under
each side's heading ("12 more in the list") and on the button under it ("3 more
accounts with fewer transactions: see the list"). The links that aren't
transfers (reward shares, minting level, names) are a row under it, the first
20 and then "Show all" (only those shown read their names), and a link with no
one other account (the accounts it sponsored, a level move whose recipient
couldn't be read) is listed under it as the list's own row, with its link,
never dropped. AT addresses aren't drawn; the list has them. Avatars pop in one
after another and the lines fade in, never with reduced motion.

- **Each avatar opens what links them:** the list's own sentences with when
  and the list's tags, then the transactions behind them as the Transactions
  tab's rows (a Q-Asset trade's orders are read when it opens), and "Explore",
  which opens that account as a step of the trail.
- **Its number is what that lists:** each transaction once, so a reward share
  that is both its sponsor's and the one it mints with now is one; a Q-Asset
  trade counts its orders, never one each way ("Second, 6 transactions: 1
  received (7 QORT); 3 sent (13 QORT); traded in 2 orders (got 23 GBQ for 529
  QORT)").
- **The text alternative is the list itself:** the avatars are lists of
  buttons, one per side, named with what they stand for, reached and pressed by
  keyboard; the lines are decoration. "See the list" shows the same connections
  as text, with every account the circle leaves out, its payments sorted the
  circle's way (Most QORT sorts them by the most QORT).
- **Drawn from what Connections read, and it says what it is drawn without:**
  it waits until its lists are in; a list that couldn't be read stays above it
  with Retry ("Nothing to draw in what could be read so far", never "no other
  account is linked to it"; with other links drawn, "Drawn without the lists
  that couldn't be read, named above"); a Refresh that couldn't read a list
  again says it is drawn from what was read before it; and a list read only in
  part says "Drawn from what could be read so far: older transactions may link
  more accounts". With only other links drawn, the legend says nothing of
  avatars and lines.
- **Its layout is a pure rule** (`src/lib/explorer/circle.ts`): the same data
  gives the same order and places (ties by address), every avatar at its own
  angle, so no line crosses another or passes under an avatar. Its height is
  worked out from its width so that no two avatars (each a 44 px button), no
  name and another avatar, and nothing and the middle overlap (`circleHeight`;
  `circleOverlaps` checks it at every width, in the tests). Names sit beside
  the avatars only from 600 px; narrower, the buttons say them. A bottom
  avatar's amounts wrap where its name is narrow, and the room under it is
  made for the rows they take: counted at the whole px the name is drawn at,
  less 1 px, from widths estimated never narrower than Hub draws them
  (`lib/explorer/textWidth.ts`: Inter Medium's own widths, with room for how
  Chromium places glyphs down to Hub's smallest zoom (about 25 %), and the
  pairs Inter kerns wider than their two letters; Inter's wider letters
  (Њ, Љ, Ǳ, ...) at their own width; and for everything Inter lacks, by
  ranges, the widest Hub's Chromium draws there with the fonts it falls
  back to: emoji in a Q-Asset's name, Arabic, the Indic scripts, CJK, and
  the few far wider than an em). Hub's palette, light and dark.
- **It grows with the window** (`fitCircle`). In an ordinary Explorer window
  (its content area, the part that scrolls, at most 1,140 px wide) it is as
  wide as its column, at most 880 px, as Q-Mintership+'s. A content area
  wider than that (full screen) is a bigger window. In a bigger one (full screen) it draws every account it
  may: up to 16 avatars a side and 8 at the bottom, never more than there
  are, its names given more room (beside the avatars to the drawing's edge,
  240 px for the account's own, 220 px under the bottom ones, where a bottom
  avatar's amounts then sit on one line), and "N more in the list" counts
  what is left. Centred on the window's content area, it is as wide as that
  allows while the whole circle (its headings, the drawing and the names
  under it) fits in the height the window shows. Where they don't all fit
  there, it draws them anyway, taller, and the window scrolls: as wide as it
  can be without being any taller than they need, at most the window's
  width. It never gets narrower than an ordinary window's drawing.
- **It follows the window as it changes:** what it is laid out from is
  measured in CSS px (its column, the content area's width and the height it
  shows) and followed as it changes: the window resized, full screen on and
  off, and Hub's zoom (View → Zoom, Ctrl + / Ctrl − / Ctrl 0), which changes
  how many CSS px the window has. Zoomed in, an ordinary window may fall to
  the narrow drawing, as a narrow window would; zoomed out, full screen grows
  further. Never from the screen's size, the device's pixel ratio or a size
  read once. Its room is read before it is first painted, and nothing is
  drawn until then (never first at a width it doesn't have). It is drawn at
  the size it was laid out for, so for the moment a new size waits to be
  laid out, its places and its names' room stay in step (never squeezed
  together). The scroll area keeps its scrollbar's room whether the
  scrollbar shows or not (`scrollbar-gutter: stable`): a scrollbar coming
  and going with the page's height would otherwise change the width it is
  laid out from, and flip it between two drawings. The tests check that nothing overlaps or leaves
  the window in an ordinary window and at full screen, at 50 %, 67 %, 100 %,
  150 % and 200 %.
- **It belongs to the history step:** Circle or List, the order, the avatar
  opened and "Show all", so Back shows the tab as it was left (a new step opens
  with the circle).
- **The search shows the list:** typing in the search switches the circle to
  the list, as Q-Mintership+ does, and clearing it brings the circle back. The
  circle pressed again while searching draws the accounts whose rows match and
  says so ("1 account matches “tradeogre”", "Sent to: 1 account matches",
  "Nothing to draw: none of its links matches …"), never all its links, and
  never "no other account is linked" over a search.

### The Account report

One button at the bottom of Connections ("Account report", from
Q-Mintership+'s AccountReport) makes a plain Markdown file of what the
Explorer has read on chain about the account and its connections, shows it,
and saves it through Hub (`saveFileToDiskGeneric`, a `.md` file named after
the account and the day, in UTC) or copies it. It is in the viewer's language;
addresses, signatures and numbers are data, and every time is UTC.

- **The same headings every time:** a header table (the account, when it was
  made, how much of its history was read, what made it) and the neutral line;
  Account (its public key, level, blocks minted with the adjustment and
  penalty, balance, MINTER, minting now, names, groups, first seen); QORT
  totals; Activity by type; Connections (the exchanges, each kind as the tab's
  sentences with block, day and full signature, its payments each way as
  tables, In common, and what was checked and found nothing); What was read;
  and the transactions behind the connections (once each, the newest 2,000 at
  most, and it says so), with the orders behind its Q-Asset trades by
  signature.
- **QORT totals and activity by type only from its whole history.** They are
  the Overview's figures (`useQortFigures`): QORT minted is its balance read
  between two reads of its newest transaction, "never minted" only without a
  reward share ever, and an account without a public key bought what other
  accounts' trade contracts paid it and sold nothing. Until its whole history
  is read, each says how much was read instead, and why: read only in part
  ("its newest 1,000 transactions; any older ones weren't read", with "Read the
  rest first"), still being read, longer than the 20,000 the Explorer reads
  (never "read the rest": it can't give them), or couldn't be read (the window
  has Retry). While its newest transactions are read again (a Refresh, or a
  newer one on the node), that page is still being read: the report names it
  and never says "its whole history" over it; after a Refresh, the newest pages
  of Connections' lists read again are named as still being read too.
- **What it reads is what the page reads:** Connections' lists and reads are
  passed in, not read again, and the rest are the account page's own reads
  through the window's cache (its name, names, groups, balance, first seen,
  the payments with exchanges). While its window is open, the account's All
  list reads on by itself to the first read (the Activity settings, 1,000 by
  default), as the Overview does, and "Read the rest" reads all of it, with
  QORT minted's reads; nothing is read before its window opens, and nothing
  else at all. The accounts it mentions are named only where the Explorer had
  read their names; each is also given by its address.
- **What couldn't be read is named** ("Couldn't be read: its name
  transactions"), never taken for none; what was still being read when it
  was made is named too ("Still being read when the report was made: …"), and
  the window lists it before it is made ("Make the report now").
- **Facts only:** the Explorer's own sentences and numbers, never a verdict.
  Text from the chain (names, groups, assets) has Markdown's own characters
  escaped wherever it is put, a line's start too (`mdText`), so it reads as
  written and never becomes a heading, a list, a quote, a link (an email- or
  domain-shaped name included), an entity ("&amp;") or a table of its own, in
  any language's line shapes; a title's name ending in " #" keeps it.
- **Saving** hands the file over to be saved ("Sent to be saved as …"), as
  Hub's other saves do; a save that fails says so.

## QORT figures and Activity

For a viewer the level 5+ rule lets in, from Q-Mintership+'s Overview.

- **QORT received / sent** over its whole history, in the place of the newest
  500 payments: payments, transfers and multi-payments of QORT, and the QORT
  that messages and QDN publishes paid. Trades and minting aren't in them
  (an (i) says so, with the exact amounts).
- **QORT minted** is worked out by bookkeeping, as Core keeps no record of
  it (`src/lib/explorer/qortBook.ts`): its exact balance now, less everything
  its transactions moved (received and sent, what other accounts' trade
  contracts paid it, what its own contracts paid back and what it put into
  them, names sold less bought, its fees, what it was given when the chain
  began) and what its asset orders with QORT on one side moved (from each
  order's state and trades). What is left reached it without a transaction
  of its own: minting rewards, the extra share for online Minter Admins and
  Dev Admins, and the legacy QORA holders' share. Its (i) lists every part.
  Checked on a node on 2026-11-21: 33 accounts that never minted came to
  exactly 0. Below 0 (its transactions don't add up to its balance) it says it
  can't be worked out, and why.
- **Its balance is only ever set against the transactions read up to it.**
  QORT minted reads its own balance between two reads of the account's newest
  confirmed transaction (one row each, `balanceAtRead`), and the balance
  counts only when both are the newest transaction the list holds. When the
  node has a newer one, the newest page is read again (and the balance with
  it); when one came in while the balance was read, the balance is read again.
  After three tries in a row it says new transactions kept coming in, with
  Retry. After a Refresh whose newest page failed it works nothing out: it says
  so, with Retry. The Balance fact then shows the balance it was worked out
  with.
- **Never minted**, with nothing to work out, needs both: no blocks minted
  (with no adjustment), and no reward share ever (its oldest REWARD_SHARE,
  one row). An account that moved its minting level away (TRANSFER_PRIVS) has
  its blocks minted set back to 0 by Core, but minted before: it is worked
  out.
- **QORT purchased / sold** are its completed trades on the Trade Portal, on
  every chain (`/crosschain/trades?buyerPublicKey=…` and `?sellerPublicKey=…`),
  each trade counted once by its contract's address. Each side is one read
  without a limit, on purpose: Core applies `limit` and `offset` to each kind
  of trade contract apart and then cuts the joined list, so its pages skip
  trades (on a node on 2026-11-21, an account with 204 trades on two chains
  came to 104 when read 100 at a time). An account without a public key never
  made a transaction of its own, so it never sold (a sale starts with a trade
  contract of its own): sold is 0, and purchased is what other accounts'
  trade contracts paid it, from its whole history (the same QORT purchased
  as QORT minted's bookkeeping), as its (i) says.
- **A partial history never gives a figure.** Minted and received / sent need
  every transaction it has: until all are read, both say "needs its whole
  history", and a line under the facts says how far it read, with "Read the
  rest". While it reads, it says so; a read that fails says so in their
  place, with Retry, which reads on from the page that failed (Refresh tries
  it again too). Its whole history is read once the node has no older rows,
  or once its oldest row read is its first transaction (when it was first
  seen), so exactly 1,000 transactions need no read past them.
- **The exact balance** is read as Core writes it (`0E-8` for none), into
  atomic units (1 QORT = 100,000,000); every amount is added as BigInt and
  shown in Hub's formats for the viewer's language. With an asset order of
  more than 1,000 trades, or more than 500 such orders, it says it can't be
  worked out, and why.
- **Its asset orders** are read two at a time. A closed one (filled or
  cancelled) never changes, so it is kept for the window's life
  (`orderclosed:<id>`), and Refresh reads only the open ones again.
- **While Refresh reads again,** what was worked out stays until the newest
  page and the balance are both read, so a figure never adds up a new
  transaction against an old balance.

**Activity** is the account's transactions over time: equal periods from
when it was first seen to now, each a bar stacked by kind (the Transactions
tab's families, in their colours), in plain SVG drawn from the theme. Until
its whole history is read, a short hatched stretch before the oldest
transaction read says older history exists, and the line above says how far
it read ("Its newest 1,000 transactions, back to …; its history goes back to
…"), with "Read N older" and "Read all of it". Never "no activity" where
nothing was read. The period holding the oldest transaction read is only
partly read: its bar is hatched behind, and its card, its row in the table,
its read-out and its list say so. Where the chart ends is kept with the
history step (when it was first drawn, or after its newest transaction when
that is later), so its periods stay as they were a minute on or after Back,
and a period picked stays marked.

- **Milestones**, from Core's own facts only: names registered (several the
  same day as one), bought, sold or renamed and minting levels moved, in the
  transactions read; its first reward share, read on its own (the oldest
  REWARD_SHARE, one row), so it is the first even when the rest isn't read;
  and its MINTER story (group 694) in its own transactions, worked out as
  Core does: asked to join, invited, joined (or added when an invite met its
  request), its request declined, removed, banned, its ban lifted, left, made
  or no longer a Minter Admin (or stepped down). Only what took effect counts
  (approved, or needing no approval); a change MINTER's admins approved
  stands at its approval's block, whose time is read (a failure says so, with
  Retry). When its whole history isn't read and nothing read before says
  whether a join asked or joined (or a kick removed it or declined its
  request), the milestone says both. No nominations or other Q-Mintership
  records. Each milestone opens its transaction. The chart flags those within
  the stretch drawn; the list under it has them all, so a first reward share
  before the part read so far is listed, not dropped.
- **The legend** hides or shows a kind; **a period picked** (pointer, or the
  keys: arrows, Home, End, Enter; they go on from the period picked) lists
  its transactions under the chart, each opening as in the Transactions tab.
  Both belong to the history step, so Back and Forward show them as left.
  The card under the pointer stays inside the chart, however narrow.
  **Full screen** shows the same in a dialog, as tall as the window allows,
  following it as it is resized.
- **For screen readers:** the chart is a focusable group whose period under
  the keys is read out, a table lists each period's counts (and the stretch
  not read yet), and the milestones are a list.
- **Settings** (the gear's Activity row, also from Activity): how many of an
  account's newest transactions the Overview reads by itself (100, 500, 1,000,
  the default, 2,000 or another number up to 20,000, in hundreds; each "Read
  older" reads as many more), and which kinds of milestones it shows. Kept on
  this device for each Hub account (`explorer-activity-first-read:<address>`,
  `explorer-activity-hidden-marks:<address>`); where storage can't be used,
  for the window only.

**Reads, and how they're shared.** The whole history is the account's All
list, the same cache entry as the Transactions tab's All list
(`txlist:all:<address>`), read 100 at a time. The Overview holds it while it
is on screen: its Latest transactions, QORT figures and Activity show the one
list, so nothing is read twice, and the Transactions tab then takes it as
left. For a viewer the rule lets in, the list reads on by itself to the first
read once At a glance or Activity nears the screen; "Read the rest" and "Read
older" raise the list's own ceiling, up to 20,000 transactions (200 reads),
and the figures say so for a longer history. It reads on until it holds what
was asked for, the node has no more, or it is at 20,000 and a read showed
more: by the rows it holds, not by offsets (a transaction arriving while it
reads moves them on, and the row read twice is left out), so it is never left
"reading" with nothing read. At 20,000 one more row says whether there are
more, so exactly 20,000 isn't called longer. How far was asked for belongs to
the history step: switching tabs and back, or Back, reads on. The Transactions
tab still shows it 100 rows at a time: "Show more" first shows the next 100 of
the rows held, and reads from the node only once all of them are on screen. A
list the Overview read past 1,000 shows its newest 1,000 there, which the tab
says. Nothing polls. A page whose answer arrives after its part went (another
account, the window closed) is dropped, as everywhere in the Explorer, and
read again only when asked. Every key ends with the account's address, so
Refresh reads them again (a block's time never changes, and is kept, as is a
closed asset order).

**An AT's page** has none of it: an AT never mints, and what its QORT does
is the trades it settles, which the traders' QORT purchased / sold add up.

## Compare

Two to four accounts side by side, for a viewer the level 5+ rule lets in: a
step of the window of its own, with Back, Forward and the trail. Like
Connections, it is evidence, never a verdict.

- **Picking:** "Add to compare" in the account header (it says how many are
  picked, with "Compare now"; its name for a screen reader starts with the
  words it shows), "Compare with…" there to find the other account,
  and the start page's "Picked to compare", each with Remove, then Clear and
  Compare. At most 4, no duplicates; a name, an AT, a transaction or a mistyped
  address in the page's own field is handled as on the start page, and a name
  looked up is dropped when another was typed since. The picks are kept for
  each Hub account apart while Hub runs (`explorer-compare:<address>`, session
  storage), cleared when the Hub account changes; when that storage fails,
  picking still works in the window. Adding or removing an account on the page
  is a new step, so Back shows the comparison before.
- **The cards:** a letter (A to D) for each account, its picture and name, its
  address with Copy, its chips; an address never used says so and reads
  nothing more. "Add another account" shows only when fewer than two of the
  accounts picked can be compared (not when one is still being read, or its
  read failed: its card says so, with Retry).
- **Recorded between them,** for each pair: the QORT payments each way, read
  exactly by sender and recipient (`readPaymentsBetween`, Connections' read
  for exchanges: 100 a read, up to 1,000 a way, one more row then says whether
  there are older ones); trade portal sales, from the Overview's Trade Portal
  read (`portalTradesRead`, the same cache entry: each side once, without a
  limit, since Core applies a limit to each coin's trades apart and its pages
  skip sales), matched to the other account by the address the buyer received
  the QORT at, so a buyer without a public key is found too (a sale Core gives
  no time, as a pruned node can, says "time not known" instead of a date; the
  row's dates are those of the sales with a time, and it says how many have
  none);
  and, from each account's own lists (Connections' reads and findings, never a
  second copy), Q-Asset transfers, multi-payments, reward shares, level moves
  (once, from whichever side's list holds it), name sales and Q-Asset trades.
  Each row opens to the transactions behind it. "Checked, nothing found" names
  only what was read in full; what was read in part says "In what was read so
  far". On a node without the payments read, payments come from the lists, and
  the section says so. A Refresh that couldn't read the payments between them
  again keeps the ones read before on screen, with Retry.
- **Timeline together:** where each one's first QORT came from, its name
  (bought, or registered when its name transactions were all read), its first
  reward share to itself and its level moves, oldest first, with the blocks or
  the time between them. It says when older ones may be missing, and when a
  read it needs failed (when an account was first seen, which places its
  name, too).
- **In common:** a shared first sponsor (from Minting lists read to their end;
  with how many accounts the sponsor sponsored, "there may be more" when its
  list stopped short), a shared first payer (a first QORT payment is a
  PAYMENT, as on the Funded page: a multi-payment is another first
  transaction), the same accounts in their
  payments (both paid it, it paid both, or one paid it and it paid the other),
  and groups two or more of them are in, smallest first, MINTER aside. The
  compared accounts, AT addresses and accounts that have sent 1,000 QORT
  payments or more (one row at offsets 99, 499 and 999 says it) are left out
  of the accounts in their payments, and counted.
- **Side by side:** names, first seen, first QORT from, level, blocks minted
  (with the adjustment, as the Overview's Total blocks minted), minting
  penalty (with a minus sign, as the Overview writes it), balance, MINTER,
  first sponsor, sponsored, minting now, last sent and groups, a row each;
  "same for all" when they match. In a narrow window the table stacks.
- **What was read,** for each account as on Connections, and for each pair.
- **Reads:** the Connections tab's reads, the same cache entries, two accounts
  at a time (the third and fourth start once each of the first two was read
  with its lists, or its read failed, or the node doesn't know it; one still
  being looked up holds them back); the
  pairs two at a time; In common's, the timeline's and Side by side's own reads
  once they near the screen. A failed read keeps what was read and is named,
  with one Retry for all. Answers for an account no longer compared are
  dropped.

## Sponsees and Funded

Two more steps for the same viewers, each opened from a sentence on Connections
or Compare, with Back, Forward and the trail.

- **The accounts it sponsored** (from Connections' row of the accounts it
  sponsored, In common's shared sponsor, and Compare's): every account it made
  a reward share to, from its Minting list (the same cache entry as its
  Connections tab's: 100 a read, Read older up to 1,000), each with when and at
  what percent, whether the share was removed and how many blocks later, how
  many shares in all ("in what was read" when its list stopped short), and,
  once near the screen, its level and where it stands in MINTER. Sorted the
  first sponsored first, the latest first, shares still running first, minting
  now first, or most shares first. "None" only from a list read to its end;
  otherwise the count says "there may be more". Pick 2 to 4 of them to compare
  (with four picked, the other boxes are off).
- **Whose first QORT payment came from it** (from "where its first QORT came
  from"): its QORT payments sent, oldest first
  (`/transactions/payments/between?senderAddress=…&reverse=false`, 100 a read,
  up to 1,000; one more row then says whether it sent more), the accounts it
  paid in the order it first paid each, and for each the earliest QORT payment
  it received (`recipientAddress`, one row): 50 checked at once, 4 at a time,
  then "Check more" for the next 50. A first QORT payment is a PAYMENT here,
  as in In common and the checks below. Payments to AT addresses are left out
  and counted, once per address. On a node without the payments read, it says
  so. A Refresh that couldn't read its payments again keeps the ones read
  before on screen, with Retry.
- **Checks across these accounts,** on the Sponsees page (Funded has none):
  who made their first QORT payment (grouped by who paid it) and where their
  QORT went (each one's first 1,000 QORT payments sent at most, grouped by who
  received them, saying which sent more), each on request, two accounts at a
  time, with Stop. Stop and leaving the page end them: no account starts
  after, and one being checked makes no more reads (it isn't counted). Their
  sentences count the accounts checked ("of the 2 accounts checked"), one
  account checked has a sentence of its own, and a node that can't read
  payments between accounts says so. A check's results belong to its step:
  Back and Forward show them as they were left.
- **Silent for everyone else:** no "Add to compare", no picks on the start
  page, no links to these steps, nothing read; a Compare, Sponsees or Funded
  step a viewer may no longer see shows the account it was about, on its
  Overview.

## Transactions

- **Read 100 at a time,** newest first, by address
  (`/transactions/search?address=…&confirmationStatus=CONFIRMED&limit=100`,
  each type picked as a `txType`), with "Show more", up to 1,000 of each kind.
  The tab shows 100 rows at a time of what is held, too: when the Overview
  already read more of the All list, "Show more" first shows the next 100 of
  those, with no read, and reads from the node only once every row held is on
  screen (`shownCount`, `moreShown`). How many are shown belongs to the
  history step, like the kind picked. The line under the list says how much is
  on screen ("Its newest 300 transactions.", "All 37 of its transactions.")
  and, once all 1,000 are on screen, that the Explorer stops there. A list
  never holds more than the newest 1,000 (a Refresh at 1,000 lets the oldest
  go), except the All list the Overview read further for its QORT figures and
  Activity: the tab lists its newest 1,000, and says how many the Overview
  read. One list per account and kind is one cache entry
  (`src/lib/explorer/accountTx.ts`), so the Overview's latest transactions and
  the tab share the All list. "All transactions" on the Overview opens the tab
  showing every kind.
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

## Transactions on Qortal

The whole chain's confirmed transactions, for everyone: a step of the window,
opened from the start page ("Transactions on Qortal" under its latest
transactions) or from one transaction's block ("Transactions in this block":
that block alone, oldest first).

- **What it lists:** every confirmed transaction of the kinds picked (the
  Transactions tab's kinds and types, without Messages: All is every other
  type), in a range of blocks, newest or oldest first, 20 a page. Messages
  aren't listed, as in Q-Mintership+: an account's Transactions tab shows its
  own. Each row is the Transactions tab's row, told from no one's side
  ("Publisher sent 15 QORT to Second"); an account opened from it starts a
  trail of its own.
- **Core's rules** (`src/lib/explorer/chainTx.ts`): a search without an
  address needs a type or at most 20 rows, and a block range goes only with
  `confirmationStatus=CONFIRMED`. So every search names its types, is
  confirmed, has a block range and asks for 20
  (`/transactions/search?txType=…&startBlock=…&blockLimit=…&confirmationStatus=CONFIRMED&limit=20&offset=…&reverse=…`);
  none goes out without types, with a message type, or without a range of 1
  to 10,000 blocks. Core orders by each transaction's own time and counts
  blocks [startBlock, startBlock + blockLimit). A type it doesn't know is a
  400, shown as a failure.
- **The blocks:** the latest 1,000 (the default) or 10,000 up to the chain's
  newest block when the list was first read (`/blocks/height`), or 1, 10,
  100, 1,000 or 10,000 blocks from a block typed in (written as numbers are
  in any of Hub's languages, Arabic digits too). A range never reaches past
  that tip: Core answers a range past it with no rows. A tip taken from a
  kept answer (the start page's, or the window's cache, up to 30 seconds
  old) can be behind a block the window has just shown, so a block past the
  pinned tip is never refused on its word: the newest block is read again
  first, and the block is shown once the chain has it (that tip then
  pinned) or refused with that fresh height ("The chain is at block …"),
  before anything is searched. The tip is pinned with the step, so the rows
  don't move while they are paged and Back shows the same blocks. The
  window's Refresh reads the newest block and pins it deliberately: when it
  is newer, the list starts again from it at one page; when it isn't, the
  list stays as it is, pages and all. When that read fails, the list stays
  and says so, with Retry. A block typed in but not shown yet belongs to the
  step too, so Back and Forward keep it.
- **Pages:** each page of 20 is one read, kept 30 minutes (rows in blocks
  already made don't change). "Show older" ("Show newer", oldest first) reads
  the next, up to 50 pages (1,000 rows), and puts the keyboard on the first
  row it added. The line under the list says what it holds ("The newest 40 in
  blocks …", "All 37 in blocks …", "The only one in block …"): "all" only
  once a page came back short. A row Core gives on two pages shows once, and
  the line then never says "all": Core orders by each transaction's time
  alone, so two made at the same moment can trade places between reads, and
  another may have been passed over. "No transactions of this kind in blocks
  …" only from an empty answer of a search, with "Look in the latest 10,000
  blocks" when the latest 1,000 held none; a failed first page says so with
  Retry, and a later page that fails keeps the rows above it, with Retry.
  Where a button goes once pressed (Retry, more blocks), the keyboard goes to
  the first row the read brought, the line that says what came, or the Retry
  of a read that failed again; another kind, range, order or tip starts a
  list afresh, the keyboard left where it is. The kind, the blocks, the
  order, the tip and how many pages show belong to the step, so Back and
  Forward show it as it was left.
- **What waits for a block,** with the latest blocks only: the node's own list
  (`/transactions/unconfirmed?txType=…&limit=20&reverse=true`), apart,
  "waiting to be confirmed (n)", or "(the newest 20)" when the node gave as
  many as it gives at most; a line while it reads, nothing when none waits, a
  failure with Retry. Read when the list opens, and again on Refresh.
- **On the start page,** "The whole chain": the newest five of the latest
  1,000 blocks, every kind but messages, read when the start page shows,
  once, with "Transactions on Qortal", which opens the list on the same tip
  (its first page is the one read there). Shown again once the tip it read
  has gone stale (after 30 seconds), it reads the newest; after the window
  closes or Hub's account changes, nothing of it is kept. A failed read says
  so with Retry, never "no transactions".
- **Nothing polls,** nothing is sent, and nothing reads `/chat/`.

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
  that account was opened, the tab, the kind picked and how many of its rows
  are shown. Switching tabs or kinds changes the step in place; Back and
  Forward show each step as it was left.
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

| Where                                   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/explorer/`                     | the reads (`reads.ts`, `accountTx.ts`), the cache, the small rules (`rules.ts`), the transactions' words, kinds and services (`txWords.ts`, `txFamilies.ts`, `qdnServices.ts`, `rawTx.ts`), names (`names.ts`) and a name's whole history (`nameLife.ts`), recent explorations, formats; the level 5+ rule (`access.ts`) and what Connections reads and says (`connections.ts`, `findings.ts`, `money.ts`, `exchanges.ts`, `assetTrades.ts`, `connectionReads.ts`, `rowSearch.ts`); the QORT figures' bookkeeping and reads (`qortBook.ts`, `qortReads.ts`), Activity's periods and milestones (`activity.ts`) and its settings (`activitySettings.ts`) |
| `src/components/Explorer/`              | the window, start page, account page, header, trail, tabs (`AccountTabs.tsx`) and Overview sections                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/components/Explorer/transactions/` | the Transactions tab, its rows and their sentences, one transaction's page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/components/Explorer/names/`        | the Names tab, a name's parts and history, a name's own page (`NameLifeView.tsx`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/components/Explorer/chain/`        | Transactions on Qortal: the step, its pickers and pages, what waits, the start page's latest transactions and the link from a transaction's block; its reads and rules are `src/lib/explorer/chainTx.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/components/Explorer/connections/`  | the Connections tab, its rows, payments, In common and the exchange notice; the circle (`ConnectionsCircle.tsx`, `CircleNodeDialog.tsx`, `circleParts.ts`; its layout is `src/lib/explorer/circle.ts`) and the Account report (`AccountReport.tsx`, its text `accountReportText.ts`, its building blocks `src/lib/explorer/accountReport.ts`); `useExplorerAccess.ts` runs the rule in the window; the Overview's Direct links (`overview/DirectLinksPreview.tsx`)                                                                                                                                                                                      |
| `src/components/Explorer/compare/`      | Compare: its step, cards, sections and picks (`compareSteps.tsx`, `useCompareData.ts`); its rules, reads and picks in `src/lib/explorer/` (`compare.ts`, `compareReads.ts`, `comparePicks.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/components/Explorer/sets/`         | the Sponsees and Funded steps and the checks across a set (`SetChecks.tsx`); their rules in `src/lib/explorer/sets.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/components/Explorer/overview/`     | the Overview's sections; the All list it holds (`useAccountHistory.ts`), the QORT figures (`QortFacts.tsx`, `Fact.tsx`) and Activity (`activity/`: the section, the chart, its colours and words, the settings dialog)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/i18n/locales/<lang>/explorer.json` | its text, in all 12 languages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

A later part adds its tab as one more entry of `ACCOUNT_TABS` (with `shown` for
a tab only some viewers see). The levels' maths are Hub's Minting window's
(`MintingStats.tsx`).

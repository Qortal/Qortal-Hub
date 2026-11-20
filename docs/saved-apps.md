# Saved apps: pins, folders and bookmarks on QDN

The launcher's pinned apps, folders and bookmarks follow the account to every
device through its settings on QDN: the encrypted `DOCUMENT_PRIVATE /
<name> / ext_saved_settings`. One publish holds everything, so one save costs
one fee.

## The settings document

```json
{
  "sortablePinnedApps": [{ "name": "Q-Mail", "service": "APP" }],
  "appBookmarks": { "version": 1, "folders": [], "bookmarks": [] },
  "launcherOrder": ["APP-Q-Mail"],
  "savedApps": {
    "v": 1,
    "pins": [
      {
        "k": "APP|q-mail|",
        "app": { "name": "Q-Mail", "service": "APP" },
        "pos": "V",
        "at": 1795120000000
      },
      { "k": "WEBSITE|publisher|", "removed": true, "at": 1795120500000 }
    ],
    "folders": [
      { "id": "f3Kq9TzA1b", "name": "Games", "pos": "X", "at": 1795120000000 }
    ],
    "bookmarks": [
      {
        "k": "APP|q-blog||blog/post-1",
        "id": "b8Nx4MvC2d",
        "name": "Post 1",
        "service": "APP",
        "appName": "Q-Blog",
        "path": "blog/post-1",
        "folder": "f3Kq9TzA1b",
        "pos": "V",
        "at": 1795120000000
      }
    ]
  },
  "homeLayout": {},
  "sidePanel": {}
}
```

- `savedApps` is the account's record of its saved apps. Every pin, folder and
  bookmark carries the time it last changed (`at`, in ms since 1970) and where
  it stands (`pos`). A removed one stays as `{ k | id, removed: true, at }`.
- `sortablePinnedApps`, `appBookmarks` and `launcherOrder` are filled from
  `savedApps` on every save, for Hubs and GO versions that don't know it:
  every pinned app, flat and in launcher order, and #374's folders, bookmarks
  and row order.
- `pins[].app` is the entry exactly as `sortablePinnedApps` holds it. A
  bookmark's `name` is its own name and `appName` the app's; `identifier` is
  there only when it isn't the default. `folder` is a folder's id, or `null`
  for the row.
- A `savedApps` with a `v` this Hub doesn't know counts as missing. A record
  without the right shape is skipped, and skipping never counts as a removal.

## Keys

- A pin is `SERVICE|name|identifier`, a bookmark `SERVICE|name|identifier|path`,
  a folder its `id`.
- The service is in upper case, the name trimmed and in lower case. A missing
  identifier, `''`, `'null'` and `'default'` are all `''`, the default
  resource. A path loses its leading and trailing `/`, its query and its
  fragment. In each part `%` is `%25` and `|` is `%7C`.
- So a page bookmarked on two devices is one bookmark. Editing a bookmark's
  link removes the old page and adds the new one; its `id` goes along.

## Order

- `pos` strings sort as plain text, then by key ("fractional indexing"), so
  two items that got the same position on two devices are in key order on
  every device. A new or moved item gets one between its new neighbours, so
  moves of two different items on two devices are both kept.
- The row holds the pins, folders and bookmarks outside folders in one order;
  each folder orders its own bookmarks. A pinned app whose start page is
  bookmarked in a folder shows in that folder. A bookmark whose folder was
  removed (on another device, say) shows in the row, where its position puts
  it.

## Merging

- For each item, the record with the later `at` wins. A removal is a record
  too. At the same `at`, a removal wins, then the record whose JSON sorts
  higher. A record only one side has is kept. So devices that have seen the
  same changes show the same launcher, in whatever order they saw them.
- One time per record: a rename and a move of one bookmark made on two devices
  before either saved keep only the later.
- Removals are kept 180 days, at most 1,000. An item a device saw on QDN and
  finds gone with no record goes too, if it hadn't changed for 180 days and
  not here since; anything else missing stays.

## Clocks

- `at` is this device's clock, but never earlier than 1 ms after the newest
  `at` it has seen, so a change made after seeing another device's counts as
  later. Only changes made on two devices before either saw the other's are
  ordered by their clocks.
- A copy is taken in only when its `updated` is later than the one last read
  here: QDN keeps a resource's latest version by that time, and a node that is
  behind may answer with an older copy. Only a device's first take-in compares
  it with this device's clock, as #368 does, to choose between QDN's pin list
  and its own.

## Hubs and GO that don't know `savedApps`

- Hub 3.0.3 writes `{ sortablePinnedApps }` only, with each private app as
  `{}`. GO v0.0.20 and Hubs with #374 also write `appBookmarks` and
  `launcherOrder`. Either way `savedApps` is gone after they save.
- The next Hub to read such a copy takes the differences between those fields
  and what it last saw on QDN as that client's changes: pins added, removed or
  moved, and (with `appBookmarks`) folders and bookmarks added, removed,
  renamed or moved. They are timed at the copy's `updated`, and at least 1 ms
  after the version of each item that client saw.
- No `appBookmarks` says nothing about folders and bookmarks; `{}` entries
  say nothing about private apps. Those stay as they are.
- The same applies to a copy whose older fields no longer match its
  `savedApps`.
- An older Hub still saves its whole pin list, so the last writer wins there.
  GO v0.0.20 and Hubs with #374 merge without removing, so a removed pin or
  bookmark can come back after one of them saves.

## On a device

- `ext_saved_apps:<address>`: this device's own record, with the time of each
  change made here. It is updated as the pin list, the bookmarks or the
  launcher's order change.
- `ext_saved_apps_qdn:<address>`: QDN's copy as last read or saved here, which
  Revert goes back to and changes are measured against.
- At sign-in and before a save, QDN's copy is merged in and the launcher's
  stores (the pin list, the bookmarks and the row's order) are filled from the
  result. The first time on a device, #374's rules run once first.
- The merged result is kept only once the launcher's stores show it. If the
  account changes meanwhile or the bookmarks can't be read, QDN's copy is
  taken in again later: stores left as they were would otherwise be recorded
  as changes made here.
- Bookmarks that can't be read are never written over, and a save waits until
  they can be. A device without a bookmarks store (not the desktop app) keeps
  pins only and leaves folders and bookmarks as they are on QDN.
- The bookmarks menu reads the store again whenever it changes, so a change
  made from it never writes an older list back.

Code: `src/components/Apps/AppsLauncher/savedApps.ts` (format, merge, the
older fields), `savedAppsSync.ts` (the device's records, sign-in, save,
Revert), `savedAppsKeys.ts`, `savedAppsPositions.ts`.

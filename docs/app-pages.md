# App and website pages

The library shows each Q-App and website on a page of its own: the listing
from the app's QDN metadata, plus screenshots, a longer About, What's new, a
version and links that the publisher keeps in small resources of their own,
and the ratings and reviews of everyone who used it.

Nothing here changes how apps are published or rendered. Every part is an
ordinary QDN resource, so other clients and Q-Apps can read and write them too.

Code: `src/components/Apps/AppPage/`. Capture: `electron/src/qapp-screenshot.ts`.

## Resources

`<SERVICE>` is `APP` or `WEBSITE`, upper case. `<name>` is the app's name.

| What        | Service     | Name           | Identifier                               |
| ----------- | ----------- | -------------- | ---------------------------------------- |
| Page text   | `JSON`      | the app's      | `qhub_app_page_v1_<SERVICE>`             |
| Screenshots | `IMAGE`     | the app's      | `qhub_app_shots_v1_<SERVICE>`            |
| Hidden      | `JSON`      | the app's      | `qhub_app_hidden_v1_<SERVICE>`           |
| Icon        | `THUMBNAIL` | the app's      | `qortal_avatar` (unchanged)              |
| A review    | `COMMENT`   | the reviewer's | `qhub_review_v1_<SERVICE>_<key>`         |
| A reply     | `COMMENT`   | the author's   | `qhub_reply_v1_<SERVICE>_<key>_<random>` |

`<key>` is the first 16 hex digits of SHA-256 of `<SERVICE>:<name in lower
case>`. It keeps names' spaces and symbols out of identifiers and stays far
below QDN's 64 characters.

Reviews and replies have prefixes of their own, so each can be paged by
itself and many replies can't push the reviews off a page:

- reviews:
  `service=COMMENT&mode=ALL&identifier=qhub_review_v1_<SERVICE>_<key>&prefix=true`
- replies:
  `service=COMMENT&mode=ALL&identifier=qhub_reply_v1_<SERVICE>_<key>_&prefix=true`
- one person's review: the reviews search with
  `&name=<name>&exactmatchnames=true`

Check each identifier exactly. Pass `mode=ALL` to every search here: without
it, Core keeps only the newest resource of each name and service, so a
reviewer's later reply, or any newer `JSON` or `IMAGE` of the app's name,
would hide the one wanted.

Because only the app's name can publish under it, the page text and the
screenshots are always the publisher's own. Changing either is one small
publish (one fee); the app itself is not uploaded again.

### Page text

```json
{
  "v": 1,
  "app": { "service": "APP", "name": "Q-Blog" },
  "about": "A longer description, up to 4,000 characters.",
  "whatsNew": "What changed, up to 1,500 characters.",
  "version": "2.1.0",
  "links": {
    "website": "https://…",
    "source": "https://…",
    "support": "qortal://…"
  },
  "appSignature": "<the app's QDN signature these notes describe>",
  "updated": 1763150000000
}
```

Links are `http(s)://` or `qortal://` only; anything else is dropped when read.
`appSignature` tells a reader whether the version and What's new describe the
app as it is now: when the app's latest signature differs, the app was
published again without new notes, and Hub says the version is older than the
latest update. Hub fills it in when the page is published with or after the
app. The whole record stays under Core's 25 KiB limit for `JSON`.

### Screenshots

One `IMAGE` resource with several files, published as a zip:

```text
shots.json   {"v":1,"app":{…},"shots":[{"file":"1.webp","caption":"Home","width":1600,"height":1000},…],"updated":…}
1.webp
2.webp
…
```

At most 5, in order; file names are `1.webp` to `5.webp`. Hub re-encodes every
picture to WebP (at most 1,600 pixels on the longest side), which also drops
whatever the original file carried besides the pixels. Read a picture with
`/arbitrary/IMAGE/<name>/qhub_app_shots_v1_<SERVICE>?filepath=1.webp`.
A list with no screenshots is a single file, which Core serves without
`filepath`.

### Hidden from the library

A Q-App or website can't be deleted: every publish stays on Qortal's
blockchain and QDN. Its publisher can hide it from Hub's library instead, with
the button beside Edit page, which publishes one small record:

```json
{
  "v": 1,
  "app": { "service": "APP", "name": "Q-Blog" },
  "hidden": true,
  "replaced": false,
  "updated": 1763150000000
}
```

The record's QDN title is `hidden`, or `shown` once the publisher shows the
app again. So the library reads every app's state from one search, without
downloading the records:
`/arbitrary/resources/search?service=JSON&identifier=qhub_app_hidden_v1_&prefix=true&mode=ALL&includemetadata=true`.
Only the app's name can publish under it, so nobody else can hide an app.

Hub leaves a hidden app out of the library, its search and the top bar's
suggestions, except under the user's own names, so the publisher can still find
theirs. Links, pins, bookmarks, open tabs, its exact name typed in the top bar
and a widget's page still open it (`allQappsAtom` keeps every app for these).

Each person can still choose to see them: the eye button in the library's
header leaves them out while it is on (the default) and lists them too once it
is off. The choice is kept on the device (`launcher-hide-hidden-apps-v1` in
`localStorage`).

When hiding, the publisher can also replace the app with a small page saying
its publisher removed it (`"replaced": true`). The page is one `index.html`
with that line in every language Hub has, and it follows Hub's `?lang=` and
`?theme=`. The page text and screenshots are then published empty too. Each of
these is a publish of its own, with its own fee, and the record comes last.

The same app's page can be open in several launcher tabs at once. Hub publishes
one hide or show of an app at a time: while one goes on, the hide button and
"Show in the library" wait on every page of that app, and a hide window left
open elsewhere says another tab is publishing it. Once the app is hidden, hide
windows still open for it close without publishing. If a hide and replace
stops halfway, a window open in another tab goes on from where it stopped,
with the replacement kept, rather than publish those parts again.

### Reviews and replies

```json
{
  "v": 1,
  "kind": "review",
  "app": { "service": "APP", "name": "Q-Blog" },
  "text": "Up to 2,000 characters (replies: 1,000).",
  "parent": { "name": "Alice", "identifier": "qhub_review_v1_APP_…" },
  "created": 1763150000000,
  "edited": 1763160000000
}
```

- One review per name and app: publishing it again replaces it. `created`
  stays the first publish's time.
- `parent` is only in replies. Every review of an app has the same identifier,
  so the parent's name is what matters; replies also carry it as their QDN
  title, so a list can be threaded from the search alone. A reply whose review
  is on a page not loaded yet can be shown by looking that review up by name.
- The QDN description holds the start of the text (Core keeps 240 bytes), so
  a list can show reviews before loading each one.
- QDN keeps every version, so removing publishes `{"v":1,"deleted":true,…}` in
  the item's place.
- A review holds no stars. The stars shown with it are the author's vote in
  the app's rating poll (below), matched through the name's owner, so nobody
  can claim a rating they didn't give.

## Ratings

Ratings stay the polls Hub already uses: `app-library-<SERVICE>-rating-<name>`
with options `1`..`5` and `initialValue-N`, the rating of whoever created the
poll. The page now also reads `/polls/votes/<poll>`, which lists every vote's
public key and option, to show who voted how. Votes are public on the chain
anyway; the page says so.

The initial rating belongs to the address of the poll's `creatorPublicKey`.
The poll's `owner` is any address its creator chose, so it can't tell who
gave that rating.

A vote is shown at once while its transaction waits for a block, and the page
looks again until the node has it. Once the page is closed, Hub keeps looking.
The library counts the vote at once too, for the account that sent it: on the
cards, in the Featured rows and in the "Highest rated" sort. It goes from the
pending vote to the node's once the node has it and the app's rating has been
fetched again. After voting, the page asks for a review.

## Widgets

The library's Widgets tab lists Home widgets (APPs tagged `go-widget`, see
`docs/home-widgets.md`). Each has a page with the same ratings and reviews,
kept apart from its app's, since a name can publish its app and several
widgets:

| What        | Name                                                      |
| ----------- | --------------------------------------------------------- |
| Rating poll | `app-library-APP-rating-<name>-id-<identifier>`           |
| Reviews     | `qhub_review_v1_APP_<key>`, replies as above              |
| `<key>`     | SHA-256 of `APP:<name in lower case>` + `\n` + identifier |

- The poll follows what Q-Git and other clients already use for a resource
  with an identifier (`app-library-GIT_REPOSITORY-rating-<name>-id-<repo>`),
  with the name and identifier as published. Its options and its
  `initialValue-N` are an app poll's; its description names it as
  `<name>/<identifier>`.
- Core's `/polls/apps/ratings` returns every `app-library-` poll and takes
  everything after `-rating-` as the app's name, so the library keeps a
  widget's rating under `<name>-id-<identifier>`, with no change to Core.
- A name can't hold a line break (Core folds any whitespace into one space),
  so no app's review key is ever a widget's. A widget's review records carry
  `"app": { "service": "APP", "name": "…", "identifier": "…" }`.
- A widget published as its name's default APP (no identifier) is that app:
  it has the app's poll and reviews.
- The Widgets tab's Featured row shows from the first widget rated above three
  stars (Community's needs three): there are few widgets.
- An app whose name ends in `-id-<something>` would share its poll with the
  widget `<something>` of the shorter name, if both existed. Names are
  unique, and a widget's identifier usually starts with `go-widget`, so this
  is left as it is, as it is for the other clients using the pattern.

## Links

`qortal://use-app-page/<SERVICE>/<name>` opens an app's page instead of the
app, like `qortal://use-group/…` does for groups. Chat messages open it; the
page's Share button copies it or the app's own `qortal://<SERVICE>/<name>`.

Hub reads a page link without the `.`, `!` or `)` a sentence leaves after it
(`…/Q-Blog,` still opens). A page's text reads every link that way, and ends
one at a quote. So in the page link and the app link of the Share menu, and in
the top bar's address of an open app (its identifier too), the name is
percent-encoded with `!'()*` escaped as well, and a dot at its end:
`Publisher!` is `Publisher%21`, `v2.` is `v2%2E`, and `v2.0` stays.

## Screenshots, taken by the publisher

In the desktop app, Hub can show the app in a dialog (as published, or a
preview of the zip being published, from Core's `?preview=true`), the way a tab
shows it. The publisher moves around in it themselves and presses Capture for
each screen they want: up to 5, which they can put in order or remove before
using them. Hub never opens pages, clicks or scrolls inside the app by itself.

The capture goes through `qappGuest:shot` in main, which takes one request,
`{ "action": "capture" }`, from Hub's own window only, and only for a guest Hub
itself prepared for that owner. It returns a PNG of the guest's view, at most
1,600 pixels on the longest side; the renderer re-encodes it to WebP like any
other picture. Nothing runs inside the app.

When publishing, the screenshots are optional, and nothing is published for
them unless the publisher adds some: taken by hand in the dialog or chosen from
files. For an update of an app that has screenshots, the publisher keeps them
(the default), changes them (starting from the current ones), or takes them off
the page, which publishes an empty list.

The publish form sends the page parts right after the app. The page text goes
over the page the node has at that moment, so About and links saved since the
form opened stay. When the node can't say what the page has (its search
fails, it lists a page it can't read, or it lists none although the form read
one), the page text isn't published. Each part goes out on its own. When one
fails, the form stays open with it, still unsaved, and Retry publishes only
the parts left, with the app's signature from that publish. The app opens once
nothing in the form is left unpublished, so input typed while the app uploads
stays too. The name and type can't change while the app is being published or
while parts are left.

Screenshots kept from the published ones are read back from the node by file
name, and a new publish numbers the files anew. So before the fee, and again
right before the screenshots go out (before and after reading them back), Hub
checks that the ones it reads back come from the node's current set (the
signature they were read from). When the set was replaced since (from another
device, say), the screenshots aren't published, and the form or the app page's
editor offers Refresh: it loads the current ones and keeps the pictures added
there, after them; over the limit of 5, the last current ones make way for the
added pictures. Until Refresh is done, a publish still stops as replaced. When
the node can't say (its search fails, or it lists none although they were read
from one), they aren't published either. Before the fee this stops the whole
publish; after it, the app and the page text still go out and the screenshots
are left to retry. Screenshots just published from Hub are held as pictures from
then on, under their new file names, until the page reads them from the node
again: a second change, or a retry of a later part, never reads them back by an
old name. Taking them all off, or publishing only new pictures, needs no check.

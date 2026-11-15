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
looks again until the node has it. Once the page is closed, Hub keeps looking,
so the library's cards show the vote too. After voting, the page asks for a
review.

## Links

`qortal://use-app-page/<SERVICE>/<name>` opens an app's page instead of the
app, like `qortal://use-group/…` does for groups. Chat messages open it; the
page's Share button copies it or the app's own `qortal://<SERVICE>/<name>`.

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

# Home widgets

Home widgets are small Q-Apps that the user puts on the Home dashboard: a
clock, the weather, the latest posts of an app. They follow the same contract
as the widgets screen of Qortal GO, so one published widget runs in both.

This file has two parts: the contract for widget developers, and how the Hub
implements it.

---

## Part 1 — Building a widget

### What a widget is

- A normal Q-App (QDN service `APP`), loaded by the Hub in a small frame on
  Home.
- The user picks it from **Home → Widgets → Add widget**. Nothing runs until
  the user adds it.
- The user can move and resize it on a grid at any time, so it must look right
  at any size it allows.
- It shows things and opens apps. It **cannot** pay, publish, sign, decrypt,
  send messages, save files, show notifications or take the whole screen.

### Publishing: how the Hub finds widgets

An `APP` resource is listed as a widget when it is **tagged `go-widget`** (any
letter case). Give it an identifier starting with `go-widget` as well, e.g.
`APP / Torq / go-widget-news`:

- your name can publish the widget next to its main app;
- Core filters identifier prefixes on the node, so the picker finds it
  quickly. Core has no tag filter, so widgets under other identifiers are
  only found by reading all APP metadata.

The picker shows the resource's **title** and **description** and the name's
avatar. `WEBSITE` resources are never widgets; publish the widget page as an
`APP`. Blocked names are left out by the node.

**Retiring a widget:** republish it under the same name and identifier
without the `go-widget` tag, for example as a "moved" notice. It leaves the
list, but everyone who already added it keeps loading it, since saved widgets
are loaded by name and identifier.

```js
await qortalRequest({
  action: 'PUBLISH_QDN_RESOURCE',
  service: 'APP',
  name: 'YourName',
  identifier: 'go-widget-clock',
  title: 'Clock',
  description: 'The time and date, at a glance.',
  tag1: 'go-widget',
  file: zipBlob, // the widget folder, index.html at its root
  isMultiFileZip: true, // publish the zip's files, not the zip as one file
});
```

### How the Hub loads a widget

```
<node>/render/APP/<name>?theme=<dark|light>&lang=<code>&identifier=<identifier or empty>&goWidget=1
```

- `goWidget=1` is always there: render the widget view from the first frame.
- Keep the page background **transparent**; the Hub draws the card behind it.
- Core injects `qortalRequest` as for every Q-App.
- The widget runs as the **top-level page** of its own isolated guest, not in
  an iframe: `window.parent === window`. Call Core's global `qortalRequest(…)`
  (it is a global binding, so `window.qortalRequest` is `undefined`). A
  hand-made fallback must post to `window.parent` even when that is the page
  itself; code that gives up when `window.parent === window` works in GO
  (an iframe) but not in the Hub.
- Storage is isolated **per app name**: a widget shares `localStorage` with
  the apps published under the same name, and with nothing else. To read what
  your main app saved (a city, a choice), publish the widget under your app's
  name (`APP / YourApp / go-widget-<slug>`). In GO every Q-App on a node shares
  one `localStorage`, so a widget under another name works there but not here.

### Size

Home lays widgets on a grid of **40 px rows** with **12 px gaps** and columns
of at least **84 px**; a wide window has more columns. A widget is 1 or more
columns wide and 2 to 14 rows tall (`rows × 40 + (rows − 1) × 12` px). New
widgets start 4 columns × 5 rows (about 386 × 248 px), the size of a full-width
widget on a phone in GO.

Ask once for the size that suits you; it is taken until the user resizes the
widget:

```js
const { applied } = await qortalRequest({
  action: 'GO_WIDGET_SET_SIZE',
  width: 'half', // 'small' = 1 column, 'half' = 2, 'full' = 4; optional
  height: 140, // CSS px you need; rounded up to whole rows
});
```

And to read the frame's size and state:

```js
const info = await qortalRequest({ action: 'GO_WIDGET_INFO' });
// { widget: true, platform: 'Qortal Hub', theme, language, visible,
//   width, height, columns, rows, gridColumns, minRows, maxRows, sizedBy }
```

Both only answer inside a widget frame. Elsewhere they may fail or never
answer, so send them only when `goWidget=1` is in the address, never wait for
them before drawing, and give them a timeout.

### Messages the Hub sends

| `action`               | Data                            | When                                                                           |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| `GO_WIDGET_VISIBILITY` | `payload: { visible: boolean }` | The widget came into view or left it (scrolled away, Home left). Also on load. |
| `THEME_CHANGED`        | `theme: 'dark' \| 'light'`      | The user switched theme. Also on load.                                         |
| `LANGUAGE_CHANGED`     | `language: string`              | The user switched language. Also on load.                                      |

Pause timers, animations and polling while `visible` is `false`. Read `theme`
and `lang` from the address when you start and treat these messages as
changes: the first ones can arrive before your script runs.

### What a widget may ask for

Read-only requests that Core answers inside the page work as in any Q-App
(`SEARCH_QDN_RESOURCES`, `FETCH_QDN_RESOURCE`, `GET_BALANCE`, `GET_NAME_DATA`,
`LIST_QDN_RESOURCES`, `SEARCH_CHAT_MESSAGES`, `FETCH_BLOCK`, …). Requests that
reach the Hub are filtered:

| Allowed                    | Requests                                                                                                                                                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Always                     | `GO_WIDGET_SET_SIZE`, `GO_WIDGET_INFO`, `GET_NODE_INFO`, `GET_NODE_STATUS`, `IS_USING_PUBLIC_NODE`, `WHICH_UI`, `GET_PRIMARY_NAME`, `GET_DAY_SUMMARY`, `GET_TX_ACTIVITY_SUMMARY`, `GET_FOREIGN_FEE`, `GET_CROSSCHAIN_SERVER_INFO`, `LINK_TO_QDN_RESOURCE`, `QDN_RESOURCE_DISPLAYED`, `NAVIGATION_HISTORY` |
| Only while Home is showing | `OPEN_NEW_TAB`, `SET_TAB`, `OPEN_USER_LOOKUP`, `GET_USER_ACCOUNT`, `GET_WALLET_BALANCE` (the last two ask the user, as in any Q-App)                                                                                                                                                                      |
| Never                      | Everything else: payments, publishing, signing, encryption, chat, files, notifications, Reticulum and private channels, screen capture, full screen, and any unknown action                                                                                                                               |

A refused request fails with `code` `WIDGET_REQUEST_NOT_ALLOWED` (or
`WIDGET_NOT_ON_SCREEN`). For anything refused, open your full app:

```js
await qortalRequest({
  action: 'OPEN_NEW_TAB',
  qortalLink: 'qortal://APP/YourApp/path/inside/your/app',
});
```

### Rules

- Start fast: show something within ~300 ms, then refresh.
- Have an empty state and an error state; never a blank frame.
- Load code and data from your bundle and QDN only; no outside web services.
- No pop-ups, `alert`/`confirm`, downloads or full screen (they are blocked).
- Poll no more often than every 30 s, and not at all while not visible.

### Testing

Open the widget as a normal app with `?goWidget=1&theme=dark` (and `light`)
in its address, at sizes from about 88 × 92 to 400 × 716 px. Then publish it,
add it from **Home → Widgets → Add widget**, resize it in **Arrange**, scroll
it out of view (it should pause), and switch theme and language.

---

## Part 2 — How the Hub implements it

Code: `src/components/HomeWidgets/`.

| File                   | What                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `homeWidgets.ts`       | Widget detection, the saved list (`home-dashboard-widgets-v1`, device-wide like the other Home preferences), its atom. |
| `widgetGrid.ts`        | Pure grid maths: columns from the panel width, move/resize/remove/place, squeezing a saved layout into fewer columns.  |
| `fetchHomeWidgets.ts`  | The two QDN searches for the picker, merged and cached per node for 10 minutes.                                        |
| `widgetRequests.ts`    | The request allowlist and the bridge listener that answers a widget's requests.                                        |
| `HomeWidgetView.tsx`   | One widget's guest: prepare, attach, hello/ready, theme/language/visibility messages, retry, release.                  |
| `HomeWidgetsPanel.tsx` | The Home panel: grid, Arrange mode (pointer and keyboard), picker, visibility tracking.                                |
| `HomeWidgetPicker.tsx` | The **Add a widget** dialog.                                                                                           |

Each widget runs in the same kind of isolated guest as a Q-App tab: the
renderer calls `qappGuestPrepare` with an owner of its own
(`tabId: home-widget:<name>:<identifier>`), and the main process applies the
usual checks (per-app session partition, CSP, navigation limited to
`/render/APP/<name>`, no pop-ups, WebRTC restrictions). No main-process code
is widget-specific. On top of that, the widget's requests go through
`createWidgetRequestHandler` instead of the tab listener, which refuses
everything outside the allowlist before it reaches the background handlers.

Home is kept mounted in an `<Activity>` while other views show, which takes
its effects down. A widget's guest listeners and request bridge are therefore
bound to the webview element and its document, not to effects, and the guest
is released only when the element is really removed (widget removed, node
switched, logout, Widgets turned off in **Settings → Modules**). Widgets are
told `visible: false` when Home is hidden or they scroll out of view.

Webviews are never moved in the DOM (that reloads them): cards are absolutely
positioned in a stable order and only their coordinates change.

At most `HOME_WIDGET_LIMIT` (8) widgets can be on Home, since each is a running
guest. Widgets present when Home first opens start 250 ms apart.

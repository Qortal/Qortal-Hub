# The right-click menu inside Q-Apps

Hub shows its own menu when you right-click inside a Q-App or website. It
offers what is under the pointer:

- **A link:** open it, copy it. An `/arbitrary/…` file also gets "Save
  linked file as…".
- **A picture:** save it, copy it, or copy it as a Qortal link for Q-Chat.
- **A video:** save it, copy or save its frame, and picture in picture. A
  sound gets "Save sound as…".
- **A Qortal name or address:** "Look up", which opens Hub's user lookup
  (see [Names and addresses](#names-and-addresses)).
- **Text:**
  - in a box: editing and spelling suggestions;
  - selected: copy, "Look up" for a name or address, and "Ask Qortino" (only
    once Qortino AI is set up; the question is written in Qortino's box, not
    sent).
- **Anywhere else:** "About <app>", which opens the app's page in the library.
- **In dev mode:** "Copy element description", "Copy element as picture" and
  "Inspect element".

A picture or video counts also where Chromium names none:

- one that doesn't take the pointer (`pointer-events: none`) inside the
  element right-clicked, as in an image viewer that moves the picture itself;
- one under the element right-clicked, when both are in a small frame the
  picture or video fills at least half of, such as a paused video under its
  play button or poster, or a thumbnail under a layer on it. A picture found
  there with a video, such as the video's poster, gives way to the video.

What a dialog, a top bar or a panel covers isn't offered: the element
right-clicked there shares only the page, or a much bigger part of it, with
what is under it. Neither is a picture behind another element, such as a
heading over a background picture. A picture found this way is copied from
its pixels; when it comes from another site and can't be read, what's on
screen of it is copied.

An app with a right-click menu of its own keeps it: when the app cancels the
`contextmenu` event, Hub's menu doesn't open. Shift+right-click opens Hub's
menu anyway. An app that cancels every right-click (one listener on the
whole page) leaves Hub's menu out everywhere; cancel it only where the app
shows a menu of its own.

The menu acts only on the user's click in it. An app can't open it or choose
an item, and what the menu reads from the page is checked in Hub's main
process (`electron/src/qapp-context-menu.ts`).

## Names and addresses

"Look up “<name>”" opens Hub's user lookup for a Qortal name or address the
app shows at the right-click. Hub takes it from, in this order:

1. **A profile picture** right-clicked: a picture loaded from the app's node
   at `/arbitrary/THUMBNAIL/<name>/qortal_avatar`, the address apps show a
   name's avatar from (Core's `GET_QDN_RESOURCE_URL` gives the same one).
2. **The text selected**, when it can be a name or an address (a leading `@`
   and a sentence's punctuation at its end are left out). On macOS a
   right-click first selects the word under it, or a link's whole text: a
   selection that is part of a name found there (below), or holds it, stands
   for that name.
3. **An attribute on the element right-clicked**: `data-qortal-name` for a
   name, `data-qortal-address` for an address.
4. **Text under the pointer**: an address written out, or a name written in
   the same row, card or header as a profile picture of that name, also as
   `@name` or inside a sentence, as a whole word (not inside a longer one,
   such as `Name_2`). When one name is part of another written there, the
   longer one.
5. **The element right-clicked, when the pointer isn't on its own text**: a
   layer laid over it, such as a person's link stretched over the whole card
   with the picture (`::after` with `position: absolute; inset: 0`), or a
   part of it with no text. Its own text counts when it is short (up to 80
   characters, nothing typed into a field) and is an address, or names one
   profile picture beside it.
6. **An attribute on an element it is in**, such as a post marked with its
   author.

Rules 3 to 6 don't apply in a box typed into.

"Beside a profile picture" means in the nearest element around the text that
holds one: one person's row, card or header, up to four elements out, never a
list of people. A place for a person's picture with none loaded in it (the
letter shown instead, in MUI's `Avatar` or an element with `data-avatar`)
ends the search: further out are other people's rows.

Text alone isn't taken for a name: most short words are registered names on
Qortal (Home, Reply, Share, Music, Like…), so a menu that asked the node
about every word would offer "Look up" on nearly every button. A name the app
shows without a profile picture beside it can be selected and looked up, or
the app can mark it:

```html
<div class="author" data-qortal-name="Publisher">
  <span>Publisher</span>
</div>
```

The attribute gives an app nothing it can't already do: `OPEN_USER_LOOKUP`
opens the same lookup for any name. Hub's main process checks every name
before offering it, the text selected too: 3 to 40 bytes on one line, taken
as it is, none of `/ \ ? # % ;`, no space but a plain one, and none of the
characters Hub itself takes for hidden ones (`src/utils/hasInvisibleCharacters.ts`).
An address must pass its own checksum.

## Spelling

On Linux, common Qortal words (Qortal, QORT, QDN, Q-App, the official
Q-Apps' names, minting words and the coins Qortal trades) are in each
Q-App's spelling dictionary, so the spellcheck doesn't underline them. The
list is `QORTAL_SPELLING_TERMS` in `electron/src/qapp-spelling-terms.ts`;
Hub adds the words a session's dictionary lacks when it sets the session
up.

On Windows and macOS, Electron would also write them into the system's own
spelling dictionary, which other programs use, so Hub doesn't add them
there, and they can still be underlined. "Add to dictionary" in the menu
works everywhere: there the user chooses the word.

## How each kind of link opens

| Link                                                                                                | "Open" item          | What it does                                                                          |
| --------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `qortal://APP/…`, `qortal://WEBSITE/…`, other services; the node's own `/render/<SERVICE>/<name>/…` | Open link in new tab | Opens it in a new Hub tab                                                             |
| `qortal://use-app-page/…`                                                                           | Open link            | Opens the app's page in the library                                                   |
| `qortal://use-group/…`                                                                              | Open link            | Opens the group for its members; anyone else gets the window that asks before joining |
| `qortal://use-embed/…`                                                                              | (none)               | Copy only, to paste in Q-Chat                                                         |
| `https://…` to another site                                                                         | Open link in browser | Opens it in the system's browser                                                      |

Core's `q-apps.js` stops a click on a web link inside an app ("Block external
links"); the menu's "Open link in browser" is the user's own choice.

"Copy link" copies a link into a Q-App or website as its `qortal://` link,
because the node's own address works only on that computer. Other links are
copied as they are. A private app's preview address (`/render/hash/…`) isn't
copied: it carries the secret that opens the preview.

## Making a link reachable by right-click

Hub finds a link where the app puts it in its page:

1. **A real link**, `<a href="qortal://…">` or `<a href="https://…">`.
   Chromium reports these by itself. This is the best way.
2. **A link attribute** on the element right-clicked, or on an element it is
   in. Hub reads these, in this order:
   - `data-qortal-link`, Hub's own (Subscreen's "Copy Qortal link" button
     already carries it);
   - `data-qortal-href` (SubWire's links) and `data-url` (Q-Tube's);
   - `data-href`, `data-link`, and `data-clipboard-text`, the usual "copy
     this" button convention.

   The value must be a whole link (`qortal://…` or `http(s)://…`). An
   element inside a web component counts as in the component.

3. **A box showing one link**, such as an `<input readonly>` in a share window.
4. **A link written as text** under the pointer, ending before a sentence's
   punctuation.

A share button whose link exists only in the app's code (built and copied
when clicked) gives Hub nothing to offer. To let right-click copy it, put the
link on the button or on the card it belongs to:

```html
<article data-qortal-link="qortal://APP/MyApp/post/abc123">
  …
  <button data-qortal-link="qortal://APP/MyApp/post/abc123">Share</button>
</article>
```

With the attribute on the card, a right-click anywhere on it offers "Open
link in new tab" and "Copy link" for that post.

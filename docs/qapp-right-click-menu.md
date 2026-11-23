# The right-click menu inside Q-Apps

Hub shows its own menu when you right-click inside a Q-App or website. It
offers what is under the pointer:

- **A link:** open it, copy it. An `/arbitrary/…` file also gets "Save
  linked file as…".
- **A picture:** save it, copy it, or copy it as a Qortal link for Q-Chat.
- **A video:** save it, copy or save its frame, and picture in picture. A
  sound gets "Save sound as…".
- **Text:**
  - in a box: editing and spelling suggestions;
  - selected: copy, "Look up" for a name or address, and "Ask Qortino" (only
    once Qortino AI is set up; the question is written in Qortino's box, not
    sent).
- **Anywhere else:** "About <app>", which opens the app's page in the library.
- **In dev mode:** "Copy element description", "Copy element as picture" and
  "Inspect element".

An app with a right-click menu of its own keeps it: when the app cancels the
`contextmenu` event, Hub's menu doesn't open. Shift+right-click opens Hub's
menu anyway. An app that cancels every right-click (one listener on the
whole page) leaves Hub's menu out everywhere; cancel it only where the app
shows a menu of its own.

The menu acts only on the user's click in it. An app can't open it or choose
an item, and what the menu reads from the page is checked in Hub's main
process (`electron/src/qapp-context-menu.ts`).

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

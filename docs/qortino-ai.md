# Qortino AI

Qortino AI is an offline assistant in the desktop Hub. It runs an open
language model on the user's own computer: nothing is sent to a server, and
it works without internet once the model is downloaded. It is the same
Qortino as in Qortal GO (the Android app); most of the code is shared with GO.

It is off until the user opens it. Nothing is downloaded unless they ask.

## What the user sees

- **Sidebar → Qortino AI**, or a click on Qortino on Home, opens a panel on
  the right of the window, over whatever is open (Home, a Q-App, Q-Chat).
  The panel can be made wider, and Escape closes it.
- **First open:** a download screen. Qortino's model (Qwen3 4B Instruct 2507,
  Apache-2.0, 2.3 GB) comes from QDN, published under the name `Qortino AI`.
  The download runs as a job of its own: it keeps going when the panel
  closes, retries when peers stop sending, resumes after Hub restarts, and
  says when it is done.
- **Chat:** history, new chat, rename/pin/delete chats, copy an answer,
  "Continue answer" for a reply cut off by the length limit.
- **Answers:** about 5,000 curated answers about Qortal, Q-Apps, Hub and GO
  answer instantly (`goldenAnswers.json`, matched by `goldenMatch.ts`); a
  close match is given to the model as a hint. Q-App and guide cards under
  Qortal answers open the app in a Hub tab, next to the panel.
- **Other models:** settings → Model. Hub downloads models from QDN only,
  never from the web.
  - **A bigger model from QDN:** Qwen3 30B A3B Instruct 2507 (Apache-2.0,
    17.3 GB, best with 32 GB of memory), Unsloth's Q4_K_M in 11 parts
    published with Q-Share under `Qortino AI`, like Qortino's own model
    (`QWEN3_30B_MODEL` in `manifest.ts`). Its download goes through the
    same path and checks: each part is fetched through the node and
    checked against its sha256, and the model is loaded through its first
    part. The node is asked for one part ahead at a time, not all of them.
    The free space is checked before each try, and the download waits and
    tries again when peers stop sending (`qdnModelDownload.ts`, with
    `installJob.ts`'s rules). It downloads through the user's own node only:
    its parts are bigger than the public node carries, and it has no layout
    in smaller parts like Qortino's own model. On the public node the row
    says so and offers no Download, and a download stops if Hub switches to
    the public node. Stop keeps the parts saved so far (and the
    node keeps the chunks it fetched), to carry on from; Remove deletes
    every part.
  - **A file on this computer:** "Add a model file…" opens a file picker
    for any open model in GGUF format, which is used where it is. For a
    model split into several files, the user picks the first part.
  - A model an earlier test build downloaded from a web link stays usable
    if it finished, and can be removed either way.

  The curated answers and Qortino's persona work with every model.

- **Settings:** answer length, text size, Enter sends, how long the model
  stays loaded after closing, graphics card on/off, delete all chats, remove
  Qortino's model.
- **Home:** Qortino moves (looks around, blinks, hops, dozes at night),
  now and then says a line in a speech bubble, can be tickled (press and
  hold), and once a model is on the computer there is an "Ask Qortino…" box
  next to him. A question typed there opens the panel in a new chat; the
  model starts loading with the first letter typed.

## How it fits together

```text
Renderer (React)
  src/qortinoAgent/            chat logic, model session, QDN download, models list
  src/components/Group/QortinoAgent/   panel, gate, chat, settings
  src/components/Group/qortinoHome/    Home lines, Ask box, glances
    │  window.qortinoLlm.*  (preload.ts, main window only)
Electron main
  electron/src/qortino-llm.ts         IPC handlers, model process, downloads
  electron/src/qortino-llm-files.ts   Qortino folder, sha256, .part resume
    │  utilityProcess messages (qortino-llm-protocol.ts)
Model process
  electron/src/qortino-llm-worker.ts  node-llama-cpp (llama.cpp)
```

- **The model runs in an Electron utility process**, started on the first
  load and stopped on unload. A model that makes llama.cpp abort takes that
  process down, not Hub; the chat sees "Model is not loaded" and loads again.
  A crash while loading on the graphics card switches to the processor.
- **Engine:** [node-llama-cpp](https://github.com/withcatai/node-llama-cpp)
  (MIT) with its prebuilt llama.cpp binaries: Metal on macOS, Vulkan or the
  processor on Windows and Linux. CUDA builds are left out of the packages
  (several hundred MB); Vulkan runs on NVIDIA cards too. The `.so`/`.node`
  files are unpacked from the asar (`electron-builder.config*.json`).
- **Prompt reuse:** each reply is given the whole conversation; llama.cpp
  keeps what it read last time, so only the new part is read. The system
  prompt is read ahead while the user types (`warmup`).
- **Files** live in `<userData>/Qortino AI/`: `models/` for Qortino's parts,
  `other-models/<model>/` for the other models Hub downloads. Clean-ups of
  Qortino's own files never touch `other-models/`, so removing or repairing
  Qortino's model leaves the others alone. Paths from the renderer are
  checked to stay inside that folder.
- **Downloads** go through the Hub window's network session (`session.fetch`),
  which trusts the local node's HTTPS certificate and uses the system proxy.
  The main process downloads only from Hub's nodes: an address whose origin
  is not on the list Hub's page may connect to (`isAllowedNodeUrl` in
  `setup.ts`) is refused before anything is fetched. A redirect from a node
  is followed as before (each part is checked against its sha256 anyway).
  The node API key is sent as an `X-API-KEY` header, never in the URL. A
  `.part` file is resumed with a Range request (the public node cuts long
  transfers near 1 GiB). Each part is checked against its sha256.
- **Only the Hub window** can call `qortino:*` IPC (`requireMainWindowSender`);
  Q-Apps cannot.
- **Storage:** chats, settings, the install record and the models list are in
  the window's localStorage under `qortino:` keys. The open chat is saved
  after each finished reply, and as it stands (with the part of a reply
  written so far) when the panel closes, on sign-out and on a page reload.
  Quit Completely ends the page without unload events, so a question still
  being answered then, and its reply so far, are not kept.

## Notes for development

- Qortino AI needs the desktop app; the browser dev server shows no sidebar
  entry and no Home lines.
- `npx vitest run src/qortinoAgent src/components/Group/QortinoAgent
src/components/Group/qortinoHome
src/components/Group/__tests__/HomeQortinoWorkspaceCard electron/src/qortino-llm`
  runs its tests. The last two match by the start of the file name:
  `HomeQortinoWorkspaceCard*.test.tsx` and `qortino-llm*.test.ts` (the
  main process's tests, such as `qortino-llm.freeSpace.test.ts`).
- The curated answers, the Q-App catalog and the persona are written in
  English (as in GO); the model answers in the user's language when asked
  in it. All of the UI is translated.

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
- **Other models:** settings → Model → Add a model. Any open model in GGUF
  format, from a file on this computer (used where it is) or a download link
  (saved in Qortino's folder). A few suggestions fill the link in. The
  curated answers and Qortino's persona work with every model.
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
  `other-models/` for models added by link. Paths from the renderer are
  checked to stay inside that folder.
- **Downloads** go through the Hub window's network session (`session.fetch`),
  which trusts the local node's HTTPS certificate and uses the system proxy.
  The node API key is sent as an `X-API-KEY` header, never in the URL. A
  `.part` file is resumed with a Range request (the public node cuts long
  transfers near 1 GiB). Each part is checked against its sha256.
- **Only the Hub window** can call `qortino:*` IPC (`requireMainWindowSender`);
  Q-Apps cannot.
- **Storage:** chats, settings, the install record and the models list are in
  the window's localStorage under `qortino:` keys.

## Notes for development

- Qortino AI needs the desktop app; the browser dev server shows no sidebar
  entry and no Home lines.
- `npx vitest run src/qortinoAgent src/components/Group/QortinoAgent
src/components/Group/qortinoHome electron/src/qortino-llm-files.test.ts`
  runs its tests.
- The curated answers, the Q-App catalog and the persona are written in
  English (as in GO); the model answers in the user's language when asked
  in it. All of the UI is translated.

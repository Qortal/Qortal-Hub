# Node Manager

The Node Manager is Hub's own window for the node it uses. It opens from:

- a click on "Qortal Hub" in the title bar;
- a click on the Qortal logo in the side panel;
- "Open Node Manager" at the foot of the node card that shows on hover.

Hovering over the title or the logo still shows the short node card, as before.

Code: `src/components/NodeManager/`. `NodeManagerHost` is mounted in `App.tsx` once signed in, in the main window. It opens on the `openNodeManager` event (`openNodeManager(section)` in `nodeManagerEvents.ts`; `overview`, `peers` or `control`).

Its sections are Overview, Peers and, on your own node, Node control. Minting opens the minting window.

It takes the minting window's look, so the two read as one family. The shared pieces are in `nodeManagerLook.ts`, with the minting window's own values: the frame and backdrop, the uppercase section labels, the card surfaces, label/value rows, the tinted status cards (green, blue, rose) and the gradient buttons.

## Rules

- **Locking:** it never opens while Hub is locked, and it closes when Hub locks.
- **Reads:** all of them are public endpoints, without the API key.
- **Actions** (Peers and Node control), and the node log, go through `nodeAdminRequest` (`nodeAdmin.ts`):
  - with Hub's API key as the `apiKey` parameter, the way Hub's other admin calls send it;
  - only to the node the key was stored for (same origin), never to the public node, and never through a redirect;
  - each asks first, in its own dialog, unless it only adds something (a peer);
  - one of each at a time; when the window closes, Hub locks or the node changes, the requests still under way are called off and their answers dropped;
  - Core's refusals are told apart: no key, a key for another node, the key refused, an address the node can't use, the node's clock not synced yet.
- **Paths:** they are built with `joinNodeEndpoint`.
- **Sections:** each is mounted when first shown and kept until the window closes or another node is chosen. What one has under way (a force sync, a restart) carries on while another is shown, and says how it ended when it's shown again. Only the shown section reads from the node.
- **Reads stop:** they stop when the window closes, and a reopen starts over.
- **Changing node:** a different node in use starts over too, and answers from the node used before are dropped.
- **Failed reads:** a failed read is never taken as "nothing there".
  - Each card keeps its last good answer and says it couldn't refresh, with Retry.
  - With no answer yet, it says so.
- **Public node:** on the public node it shows that node's numbers, and offers "Set up my own node" (Core setup).
  - It doesn't read that node's minting keys, settings or memory.
  - Its peers show without any way to change them, and there's no Node control.

## Overview

| Card             | Shows                                                                                                                                                                                                          | Read from                                                                                    | Every          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------- |
| Sync             | Synchronized or the %, this node's height, the highest peer, blocks behind, the last block's age (by the node's own clock), speed and time left while syncing, peers at this height with the same last block   | websocket status, `/blocks/last`, `/peers`                                                   | 10 s, 15 s     |
| Minting          | Whether this node mints, or the main reason it doesn't; minting keys on this node; "Open minting" (the minting window)                                                                                         | status, `/admin/mintingaccounts`                                                             | 30 s           |
| Peers            | Out and in, still connecting, heights ahead / level / behind, typical ping, peers on a far-off chain, Core versions                                                                                            | `/peers`                                                                                     | 15 s           |
| QDN data peers   | Out and in, the node's limit, Core versions                                                                                                                                                                    | `/peers/data`, `/admin/settings/maxDataPeers`                                                | 30 s           |
| Blocks           | The last block (minter and level, online minters, transactions, fees), the average block time over 24 h, the 10 newest blocks                                                                                  | `/blocks/last`, `/blocks/summaries`, `/blocks/byheight/{h−1440}`, `/names/primary/{address}` | each new block |
| Reticulum        | Running, source, bridge, reachability, transport, hub interfaces, P2P overlay peers, P2P health and its rule                                                                                                   | `reticulumGetStatus()`, `onReticulumStatus`                                                  | live           |
| Help the network | Runs all day; other nodes connect in (with the port to open); relay mode; QDN data peers; Core as new as peers'; minting                                                                                       | the above, plus `/admin/settings`                                                            | —              |
| This node        | Kind and address, full or lite, network, node ID, uptime, Core version and build date, newer Core seen on peers, automatic updates, API whitelist, Hub version, memory, processors, the last 24 h on the chain | `/admin/info`, `/admin/systeminfo`, `/admin/summary`, `/admin/settings`                      | 30 s – 5 min   |

The pure parts are in `nodeOverview.ts`: peer summaries, version comparison, sync speed, the checks, and formatting.

## Peers

| Part           | Shows and does                                                                                                                                | Node endpoints                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Peers          | Address, in or out, height (or still connecting), Core version, ping, connected for, highest first. Add peer; Remove; Force sync (asks first) | `/peers` (every 15 s); `POST`/`DELETE /peers`; `POST /admin/forcesync` |
| QDN data peers | Address, in or out, Core version, connected for. Add data peer; Remove                                                                        | `/peers/data` (every 30 s); `POST`/`DELETE /peers/data`                |
| Known peers    | How many peers the node knows of. Forget all known peers (asks first)                                                                         | `/peers/known`; `DELETE /peers/known`                                  |

- An address is checked as it's typed (`parsePeerAddress`): a host name, IPv4, or IPv6 in brackets, with an optional port.
- While the node works on an add, the dialog stays as it is (the address can't change and the dialog can't close), so the answer is always about the address shown.
- Remove disconnects the peer. Core answers "false" when the address wasn't on its known list (an inbound peer's port, say), but disconnects it all the same.
- Forget all known peers also drops the node's connections: the list is read again.
- Adding a data peer answers "false" when Core knew it already and couldn't connect to it just now; the note says so.
- Force sync is for a stuck node: Core takes the peer's blocks even over a stronger chain of its own, until it's level. It says how it ended (Core's `SynchronizationResult`), and waits up to 10 minutes.
- Force sync needs a peer whose handshake is done; one still connecting can't be picked.

## Node control

Only for your own node.

| Card               | Does                                                                                                                     | Node endpoints                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Restart            | Restarts the node (asks first)                                                                                           | `/admin/restart`                   |
| Stop               | Stops the node (asks first). Once the node on this PC stops answering: "Start Core" (Core setup's own start)             | `/admin/stop`, `/admin/uptime`     |
| Bootstrap          | Replaces the node's chain with a fresh copy (asks first)                                                                 | `/admin/bootstrap`                 |
| API key            | Whether Hub's key works for this node, checked when the section opens                                                    | `/admin/apikey/test`               |
| Status for support | Copies a short summary for a help chat: versions, height, sync, peers, minting, memory. No addresses, names, IPs or keys | `/admin/info`, `/admin/systeminfo` |
| Node log           | The newest 200 lines, on request; Refresh and Copy. The log can hold IP addresses and names, and the card says so        | `/admin/logs?limit=200&tail=true`  |

- "Start Core" shows only once the node stopped answering, and only when Core's process on this PC is gone and Core is where Hub installs it (`isCoreRunningOnSystem`, `isCoreInstalledOnSystem`, every 10 seconds while it's down): a start while Core still runs does nothing. While its process still runs, wherever it runs from, the card says so instead.
- When Core's process is gone and Core isn't where Hub looks (`~/qortal`, or the folder chosen in Core setup), the card says so and offers Core setup's own folder picker (`pickQortalDirectory`). It keeps the folder only when Core is in it; Hub then looks again at once.
- Core restarts and bootstraps itself: `/admin/restart` and `/admin/bootstrap` answer "true", then Core starts a helper Java process from the folder it was started in (`-cp qortal.jar org.qortal.ApplyRestart`, or `ApplyBootstrap`). The helper stops the node and starts Core again: for a restart, up to about 3¼ minutes after the node stops answering. Hub's process check doesn't see the helper, and when it fails, Hub can't see why. So after a restart or bootstrap asked for here:
  - the node still answering as before after 3 minutes (a read after that shows the node that ran when it was asked): the card says the node hasn't restarted, and that Core's own output (its terminal, or `run.log` in its folder) may say why;
  - the node not answering for 5 minutes, with Core's process gone too: the card says the node hasn't come back and offers "Start Core" there. While a Core process runs, Core is still on its way back, and the card waits.
  - Each wait starts again whenever the node starts or stops answering. A new restart or bootstrap replaces what the cards said about the last one.
- A stop asked for here ends what an earlier restart or bootstrap said, so a restart that never happened doesn't keep "Start Core" from being offered after the stop.
- Hub's start gives no answer of its own: the card says Hub asked Core to start until the node answers, or that it still isn't answering after 2 minutes.
- Once the node answers again, or it started again (the time it started, its uptime taken from this PC's clock, moved later than a read can explain: this also catches a restart while another section was shown), what the cards said about stopping, restarting or starting is cleared and the API key is checked again.
- The status copy waits as long as the window's other reads (15 seconds), and nothing is copied once the window closes.

## Later

Each comes in its own PR:

- **Minting:** the minting window moves in as a section.
- **QDN:** storage and hosted data.

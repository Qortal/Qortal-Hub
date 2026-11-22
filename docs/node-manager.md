# Node Manager

The Node Manager is Hub's own window for the node it uses. It opens from:

- a click on "Qortal Hub" in the title bar;
- a click on the Qortal logo in the side panel;
- "Open Node Manager" at the foot of the node card that shows on hover.

Hovering over the title or the logo still shows the short node card, as before.

Code: `src/components/NodeManager/`. `NodeManagerHost` is mounted in `App.tsx` once signed in, in the main window. It opens on the `openNodeManager` event (`openNodeManager()` in `nodeManagerEvents.ts`).

It takes the minting window's look, so the two read as one family. The shared pieces are in `nodeManagerLook.ts`, with the minting window's own values: the frame and backdrop, the uppercase section labels, the card surfaces, label/value rows, the tinted status cards (green, blue, rose) and the gradient buttons.

## Rules

- **Locking:** it never opens while Hub is locked, and it closes when Hub locks.
- **Reads only:** nothing in this window changes the node.
- **No API key:** all of its reads are public endpoints.
- **Paths:** they are built with `joinNodeEndpoint`.
- **Reads stop:** they stop when the window closes, and a reopen starts over.
- **Changing node:** a different node in use starts over too, and answers from the node used before are dropped.
- **Failed reads:** a failed read is never taken as "nothing there".
  - Each card keeps its last good answer and says it couldn't refresh, with Retry.
  - With no answer yet, it says so.
- **Public node:** on the public node it shows that node's numbers, and offers "Set up my own node" (Core setup).
  - It doesn't read that node's minting keys, settings or memory.

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

## Later

Each comes in its own PR:

- **Minting:** the minting window moves in as a section.
- **Peers:** add, remove, force sync.
- **QDN:** storage and hosted data.
- **Maintenance:** restart, stop, bootstrap and logs.

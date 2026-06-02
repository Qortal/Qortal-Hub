# Reticulum Integration

This document explains how Qortal Hub integrates the [Reticulum Network Stack](https://reticulum.network/manual/using.html) (RNS) for decentralised, end-to-end encrypted peer-to-peer communication.

## What Reticulum Provides

Reticulum is a cryptography-based networking stack designed for reliable communication over any medium. In Qortal Hub it serves as the transport layer for:

- **Presence** — signed, encrypted envelopes broadcast to overlay peers so users see each other as online.
- **Direct voice calls** — peer-to-peer audio with room IDs of the form `dmv:<sha256_prefix>`.
- **Group voice calls** — multi-party audio with topology-aware forwarding (see `docs/group-audio-calls.md`).
- **Q-Chat file transfers** — encrypted file offers and deliveries with a 2-hour TTL.

## Architecture Overview

```text
Renderer (React)
  │  window.electronAPI.reticulum*()
  │  window.groupCall.*()
  ▼
Electron main process
  │  reticulum-daemon.ts   — spawns and manages rnsd
  │  reticulum-bridge.ts   — commands the Python bridge
  │  reticulum-mesh.ts     — hub-to-hub mesh coordinator
  │  group-call.ts         — group call manager
  ▼
Python bridge (presence_bridge.py)       ← fd3/fd4 binary IPC
  ▼
rnsd  (Reticulum Network Stack daemon)
  ▼
Network  (LAN AutoInterface / hub TCPClient+BackboneInterface)
```

## Components

### Daemon — `reticulum-daemon.ts`

Manages the `rnsd` process (module `RNS.Utilities.rnsd`).

**Python resolution order:**

1. PyInstaller one-file binary under `resources/reticulum/` (packaged builds).
2. venv under `resources/reticulum-runtime/venv/` (dev/optional).
3. System Python with `rns` installed (`pip install rns`) — no env var needed.
4. System Python when `QORTAL_RETICULUM_SYSTEM=1` is set.

Set `QORTAL_RETICULUM_NO_SYSTEM=1` to opt out of (3) and (4) in dev.

**Key paths and ports:**

| Item | Value |
|---|---|
| Config directory | `appData/qortal-hub/reticulum` — shared by all local app instances |
| Daemon base port | `37428 + N` where N is the instance index |
| Control base port | `37429 + N` |
| Instance name | `qortal-hub-shared` |
| Discovery announce interval | 5 minutes |
| Daemon stop timeout | 10 seconds |

**Multi-instance behaviour:** The daemon is shared across all open Hub windows. A JSON instance registry tracks active app PIDs. On quit, the daemon is only stopped when no other instance is still active (ref-counted).

**Process priority:** On startup, the daemon PID is re-niced to `-7` by default. Override with `QORTAL_RETICULUM_PRIORITY_NICE=<value>` or disable with `QORTAL_RETICULUM_PRIORITY_NICE=off`.

**Reachability states** reported by the daemon:

| State | Meaning |
|---|---|
| `unknown` | Status not yet determined |
| `lan-only` | Reachable only on the local network |
| `hub-connected` | Connected to at least one bootstrap hub |
| `disconnected` | No RNS connectivity |

### Bridge — `reticulum-bridge.ts`

A Python subprocess (`presence_bridge.py`) launched after the daemon is ready.

- Communicates with the Electron main process via extra stdio file descriptors:
  - **fd 3** — Electron → Python (commands + outbound audio batches)
  - **fd 4** — Python → Electron (events + inbound audio batches)
- Commands use a JSON request/response model with frame IDs for correlation.
- Audio frames use a separate binary format (see [Audio IPC](#audio-ipc) below).

**Bridge states:** `stopped` → `starting` → `ready` / `degraded`

**Key bridge actions:**

| Action | Purpose |
|---|---|
| `publish_presence` / `forward_presence` | Broadcast signed presence envelopes |
| `send_group_call` / `fanout_group_call` | Group call signaling |
| `open_group_audio_link` | Establish a Reticulum audio link to a peer |
| `send_group_audio_link_heartbeat` | Keep audio links alive |
| `accept_qchat_file_resource` | Accept an incoming file offer |
| `send_qchat_file_resource` | Send a file offer to a peer |
| `authorize_qchat_file_resource` | Authorise file delivery |

### Mesh Coordinator — `reticulum-mesh.ts`

Handles hub-to-hub mesh networking, separate from the TLS P2P layer (`p2p-network.ts`).

**Interface types:**

| Platform | Listen interface | Outbound hub interface |
|---|---|---|
| Linux | `BackboneInterface` (port 4243) | `BackboneInterface` |
| Windows / macOS | `TCPServerInterface` (port 4243) | `TCPClientInterface` |

Community mesh discovery uses RNS `AutoInterface` with `autoconnect_discovered_interfaces` capped at 8 peers.

**Default bootstrap hubs:**

| Name | Host | Port |
|---|---|---|
| Backbone Client Qortal Hub | `phantom.mobilefabrik.com` | 4400 |
| Crowetic Reticulum Hub | `reticulum.qortal.link` | 4444 |
| Crowetic Reticulum Hub 2 | `reticulum2.qortal.link` | 4444 |

**UPnP:** The coordinator attempts to map the mesh listen port via UPnP and records the discovered WAN IP in `reachable_on` so remote peers can reach this node. A manually configured `meshReachableOnHost` always takes precedence over the UPnP-discovered value.

**Persistent state** is stored in `appData/qortal-hub/reticulum-mesh-state.json`.

### Audio IPC — `reticulum-audio-ipc.ts`

Binary message format used on fd 3/fd 4 for audio frames:

```text
Header:
  magic:   "QAUD"  (4 bytes, ASCII)
  version: 1       (1 byte)
  bodyLen: uint32  (4 bytes)

Body (one or more frames):
  frame_count
    linkIdLen   | linkId
    roomIdLen   | roomId
    peerPresenceHashLen | peerPresenceHash
    peerCallHashLen     | peerCallHash
    payloadLen  | payload
```

- The bridge batches multiple frames per message to reduce syscall overhead.
- Fairness and pressure control prevent any single peer leg from starving others.
- Buffer objects carry timing metadata via `Symbol.for('qortal.*')` symbols.

For the full audio path (capture → Opus → encrypt → send → receive → decrypt → playout) see `docs/group-audio-calls.md`.

## Identities

Qortal Hub uses two separate Reticulum identities with different lifetimes and scopes.

### Local (Per-Installation) Identity

**Source:** `presence_bridge.py` → `ensure_identity()`  
**Stored at:** `userData/reticulum/presence-bridge.identity`

On first startup the Python bridge checks whether the file exists:

- **File found** → loaded with `RNS.Identity.from_file()` — the same identity is reused every time.
- **File missing** → a new `RNS.Identity()` is generated and immediately written to disk.

The file path is passed from the Electron main process via the `QORTAL_RETICULUM_IDENTITY_PATH` environment variable (set in `reticulum-bridge.ts` → `spawnAndHandshake()`). The resulting public key is what `reticulumGetLocalIdentityPublicKeyBase64()` returns and is embedded as the `rk` field in `GC_JOIN` messages for voice call authentication.

**Conclusion:** unique per installation, generated once, persisted across restarts.

### Mesh Network Identity

**Source:** `reticulum-mesh-store.ts` → `getBundledMeshNetworkIdentityPath()`  
**Stored at:** `userData/reticulum/mesh-network.identity` (copied from app bundle)

This file is **shipped inside every Qortal Hub app bundle** (`resources/reticulum/mesh-network.identity`) and is identical for all installations. On first use `ensureMeshNetworkIdentityIfNeeded()` copies it into `userData`. It is referenced as `network_identity` in the managed Reticulum config so that all Hub instances join the same authenticated mesh segment and can discover each other's private gateways.

**Conclusion:** shared by all Hub users, not generated — bundled with the app.

### Summary

| Identity | Scope | Generated | Stored |
| --- | --- | --- | --- |
| Local bridge identity | Per installation | Once, on first startup | `userData/reticulum/presence-bridge.identity` |
| Mesh network identity | All Hub installations | Never (bundled) | `userData/reticulum/mesh-network.identity` (copied from bundle) |

## Startup and Shutdown

### Startup sequence (`index.ts`)

1. `recoverReticulumStateForAppLaunch()` — cleans up any orphaned daemon from a previous crash.
2. `startReticulumForAppLaunch()` — spawns the daemon and waits up to 10 seconds for it to be ready.
3. `ensureReticulumManagersStarted()` — starts the presence manager, call manager, and group call manager.

### Shutdown sequence

1. `planReticulumAppQuit()` — checks the instance registry; `shouldStopSharedDaemon` is true only when this is the last active instance.
2. `stopReticulumBridge()` — terminates the Python bridge process.
3. `stopReticulumMeshCoordinator()` — tears down mesh UPnP mappings and stops mesh state.
4. Daemon process is stopped only if `shouldStopSharedDaemon` is true.

## Renderer API

Exposed via `window.electronAPI` (context bridge in `electron/src/preload.ts`):

| Method | Description |
|---|---|
| `reticulumGetStatus()` | One-shot snapshot: daemon PID, mode, bridge state, reachability, hub interface counts |
| `onReticulumStatus(cb)` | Subscribe to live status updates; returns an unsubscribe function |
| `reticulumGetOverlayPeers()` | List of active Reticulum links with presence hashes and connection timestamps |
| `reticulumGetMeshStatus()` | Mesh enable flag, listen port, UPnP state, reachability hosts |
| `reticulumEnsureMeshNetworkIdentity()` | Create the mesh identity file if it does not exist yet |
| `reticulumGetLocalDestinationHash()` | This instance's 32-char hex RNS destination hash |
| `reticulumGetLocalIdentityPublicKeyBase64()` | RNS.Identity public key (used in `GC_JOIN` messages) |

## Presence Flow

1. The renderer calls `window.groupCall.gcallProxySignPresenceMessage()` to sign a presence envelope with the wallet key.
2. The Electron main process forwards the signed envelope to the Python bridge via `publish_presence`.
3. The bridge broadcasts it over Reticulum links to connected peers.
4. Incoming presence envelopes are forwarded back to the renderer via the `reticulum:presenceUpdate` IPC event.
5. Subscriptions are batched on a 16 ms interval in the preload layer to avoid flooding the renderer.

## Q-Chat File Transfer

Files are offered and delivered over Reticulum links with the following constraints:

| Constraint | Value |
|---|---|
| Offer TTL | 2 hours |
| Completed-send cache grace | 7 days |
| Signature max age | 24 hours |
| Signature max future skew | 2 minutes |
| Bridge attach retry interval | 3 seconds |

## Environment Variables

| Variable | Effect |
|---|---|
| `QORTAL_RETICULUM_SYSTEM=1` | Force use of system Python even in packaged builds |
| `QORTAL_RETICULUM_NO_SYSTEM=1` | Disable system Python fallback in dev |
| `QORTAL_RETICULUM_PRIORITY_NICE=<n>` | Override rnsd process nice value (default `-7`) |
| `QORTAL_RETICULUM_PRIORITY_NICE=off` | Disable nice adjustment entirely |

## Relevant Files

| File | Purpose |
|---|---|
| `electron/src/reticulum-daemon.ts` | rnsd process lifecycle, config generation, instance registry |
| `electron/src/reticulum-bridge.ts` | Python bridge process, command/event protocol, audio IPC |
| `electron/src/reticulum-launch.ts` | App-launch readiness wait |
| `electron/src/reticulum-mesh.ts` | Hub-to-hub mesh coordinator, UPnP |
| `electron/src/reticulum-mesh-store.ts` | Persistent mesh state (listen port, UPnP, reachable host) |
| `electron/src/reticulum-mesh-constants.ts` | Default listen port (`4243`), max outbound peers (`8`) |
| `electron/src/reticulum-audio-ipc.ts` | Binary audio frame encoding/decoding (QAUD format) |
| `electron/src/reticulum-audio-link-fallback-policy.ts` | Link quality decisions and fallback policy |
| `electron/src/reticulum-bridge-rebind.ts` | Bridge consumer rebinding for multi-instance scenarios |
| `electron/src/group-call-wire-reticulum.ts` | Group call wire protocol over Reticulum |
| `electron/src/preload.ts` | Context bridge — `window.electronAPI.reticulum*` methods |
| `electron/resources/presence_bridge.py` | Python bridge process (presence, calls, file transfers) |

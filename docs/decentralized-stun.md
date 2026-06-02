# Decentralized STUN

## Fixed UDP port (wire v2)

- All peers use **`STUN_FIXED_UDP_PORT` (47321)** for decentralized STUN: bootstrap URLs `stun:<host>:47321`, handshake `stunUdpPort`, outbound probes, and UPnP UDP mapping.
- **47321** is chosen as an unprivileged port, away from typical Coturn (**3478**) and the legacy **`tls + 1000`** scheme. Operators should not run another service bound to **47321/UDP** on the same machine.
- **Handshake `stunWireVersion`:** **2** = fixed port; older hubs may still advertise **`tls + 1000`** (v1). Probes use `remoteStunUdpPort` from the handshake when present, else **47321**.
- **`STUN_UDP_PORT_OFFSET`** remains exported for compatibility and tests but is **deprecated** for new logic.

## Singleton listener per machine

- Only **one** hub process per host binds **47321/UDP**. A second instance gets **`EADDRINUSE`**, skips starting the local STUN UDP server, and **does not** remove another instance’s UPnP STUN mapping on exit.
- **UPnP:** TCP P2P is mapped in the existing gateway session; STUN UDP is mapped **after** a successful local bind, using the **same** client. STUN UDP is unmapped on stop **only** if this process created that mapping.

## Bootstrap seeds

- Use a **small list** of P2P bootstrap addresses (about **2–4**): hostnames or IPs with the hub’s P2P TLS port, same form as normal peer addresses (TLS port validates the string; STUN URL always uses **47321** on that host).
- Seeds are passed from the main process (`HUB_P2P_BOOTSTRAP_SEEDS` / `init` seeds) into the preload as `--hub-p2p-seeds=` (base64 JSON). They are **hints to discover peers**, not a permanent central authority.

## Probe results

- A successful UDP STUN probe from **this node** is a **local**, **short-TTL**, **probabilistic** observation. It does **not** mean the endpoint is globally reachable or will work for every other peer’s NAT path.

## ICE list size

- The app ranks many candidates in `stun-cache.db` (on the order of **16–32** rows) but passes at most **3–6** `stun:` URLs to `RTCPeerConnection` (default cap **6** in `ICE_STUN_SERVER_CAP`).

## Call feedback

- After 1:1 calls, the renderer reports outcomes for the **STUN bundle** that was used (not per-server srflx attribution). Scoring updates are **best-effort** and intentionally conservative.

## Legacy public STUN

- **`legacyPublicStunFallback`** in app settings still toggles the main-process merge path, but the legacy public STUN URL list is **currently empty** (disabled). The renderer’s `LEGACY_PUBLIC_STUN_FALLBACK` is likewise empty when bootstrap is unavailable.

## Mixed-version rollout

- New nodes probe seeds at **47321**. Hubs that only serve STUN on **`tls+1000`** will not answer until upgraded.

## Telemetry (logs)

- Main logs may include `[STUN][telemetry]` for empty ICE pools, IPC deadline fallback, and call bundle outcomes — useful when tuning score weights and the STUN URL cap.

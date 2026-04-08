# Bundled Reticulum runtime (`rnsd` + `presence_bridge`)

**Python source:** `electron/resources/presence_bridge.py` (single source of truth, tracked in Git).  
`npm run bundle:reticulum` and packaged apps place a copy under this folder as `presence_bridge.py` next to the frozen binaries.

End users **do not install Python**. Ship **PyInstaller one-file** executables built **on the same OS and CPU architecture** you release for:

- `rnsd` / `rnsd.exe`
- `presence_bridge` / `presence_bridge.exe`

## Build the binary (before `electron:make*`)

From the **`electron/`** directory, with **Python 3.9+** on `PATH`:

```bash
npm run bundle:reticulum
```

This runs `scripts/run-build-rnsd-frozen.mjs`, which invokes `scripts/build-rnsd-frozen.py` using `python3`, `python`, or on Windows `py -3`.

This writes:

- **Linux / macOS:** `resources/reticulum/rnsd` and `resources/reticulum/presence_bridge`
- **Windows:** `resources/reticulum/rnsd.exe` and `resources/reticulum/presence_bridge.exe`

and a small `BUNDLE_READY` marker. The build uses the current Python, bootstraps **`pip`** if needed, installs **`rns`** + **`lxmf`** (for AutoInterface discovery) + **`pyinstaller`** into the current user site-packages, and writes scratch files under `electron/.build/rnsd-frozen/` (gitignored).

Repeat on **each** platform you ship (Linux x64, Windows, macOS, Linux arm64, etc.); do not copy a binary built on one OS onto another.

**Debian / Ubuntu:** no `python3-pip` / `python3-venv` package is required for the frozen build path anymore, but you still need a normal **Python 3.9+** install and network access the first time.

## Packaging commands

The packaging scripts now bundle a **native Reticulum binary before packaging** and enforce that you build on the **matching host OS/arch**:

- `npm run electron:make-lin` → only on **Linux x64**
- `npm run electron:make-lin-docker` → **any host with Docker**; builds **Linux x64** AppImage + deb inside **Debian 11 (bullseye)** (~glibc **2.31**) for **broader** compatibility than CI (**ubuntu-22.04**, ~2.35). Uses `linux/amd64` (Apple Silicon works via emulation, slower).
- `npm run electron:make-lin-docker-appimage` → same Dockerized **Linux x64** build path, but emits only the **AppImage** for faster testing.
- `npm run electron:make-arm` → only on **Linux arm64**
- `npm run electron:make-win` → only on **Windows**
- `npm run electron:make-mac` → only on **macOS**
- `npm run electron:make-local` / `npm run electron:pack` → current host only

`npm run electron:make-all` now intentionally fails with guidance, because a single local machine must not embed one OS's `rnsd` into another OS's app package.

For automated cross-platform builds use the GitHub Actions workflow:

- `.github/workflows/electron_cross_platform_builds.yml`

## Runtime (Electron)

The main process spawns `rnsd` with `--config` pointing at **`userData/reticulum`** (writable). The Reticulum bridge prefers the bundled `presence_bridge` executable and falls back to Python only in development. Logs also go to **`userData/logs/reticulum.log`**.

The managed config keeps local `AutoInterface` discovery enabled and also ships a default list of public `TCPClientInterface` hubs so matching `qortal-hub` namespaces can discover each other across the Internet without manual config edits. When the private mesh gateway is enabled, the managed `Qortal Hub Mesh Listen` interface is emitted on the same `qortal-hub` Reticulum network segment and publishes IFAC details inside the encrypted discovery payload for trusted peers.

## Default WAN bootstrap

The app now treats worldwide Reticulum reachability as a built-in feature:

- LAN discovery still uses `AutoInterface`
- WAN bootstrap uses one or more curated public TCP hubs from the managed config
- A custom Reticulum config under `userData/reticulum/config` is still preserved and overrides the managed default

The default hub list is curated in-app rather than scraped at runtime. That keeps startup deterministic and lets us rotate or expand endpoints later without redesigning the config format.

## Reachability status

The bridge polls Reticulum interface stats and surfaces a coarse reachability state to the app:

- `hub-connected` when at least one configured TCP hub is online
- `disconnected` when WAN hubs are configured but currently offline
- `lan-only` when only local discovery is available

When WAN connectivity appears after startup, the bridge re-announces the local presence and call destinations so remote peers can discover the node without restarting the app.

## Fallbacks (development)

- **System Python:** with `electron:start` / dev mode, if there is no frozen binary and no venv, the app tries `python3` / `python` on `PATH` when `pip install rns lxmf` has been run (no env var required).
- **Venv:** `electron/resources/reticulum-runtime/venv/` from `npm run bundle:reticulum-venv` (optional).
- **Force system Python in packaged builds:** `QORTAL_RETICULUM_SYSTEM=1`.
- **Disable system Python in dev** (only frozen / venv): `QORTAL_RETICULUM_NO_SYSTEM=1`.

## First run in development (`npm run electron:start`)

If RNS is not already available, the **Electron main process** shows a small **“Setting up networking”** window and runs `scripts/ensure-reticulum-for-dev.mjs`, which:

1. Downloads PyPA **`get-pip.py`** and runs it with **`--user --break-system-packages`** on Linux/macOS when the distro is **PEP 668** “externally managed” (e.g. Ubuntu 24.04+), so bootstrap works without **`python3-pip`** / **`python3-venv`**.
2. Runs **`python3 -m pip install --user rns lxmf`** (same flag first on Linux/macOS).

Needs **Python 3.9+ on PATH** and **network** once. A **frozen `resources/reticulum/rnsd`** skips this entirely.

Skip: **`QORTAL_RETICULUM_SKIP_ENSURE=1`**.

You can still run **`node scripts/ensure-reticulum-for-dev.mjs`** manually from `electron/` (verbose pip output unless **`RETICULUM_ENSURE_QUIET=1`**).

## Disable

Set environment variable `QORTAL_RETICULUM_DISABLE=1`.

## References

- [Using Reticulum on your system](https://reticulum.network/manual/using.html)
- PyPI: `rns`, `lxmf`

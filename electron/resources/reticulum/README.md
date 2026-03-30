# Bundled Reticulum daemon (`rnsd`)

End users **do not install Python**. Ship a **PyInstaller one-file** `rnsd` (or `rnsd.exe` on Windows) built **on the same OS and CPU architecture** you release for.

## Build the binary (before `electron:make*`)

From the **`electron/`** directory, with **Python 3.9+** on `PATH`:

```bash
npm run bundle:reticulum
```

This runs `scripts/run-build-rnsd-frozen.mjs`, which invokes `scripts/build-rnsd-frozen.py` using `python3`, `python`, or on Windows `py -3`.

This writes:

- **Linux / macOS:** `resources/reticulum/rnsd`
- **Windows:** `resources/reticulum/rnsd.exe`

and a small `BUNDLE_READY` marker. The build uses the current Python, bootstraps **`pip`** if needed, installs **`rns`** + **`pyinstaller`** into the current user site-packages, and writes scratch files under `electron/.build/rnsd-frozen/` (gitignored).

Repeat on **each** platform you ship (Linux x64, Windows, macOS, Linux arm64, etc.); do not copy a binary built on one OS onto another.

**Debian / Ubuntu:** no `python3-pip` / `python3-venv` package is required for the frozen build path anymore, but you still need a normal **Python 3.9+** install and network access the first time.

## Packaging commands

The packaging scripts now bundle a **native Reticulum binary before packaging** and enforce that you build on the **matching host OS/arch**:

- `npm run electron:make-lin` → only on **Linux x64**
- `npm run electron:make-arm` → only on **Linux arm64**
- `npm run electron:make-win` → only on **Windows**
- `npm run electron:make-mac` → only on **macOS**
- `npm run electron:make-local` / `npm run electron:pack` → current host only

`npm run electron:make-all` now intentionally fails with guidance, because a single local machine must not embed one OS's `rnsd` into another OS's app package.

For automated cross-platform builds use the GitHub Actions workflow:

- `.github/workflows/electron_cross_platform_builds.yml`

## Runtime (Electron)

The main process spawns this binary with `--config` pointing at **`userData/reticulum`** (writable). Logs also go to **`userData/logs/reticulum.log`**.

## Fallbacks (development)

- **System Python:** with `electron:start` / dev mode, if there is no frozen binary and no venv, the app tries `python3` / `python` on `PATH` when `pip install rns` has been run (no env var required).
- **Venv:** `electron/resources/reticulum-runtime/venv/` from `npm run bundle:reticulum-venv` (optional).
- **Force system Python in packaged builds:** `QORTAL_RETICULUM_SYSTEM=1`.
- **Disable system Python in dev** (only frozen / venv): `QORTAL_RETICULUM_NO_SYSTEM=1`.

## First run in development (`npm run electron:start`)

If RNS is not already available, the **Electron main process** shows a small **“Setting up networking”** window and runs `scripts/ensure-reticulum-for-dev.mjs`, which:

1. Downloads PyPA **`get-pip.py`** and runs it with **`--user --break-system-packages`** on Linux/macOS when the distro is **PEP 668** “externally managed” (e.g. Ubuntu 24.04+), so bootstrap works without **`python3-pip`** / **`python3-venv`**.
2. Runs **`python3 -m pip install --user rns`** (same flag first on Linux/macOS).

Needs **Python 3.9+ on PATH** and **network** once. A **frozen `resources/reticulum/rnsd`** skips this entirely.

Skip: **`QORTAL_RETICULUM_SKIP_ENSURE=1`**.

You can still run **`node scripts/ensure-reticulum-for-dev.mjs`** manually from `electron/` (verbose pip output unless **`RETICULUM_ENSURE_QUIET=1`**).

## Disable

Set environment variable `QORTAL_RETICULUM_DISABLE=1`.

## References

- [Using Reticulum on your system](https://reticulum.network/manual/using.html)
- PyPI: `rns`

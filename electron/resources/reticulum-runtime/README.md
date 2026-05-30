# Optional dev venv (not shipped in release builds)

Use this **only for local development** when you do not want to run `npm run bundle:reticulum` (PyInstaller) on every change.

```bash
cd electron && npm run bundle:reticulum-venv
```

That creates `venv/` here with `pip install rns lxmf` (LXMF enables Reticulum AutoInterface discovery per the manual). The main process tries **frozen `resources/reticulum/rnsd` first**, then this venv.

Release builds use **only** the frozen binary under `resources/reticulum/` — see `electron/resources/reticulum/README.md`.

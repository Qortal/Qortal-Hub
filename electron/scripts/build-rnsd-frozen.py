#!/usr/bin/env python3
"""
Build standalone Reticulum executables with PyInstaller (no end-user Python required).
Must be run on each target OS/arch before packaging Electron (output is not portable).

Works on minimal Debian/Ubuntu without python3-venv by bootstrapping pip with
get-pip.py and installing rns + lxmf + pyinstaller into the user site-packages.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"
RETICULUM_PIP_PACKAGE = os.environ.get(
    "QORTAL_RETICULUM_PIP_PACKAGE",
    "git+https://github.com/Philreact/Reticulum.git@master",
)
LXMF_PIP_PACKAGE = os.environ.get("QORTAL_LXMF_PIP_PACKAGE", "lxmf==0.9.4")
WEBSOCKETS_PIP_PACKAGE = "websockets==14.2"
PIP_ENV = {
    "PIP_DISABLE_PIP_VERSION_CHECK": "1",
    "PIP_BREAK_SYSTEM_PACKAGES": "1",
}
BUILD_TARGETS = (
    {
        "name": "rnsd",
        "entry_resolver": lambda pyexe, electron_root: resolve_rnsd_entry(pyexe),
    },
    {
        "name": "presence_bridge",
        "entry_resolver": lambda pyexe, electron_root: str(
            electron_root / "resources" / "presence_bridge.py"
        ),
    },
)


def run(cmd: list[str], *, env_extra: dict[str, str] | None = None, cwd: Path | None = None) -> None:
    env = {**os.environ, **(env_extra or {})}
    subprocess.run(cmd, check=True, cwd=str(cwd) if cwd else None, env=env)


def has_module(pyexe: str, module_name: str) -> bool:
    result = subprocess.run(
        [pyexe, "-c", f"import {module_name}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=os.environ,
    )
    return result.returncode == 0


def verify_websockets_version(pyexe: str) -> None:
    result = subprocess.run(
        [
            pyexe,
            "-c",
            "import websockets; raise SystemExit(0 if websockets.__version__ == '14.2' else 1)",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=os.environ,
    )
    if result.returncode != 0:
        sys.exit("Frozen bridge build requires exactly websockets==14.2")


def has_pip(pyexe: str) -> bool:
    result = subprocess.run(
        [pyexe, "-m", "pip", "--version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={**os.environ, **PIP_ENV},
    )
    return result.returncode == 0


def ensure_pip(pyexe: str, *, user: bool = True) -> None:
    if has_pip(pyexe):
        return
    print("pip not found; bootstrapping with get-pip.py …")
    with tempfile.NamedTemporaryFile(suffix="-get-pip.py", delete=False) as fh:
        tmp = Path(fh.name)
    try:
        with urllib.request.urlopen(GET_PIP_URL) as response:
            tmp.write_bytes(response.read())
        if not user:
            run([pyexe, str(tmp)], env_extra=PIP_ENV)
        elif os.name == "nt":
            run([pyexe, str(tmp), "--user"], env_extra=PIP_ENV)
        else:
            try:
                run([pyexe, str(tmp), "--user", "--break-system-packages"], env_extra=PIP_ENV)
            except subprocess.CalledProcessError:
                run([pyexe, str(tmp), "--user"], env_extra=PIP_ENV)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
    if not has_pip(pyexe):
        sys.exit("Failed to bootstrap pip for the current Python.")


def pip_install(
    pyexe: str,
    packages: list[str],
    *,
    upgrade: bool = False,
    force_reinstall: bool = False,
    user: bool = True,
) -> None:
    flags = ["--prefer-binary"]
    if upgrade:
        flags.append("--upgrade")
    if force_reinstall:
        flags.append("--force-reinstall")
    if not user:
        attempts = [["-m", "pip", "install", *flags, *packages]]
    elif os.name != "nt":
        attempts = [
            ["-m", "pip", "install", "--user", "--break-system-packages", *flags, *packages],
            ["-m", "pip", "install", "--user", *flags, *packages],
        ]
    else:
        attempts = [["-m", "pip", "install", "--user", *flags, *packages]]
    for args in attempts:
        try:
            run([pyexe, *args], env_extra=PIP_ENV)
            return
        except subprocess.CalledProcessError:
            continue
    sys.exit(f"Failed to install {' '.join(packages)} with pip.")


def reticulum_install_source(pyexe: str) -> str:
    proc = subprocess.run(
        [
            pyexe,
            "-c",
            "\n".join(
                [
                    "import importlib.metadata as md, json, pathlib",
                    "dist = md.distribution('rns')",
                    "direct_url = pathlib.Path(dist._path) / 'direct_url.json'",
                    "source = ''",
                    "if direct_url.exists():",
                    "    data = json.loads(direct_url.read_text())",
                    "    source = data.get('url', '')",
                    "    vcs = data.get('vcs_info') or {}",
                    "    if vcs.get('commit_id'):",
                    "        source += '@' + vcs.get('commit_id')",
                    "print(json.dumps({'version': dist.version, 'source': source}))",
                ]
            ),
        ],
        capture_output=True,
        text=True,
        env={**os.environ, **PIP_ENV},
    )
    if proc.returncode != 0:
        sys.exit(f"Failed to inspect installed Reticulum package: {proc.stderr.strip()}")
    try:
        return proc.stdout.strip()
    except Exception:
        sys.exit(f"Failed to parse installed Reticulum package metadata: {proc.stdout!r}")


def verify_reticulum_source(pyexe: str) -> str:
    metadata_json = reticulum_install_source(pyexe)
    try:
        metadata = json.loads(metadata_json)
    except json.JSONDecodeError:
        sys.exit(f"Failed to parse installed Reticulum package metadata: {metadata_json!r}")
    source = str(metadata.get("source") or "")
    expected_source = "github.com/Philreact/Reticulum"
    if expected_source not in source:
        sys.exit(
            "Bundled Reticulum is not Philreact's build. "
            f"Expected source containing {expected_source!r}, got {metadata_json}"
        )
    print(f"Verified Reticulum package source: {metadata_json}")
    return metadata_json


def venv_python(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def create_build_python(pyexe: str, build_root: Path) -> tuple[str, bool]:
    """Create an arch-local build Python, falling back to user site packages."""
    venv_dir = build_root / "venv"
    try:
        run([pyexe, "-m", "venv", str(venv_dir)])
        venv_py = venv_python(venv_dir)
        if venv_py.is_file():
            return str(venv_py), False
    except Exception as exc:
        print(f"Could not create isolated build venv, falling back to user site-packages: {exc}")
    return pyexe, True


def resolve_rnsd_entry(pyexe: str) -> str:
    proc = subprocess.run(
        [pyexe, "-c", "import RNS.Utilities.rnsd as m; print(m.__file__)"],
        capture_output=True,
        text=True,
        check=True,
        env=os.environ,
    )
    rnsd_py = proc.stdout.strip()
    if not rnsd_py or not Path(rnsd_py).is_file():
        sys.exit(f"Could not resolve rnsd entry script (got: {rnsd_py!r})")
    return rnsd_py


def freeze_target(
    pyexe: str,
    electron_root: Path,
    build_root: Path,
    output_dir: Path,
    *,
    name: str,
    entry_script: str,
) -> None:
    if not Path(entry_script).is_file():
        sys.exit(f"Could not resolve {name} entry script (got: {entry_script!r})")

    pi_work = build_root / name
    pi_work.mkdir(parents=True)
    dist_path = pi_work / "dist"
    work_path = pi_work / "build"

    cmd = [
        pyexe,
        "-m",
        "PyInstaller",
        "--onefile",
        "--console",
        "--clean",
        "--noconfirm",
        "--distpath",
        str(dist_path),
        "--workpath",
        str(work_path),
        "--specpath",
        str(pi_work),
        "--name",
        name,
        "--collect-all",
        "RNS",
        "--collect-all",
        "cryptography",
        "--collect-all",
        "pyserial",
        "--collect-all",
        "LXMF",
        "--collect-all",
        "websockets",
        "--hidden-import",
        "RNS",
        "--hidden-import",
        "LXMF",
        "--hidden-import",
        "qortalland_games",
        "--hidden-import",
        "qortalland_proximity",
        "--hidden-import",
        "qortal_python_diagnostics",
        "--hidden-import",
        "masque_discovery_codec",
        "--paths",
        str(electron_root / "resources"),
        "--runtime-hook",
        str(electron_root / "resources" / "qortal_python_diagnostics_hook.py"),
        "--hidden-import",
        "cryptography.hazmat.backends.openssl.backend",
        entry_script,
    ]
    print("Running:", " ".join(cmd))
    run(cmd, env_extra=PIP_ENV, cwd=pi_work)

    exe_name = f"{name}.exe" if os.name == "nt" else name
    built = dist_path / exe_name
    if not built.is_file():
        sys.exit(f"PyInstaller did not produce {built}")

    output_dir.mkdir(parents=True, exist_ok=True)
    dest = output_dir / exe_name
    shutil.copy2(built, dest)
    if os.name != "nt":
        dest.chmod(0o755)
    print(f"Wrote {dest}")


def copy_runtime_sources(electron_root: Path, output_dir: Path) -> None:
    source_bridge = electron_root / "resources" / "presence_bridge.py"
    source_games = electron_root / "resources" / "qortalland_games.py"
    source_proximity = electron_root / "resources" / "qortalland_proximity.py"
    source_diagnostics = electron_root / "resources" / "qortal_python_diagnostics.py"
    source_sitecustomize = electron_root / "resources" / "sitecustomize.py"
    if not source_bridge.is_file():
        sys.exit(f"Missing tracked bridge source: {source_bridge}")
    if not source_games.is_file():
        sys.exit(f"Missing tracked game bridge source: {source_games}")
    if not source_proximity.is_file():
        sys.exit(f"Missing tracked proximity bridge source: {source_proximity}")
    if not source_diagnostics.is_file():
        sys.exit(f"Missing Python diagnostics source: {source_diagnostics}")
    if not source_sitecustomize.is_file():
        sys.exit(f"Missing Python diagnostics startup hook: {source_sitecustomize}")
    shutil.copy2(source_bridge, output_dir / "presence_bridge.py")
    shutil.copy2(electron_root / "resources" / "masque_discovery_codec.py", output_dir / "masque_discovery_codec.py")
    shutil.copy2(source_games, output_dir / "qortalland_games.py")
    shutil.copy2(source_proximity, output_dir / "qortalland_proximity.py")
    shutil.copy2(source_diagnostics, output_dir / "qortal_python_diagnostics.py")
    shutil.copy2(source_sitecustomize, output_dir / "sitecustomize.py")
    print(f"Wrote {output_dir / 'presence_bridge.py'}")
    mesh_net = electron_root / "resources" / "mesh-network.identity"
    if not mesh_net.is_file():
        sys.exit(f"Missing bundled mesh network identity: {mesh_net}")
    shutil.copy2(mesh_net, output_dir / "mesh-network.identity")
    print(f"Wrote {output_dir / 'mesh-network.identity'}")
    mesh_passphrase = electron_root / "resources" / "mesh-network.passphrase"
    if not mesh_passphrase.is_file():
        sys.exit(f"Missing bundled mesh network passphrase: {mesh_passphrase}")
    shutil.copy2(mesh_passphrase, output_dir / "mesh-network.passphrase")
    print(f"Wrote {output_dir / 'mesh-network.passphrase'}")


def remove_python_cache_artifacts(output_dir: Path) -> None:
    for pycache_dir in output_dir.rglob("__pycache__"):
        if pycache_dir.is_dir():
            shutil.rmtree(pycache_dir)
            print(f"Removed {pycache_dir}")
    for pyc_file in output_dir.rglob("*.pyc"):
        if pyc_file.is_file():
            pyc_file.unlink()
            print(f"Removed {pyc_file}")


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    electron_root = script_dir.parent
    default_out = electron_root / "resources" / "reticulum"

    parser = argparse.ArgumentParser(description="Freeze rnsd with PyInstaller")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_out,
        help="Directory for rnsd / rnsd.exe",
    )
    args = parser.parse_args()

    build_root = electron_root / ".build" / "rnsd-frozen"
    if build_root.exists():
        shutil.rmtree(build_root)
    build_root.mkdir(parents=True)

    pyexe, use_user_install = create_build_python(sys.executable, build_root)
    ensure_pip(pyexe, user=use_user_install)
    if not has_module(pyexe, "wheel"):
        pip_install(pyexe, ["wheel"], user=use_user_install)
    pip_install(pyexe, [LXMF_PIP_PACKAGE], user=use_user_install)
    pip_install(pyexe, [WEBSOCKETS_PIP_PACKAGE], user=use_user_install)
    verify_websockets_version(pyexe)
    if not has_module(pyexe, "PyInstaller"):
        pip_install(pyexe, ["pyinstaller"], user=use_user_install)
    pip_install(
        pyexe,
        [RETICULUM_PIP_PACKAGE],
        upgrade=True,
        force_reinstall=True,
        user=use_user_install,
    )
    reticulum_metadata = verify_reticulum_source(pyexe)
    for target in BUILD_TARGETS:
        entry_script = target["entry_resolver"](pyexe, electron_root)
        freeze_target(
            pyexe,
            electron_root,
            build_root,
            args.output_dir,
            name=target["name"],
            entry_script=entry_script,
        )
    copy_runtime_sources(electron_root, args.output_dir)
    remove_python_cache_artifacts(args.output_dir)

    marker = args.output_dir / "BUNDLE_READY"
    marker.write_text(
        f"frozen_at={datetime.datetime.now(datetime.timezone.utc).isoformat()}\npython={pyexe}\nreticulum={RETICULUM_PIP_PACKAGE}\nlxmf={LXMF_PIP_PACKAGE}\nwebsockets={WEBSOCKETS_PIP_PACKAGE}\nreticulum_metadata={reticulum_metadata}\n",
        encoding="utf-8",
    )
    print(f"Wrote {marker}")


if __name__ == "__main__":
    main()

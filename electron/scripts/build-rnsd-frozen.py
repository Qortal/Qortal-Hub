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


def has_pip(pyexe: str) -> bool:
    result = subprocess.run(
        [pyexe, "-m", "pip", "--version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={**os.environ, **PIP_ENV},
    )
    return result.returncode == 0


def ensure_pip(pyexe: str) -> None:
    if has_pip(pyexe):
        return
    print("pip not found; bootstrapping with get-pip.py …")
    with tempfile.NamedTemporaryFile(suffix="-get-pip.py", delete=False) as fh:
        tmp = Path(fh.name)
    try:
        with urllib.request.urlopen(GET_PIP_URL) as response:
            tmp.write_bytes(response.read())
        if os.name == "nt":
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


def pip_install(pyexe: str, packages: list[str], *, upgrade: bool = False, force_reinstall: bool = False) -> None:
    flags = []
    if upgrade:
        flags.append("--upgrade")
    if force_reinstall:
        flags.append("--force-reinstall")
    attempts = (
        [["-m", "pip", "install", "--user", "--break-system-packages", *flags, *packages],
         ["-m", "pip", "install", "--user", *flags, *packages]]
        if os.name != "nt"
        else [["-m", "pip", "install", "--user", *flags, *packages]]
    )
    for args in attempts:
        try:
            run([pyexe, *args], env_extra=PIP_ENV)
            return
        except subprocess.CalledProcessError:
            continue
    sys.exit(f"Failed to install {' '.join(packages)} with pip.")


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
        "--hidden-import",
        "RNS",
        "--hidden-import",
        "LXMF",
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
    if not source_bridge.is_file():
        sys.exit(f"Missing tracked bridge source: {source_bridge}")
    shutil.copy2(source_bridge, output_dir / "presence_bridge.py")
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

    pyexe = sys.executable
    ensure_pip(pyexe)
    pip_install(pyexe, [RETICULUM_PIP_PACKAGE], upgrade=True, force_reinstall=True)
    if not has_module(pyexe, "LXMF"):
        pip_install(pyexe, ["lxmf"])
    if not has_module(pyexe, "PyInstaller"):
        pip_install(pyexe, ["pyinstaller"])
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

    marker = args.output_dir / "BUNDLE_READY"
    marker.write_text(
        f"frozen_at={datetime.datetime.now(datetime.timezone.utc).isoformat()}\npython={pyexe}\nreticulum={RETICULUM_PIP_PACKAGE}\n",
        encoding="utf-8",
    )
    print(f"Wrote {marker}")


if __name__ == "__main__":
    main()

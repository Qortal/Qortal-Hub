#!/usr/bin/env python3
"""
Build a standalone rnsd executable with PyInstaller (no end-user Python required).
Must be run on each target OS/arch before packaging Electron (output is not portable).

Works on minimal Debian/Ubuntu without python3-venv by bootstrapping pip with
get-pip.py and installing rns + pyinstaller into the user site-packages.
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
PIP_ENV = {
    "PIP_DISABLE_PIP_VERSION_CHECK": "1",
    "PIP_BREAK_SYSTEM_PACKAGES": "1",
}


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


def pip_install(pyexe: str, packages: list[str]) -> None:
    attempts = (
        [["-m", "pip", "install", "--user", "--break-system-packages", *packages],
         ["-m", "pip", "install", "--user", *packages]]
        if os.name != "nt"
        else [["-m", "pip", "install", "--user", *packages]]
    )
    for args in attempts:
        try:
            run([pyexe, *args], env_extra=PIP_ENV)
            return
        except subprocess.CalledProcessError:
            continue
    sys.exit(f"Failed to install {' '.join(packages)} with pip.")


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
    if not has_module(pyexe, "RNS"):
        pip_install(pyexe, ["rns"])
    if not has_module(pyexe, "PyInstaller"):
        pip_install(pyexe, ["pyinstaller"])

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

    pi_work = build_root / "pyinstaller"
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
        "rnsd",
        "--collect-all",
        "RNS",
        "--collect-all",
        "cryptography",
        "--collect-all",
        "pyserial",
        "--hidden-import",
        "RNS",
        "--hidden-import",
        "cryptography.hazmat.backends.openssl.backend",
        rnsd_py,
    ]
    print("Running:", " ".join(cmd))
    run(cmd, env_extra=PIP_ENV, cwd=pi_work)

    exe_name = "rnsd.exe" if os.name == "nt" else "rnsd"
    built = dist_path / exe_name
    if not built.is_file():
        sys.exit(f"PyInstaller did not produce {built}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    dest = args.output_dir / exe_name
    shutil.copy2(built, dest)
    if os.name != "nt":
        dest.chmod(0o755)
    marker = args.output_dir / "BUNDLE_READY"
    marker.write_text(
        f"frozen_at={datetime.datetime.now(datetime.timezone.utc).isoformat()}\npython={pyexe}\n",
        encoding="utf-8",
    )
    print(f"Wrote {dest}")


if __name__ == "__main__":
    main()

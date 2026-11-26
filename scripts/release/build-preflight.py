#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Dependency-free retention and disk guard for the production release builder."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import signal
import shutil
import stat
import subprocess
import sys

GIB = 1024**3
ROOT_FLOOR = 8 * GIB
DATA_HEADROOM = 4 * GIB


def real_directory(path):
    path = Path(path)
    if path.is_symlink() or not path.is_dir() or path.resolve() != path:
        raise RuntimeError(f"Noncanonical build directory: {path}")
    return path


def lock(path, blocking=True):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise RuntimeError(f"Not a regular lock: {path}")
        fcntl.flock(fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        return fd
    except BaseException:
        os.close(fd)
        raise


def write_owner(run, body):
    target = run / "owner.json"
    temp = run / f".owner-{secrets.token_hex(8)}"
    with temp.open("x") as out:
        json.dump(body, out, indent=2)
        out.write("\n")
        out.flush()
        os.fsync(out.fileno())
    temp.replace(target)


def retain(runs):
    candidates = []
    for run in real_directory(runs).iterdir():
        if not re.fullmatch(r"[0-9a-f]{24}", run.name) or run.is_symlink() or not run.is_dir():
            continue
        record = run / "owner.json"
        if record.is_symlink() or not record.is_file():
            continue
        try:
            owner = json.loads(record.read_text())
        except (ValueError, OSError):
            continue
        if owner.get("schema") != 1 or owner.get("kind") != "gwrk-release-build" or owner.get("runId") != run.name:
            continue
        payload = run / "payload"
        if payload.is_symlink():
            raise RuntimeError(f"Symlink build payload: {payload}")
        if not payload.exists():
            continue
        try:
            lease = lock(run / ".lease", blocking=False)
        except BlockingIOError:
            continue
        try:
            # A vanished supervisor leaves an abandoned owned payload eligible.
            if owner.get("state") == "building":
                owner.update(state="failed", completedAt=datetime.now(timezone.utc).isoformat(), error="Abandoned build recovered")
                write_owner(run, owner)
            if owner.get("state") in ("completed", "failed") and isinstance(owner.get("completedAt"), str):
                candidates.append((owner["completedAt"], run, record.read_bytes()))
        finally:
            os.close(lease)
    for _, run, identity in sorted(candidates, reverse=True)[2:]:
        try:
            lease = lock(run / ".lease", blocking=False)
        except BlockingIOError:
            continue
        try:
            if (run / "owner.json").is_symlink() or (run / "owner.json").read_bytes() != identity:
                raise RuntimeError(f"Build owner changed: {run}")
            real_directory(run / "payload")
            shutil.rmtree(run / "payload")
        finally:
            os.close(lease)


def requirements(paths, root):
    grouped = {}
    root_device = real_directory(root).stat().st_dev
    for path, estimate in paths:
        path = real_directory(path)
        if not isinstance(estimate, int) or estimate < 0:
            raise RuntimeError("Build estimates must be non-negative integers")
        device = path.stat().st_dev
        previous = grouped.get(device, (path, 0))
        grouped[device] = (previous[0], previous[1] + estimate)
    grouped.setdefault(root_device, (root, 0))
    return {device: (path, total + (ROOT_FLOOR if device == root_device else DATA_HEADROOM))
            for device, (path, total) in grouped.items()}


def available_bytes(path):
    info = os.statvfs(path)
    return info.f_bavail * info.f_frsize


def supervise(runs, cache, output, command, workspace_bytes, cache_bytes, output_bytes, available=available_bytes):
    runs = Path(runs).absolute()
    real_directory(runs.parent)
    runs.mkdir(mode=0o700, exist_ok=True)
    real_directory(runs)
    cache, output = real_directory(cache), real_directory(output)
    for durable in (cache, output):
        if durable == runs or runs in durable.parents:
            raise RuntimeError(f"Cache and output must remain outside the disposable build root: {durable}")
    global_lock = lock(runs / ".retention.lock")
    run = runs / secrets.token_hex(12)
    lease = None
    owner = None
    try:
        retain(runs)
        run.mkdir(mode=0o700)
        lease = lock(run / ".lease", blocking=False)
        owner = dict(schema=1, kind="gwrk-release-build", runId=run.name, state="building",
                     startedAt=datetime.now(timezone.utc).isoformat())
        write_owner(run, owner)
        measurements = []
        for _, (path, needed) in requirements([(runs, workspace_bytes), (cache, cache_bytes), (output, output_bytes)], Path("/")).items():
            free = available(path)
            measurements.append(dict(path=str(path), requiredBytes=needed, availableBytes=free))
            if free < needed:
                raise RuntimeError(f"Insufficient disk space at {path}: {free} available, {needed} required")
        (run / "preflight.json").write_text(json.dumps(measurements, indent=2) + "\n")
        payload = run / "payload"
        payload.mkdir(mode=0o700)
        # The shared lock covers reservation and all child writes on these filesystems.
        env = dict(os.environ, GWRK_BUILD_WORKSPACE=str(payload), GWRK_BUILD_LEASE=str(run / ".lease"),
                   GWRK_BUILD_CACHE=str(cache), GWRK_BUILD_LEASE_FD=str(lease))
        child = subprocess.Popen(command, env=env, pass_fds=(lease, global_lock), stdin=subprocess.DEVNULL, start_new_session=True)
        try:
            code = child.wait(timeout=3600)
        except BaseException:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
            raise
        owner.update(state="completed" if code == 0 else "failed", exitCode=code)
        return code if code >= 0 else 128 - code
    except BaseException as error:
        if owner is not None:
            owner.update(state="failed", error=str(error))
        raise
    finally:
        if owner is not None:
            owner["completedAt"] = datetime.now(timezone.utc).isoformat()
            write_owner(run, owner)
        if lease is not None:
            os.close(lease)
        os.close(global_lock)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs-root", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workspace-bytes", type=int, default=4 * GIB)
    parser.add_argument("--cache-bytes", type=int, default=2 * GIB)
    parser.add_argument("--output-bytes", type=int, default=GIB)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("A build command is required")
    try:
        return supervise(Path(args.runs_root), Path(args.cache), Path(args.output), command,
                         args.workspace_bytes, args.cache_bytes, args.output_bytes)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Release preflight: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

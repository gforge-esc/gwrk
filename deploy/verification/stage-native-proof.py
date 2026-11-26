#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Native verification staging driver. Python standard library only.

`stage` verifies both uploaded archives and this driver, takes the run lease,
writes the run owner record and runs mandatory retention and disk preflight
under the retention lock. Only then does it copy the source, install
dependencies, build images or call Docker. `exec` runs the proof command with
the run lease held and records the outcome. See README.md in this directory.

The retention helper comes from a digest-verified gwrk package archive, so
this driver never installs or compiles the candidate to obtain the guard.
"""

import argparse
import fcntl
import gzip
import hashlib
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

GIB = 1024**3
ROOT_FLOOR_BYTES = 8 * GIB
DATA_HEADROOM_BYTES = 4 * GIB
DEFAULT_DATA_BUDGET_BYTES = 12 * GIB
COMMAND_TIMEOUT_SECONDS = 3600
PREFLIGHT_TIMEOUT_SECONDS = 900
CHILD_LEASES = ()

OWNER_FILE = "gwrk-run-owner.json"
LEASE_FILE = ".lease"
RETENTION_LOCK = ".retention.lock"
DRIVER_PATH = "deploy/verification/stage-native-proof.py"
REPOSITORY = "gwrk-verification"
MANAGED_LABEL = "org.gwrk.managed"
RUN_LABEL = "org.gwrk.run"

# The removable payload class. Matches RUN_PAYLOADS in retention-verification.ts.
# Receipts, checkpoints, manifests and proofs stay outside these paths.
HEAVY = (
    {"root": "run", "path": "source.tar"},
    {"root": "run", "path": "repo"},
    {"root": "run", "path": "build-context"},
    {"root": "run", "path": "original-rootfs.tar"},
    {"root": "run", "path": "flattened-rootfs.tar"},
    {"root": "run", "path": "input/preload-images.tar"},
    {"root": "data-run"},
)

# Matches VERIFICATION_BOOTSTRAP_FILES in src/release/verification-lifecycle.ts.
BOOTSTRAP_FILES = (
    "package.json",
    "dist/release/verification-lifecycle.js",
    "dist/application/release/retention.js",
    "dist/adapters/release/retention-docker.js",
    "dist/adapters/release/retention-fs.js",
    "dist/adapters/release/retention-lock.js",
    "dist/adapters/release/retention-quarantine.js",
    "dist/adapters/release/retention-verification.js",
    "dist/domain/retention-policy.js",
    "dist/ports/retention-port.js",
)

DIND_PIN = "docker.io/library/docker:29.10.0-dind@sha256:4bbc7223f81db790097c6dea42fb93e05b8fead4f0431fbe6ccaba6e8473201c"
NODE22_PIN = "node:22.23.4-bookworm@sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f"
TRAEFIK_PIN = "traefik:v3.7.18@sha256:9c437ac4f09ce6f4980a8544902d3475fdf70a1a7c578729581d2535dfa7d635"
PROXY_PIN = "quay.io/oauth2-proxy/oauth2-proxy:v7.15.6@sha256:c3415e8660af553f5e18f5d90db050614c02493c0ac6260ac59442f6d9b12048"
NGINX_PIN = "nginx:1.30.6-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311"
NODE20_PIN = "node:20-alpine@sha256:09e2b3d9726018aecf269bd35325f46bf75046a643a66d28360ec71132750ec8"

RUN_ID_RE = re.compile(r"^[0-9a-f]{24}\Z")
COMMIT_SHA_RE = re.compile(r"^[0-9a-f]{40}\Z")
SHA256_RE = re.compile(r"^[0-9a-f]{64}\Z")
MJS_SCRIPT_RE = re.compile(r"^[a-z-]+\.mjs\Z")

BUNDLE_FILES = [
    ("run.sh", 0o700),
    ("preflight-tls.sh", 0o700),
    ("compose.yaml", 0o644),
    (".env.example", 0o644),
    ("traefik/dynamic.yaml", 0o644),
    ("oauth2-proxy/oauth2-proxy.cfg", 0o644),
]

LEGACY_SOURCE_FILES = [
    "deploy/hosted-auth-proof/.env.example",
    "deploy/hosted-auth-proof/.gitignore",
    "deploy/hosted-auth-proof/README.md",
    "deploy/hosted-auth-proof/compose.yaml",
    "deploy/hosted-auth-proof/live-acceptance.example.md",
    "deploy/hosted-auth-proof/oauth2-proxy/oauth2-proxy.cfg",
    "deploy/hosted-auth-proof/preflight.sh",
    "deploy/hosted-auth-proof/status/default.conf",
    "deploy/hosted-auth-proof/traefik/dynamic.yaml",
    "tests/hosted-auth-proof/compose.test.yaml",
    "tests/hosted-auth-proof/gateway-proof.mjs",
    "tests/hosted-auth-proof/oidc-issuer.mjs",
    "tests/hosted-auth-proof/preflight.test.ts",
    "tests/hosted-auth-proof/production-bundle.test.ts",
]

NODE_ARTIFACT_DOCKERFILE = f"""FROM {DIND_PIN} AS docker-cli
FROM {NODE22_PIN} AS dependencies
WORKDIR /app
ENV CI=true
RUN npm install --global pnpm@9.15.9
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
FROM dependencies AS application
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build
FROM dependencies AS production-dependencies
RUN pnpm prune --prod
FROM {NODE22_PIN}
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=application /app/dist ./dist
COPY --from=application /app/package.json ./package.json
COPY --from=docker-cli /usr/local/bin/docker /usr/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
RUN rm -rf \\
    /usr/include \\
    /usr/local/include \\
    /usr/share/doc \\
    /usr/share/man \\
    /usr/share/locale \\
    /usr/share/info \\
    /usr/share/lintian \\
    /usr/share/gtk-doc \\
    /usr/share/ri \\
    /usr/lib/gcc \\
    /usr/libexec/gcc \\
    /usr/bin/*lto-dump* \\
    /usr/bin/*ld.gold* \\
    /usr/bin/*dwp* \\
    /usr/bin/g++* \\
    /usr/bin/gcc* \\
    /usr/bin/cpp* \\
    /usr/bin/cc \\
    /opt/yarn* \\
    /usr/local/lib/node_modules \\
    /usr/local/bin/npm \\
    /usr/local/bin/npx \\
    /usr/local/bin/corepack \\
    /usr/local/bin/yarn \\
    /usr/local/bin/yarnpkg \\
    /usr/lib/python3.*/test \\
    /usr/lib/python3.*/idlelib \\
    /usr/lib/python3.*/tkinter \\
    /usr/lib/python3.*/lib2to3 \\
    /var/lib/apt/lists/* \\
    /var/cache/apt/* \\
  && find /usr/lib -name '*.a' -delete \\
  && find /app/node_modules -type f \\( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.map' \\) -delete \\
  && groupadd --gid 10001 gwrk-fixture \\
  && useradd --uid 10001 --gid 10001 --home-dir /fixture/service-home --no-create-home --shell /usr/sbin/nologin gwrk-fixture \\
  && groupadd --gid 10002 gwrk-client \\
  && useradd --uid 10002 --gid 10002 --no-create-home --shell /usr/sbin/nologin gwrk-client
CMD ["node", "dist/cli.js", "--help"]
"""


class StageError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def run_cmd(args, **kwargs):
    timeout = kwargs.pop("timeout", COMMAND_TIMEOUT_SECONDS)
    check = kwargs.pop("check", True)
    kwargs.setdefault("stdin", subprocess.DEVNULL)
    kwargs.setdefault("pass_fds", CHILD_LEASES)
    kwargs.setdefault("stdout", subprocess.PIPE)
    kwargs.setdefault("stderr", subprocess.PIPE)
    child = subprocess.Popen(args, text=True, start_new_session=True, **kwargs)
    try:
        stdout, stderr = child.communicate(timeout=timeout)
    except BaseException:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.communicate()
        raise
    result = subprocess.CompletedProcess(args, child.returncode, stdout, stderr)
    if check:
        result.check_returncode()
    return result


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_allowed_fixture_script_name(name: str) -> bool:
    if name in ("native-observer-capture.py", "syn-gate-helper.sh"):
        return True
    return bool(MJS_SCRIPT_RE.match(name))


def inspect_image(image_ref: str) -> dict:
    data = json.loads(run_cmd(["docker", "image", "inspect", image_ref]).stdout)
    if not data:
        raise StageError(f"docker image inspect returned nothing for {image_ref}")
    return data[0]


def real_directory(path: Path) -> Path:
    try:
        info = path.lstat()
    except FileNotFoundError:
        raise StageError(f"{path} does not exist.") from None
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise StageError(f"{path} must be a real directory, not a symlink.")
    if os.path.realpath(path) != str(path):
        raise StageError(f"{path} is not canonical.")
    return path


def verify_directory_identity(path: Path, uid: int, gid: int, mode: int) -> dict:
    real_directory(path)
    info = path.lstat()
    if info.st_uid != uid or info.st_gid != gid:
        raise StageError(
            f"{path} ownership is {info.st_uid}:{info.st_gid}, expected {uid}:{gid}."
        )
    if stat.S_IMODE(info.st_mode) != mode:
        raise StageError(
            f"{path} mode is {oct(stat.S_IMODE(info.st_mode))}, expected {oct(mode)}."
        )
    return {"device": info.st_dev, "inode": info.st_ino}


def extract_app_dist_hashes(tar_path: Path) -> dict:
    hashes = {}
    with tarfile.open(tar_path, "r:*") as tar:
        for member in tar.getmembers():
            name = member.name.removeprefix("./").lstrip("/")
            if name.startswith("app/dist/") and member.isfile():
                handle = tar.extractfile(member)
                if handle is None:
                    raise StageError(f"Cannot read {name} from {tar_path}")
                hashes[name] = hashlib.sha256(handle.read()).hexdigest()
    if "app/dist/cli.js" not in hashes:
        raise StageError(f"Exported image {tar_path} has no app/dist/cli.js")
    return dict(sorted(hashes.items()))


class Config:
    def __init__(self, path: str):
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise StageError(f"Cannot read staging config {path}: {error}") from None
        for key in ("runsRoot", "dataParent", "dataRoot", "earlyBuildBytes", "earlyDataBytes"):
            if key not in raw:
                raise StageError(f"Staging config needs {key}.")
        self.runs = Path(raw["runsRoot"])
        self.data_parent = Path(raw["dataParent"])
        self.data_root = Path(raw["dataRoot"])
        for path_value in (self.runs, self.data_parent, self.data_root):
            if not path_value.is_absolute():
                raise StageError(f"Staging config path {path_value} must be absolute.")
        if self.data_root.parent != self.data_parent:
            raise StageError("dataRoot must be a direct child of dataParent.")
        self.root_path = raw.get("rootPath", "/")
        self.require_root = raw.get("requireRoot", True) is not False
        owner = raw.get("stagingOwner", {"uid": 0, "gid": 0})
        self.uid, self.gid = int(owner["uid"]), int(owner["gid"])
        self.data_parent_owner = raw.get("dataParentOwner")
        self.early_build = int(raw["earlyBuildBytes"])
        self.early_data = int(raw["earlyDataBytes"])
        if self.early_build < 0 or self.early_data < 0:
            raise StageError("Early byte estimates must be non-negative.")
        self.data_budget = int(raw.get("dataBudgetBytes", DEFAULT_DATA_BUDGET_BYTES))
        self.node = raw.get("node", "node")
        self.host_identity = raw.get("hostIdentity")


def own(cfg: Config, path: Path, mode: int) -> None:
    if cfg.require_root:
        os.chown(path, cfg.uid, cfg.gid, follow_symlinks=False)
    os.chmod(path, mode)


def make_dir(cfg: Config, path: Path, mode: int) -> dict:
    path.mkdir(mode=mode, exist_ok=True)
    real_directory(path)
    own(cfg, path, mode)
    if cfg.require_root:
        return verify_directory_identity(path, cfg.uid, cfg.gid, mode)
    real_directory(path)
    info = path.lstat()
    return {"device": info.st_dev, "inode": info.st_ino}


def host_identity(cfg: Config) -> dict | None:
    """Optional EC2 identity check. Expected values come from the config."""
    expected = cfg.host_identity
    if not expected:
        return None
    token_request = urllib.request.Request(
        "http://169.254.169.254/latest/api/token",
        method="PUT",
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"},
    )
    with urllib.request.urlopen(token_request, timeout=5) as response:
        token = response.read().decode()
    document_request = urllib.request.Request(
        "http://169.254.169.254/latest/dynamic/instance-identity/document",
        headers={"X-aws-ec2-metadata-token": token},
    )
    with urllib.request.urlopen(document_request, timeout=5) as response:
        document = json.loads(response.read())
    actual = {"awsAccount": document.get("accountId"), "awsInstance": document.get("instanceId")}
    if actual != {"awsAccount": expected.get("awsAccount"), "awsInstance": expected.get("awsInstance")}:
        raise StageError(f"Host identity mismatch: got {actual}.")
    return actual


# Run ownership --------------------------------------------------------------


def read_owner(run: Path, run_id: str) -> dict:
    path = run / OWNER_FILE
    try:
        info = path.lstat()
    except FileNotFoundError:
        raise StageError(f"{run} exists but has no owner record. It was left untouched.") from None
    if not stat.S_ISREG(info.st_mode):
        raise StageError(f"{path} is not a regular owner record.")
    try:
        owner = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        raise StageError(f"{path} is not a readable owner record.") from None
    if owner.get("schema") != 1 or owner.get("runId") != run_id:
        raise StageError(f"{path} does not belong to run {run_id}.")
    return owner


def write_owner(run: Path, owner: dict) -> None:
    path = run / OWNER_FILE
    temporary = run / f".{OWNER_FILE}.tmp-{os.getpid()}"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(owner, indent=2, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def update_owner(run: Path, run_id: str, **changes) -> dict:
    owner = {**read_owner(run, run_id), **changes}
    write_owner(run, owner)
    return owner


def take_lease(run: Path, run_id: str) -> int:
    flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC
    fd = os.open(run / LEASE_FILE, flags, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        raise StageError(f"Another job holds the lease for run {run_id}.") from None
    return fd


# Archive checks -------------------------------------------------------------


def verify_digest(path: Path, expected: str, label: str) -> None:
    if not SHA256_RE.match(expected):
        raise StageError(f"{label} digest must be 64 lowercase hex characters.")
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise StageError(f"{label} archive {path} must be a regular file.")
    actual = sha256_file(path)
    if actual != expected:
        raise StageError(f"{label} archive digest mismatch: expected {expected}, got {actual}.")


def verify_driver(source_archive: Path) -> None:
    """This driver must be byte-identical to the copy in the reviewed source."""
    own_bytes = Path(os.path.realpath(__file__)).read_bytes()
    with tarfile.open(source_archive, "r:*") as tar:
        for member in tar.getmembers():
            if member.name.removeprefix("./") == DRIVER_PATH and member.isfile():
                handle = tar.extractfile(member)
                if handle is not None and handle.read() == own_bytes:
                    return
                break
    raise StageError(f"This driver differs from {DRIVER_PATH} in the reviewed source archive.")


def extract_bootstrap(lifecycle_archive: Path, target: Path) -> Path:
    """Extracts only the stdlib retention helper files from the verified package."""
    wanted = {f"package/{name}": name for name in BOOTSTRAP_FILES}
    found = set()
    with tarfile.open(lifecycle_archive, "r:gz") as tar:
        for member in tar.getmembers():
            name = member.name.removeprefix("./")
            if name not in wanted:
                continue
            if not member.isfile() or member.size > 16 * 1024 * 1024:
                raise StageError(f"Lifecycle archive member {name} is not a regular file.")
            handle = tar.extractfile(member)
            if handle is None:
                raise StageError(f"Cannot read {name} from the lifecycle archive.")
            destination = target / "package" / wanted[name]
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as out:
                shutil.copyfileobj(handle, out)
            found.add(name)
    missing = sorted(set(wanted) - found)
    if missing:
        raise StageError(f"Lifecycle archive is missing the retention helper: {', '.join(missing)}.")
    return target / "package" / "dist" / "release" / "verification-lifecycle.js"


def preflight(cfg: Config, run_id: str, lifecycle_archive: Path) -> int:
    """Retention and disk preflight under the retention lock. Lease is already held."""
    lock_fd = os.open(cfg.runs / RETENTION_LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix="gwrk-lifecycle-") as temporary:
            entry = extract_bootstrap(lifecycle_archive, Path(temporary))
            result = run_cmd(
                [
                    cfg.node, str(entry), "verification-preflight",
                    "--runs-root", str(cfg.runs),
                    "--data-root", str(cfg.data_root),
                    "--run-id", run_id,
                    "--build-bytes", str(cfg.early_build),
                    "--data-bytes", str(cfg.early_data),
                    "--lock-fd", str(lock_fd),
                    "--root-path", cfg.root_path,
                ],
                pass_fds=(*CHILD_LEASES, lock_fd),
                stdin=subprocess.DEVNULL,
                stdout=sys.stderr,
                timeout=PREFLIGHT_TIMEOUT_SECONDS,
                check=False,
            )
        if result.returncode != 0:
            raise StageError("Retention or disk preflight failed. Staging did not start.")
        return lock_fd
    except BaseException:
        os.close(lock_fd)
        raise


# Staging --------------------------------------------------------------------


def stage(args, cfg: Config) -> int:
    global CHILD_LEASES
    run_id = args.run_id
    if not RUN_ID_RE.match(run_id):
        raise StageError("Run ID must be 24 lowercase hex characters.")
    if not COMMIT_SHA_RE.match(args.source_commit):
        raise StageError("Source commit must be 40 lowercase hex characters.")
    if not SHA256_RE.match(args.runtime_manifest_sha256):
        raise StageError("Runtime manifest digest must be 64 lowercase hex characters.")
    if args.purpose not in ("acceptance", "behavioral-red"):
        raise StageError("Purpose must be acceptance or behavioral-red.")
    if cfg.require_root and os.geteuid() != 0:
        raise StageError("Staging must run as root.")

    source_archive = Path(args.source_archive)
    lifecycle_archive = Path(args.lifecycle_archive)
    verify_digest(source_archive, args.source_sha256, "Source")
    verify_digest(lifecycle_archive, args.lifecycle_sha256, "Lifecycle")
    verify_driver(source_archive)
    identity = host_identity(cfg)

    real_directory(cfg.runs)
    if cfg.data_parent_owner:
        expected = cfg.data_parent_owner
        parent_identity = verify_directory_identity(
            cfg.data_parent, int(expected["uid"]), int(expected["gid"]), int(str(expected["mode"]), 8)
        )
    else:
        real_directory(cfg.data_parent)
        parent_identity = {"device": cfg.data_parent.lstat().st_dev, "inode": cfg.data_parent.lstat().st_ino}

    if os.path.lexists(cfg.data_root / run_id):
        raise StageError("Existing fixture data was left untouched. Use a new run ID.")

    run = cfg.runs / run_id
    if os.path.lexists(run):
        real_directory(run)
        previous = read_owner(run, run_id)
        if previous.get("state") not in ("staging", "failed", "executing"):
            raise StageError(f"Run {run_id} is already {previous.get('state')}. Use a new run ID.")
    else:
        make_dir(cfg, run, 0o700)

    lease = take_lease(run, run_id)
    CHILD_LEASES = (lease,)
    try:
        write_owner(run, {
            "schema": 1,
            "runId": run_id,
            "state": "staging",
            "startedAt": now(),
            "purpose": args.purpose,
            "sourceCommit": args.source_commit,
            "sourceSha256": args.source_sha256,
            "runtimeManifestSha256": args.runtime_manifest_sha256,
            "lifecycleSha256": args.lifecycle_sha256,
            "heavy": [payload for payload in HEAVY if payload["root"] != "data-run"],
            "images": [
                {"tag": f"{REPOSITORY}:{run_id}-build"},
                {"tag": f"{REPOSITORY}:{run_id}-flat"},
            ],
        })
        try:
            if not os.path.lexists(cfg.data_root):
                make_dir(cfg, cfg.data_root, 0o700)
            real_directory(cfg.data_root)
            lock_fd = preflight(cfg, run_id, lifecycle_archive)
            try:
                CHILD_LEASES = (lease, lock_fd)
                summary = stage_heavy(cfg, args, run, identity, parent_identity, source_archive)
            finally:
                CHILD_LEASES = (lease,)
                os.close(lock_fd)
        except BaseException as error:
            update_owner(run, run_id, state="failed", completedAt=now(), error=str(error)[:2000])
            raise
        update_owner(run, run_id, state="staged", stagedAt=now())
        print(json.dumps({"ok": True, "runId": run_id, **summary}))
        return 0
    finally:
        CHILD_LEASES = ()
        os.close(lease)


def record_image(run: Path, run_id: str, tag: str, host_id: str) -> None:
    owner = read_owner(run, run_id)
    images = [entry for entry in owner.get("images", []) if entry.get("tag") != tag]
    images.append({"tag": tag, "hostImageId": host_id})
    update_owner(run, run_id, images=sorted(images, key=lambda entry: entry["tag"]))


def stage_heavy(cfg: Config, args, run: Path, identity, parent_identity, source_archive: Path) -> dict:
    run_id = args.run_id
    source_commit = args.source_commit
    manifest_sha = args.runtime_manifest_sha256
    input_dir = run / "input"
    fixtures_dir = input_dir / "fixtures"
    bundle_dir = input_dir / "bundle"
    legacy_dir = input_dir / "legacy-source"
    repo_dir = run / "repo"
    build_dir = run / "build-context"
    data_child = cfg.data_root / run_id
    labels = [f"{MANAGED_LABEL}=verification", f"{RUN_LABEL}={run_id}"]

    if os.path.lexists(data_child):
        raise StageError("Existing fixture data was left untouched. Use a new run ID.")
    if any(os.path.lexists(path) for path in (input_dir, repo_dir, build_dir)):
        raise StageError("Existing staging payload was left untouched. Use a new run ID.")

    # 1. Copy and recheck the source only after preflight passed.
    source_tar = run / "source.tar"
    partial = run / ".source.tar.partial"
    with source_archive.open("rb") as source, partial.open("xb") as destination:
        shutil.copyfileobj(source, destination)
    os.chmod(partial, 0o600)
    if sha256_file(partial) != args.source_sha256:
        partial.unlink()
        raise StageError("Source archive changed while it was copied.")
    os.replace(partial, source_tar)

    for directory in (input_dir, repo_dir, build_dir):
        make_dir(cfg, directory, 0o700)
    for directory in (fixtures_dir, bundle_dir, legacy_dir):
        make_dir(cfg, directory, 0o755)
    data_child.mkdir(mode=0o700, exist_ok=False)
    child_identity = make_dir(cfg, data_child, 0o700)
    marker = read_owner(run, run_id)
    update_owner(run, run_id, heavy=[*marker["heavy"], {"root": "data-run"}], dataChildIdentity=child_identity)

    # 2. Extract the source safely.
    for target in (repo_dir, build_dir):
        with tarfile.open(source_tar, "r:*") as tar:
            for member in tar.getmembers():
                if member.issym() or member.islnk() or ".." in Path(member.name).parts or member.name.startswith("/"):
                    raise StageError(f"Unsafe member in source.tar: {member.name}")
            tar.extractall(target, filter="data")

    git_env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "gwrk verification",
        "GIT_AUTHOR_EMAIL": "verification@gwrk.invalid",
        "GIT_COMMITTER_NAME": "gwrk verification",
        "GIT_COMMITTER_EMAIL": "verification@gwrk.invalid",
        "GIT_TERMINAL_PROMPT": "0",
    }
    run_cmd(["git", "init", "--quiet"], cwd=repo_dir, env=git_env)
    run_cmd(["git", "add", "-A"], cwd=repo_dir, env=git_env)
    run_cmd(["git", "commit", "--quiet", "--no-gpg-sign", "-m", f"Staged tree for {source_commit}"], cwd=repo_dir, env=git_env)

    manifest_probe = [
        cfg.node, "--input-type=module", "-e",
        "import { computeRuntimeManifest } from './tests/hosted-pilot/native-evidence/runtime-manifest.mjs';"
        "const res = await computeRuntimeManifest(process.cwd());"
        "process.stdout.write(res.manifestSha256);",
    ]
    if run_cmd(manifest_probe, cwd=repo_dir).stdout.strip() != manifest_sha:
        raise StageError("Runtime manifest digest of the staged source does not match.")

    # 3. Fixture scripts.
    script_manifest = {}
    for entry in sorted((repo_dir / "tests" / "hosted-pilot" / "fixtures").iterdir(), key=lambda p: p.name):
        if entry.is_file() and is_allowed_fixture_script_name(entry.name):
            destination = fixtures_dir / entry.name
            shutil.copy2(entry, destination)
            own(cfg, destination, 0o755 if entry.name.endswith(".sh") else 0o644)
            script_manifest[entry.name] = sha256_file(destination)
    if len(script_manifest) != 23:
        raise StageError(f"Expected 23 fixture scripts, staged {len(script_manifest)}.")
    script_manifest_path = input_dir / "script-manifest.json"
    script_manifest_path.write_text(json.dumps(script_manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    own(cfg, script_manifest_path, 0o600)

    # 4. Gateway bundle and 5. legacy source.
    for name, mode in BUNDLE_FILES:
        source = repo_dir / "deploy" / "hosted-pilot" / name
        if not source.is_file():
            raise StageError(f"Source archive is missing deploy/hosted-pilot/{name}")
        destination = bundle_dir / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        own(cfg, destination, mode)
    for directory, _, _ in os.walk(bundle_dir):
        own(cfg, Path(directory), 0o755)
    for name in LEGACY_SOURCE_FILES:
        source = repo_dir / name
        if not source.is_file():
            raise StageError(f"Source archive is missing {name}")
        destination = legacy_dir / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    for directory, _, files in os.walk(legacy_dir):
        own(cfg, Path(directory), 0o755)
        for name in files:
            if cfg.require_root:
                os.chown(Path(directory) / name, cfg.uid, cfg.gid, follow_symlinks=False)

    # 6. Build the owned verification image.
    dockerfile = run / "NodeArtifact.Dockerfile"
    dockerfile.write_text(NODE_ARTIFACT_DOCKERFILE, encoding="utf-8")
    own(cfg, dockerfile, 0o600)
    build_tag = f"{REPOSITORY}:{run_id}-build"
    flat_tag = f"{REPOSITORY}:{run_id}-flat"
    label_args = [arg for label in labels for arg in ("--label", label)]
    run_cmd(["docker", "build", "--platform", "linux/amd64", "--pull=false", *label_args,
             "-f", str(dockerfile), "-t", build_tag, str(build_dir)])
    shutil.rmtree(build_dir, ignore_errors=True)
    build_dir.mkdir(mode=0o700, exist_ok=True)
    original_info = inspect_image(build_tag)
    record_image(run, run_id, build_tag, original_info["Id"])
    if original_info["Architecture"] != "amd64" or original_info["Os"] != "linux":
        raise StageError("Built image is not linux/amd64.")

    # 7. Flatten to one layer and compare /app/dist.
    source_container = f"gwrk-verification-flatten-src-{run_id}"
    flat_container = f"gwrk-verification-flatten-dst-{run_id}"
    for name in (source_container, flat_container):
        run_cmd(["docker", "rm", "-f", name], timeout=120, check=False)
    export_tar = run / "original-rootfs.tar"
    flat_export_tar = run / "flattened-rootfs.tar"
    run_cmd(["docker", "create", "--name", source_container, *label_args, "--network", "none",
             "--read-only", "--entrypoint", "/bin/true", build_tag])
    try:
        run_cmd(["docker", "cp", f"{source_container}:/app/node_modules", str(repo_dir / "node_modules")])
        run_cmd(["docker", "cp", f"{source_container}:/app/dist", str(repo_dir / "dist")])
        if run_cmd(manifest_probe, cwd=repo_dir).stdout.strip() != manifest_sha:
            raise StageError("Runtime manifest changed after copying node_modules and dist.")
        run_cmd(["docker", "export", "-o", str(export_tar), source_container])
        original_hashes = extract_app_dist_hashes(export_tar)
        original_export_bytes = export_tar.stat().st_size
        original_export_sha256 = sha256_file(export_tar)
        config = original_info["Config"]
        import_args = ["docker", "import"]
        for env_entry in config.get("Env") or []:
            import_args += ["--change", f"ENV {env_entry}"]
        if config.get("WorkingDir"):
            import_args += ["--change", f"WORKDIR {config['WorkingDir']}"]
        if config.get("Entrypoint"):
            import_args += ["--change", f"ENTRYPOINT {json.dumps(config['Entrypoint'])}"]
        if config.get("Cmd"):
            import_args += ["--change", f"CMD {json.dumps(config['Cmd'])}"]
        import_args += ["--change", f"LABEL {' '.join(labels)}", str(export_tar), flat_tag]
        run_cmd(import_args)
        export_tar.unlink(missing_ok=True)
        run_cmd(["docker", "create", "--name", flat_container, *label_args, "--network", "none",
                 "--read-only", "--entrypoint", "/bin/true", flat_tag])
        run_cmd(["docker", "export", "-o", str(flat_export_tar), flat_container])
        flat_hashes = extract_app_dist_hashes(flat_export_tar)
        flat_export_bytes = flat_export_tar.stat().st_size
        flat_export_sha256 = sha256_file(flat_export_tar)
        flat_export_tar.unlink(missing_ok=True)
        if original_hashes != flat_hashes:
            raise StageError("Flattened /app/dist differs from the builder image.")
    finally:
        export_tar.unlink(missing_ok=True)
        flat_export_tar.unlink(missing_ok=True)
        for name in (source_container, flat_container):
            run_cmd(["docker", "rm", "-f", name], timeout=120, check=False)
        # Untag only. Retention reclaims the owned image later if it remains.
        run_cmd(["docker", "image", "rm", build_tag], timeout=300, check=False)

    # 8. Tool checks in the flattened image and the DinD image.
    verify_cmd = (
        "node -v && python3 --version && /usr/bin/docker --version && "
        "/usr/bin/docker compose version && openssl version && "
        "command -v update-ca-certificates git curl bash awk stat date timeout flock && "
        "id -u gwrk-fixture | grep -Fx 10001 && id -u gwrk-client | grep -Fx 10002 && "
        "test -f /app/dist/cli.js && "
        "node --input-type=module -e '"
        "import Database from \"/app/node_modules/better-sqlite3/lib/index.js\";"
        "import { parse, stringify } from \"/app/node_modules/yaml/dist/index.js\";"
        "import { SignJWT } from \"jose\";"
        "const db = new Database(\":memory:\");"
        "db.prepare(\"CREATE TABLE t (x INT)\").run();"
        "db.close();"
        "if (typeof parse !== \"function\" || typeof stringify !== \"function\" || typeof SignJWT !== \"function\") process.exit(1);"
        "console.log(\"MODULES_OK\");"
        "' && "
        "find / -xdev 2>/dev/null | wc -l"
    )
    verify_out = run_cmd(["docker", "run", "--rm", "--network", "none", flat_tag, "bash", "-euc", verify_cmd]).stdout.strip()
    rule = "INPUT -i lo -p tcp -s 127.0.0.1 -d 127.0.0.1 --dport 18790 --tcp-flags SYN,RST,ACK,FIN SYN -j DROP"
    u03_cmd = (
        "command -v sh iptables awk stat sed readlink date timeout id du mkdir chmod cat sleep rm mv && "
        "iptables --version && "
        f"iptables -I {rule.replace('INPUT', 'INPUT 1', 1)} && iptables -C {rule} && iptables -D {rule} && "
        f"set +e; iptables -C {rule} 2>/dev/null; rc=$?; set -e; "
        "test \"$rc\" -eq 1 && "
        "mkdir -p -m 700 /tmp/syn-u03 && "
        "t0=$(awk '{printf \"%.0f\", $1 * 1000}' /proc/uptime) && "
        "( sleep 0.3; printf 'STOP\\n' ) | RUN_ID=0123456789abcdef01234567 CONTAINER_LABEL=gwrk.fixture.run=0123456789abcdef01234567 "
        "SYN_GATE_DIR=/tmp/syn-u03 HOST_NETNS_INODE=1 OUTER_NETNS_INODE=2 timeout 3 sh /input/fixtures/syn-gate-helper.sh && "
        "t1=$(awk '{printf \"%.0f\", $1 * 1000}' /proc/uptime) && "
        "test $((t1 - t0)) -ge 200 && "
        "rm -rf /tmp/syn-u03 && "
        "echo IPTABLES_AND_HELPER_OK"
    )
    u03_out = run_cmd([
        "docker", "run", "--rm", "--network", "none", "--cap-add", "NET_ADMIN",
        "--mount", f"type=bind,source={input_dir},target=/input,readonly",
        "--entrypoint", "sh", DIND_PIN, "-euc", u03_cmd,
    ]).stdout.strip()

    # 9. Preload archive. Host IDs and archive config IDs differ; record both.
    dind_info = inspect_image(DIND_PIN)
    node_info = inspect_image(flat_tag)
    record_image(run, run_id, flat_tag, node_info["Id"])
    if len(node_info["RootFS"]["Layers"]) != 1:
        raise StageError("Flattened image must have one layer.")
    roles = [
        ("node", node_info, True),
        ("traefik", inspect_image(TRAEFIK_PIN), False),
        ("proxy", inspect_image(PROXY_PIN), False),
        ("nginx", inspect_image(NGINX_PIN), False),
        ("issuerNode", inspect_image(NODE20_PIN), False),
    ]
    preload_tar = input_dir / "preload-images.tar"
    preload_tar.unlink(missing_ok=True)
    run_cmd(["docker", "save", "-o", str(preload_tar), *[info["Id"] for _, info, _ in roles]])
    own(cfg, preload_tar, 0o600)
    archive_sha256 = sha256_file(preload_tar)
    archive_bytes = preload_tar.stat().st_size

    loaded_ids, loaded_rootfs, provenance, storage, chains = {}, {}, {}, [], {}
    with tarfile.open(preload_tar, "r") as tar:
        for entry in json.load(tar.extractfile("manifest.json")):
            config_raw = tar.extractfile(entry["Config"]).read()
            diff_ids = json.loads(config_raw)["rootfs"]["diff_ids"]
            matches = [role for role in roles if role[1]["RootFS"]["Layers"] == diff_ids]
            if len(matches) != 1:
                raise StageError(f"Preload archive config {entry['Config']} matches {len(matches)} roles.")
            role, info, is_app = matches[0]
            config_id = "sha256:" + hashlib.sha256(config_raw).hexdigest()
            loaded_ids[role] = config_id
            loaded_rootfs[role] = diff_ids
            provenance[role] = {
                "hostImageId": info["Id"],
                "archiveConfig": entry["Config"],
                "loadedImageId": config_id,
                "hostRootfsMatched": True,
            }
            sizes, cumulative_list, cumulative, chain = [], [], 0, []
            for layer_path in entry["Layers"]:
                raw_layer = tar.extractfile(layer_path)
                header = raw_layer.read(2)
                raw_layer.seek(0)
                if header == b"\x1f\x8b":
                    size = 0
                    with gzip.GzipFile(fileobj=raw_layer) as gz:
                        for chunk in iter(lambda: gz.read(1024 * 1024), b""):
                            size += len(chunk)
                else:
                    size = tar.getmember(layer_path).size
                sizes.append(size)
                cumulative += size
                chain.append(layer_path)
                chains["|".join(chain)] = cumulative
                cumulative_list.append(cumulative)
            storage.append({
                "role": role,
                "application": is_app,
                "layerUncompressedTarBytes": sizes,
                "cumulativeVfsLayerBytes": cumulative_list,
                "writableCopyBaselineBytes": cumulative,
            })
    if set(loaded_ids) != {"node", "traefik", "proxy", "nginx", "issuerNode"}:
        raise StageError(f"Preload roles mismatch: {sorted(loaded_ids)}")
    loaded_path = input_dir / "loaded-images.json"
    loaded_path.write_text(json.dumps({**loaded_ids, "rootfs": loaded_rootfs, "provenance": provenance}, indent=2) + "\n", encoding="utf-8")
    own(cfg, loaded_path, 0o600)

    # 10. Late budget. Root floor 8 GiB and data estimate plus 4 GiB stay unchanged.
    unique_layer_bytes = sum(chains.values())
    writable_bytes = sum(d["writableCopyBaselineBytes"] * (4 if d["application"] else 1) for d in storage)
    transient_bytes = 2 * archive_bytes
    headroom_bytes = 2 * GIB
    estimated_data_bytes = unique_layer_bytes + writable_bytes + transient_bytes + headroom_bytes
    root_stat = os.statvfs(cfg.root_path)
    data_stat = os.statvfs(cfg.data_root)
    root_avail = root_stat.f_bavail * root_stat.f_frsize
    data_avail = data_stat.f_bavail * data_stat.f_frsize
    if estimated_data_bytes > cfg.data_budget:
        raise StageError(f"Data estimate {estimated_data_bytes} exceeds the budget {cfg.data_budget}.")
    if data_avail < estimated_data_bytes + DATA_HEADROOM_BYTES:
        raise StageError(f"Data free space {data_avail} is below the estimate plus 4 GiB.")
    if root_avail < ROOT_FLOOR_BYTES:
        raise StageError(f"Root free space {root_avail} is below 8 GiB.")

    # Durable receipts live outside the removable payload class.
    hashes_path = run / "app-dist-sha256.json"
    hashes_path.write_text(json.dumps(flat_hashes, indent=2) + "\n", encoding="utf-8")
    own(cfg, hashes_path, 0o600)
    host = identity or {"awsAccount": None, "awsInstance": None}
    receipts = {
        "flattening-receipt.json": {
            "runId": run_id,
            "sourceCommit": source_commit,
            "runtimeManifestSha256": manifest_sha,
            "originalImageId": original_info["Id"],
            "originalExportBytes": original_export_bytes,
            "originalExportSha256": original_export_sha256,
            "flattenedHostImageId": node_info["Id"],
            "flattenedArchiveConfigImageId": loaded_ids["node"],
            "flattenedRootFS": node_info["RootFS"],
            "flattenedExportBytes": flat_export_bytes,
            "flattenedExportSha256": flat_export_sha256,
            "appDistFilesVerified": len(flat_hashes),
            "appDistHashesSha256": sha256_file(hashes_path),
        },
        "storage-checkpoint.json": {
            "runId": run_id,
            **host,
            "platform": "linux/amd64",
            "sourceCommit": source_commit,
            "runtimeManifestSha256": manifest_sha,
            "nodeHostImageId": node_info["Id"],
            "nodeLoadedImageId": loaded_ids["node"],
            "nodeFlattenedExportBytes": flat_export_bytes,
            "archiveBytes": archive_bytes,
            "archiveSha256": archive_sha256,
            "images": storage,
            "uniqueCumulativeLayerBytes": unique_layer_bytes,
            "containerWritableBaselinesBytes": writable_bytes,
            "archiveAndTransientBytes": transient_bytes,
            "runtimeAndMetadataHeadroomBytes": headroom_bytes,
            "estimatedDataBytes": estimated_data_bytes,
            "dataBudgetBytes": cfg.data_budget,
            "backingAvailableBytes": data_avail,
            "rootAvailableBytes": root_avail,
            "verifyOutput": verify_out,
            "u03DindVerifyOutput": u03_out,
        },
        "execution-checkpoint.json": {
            "runId": run_id,
            **host,
            "approvedPrivilegedExecution": True,
            "purpose": args.purpose,
            "reviewedSource": args.purpose == "acceptance",
            "verificationMode": "gateway-matrix",
            "approvedPassiveNetRaw": True,
            "approvedScenarioBSynGate": True,
            "outerImage": DIND_PIN,
            "daemonImageId": dind_info["Id"],
            "nodeImageId": loaded_ids["node"],
            "nodeHostImageId": node_info["Id"],
            "applicationArtifactIdentity": f"gwrk-node-{source_commit}",
            "applicationArtifactSha256": loaded_ids["node"].replace("sha256:", ""),
            "sourceCommit": source_commit,
            "runtimeManifestSha256": manifest_sha,
            "archiveSha256": archive_sha256,
            "scriptManifestSha256": sha256_file(script_manifest_path),
            "estimatedDataBytes": estimated_data_bytes,
            "dataBudgetBytes": cfg.data_budget,
            "backingAvailableBytes": data_avail,
            "rootAvailableBytes": root_avail,
            "dataParentDevice": parent_identity["device"],
            "dataParentInode": parent_identity["inode"],
            "dataChildIdentity": {"device": child_identity["device"], "inode": child_identity["inode"]},
        },
    }
    for name, body in receipts.items():
        path = run / name
        path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
        own(cfg, path, 0o600)
    return {
        "nodeHostImageId": node_info["Id"],
        "nodeLoadedImageId": loaded_ids["node"],
        "estimatedDataBytes": estimated_data_bytes,
        "checkpointPath": str(run / "execution-checkpoint.json"),
    }


# Proof execution ------------------------------------------------------------


def proof_disk_preflight(cfg: Config, run: Path, owner: dict) -> None:
    checkpoint = run / "storage-checkpoint.json"
    if not stat.S_ISREG(checkpoint.lstat().st_mode):
        raise StageError("Proof storage checkpoint must be a regular file.")
    record = json.loads(checkpoint.read_text(encoding="utf-8"))
    if (record.get("runId") != run.name or record.get("sourceCommit") != owner.get("sourceCommit") or
            record.get("runtimeManifestSha256") != owner.get("runtimeManifestSha256") or
            not COMMIT_SHA_RE.fullmatch(str(record.get("sourceCommit", ""))) or
            not SHA256_RE.fullmatch(str(record.get("runtimeManifestSha256", "")))):
        raise StageError("Proof storage checkpoint does not match the owned source identity.")
    estimate = record.get("estimatedDataBytes")
    if type(estimate) is not int or estimate < 0 or estimate > cfg.data_budget:
        raise StageError("Proof data estimate is invalid or exceeds the configured data budget.")
    root = real_directory(Path(cfg.root_path))
    data = real_directory(cfg.data_root)
    root_stat, data_stat = os.statvfs(root), os.statvfs(data)
    root_available = root_stat.f_bavail * root_stat.f_frsize
    data_available = data_stat.f_bavail * data_stat.f_frsize
    if root.stat().st_dev == data.stat().st_dev:
        required = estimate + max(ROOT_FLOOR_BYTES, DATA_HEADROOM_BYTES)
        if root_available < required:
            raise StageError("Proof disk space is below the data estimate plus 8 GiB on the shared filesystem.")
    elif root_available < ROOT_FLOOR_BYTES or data_available < estimate + DATA_HEADROOM_BYTES:
        raise StageError("Proof disk space is below 8 GiB root or the data estimate plus 4 GiB.")


def execute(args, cfg: Config) -> int:
    run_id = args.run_id
    if not RUN_ID_RE.match(run_id):
        raise StageError("Run ID must be 24 lowercase hex characters.")
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        raise StageError("exec needs a proof command after --.")
    real_directory(cfg.runs)
    run = real_directory(cfg.runs / run_id)
    lease = take_lease(run, run_id)
    lock_fd = None
    try:
        lock_fd = os.open(cfg.runs / RETENTION_LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        if not stat.S_ISREG(os.fstat(lock_fd).st_mode):
            raise StageError("Retention lock is not a regular file.")
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        owner = read_owner(run, run_id)
        if owner.get("state") != "staged":
            raise StageError(f"Run {run_id} is {owner.get('state')}, not staged.")
        proof_disk_preflight(cfg, run, owner)
        update_owner(run, run_id, state="executing", executingAt=now())
        try:
            # The child inherits the lease, so it stays held even if this driver dies.
            result = run_cmd(command, pass_fds=(lease, lock_fd), stdout=None, stderr=None, check=False).returncode
            code = result if result >= 0 else 128 - result
        except BaseException as error:
            update_owner(run, run_id, state="failed", completedAt=now(), error=str(error)[:2000])
            raise
        update_owner(run, run_id, state="completed" if code == 0 else "failed", completedAt=now(), exitCode=code)
        return code
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
        os.close(lease)


def parse(argv):
    parser = argparse.ArgumentParser(prog="stage-native-proof.py")
    commands = parser.add_subparsers(dest="command", required=True)
    stage_parser = commands.add_parser("stage")
    for flag in (
        "--config", "--run-id", "--source-archive", "--source-sha256", "--source-commit",
        "--runtime-manifest-sha256", "--purpose", "--lifecycle-archive", "--lifecycle-sha256",
    ):
        stage_parser.add_argument(flag, required=True)
    exec_parser = commands.add_parser("exec")
    exec_parser.add_argument("--config", required=True)
    exec_parser.add_argument("--run-id", required=True)
    exec_parser.add_argument("command", nargs=argparse.REMAINDER)
    return parser.parse_args(argv)


def main(argv) -> int:
    args = parse(argv)
    try:
        cfg = Config(args.config)
        return stage(args, cfg) if args.command == "stage" else execute(args, cfg)
    except (StageError, OSError, subprocess.SubprocessError, tarfile.TarError, KeyError, ValueError) as error:
        detail = getattr(error, "stderr", None)
        print(f"stage-native-proof: {error}", file=sys.stderr)
        if detail:
            print(str(detail)[-4000:], file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

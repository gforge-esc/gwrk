#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
umask 022

fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ $# == 2 || $# == 3 ]] || fail "Usage: install-release.sh TARBALL MANIFEST [RELEASE_ROOT]"
archive=$(realpath -e -- "$1")
manifest=$(realpath -e -- "$2")
checksum=$(realpath -e -- "$1.sha256")
release_root=$(realpath -m -- "${3:-/opt/gwrk}")
[[ "$release_root" != / ]] || fail "Choose a dedicated release root."
[[ "$(uname -s)" == Linux ]] || fail "The release installer requires Linux."
[[ "$(pnpm --version)" == 9.15.9 ]] || fail "Install pnpm 9.15.9 before deploying this release."

# Copy the assets once so concurrent downloads cannot change what gets installed.
mkdir -p -- "$release_root/releases"
exec 9>"$release_root/.install.lock"
flock -x 9
staging=$(mktemp -d "$release_root/releases/.install.XXXXXXXX")
trap 'rm -rf -- "$staging"' EXIT
cp -- "$archive" "$staging/package.tgz"
cp -- "$manifest" "$staging/release-manifest.json"
cp -- "$checksum" "$staging/package.sha256"

version=$(node --input-type=module - "$staging" "$(basename -- "$1")" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [, , staging, filename] = process.argv;
const read = (name) => readFileSync(join(staging, name));
const manifest = JSON.parse(read("release-manifest.json"));
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
if (typeof manifest.version !== "string" || !version.test(manifest.version)) {
  throw new Error("Invalid release version.");
}
if (manifest.platform !== "linux" || manifest.arch !== process.arch ||
    manifest.nodeAbi !== process.versions.modules ||
    Number(process.versions.node.split(".")[0]) < 22) {
  throw new Error("Release runtime does not match this Linux host and Node.js ABI.");
}
const digest = createHash("sha256").update(read("package.tgz")).digest("hex");
if (manifest.tarballSha256 !== digest ||
    read("package.sha256").toString("utf8") !== `${digest}  ${filename}\n`) {
  throw new Error("Release archive checksum mismatch.");
}
process.stdout.write(manifest.version);
NODE
)

# Permit regular files and directories in the package tree.
LC_ALL=C tar --quoting-style=escape -tvzf "$staging/package.tgz" > "$staging/archive.types"
awk 'substr($0, 1, 1) != "-" && substr($0, 1, 1) != "d" { exit 1 }' "$staging/archive.types" ||
  fail "Release archive contains a link or special file."
LC_ALL=C tar --quoting-style=escape -tzf "$staging/package.tgz" > "$staging/archive.paths"
while IFS= read -r path; do
  case "$path" in
    package/deploy/linux-runner/.env.example) ;;
    *\\*|*//*|*/./*|*/../*|*/.|*/..|*/.gwrk/*|*/.ssh/*|*/.gemini/*|*/.claude/*|*/.codex/*|*/.env|*/.env.*|*/.gwrkrc.local.json)
      fail "Release archive contains a forbidden path."
      ;;
    package/|package/package.json|package/LICENSE|package/README.md|package/pnpm-lock.yaml|package/dist/*|package/deploy/|package/deploy/linux-runner/|package/deploy/linux-runner/install-release.sh|package/deploy/linux-runner/rollback-release.sh|package/deploy/linux-runner/README.md|package/deploy/linux-runner/credentials.sh|package/deploy/linux-runner/gwrk-runner.service|package/deploy/linux-runner/live-pilot-record.example.md|package/deploy/linux-runner/preflight.sh|package/deploy/linux-runner/run.sh)
      ;;
    *) fail "Release archive contains an unexpected path." ;;
  esac
done < "$staging/archive.paths"

release="$release_root/releases/$version"
staged_release="$staging/release"
current="$release_root/current"
previous="$release_root/previous"
for pointer in "$current" "$previous"; do
  [[ ! -e "$pointer" || -L "$pointer" ]] || fail "Release pointer must be a symlink."
done

if [[ -e "$release" || -L "$release" ]]; then
  [[ ! -L "$release" ]] && cmp -s -- "$release/release-manifest.json" "$staging/release-manifest.json" ||
    fail "Release $version already exists with different provenance."
  staged_release="$release"
else
  mkdir -- "$staged_release"
  tar -xzf "$staging/package.tgz" --no-same-owner --no-same-permissions --keep-old-files \
    --strip-components=1 -C "$staged_release"
  (
    cd "$staged_release"
    node --input-type=module - "$version" "$staging/release-manifest.json" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [, , expectedVersion, manifestFile] = process.argv;
const manifest = JSON.parse(readFileSync(manifestFile));
const { name, version } = JSON.parse(readFileSync("package.json"));
const lock = createHash("sha256").update(readFileSync("pnpm-lock.yaml")).digest("hex");
if (name !== "@gwrk/cli" || version !== expectedVersion || lock !== manifest.lockfileSha256) {
  throw new Error("Release package or frozen lockfile does not match the manifest.");
}
NODE
    pnpm install --prod --frozen-lockfile --ignore-scripts
    pnpm rebuild better-sqlite3
    cp -- "$staging/release-manifest.json" .
  )
fi

(
  cd "$staged_release"
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { verifyInstalledRelease } from "./dist/adapters/release/inventory.js";

await verifyInstalledRelease(".");
const db = new Database(":memory:");
try {
  assert.equal(db.prepare("SELECT 1 AS verified").get().verified, 1);
} finally {
  db.close();
}
NODE
  [[ "$(node dist/cli.js --version)" == "$version" ]] || fail "CLI version verification failed."
)

old_target=""
if [[ -L "$current" ]]; then
  old_target=$(readlink -- "$current")
  [[ "$old_target" =~ ^releases/[a-zA-Z0-9.+-]+$ && -d "$release_root/$old_target" ]] ||
    fail "Current release pointer is invalid."
fi

new_target="releases/$version"
if [[ "$staged_release" != "$release" ]]; then
  mv -T -- "$staged_release" "$release"
fi
if [[ "$old_target" != "$new_target" ]]; then
  if [[ -n "$old_target" ]]; then
    ln -s -- "$old_target" "$staging/previous"
    mv -Tf -- "$staging/previous" "$previous"
  fi
  ln -s -- "$new_target" "$staging/current"
  mv -Tf -- "$staging/current" "$current"
fi
printf 'Installed gwrk %s at %s\n' "$version" "$current"

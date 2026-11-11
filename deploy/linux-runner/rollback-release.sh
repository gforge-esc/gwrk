#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
umask 022
fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ $# -ge 2 && $# -le 3 ]] || fail "Usage: rollback-release.sh RELEASE_ROOT STATE_DIR [TARGET_VERSION]"
[[ "$(uname -s)" == Linux ]] || fail "Rollback requires Linux."
release_root=$(realpath -e -- "$1")
state=$(realpath -e -- "$2")
runtime=$(realpath -e -- "${GWRK_RUNTIME_DIR:?Set GWRK_RUNTIME_DIR to the service runtime directory.}")
unit="${GWRK_SYSTEMD_UNIT:-gwrk-runner.service}"
[[ "$unit" =~ ^[a-zA-Z0-9@_.-]+\.service$ ]] || fail "Choose a valid systemd service name."
export GWRK_HOME="$state" GWRK_DB_PATH="$state/gwrk.db" GWRK_RUNTIME_DIR="$runtime"

exec 8>"$release_root/.install.lock"
flock -x 8
current="$release_root/current"
previous="$release_root/previous"
[[ -L "$current" ]] || fail "Current release pointer is missing."
[[ ! -e "$previous" || -L "$previous" ]] || fail "Previous release pointer must be a symlink."
old_target=$(readlink -- "$current")
old_previous=""
if [[ -L "$previous" ]]; then old_previous=$(readlink -- "$previous"); fi
if [[ $# == 3 ]]; then new_target="releases/$3"; else new_target="$old_previous"; fi
for release in "$old_target" "$new_target"; do
  [[ "$release" =~ ^releases/[a-zA-Z0-9.+-]+$ &&
     -d "$release_root/$release" && ! -L "$release_root/$release" ]] ||
    fail "Release pointer does not refer to an installed version."
done
[[ "$old_target" != "$new_target" ]] || fail "The requested release is already active."
[[ ! -e "$state/.restore-pending" ]] || fail "Complete the unfinished ledger restore before rollback."

active="$release_root/$old_target"
target="$release_root/$new_target"
check_rollback() {
  node "$active/dist/cli.js" db rollback-check --current "$active" --target "$target"
}
check_rollback

scratch=$(mktemp -d "$release_root/.rollback.XXXXXXXX")
switched=false
stopped=false
lock_held=false
point() {
  ln -s -- "$1" "$scratch/pointer"
  mv -Tf -- "$scratch/pointer" "$2"
}
on_exit() {
  status=$?
  if $lock_held; then flock -u 9; fi
  if ((status != 0)); then
    if $switched; then
      point "$old_target" "$current" || true
      if [[ -n "$old_previous" ]]; then
        point "$old_previous" "$previous" || true
      else
        rm -f -- "$previous"
      fi
    fi
    if $stopped; then systemctl start "$unit" || true; fi
  fi
  rm -rf -- "$scratch"
}
trap on_exit EXIT

systemctl stop "$unit"
stopped=true
[[ -f "$runtime/server.lock" && ! -L "$runtime/server.lock" ]] ||
  fail "Preserve the service runtime directory and lock file across stop."
exec 9<>"$runtime/server.lock"
flock -xn 9 || fail "Another process holds the server runtime lock."
lock_held=true
[[ ! -e "$state/.restore-pending" ]] || fail "Complete the unfinished ledger restore before rollback."
check_rollback
backup="$state/backups/rollback-$(date -u +%Y%m%dT%H%M%SZ)-$$"
node "$active/dist/cli.js" db backup --out "$backup"
point "$new_target" "$current"
switched=true
point "$old_target" "$previous"
flock -u 9
lock_held=false
systemctl start "$unit"
systemctl is-active --quiet "$unit"
printf 'Activated gwrk %s. Verified pre-rollback backup at %s\n' "${new_target#releases/}" "$backup"

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
readable_files=(dist/cli.js deploy/linux-runner/credentials.sh)
startup_scripts=(deploy/linux-runner/preflight.sh deploy/linux-runner/run.sh)
for file in "${readable_files[@]}"; do
  [[ -f "$target/$file" && -r "$target/$file" ]] ||
    fail "Rollback target requires a readable regular file: $target/$file"
done
for file in "${startup_scripts[@]}"; do
  [[ -f "$target/$file" && -x "$target/$file" ]] ||
    fail "Rollback target requires an executable regular file: $target/$file"
done
service_user=$(systemctl show --property=User --value "$unit")
service_group=$(systemctl show --property=Group --value "$unit")
[[ -n "$service_user" && -n "$service_group" ]] || fail "Set User and Group on $unit before rollback."
as_service=(runuser -u "$service_user" -g "$service_group" --)
for file in "${readable_files[@]}" "${startup_scripts[@]}"; do
  "${as_service[@]}" test -r "$target/$file" ||
    fail "$service_user cannot read rollback target file: $target/$file"
done
for file in "${startup_scripts[@]}"; do
  "${as_service[@]}" test -x "$target/$file" ||
    fail "$service_user cannot execute rollback target file: $target/$file"
  interpreter=$("${as_service[@]}" head -n 1 -- "$target/$file") ||
    fail "Could not read the rollback target interpreter: $target/$file"
  [[ "$interpreter" == '#!/usr/bin/env bash' ]] ||
    fail "Rollback target uses an unsupported interpreter: $target/$file"
done
for file in deploy/linux-runner/credentials.sh "${startup_scripts[@]}"; do
  "${as_service[@]}" /usr/bin/env bash -n -- "$target/$file" ||
    fail "Rollback target script failed syntax validation: $target/$file"
done

read_unit_environment() {
  node --input-type=module - "$unit" "$service_user" "$service_group" <<'NODE'
import { execFileSync } from "node:child_process";

const [unit, user, group] = process.argv.slice(2);
const manager = "org.freedesktop.systemd1";
const root = "/org/freedesktop/systemd1";
const bus = (...args) => execFileSync("busctl", [
  "--system", "--json=short", "--no-pager", "--allow-interactive-authorization=no",
  "--timeout=5s", ...args,
], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 6000 });

try {
  const [unitPath] = JSON.parse(bus("call", manager, root, manager + ".Manager", "GetUnit", "s", unit)).data;
  const properties = bus(
    "get-property", manager, unitPath, manager + ".Service",
    "Environment", "EnvironmentFiles", "PassEnvironment", "UnsetEnvironment",
  ).trim().split("\n").map((line) => JSON.parse(line).data);
  const [environment, files, pass, unset] = properties;
  const pathVariables = new Set([
    "HOME", "GWRK_HOME", "GWRK_DIR", "GWRK_DB_PATH", "GWRK_RUNTIME_DIR", "GWRK_RELEASE_ROOT",
  ]);
  const affectsPath = (entry) => pathVariables.has(entry.split("=", 1)[0]);
  // Let the manager apply environment-file syntax and precedence.
  execFileSync("systemd-run", [
    "--system", "--pipe", "--wait", "--collect", "--quiet", "--no-ask-password",
    "--property=RuntimeMaxSec=10s",
    "--uid=" + user, "--gid=" + group,
    ...environment.filter(affectsPath).map((entry) => "--setenv=" + entry),
    ...files.map(([file, optional]) => "--property=EnvironmentFile=" + (optional ? "-" : "") + file),
    ...pass.filter(affectsPath).map((name) => "--property=PassEnvironment=" + name),
    ...unset.filter(affectsPath).map((entry) => "--property=UnsetEnvironment=" + JSON.stringify(entry)),
    "--", "/usr/bin/env", "-0",
  ], { stdio: ["ignore", "inherit", "ignore"], timeout: 15000 });
} catch {
  console.error("Could not read the loaded systemd environment for " + unit + ".");
  process.exitCode = 1;
}
NODE
}

resolve_service_paths() {
  timeout --kill-after=5s 15s "${as_service[@]}" node --input-type=module -e '
    import { readFileSync, realpathSync } from "node:fs";
    import { homedir } from "node:os";
    import { isAbsolute, join } from "node:path";
    import { pathToFileURL } from "node:url";

    const [active, state, runtime, releaseRoot, source] = process.argv.slice(1);
    try {
      const { resolveGwrkPaths } = await import(pathToFileURL(join(active, "dist/domain/gwrk-paths.js")).href);
      const env = Object.create(null);
      for (const entry of readFileSync(0, "utf8").split("\0")) {
        const separator = entry.indexOf("=");
        if (separator > 0) env[entry.slice(0, separator)] = entry.slice(separator + 1);
      }
      delete process.env.HOME;
      const paths = resolveGwrkPaths(env, env.HOME || homedir());
      function verify(label, path, expected) {
        if (!path || !isAbsolute(path) || realpathSync(path) !== expected) {
          throw new Error(label + " mismatch. Expected " + expected + ".");
        }
      }
      verify("release root", env.GWRK_RELEASE_ROOT, releaseRoot);
      verify("ledger", paths.database, join(state, "gwrk.db"));
      verify("state directory", paths.home, state);
      if (env.GWRK_DIR) verify("state directory", env.GWRK_DIR, state);
      verify("runtime", paths.runtimeDir, runtime);
    } catch (error) {
      console.error("Could not verify paths for " + source + ": " + error.message);
      process.exitCode = 1;
    }
  ' "$active" "$state" "$runtime" "$release_root" "$1"
}

verify_running_paths() {
  cat -- "/proc/$1/environ" | resolve_service_paths "running unit $unit"
}

verify_running_release() {
  local pid="$1" release="$2"
  local -a args
  mapfile -d '' -t args < <(cat -- "/proc/$pid/cmdline")
  [[ "${args[0]:-}" == node || "${args[0]:-}" == */node ]] &&
    [[ "${args[1]:-}" == "$release/dist/cli.js" &&
       "${args[2]:-}" == server && "${args[3]:-}" == start &&
       "${args[4]:-}" == --foreground ]] &&
    [[ "$(realpath -e -- "${args[1]}")" == "$release/dist/cli.js" ]]
}

read_unit_environment | resolve_service_paths "loaded unit $unit"
original_state=$(systemctl show --property=ActiveState --value "$unit") ||
  fail "Could not read the service state for $unit before rollback."
main_pid=$(systemctl show --property=MainPID --value "$unit") ||
  fail "Could not read MainPID for $unit before rollback."
case "$main_pid" in
  0)
    case "$original_state" in
      active|reloading|refreshing) fail "Running unit $unit has no MainPID." ;;
    esac
    ;;
  *)
    [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] || fail "Invalid MainPID for $unit."
    verify_running_paths "$main_pid"
    verify_running_release "$main_pid" "$active" ||
      fail "The running service does not match the current release: $active"
    ;;
esac
ledger_service=("${as_service[@]}" env GWRK_HOME="$state" GWRK_DIR="$state"
  GWRK_DB_PATH="$state/gwrk.db" GWRK_RUNTIME_DIR="$runtime")
check_rollback() {
  # Older CLIs reject this flag instead of inferring digests from the current manifest.
  "${ledger_service[@]}" node "$active/dist/cli.js" db rollback-check --require-ledger-digests \
    --current "$active" --target "$target" "$@"
}
compatibility=$(check_rollback --format json)
verified_version=$(node -e '
  const result = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  if (result.allowed !== true || typeof result.targetVersion !== "string") process.exit(1);
  process.stdout.write(result.targetVersion);
' <<< "$compatibility") || fail "Could not read the verified rollback target version."
[[ "$verified_version" == "${new_target#releases/}" ]] ||
  fail "Rollback target manifest version $verified_version does not match $new_target."
cli_version=$(timeout --kill-after=5s 15s "${as_service[@]}" node "$target/dist/cli.js" --version </dev/null 2>/dev/null) ||
  fail "Rollback target CLI could not start as $service_user: $target/dist/cli.js"
[[ "$cli_version" == "$verified_version" ]] ||
  fail "Rollback target CLI version does not match verified release $verified_version."
[[ "$(realpath -e -- "$target/dist/cli.js")" == "$target/dist/cli.js" ]] ||
  fail "Rollback target CLI must resolve within the selected release: $target/dist/cli.js"
launch_command=$(timeout --kill-after=5s 15s "${as_service[@]}" env -i PATH="$PATH" \
  "$target/deploy/linux-runner/run.sh" --print-launch-command </dev/null 2>/dev/null) ||
  fail "Rollback target launcher could not prove release identity: $target"
[[ "$launch_command" == "$(printf '%s\n' node "$target/dist/cli.js" server start --foreground)" ]] ||
  fail "Rollback target launcher does not run the selected release: $target"
timeout --kill-after=5s 15s "${as_service[@]}" node -e '
  const { createRequire } = require("node:module");
  const Database = createRequire(process.argv[1])("better-sqlite3");
  const database = new Database(":memory:");
  database.close();
' "$target/package.json" </dev/null >/dev/null 2>&1 ||
  fail "Rollback target SQLite could not open as $service_user: $target"

[[ -f "$state/.gwrk.db.lock" && ! -L "$state/.gwrk.db.lock" ]] ||
  fail "The installed service ledger lock is missing: $state/.gwrk.db.lock"

scratch=$(mktemp -d "$release_root/.rollback.XXXXXXXX")
recover_pointers=false
stop_attempted=false
lock_held=false
ledger_lock_held=false
target_started=false
point() {
  ln -sfn -- "$1" "$scratch/pointer"
  mv -Tf -- "$scratch/pointer" "$2"
}
on_exit() {
  local status=$? current_state
  trap '' TERM INT
  if $ledger_lock_held; then flock -u 7; fi
  if $lock_held; then flock -u 9; fi
  if ((status != 0)); then
    if $recover_pointers; then
      if $target_started && ! systemctl stop "$unit"; then
        printf 'Could not stop the target release. Current still points to %s.\n' "$new_target" >&2
      else
        point "$old_target" "$current" || true
        if [[ -n "$old_previous" ]]; then
          point "$old_previous" "$previous" || true
        else
          rm -f -- "$previous"
        fi
      fi
    fi
    if $target_started; then
      printf 'Verify the ledger and recover from %s before starting the service.\n' "$backup" >&2
    elif $stop_attempted; then
      case "$original_state" in
        active|reloading|refreshing)
          if current_state=$(systemctl show --property=ActiveState --value "$unit"); then
            case "$current_state" in
              inactive|failed|deactivating)
                systemctl start "$unit" ||
                  printf 'Could not restart the original release for %s.\n' "$unit" >&2
                ;;
            esac
          else
            printf 'Could not read the service state for %s during recovery.\n' "$unit" >&2
          fi
          ;;
      esac
    fi
  fi
  rm -rf -- "$scratch"
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

original_state=$(systemctl show --property=ActiveState --value "$unit") ||
  fail "Could not read the service state for $unit before stop."
[[ "$(systemctl show --property=MainPID --value "$unit")" == "$main_pid" ]] ||
  fail "MainPID changed for $unit during rollback verification."
stop_attempted=true
systemctl stop "$unit"
[[ -f "$runtime/server.lock" && ! -L "$runtime/server.lock" ]] ||
  fail "Preserve the service runtime directory and lock file across stop."
exec 9<>"$runtime/server.lock"
flock -xn 9 || fail "Another process holds the server runtime lock."
lock_held=true
[[ -f "$state/.gwrk.db.lock" && ! -L "$state/.gwrk.db.lock" ]] ||
  fail "Preserve the service ledger lock file across stop."
exec 7<>"$state/.gwrk.db.lock"
flock -xn 7 || fail "Another process holds the ledger lock."
ledger_lock_held=true
[[ ! -e "$state/.restore-pending" ]] || fail "Complete the unfinished ledger restore before rollback."
check_rollback
backup_root="$state/backups"
"${as_service[@]}" test -x "$state" || fail "$service_user cannot traverse $state."
# Earlier operator rollbacks could create this directory as root.
if [[ -d "$backup_root" && ! -L "$backup_root" && "$(stat -c %u -- "$backup_root")" == 0 ]]; then
  chown -h -- "$service_user:$service_group" "$backup_root"
fi
"${as_service[@]}" mkdir -p -m 0700 -- "$backup_root"
"${as_service[@]}" test -w "$backup_root" && "${as_service[@]}" test -x "$backup_root" ||
  fail "$service_user cannot write backups in $backup_root."
backup="$backup_root/rollback-$(date -u +%Y%m%dT%H%M%SZ)-$$"
"${ledger_service[@]}" node "$active/dist/cli.js" db backup --out "$backup"
recover_pointers=true
point "$new_target" "$current"
point "$old_target" "$previous"
flock -u 7
ledger_lock_held=false
flock -u 9
lock_held=false
target_started=true
systemctl start "$unit"
runner_ready() {
  local pid="$1"
  [[ "$pid" =~ ^[1-9][0-9]+$ &&
     -f "$runtime/server.pid" && ! -L "$runtime/server.pid" &&
     "$(< "$runtime/server.pid")" == "$pid" ]] &&
    kill -0 "$pid" &&
    timeout 5s systemctl is-active --quiet "$unit"
}
deadline=$((SECONDS + 90))
while true; do
  pid=$(timeout 5s systemctl show --property=MainPID --value "$unit") || pid=""
  if runner_ready "$pid"; then
    break
  fi
  ((SECONDS < deadline)) || fail "Timed out waiting for the target release to listen."
  sleep 1
done
[[ "$pid" != "$main_pid" ]] || fail "The service did not start a new process."
verify_running_paths "$pid"
verify_running_release "$pid" "$target" ||
  fail "The restarted service did not run the selected release."
check_rollback --against "$backup"
[[ "$(timeout 5s systemctl show --property=MainPID --value "$unit")" == "$pid" ]] &&
  runner_ready "$pid" || fail "The restarted service changed during ledger comparison."
recover_pointers=false
printf 'Activated gwrk %s. Verified pre-rollback backup at %s\n' "${new_target#releases/}" "$backup"

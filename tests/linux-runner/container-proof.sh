#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -Eeuo pipefail
trap 'printf "Container proof stopped at line %s.\n" "$LINENO" >&2' ERR
npm install -g pnpm@9.15.9 --no-fund --no-audit
cd /artifacts
version=$(node -p 'require("./release-manifest.json").version')
archive="/artifacts/gwrk-$version.tgz"
bash ./install-release.sh "$archive" /artifacts/release-manifest.json /opt/gwrk
release=/opt/gwrk/current

groupadd gwrk
useradd -g gwrk -d /var/lib/gwrk gwrk
mkdir -p /var/lib/gwrk/repos/pilot /run/gwrk /etc/gwrk/secrets /fixture-bin
chown -R gwrk:gwrk /var/lib/gwrk /run/gwrk
chmod 0750 /var/lib/gwrk
chgrp gwrk /etc/gwrk/secrets
chmod 0750 /etc/gwrk/secrets

export HOME=/var/lib/gwrk GWRK_HOME=/var/lib/gwrk GWRK_RUNTIME_DIR=/run/gwrk
export GWRK_RELEASE_ROOT=/opt/gwrk GWRK_SECRETS_DIR=/etc/gwrk/secrets
export GWRK_LISTEN_HOST=127.0.0.1 GWRK_LISTEN_PORT=18790 GWRK_SLACK_ENABLED=0
export GWRK_PILOT_REPO=/var/lib/gwrk/repos/pilot GWRK_PILOT_REPO_URL=https://github.com/fixture/pilot.git
export GWRK_APPROVED_AGENT=fixture GWRK_AGENT_PROBE=/fixture-bin/agent-probe
printf '%s\n' fixture-git-token > /etc/gwrk/secrets/pilot-git-credential
printf '%s\n' fixture-agent-token > /etc/gwrk/secrets/agent-credential
chgrp gwrk /etc/gwrk/secrets/*
chmod 0640 /etc/gwrk/secrets/*

cat > /fixture-bin/git <<'SCRIPT'
#!/usr/bin/env bash
if [[ "$1" == ls-remote ]]; then
  [[ "$GH_TOKEN" == fixture-git-token && "$GIT_TERMINAL_PROMPT" == 0 ]]
  exit
fi
exec /usr/bin/git "$@"
SCRIPT
cat > /fixture-bin/gh <<'SCRIPT'
#!/usr/bin/env bash
printf '[]\n'
SCRIPT
cat > /fixture-bin/agent-probe <<'SCRIPT'
#!/usr/bin/env bash
[[ "$1" == fixture && "$(< "$GWRK_AGENT_CREDENTIAL_FILE")" == fixture-agent-token ]]
SCRIPT
chmod 0755 /fixture-bin/*
export PATH="/fixture-bin:$PATH"

cd -- "$GWRK_PILOT_REPO"
runuser -u gwrk -- git init --quiet
runuser -u gwrk -- git remote add origin "$GWRK_PILOT_REPO_URL"
cat > .gwrkrc.json <<'JSON'
{
  "project": {"name":"pilot"},
  "server": {"host":"127.0.0.1","port":18790},
  "parallelism": {"local":{"maxCpu":80,"maxMem":80,"minDiskGb":1,"maxClones":1}},
  "agents": {
    "define":"fixture", "implement":"fixture", "fallbackOrder":["fixture"],
    "registry":{"fixture":{"name":"fixture","type":"local-cli","command":"agent-probe","quotaProbe":{"method":"optimistic","cacheTTLMinutes":0},"maxConcurrent":1,"models":[]}}
  }
}
JSON
runuser -u gwrk -- node --input-type=module <<'NODE'
import { closeDb, getDb } from "/opt/gwrk/current/dist/db/index.js";
const db = getDb();
db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run("pilot", "pilot", process.env.GWRK_PILOT_REPO);
db.prepare("INSERT INTO runs (id, feature_id, project_id, command, finished_at) VALUES (?, ?, ?, ?, ?)").run(42, "fixture", "pilot", "ship", "2026-11-11T12:00:00Z");
closeDb();
NODE
preflight="$release/deploy/linux-runner/preflight.sh"
runuser -u gwrk -- bash "$preflight"
expect_rejection() {
  local pattern="$1"
  shift
  if "$@" >/tmp/rejected.log 2>&1; then
    printf 'Unexpected acceptance for %s\n' "$pattern" >&2
    exit 1
  fi
  if ! grep -F -- "$pattern" /tmp/rejected.log; then
    cat /tmp/rejected.log >&2
    return 1
  fi
}
expect_rejection 'Telegram variables' runuser -u gwrk -- env TELEGRAM_BOT_TOKEN=fixture bash "$preflight"
chmod 0644 /etc/gwrk/secrets/agent-credential
expect_rejection 'mode 0640' runuser -u gwrk -- bash "$preflight"
chmod 0640 /etc/gwrk/secrets/agent-credential
printf '%s\n' revoked > /etc/gwrk/secrets/pilot-git-credential
expect_rejection 'Pilot Git authentication failed' runuser -u gwrk -- bash "$preflight"
printf '%s\n' fixture-git-token > /etc/gwrk/secrets/pilot-git-credential
printf '%s\n' revoked > /etc/gwrk/secrets/agent-credential
expect_rejection 'bounded headless credential probe' runuser -u gwrk -- bash "$preflight"
printf '%s\n' fixture-agent-token > /etc/gwrk/secrets/agent-credential
sed -i 's/127.0.0.1/0.0.0.0/' .gwrkrc.json
expect_rejection 'private' runuser -u gwrk -- bash "$preflight"
sed -i 's/0.0.0.0/127.0.0.1/' .gwrkrc.json

server_pid=""
trap 'if [[ -n "$server_pid" ]]; then kill -TERM "$server_pid" 2>/dev/null || true; fi' EXIT
launch() {
  printf "Starting the installed runner.\n"
  runuser -u gwrk -- bash "$release/deploy/linux-runner/run.sh" >/tmp/server.log 2>&1 &
  launcher=$!
  for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:18790/health >/dev/null 2>&1; then
      server_pid=$(< /run/gwrk/server.pid)
      printf "Runner healthy (pid %s).\n" "$server_pid"
      return
    fi
    if ! kill -0 "$launcher" 2>/dev/null; then
      cat /tmp/server.log >&2
      return 1
    fi
    sleep 1
  done
  cat /tmp/server.log >&2
  return 1
}
launch
expect_rejection 'already holds' runuser -u gwrk -- bash "$release/deploy/linux-runner/run.sh"
kill -KILL "$server_pid"
wait "$launcher" || true
server_pid=""
launch
kill -TERM "$server_pid"
wait "$launcher" || { cat /tmp/server.log >&2; exit 1; }
server_pid=""
test ! -e /run/gwrk/server.pid

runuser -u gwrk -- node "$release/dist/cli.js" db backup --out /var/lib/gwrk/backup
runuser -u gwrk -- node "$release/dist/cli.js" db restore --from /var/lib/gwrk/backup --state-dir /var/lib/gwrk/restored
cmp /var/lib/gwrk/backup/gwrk.db /var/lib/gwrk/restored/gwrk.db
node -e 'const assert=require("node:assert/strict"); assert.deepEqual(require("/var/lib/gwrk/backup/backup-manifest.json").summary.completedRunIds,[42]);'

prior=/opt/gwrk/releases/1.0.0-fixture
active=$(realpath /opt/gwrk/current)
mkdir "$prior"
cp -R "$active/dist" "$active/deploy" "$active/package.json" "$active/pnpm-lock.yaml" "$active/release-manifest.json" "$prior/"
ln -s "$active/node_modules" "$prior/node_modules"
ln -s releases/1.0.0-fixture /opt/gwrk/previous
node -e 'const fs=require("node:fs"); const p=process.argv[1]; fs.writeFileSync(p,JSON.stringify({...require(p),version:"1.0.0-fixture"}))' "$prior/package.json"

cat > /fixture-bin/systemctl <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
pid_file="$GWRK_RUNTIME_DIR/server.pid"
printf '%s\n' "$1" >> /tmp/supervisor.calls
case "$1" in
  stop)
    if [[ -f "$pid_file" ]]; then
      kill "$(< "$pid_file")" 2>/dev/null || true
      rm "$pid_file"
    fi
    ;;
  start)
    if [[ "${GWRK_FIXTURE_DROP_RUN:-0}" == 1 ]]; then
      runuser -u gwrk -g gwrk -- node -e 'const requireRelease=require("node:module").createRequire("/opt/gwrk/current/package.json"); const db=new (requireRelease("better-sqlite3"))(process.env.GWRK_DB_PATH); db.prepare("DELETE FROM runs WHERE id = 42").run(); db.close();'
    fi
    sleep 120 8>&- 9>&- >/dev/null 2>&1 &
    printf '%s\n' "$!" > "$pid_file"
    ;;
  show)
    case "$2" in
      --property=User) printf 'gwrk\n' ;;
      --property=Group) printf 'gwrk\n' ;;
      --property=MainPID) cat "$pid_file" ;;
      *) exit 1 ;;
    esac
    ;;
  is-active)
    [[ -f "$pid_file" ]] && kill -0 "$(< "$pid_file")"
    ;;
esac
SCRIPT
chmod 0755 /fixture-bin/systemctl
write_prior_manifest() {
  node --input-type=module - "$prior" <<'NODE'
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readReleaseInventory } from "/opt/gwrk/current/dist/adapters/release/inventory.js";
const root = process.argv[2];
const path = join(root, "release-manifest.json");
const manifest = JSON.parse(await readFile(path, "utf8"));
await writeFile(path, JSON.stringify({ ...manifest, version: "1.0.0-fixture", ...await readReleaseInventory(root) }));
NODE
}
write_prior_manifest
rollback="$active/deploy/linux-runner/rollback-release.sh"
current_before=$(readlink /opt/gwrk/current)
previous_before=$(readlink /opt/gwrk/previous)
mv "$prior/dist/cli.js" /tmp/prior-cli.js
: > /tmp/supervisor.calls
expect_rejection 'dist/cli.js' bash "$rollback" /opt/gwrk /var/lib/gwrk
test ! -s /tmp/supervisor.calls
test "$(readlink /opt/gwrk/current)" = "$current_before"
test "$(readlink /opt/gwrk/previous)" = "$previous_before"
mv /tmp/prior-cli.js "$prior/dist/cli.js"

printf 'SELECT 1;\n' > "$prior/dist/db/migrations/999-fixture.sql"
write_prior_manifest
expect_rejection '999-fixture.sql' bash "$rollback" /opt/gwrk /var/lib/gwrk
if grep -Eq '^(stop|start)$' /tmp/supervisor.calls; then
  printf 'Incompatible rollback changed the service state.\n' >&2
  exit 1
fi
test "$(realpath /opt/gwrk/current)" = "$active"
rm "$prior/dist/db/migrations/999-fixture.sql"
write_prior_manifest
mkdir -m 0700 /var/lib/gwrk/backups
runuser -u gwrk -g gwrk -- node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import Database from "/opt/gwrk/current/node_modules/better-sqlite3/lib/index.js";
const db = new Database("/var/lib/gwrk/gwrk.db", { fileMustExist: true });
assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();
NODE
test ! -e /var/lib/gwrk/gwrk.db-wal
test ! -e /var/lib/gwrk/gwrk.db-shm
test "$(id -u)" -eq 0
bash "$rollback" /opt/gwrk /var/lib/gwrk
test "$(realpath /opt/gwrk/current)" = "$prior"
runuser -u gwrk -g gwrk -- node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import Database from "/opt/gwrk/current/node_modules/better-sqlite3/lib/index.js";
const path = "/var/lib/gwrk/gwrk.db";
const db = new Database(path, { fileMustExist: true });
assert.equal(db.prepare("UPDATE runs SET exit_code = 17 WHERE id = 42").run().changes, 1);
db.close();
const reopened = new Database(path, { readonly: true, fileMustExist: true });
assert.equal(reopened.prepare("SELECT exit_code FROM runs WHERE id = 42").pluck().get(), 17);
reopened.close();
NODE
first_backups=(/var/lib/gwrk/backups/rollback-*)
test "${#first_backups[@]}" -eq 1
node -e 'const assert=require("node:assert/strict"); const fs=require("node:fs"); const root="/var/lib/gwrk/backups/"; const [dir]=fs.readdirSync(root); assert.deepEqual(require(root+dir+"/backup-manifest.json").summary.completedRunIds,[42]);'
expect_rejection 'does not match the pre-rollback backup' env GWRK_FIXTURE_DROP_RUN=1 bash "$rollback" /opt/gwrk /var/lib/gwrk
test "$(realpath /opt/gwrk/current)" = "$prior"
test ! -e "$GWRK_RUNTIME_DIR/server.pid"
node -e 'const assert=require("node:assert/strict"); const fs=require("node:fs"); const root="/var/lib/gwrk/backups/"; const dirs=fs.readdirSync(root); assert.equal(dirs.length,2); for(const dir of dirs) assert.deepEqual(require(root+dir+"/backup-manifest.json").summary.completedRunIds,[42]);'
for backup in /var/lib/gwrk/backups/rollback-*; do
  if [[ "$backup" != "${first_backups[0]}" ]]; then
    recovery_backup="$backup"
  fi
done
recovered=/var/lib/gwrk/rollback-recovered
runuser -u gwrk -g gwrk -- node "$release/dist/cli.js" db restore --from "$recovery_backup" --state-dir "$recovered"
test "$(stat -c '%U:%G %a' "$recovery_backup")" = 'gwrk:gwrk 700'
runuser -u gwrk -g gwrk -- cmp "$recovery_backup/gwrk.db" "$recovered/gwrk.db"
printf 'Verified install, credential revocation, process restart, clean restore and guarded rollback.\n'

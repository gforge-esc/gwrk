#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -Eeuo pipefail
export GIT_EDITOR=true EDITOR=true
trap 'printf "Container proof stopped at line %s.\n" "$LINENO" >&2' ERR
npm install -g pnpm@9.15.9 --no-fund --no-audit
cd /artifacts
version=$(node -p 'require("./release-manifest.json").version')
archive="/artifacts/gwrk-$version.tgz"
# No gwrk service exists in the container yet. Declare it so retention does not guess.
GWRK_SYSTEMD_UNIT=none bash ./install-release.sh "$archive" /artifacts/release-manifest.json /opt/gwrk
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
export GWRK_AUTH_MODE=hosted
export GWRK_AUTH_PUBLIC_ORIGIN=https://gwrk.gforge.ai
export GWRK_AUTH_GOOGLE_CLIENT_ID=pilot-client-id.apps.googleusercontent.com
export GWRK_AUTH_GOOGLE_ALLOWLIST_FILE=/etc/gwrk/secrets/google-account-allowlist
export GWRK_AUTH_CSRF_HMAC_FILE=/etc/gwrk/secrets/csrf-hmac-key
printf '%s\n' fixture-git-token > /etc/gwrk/secrets/pilot-git-credential
printf '%s\n' fixture-agent-token > /etc/gwrk/secrets/agent-credential
printf '%s\n' runner-fixture@example.invalid > /etc/gwrk/secrets/google-account-allowlist
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))' > /etc/gwrk/secrets/csrf-hmac-key
chgrp gwrk /etc/gwrk/secrets/*
chmod 0640 /etc/gwrk/secrets/*

cat > /fixture-bin/git <<'SCRIPT'
#!/usr/bin/env bash
if [[ "$*" == "ls-remote --exit-code $GWRK_PILOT_REPO_URL HEAD" ]]; then
  [[ "$GIT_TERMINAL_PROMPT" == 0 ]] || exit 1
  printf '0000000000000000000000000000000000000001\tHEAD\n'
  exit 0
fi
exec /usr/bin/git "$@"
SCRIPT
cat > /fixture-bin/gh <<'SCRIPT'
#!/usr/bin/env bash
set -eu
case "$*" in
  'api --hostname github.com --method GET --silent repos/fixture/pilot/commits?per_page=1')
    [[ "$GH_TOKEN" == fixture-git-token && "$GH_PROMPT_DISABLED" == 1 ]]
    ;;
  'api --hostname github.com --method GET --silent '*) exit 1 ;;
  'pr list --head feat/001-pilot-restart-phase-01 --base develop '*) printf 'null\n' ;;
  'pr create '*|'pr view 1 --json url '*) printf 'https://github.com/fixture/pilot/pull/1\n' ;;
  'pr checks 1 --watch --required --interval 30') printf 'fixture check\tpass\n' ;;
  *) printf '[]\n' ;;
esac
SCRIPT
cat > /fixture-bin/agent-probe <<'SCRIPT'
#!/usr/bin/env bash
[[ "$1" == fixture && "$(< "$GWRK_AGENT_CREDENTIAL_FILE")" == fixture-agent-token ]]
SCRIPT
cat > /fixture-bin/agent-worker <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
cat >/dev/null
[[ "$(< "$GWRK_AGENT_CREDENTIAL_FILE")" == fixture-agent-token ]]
[[ "$2" == specs/001-pilot-restart ]]
if [[ "$1" == review ]]; then exit 0; fi
[[ "$1" == implement ]]
worker="$GWRK_RUNTIME_DIR/fixture-worker"
printf '%s\n' "$$" >> "$worker/started"
for attempt in {1..200}; do
  if [[ -f "$worker/release" ]]; then
    printf 'worker completed\n' > pilot-result.txt
    node /opt/gwrk/current/dist/cli.js tasks done 001-pilot-restart T001
    printf '%s\n' "$$" >> "$worker/completed"
    exit 0
  fi
  sleep 0.1
done
printf 'Timed out waiting for the dispatch proof to release the worker.\n' >&2
exit 1
SCRIPT
chmod 0755 /fixture-bin/*
export PATH="/fixture-bin:$PATH"

plugin=/var/lib/gwrk/plugins/agents/fixture
mkdir -p "$plugin"
cat > "$plugin/manifest.yaml" <<'YAML'
type: agent
name: fixture
version: 1.0.0
description: Synthetic Linux runner worker
adapter: adapter.js
dispatchMode: local-cli
contextFileName: AGENTS.md
capabilities: [stdin]
models: {}
exitCodeMap: {}
YAML
cat > "$plugin/adapter.js" <<'JS'
export default {
  name: "fixture",
  async isAvailable() { return true; },
  async syncGovernance() { return ""; },
  async dispatch(task) {
    return {
      command: "/fixture-bin/agent-worker",
      args: [task.workflow === "gwrk-implement" ? "implement" : "review", task.featureDir],
      stdin: task.stdin ?? "",
    };
  },
  parseResult(stdout, stderr, exitCode) { return { stdout, stderr, exitCode, durationS: 0 }; },
};
JS

cd -- "$GWRK_PILOT_REPO"
runuser -u gwrk -- mkdir /run/gwrk/fixture-worker
runuser -u gwrk -- git init --quiet --initial-branch=develop
runuser -u gwrk -- git remote add origin "$GWRK_PILOT_REPO_URL"
runuser -u gwrk -- git config user.name 'Runner fixture'
runuser -u gwrk -- git config user.email 'runner-fixture@example.invalid'
runuser -u gwrk -- git init --quiet --bare /var/lib/gwrk/repos/pilot-origin.git
runuser -u gwrk -- git config 'url.file:///var/lib/gwrk/repos/pilot-origin.git.insteadOf' "$GWRK_PILOT_REPO_URL"
cat > .gwrkrc.json <<'JSON'
{
  "project": {"name":"pilot","toolchain":{"test":null}},
  "server": {"host":"127.0.0.1","port":18790},
  "parallelism": {"local":{"maxCpu":100,"maxMem":100,"minDiskGb":1,"maxClones":1}},
  "agents": {
    "define":"fixture", "implement":"fixture", "fallbackOrder":["fixture"],
    "registry":{"fixture":{"name":"fixture","type":"local-cli","command":"agent-worker","quotaProbe":{"method":"optimistic","cacheTTLMinutes":0},"maxConcurrent":1,"models":[]}}
  }
}
JSON
feature=specs/001-pilot-restart
mkdir -p "$feature/.gwrk"
printf '.runs/\n' > .gitignore
printf '# Pilot restart\n\nRun one worker after restarting the installed server.\n' > "$feature/spec.md"
printf '# Pilot restart\n\n### Phase 1: Produce the worker result\n' > "$feature/plan.md"
cat > "$feature/.gwrk/tasks.json" <<'JSON'
{
  "featureId": "001-pilot-restart",
  "createdAt": "2026-11-11T12:00:00Z",
  "phases": [{
    "id": "phase-01",
    "title": "Produce the worker result",
    "tasks": [{
      "id": "T001",
      "title": "Write the worker result",
      "description": "Write the result after the release signal.",
      "status": "open",
      "gateScript": "grep -Fx 'worker completed' pilot-result.txt"
    }]
  }]
}
JSON
runuser -u gwrk -- git add .gwrkrc.json .gitignore "$feature"
runuser -u gwrk -- git commit --quiet --no-edit --author='Runner fixture <runner-fixture@example.invalid>' -m 'Add pilot restart feature'
runuser -u gwrk -- git push --quiet --set-upstream origin develop
runuser -u gwrk -- node --input-type=module <<'NODE'
import { closeDb, getDb } from "/opt/gwrk/current/dist/db/index.js";
const db = getDb();
db.prepare(`
  INSERT INTO projects (
    id, name, path, slug, local_root, allowed_runners, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  "pilot",
  "pilot",
  process.env.GWRK_PILOT_REPO,
  "pilot",
  process.env.GWRK_PILOT_REPO,
  '["local","hosted"]',
  "2026-11-24T00:00:00.000Z"
);
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
expect_rejection 'Set GWRK_AUTH_MODE' runuser -u gwrk -- env -u GWRK_AUTH_MODE bash "$preflight"
expect_rejection 'GWRK_AUTH_MODE must be hosted' runuser -u gwrk -- env GWRK_AUTH_MODE=invalid bash "$preflight"
chmod 0644 /etc/gwrk/secrets/google-account-allowlist
expect_rejection 'Auth file must have mode 0640' runuser -u gwrk -- bash "$preflight"
chmod 0640 /etc/gwrk/secrets/google-account-allowlist
chmod 0644 /etc/gwrk/secrets/csrf-hmac-key
expect_rejection 'Auth file must have mode 0640' runuser -u gwrk -- bash "$preflight"
chmod 0640 /etc/gwrk/secrets/csrf-hmac-key
chmod 0644 /etc/gwrk/secrets/agent-credential
expect_rejection 'mode 0640' runuser -u gwrk -- bash "$preflight"
chmod 0640 /etc/gwrk/secrets/agent-credential
runuser -u gwrk -- env -u GH_TOKEN GIT_TERMINAL_PROMPT=0 \
  git ls-remote --exit-code "$GWRK_PILOT_REPO_URL" HEAD | grep -F $'\tHEAD'
printf '%s\n' revoked > /etc/gwrk/secrets/pilot-git-credential
if runuser -u gwrk -- bash "$preflight" >/tmp/revoked-git.log 2>&1; then
  printf 'Preflight accepted a revoked Git credential.\n' >&2
  exit 1
else
  test "$?" -eq 1
fi
grep -F 'Pilot Git authentication failed' /tmp/revoked-git.log
printf '%s\n' fixture-git-token > /etc/gwrk/secrets/pilot-git-credential
runuser -u gwrk -- bash "$preflight"
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
      mapfile -d '' -t runner_argv < "/proc/$server_pid/cmdline"
      test "${runner_argv[1]}" = "$(realpath "$release/dist/cli.js")"
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
runuser -u gwrk -- node "$release/dist/cli.js" db backup --out /var/lib/gwrk/lock-fixture-backup
runuser -u gwrk -- mkdir /var/lib/gwrk/alternate-runtime
ledger_inode=$(stat -c '%i' /var/lib/gwrk/gwrk.db)
for sidecar in /var/lib/gwrk/gwrk.db-wal /var/lib/gwrk/gwrk.db-shm; do
  test -f "$sidecar"
done
stop_hint="Run 'gwrk server stop' before 'gwrk db restore'"
expect_rejection "$stop_hint" runuser -u gwrk -- \
  node "$release/dist/cli.js" db restore --from /var/lib/gwrk/lock-fixture-backup \
  --state-dir /var/lib/gwrk --force
grep -F -- "PID $server_pid" /tmp/rejected.log
grep -F -- '/run/gwrk/server.lock' /tmp/rejected.log
expect_rejection '.gwrk.db.lock' runuser -u gwrk -- \
  env GWRK_RUNTIME_DIR=/var/lib/gwrk/alternate-runtime \
  node "$release/dist/cli.js" db restore --from /var/lib/gwrk/lock-fixture-backup \
  --state-dir /var/lib/gwrk --force
grep -F -- "$stop_hint" /tmp/rejected.log
grep -F -- "PID $server_pid" /tmp/rejected.log
runuser -u gwrk -- cp -R /var/lib/gwrk/lock-fixture-backup /var/lib/gwrk/.restore-pending
expect_rejection '.gwrk.db.lock' runuser -u gwrk -- \
  env GWRK_RUNTIME_DIR=/var/lib/gwrk/alternate-runtime \
  node "$release/dist/cli.js" db restore --from /var/lib/gwrk/lock-fixture-backup \
  --state-dir /var/lib/gwrk
grep -F -- "$stop_hint" /tmp/rejected.log
grep -F -- "PID $server_pid" /tmp/rejected.log
cmp /var/lib/gwrk/lock-fixture-backup/gwrk.db /var/lib/gwrk/.restore-pending/gwrk.db
rm -r -- /var/lib/gwrk/.restore-pending
test "$(stat -c '%i' /var/lib/gwrk/gwrk.db)" = "$ledger_inode"
test -f /var/lib/gwrk/gwrk.db-wal
test -f /var/lib/gwrk/gwrk.db-shm
kill -0 "$server_pid"
kill -KILL "$server_pid"
wait "$launcher" || true
server_pid=""

pilot_secret=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')
pilot_token="gwrk_v1.cred-pilot-key-01.$pilot_secret"
pilot_verifier=$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$pilot_token")

runuser -u gwrk -g gwrk -- node --input-type=module - "$pilot_verifier" <<'NODE'
import Database from "/opt/gwrk/current/node_modules/better-sqlite3/lib/index.js";
const db = new Database("/var/lib/gwrk/gwrk.db", { fileMustExist: true });
db.prepare(`
  INSERT OR REPLACE INTO project_role_bindings (project_id, principal_type, principal_id, role, created_at)
  VALUES ('pilot', 'cli_token', 'cred-pilot-key-01', 'operator', '2026-11-11T12:00:00Z')
`).run();
db.prepare(`
  INSERT OR REPLACE INTO api_credentials (
    credential_id, verifier_sha256, label, issuer, audience_origin,
    created_at, expires_at, revoked_at, revoked_reason, rotated_from_id, overlap_until
  ) VALUES (
    'cred-pilot-key-01',
    ?,
    'pilot-key',
    'local-admin',
    'https://gwrk.gforge.ai',
    '2026-11-11T12:00:00Z',
    '2029-12-11T12:00:00Z',
    null, null, null, null
  )
`).run(process.argv[2]);
db.close();
NODE

launch
printf 'Dispatching the committed pilot feature after SIGKILL restart.\n'
dispatch_run_id=$(node --input-type=module - "$pilot_token" <<'NODE'
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const token = process.argv[2];
const base = "http://127.0.0.1:18790/api/dispatch";
const featureId = "001-pilot-restart";
const phaseId = "phase-01";
const worker = `${process.env.GWRK_RUNTIME_DIR}/fixture-worker`;
const statusUrl = `${base}/${featureId}/${phaseId}?projectId=pilot`;
const request = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(3000) });

// Assert unauthenticated request to /api/dispatch or /api/dispatch/queue returns HTTP 401 in hosted mode
const unauthDispatch = await request(base, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ projectId: "pilot", featureId, phaseId }),
});
assert.equal(unauthDispatch.status, 401, "Unauthenticated /api/dispatch must return HTTP 401 in hosted mode");

const unauthQueue = await request(`${base}/queue?projectId=pilot`);
assert.equal(unauthQueue.status, 401, "Unauthenticated /api/dispatch/queue must return HTTP 401 in hosted mode");

const authHeaders = {
  authorization: `Bearer ${token}`,
};

async function read(url) {
  const response = await request(url, { headers: authHeaders });
  assert.equal(response.status, 200);
  return response.json();
}

const dispatch = (backend) => request(base, {
  method: "POST",
  headers: { "content-type": "application/json", ...authHeaders },
  body: JSON.stringify({ projectId: "pilot", featureId, phaseId, backend }),
});
let response = await dispatch("unapproved-fixture");
if (response.status >= 400 && response.status < 500) {
  const { active, queued } = await read(`${base}/queue?projectId=pilot`);
  assert.deepEqual(active, []);
  assert.deepEqual(queued, []);
  response = await dispatch();
}
assert.equal(response.status, 201);
const receipt = await response.json();
const id = receipt.id ?? receipt.operationId;
assert(id);
if (receipt.backend !== undefined) {
  assert.equal(receipt.backend, "fixture", "The hosted runner must select its approved backend.");
}

const startDeadline = Date.now() + 10_000;
while (!existsSync(`${worker}/started`)) {
  const record = await read(statusUrl);
  assert(["accepted", "leased", "running"].includes(record.status), JSON.stringify(record));
  assert(Date.now() < startDeadline, "The restarted runner did not launch the fixture worker.");
  await delay(50);
}
const { active, queued } = await read(`${base}/queue?projectId=pilot`);
assert.deepEqual(active.map((record) => record.id ?? record.operationId), [id]);
assert.equal(active[0].status, "running");
assert.equal(active[0].backend, "fixture");
assert.deepEqual(queued, []);
const started = readFileSync(`${worker}/started`, "utf8");
assert.match(started, /^\d+\n$/);
const pid = Number(started.trim());
process.kill(pid, 0);
assert(readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").includes("/fixture-bin/agent-worker"));
assert(!existsSync(`${worker}/completed`));
writeFileSync(`${worker}/release`, "");

const finishDeadline = Date.now() + 20_000;
let record = await read(statusUrl);
while (["accepted", "leased", "running", "reconciling"].includes(record.status)) {
  assert(Date.now() < finishDeadline, "The fixture dispatch did not finish after release.");
  await delay(50);
  record = await read(statusUrl);
}
assert.equal(record.id ?? record.operationId, id);
assert.equal(record.status, "completed", JSON.stringify(record));
assert.deepEqual((await read(`${base}/queue?projectId=pilot`)).active, []);
assert.equal(readFileSync(`${worker}/started`, "utf8"), started);
assert.equal(readFileSync(`${worker}/completed`, "utf8"), started);
const Database = (await import("/opt/gwrk/current/node_modules/better-sqlite3/lib/index.js")).default;
const ledgerDb = new Database("/var/lib/gwrk/gwrk.db", { readonly: true, fileMustExist: true });
const latestRun = ledgerDb.prepare("SELECT id, exit_code FROM runs WHERE feature_id = ? AND phase_id = ? ORDER BY id DESC LIMIT 1").get(featureId, phaseId);
ledgerDb.close();
assert(latestRun && Number.isInteger(latestRun.id) && latestRun.id > 42, "Expected completed run in runs table");
assert.equal(latestRun.exit_code, 0);
console.log(latestRun.id);
NODE
) || { cat /tmp/server.log >&2; exit 1; }
printf 'One worker completed dispatch run %s.\n' "$dispatch_run_id"
kill -TERM "$server_pid"
wait "$launcher" || { cat /tmp/server.log >&2; exit 1; }
server_pid=""
test ! -e /run/gwrk/server.pid

runuser -u gwrk -g gwrk -- node --input-type=module <<'NODE'
import Database from "/opt/gwrk/current/node_modules/better-sqlite3/lib/index.js";
const db = new Database("/var/lib/gwrk/gwrk.db", { fileMustExist: true });
db.prepare(`
  INSERT INTO project_role_bindings (project_id, principal_type, principal_id, role, created_at)
  VALUES (?, ?, ?, ?, ?)
`).run("pilot", "google_sub", "google-sub-pilot-01", "operator", "2026-11-11T12:00:00Z");
db.prepare(`
  INSERT INTO api_credentials (
    credential_id, verifier_sha256, label, issuer, audience_origin,
    created_at, expires_at, revoked_at, revoked_reason, rotated_from_id, overlap_until
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  "cred-pilot-restore-02",
  "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
  "pilot-key",
  "https://accounts.google.com:google-sub-pilot-01",
  "https://gwrk.gforge.ai",
  "2026-11-11T12:00:00Z",
  "2026-12-11T12:00:00Z",
  null, null, null, null
);
db.prepare(`
  INSERT INTO google_sessions (
    token_digest_sha256, principal_id, issued_at, expires_at, session_cap_at, revoked_at, revoked_reason
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  "aaaabbbbccccddddeeeeffff1111222233334444555566667777888899990000",
  "google-sub-pilot-01",
  "2026-11-11T12:00:00Z",
  "2026-11-11T13:00:00Z",
  "2026-11-11T13:00:00Z",
  "2026-11-11T12:30:00Z",
  "user_logout"
);
db.prepare(`
  INSERT INTO auth_audit_events (
    occurred_at, event_type, outcome, principal_type, principal_id,
    credential_id, request_id, detail_code, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  "2026-11-11T12:30:00Z",
  "session_revoked",
  "allowed",
  "google_sub",
  "google-sub-pilot-01",
  null,
  "req-pilot-01",
  "user_logout",
  '{"reason":"logout"}'
);
db.close();
NODE
runuser -u gwrk -- node "$release/dist/cli.js" db backup --out /var/lib/gwrk/backup
runuser -u gwrk -- node "$release/dist/cli.js" db restore --from /var/lib/gwrk/backup --state-dir /var/lib/gwrk/restored
cmp /var/lib/gwrk/backup/gwrk.db /var/lib/gwrk/restored/gwrk.db
assert_backup_runs() {
  node --input-type=module - "$dispatch_run_id" "$@" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [runId, ...backups] = process.argv.slice(2);
for (const backup of backups) {
  const manifest = JSON.parse(readFileSync(join(backup, "backup-manifest.json"), "utf8"));
  assert.deepEqual(manifest.summary.completedRunIds, [42, Number(runId)], backup);
}
NODE
}
assert_backup_runs /var/lib/gwrk/backup
runuser -u gwrk -g gwrk -- node --input-type=module - "$dispatch_run_id" <<'NODE'
import assert from "node:assert/strict";
import Database from "/opt/gwrk/current/node_modules/better-sqlite3/lib/index.js";
const db = new Database("/var/lib/gwrk/restored/gwrk.db", { readonly: true, fileMustExist: true });
assert.equal(db.prepare("SELECT path FROM projects WHERE id = ?").pluck().get("pilot"), process.env.GWRK_PILOT_REPO);
assert.deepEqual(db.prepare("SELECT project_id, finished_at FROM runs WHERE id = ?").get(42), {
  project_id: "pilot",
  finished_at: "2026-11-11T12:00:00Z",
});
assert.deepEqual(db.prepare("SELECT feature_id, phase_id, exit_code FROM runs WHERE id = ?").get(Number(process.argv[2])), {
  feature_id: "001-pilot-restart",
  phase_id: "phase-01",
  exit_code: 0,
});
assert.equal(
  db.prepare("SELECT verifier_sha256 FROM api_credentials WHERE credential_id = ?").pluck().get("cred-pilot-restore-02"),
  "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff"
);
assert.equal(
  db.prepare("SELECT revoked_reason FROM google_sessions WHERE token_digest_sha256 = ?").pluck().get("aaaabbbbccccddddeeeeffff1111222233334444555566667777888899990000"),
  "user_logout"
);
assert.equal(
  db.prepare("SELECT event_type FROM auth_audit_events WHERE request_id = ?").pluck().get("req-pilot-01"),
  "session_revoked"
);
assert.equal(
  db.prepare("SELECT role FROM project_role_bindings WHERE principal_id = ?").pluck().get("google-sub-pilot-01"),
  "operator"
);
db.close();
console.log("Clean restore preserved project pilot, completed runs, and migration 020 auth tables.");
NODE

prior=/opt/gwrk/releases/1.0.0-fixture
active=$(realpath /opt/gwrk/current)
mkdir "$prior"
cp -R "$active/dist" "$active/deploy" "$active/package.json" "$active/pnpm-lock.yaml" "$active/release-manifest.json" "$prior/"
ln -s "$active/node_modules" "$prior/node_modules"
ln -s releases/1.0.0-fixture /opt/gwrk/previous
node -e 'const fs=require("node:fs"); const p=process.argv[1]; fs.writeFileSync(p,JSON.stringify({...require(p),version:"1.0.0-fixture"}))' "$prior/package.json"

cat > /fixture-bin/busctl <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
case "$6" in
  call) printf '{"type":"o","data":["/fixture/unit"]}\n' ;;
  get-property)
    printf '%s\n' '{"type":"as","data":["HOME=/var/lib/gwrk"]}' \
      '{"type":"a(sb)","data":[["/etc/gwrk/runner.env",false]]}' \
      '{"type":"as","data":[]}' '{"type":"as","data":[]}'
    ;;
  *) exit 1 ;;
esac
SCRIPT
cat > /fixture-bin/systemd-run <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == *"--property=EnvironmentFile=/etc/gwrk/runner.env"* ]]
printf '%s\0' HOME=/var/lib/gwrk GWRK_HOME=/var/lib/gwrk GWRK_RUNTIME_DIR=/run/gwrk GWRK_RELEASE_ROOT=/opt/gwrk "PATH=$PATH"
SCRIPT
cat > /fixture-bin/cat <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
runtime=/run/gwrk
if [[ "$#" == 2 && "$1" == -- && -f "$runtime/server.pid" &&
      "$2" == "/proc/$(< "$runtime/server.pid")/cmdline" ]]; then
  printf '%s\0' node "$(< "$runtime/started-cli")" server start --foreground
else
  exec /usr/bin/cat "$@"
fi
SCRIPT
cat > /fixture-bin/systemctl <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
runtime=/run/gwrk
pid_file="$runtime/server.pid"
hold_rollback() {
  touch "$runtime/rollback-held"
  while [[ ! -f "$runtime/rollback-resume" ]]; do sleep 0.05; done
}
printf '%s\n' "$1" >> /tmp/supervisor.calls
case "$1" in
  stop)
    if [[ -f "$pid_file" ]]; then
      kill "$(< "$pid_file")" 2>/dev/null || true
      rm "$pid_file"
    fi
    if [[ "${GWRK_FIXTURE_HOLD_ROLLBACK:-}" == stop ]]; then hold_rollback; fi
    ;;
  start)
    readlink /opt/gwrk/current > "$runtime/started-release"
    cli=$(realpath /opt/gwrk/current/dist/cli.js)
    if [[ "${GWRK_FIXTURE_WRONG_CLI:-0}" == 1 ]]; then
      cli=$(realpath /opt/gwrk/previous/dist/cli.js)
    fi
    printf '%s\n' "$cli" > "$runtime/started-cli"
    if [[ "${GWRK_FIXTURE_DROP_RUN:-0}" == 1 ]]; then
      runuser -u gwrk -g gwrk -- node -e 'const requireRelease=require("node:module").createRequire("/opt/gwrk/current/package.json"); const db=new (requireRelease("better-sqlite3"))("/var/lib/gwrk/gwrk.db"); db.prepare("DELETE FROM runs WHERE id = 42").run(); db.close();'
    fi
    env -i HOME=/var/lib/gwrk GWRK_HOME=/var/lib/gwrk GWRK_RUNTIME_DIR=/run/gwrk GWRK_RELEASE_ROOT=/opt/gwrk \
      /usr/bin/bash -c 'printf "%s\n" "$$" > "$GWRK_RUNTIME_DIR/server.pid"; exec /usr/bin/sleep 120' \
      8>&- 9>&- >/dev/null 2>&1 &
    for attempt in {1..100}; do
      if [[ -s "$pid_file" ]]; then exit 0; fi
      sleep 0.05
    done
    exit 1
    ;;
  show)
    case "$2" in
      --property=User) printf 'gwrk\n' ;;
      --property=Group) printf 'gwrk\n' ;;
      --property=ActiveState)
        if [[ -f "$pid_file" ]]; then printf 'active\n'; else printf 'inactive\n'; fi
        ;;
      --property=MainPID)
        if [[ "${GWRK_FIXTURE_HOLD_ROLLBACK:-}" == readiness && -f "$runtime/started-release" ]]; then hold_rollback; fi
        if [[ -f "$pid_file" ]]; then cat "$pid_file"; else printf '0\n'; fi
        ;;
      *) exit 1 ;;
    esac
    ;;
  is-active)
    [[ -f "$pid_file" ]] && kill -0 "$(< "$pid_file")"
    ;;
esac
SCRIPT
chmod 0755 /fixture-bin/{busctl,cat,systemctl,systemd-run}
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

mv "$prior/dist/cli.js" /tmp/prior-cli.js
ln -s "$active/dist/cli.js" "$prior/dist/cli.js"
: > /tmp/supervisor.calls
expect_rejection 'Rollback target CLI version does not match' bash "$rollback" /opt/gwrk /var/lib/gwrk
if grep -Eq '^(stop|start)$' /tmp/supervisor.calls; then
  printf 'Rollback changed the service state before rejecting a mismatched CLI version.\n' >&2
  exit 1
fi
test "$(readlink /opt/gwrk/current)" = "$current_before"
test "$(readlink /opt/gwrk/previous)" = "$previous_before"
mv /tmp/prior-cli.js "$prior/dist/cli.js"

credentials="$prior/deploy/linux-runner/credentials.sh"
credentials_mode=$(stat -c %a "$credentials")
chown root:root "$credentials"
chmod 0600 "$credentials"
: > /tmp/supervisor.calls
expect_rejection "$credentials" bash "$rollback" /opt/gwrk /var/lib/gwrk
if grep -Eq '^(stop|start)$' /tmp/supervisor.calls; then
  printf 'Rollback changed the service state before rejecting unreadable credentials.\n' >&2
  exit 1
fi
test "$(readlink /opt/gwrk/current)" = "$current_before"
test "$(readlink /opt/gwrk/previous)" = "$previous_before"
chmod "$credentials_mode" "$credentials"

startup="$prior/deploy/linux-runner/run.sh"
mv "$startup" /tmp/prior-run.sh
printf '#!/gwrk-fixture-missing-interpreter\nexit 0\n' > "$startup"
chmod 0755 "$startup"
: > /tmp/supervisor.calls
expect_rejection 'Rollback target uses an unsupported interpreter' bash "$rollback" /opt/gwrk /var/lib/gwrk
if grep -Eq '^(stop|start)$' /tmp/supervisor.calls; then
  printf 'Rollback changed the service state before checking the startup interpreter.\n' >&2
  exit 1
fi
test "$(readlink /opt/gwrk/current)" = "$current_before"
test "$(readlink /opt/gwrk/previous)" = "$previous_before"
mv /tmp/prior-run.sh "$startup"

mv "$prior/node_modules" /tmp/prior-node-modules
: > /tmp/supervisor.calls
expect_rejection 'Rollback target CLI could not start' bash "$rollback" /opt/gwrk /var/lib/gwrk
if grep -Eq '^(stop|start)$' /tmp/supervisor.calls; then
  printf 'Rollback stopped the service before rejecting missing dependencies.\n' >&2
  exit 1
fi
test "$(readlink /opt/gwrk/current)" = "$current_before"
test "$(readlink /opt/gwrk/previous)" = "$previous_before"
mv /tmp/prior-node-modules "$prior/node_modules"

mv "$prior/node_modules" /tmp/prior-shared-node-modules
cp -a "$active/node_modules" "$prior/node_modules"
find "$prior/node_modules" -name better_sqlite3.node -type f -delete
: > /tmp/supervisor.calls
expect_rejection 'Rollback target SQLite could not open' bash "$rollback" /opt/gwrk /var/lib/gwrk
if grep -Eq '^(stop|start)$' /tmp/supervisor.calls; then
  printf 'Rollback stopped the service before rejecting a missing SQLite binding.\n' >&2
  exit 1
fi
test "$(readlink /opt/gwrk/current)" = "$current_before"
test "$(readlink /opt/gwrk/previous)" = "$previous_before"
mv "$prior/node_modules" /tmp/prior-without-sqlite
mv /tmp/prior-shared-node-modules "$prior/node_modules"

printf 'SELECT 1;\n' > "$prior/dist/db/migrations/999-fixture.sql"
write_prior_manifest
: > /tmp/supervisor.calls
expect_rejection '999-fixture.sql' bash "$rollback" /opt/gwrk /var/lib/gwrk
if grep -Eq '^(stop|start)$' /tmp/supervisor.calls; then
  printf 'Incompatible rollback changed the service state.\n' >&2
  exit 1
fi
test "$(readlink /opt/gwrk/current)" = "$current_before"
test "$(readlink /opt/gwrk/previous)" = "$previous_before"
printf 'Rejected migration 999-fixture.sql before changing either release pointer.\n'
rm "$prior/dist/db/migrations/999-fixture.sql"
write_prior_manifest

rm "$prior/dist/db/migrations/020-production-auth.sql"
write_prior_manifest
: > /tmp/supervisor.calls
expect_rejection 'Target release is missing applied migration: 020-production-auth.sql' bash "$rollback" /opt/gwrk /var/lib/gwrk
if grep -Eq '^(stop|start)$' /tmp/supervisor.calls; then
  printf 'Incompatible rollback missing migration 020 changed the service state.\n' >&2
  exit 1
fi
test "$(readlink /opt/gwrk/current)" = "$current_before"
test "$(readlink /opt/gwrk/previous)" = "$previous_before"
printf 'Rejected rollback missing migration 020 before changing either release pointer.\n'
cp "$active/dist/db/migrations/020-production-auth.sql" "$prior/dist/db/migrations/020-production-auth.sql"
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
console.log("Service user gwrk committed and read back exit code 17 for run 42 after rollback.");
NODE
first_backups=(/var/lib/gwrk/backups/rollback-*)
test "${#first_backups[@]}" -eq 1
assert_backup_runs "${first_backups[@]}"
expect_rejection 'does not match the pre-rollback backup' env GWRK_FIXTURE_DROP_RUN=1 bash "$rollback" /opt/gwrk /var/lib/gwrk
test "$(realpath /opt/gwrk/current)" = "$prior"
test ! -e "$GWRK_RUNTIME_DIR/server.pid"
rollback_backups=(/var/lib/gwrk/backups/rollback-*)
test "${#rollback_backups[@]}" -eq 2
assert_backup_runs "${rollback_backups[@]}"
for backup in /var/lib/gwrk/backups/rollback-*; do
  if [[ "$backup" != "${first_backups[0]}" ]]; then
    recovery_backup="$backup"
  fi
done
recovered=/var/lib/gwrk/rollback-recovered
runuser -u gwrk -g gwrk -- node "$release/dist/cli.js" db restore --from "$recovery_backup" --state-dir "$recovered"
test "$(stat -c '%U:%G %a' "$recovery_backup")" = 'gwrk:gwrk 700'
runuser -u gwrk -g gwrk -- cmp "$recovery_backup/gwrk.db" "$recovered/gwrk.db"

wrong_cli_current=$(readlink /opt/gwrk/current)
wrong_cli_previous=$(readlink /opt/gwrk/previous)
: > /tmp/supervisor.calls
expect_rejection 'The restarted service did not run the selected release' \
  env GWRK_FIXTURE_WRONG_CLI=1 bash "$rollback" /opt/gwrk /var/lib/gwrk
test "$(readlink /opt/gwrk/current)" = "$wrong_cli_current"
test "$(readlink /opt/gwrk/previous)" = "$wrong_cli_previous"
test "$(grep -E '^(stop|start)$' /tmp/supervisor.calls)" = $'stop\nstart\nstop'
test ! -e "$GWRK_RUNTIME_DIR/server.pid"

for scenario in readiness:SIGTERM readiness:SIGINT stop:SIGTERM stop:SIGINT; do
  stage=${scenario%:*}
  signal=${scenario#*:}
  case "$signal" in
    SIGTERM) expected_status=143 ;;
    SIGINT) expected_status=130 ;;
  esac
  signal_current=$(readlink /opt/gwrk/current)
  signal_previous=$(readlink /opt/gwrk/previous)
  if [[ "$stage" == stop ]] && ! systemctl is-active --quiet gwrk-runner.service; then
    systemctl start gwrk-runner.service
  fi
  rm -f "$GWRK_RUNTIME_DIR/"{rollback-held,rollback-resume,started-release}
  : > /tmp/supervisor.calls
  rollback_pid=$(timeout 30s node --input-type=module - "$rollback" "$signal" "$expected_status" "$stage" "$signal_current" "$signal_previous" <<'NODE'
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [script, signal, expectedStatus, stage, original, target] = process.argv.slice(2);
const runtime = process.env.GWRK_RUNTIME_DIR;
const child = spawn("bash", [script, "/opt/gwrk", "/var/lib/gwrk"], {
  env: { ...process.env, GWRK_FIXTURE_HOLD_ROLLBACK: stage },
  stdio: ["ignore", 2, 2],
});
const exited = once(child, "exit");
try {
  const deadline = Date.now() + 15_000;
  while (!existsSync(join(runtime, "rollback-held"))) {
    assert.equal(child.exitCode, null);
    assert(Date.now() < deadline, `Rollback did not reach ${stage}`);
    await delay(25);
  }
  assert.equal(existsSync(join(runtime, "server.pid")), stage === "readiness");
  assert.equal(readlinkSync("/opt/gwrk/current"), stage === "readiness" ? target : original);
  assert.equal(readlinkSync("/opt/gwrk/previous"), stage === "readiness" ? original : target);
  assert(child.kill(signal));
  writeFileSync(join(runtime, "rollback-resume"), "");
  assert.deepEqual(await exited, [Number(expectedStatus), null]);
  console.log(child.pid);
} finally {
  writeFileSync(join(runtime, "rollback-resume"), "");
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
NODE
  )
  test "$(readlink /opt/gwrk/current)" = "$signal_current"
  test "$(readlink /opt/gwrk/previous)" = "$signal_previous"
  signal_backups=(/var/lib/gwrk/backups/rollback-*-"$rollback_pid")
  if [[ "$stage" == stop ]]; then
    test "$(grep -E '^(stop|start)$' /tmp/supervisor.calls)" = $'stop\nstart'
    systemctl is-active --quiet gwrk-runner.service
    test "$(< "$GWRK_RUNTIME_DIR/started-release")" = "$signal_current"
    test ! -e "${signal_backups[0]}"
    continue
  fi
  test "$(grep -E '^(stop|start)$' /tmp/supervisor.calls)" = $'stop\nstart\nstop'
  test ! -e "$GWRK_RUNTIME_DIR/server.pid"
  test "${#signal_backups[@]}" -eq 1
  runuser -u gwrk -g gwrk -- node "$release/dist/cli.js" db restore \
    --from "${signal_backups[0]}" --state-dir "/var/lib/gwrk/recovered-$signal"
done
systemctl stop gwrk-runner.service
printf 'Verified install, credential revocation, process restart, clean restore and guarded rollback.\n'

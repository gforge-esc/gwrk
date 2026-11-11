#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
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
  grep -F -- "$pattern" /tmp/rejected.log
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
  runuser -u gwrk -- bash "$release/deploy/linux-runner/run.sh" >/tmp/server.log 2>&1 &
  launcher=$!
  for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:18790/health >/dev/null 2>&1; then
      server_pid=$(< /run/gwrk/server.pid)
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
wait "$launcher"
server_pid=""
test ! -e /run/gwrk/server.pid

runuser -u gwrk -- node "$release/dist/cli.js" db backup --out /var/lib/gwrk/backup
runuser -u gwrk -- node "$release/dist/cli.js" db restore --from /var/lib/gwrk/backup --state-dir /var/lib/gwrk/restored
cmp /var/lib/gwrk/backup/gwrk.db /var/lib/gwrk/restored/gwrk.db
node -e 'const assert=require("node:assert/strict"); assert.deepEqual(require("/var/lib/gwrk/backup/backup-manifest.json").summary.completedRunIds,[42]);'

printf 'Verified release install, credential revocation, duplicate start, process restart and clean restore.\n'

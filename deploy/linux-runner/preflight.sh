#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/credentials.sh"

[[ "$(uname -s)" == Linux && "$(id -u)" != 0 && "$(id -un)" == gwrk && "$(id -gn)" == gwrk ]] ||
  fail "Run preflight as the dedicated Linux gwrk user and group."
[[ -w "${GWRK_HOME:?Set GWRK_HOME.}" && -w "${GWRK_RUNTIME_DIR:?Set GWRK_RUNTIME_DIR.}" ]] ||
  fail "The gwrk user needs write access to the state and runtime directories."
[[ -n "${GWRK_RELEASE_ROOT:-}" && -n "${GWRK_SECRETS_DIR:-}" && -n "${GWRK_PILOT_REPO:-}" ]] ||
  fail "Set the release, secrets and pilot repository paths."
[[ "${GWRK_PILOT_REPO_URL:-}" =~ ^https://github\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]] ||
  fail "Set a credential-free HTTPS GitHub repository URL."
[[ "${GWRK_APPROVED_AGENT:-}" =~ ^[a-z][a-z0-9-]*$ ]] ||
  fail "Set the approved agent plugin ID."
probe=${GWRK_AGENT_PROBE:?Set GWRK_AGENT_PROBE.}
[[ "$probe" == /* && -f "$probe" && ! -L "$probe" && -x "$probe" &&
   "$(stat -c '%u' -- "$probe")" == 0 ]] || fail "Install a root-owned headless agent probe."
probe_mode=$(stat -c '%a' -- "$probe")
(( (8#$probe_mode & 8#022) == 0 )) || fail "The headless agent probe must be read-only to the service user."

for command in node git gh flock timeout; do
  command -v "$command" >/dev/null || fail "Install $command before starting the runner."
done
load_runner_credentials

node --input-type=module - <<'NODE'
import { realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const env = process.env;
try {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22 or newer is required.");
  const releaseRoot = realpathSync(env.GWRK_RELEASE_ROOT);
  const active = realpathSync(join(releaseRoot, "current"));
  const stateRoot = realpathSync(env.GWRK_HOME);
  const runtimeRoot = realpathSync(env.GWRK_RUNTIME_DIR);
  const secretsRoot = realpathSync(env.GWRK_SECRETS_DIR);
  const repo = realpathSync(env.GWRK_PILOT_REPO);
  const isInside = (root, path) => {
    const rel = relative(root, path);
    return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../");
  };
  if (!isInside(join(releaseRoot, "releases"), active) || !isInside(join(stateRoot, "repos"), repo)) {
    throw new Error("Keep the active release and pilot checkout under their configured roots.");
  }
  if ((env.GWRK_DIR && realpathSync(env.GWRK_DIR) !== stateRoot) ||
      (env.GWRK_DB_PATH && env.GWRK_DB_PATH !== join(stateRoot, "gwrk.db"))) {
    throw new Error("Keep the execution ledger in the configured state directory.");
  }
  const fromRelease = (path) => pathToFileURL(join(active, "dist", path)).href;
  const { validateRunnerLayout } = await import(fromRelease("domain/release-packaging.js"));
  const { loadConfig } = await import(fromRelease("utils/config.js"));
  const config = loadConfig(repo);
  const names = ["pilot-git-credential", "agent-credential"];
  if (env.GWRK_SLACK_ENABLED === "1") names.push("slack-bot-token", "slack-app-token");
  const layout = validateRunnerLayout({
    releaseRoot, stateRoot, runtimeRoot, secretsRoot,
    listenHost: config.server.host,
    listenPort: config.server.port,
    telegramEnabled: Boolean(env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_CHAT_ID),
    credentialPaths: names.map(name => realpathSync(join(secretsRoot, name))),
  }, ["/root", "/home", "/Users"]);
  if (!layout.ok) throw new Error(layout.errors.join("\n"));
  if (config.server.host !== env.GWRK_LISTEN_HOST || config.server.port !== Number(env.GWRK_LISTEN_PORT)) {
    throw new Error("Match the private bind in the project config and runner environment.");
  }
  const approved = env.GWRK_APPROVED_AGENT;
  const registry = config.agents.registry ?? {};
  const candidates = [config.agents.define, config.agents.implement, ...Object.keys(registry), ...(config.agents.fallbackOrder ?? [])];
  if (candidates.some(candidate => candidate !== approved) ||
      config.agents.fallbackOrder?.length !== 1 || registry[approved]?.type !== "local-cli" || registry[approved]?.maxConcurrent !== 1 ||
      config.parallelism.local.maxClones !== 1) {
    throw new Error("Configure one approved local agent backend and one worker.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
NODE

cd -- "$GWRK_PILOT_REPO"
origin=$(git config --get remote.origin.url) || fail "Set the pilot checkout origin."
[[ "$origin" == "$GWRK_PILOT_REPO_URL" ]] || fail "Pilot checkout origin does not match the approved repository."
timeout --kill-after=2s 20s git ls-remote --exit-code "$GWRK_PILOT_REPO_URL" HEAD >/dev/null 2>&1 ||
  fail "Pilot Git authentication failed. Refresh the scoped credential."
timeout --kill-after=2s 30s "$probe" "$GWRK_APPROVED_AGENT" >/dev/null 2>&1 ||
  fail "The approved agent failed its bounded headless credential probe."
printf 'Linux runner preflight passed.\n'

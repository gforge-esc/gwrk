/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { readReleaseInventory } from "../../src/adapters/release/inventory.js";
import { restoreLedgerBackup } from "../../src/adapters/sqlite/ledger-backup.js";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const rollback = join(repo, "deploy/linux-runner/rollback-release.sh");
const serviceScripts = ["credentials.sh", "preflight.sh", "run.sh"] as const;

it.each([
  { signal: "SIGTERM", status: 143, stage: "readiness" },
  { signal: "SIGINT", status: 130, stage: "readiness" },
  { signal: "SIGTERM", status: 143, stage: "initial stop" },
  { signal: "SIGINT", status: 130, stage: "initial stop" },
  { signal: null, status: 1, stage: "backup with an inactive unit" },
  { signal: null, status: 1, stage: "target CLI version mismatch" },
  { signal: null, status: 1, stage: "target manifest version mismatch" },
  { signal: null, status: 1, stage: "service ledger mismatch" },
  { signal: null, status: 1, stage: "service runtime mismatch" },
  { signal: null, status: 1, stage: "running service ledger mismatch" },
  { signal: null, status: 1, stage: "service release root mismatch" },
  { signal: null, status: 1, stage: "running service release root mismatch" },
  {
    signal: null,
    status: 1,
    stage: "invalid target interpreter",
    malformedFile: "run.sh",
  },
  ...serviceScripts.map((malformedFile) => ({
    signal: null,
    status: 1,
    stage: `invalid target ${malformedFile}`,
    malformedFile,
  })),
] as const)(
  "preserves release state during $stage (exit $status)",
  async (scenario) => {
    const { signal, status, stage } = scenario;
    const malformedFile =
      "malformedFile" in scenario ? scenario.malformedFile : undefined;
    const root = await mkdtemp(join(tmpdir(), "gwrk-rollback-signal-"));
    const bin = join(root, "bin");
    const runtime = join(root, "runtime");
    const state = join(root, "state");
    const current = join(root, "current");
    const previous = join(root, "previous");
    const active = "releases/1.1.0";
    const target = "releases/1.0.0";
    const ledger = join(state, "gwrk.db");
    const serviceLedger = join(state, "service.db");
    const serviceRuntime = join(root, "other runtime");
    const pathMismatch =
      stage.startsWith("service ") || stage.startsWith("running service ");
    const running = Boolean(signal || malformedFile || pathMismatch);
    const pidFile = join(runtime, "server.pid");
    const ready = join(runtime, "checking-readiness");
    const releaseReadiness = join(runtime, "release-readiness");
    const calls = join(runtime, "supervisor.calls");

    try {
      await mkdir(bin);
      await mkdir(runtime);
      await mkdir(state);
      await mkdir(join(root, "other release root"));
      await writeFile(join(runtime, "server.lock"), "");
      if (running) {
        await writeFile(pidFile, String(process.pid));
      }
      await symlink(active, current);
      await symlink(target, previous);
      for (const version of [active, target]) {
        const release = join(root, version);
        const service = join(release, "deploy/linux-runner");
        await mkdir(service, { recursive: true });
        await mkdir(join(release, "dist"));
        await symlink(
          join(repo, "node_modules"),
          join(release, "node_modules"),
        );
        await writeFile(join(release, "package.json"), '{"type":"module"}');
        await symlink(join(repo, "dist/cli.js"), join(release, "dist/cli.js"));
        await mkdir(join(release, "dist/domain"));
        await symlink(
          join(repo, "dist/domain/gwrk-paths.js"),
          join(release, "dist/domain/gwrk-paths.js"),
        );
        for (const name of serviceScripts) {
          await writeFile(join(service, name), "#!/usr/bin/env bash\n", {
            mode: 0o755,
          });
        }
      }
      const malformedPath = malformedFile
        ? join(root, target, "deploy/linux-runner", malformedFile)
        : undefined;
      if (malformedPath) {
        const body =
          stage === "invalid target interpreter"
            ? "#!/gwrk-fixture-missing-interpreter\nexit 0\n"
            : "#!/usr/bin/env bash\nif then\n";
        await writeFile(malformedPath, body);
      }
      const db = new Database(ledger);
      try {
        db.exec(`
        CREATE TABLE _migrations (name TEXT PRIMARY KEY);
        CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT);
        CREATE TABLE runs (id INTEGER PRIMARY KEY, finished_at TEXT);
        CREATE TABLE compression (id INTEGER PRIMARY KEY);
        CREATE TABLE history (id INTEGER PRIMARY KEY);
        INSERT INTO runs VALUES (42, '2026-11-11T12:00:00Z');
      `);
      } finally {
        db.close();
      }

      if (pathMismatch) {
        await mkdir(serviceRuntime);
        const service = new Database(serviceLedger);
        try {
          service.exec(`
            CREATE TABLE _migrations (name TEXT PRIMARY KEY);
            CREATE TABLE runs (id INTEGER PRIMARY KEY);
            INSERT INTO _migrations VALUES ('999-review.sql');
            INSERT INTO runs VALUES (42);
          `);
        } finally {
          service.close();
        }
        const supplied = new Database(ledger);
        try {
          supplied.exec("UPDATE runs SET id = 7");
        } finally {
          supplied.close();
        }
        for (const version of [active, target]) {
          const release = join(root, version);
          await mkdir(join(release, "dist/plugins/builtins"), {
            recursive: true,
          });
          await mkdir(join(release, "dist/db/migrations"), { recursive: true });
          await writeFile(join(release, "pnpm-lock.yaml"), "");
          await writeFile(
            join(release, "package.json"),
            JSON.stringify({ type: "module", version: version.split("/")[1] }),
          );
          await writeFile(
            join(release, "release-manifest.json"),
            JSON.stringify({
              version: version.split("/")[1],
              platform: "linux",
              arch: process.arch,
              nodeVersion: process.versions.node,
              nodeAbi: process.versions.modules,
              commitSha: "0".repeat(40),
              builtAt: "2026-11-11T12:00:00Z",
              tarballSha256: "0".repeat(64),
              ...(await readReleaseInventory(release)),
            }),
          );
        }
        const platformOverride = join(root, "linux.cjs");
        await writeFile(
          platformOverride,
          'Object.defineProperty(process, "platform", { value: "linux" });\n',
        );
        const check = (database: string) =>
          spawnSync(
            process.execPath,
            [
              "--require",
              platformOverride,
              join(root, active, "dist/cli.js"),
              "db",
              "rollback-check",
              "--current",
              current,
              "--target",
              previous,
            ],
            {
              env: { ...process.env, GWRK_DB_PATH: database },
              encoding: "utf8",
              timeout: 10_000,
            },
          );
        const rejected = check(serviceLedger);
        expect(rejected.status, rejected.stderr).toBe(1);
        expect(rejected.stderr).toContain("999-review.sql");
        const accepted = check(ledger);
        expect(accepted.status, accepted.stderr).toBe(0);
      }

      const shims = {
        uname: "printf 'Linux\\n'",
        realpath: 'cd -P -- "$3" && pwd -P',
        flock: "exit 0",
        runuser: `shift 5
if [[ "$1" == env ]]; then
  shift
  while [[ "$1" == GWRK_*=* ]]; do export "$1"; shift; done
fi
if [[ "\${3:-}" == --version && "$FIXTURE_STAGE" != "target CLI version mismatch" ]]; then
  printf '1.0.0\\n'
  exit 0
fi
if [[ "\${3:-}" == db ]]; then
  if [[ "\${4:-}" == rollback-check ]]; then
    if [[ "$FIXTURE_STAGE" == "service "* || "$FIXTURE_STAGE" == "running service "* ]]; then
      exec node --require "$FIXTURE_ROOT/linux.cjs" "\${@:2}"
    fi
    version=1.0.0
    if [[ "$FIXTURE_STAGE" == "target manifest version mismatch" ]]; then version=1.1.0; fi
    printf '{"allowed":true,"targetVersion":"%s"}\\n' "$version"
    exit 0
  fi
  if [[ "\${4:-}" == backup && ( "$FIXTURE_STAGE" == "backup with an inactive unit" || "$FIXTURE_STAGE" == "invalid target interpreter" ) ]]; then
    printf 'Fixture backup failed\\n' >&2
    exit 1
  fi
fi
exec "$@"`,
        mv: `exec node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$3" "$4"`,
        timeout: '[[ "$1" != --kill-after=* ]] || shift\nshift\nexec "$@"',
        busctl: `
case "$6" in
  call) printf '{"type":"o","data":["/fixture/unit"]}\\n' ;;
  get-property)
    printf '%s\\n' '{"type":"as","data":["GWRK_HOME=/overridden","GWRK_DIR=/unset","SLACK_BOT_TOKEN=fixture-probe-secret"]}' \\
      '{"type":"a(sb)","data":[["/fixture/runner env",false],["/fixture/optional",true]]}' \\
      '{"type":"as","data":["GWRK_RUNTIME_DIR"]}' \\
      '{"type":"as","data":["GWRK_DIR=/unset"]}'
    ;;
  *) exit 1 ;;
esac`,
        "systemd-run": `
if [[ "$*" == *"fixture-probe-secret"* ]]; then touch "$FIXTURE_RUNTIME/probe-argv-leak"; fi
[[ "$*" == *"--setenv=GWRK_HOME=/overridden"* &&
   "$*" == *"--setenv=GWRK_DIR=/unset"* &&
   "$*" == *"--property=EnvironmentFile=/fixture/runner env"* &&
   "$*" == *"--property=EnvironmentFile=-/fixture/optional"* &&
   "$*" == *"--property=PassEnvironment=GWRK_RUNTIME_DIR"* &&
   "$*" == *'--property=UnsetEnvironment="GWRK_DIR=/unset"'* ]]
state="$FIXTURE_ROOT/state"
database="$state/gwrk.db"
runtime="$FIXTURE_RUNTIME"
release_root="$FIXTURE_ROOT"
case "$FIXTURE_STAGE" in
  "service ledger mismatch") database="$state/service.db" ;;
  "service runtime mismatch") runtime="$FIXTURE_ROOT/other runtime" ;;
  "service release root mismatch") release_root="$FIXTURE_ROOT/other release root" ;;
esac
printf '%s\\0' "GWRK_HOME=$state" "GWRK_DB_PATH=$database" "GWRK_RUNTIME_DIR=$runtime" "GWRK_RELEASE_ROOT=$release_root"`,
        cat: `
if [[ "$1" == -- && "$2" == "/proc/$FIXTURE_PID/environ" ]]; then
  state="$FIXTURE_ROOT/state"
  database="$state/gwrk.db"
  release_root="$FIXTURE_ROOT"
  if [[ "$FIXTURE_STAGE" == "running service release root mismatch" ]]; then release_root="$FIXTURE_ROOT/other release root"; fi
  if [[ "$FIXTURE_STAGE" == "running service ledger mismatch" ]]; then database="$state/service.db"; fi
  printf '%s\\0' "GWRK_HOME=$state" "GWRK_DB_PATH=$database" "GWRK_RUNTIME_DIR=$FIXTURE_RUNTIME" "GWRK_RELEASE_ROOT=$release_root"
else
  exec /bin/cat "$@"
fi`,
        systemctl: `
pid_file="$FIXTURE_RUNTIME/server.pid"
ready="$FIXTURE_RUNTIME/checking-readiness"
release_readiness="$FIXTURE_RUNTIME/release-readiness"
case "$1" in
  stop)
    printf 'stop\\n' >> "$FIXTURE_RUNTIME/supervisor.calls"
    rm -f "$pid_file"
    if [[ "$FIXTURE_STAGE" == "initial stop" ]]; then
      touch "$ready"
      while [[ ! -e "$release_readiness" ]]; do sleep 0.05; done
    fi
    ;;
  start) printf 'start\\n' >> "$FIXTURE_RUNTIME/supervisor.calls"; printf '%s\\n' "$FIXTURE_PID" > "$pid_file" ;;
  show)
    case "$2" in
      --property=User|--property=Group) printf 'gwrk\\n' ;;
      --property=ActiveState)
        if [[ -f "$pid_file" ]]; then printf 'active\\n'; else printf 'inactive\\n'; fi
        ;;
      --property=MainPID)
        if [[ "$FIXTURE_STAGE" == readiness && -f "$FIXTURE_RUNTIME/supervisor.calls" && ! -e "$ready" ]]; then
          touch "$ready"
          while [[ ! -e "$release_readiness" ]]; do sleep 0.05; done
        fi
        if [[ -f "$pid_file" ]]; then cat "$pid_file"; else printf '0\\n'; fi
        ;;
    esac
    ;;
  is-active) test -f "$pid_file" ;;
esac`,
      };
      for (const [name, body] of Object.entries(shims)) {
        await writeFile(
          join(bin, name),
          `#!/usr/bin/env bash\nset -eu\n${body}\n`,
          {
            mode: 0o755,
          },
        );
      }

      const child = spawn("bash", [rollback, root, state], {
        detached: true,
        env: {
          ...process.env,
          PATH: [bin, process.env.PATH].join(delimiter),
          GWRK_RUNTIME_DIR: runtime,
          FIXTURE_ROOT: root,
          FIXTURE_RUNTIME: runtime,
          FIXTURE_PID: String(process.pid),
          FIXTURE_STAGE: stage,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const closed = once(child, "close");
      try {
        if (!signal) {
          expect(await closed, output).toEqual([status, null]);
          expect(existsSync(join(runtime, "probe-argv-leak"))).toBe(false);
          if (stage === "backup with an inactive unit") {
            expect(output).toContain("Fixture backup failed");
            expect(await readFile(calls, "utf8"), output).toBe("stop\n");
          } else {
            expect(existsSync(calls), output).toBe(false);
            if (pathMismatch) {
              expect(output).toContain(
                stage.endsWith("release root mismatch")
                  ? "release root mismatch"
                  : stage === "service runtime mismatch"
                    ? "runtime mismatch"
                    : "ledger mismatch",
              );
              expect(existsSync(join(state, "backups"))).toBe(false);
            } else if (malformedPath) {
              expect(output).toContain(malformedPath);
              if (stage === "invalid target interpreter") {
                expect(output).toContain("unsupported interpreter");
              }
            } else {
              expect(output).toContain(
                stage === "target CLI version mismatch"
                  ? "Rollback target CLI version does not match"
                  : "Rollback target manifest version 1.1.0 does not match",
              );
            }
          }
          expect(existsSync(pidFile)).toBe(running);
          expect(await readlink(current)).toBe(active);
          expect(await readlink(previous)).toBe(target);
          return;
        }
        await vi.waitFor(() => expect(existsSync(ready), output).toBe(true), {
          timeout: 8_000,
        });
        expect(await readlink(current)).toBe(
          stage === "readiness" ? target : active,
        );
        expect(await readlink(previous)).toBe(
          stage === "readiness" ? active : target,
        );
        expect(child.kill(signal)).toBe(true);
        await writeFile(releaseReadiness, "");
        await vi.waitFor(
          () => {
            expect(child.exitCode !== null || child.signalCode !== null).toBe(
              true,
            );
          },
          { timeout: 8_000 },
        );
        expect(await readFile(calls, "utf8"), output).toBe(
          stage === "readiness" ? "stop\nstart\nstop\n" : "stop\nstart\n",
        );
        expect(existsSync(pidFile)).toBe(stage === "initial stop");
        expect(await readlink(current)).toBe(active);
        expect(await readlink(previous)).toBe(target);
        expect(await closed, output).toEqual([status, null]);
        const backups = join(state, "backups");
        if (stage === "initial stop") {
          expect(existsSync(backups)).toBe(false);
          return;
        }
        const entries = await readdir(backups);
        expect(entries).toHaveLength(1);
        const restored = await restoreLedgerBackup({
          source: join(backups, entries[0]),
          stateDirectory: join(root, "restored"),
          force: false,
        });
        expect(restored.manifest.summary.completedRunIds).toEqual([42]);
      } finally {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          process.kill(-child.pid, "SIGKILL");
        }
        await closed;
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
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
    const pidFile = join(runtime, "server.pid");
    const ready = join(runtime, "checking-readiness");
    const releaseReadiness = join(runtime, "release-readiness");
    const calls = join(runtime, "supervisor.calls");

    try {
      await mkdir(bin);
      await mkdir(runtime);
      await mkdir(state);
      await writeFile(join(runtime, "server.lock"), "");
      if (signal || malformedFile) {
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

      const shims = {
        uname: "printf 'Linux\\n'",
        realpath: 'cd -P -- "$3" && pwd -P',
        flock: "exit 0",
        runuser: `shift 5
if [[ "\${3:-}" == --version && "$FIXTURE_STAGE" != "target CLI version mismatch" ]]; then
  printf '1.0.0\\n'
  exit 0
fi
if [[ "\${3:-}" == db ]]; then
  if [[ "\${4:-}" == rollback-check ]]; then
    version=1.0.0
    if [[ "$FIXTURE_STAGE" == "target manifest version mismatch" ]]; then version=1.1.0; fi
    printf '{"allowed":true,"targetVersion":"%s"}\\n' "$version"
    exit 0
  fi
  if [[ "\${4:-}" == backup && ( "$FIXTURE_STAGE" == "backup with an inactive unit" || "$FIXTURE_STAGE" == *mismatch || "$FIXTURE_STAGE" == "invalid target interpreter" ) ]]; then
    printf 'Fixture backup failed\\n' >&2
    exit 1
  fi
fi
exec "$@"`,
        mv: `exec node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$3" "$4"`,
        timeout: '[[ "$1" != --kill-after=* ]] || shift\nshift\nexec "$@"',
        systemctl: `
pid_file="$GWRK_RUNTIME_DIR/server.pid"
ready="$GWRK_RUNTIME_DIR/checking-readiness"
release_readiness="$GWRK_RUNTIME_DIR/release-readiness"
case "$1" in
  stop)
    printf 'stop\\n' >> "$GWRK_RUNTIME_DIR/supervisor.calls"
    rm -f "$pid_file"
    if [[ "$FIXTURE_STAGE" == "initial stop" ]]; then
      touch "$ready"
      while [[ ! -e "$release_readiness" ]]; do sleep 0.05; done
    fi
    ;;
  start) printf 'start\\n' >> "$GWRK_RUNTIME_DIR/supervisor.calls"; printf '%s\\n' "$FIXTURE_PID" > "$pid_file" ;;
  show)
    case "$2" in
      --property=User|--property=Group) printf 'gwrk\\n' ;;
      --property=ActiveState)
        if [[ -f "$pid_file" ]]; then printf 'active\\n'; else printf 'inactive\\n'; fi
        ;;
      --property=MainPID)
        if [[ "$FIXTURE_STAGE" == readiness && ! -e "$ready" ]]; then
          touch "$ready"
          while [[ ! -e "$release_readiness" ]]; do sleep 0.05; done
        fi
        cat "$pid_file"
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
          if (stage === "backup with an inactive unit") {
            expect(output).toContain("Fixture backup failed");
            expect(await readFile(calls, "utf8"), output).toBe("stop\n");
          } else {
            expect(existsSync(calls), output).toBe(false);
            if (malformedPath) {
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
          expect(existsSync(pidFile)).toBe(Boolean(malformedPath));
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
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

it("records exact migration digests and keeps legacy provenance unknown", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwrk-migration-digests-"));
  const path = join(root, "gwrk.db");
  try {
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE _migrations (name TEXT NOT NULL UNIQUE);
      INSERT INTO _migrations VALUES ('999-legacy.sql');
    `);
    legacy.close();
    const initialized = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const { getDb, closeDb } = await import(process.argv[1]); getDb(); closeDb();",
        new URL("../../dist/db/index.js", import.meta.url).href,
      ],
      {
        env: { ...process.env, GWRK_DB_PATH: path },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(initialized.status, initialized.stderr).toBe(0);
    const { migrations } = await readReleaseInventory(repo);
    expect(migrations.length).toBeGreaterThan(0);
    const ledger = new Database(path, { readonly: true });
    try {
      expect(
        ledger
          .prepare("SELECT name, sha256 FROM _migrations ORDER BY name")
          .all(),
      ).toEqual([...migrations, { name: "999-legacy.sql", sha256: null }]);
    } finally {
      ledger.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  { signal: "SIGTERM", status: 143, stage: "readiness" },
  { signal: "SIGINT", status: 130, stage: "readiness" },
  { signal: "SIGTERM", status: 143, stage: "initial stop" },
  { signal: "SIGINT", status: 130, stage: "initial stop" },
  { signal: null, status: 1, stage: "backup with an inactive unit" },
  { signal: null, status: 1, stage: "target CLI version mismatch" },
  { signal: null, status: 1, stage: "target launcher uses current alias" },
  { signal: null, status: 1, stage: "target manifest version mismatch" },
  { signal: null, status: 1, stage: "service ledger mismatch" },
  { signal: null, status: 1, stage: "service runtime mismatch" },
  { signal: null, status: 1, stage: "running service ledger mismatch" },
  { signal: null, status: 1, stage: "service release root mismatch" },
  { signal: null, status: 1, stage: "running service release root mismatch" },
  { signal: null, status: 1, stage: "running release differs from current" },
  { signal: null, status: 1, stage: "running release uses current alias" },
  { signal: null, status: 1, stage: "applied migration digest mismatch" },
  { signal: null, status: 1, stage: "current migration digest mismatch" },
  { signal: null, status: 1, stage: "current migration missing" },
  { signal: null, status: 1, stage: "legacy applied migration without digest" },
  { signal: null, status: 0, stage: "restarted service stays ready" },
  { signal: null, status: 1, stage: "restarted service runs the wrong CLI" },
  {
    signal: null,
    status: 1,
    stage: "restarted service exits during comparison",
  },
  ...serviceScripts.slice(1).map((malformedFile) => ({
    signal: null,
    status: 1,
    stage: `invalid target interpreter for ${malformedFile}`,
    malformedFile,
  })),
  ...serviceScripts.map((malformedFile) => ({
    signal: null,
    status: 1,
    stage: `invalid target ${malformedFile}`,
    malformedFile,
  })),
] as const)(
  "checks release state during $stage (exit $status)",
  async (scenario) => {
    const { signal, status, stage } = scenario;
    const malformedFile =
      "malformedFile" in scenario ? scenario.malformedFile : undefined;
    const invalidInterpreter = stage.startsWith("invalid target interpreter");
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "gwrk-rollback-signal-")),
    );
    const bin = join(root, "bin");
    const runtime = join(root, "runtime");
    const state = join(root, "state");
    const current = join(root, "current");
    const previous = join(root, "previous");
    const active = "releases/1.1.0";
    const target = "releases/1.0.0";
    const otherRelease = "releases/1.2.0";
    const migration = "001-review.sql";
    const matchingSql = "SELECT 1;\n";
    const differentSql = "SELECT 2;\n";
    const ledger = join(state, "gwrk.db");
    const serviceLedger = join(state, "service.db");
    const serviceRuntime = join(root, "other runtime");
    const pathMismatch =
      stage.startsWith("service ") || stage.startsWith("running service ");
    const verifiesRestart = stage.startsWith("restarted service ");
    const provenance =
      stage.startsWith("running release ") || stage.includes("migration");
    const oldLauncher = stage === "target launcher uses current alias";
    const currentMismatch = stage === "current migration digest mismatch";
    const currentMissing = stage === "current migration missing";
    const usesRealCheck = pathMismatch || provenance || oldLauncher;
    const running = Boolean(signal || malformedFile || usesRealCheck);
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
      await writeFile(join(state, ".gwrk.db.lock"), "");
      if (running) {
        await writeFile(pidFile, String(process.pid));
      }
      await symlink(active, current);
      await symlink(target, previous);
      const releases = provenance
        ? [active, target, otherRelease]
        : [active, target];
      for (const version of releases) {
        const release = join(root, version);
        const service = join(release, "deploy/linux-runner");
        await mkdir(service, { recursive: true });
        await mkdir(join(release, "dist"));
        await symlink(
          join(repo, "node_modules"),
          join(release, "node_modules"),
        );
        await writeFile(join(release, "package.json"), '{"type":"module"}');
        if (stage === "target CLI version mismatch" && version === target) {
          await symlink(
            join(repo, "dist/cli.js"),
            join(release, "dist/cli.js"),
          );
        } else {
          await writeFile(join(release, "dist/cli.js"), "");
        }
        await mkdir(join(release, "dist/domain"));
        await symlink(
          join(repo, "dist/domain/gwrk-paths.js"),
          join(release, "dist/domain/gwrk-paths.js"),
        );
        for (const name of serviceScripts) {
          const body =
            name === "run.sh"
              ? await readFile(join(repo, "deploy/linux-runner", name), "utf8")
              : "#!/usr/bin/env bash\n";
          await writeFile(join(service, name), body, { mode: 0o755 });
        }
      }
      if (oldLauncher) {
        await writeFile(
          join(root, target, "deploy/linux-runner/run.sh"),
          [
            "#!/usr/bin/env bash",
            "set -eu",
            'cd -- "${GWRK_PILOT_REPO:?Set GWRK_PILOT_REPO.}"',
            'exec node "$GWRK_RELEASE_ROOT/current/dist/cli.js" server start --foreground',
            "",
          ].join("\n"),
        );
      }
      const malformedPath = malformedFile
        ? join(root, target, "deploy/linux-runner", malformedFile)
        : undefined;
      if (malformedPath) {
        const body = invalidInterpreter
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
        if (provenance) {
          if (stage === "legacy applied migration without digest") {
            db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(
              migration,
            );
          } else {
            const digest = createHash("sha256")
              .update(
                currentMismatch || currentMissing ? matchingSql : differentSql,
              )
              .digest("hex");
            db.exec("ALTER TABLE _migrations ADD COLUMN sha256 TEXT");
            db.prepare(
              "INSERT INTO _migrations (name, sha256) VALUES (?, ?)",
            ).run(migration, digest);
          }
        }
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
      }
      if (usesRealCheck) {
        for (const version of releases) {
          const release = join(root, version);
          await mkdir(join(release, "dist/plugins/builtins"), {
            recursive: true,
          });
          await mkdir(join(release, "dist/db/migrations"), { recursive: true });
          if (provenance && !(currentMissing && version === active)) {
            await writeFile(
              join(release, "dist/db/migrations", migration),
              version === otherRelease ||
                (currentMismatch && version === active)
                ? differentSql
                : matchingSql,
            );
          }
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
        const check = (database: string, currentRelease = current) =>
          spawnSync(
            process.execPath,
            [
              "--require",
              platformOverride,
              join(repo, "dist/cli.js"),
              "db",
              "rollback-check",
              "--current",
              currentRelease,
              "--target",
              previous,
            ],
            {
              env: { ...process.env, GWRK_DB_PATH: database },
              encoding: "utf8",
              timeout: 10_000,
            },
          );
        if (pathMismatch) {
          const rejected = check(serviceLedger);
          expect(rejected.status, rejected.stderr).toBe(1);
          expect(rejected.stderr).toContain("999-review.sql");
          const accepted = check(ledger);
          expect(accepted.status, accepted.stderr).toBe(0);
        } else if (stage === "running release differs from current") {
          const rejected = check(ledger, join(root, otherRelease));
          expect(rejected.status, rejected.stderr).toBe(1);
          expect(rejected.stderr).toContain(migration);
        } else if (oldLauncher) {
          const accepted = check(ledger);
          expect(accepted.status, accepted.stderr).toBe(0);
        }
      }

      const shims = {
        uname: "printf 'Linux\\n'",
        realpath: `exec node -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' "$3"`,
        flock: "exit 0",
        runuser: `shift 5
if [[ "$1" == env && "\${2:-}" != -i ]]; then
  shift
  while [[ "$1" == GWRK_*=* ]]; do export "$1"; shift; done
fi
if [[ "\${3:-}" == --version && "$FIXTURE_STAGE" != "target CLI version mismatch" ]]; then
  printf '1.0.0\\n'
  exit 0
fi
if [[ "\${3:-}" == db ]]; then
  if [[ "\${4:-}" == rollback-check ]]; then
    if [[ -f "$FIXTURE_ROOT/linux.cjs" ]]; then
      exec node --require "$FIXTURE_ROOT/linux.cjs" "$FIXTURE_REAL_CLI" "\${@:3}"
    fi
    if [[ "$FIXTURE_STAGE" == "restarted service exits during comparison" && " $* " == *" --against "* ]]; then
      rm -f "$FIXTURE_RUNTIME/server.pid"
    fi
    version=1.0.0
    if [[ "$FIXTURE_STAGE" == "target manifest version mismatch" ]]; then version=1.1.0; fi
    printf '{"allowed":true,"targetVersion":"%s"}\\n' "$version"
    exit 0
  fi
  if [[ "\${4:-}" == backup ]]; then
    if [[ "$FIXTURE_STAGE" == "backup with an inactive unit" || "$FIXTURE_STAGE" == "invalid target interpreter "* ]]; then
      printf 'Fixture backup failed\\n' >&2
      exit 1
    fi
    exec node "$FIXTURE_REAL_CLI" "\${@:3}"
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
if [[ "$1" == -- && "$2" == "/proc/$FIXTURE_PID/cmdline" ]]; then
  cli="$FIXTURE_ROOT/$(readlink "$FIXTURE_ROOT/current")/dist/cli.js"
  case "$FIXTURE_STAGE" in
    "restarted service runs the wrong CLI") cli="$FIXTURE_ROOT/$(readlink "$FIXTURE_ROOT/previous")/dist/cli.js" ;;
    "running release differs from current") cli="$FIXTURE_ROOT/releases/1.2.0/dist/cli.js" ;;
    "running release uses current alias") cli="$FIXTURE_ROOT/current/dist/cli.js" ;;
  esac
  printf '%s\\0' node "$cli" server start --foreground
  exit 0
fi
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
          FIXTURE_REAL_CLI: join(repo, "dist/cli.js"),
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
          } else if (verifiesRestart) {
            if (status === 0) {
              expect(output).toContain("Activated gwrk 1.0.0.");
            } else {
              expect(output).toContain(
                stage === "restarted service runs the wrong CLI"
                  ? "The restarted service did not run the selected release"
                  : "The restarted service changed during ledger comparison",
              );
            }
            expect(await readFile(calls, "utf8"), output).toBe(
              status === 0 ? "stop\nstart\n" : "stop\nstart\nstop\n",
            );
            const backups = join(state, "backups");
            const entries = await readdir(backups);
            expect(entries).toHaveLength(1);
            const restored = await restoreLedgerBackup({
              source: join(backups, entries[0]),
              stateDirectory: join(root, "restored"),
              force: false,
            });
            expect(restored.manifest.summary.completedRunIds).toEqual([42]);
          } else {
            expect(existsSync(calls), output).toBe(false);
            if (oldLauncher) {
              expect(output).toContain(
                "Rollback target launcher could not prove release identity",
              );
              expect(existsSync(join(state, "backups"))).toBe(false);
            } else if (pathMismatch) {
              expect(output).toContain(
                stage.endsWith("release root mismatch")
                  ? "release root mismatch"
                  : stage === "service runtime mismatch"
                    ? "runtime mismatch"
                    : "ledger mismatch",
              );
              expect(existsSync(join(state, "backups"))).toBe(false);
            } else if (provenance) {
              let diagnostic = `Mismatched applied migration digest in target release: ${migration}`;
              if (stage.startsWith("running release ")) {
                diagnostic =
                  "The running service does not match the current release";
              } else if (stage === "legacy applied migration without digest") {
                diagnostic = `Unknown applied migration digest: ${migration}`;
              } else if (currentMismatch) {
                diagnostic = `Mismatched applied migration digest in current release: ${migration}`;
              } else if (currentMissing) {
                diagnostic = `Current release is missing applied migration: ${migration}`;
              }
              expect(output).toContain(diagnostic);
              expect(existsSync(join(state, "backups"))).toBe(false);
            } else if (malformedPath) {
              expect(output).toContain(malformedPath);
              if (invalidInterpreter) {
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
          expect(existsSync(pidFile)).toBe(running || status === 0);
          expect(await readlink(current)).toBe(status === 0 ? target : active);
          expect(await readlink(previous)).toBe(status === 0 ? active : target);
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

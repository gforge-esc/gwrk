/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireInstanceLock,
  acquireLedgerLock,
} from "../../src/adapters/server/instance-lock.js";
import {
  createLedgerBackup,
  restoreLedgerBackup,
  verifyLedgerAgainstBackup,
  verifyLedgerBackup,
} from "../../src/adapters/sqlite/ledger-backup.js";

import { readRepositoryEvidence } from "../../src/adapters/release/repository-evidence.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "gwrk-ledger-proof-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function seedLedger(path = join(root, "active.db")) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE _migrations (name TEXT PRIMARY KEY);
    CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE);
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      finished_at TEXT,
      exit_code INTEGER
    );
    CREATE TABLE compression (id INTEGER PRIMARY KEY);
    CREATE TABLE history (id INTEGER PRIMARY KEY, metadata TEXT);
  `);
  db.prepare("INSERT INTO projects VALUES (?, ?)").run("pilot-repo", root);
  db.exec(`
    INSERT INTO _migrations VALUES ('001-initial.sql');
    INSERT INTO runs VALUES (42, 'pilot-repo', '2026-11-11T12:00:00Z', 0);
    INSERT INTO runs VALUES (43, 'pilot-repo', NULL, NULL);
    INSERT INTO compression VALUES (1);
    INSERT INTO history VALUES (1, '{"result":"accepted"}');
  `);
  return db;
}

const trackedTask = "specs/pilot/.gwrk/tasks.json";
const trackedRun = "specs/pilot/.gwrk/runs/42.json";

async function seedRepository(
  checkout: string,
  contents: string,
  runContents?: string,
) {
  await mkdir(join(checkout, "specs/pilot/.gwrk"), { recursive: true });
  await writeFile(join(checkout, trackedTask), contents);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
  git("init", "--quiet");
  git("add", "-f", trackedTask);
  if (runContents !== undefined) {
    await mkdir(join(checkout, dirname(trackedRun)), { recursive: true });
    await writeFile(join(checkout, trackedRun), runContents);
    git("add", "-f", trackedRun);
  }
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "--no-edit",
    "-m",
    "Record fixture task",
  );
  return git("rev-parse", "HEAD").trim();
}

function runCli(...args: string[]) {
  const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
  return spawnSync(
    process.execPath,
    ["--import", createRequire(import.meta.url).resolve("tsx"), cli, ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        GWRK_HOME: root,
        GWRK_DB_PATH: join(root, "active.db"),
        GWRK_RUNTIME_DIR: join(root, "runtime"),
      },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}

function runLedgerCommand(...args: string[]) {
  return runCli("db", ...args);
}

function runInstalledBackup(ledger: string, destination: string) {
  return spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../../dist/cli.js", import.meta.url)),
      "db",
      "backup",
      "--out",
      destination,
      "--format",
      "json",
    ],
    {
      cwd: root,
      env: { ...process.env, GWRK_HOME: dirname(ledger), GWRK_DB_PATH: ledger },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}

function expectUsageFailure(result: ReturnType<typeof runCli>) {
  expect(result.status, result.stderr).toBe(2);
  const signals = result.stderr.match(/^\[exit:.*$/gm) ?? [];
  expect(signals).toHaveLength(1);
  expect(signals[0]).toMatch(/^\[exit:2 \| \d+(?:\.\d+)?m?s\]$/);
  expect(result.stdout).toBe("");
}

describe("installed ledger commands outside a checkout", () => {
  it("rejects a device FIFO before publishing a backup", () => {
    const ledger = join(root, "gwrk.db");
    seedLedger(ledger).close();
    execFileSync("mkfifo", [join(root, "device.json")]);
    const destination = join(root, "fifo-backup");
    const result = runInstalledBackup(ledger, destination);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr.match(/^\[exit:.*$/gm)).toEqual([
      expect.stringMatching(/^\[exit:1 .*device record.*regular file/),
    ]);
    return expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it.skipIf(process.platform !== "linux")(
    "rejects a manifest FIFO and releases restore locks",
    async () => {
      const backup = join(root, "fifo-backup");
      const state = join(root, "restored");
      const runtime = join(root, "runtime");
      await mkdir(backup);
      execFileSync("mkfifo", [join(backup, "backup-manifest.json")]);
      const result = runLedgerCommand(
        "restore",
        "--from",
        backup,
        "--state-dir",
        state,
        "--format",
        "json",
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr.match(/^\[exit:.*$/gm)).toEqual([
        expect.stringMatching(/^\[exit:1 .*regular files/),
      ]);
      const database = join(state, "gwrk.db");
      await expect(stat(database)).rejects.toMatchObject({ code: "ENOENT" });
      const runtimeLock = acquireInstanceLock(runtime, process.pid);
      try {
        const ledgerLock = acquireLedgerLock(database, process.pid);
        ledgerLock.release();
      } finally {
        runtimeLock.release();
      }
    },
    15_000,
  );

  it("directs backup to resume an interrupted first restore", async () => {
    const sourceLedger = join(root, "active.db");
    seedLedger(sourceLedger).close();
    const source = join(root, "original-backup");
    await createLedgerBackup({
      dbPath: sourceLedger,
      destination: source,
      createdAt: "2026-11-11T12:00:00.000Z",
      gwrkVersion: "1.6.0-beta.1",
      collectDevice: () => null,
      collectRepositories: () => [],
    });

    const stateDirectory = join(root, "restored");
    const ledger = join(stateDirectory, "gwrk.db");
    const pending = join(stateDirectory, ".restore-pending");
    const request = { source, stateDirectory, force: false };
    const realFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (from === join(pending, "install.db") && to === ledger) {
        throw new Error("Fixture interrupted first ledger installation");
      }
      await realFs.rename(from, to);
    });
    try {
      await expect(restoreLedgerBackup(request)).rejects.toThrow(
        "Fixture interrupted first ledger installation",
      );
    } finally {
      vi.mocked(rename).mockReset();
    }

    expect((await stat(pending)).isDirectory()).toBe(true);
    await expect(stat(ledger)).rejects.toMatchObject({ code: "ENOENT" });
    const destination = join(root, "new-backup");
    const result = runInstalledBackup(ledger, destination);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.match(/^\[exit:.*$/gm)).toEqual([
      expect.stringMatching(/^\[exit:1 .*gwrk db restore.*original backup/),
    ]);
    await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });

    await restoreLedgerBackup(request);
    await expect(stat(pending)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["truncated JSON", '{"id":'],
    ["invalid schema", '{"id":"pilot-device","role":"unknown"}'],
  ])(
    "rejects backup with an existing device record containing %s",
    async (_case, contents) => {
      const ledger = join(root, "gwrk.db");
      seedLedger(ledger).close();
      const device = join(root, "device.json");
      await writeFile(device, contents);

      const destination = join(root, "backup");
      const result = runInstalledBackup(ledger, destination);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.match(/^\[exit:.*$/gm)).toEqual([
        expect.stringMatching(/^\[exit:1 /),
      ]);
      expect(result.stderr).toContain(device);
      await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("rejects JSON backup while a restore is unfinished", async () => {
    const ledger = join(root, "gwrk.db");
    seedLedger(ledger).close();
    const original = join(root, "original-backup");
    await createLedgerBackup({
      dbPath: ledger,
      destination: original,
      createdAt: "2026-11-11T12:00:00.000Z",
      gwrkVersion: "1.6.0-beta.1",
      collectDevice: () => ({
        id: "restored-device",
        hostname: "fixture",
        role: "server",
        createdAt: "2026-11-11T12:00:00.000Z",
      }),
      collectRepositories: () => [],
    });

    const live = new Database(ledger);
    live.prepare("UPDATE projects SET path = ?").run(join(root, "old"));
    live.close();
    const devicePath = join(root, "device.json");
    const oldDevice = {
      id: "old-device",
      hostname: "fixture",
      role: "server",
      createdAt: "2026-11-11T12:00:00.000Z",
    };
    await writeFile(devicePath, JSON.stringify(oldDevice));
    const realFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (to === devicePath)
        throw new Error("Fixture interrupted device installation");
      await realFs.rename(from, to);
    });
    try {
      await expect(
        restoreLedgerBackup({
          source: original,
          stateDirectory: root,
          force: true,
        }),
      ).rejects.toThrow("Fixture interrupted device installation");
    } finally {
      vi.mocked(rename).mockReset();
    }
    expect(await readFile(ledger)).toEqual(
      await readFile(join(original, "gwrk.db")),
    );
    expect(JSON.parse(await readFile(devicePath, "utf8"))).toEqual(oldDevice);

    const destination = join(root, "new-backup");
    const result = runInstalledBackup(ledger, destination);

    expect.soft(result.status, result.stderr).toBe(1);
    expect.soft(result.stdout).toBe("");
    expect
      .soft(result.stderr.match(/^\[exit:.*$/gm))
      .toEqual([
        expect.stringMatching(/^\[exit:1 .*gwrk db restore.*original backup/),
      ]);
    await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });

    const restored = await restoreLedgerBackup({
      source: original,
      stateDirectory: root,
      force: false,
    });
    const retried = runInstalledBackup(ledger, destination);
    expect(retried.status, retried.stderr).toBe(0);
    expect((await verifyLedgerBackup(destination)).metadata).toEqual({
      ...restored.metadata,
      repositories: [readRepositoryEvidence("pilot-repo", root)],
    });
  });

  it.each(["backup", "restore"] as const)(
    "excludes the other maintenance operation while %s holds the state",
    async (operation) => {
      const ledger = join(root, "gwrk.db");
      seedLedger(ledger).close();
      const original = join(root, "original-backup");
      const destination = join(root, "new-backup");
      const request = {
        dbPath: ledger,
        destination: original,
        createdAt: "2026-11-11T12:00:00.000Z",
        gwrkVersion: "1.6.0-beta.1",
        collectDevice: () => null,
        collectRepositories: () => [],
      };
      await createLedgerBackup(request);

      const backup = () => createLedgerBackup({ ...request, destination });
      const restore = () =>
        restoreLedgerBackup({
          source: original,
          stateDirectory: root,
          force: true,
        });
      const [first, second, checkpoint] =
        operation === "backup"
          ? [backup, restore, join(destination, "gwrk.db")]
          : [restore, backup, join(root, ".restore-pending")];
      const realFs =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      let overlapped = false;
      vi.mocked(rename).mockImplementation(async (from, to) => {
        if (to === checkpoint) {
          overlapped = true;
          if (operation === "restore") {
            const result = runInstalledBackup(ledger, destination);
            expect(result.status, result.stderr).toBe(1);
            expect(result.stderr).toContain("backup or restore is in progress");
            await expect(stat(destination)).rejects.toMatchObject({
              code: "ENOENT",
            });
          } else {
            await expect(second()).rejects.toThrow(
              /backup or restore is in progress/,
            );
          }
        }
        await realFs.rename(from, to);
      });
      try {
        await first();
        expect(overlapped).toBe(true);
      } finally {
        vi.mocked(rename).mockReset();
      }
      await second();
    },
  );

  it.skipIf(process.platform !== "linux").each([
    { mode: "force", lock: "runtime" },
    { mode: "force", lock: "ledger" },
    { mode: "resume", lock: "ledger" },
  ])(
    "blocks $mode restore when the $lock lock is held",
    async ({ mode, lock }) => {
      const ledger = join(root, "gwrk.db");
      seedLedger(ledger).close();
      const backup = join(root, "backup");
      await createLedgerBackup({
        dbPath: ledger,
        destination: backup,
        createdAt: "2026-11-11T12:00:00.000Z",
        gwrkVersion: "1.6.0-beta.1",
        collectDevice: () => null,
        collectRepositories: () => [],
      });

      const serviceRuntime = join(root, "service");
      const serviceLock = acquireInstanceLock(serviceRuntime, process.pid);
      let ledgerLock: ReturnType<typeof acquireLedgerLock> | undefined;
      let live: Database.Database | undefined;
      try {
        ledgerLock = acquireLedgerLock(ledger, process.pid);
        live = new Database(ledger);
        live.pragma("journal_mode = WAL");
        live.prepare("UPDATE runs SET id = 99 WHERE id = 42").run();
        const files = [ledger, `${ledger}-wal`, `${ledger}-shm`];
        const original = await Promise.all(files.map((file) => readFile(file)));
        const pending = join(root, ".restore-pending");
        if (mode === "resume") await cp(backup, pending, { recursive: true });

        const cli = fileURLToPath(
          new URL("../../dist/cli.js", import.meta.url),
        );
        const args = [
          cli,
          "db",
          "restore",
          "--from",
          backup,
          "--state-dir",
          root,
        ];
        if (mode === "force") args.push("--force");
        const result = spawnSync(process.execPath, args, {
          cwd: root,
          env: {
            ...process.env,
            GWRK_HOME: root,
            GWRK_DB_PATH: ledger,
            GWRK_RUNTIME_DIR:
              lock === "runtime"
                ? serviceRuntime
                : join(root, "alternate-runtime"),
          },
          encoding: "utf8",
          timeout: 10_000,
        });

        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toContain(`Cannot restore ledger at ${root}.`);
        expect(result.stderr).toContain(`PID ${process.pid}`);
        expect(result.stderr).toContain(
          lock === "runtime" ? "server.lock" : ".gwrk.db.lock",
        );
        expect(result.stderr).toContain(
          "Run 'gwrk server stop' before 'gwrk db restore'",
        );
        expect(await Promise.all(files.map((file) => readFile(file)))).toEqual(
          original,
        );
        expect(
          live.prepare("SELECT id FROM runs ORDER BY id").pluck().all(),
        ).toEqual([43, 99]);
        if (mode === "resume") {
          expect(await verifyLedgerBackup(pending)).toEqual(
            await verifyLedgerBackup(backup),
          );
        } else {
          await expect(stat(pending)).rejects.toMatchObject({
            code: "ENOENT",
          });
        }
      } finally {
        live?.close();
        ledgerLock?.release();
        serviceLock.release();
      }
    },
  );

  it.each([
    { args: ["backup"], missing: "--out" },
    { args: ["backup", "--out"], missing: "--out value" },
    { args: ["restore", "--state-dir", "restored"], missing: "--from" },
    { args: ["restore", "--from", "backup"], missing: "--state-dir" },
  ])("reports a usage failure for db $args without $missing", ({ args }) => {
    const result = runLedgerCommand(...args);
    expectUsageFailure(result);
  });

  it.each([
    ["backup", "--out", "backup"],
    ["restore", "--from", "backup", "--state-dir", "restored"],
  ])("reports an unknown option for db %s with one exit signal", (...args) => {
    const result = runLedgerCommand(...args, "--bogus");
    expect(result.stderr).toContain("unknown option '--bogus'");
    expectUsageFailure(result);
  });

  const commands = {
    backup: ["backup", "--out", "backup"],
    restore: ["restore", "--from", "backup", "--state-dir", "restored"],
  };
  it.each([
    {
      command: "backup",
      position: "before db",
      args: ["--format", "yaml", "db", ...commands.backup],
    },
    {
      command: "restore",
      position: "before db",
      args: ["--format", "yaml", "db", ...commands.restore],
    },
    {
      command: "backup",
      position: "after backup",
      args: ["db", ...commands.backup, "--format", "yaml"],
    },
    {
      command: "restore",
      position: "after restore",
      args: ["db", ...commands.restore, "--format", "yaml"],
    },
  ])("reports an invalid format for db $command $position", ({ args }) => {
    const result = runCli(...args);
    expectUsageFailure(result);
  });

  it.each(Object.values(commands))(
    "rejects extra arguments to db %s",
    (...args) => {
      const result = runLedgerCommand(...args, "extra");
      expect(result.stderr).toContain("too many arguments");
      expectUsageFailure(result);
    },
  );

  it.each([
    ["backup", "generator"],
    ["restore", "mutator"],
  ])("lists db %s as a %s in help", (command, classification) => {
    const result = runLedgerCommand(command, "--help");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(classification);
  });

  it("does not collect evidence from a repository above an empty enrolled checkout", async () => {
    const parent = join(root, "parent-repo");
    const enrolled = join(parent, "empty-checkout");
    const evidenceDirectory = join(parent, "specs/pilot/.gwrk");
    await mkdir(enrolled, { recursive: true });
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(join(evidenceDirectory, "tasks.json"), "[]\n");
    for (const args of [
      ["init", "--quiet"],
      ["add", "-f", "specs/pilot/.gwrk/tasks.json"],
      [
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "--no-edit",
        "-m",
        "Add parent task evidence",
      ],
      ["remote", "add", "origin", "https://example.com/parent.git"],
    ]) {
      const result = spawnSync("git", args, {
        cwd: parent,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "Fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        },
      });
      expect(result.status, result.stderr).toBe(0);
    }

    const db = seedLedger();
    try {
      db.prepare("UPDATE projects SET path = ?").run(enrolled);
      db.prepare("INSERT INTO projects VALUES (?, ?)").run(
        "parent-repo",
        parent,
      );
      const result = runLedgerCommand("backup", "--out", "backup");
      expect(result.status, result.stderr).toBe(0);
      const { metadata } = await verifyLedgerBackup(join(root, "backup"));
      expect(metadata.repositories).toEqual([
        expect.objectContaining({
          projectId: "parent-repo",
          head: expect.stringMatching(/^[a-f0-9]+$/),
          evidence: [
            {
              path: "specs/pilot/.gwrk/tasks.json",
              sha256: expect.any(String),
            },
          ],
        }),
        {
          projectId: "pilot-repo",
          root: enrolled,
          remote: null,
          head: null,
          evidence: [],
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("uses the enrolled checkout despite inherited Git overrides", async () => {
    const checkout = join(root, "enrolled");
    const other = join(root, "other");
    const taskContents = '{"status":"completed"}\n';
    const head = await seedRepository(checkout, taskContents);
    const otherHead = await seedRepository(other, '{"status":"open"}\n');
    expect(head).not.toBe(otherHead);

    const db = seedLedger();
    db.prepare("UPDATE projects SET path = ?").run(checkout);
    db.close();

    vi.stubEnv("GIT_DIR", join(other, ".git"));
    vi.stubEnv("GIT_WORK_TREE", checkout);
    try {
      const result = runLedgerCommand("backup", "--out", "backup");
      expect(result.status, result.stderr).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }

    const { metadata } = await verifyLedgerBackup(join(root, "backup"));
    expect(metadata.repositories).toEqual([
      {
        projectId: "pilot-repo",
        root: checkout,
        remote: null,
        head,
        evidence: [
          {
            path: trackedTask,
            sha256: createHash("sha256").update(taskContents).digest("hex"),
          },
        ],
      },
    ]);
  });

  it("uses original Git objects when the checkout contains a replacement ref", async () => {
    const checkout = join(root, "enrolled");
    const contents = '{"status":"completed"}\n';
    const runContents = '{"exitCode":0}\n';
    const original = await seedRepository(checkout, contents, runContents);
    const replacement = await seedRepository(
      checkout,
      '{"status":"open"}\n',
      '{"exitCode":1}\n',
    );
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", checkout, ...args], { stdio: "ignore" });
    git("reset", "--hard", original);
    git("replace", original, replacement);
    const db = seedLedger();
    db.prepare("UPDATE projects SET path = ?").run(checkout);
    db.close();

    const result = runLedgerCommand("backup", "--out", "backup");
    expect(result.status, result.stderr).toBe(0);
    const { metadata } = await verifyLedgerBackup(join(root, "backup"));
    expect(metadata.repositories[0]).toMatchObject({
      head: original,
      evidence: [
        {
          path: trackedRun,
          sha256: createHash("sha256").update(runContents).digest("hex"),
        },
        {
          path: trackedTask,
          sha256: createHash("sha256").update(contents).digest("hex"),
        },
      ],
    });
  });

  it("preserves the digest for an enrolled __proto__ ID on disk", async () => {
    const checkout = join(root, "enrolled");
    await seedRepository(checkout, '{"status":"completed"}\n');
    const db = seedLedger();
    db.prepare("INSERT INTO projects VALUES (?, ?)").run("__proto__", checkout);
    db.close();

    const result = runLedgerCommand("backup", "--out", "backup");
    expect(result.status, result.stderr).toBe(0);
    const backup = join(root, "backup");
    const manifest = JSON.parse(
      await readFile(join(backup, "backup-manifest.json"), "utf8"),
    );
    const digests = manifest.summary.enrolledRepoDigests;
    expect(Object.hasOwn(digests, "__proto__")).toBe(true);
    expect(digests.__proto__).toMatch(/^[a-f0-9]{64}$/);
    const verified = await verifyLedgerBackup(backup);
    expect(verified.manifest.summary.enrolledRepoDigests).toEqual(digests);
  });

  it("backs up all snapshot projects while scoping checkout evidence", async () => {
    const db = seedLedger();
    db.prepare("INSERT INTO projects (id, path) VALUES (?, ?)").run(
      "other-repo",
      join(root, "other"),
    );
    try {
      const result = runLedgerCommand(
        "backup",
        "--out",
        "backup",
        "--project-root",
        root,
        "--format",
        "json",
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(join(root, "backup"));
      const { metadata } = await verifyLedgerBackup(join(root, "backup"));
      expect(metadata).toMatchObject({
        projects: [
          { id: "other-repo", path: join(root, "other") },
          { id: "pilot-repo", path: root },
        ],
        repositories: [{ projectId: "pilot-repo" }],
      });
    } finally {
      db.close();
    }
  });

  it("uses the snapshot checkout when enrollment changes during a Git probe", async () => {
    const oldCheckout = join(root, "old");
    const newCheckout = join(root, "new");
    const bin = join(root, "bin");
    await mkdir(oldCheckout);
    await mkdir(newCheckout);
    await mkdir(bin);
    const db = seedLedger();
    try {
      db.prepare("UPDATE projects SET path = ?").run(oldCheckout);
      const sqlite = createRequire(import.meta.url).resolve("better-sqlite3");
      await writeFile(
        join(bin, "git"),
        `#!${process.execPath}
const Database = require(${JSON.stringify(sqlite)});
const db = new Database(process.env.GWRK_DB_PATH);
db.prepare("UPDATE projects SET path = ?").run(${JSON.stringify(newCheckout)});
db.close();
process.exitCode = 1;
`,
        { mode: 0o700 },
      );
      const originalPath = process.env.PATH;
      vi.stubEnv("PATH", `${bin}:${originalPath}`);
      try {
        const result = runLedgerCommand("backup", "--out", "backup");
        expect(result.status, result.stderr).toBe(0);
      } finally {
        vi.unstubAllEnvs();
      }
      expect(db.prepare("SELECT path FROM projects").pluck().get()).toBe(
        newCheckout,
      );
      const { metadata } = await verifyLedgerBackup(join(root, "backup"));
      expect(metadata.projects).toEqual([
        { id: "pilot-repo", path: oldCheckout },
      ]);
      expect(metadata.repositories).toEqual([
        {
          projectId: "pilot-repo",
          root: oldCheckout,
          remote: null,
          head: null,
          evidence: [],
        },
      ]);
    } finally {
      db.close();
    }
  });

  it.each([
    ["restore", "--from", "missing", "--state-dir", "restore"],
    ["rollback-check", "--current", "missing", "--target", "missing"],
  ])("reports %s navigation failures with an exit signal", (...args) => {
    const result = runLedgerCommand(...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\[exit:1 \| .*\] db/);
  });
});

describe("ledger backup", () => {
  it("rejects evidence from a different checkout for a known project", async () => {
    const db = seedLedger();
    const destination = join(root, "backup");
    try {
      db.prepare("UPDATE projects SET path = ?").run(join(root, "enrolled"));
      await expect(
        createLedgerBackup({
          dbPath: db.name,
          destination,
          createdAt: "2026-11-11T12:00:00.000Z",
          gwrkVersion: "1.6.0-beta.1",
          collectDevice: () => null,
          collectRepositories: () => [
            {
              projectId: "pilot-repo",
              root: join(root, "different"),
              remote: null,
              head: null,
              evidence: [],
            },
          ],
        }),
      ).rejects.toThrow(/Repository metadata root does not match/);
      await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      db.close();
    }
  });

  it("preserves committed WAL state in a standalone snapshot and verifies its summary", async () => {
    const db = seedLedger();
    const destination = join(root, "backup");
    try {
      const result = await createLedgerBackup({
        dbPath: db.name,
        destination,
        createdAt: "2026-11-11T12:00:00.000Z",
        gwrkVersion: "1.6.0-beta.1",
        collectDevice: () => null,
        collectRepositories: () => [],
      });
      db.prepare("INSERT INTO projects VALUES (?, ?)").run(
        "after-backup",
        join(root, "after-backup"),
      );
      const verified = await verifyLedgerBackup(destination);
      expect(verified.manifest).toEqual(result);
      expect(verified.manifest.summary).toEqual({
        migrations: ["001-initial.sql"],
        projectIds: ["pilot-repo"],
        completedRunIds: [42],
        compressionCount: 1,
        historyCount: 1,
        enrolledRepoDigests: {},
      });

      const restored = new Database(join(destination, "gwrk.db"), {
        readonly: true,
      });
      try {
        expect(
          restored.prepare("SELECT id FROM runs ORDER BY id").pluck().all(),
        ).toEqual([42, 43]);
      } finally {
        restored.close();
      }

      await expect(
        createLedgerBackup({
          dbPath: db.name,
          destination,
          createdAt: "2026-11-11T12:00:00.000Z",
          gwrkVersion: "1.6.0-beta.1",
          collectDevice: () => null,
          collectRepositories: () => [],
        }),
      ).rejects.toThrow(/already exists/);
      expect(await verifyLedgerBackup(destination)).toEqual(verified);
    } finally {
      db.close();
    }
  });

  it("rejects invalid targets and resumes a restore interrupted during installation", async () => {
    const db = seedLedger();
    const destination = join(root, "backup");
    const stateDirectory = join(root, "restored");
    const device = {
      id: "pilot-device",
      hostname: "pilot",
      role: "server" as const,
      createdAt: "2026-11-11T12:00:00.000Z",
    };
    try {
      const manifest = await createLedgerBackup({
        dbPath: db.name,
        destination,
        createdAt: device.createdAt,
        gwrkVersion: "1.6.0-beta.1",
        collectDevice: () => device,
        collectRepositories: () => [],
      });
      const request = { source: destination, stateDirectory, force: false };
      expect((await restoreLedgerBackup(request)).manifest).toEqual(manifest);
      const devicePath = join(stateDirectory, "device.json");
      expect(JSON.parse(await readFile(devicePath, "utf8"))).toEqual(device);
      await expect(restoreLedgerBackup(request)).rejects.toThrow(
        /already contains/,
      );

      const existing = new Database(join(stateDirectory, "gwrk.db"));
      try {
        existing.prepare("UPDATE runs SET id = 99 WHERE id = 42").run();
      } finally {
        existing.close();
      }
      await rm(devicePath);
      await mkdir(devicePath);
      const installedDb = join(stateDirectory, "gwrk.db");
      const original = await readFile(installedDb);
      await expect(
        restoreLedgerBackup({ ...request, force: true }),
      ).rejects.toThrow(/Restore target must be a regular file/);
      const pending = join(stateDirectory, ".restore-pending");
      await expect(stat(pending)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(installedDb)).toEqual(original);
      await rm(devicePath, { recursive: true });
      const realFs =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      let interrupted = false;
      vi.mocked(rename).mockImplementation(async (from, to) => {
        if (
          !interrupted &&
          from === join(pending, "install.db") &&
          to === installedDb
        ) {
          interrupted = true;
          throw new Error("Fixture interrupted database installation");
        }
        await realFs.rename(from, to);
      });
      try {
        await expect(
          restoreLedgerBackup({ ...request, force: true }),
        ).rejects.toThrow("Fixture interrupted database installation");
        expect((await stat(pending)).isDirectory()).toBe(true);
        await mkdir(devicePath);
        await expect(restoreLedgerBackup(request)).rejects.toThrow(
          /Restore target must be a regular file/,
        );
        expect((await stat(pending)).isDirectory()).toBe(true);
        await rm(devicePath, { recursive: true });
        expect((await restoreLedgerBackup(request)).manifest).toEqual(manifest);
      } finally {
        vi.mocked(rename).mockReset();
      }
      expect(JSON.parse(await readFile(devicePath, "utf8"))).toEqual(device);
      await expect(
        stat(join(stateDirectory, ".restore-pending")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const restored = new Database(join(stateDirectory, "gwrk.db"), {
        readonly: true,
      });
      try {
        expect(
          restored.prepare("SELECT id FROM runs ORDER BY id").pluck().all(),
        ).toEqual([42, 43]);
      } finally {
        restored.close();
      }
    } finally {
      db.close();
    }
  });

  it.each([
    ["a deleted completed run", "DELETE FROM runs WHERE id = 42"],
    ["a changed completed run", "UPDATE runs SET exit_code = 1 WHERE id = 42"],
    [
      "a changed history row",
      `UPDATE history SET metadata = '{"result":"changed"}' WHERE id = 1`,
    ],
  ])("rejects %s after a rollback restart", async (_change, statement) => {
    const db = seedLedger();
    const destination = join(root, "before-rollback");
    try {
      await createLedgerBackup({
        dbPath: db.name,
        destination,
        createdAt: "2026-11-11T12:00:00.000Z",
        gwrkVersion: "1.6.0-beta.1",
        collectDevice: () => null,
        collectRepositories: () => [],
      });
      await expect(
        verifyLedgerAgainstBackup(db.name, destination),
      ).resolves.toBeUndefined();
      db.prepare(statement).run();
      await expect(
        verifyLedgerAgainstBackup(db.name, destination),
      ).rejects.toThrow(/does not match the pre-rollback backup/);
    } finally {
      db.close();
    }
  });

  it("rejects a changed tracked task after a rollback restart", async () => {
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
    const taskDir = join(root, "specs", "001-fixture", ".gwrk");
    const task = join(taskDir, "tasks.json");
    git("init", "--quiet");
    await mkdir(taskDir, { recursive: true });
    const commitTask = async (status: string) => {
      await writeFile(task, JSON.stringify({ status }));
      git("add", task);
      git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "-m",
        "Record fixture task",
      );
    };
    await commitTask("completed");

    const db = seedLedger();
    const destination = join(root, "before-rollback");
    try {
      await createLedgerBackup({
        dbPath: db.name,
        destination,
        createdAt: "2026-11-11T12:00:00.000Z",
        gwrkVersion: "1.6.0-beta.1",
        collectDevice: () => null,
        collectRepositories: (projects) =>
          projects.map(({ id, path }) => readRepositoryEvidence(id, path)),
      });
      await expect(
        verifyLedgerAgainstBackup(db.name, destination),
      ).resolves.toBeUndefined();
      await commitTask("open");
      await expect(
        verifyLedgerAgainstBackup(db.name, destination),
      ).rejects.toThrow(/does not match the pre-rollback backup/);
    } finally {
      db.close();
    }
  });

  it("rejects tampering and keeps the source ledger intact", async () => {
    const db = seedLedger();
    const destination = join(root, "backup");
    try {
      await createLedgerBackup({
        dbPath: db.name,
        destination,
        createdAt: "2026-11-11T12:00:00.000Z",
        gwrkVersion: "1.6.0-beta.1",
        collectDevice: () => null,
        collectRepositories: () => [],
      });
      const metadata = join(destination, "repo-metadata.json");
      const original = await readFile(metadata);
      await appendFile(metadata, " ");
      await expect(verifyLedgerBackup(destination)).rejects.toThrow(
        /metadata digest mismatch/,
      );
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM projects").get(),
      ).toEqual({ count: 1 });
      expect(await readFile(metadata)).not.toEqual(original);
    } finally {
      db.close();
    }
  });
});

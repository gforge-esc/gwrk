/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  root = await mkdtemp(join(tmpdir(), "gwrk-ledger-proof-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function seedLedger() {
  const db = new Database(join(root, "active.db"));
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

function expectUsageFailure(result: ReturnType<typeof runCli>) {
  expect(result.status, result.stderr).toBe(2);
  const signals = result.stderr.match(/^\[exit:.*$/gm) ?? [];
  expect(signals).toHaveLength(1);
  expect(signals[0]).toMatch(/^\[exit:2 \| \d+(?:\.\d+)?m?s\]$/);
  expect(result.stdout).toBe("");
}

describe("installed ledger commands outside a checkout", () => {
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
          metadata: { device: null },
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
        metadata: { device: null },
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
          metadata: { device: null },
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
        metadata: { device },
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
        metadata: { device: null },
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
        metadata: { device: null },
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
        metadata: { device: null },
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

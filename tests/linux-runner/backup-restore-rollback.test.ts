/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLedgerBackup,
  restoreLedgerBackup,
  verifyLedgerAgainstBackup,
  verifyLedgerBackup,
} from "../../src/adapters/sqlite/ledger-backup.js";

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
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      finished_at TEXT,
      exit_code INTEGER
    );
    CREATE TABLE compression (id INTEGER PRIMARY KEY);
    CREATE TABLE history (id INTEGER PRIMARY KEY, metadata TEXT);
    INSERT INTO _migrations VALUES ('001-initial.sql');
    INSERT INTO projects VALUES ('pilot-repo');
    INSERT INTO runs VALUES (42, 'pilot-repo', '2026-11-11T12:00:00Z', 0);
    INSERT INTO runs VALUES (43, 'pilot-repo', NULL, NULL);
    INSERT INTO compression VALUES (1);
    INSERT INTO history VALUES (1, '{"result":"accepted"}');
  `);
  return db;
}

function runLedgerCommand(...args: string[]) {
  const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
  return spawnSync(
    process.execPath,
    [
      "--import",
      createRequire(import.meta.url).resolve("tsx"),
      cli,
      "db",
      ...args,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        GWRK_HOME: root,
        GWRK_DB_PATH: join(root, "active.db"),
        GWRK_RUNTIME_DIR: join(root, "runtime"),
      },
      encoding: "utf8",
    },
  );
}

describe("installed ledger commands outside a checkout", () => {
  it.each([
    { args: ["backup"], missing: "--out" },
    { args: ["backup", "--out"], missing: "--out value" },
    { args: ["restore", "--state-dir", "restored"], missing: "--from" },
    { args: ["restore", "--from", "backup"], missing: "--state-dir" },
  ])("reports a usage failure for db $args without $missing", ({ args }) => {
    const result = runLedgerCommand(...args);
    expect(result.status, result.stderr).toBe(2);
    expect(
      result.stderr.match(/^\[exit:2 \| \d+(?:\.\d+)?m?s\]$/gm) ?? [],
    ).toHaveLength(1);
    expect(result.stdout).not.toContain("[exit:");
  });

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
      db.exec("ALTER TABLE projects ADD COLUMN path TEXT");
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
    db.exec("ALTER TABLE projects ADD COLUMN path TEXT");
    db.prepare("UPDATE projects SET path = ?").run(root);
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
  it("preserves committed WAL state in a standalone snapshot and verifies its summary", async () => {
    const db = seedLedger();
    const destination = join(root, "backup");
    try {
      const result = await createLedgerBackup({
        dbPath: db.name,
        destination,
        createdAt: "2026-11-11T12:00:00.000Z",
        gwrkVersion: "1.6.0-beta.1",
        metadata: { device: null, repositories: [] },
      });
      db.exec("INSERT INTO projects VALUES ('after-backup')");
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
          metadata: { device: null, repositories: [] },
        }),
      ).rejects.toThrow(/already exists/);
      expect(await verifyLedgerBackup(destination)).toEqual(verified);
    } finally {
      db.close();
    }
  });

  it("restores a clean target and resumes a forced restore after an interrupted publish", async () => {
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
        metadata: { device, repositories: [] },
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
      await expect(
        restoreLedgerBackup({ ...request, force: true }),
      ).rejects.toThrow();
      expect(
        (await stat(join(stateDirectory, ".restore-pending"))).isDirectory(),
      ).toBe(true);
      const obstructed = new Database(join(stateDirectory, "gwrk.db"), {
        readonly: true,
      });
      try {
        expect(
          obstructed.prepare("SELECT id FROM runs ORDER BY id").pluck().all(),
        ).toEqual([43, 99]);
      } finally {
        obstructed.close();
      }
      await rm(devicePath, { recursive: true });
      expect(
        (await restoreLedgerBackup({ ...request, force: true })).manifest,
      ).toEqual(manifest);
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
        metadata: { device: null, repositories: [] },
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

  it("rejects tampering and keeps the source ledger intact", async () => {
    const db = seedLedger();
    const destination = join(root, "backup");
    try {
      await createLedgerBackup({
        dbPath: db.name,
        destination,
        createdAt: "2026-11-11T12:00:00.000Z",
        gwrkVersion: "1.6.0-beta.1",
        metadata: { device: null, repositories: [] },
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

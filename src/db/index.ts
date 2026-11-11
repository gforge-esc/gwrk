/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { resolveGwrkPaths } from "../domain/gwrk-paths.js";
const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

let _db: Database.Database | undefined;

/**
 * Get or create the global gwrk SQLite database connection.
 * Creates ~/.gwrk/ directory and runs migrations if needed.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    // WAL mode for better concurrent read performance
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }
  _db = db;
  return db;
}

/**
 * Get a database connection for testing (in-memory).
 */
export function getTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}

/**
 * Run all SQL migration files in order.
 * Tracks applied migrations in a _migrations table.
 */
function runMigrations(db: Database.Database): void {
  db.transaction(applyMigrations).immediate(db);
}

function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sha256 TEXT,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  safeAddColumn(db, "_migrations", "sha256", "TEXT");

  const applied = new Set(
    db
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file));
    const digest = createHash("sha256").update(sql).digest("hex");
    db.exec(sql.toString("utf8"));
    db.prepare("INSERT INTO _migrations (name, sha256) VALUES (?, ?)").run(
      file,
      digest,
    );
  }

  // Post-migration idempotent column additions.
  // These handle stale DBs where migrations were renumbered (e.g. 003→005).
  // SQLite lacks ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so we check first.
  safeAddColumn(db, "runs", "status", "TEXT");
  safeAddColumn(db, "runs", "merge_commit_sha", "TEXT");
  safeAddColumn(db, "runs", "device_id", "TEXT");
  safeAddColumn(db, "runs", "hostname", "TEXT");
  safeAddColumn(db, "runs", "tokens_in", "INTEGER");
  safeAddColumn(db, "runs", "tokens_out", "INTEGER");
  safeAddColumn(db, "runs", "cost_usd", "REAL");
  safeAddColumn(db, "issues", "html_url", "TEXT");

  // Project Scoping (Phase 14)
  const scopedTables = [
    "plan_features",
    "plan_phases",
    "plan_edges",
    "plan_proposals",
    "gate_results",
    "compression",
    "issues",
    "routing_history",
  ];
  for (const table of scopedTables) {
    safeAddColumn(db, table, "project_id", "TEXT");
  }
}

/**
 * Idempotent ALTER TABLE ADD COLUMN — no-op if column already exists.
 * SQLite lacks IF NOT EXISTS for ALTER TABLE, so we check pragma_table_info.
 */
function safeAddColumn(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  // Check if table exists
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  if (!tableExists) return;

  const cols = db
    .prepare("SELECT name FROM pragma_table_info(?)")
    .all(table) as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/**
 * Get the database file path (for display).
 */
export function getDbPath(): string {
  return _db?.name ?? resolveGwrkPaths(process.env, homedir()).database;
}

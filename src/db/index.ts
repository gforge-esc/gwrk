/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const GWRK_DIR = process.env.GWRK_DIR || path.join(os.homedir(), ".gwrk");
const DB_PATH = process.env.GWRK_DB_PATH || path.join(GWRK_DIR, "gwrk.db");
const MIGRATIONS_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "migrations",
);

let _db: Database.Database | undefined;

/**
 * Get or create the global gwrk SQLite database connection.
 * Creates ~/.gwrk/ directory and runs migrations if needed.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(GWRK_DIR, { recursive: true });

  _db = new Database(DB_PATH);

  // WAL mode for better concurrent read performance
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  runMigrations(_db);

  return _db;
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

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

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    db.exec(sql);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
  }

  // Post-migration idempotent column additions.
  // These handle stale DBs where migrations were renumbered (e.g. 003→005).
  // SQLite lacks ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so we check first.
  safeAddColumn(db, "runs", "status", "TEXT");
  safeAddColumn(db, "runs", "merge_commit_sha", "TEXT");
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
  return DB_PATH;
}

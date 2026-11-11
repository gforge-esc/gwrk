/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  computeLegacyProjectIds,
  computeProjectId,
} from "../domain/project-id.js";
import {
  canonicalProjectId,
  discoverVerifiedCheckout,
  normalizeRegistryRepo,
  prepareProjectLedgerLookup,
} from "./project-registry.js";

const GWRK_DIR = process.env.GWRK_DIR || path.join(os.homedir(), ".gwrk");
const DB_PATH = process.env.GWRK_DB_PATH || path.join(GWRK_DIR, "gwrk.db");
const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

const PROJECT_REGISTRY_MIGRATION =
  "014-project-registry-and-composite-keys.sql";

let _db: Database.Database | undefined;

/**
 * Get or create the global gwrk SQLite database connection.
 * Creates ~/.gwrk/ directory and runs migrations if needed.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  _db = openDatabase();
  return _db;
}

export interface SqliteDatabaseOptions {
  dbPath?: string;
  migrationsDir?: string;
}

export function openDatabase({
  dbPath = DB_PATH,
  migrationsDir = MIGRATIONS_DIR,
}: SqliteDatabaseOptions = {}): Database.Database {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const connection = new Database(dbPath);
  try {
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");
    runMigrations(connection, migrationsDir);
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

export function getTestDb(): Database.Database {
  return openDatabase({ dbPath: ":memory:" });
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
function runMigrations(db: Database.Database, migrationsDir: string): void {
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

  if (!fs.existsSync(migrationsDir)) return;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    if (file === PROJECT_REGISTRY_MIGRATION) {
      migrateProjectRegistry(db, sql);
    } else {
      db.transaction(() => {
        if (db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get(file))
          return;
        db.exec(sql);
        db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
      }).immediate();
    }
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

function migrateProjectRegistry(db: Database.Database, sql: string): void {
  // Use the same rebuild as standalone SQL and commit the checkout backfill with it.
  const begin = "BEGIN IMMEDIATE;";
  const start = sql.indexOf(begin);
  const end = sql.lastIndexOf("COMMIT;");
  if (start < 0 || end <= start)
    throw new Error("Missing migration 014 transaction boundaries");
  const rebuild = sql.slice(start + begin.length, end);

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      const migration = db.prepare("SELECT 1 FROM _migrations WHERE name = ?");
      if (migration.get(PROJECT_REGISTRY_MIGRATION)) return;
      safeAddColumn(db, "issues", "html_url", "TEXT");
      db.exec(rebuild);
      backfillCheckoutRoots(db);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(
        PROJECT_REGISTRY_MIGRATION,
      );
    }).immediate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function backfillCheckoutRoots(db: Database.Database): void {
  const projects = db
    .prepare("SELECT id, path, github_repo FROM projects WHERE path <> ''")
    .all() as { id: string; path: string; github_repo: string | null }[];
  const setRoot = db.prepare("UPDATE projects SET local_root = ? WHERE id = ?");
  const hasProject = db.prepare("SELECT 1 FROM projects WHERE id = ?");
  const addAlias = db.prepare(`
    INSERT INTO project_aliases (alias_id, project_id) VALUES (@alias, @id)
    ON CONFLICT(alias_id) DO NOTHING
  `);
  const hasRecords = prepareProjectLedgerLookup(db);
  const verified = [];
  for (const { id, path: checkout, github_repo } of projects) {
    const suffix = `#${id}`;
    const facts =
      discoverVerifiedCheckout(checkout) ??
      (checkout.endsWith(suffix)
        ? discoverVerifiedCheckout(checkout.slice(0, -suffix.length))
        : null);
    if (!facts) continue;
    const storedRepo = normalizeRegistryRepo(github_repo);
    const origin = normalizeRegistryRepo(facts.remoteOriginUrl ?? null);
    if (storedRepo !== null && storedRepo !== origin) continue;

    const canonical = computeProjectId(facts);
    const aliases = computeLegacyProjectIds(facts);
    const matchesPreOriginId =
      github_repo === null &&
      origin !== null &&
      facts.gitCommonDir &&
      id === computeProjectId({ ...facts, remoteOriginUrl: null });
    if (
      id !== canonical &&
      !matchesPreOriginId &&
      (!aliases.includes(id) || storedRepo !== origin)
    ) {
      continue;
    }

    setRoot.run(facts.projectRoot, id);
    verified.push({ id, canonical, origin, storedRepo, aliases });
  }

  const remoteOwners = new Set(
    verified
      .filter(
        ({ id, canonical, origin }) => id === canonical && origin !== null,
      )
      .map(({ id }) => id),
  );
  const storedProjects = new Map(projects.map((row) => [row.id, row]));
  for (const { id, canonical, origin, storedRepo, aliases } of verified) {
    const canonicalRow = storedProjects.get(canonical);
    const canonicalPath = canonicalRow?.path;
    const canonicalSuffix = `#${canonical}`;
    const missingCanonicalCheckout =
      canonicalPath !== undefined &&
      !fs.existsSync(canonicalPath) &&
      (!canonicalPath.endsWith(canonicalSuffix) ||
        !fs.existsSync(canonicalPath.slice(0, -canonicalSuffix.length)));
    const hasCanonicalOwner =
      remoteOwners.has(canonical) ||
      (origin !== null &&
        missingCanonicalCheckout &&
        normalizeRegistryRepo(canonicalRow?.github_repo ?? null) === origin);
    if (
      id !== canonical &&
      hasCanonicalOwner &&
      origin === storedRepo &&
      aliases.includes(id) &&
      canonicalProjectId(db, canonical) === canonical
    ) {
      addAlias.run({ alias: id, id: canonical });
    }
  }
  for (const { id, aliases } of verified) {
    const owner = canonicalProjectId(db, id);
    for (const alias of aliases) {
      // A path hash alone cannot establish ownership of an existing ledger.
      if (!hasProject.get(alias) && !hasRecords.get({ id: alias })) {
        addAlias.run({ alias, id: owner });
      }
    }
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

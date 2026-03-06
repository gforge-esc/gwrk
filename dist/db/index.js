import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const GWRK_DIR = path.join(os.homedir(), ".gwrk");
const DB_PATH = path.join(GWRK_DIR, "gwrk.db");
const MIGRATIONS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "migrations");
let _db;
/**
 * Get or create the global gwrk SQLite database connection.
 * Creates ~/.gwrk/ directory and runs migrations if needed.
 */
export function getDb() {
    if (_db)
        return _db;
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
export function getTestDb() {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    return db;
}
/**
 * Close the database connection.
 */
export function closeDb() {
    if (_db) {
        _db.close();
        _db = undefined;
    }
}
/**
 * Run all SQL migration files in order.
 * Tracks applied migrations in a _migrations table.
 */
function runMigrations(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
    const applied = new Set(db
        .prepare("SELECT name FROM _migrations")
        .all()
        .map((row) => row.name));
    if (!fs.existsSync(MIGRATIONS_DIR))
        return;
    const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();
    for (const file of files) {
        if (applied.has(file))
            continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
        db.exec(sql);
        db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    }
}
/**
 * Get the database file path (for display).
 */
export function getDbPath() {
    return DB_PATH;
}

import Database from "better-sqlite3";
/**
 * Get or create the global gwrk SQLite database connection.
 * Creates ~/.gwrk/ directory and runs migrations if needed.
 */
export declare function getDb(): Database.Database;
/**
 * Get a database connection for testing (in-memory).
 */
export declare function getTestDb(): Database.Database;
/**
 * Close the database connection.
 */
export declare function closeDb(): void;
/**
 * Get the database file path (for display).
 */
export declare function getDbPath(): string;

The prepared route store passes eight behavioral checks. Promotion orchestration and CLI composition remain open.

The first two prepared regressions required compare-and-set replacement and credential rejection without changing incumbent bytes. Both now pass. A later regression proved that unconfigured reads created managed directories. Reads now leave the filesystem unchanged.

The store writes discovery snapshots under .runs/models/discovery and immutable bundles under .runs/models/evaluations. Active pins use .gwrk/models/route-lock.<runner>.json. It validates workspace and runner scope and rejects unsafe identifiers and linked storage directories. Secret guards run before writes.

Route replacement compares the incumbent digest under an immediate SQLite transaction. The mutex database is private runtime coordination under .runs/models/route-writes.sqlite. It has no execution-ledger role. Process termination releases its lock. A validated replacement is fsynced in a temporary file and renamed over the active lock.

The concurrency fixture starts two processes. It pauses one writer before rename and starts the second against the same incumbent digest. One replacement succeeds. The other reports incumbent-changed. Further checks cover rollback restoration and immutable evaluation evidence.

The Phase 4 gate still requires src/commands/models.test.ts. Promotion application logic and the CLI remain missing. Do not claim Phase 4 complete from the storage checks. Merge the reviewed Phase 3 evidence contract before completing promotion and rollback integration.

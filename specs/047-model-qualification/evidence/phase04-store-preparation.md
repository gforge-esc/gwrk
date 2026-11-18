The prepared route store passes eight behavioral checks. Promotion orchestration and CLI composition remain open.

The first two prepared regressions required compare-and-set replacement and credential rejection without changing incumbent bytes. Both now pass. A later regression proved that unconfigured reads created managed directories. Reads now leave the filesystem unchanged.

The store writes discovery snapshots under .runs/models/discovery and immutable bundles under .runs/models/evaluations. Active pins use .gwrk/models/route-lock.<runner>.json. It validates workspace and runner scope and rejects unsafe identifiers and linked storage directories. Secret guards run before writes.

Route replacement compares the incumbent digest under an immediate SQLite transaction. The mutex database is private runtime coordination under .runs/models/route-writes.sqlite. It has no execution-ledger role. Process termination releases its lock. A validated replacement is fsynced in a temporary file and renamed over the active lock.

The concurrency fixture starts two processes. It pauses one writer before rename and starts the second against the same incumbent digest. One replacement succeeds. The other reports incumbent-changed. Further checks cover rollback restoration and immutable evaluation evidence.

The Phase 4 gate still requires src/commands/models.test.ts. Promotion application logic and the CLI remain missing. Do not claim Phase 4 complete from the storage checks. Merge the reviewed Phase 3 evidence contract before completing promotion and rollback integration.

The preparation branch now includes reviewed routing foundation `08f129e6` and qualification repair `5d08bc83`. Qualification phase 3 still needs independent clearance. Final integration must include its cleared feature head before phase 4 review.

The combined preparation passes 552 prerequisite checks and 690 phase 3 checks. It also passes 190 store, backend, prompt and unified-routing checks. The store's eight behavioral cases remain in that run. Build and repository lint pass. Evidence is `/tmp/gwrk-model-phase4-unified-foundation-green.log`.

The merge preserves explicit fixture log paths and timeout bounds. It preserves observed model evidence and environment deletion values. Native prompt conditioning now uses the reviewed template and user-input separation. The command and promotion modules remain open.

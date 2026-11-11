# Backup, rollback and pilot record contract

Online backups preserve the SQLite ledger and enrolled repository metadata across clean restores and rollbacks. Blocked for live sign-off until an operator records a real Linux host and worker run.

## Agent-native CLI commands

Phase 4 extends `src/commands/db.ts` under `ADR-004` with `withSignal`, `--format json` and navigation hints.

| Command | Classification | Flags | Output and exit contract |
|---|---|---|---|
| `gwrk db backup` | `generator` | `--out <dir>`, `--project-root <dir>`, `--format json` | Writes `gwrk.db`, `repo-metadata.json` and `backup-manifest.json`, emits `[exit:0 \| Xs]` on stderr |
| `gwrk db restore` | `mutator` | `--from <dir>`, `--state-dir <dir>`, `--force`, `--format json` | Verifies digests and SQLite integrity before writing state, emits `[exit:0 \| Xs]` on stderr |

Error states include actionable navigation hints:

- Missing backup manifest: `Backup manifest not found at <path>. Run 'gwrk db backup --out <dir>' to create a verified backup.`
- Active server on target state dir during restore: `Server is running against <stateDir> (pid: <pid>). Run 'gwrk server stop' before 'gwrk db restore'.`
- Non-empty target state dir without `--force`: `Target state directory <stateDir> already contains gwrk.db. Choose a clean directory or pass '--force'.`

## Consistent backup and clean restore payload

`src/adapters/sqlite/ledger-backup.ts` uses `better-sqlite3` `.backup()` from the SQLite Online Backup API. Write-Ahead Logging (WAL) readers or writers never produce a torn snapshot. After snapshot creation, the adapter opens the backup read-only. It asserts `PRAGMA integrity_check = ok` and zero rows from `PRAGMA foreign_key_check`.

```typescript
export interface LedgerSummary {
  readonly migrations: readonly string[];
  readonly projectIds: readonly string[];
  readonly completedRunIds: readonly number[];
  readonly compressionCount: number;
  readonly historyCount: number;
  readonly enrolledRepoDigests: Readonly<Record<string, string>>;
}

export interface BackupManifest {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly gwrkVersion: string;
  readonly dbSha256: string;
  readonly metadataSha256: string;
  readonly summary: LedgerSummary;
}
```

`repo-metadata.json` records `device.json` and all `projects` rows. For each available enrolled pilot repository, it records the credential-free remote URL and HEAD SHA. An unavailable checkout has a null HEAD and empty evidence. It also records the SHA-256 digest of `specs/*/.gwrk/tasks.json` and `specs/*/.gwrk/runs/` manifests. It never copies `GWRK_SECRETS_DIR` or `.gwrkrc.local.json` secrets.

Run restore as the Linux service user and use the service runtime directory. Stage verified payloads before publishing an in-progress marker. The server waits for the operator to finish an interrupted restore with the original backup. Leave the target intact until the restored state passes validation. Clean restore verifies `dbSha256` and `metadataSha256` before writing `gwrk.db` and `device.json` into `stateDir`. It re-opens the restored database and runs `compareLedgerSummary`. Any mismatch in seeded `projects` or completed `runs` fails closed. Mismatches in `compression` rows or `history` count also fail closed.

## Upgrade and rollback procedure

`deploy/linux-runner/rollback-release.sh` reverts `<releaseRoot>/current` to `<releaseRoot>/previous` or an explicit `<targetVersion>`:

1. Read `<releaseRoot>/releases/<version>/release-manifest.json` and verify its release files exist.
2. Read applied `_migrations` names from `<stateRoot>/gwrk.db`. Compare their digests in the verified current and target manifests. Reject a target that would apply any additional migration.
3. If `allowed === false`, print the blocking migration names to stderr and exit `1` before changing `current`.
4. If `allowed === true`, stop accepting work and stop the supervisor. Run `gwrk db backup` against quiesced state.
5. Atomically switch `current` to the target release and start the supervisor.
6. Verify accepted work counts match the pre-rollback summary.

## Repeatable Linux container harness vs live pilot record

| Verification tier | Entrypoint | Credentials and host | Evidence scope |
|---|---|---|---|
| Offline unit and integration | `pnpm exec vitest run src/domain/release-packaging.test.ts tests/linux-runner/*.test.ts` | Temp dirs and synthetic fixtures | Domain laws, packaging, lock contention, backup restore and rollback guard |
| Clean Linux container suite | `node tests/linux-runner/container-harness.mjs` | Local Linux Node 22 container, bare Git repo and synthetic headless agent binary | Clean install without source checkout, supervised crash recovery, clean restore and rollback |
| Live pilot operator record | `deploy/linux-runner/live-pilot-record.example.md` | Provisioned Linux host, real pilot repo credential and approved hosted agent | Separate operator sign-off kept in operator-managed storage |

| Live pilot record field | Initial template state |
|---|---|
| Operator and date | `Pending` |
| Release version and SHA-256 digest | `Pending` |
| Linux host and service identity | `Pending` |
| `041` Google gateway proof reference | `Pending` |
| Pilot repository and credential owner | `Pending` |
| Approved agent backend and model pin | `Pending` |
| Credential revocation check result | `Pending` |
| Observed unattended worker run ID | `Pending` |

Passing `container-harness.mjs` never marks live pilot checks complete. Operators store the completed live record outside Git.

The fixture preserves persisted ledger and repository evidence. Verify recovery of accepted jobs that were still queued in the integrated pilot after durable dispatch ships.

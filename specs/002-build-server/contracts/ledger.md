# Contract: Execution Ledger

**Feature**: 002-build-server

## `insertRun(run: RunRecord)`

**Consumed by**: Ship Loop after completion.

**Input Types**:
```typescript
interface RunRecord {
  feature_id: string;
  phase_id: string;
  agent_backend: string;
  started_at?: string;
  finished_at?: string;
  exit_code?: number;
  log_file?: string;
  duration_s?: number;
}
```

**Actions**:
Inserts a new row into the SQLite `runs` table.

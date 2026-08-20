# Contract: findings ledger (FR-009)

**Module**: `src/engine/findings-ledger.ts` (new — Phase 03)
**Spec**: FR-009, US-004, TC-008, TC-009 | **Shape**: [../data-model.md](../data-model.md)

The store of record for a blocking review finding. `task.description` is the mirror; this file is the truth. Existing entries are unreachable through the normal write path, so the D3 erasure (`48c3ea6`, `5b29881`) cannot recur.

## Types

```ts
export const FindingSchema = z.object({
  taskId: z.string().regex(/^T\d{3}$/),
  phaseId: z.string().regex(/^phase-\d{2}$/),
  stage: z.enum(["code-review", "uat-review"]),
  text: z.string().min(1),
  recordedAt: z.string().datetime(),
});

export type Finding = z.infer<typeof FindingSchema>;
```

## `findingsPath(featureDir: string): string`

| | |
|---|---|
| **Accepts** | `featureDir` — absolute path to `specs/<feature-id>` (the same argument `loadTaskState` takes) |
| **Returns** | `<featureDir>/.gwrk/findings.jsonl` |
| **Side effects** | None. Does not create the file or the directory |
| **Throws** | Never |

Exported so `revertSourceMutations()` can snapshot the exact path it must preserve, rather than re-deriving it and drifting.

## `appendFinding(featureDir: string, finding: Finding): void`

| | |
|---|---|
| **Accepts** | `featureDir`; `finding` — validated through `FindingSchema` before any write |
| **Returns** | `void` |
| **Side effects** | Creates `<featureDir>/.gwrk/` if absent, then **appends** one newline-terminated JSON line via `fs.appendFileSync`. Never reads the existing file, never rewrites it, never truncates it |
| **Throws** | On `FindingSchema` failure (fail-fast: nothing malformed enters the ledger). On an unwritable path, the underlying `fs` error propagates — a finding that cannot be recorded MUST be loud, since silence is the defect under repair |

**Append-only is structural, not a convention.** There is no code path in this module that opens the file for writing with truncation, and no function that takes an index or an id to update. Rewriting an entry is not forbidden by policy; it is unexpressible through the exported surface. This is what TR-009's `"the ledger is append-only"` case asserts.

## `readFindings(featureDir: string): Finding[]`

| | |
|---|---|
| **Accepts** | `featureDir` |
| **Returns** | Every valid entry, in file order (oldest first). `[]` when the file does not exist |
| **Side effects** | Read only |
| **Throws** | **Never.** A missing file returns `[]`. A line that is not valid JSON, or that fails `FindingSchema`, is skipped |

The skip-on-malformed rule is deliberate and asymmetric with the write side: the ledger exists so a finding survives damage elsewhere, so one bad line must not take the rest of the file down with it. See [../data-model.md](../data-model.md) § Read semantics.

## Orchestrator integration (`src/engine/ship-orchestrator.ts`)

### Append site — `executeReviewWorkflow`

After `revertSourceMutations()` (step 3) and before `readVerdict()` (step 4), for each task in `ReviewFindings.all`:

```ts
appendFinding(featureDir, {
  taskId,
  phaseId: this.config.phaseId,
  stage: workflowName.includes("uat") ? "uat-review" : "code-review",
  text: <the task's post-dispatch description>,
  recordedAt: new Date().toISOString(),
});
```

Ordering is load-bearing: appending **after** the revert means this dispatch's entries cannot be reverted, and **before** `readVerdict` means they are recorded even if gate execution later throws.

### Preservation site — `revertSourceMutations`

`findingsPath(featureDir)` is snapshotted into memory alongside `tasksJsonPath` before `git checkout -- .` / `git clean -fd`, and restored after — same mechanism, same function, same reason.

Why this is required rather than defensive: the file is not git-ignored, so while untracked it is exactly what `git clean -fd` removes. Without the snapshot, an earlier iteration's findings would be deleted by the **next** review dispatch's revert — reintroducing D3 through a different door.

## Test surface (TR-009)

`src/engine/ship-orchestrator.findings-ledger.test.ts`:

| Case | Asserts |
|---|---|
| `"a recorded finding survives a description overwrite"` | Record a finding, simulate a later agent overwriting `task.description`, and read the finding back from the ledger unchanged |
| `"the ledger is append-only"` | An attempt to rewrite or delete an existing entry through the normal write path does not remove it; a second `appendFinding` grows the file and leaves line 1 byte-identical |

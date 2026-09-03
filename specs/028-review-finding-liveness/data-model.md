# Data Model: 028 Review-Finding Liveness

**Spec**: [spec.md](./spec.md) §5 | **Plan**: [plan.md](./plan.md) Phase 03

This feature introduces **one** persisted structure: the append-only findings store required by FR-009. Everything else operates on existing shapes.

## No SQLite change

Per TC-008, computing a review verdict MUST require only the git working tree — `tasks.json` plus gate scripts. The findings store is therefore a **filesystem sibling of `tasks.json`**, not a table:

- No migration in `src/db/migrations/`.
- No `better-sqlite3` import in `src/engine/findings-ledger.ts` (asserted by the Phase 03 gate).
- The verdict path works from a bare clone with no build server running.

## Storage location (OQ-001 — resolved)

`specs/<feature-id>/.gwrk/findings.jsonl` — one JSON object per line, UTF-8, newline-terminated.

The spec offered two options. The line-oriented sibling file is chosen because D3's erasure mode is precisely a **whole-file rewrite**: `48c3ea6` and `5b29881` each deleted a real finding that way. A `findings[]` array inside `tasks.json` would inherit that exposure — every agent that rewrites `tasks.json` with `jq` becomes a potential eraser — and would widen `PhaseSchema`. A JSONL file written only with `fs.appendFileSync` has no read-modify-write step to lose data in.

**The cost the spec flagged, and how it is paid.** A sibling file must be explicitly preserved across the review revert or it is discarded with the rest of the agent's output. Verified: `specs/028-review-finding-liveness/.gwrk/findings.jsonl` is **not** matched by `.gitignore`, so the `git clean -fd` inside `revertSourceMutations()` would delete it while untracked. The ledger therefore receives the same snapshot-and-restore treatment `tasks.json` already gets in that function — an in-memory read before the restore, a write after — rather than relying on a `git clean --exclude` glob.

Ordering makes this airtight for the current dispatch: `revertSourceMutations()` runs at step 3 of `executeReviewWorkflow`, and ledger appends happen at step 4. The snapshot/restore exists to protect **earlier iterations'** entries, which are on disk when a later review dispatch reverts.

## Entities

| Entity | Location | Mutability |
|---|---|---|
| `Finding` | `specs/<feature-id>/.gwrk/findings.jsonl` | **Append only.** Existing entries are never rewritten or deleted through the normal write path |
| `task.description` | `specs/<feature-id>/.gwrk/tasks.json` (existing shape) | Human-readable mirror. Lossy by design — every later agent may rewrite it. **Not** the store of record |

### `Finding`

One line of `findings.jsonl`:

```json
{"taskId":"T005","phaseId":"phase-05","stage":"code-review","text":"REVIEW FAIL (code): the dashboard surface renders before the query resolves…","recordedAt":"2026-08-20T18:04:11.294Z"}
```

| Field | Type | Constraint | Notes |
|---|---|---|---|
| `taskId` | `string` | `/^T\d{3}$/` | Matches `TaskSchema.id` in `src/utils/state.ts` |
| `phaseId` | `string` | `/^phase-\d{2}$/` | Matches `PhaseSchema.id`. Zero-padded — the bare-number form is D9 |
| `stage` | `"code-review" \| "uat-review"` | enum | Derived from the workflow name: `uat` → `uat-review`, otherwise `code-review` |
| `text` | `string` | `.min(1)` | The finding text as the agent wrote it. Never truncated on write |
| `recordedAt` | `string` | ISO 8601 datetime | When the orchestrator recorded it, not when the agent wrote it |

### Zod schema

Defined in `src/engine/findings-ledger.ts`, co-located with its consumers per the project convention:

```ts
import { z } from "zod";

export const FindingSchema = z.object({
  taskId: z.string().regex(/^T\d{3}$/),
  phaseId: z.string().regex(/^phase-\d{2}$/),
  stage: z.enum(["code-review", "uat-review"]),
  text: z.string().min(1),
  recordedAt: z.string().datetime(),
});

export type Finding = z.infer<typeof FindingSchema>;
```

## Read semantics

`readFindings` parses line by line and **skips** any line that is not valid JSON or fails `FindingSchema`, rather than throwing. Rationale: the ledger's purpose is to make a finding recoverable after a later agent damaged the mirror. A single malformed line — a partial write, a stray edit — must not make every other recorded finding unreadable. This is a deliberate, scoped exception to the repository's fail-fast rule, of the same kind TC-002 grants FR-010's verdict parse, and for the same reason: the failure mode being avoided is *losing evidence*.

Write-side validation is strict: `appendFinding` parses through `FindingSchema` and throws on a malformed entry, so nothing invalid enters the file.

## Existing shapes — unchanged

| Shape | Location | Change |
|---|---|---|
| `TaskSchema`, `PhaseSchema`, `TaskStateSchema` | `src/utils/state.ts` | **None.** No new fields, so no re-`define` and no migration of existing `tasks.json` files |
| `ReviewResult.verdict` | `src/plugins/review-plugin.ts:45` | **None.** An existing declared field, currently consumed nowhere; FR-010 consumes it in one direction |
| `ReviewFindings` | `src/engine/ship-orchestrator.ts` | New **in-memory** type (Phase 02), not persisted. See [contracts/review-verdict.md](./contracts/review-verdict.md) |

# Contract: ship.ts — CLI Ship Command

**Source**: `src/commands/ship.ts`
**FRs**: FR-001, FR-009, FR-011, FR-012, FR-013, FR-014, FR-015

## Methods

### `shipPhase(feature, phase, backend, opts, cwd): Promise<number>`

Delegates a single phase to `work-until-done.sh`.

**Parameters**:
| Name | Type | Source |
|---|---|---|
| `feature` | `string` | CLI `<feature>` argument |
| `phase` | `string` | Normalized phase number (strips `phase-` prefix) |
| `backend` | `AgentBackend` | Resolved from `--agent` > programmatic > `.gwrkrc.json` (FR-009) |
| `opts` | `Record<string, string \| boolean \| undefined>` | `--max-iterations`, `--ci-timeout`, `--dry-run` |
| `cwd` | `string` | `process.cwd()` |

**Returns**: Exit code (0 = success, non-zero = failure).

**Pre-conditions** (FR-001):
- `specs/<feature>/spec.md` MUST exist. Missing → `return 1`, no side effects.
- Test files MUST exist for phase tasks. Missing → `blocked()`, `throw CommandError(…, 1)`.

**Side effects**:
- `startRun()` → SQLite `runs` table (FR-011)
- `writeManifest(featureDir, manifest)` → `specs/<feature>/.gwrk/runs/*.json` (FR-012)
- Manifest MUST include `digest: string[]` array (FR-012 + FR-017). **Currently missing.**
- `recordHistory()` → SQLite history
- `notifySlack()` → Slack (003 dependency)

**Error behavior**:
- Shell script error → catch, extract `.code`, call `finishRun(runId, { exit_code, duration_s })`
- Manifest write failure → `console.warn`, non-fatal

---

### `shipCommand` (Commander action)

Top-level `gwrk ship <feature> [phase]` command.

**FR-013**: When `phase` is omitted, read all phases from `tasks.json` via `loadTaskState()`, ship each sequentially, stop on first non-zero exit.

**FR-014**: Before dispatching each phase, check `phaseData.tasks.every(t => t.status === "completed")`. If all complete → skip with log message `⏭  Phase NN: all tasks complete — skipping`. **Currently checks only "completed", spec also requires "cancelled" to count as skippable.**

**FR-015**: Wrap terminal output in `[exit:N | Xs]` format per ADR-004. Support `--format json`. **Currently missing entirely.**

**FR-009**: Agent hierarchy: `--agent` CLI flag > programmatic `backend` parameter > `.gwrkrc.json agents.implement`. Missing config → `process.exit(1)`. **Currently falls through to undefined if `.gwrkrc.json` missing — needs Zod fail-fast.**

---

### `isPhaseComplete(phaseData): boolean` — **TO BE CREATED**

Determines if a phase should be skipped due to all tasks being terminal (`completed` or `cancelled`).

**Input**: `Phase` (from `state.ts` Zod schema)
**Returns**: `true` if every task in the phase has `status === "completed" || status === "cancelled"`
**Referenced by**: FR-014

---

### `assembleDigest(eventsFile): string[]` — **TO BE CREATED**

Reads the `.events` sidecar file produced by `work-until-done.sh` and returns a `string[]` for the execution manifest's `digest` field.

**Input**: Path to `.runs/<feature>_p<phase>.events`
**Returns**: Array of structured event strings, e.g. `["BRANCH_SETUP: created feat/004-ship-loop from develop (0.3s)", ...]`
**Referenced by**: FR-012, FR-017

---

## Manifest Schema (FR-012)

Current `ExecutionManifestSchema` in `src/utils/manifest.ts` is missing:
- `digest: z.array(z.string()).default([])` — structured log summary from sidecar events

Target schema extends current with:
```typescript
digest: z.array(z.string()).default([]),
```

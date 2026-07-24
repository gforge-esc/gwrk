# Contract: Plan Format Grammar & Plan-Gate Validator

**Feature**: 023-plan-format-contract
**Scope**: Internal gwrk service contracts (no cross-spec public API, no new DB schema). Reuses ADR-003 `TaskState`/`Phase` and ADR-005 §10 `gate-quality`.

This contract defines (1) the canonical plan-format grammar the parser MUST recognize and (2) the method-level surface of the FR-006 self-validation used by `gwrk define plan`.

---

## 1. Parser grammar contract — `src/engine/plan-to-tasks.ts`

### Method: `parsePlanMarkdown(planContent: string): ParsedPhase[]`

Deterministic, LLM-free (TC-005). Recognizes the canonical constructs below IN ADDITION to the existing `####`+prose-bullet and paren-form grammar (additive; FR-004/TC-004).

```ts
interface ParsedPhase {
  number: number;
  title: string;
  files: { path: string; action: string; description: string }[];
  doneWhen: string[];        // fenced-bash block lines OR prose bullets
  testTargets: string[];     // backticked targets from #### Test Strategy rows
  isCompleted: boolean;
}
```

#### Construct 1 — Fenced-bash Done-When (FR-001, TR-001)
- **Input**: a `#### Done When` section whose body is a fenced bash code block.
- **Behavior**: capture the block contents verbatim; the resolved phase gate `gateScript` equals that block (NOT the `echo "Phase N: …"` stub).
- **Backward compat**: a `#### Done When` body of prose `- bullet` lines is parsed as today (descriptive, non-executable).

#### Construct 2 — Em-dash file lines (FR-002, TR-002)
- **Input**: `` - `path` — **action** — description `` where `action ∈ {create, amend, delete}`.
- **Output**: `{ path, action, description }` (backticked path + bold action captured).
- **Task derivation**: `create` → new-file task (title `Create <basename>`, `sp: 2`; parity with the legacy `NEW` branch); `amend` → modify task (title `Modify <basename>`, `sp: 1`); `delete` → delete task.
- **Non-collapse guarantee**: a phase built entirely from em-dash file lines MUST produce per-file tasks, never the phase-title last-resort stub.
- **Error state**: a `- ` line matching neither em-dash nor paren form is non-fatal and ignored.

#### Construct 3 — Type-flexible Test Strategy rows (FR-003, TR-003)
- **Input**: a `#### Test Strategy` table row `| TR-### | <Type> | \`<Target>\` | <Assertion> |` where `<Type>` is bare (`integration`) or bracketed (`[integration]`), Type ∈ {unit, integration, gate}, and `<Target>` is a backticked test file or command.
- **Output**: `<Target>` appended to `phase.testTargets`.
- **Consumed by**: 021-polyglot-toolchain FR-005 (declared-target discovery reads `phase.testTargets`).

#### Construct 4 — Backward compatibility (FR-004, TR-004/TR-008)
- Existing paren-form file lines `` - `path` (ACTION: desc) `` and `####`+prose-bullet Done-When bodies parse to the identical phase/task/gate result as before the change.

#### Fatal error (unchanged)
- No `### Phase N: Title` heading found → throw `No phases found in <path>. Expected '### Phase N: Title' headings.` (exit 1).

---

## 2. Plan-gate validator contract — `src/engine/plan-gate-validator.ts`

### Type: `PlanGateReport`

```ts
interface PlanGateViolation {
  phaseId: string;   // e.g. "phase-03"
  title: string;     // phase title
  gateScript: string; // the resolved (hollow) gate
}

interface PlanGateReport {
  ok: boolean;                    // true when every source-bearing phase has a non-hollow gate
  violations: PlanGateViolation[]; // one per source-bearing phase resolving to a stub
}
```

### Method: `validatePlanGates(featureDir: string, featureId: string, opts?: { profile?: ProjectProfile }): PlanGateReport`

- **Accepts**: the feature directory (containing `plan.md`) and feature id.
- **Does**: parse `plan.md` via `parsePlanMarkdown` + resolve gates via the same path `planToTasks` uses; for each **source-bearing phase** (declares ≥1 file line AND/OR a `#### Done When` section), evaluate `isHollowGate(resolvedGateScript)`.
- **Returns**: `PlanGateReport`. `ok === false` iff ≥1 source-bearing phase resolves to a hollow stub.
- **Non-violations**: a phase whose gate is `unauthoredGate(...)` (`echo …; exit 1`) is an honest failing gate — NOT hollow — and MUST NOT appear in `violations` (guaranteed by `isHollowGate` returning `false` on any `exit [1-9]`).
- **Purity**: no network, no DB (TC-001); deterministic.

### Integration hook — `src/commands/define-plan.ts`

- After `orchestrator.runLoop(...)` succeeds and BEFORE `commitAllClean(...)`, call `validatePlanGates(featureDir, feature)`.
- On `report.ok === false`: throw `CommandError` (exit 1) whose message, for each violation, reads:
  `define plan: <phaseId> "<title>" resolves to a stub gate (no executable Done-When). Author a fenced bash Done-When block. See docs/grounding/023-plan-format-contract.md.`
- On unparseable plan (no phases): the existing `No phases found…` error surfaces (exit 1).
- Signal contract (ADR-004): exit 0 valid; exit 1 stub-gate detected or unparseable; error-as-navigation on stderr; `[exit:N | Xs]` wrapper preserved via `withSignal`.

> NOTE: The spec's FR-006 Error-States table cites `docs/grounding/022-plan-format-contract.md` — a stale pre-renumber reference. The implementation MUST emit `docs/grounding/023-plan-format-contract.md`.

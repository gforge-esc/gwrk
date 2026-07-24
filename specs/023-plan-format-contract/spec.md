# Feature Specification: 023 Plan Format Contract

**Feature Branch**: `023-plan-format-contract`
**Created**: 2026-07-24
**Status**: Draft
**Input**: Align gwrk's plan→tasks parser with the canonical plan authoring format so a phase's Done-When compiles to an executable gate instead of an echo stub; update the `gwrk-plan` generator to emit that format; and make `define` validate its own output — failing loudly when a source-bearing phase resolves to a stub gate.
**Authoritative source**: [`docs/grounding/022-plan-format-contract.md`](../../docs/grounding/022-plan-format-contract.md) (verified problem, evidence, canonical format, scope, acceptance). *Note: the grounding brief is numbered 022; this spec is authored at 023 per the feature request.*

---

## 1. Overview

gwrk's plan→tasks parser (`src/engine/plan-to-tasks.ts`) and the format plans are actually authored in have drifted apart. When the parser cannot extract a phase's real gate, it falls through to a **hollow `echo "Phase N: …"` stub that always exits 0**. The ship loop's mechanical `TEST_GATE` then passes on the stub while the phase's real behavioral gate never runs — a **false-green** that surfaces only much later.

**Motivating case** (data-dashboard `002-metric-model`, phase-03): the plan's Done-When is `make test:db` (Docker + migrated Postgres). The generated `gateScript` is `echo "Phase 3: …"`. `gwrk gate 002-metric-model` reports **3/3 PASS**, yet `make test:db` actually **fails 0/2** (`src/lib/db/client.js:24` uses a bare `new PrismaClient()`, which Prisma 7 rejects). gwrk cannot see the failure; the ship that produced 002 was false-green for exactly this reason.

**Root cause**: the parser encodes one grammar, real plans are authored in another, and **nothing validates that a generated plan yields executable gates**. This feature establishes the canonical plan format as a contract, aligns the parser and generator to it, and closes the loop by making `define` self-validate.

Three coordinated changes (all committed):
- **A. Parser** (`src/engine/plan-to-tasks.ts`) reads the canonical format — fenced-bash Done-When → executable `gateScript`; em-dash file lines; Type-flexible Test Strategy table — while continuing to parse existing `####`+prose-bullet plans (backward compatible).
- **B. Generator** (`src/plugins/builtins/workflows/gwrk-plan/PROMPT.md`) emits the canonical format going forward.
- **C. `define` self-validation** — after generating `plan.md`, `gwrk define plan` runs the parser on it; if any source-bearing phase resolves to a hollow/echo stub gate, `define` **fails loudly** rather than silently emitting a stub. This closed loop is the durable prevention.

### Canonical plan format (the contract)

Per phase:
- **Section headings** use `####` (h4): `#### Test Strategy`, `#### Done When`. The `**bold:**` form is not canonical.
- **Done When** body is a fenced ` ```bash ` block — the only executable form. That block becomes the phase's executable gate verbatim.
- **File lines** use the em-dash form: `` - `path` — **action** — description `` where `action ∈ {create, amend, delete}`. The parser extracts the backticked path + the bold action.
- **Test Strategy** is a table `| TR | Type | Target | Assertion |` where `Type ∈ {unit, integration, gate}` (bare or `[bracketed]`) and `Target` is backticked (a test file or a command).

### Out of scope

- Authoring real executable gates for gwrk's own 13 specs (content work, not a parser fix).
- The throwaway migration script that normalizes existing plans (temporary, uncommitted — not a deliverable of this feature).
- Any change to how `gwrk gate` / `gwrk ship` *execute* a gate under liveness — that contract is owned by [021 FR-009](../021-polyglot-toolchain/spec.md). This feature only guarantees the executable gate is *extracted*, not swallowed by the stub fallback.

---

## 2. User Scenarios & Testing

### US-001 - Fenced-bash Done-When compiles to an executable gate (Priority: P0)
As a plan author, when I write a phase's `#### Done When` as a fenced ` ```bash ` block, gwrk compiles that block verbatim into the phase's executable gate — not a hollow `echo` stub — so `gwrk gate` runs my real assertion.

**Implements**: FR-001

**Independent Test**: Parse a fixture plan whose phase Done-When is a fenced-bash `make test:db` block; assert the resolved `gateScript` is that command, not `echo "Phase…"`.

**Acceptance Scenarios**:
1. **Given** a `plan.md` whose Phase 3 `#### Done When` is a fenced ` ```bash ` block containing `make test:db`, **When** the parser generates `tasks.json`, **Then**:
   - `pnpm vitest run src/engine/plan-to-tasks.test.ts -t "fenced-bash Done-When"` exits 0
   - the phase's resolved gate contains `make test:db` and does NOT match `^echo "Phase`: `jq -r '.phases[2].tasks[].gateScript' specs/_fixtures/plan-format/.gwrk/tasks.json | grep -q 'make test:db'` exits 0

### US-002 - Em-dash file lines are extracted (Priority: P0)
As a plan author using the canonical em-dash file-line form `` - `path` — **action** — description ``, gwrk extracts my files so a phase's tasks are derived from its real file set instead of collapsing to a single phase-title stub.

**Implements**: FR-002

**Independent Test**: Parse a phase with two em-dash file lines; assert two file entries with the expected paths and actions are produced.

**Acceptance Scenarios**:
1. **Given** a phase whose Files block contains `` - `src/lib/db/client.js` — **create** — Prisma client singleton ``, **When** the parser runs, **Then**:
   - `pnpm vitest run src/engine/plan-to-tasks.test.ts -t "em-dash file lines"` exits 0
2. **Given** a phase authored entirely in em-dash file form, **When** the parser runs, **Then** the phase does NOT collapse to the phase-title last-resort task:
   - `pnpm vitest run src/engine/plan-to-tasks.test.ts -t "em-dash phase does not collapse"` exits 0

### US-003 - Type-flexible Test Strategy targets are parsed (Priority: P1)
As a plan author, my `#### Test Strategy` table rows are parsed into the phase's `testTargets` whether the Type token is bare (`integration`) or bracketed (`[integration]`), so downstream declared-target discovery ([021 FR-005](../021-polyglot-toolchain/spec.md)) sees them.

**Implements**: FR-003

**Independent Test**: Parse a Test Strategy table with a `[integration]` row whose Target is a backticked path; assert the path appears in `phase.testTargets`.

**Acceptance Scenarios**:
1. **Given** a row `| TR-004 | [integration] | \`tests/db/definitions.test.js\` | lifecycle |`, **When** the parser runs, **Then**:
   - `pnpm vitest run src/engine/plan-to-tasks.test.ts -t "bracketed Test Strategy type"` exits 0

### US-004 - Existing plans still parse (backward compatibility) (Priority: P0)
As gwrk itself, my existing `####`+prose-bullet plans (13 specs) and paren-form file lines continue to parse with no regression after the parser is aligned to the canonical format.

**Implements**: FR-004

**Independent Test**: Parse a golden fixture of an existing gwrk `####`+bullet plan; assert the phase/task count and gate scripts are unchanged from the pre-change baseline.

**Acceptance Scenarios**:
1. **Given** a real gwrk `####`+prose-bullet plan and a paren-form file line `` - `src/x.ts` (NEW: desc) ``, **When** the parser runs, **Then**:
   - `pnpm vitest run src/engine/plan-to-tasks.test.ts -t "backward-compatible ####+bullet"` exits 0

### US-005 - Generator emits the canonical format (Priority: P1)
As the `gwrk-plan` generator, I emit plans in the canonical format (`####` sections, fenced-bash Done-When, em-dash file lines, Type-flexible Test Strategy table) so new plans yield executable gates by construction.

**Implements**: FR-005

**Independent Test**: Assert `gwrk-plan/PROMPT.md` documents the canonical format (fenced-bash Done-When and em-dash file lines) as the required output shape.

**Acceptance Scenarios**:
1. **Given** the generator prompt, **When** its output contract is inspected, **Then**:
   - `grep -q '```bash' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` exits 0
   - `grep -Eq 'action.*create.*amend.*delete|— \*\*action\*\* —' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` exits 0

### US-006 - `define` fails loudly on a stub gate (Priority: P0)
As a developer running `gwrk define plan`, if a source-bearing phase in the generated `plan.md` resolves to a hollow/echo stub gate (no executable Done-When), `define` fails with a clear corrective message and exit 1 instead of silently producing a false-green plan.

**Implements**: FR-006

**Independent Test**: Run the plan-gate validator on a fixture plan whose source-bearing phase has only a prose Done-When; assert it reports the phase and exits 1. On a fixture with a fenced-bash gate, assert exit 0.

**Acceptance Scenarios**:
1. **Given** a generated `plan.md` whose source-bearing Phase 3 has only prose bullets under `#### Done When` (no fenced-bash block), **When** `define` validates it, **Then**:
   - `pnpm vitest run src/commands/define-plan.test.ts -t "fails on stub-gate phase"` exits 0 (the test asserts the validator exits 1 with the phase named)
2. **Given** a generated `plan.md` whose every source-bearing phase has a fenced-bash Done-When, **When** `define` validates it, **Then**:
   - `pnpm vitest run src/commands/define-plan.test.ts -t "passes on executable gates"` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: The parser MUST recognize a `#### Done When` body authored as a fenced ` ```bash ` block, capture the block's contents, and compile it verbatim into the phase's executable gate (`gateScript`) instead of discarding it (which forces the echo-stub fallback). Prose-bullet Done-When bodies remain parsed as today. (Implements: US-001)
- **FR-002**: The parser MUST extract file lines in the em-dash form `` - `path` — **action** — description `` where `action ∈ {create, amend, delete}`, capturing the backticked `path` and the bold `action`. Task-title/SP derivation MUST treat `create` as a new-file task (parity with today's `NEW` branch) and `amend`/`delete` as modify/delete. (Implements: US-002)
- **FR-003**: The parser MUST parse `#### Test Strategy` table rows whose `Type` token is bare or `[bracketed]` (e.g. `integration` or `[integration]`) and whose `Target` is a backticked test file or command, appending the target to `phase.testTargets`. (Implements: US-003)
- **FR-004**: The parser MUST continue to parse the existing `####`+prose-bullet Done-When and paren-form file lines (`` - `path` (ACTION: desc) ``) with no regression across gwrk's 13 existing specs. New grammar is additive, not a replacement. (Implements: US-004)
- **FR-005**: `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` MUST instruct the generator to emit the canonical format: `####` section headings, fenced ` ```bash ` Done-When blocks, em-dash file lines with `action ∈ {create, amend, delete}`, and a Type-flexible Test Strategy table. (Implements: US-005)
- **FR-006**: After generating `plan.md`, `gwrk define plan` MUST run the parser over it and, for every **source-bearing phase** (a phase that declares ≥1 file line and/or a `#### Done When` section), verify the resolved gate is not a hollow stub (per `isHollowGate` — a gate whose only lines are bare `echo`/file-existence checks and which exits 0). If any source-bearing phase resolves to a hollow stub, `define plan` MUST exit 1 with a corrective message naming the phase. An honest failing gate (`unauthoredGate`, `exit 1`) is NOT a stub and MUST NOT fail validation. (Implements: US-006)

#### FR-002 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No `### Phase N` headings found in plan | `No phases found in <path>. Expected '### Phase N: Title' headings.` | 1 |
| File line matches neither em-dash nor paren form | (non-fatal) line ignored; phase falls back to file-list/last-resort task | 0 |

#### FR-006 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Source-bearing phase resolves to a hollow/echo stub gate | `define plan: phase-NN "<title>" resolves to a stub gate (no executable Done-When). Author a fenced \`\`\`bash Done-When block. See docs/grounding/022-plan-format-contract.md.` | 1 |
| Generated `plan.md` cannot be parsed (no phases) | `No phases found in <path>. Expected '### Phase N: Title' headings.` | 1 |

---

## 5. Data Model Requirements

_No new database entities. See DM-000._

This feature operates on the existing `TaskState`/`PhaseSchema` contract (ADR-003). It populates fields already present on `Phase`:
- `phase.doneWhen` — now also fed by fenced-bash Done-When blocks (FR-001).
- `phase.testTargets` — added by [021 FR-005](../021-polyglot-toolchain/spec.md); FR-003 populates it from Type-flexible Test Strategy rows.

No schema change is required.

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped — No external network calls at runtime. No CDN. No telemetry. `define plan`'s self-validation runs the deterministic parser locally.
- **TC-002**: Fail-Fast Config — Zod validation with no `.default()` calls. The self-validation (FR-006) is itself a fail-fast gate: a stub-gate plan → `process.exitCode = 1` with a corrective message.
- **TC-003**: TypeScript Only — No `.js`/`.jsx` in `src/`. ESM modules, ES2022 target.
- **TC-004**: Backward compatibility — the parser grammar changes MUST be additive; every one of gwrk's 13 existing `####`+prose-bullet plans MUST parse to the same phase/task/gate result as before (regression-locked by a golden fixture, TR-004).
- **TC-005**: Deterministic parser — `src/engine/plan-to-tasks.ts` MUST remain LLM-free; all format recognition is regex/string-based and reproducible.

---

## 7. Testing Requirements

- **TR-001** (FR-001): `src/engine/plan-to-tasks.test.ts` — a plan whose `#### Done When` is a fenced ` ```bash ` block (`make dev:up && make db:migrate && make test:db`) yields a phase gate equal to that block verbatim; assert the gate is NOT `echo "Phase N: …"`. Vitest.
- **TR-002** (FR-002): `src/engine/plan-to-tasks.test.ts` — em-dash file line `` - `src/lib/db/client.js` — **create** — desc `` parses to `{ path: 'src/lib/db/client.js', action: 'create' }`; a phase built only from em-dash file lines produces per-file tasks (not the phase-title last-resort task); `create` maps to a new-file task. Vitest.
- **TR-003** (FR-003): `src/engine/plan-to-tasks.test.ts` — Test Strategy row `| TR-004 | [integration] | \`tests/db/definitions.test.js\` | … |` puts `tests/db/definitions.test.js` in `phase.testTargets`; the bare `integration`/`unit`/`gate` forms also parse. Vitest.
- **TR-004** (FR-004, REGRESSION): `src/engine/plan-to-tasks.test.ts` — a golden fixture of an existing gwrk `####`+prose-bullet plan (and a paren-form file line) parses to a snapshot identical to the pre-change baseline: same phase count, task titles, and gate scripts. Vitest snapshot.
- **TR-005** (FR-006): `src/commands/define-plan.test.ts` — the plan-gate validator returns non-zero and names the phase when a source-bearing phase resolves to a hollow stub; returns 0 when every source-bearing phase has a fenced-bash gate; an `unauthoredGate` (`exit 1`) phase does NOT fail validation. Vitest.
- **TR-006** (FR-005): `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` — a doc-contract test asserts the prompt documents the fenced-bash Done-When block and the em-dash file-line form with `action ∈ {create, amend, delete}` (grep-based assertion in a Vitest test). Vitest.
- **TR-007** (SEAM, FR-001/FR-006): `src/engine/plan-to-tasks.test.ts` — an end-to-end fixture mirroring the data-dashboard `002-metric-model` phase-03 case (em-dash files + fenced-bash `make test:db` Done-When) parses so the phase gate is `make test:db`, and the same fixture with a prose-only Done-When would be caught by FR-006 validation. This is the coverage that would have caught the original false-green. Vitest.
- **TR-008** (FR-004/TC-004): `src/engine/plan-to-tasks.test.ts` — parse each of gwrk's 13 existing `specs/*/plan.md` (where present) and assert none newly regress to zero phases or to a hollow phase-title stub introduced by the grammar change. Vitest (fixture-driven).

---

## 8. Success Criteria

- **SC-001**: A plan with a fenced-bash Done-When yields a runnable `gateScript` (the command block verbatim), not an `echo "Phase N"` stub.
- **SC-002**: A plan whose source-bearing phase has only prose / no executable gate causes `gwrk define plan` to exit 1 with a clear, phase-named message.
- **SC-003**: Given the fixed parser, a phase whose gate is `make test:db` runs the real command under `gwrk gate`; when the underlying suite fails the gate reports RED (no false green). *(Execution semantics owned by 021 FR-009; this criterion asserts the gate is the real command, not a stub.)*
- **SC-004**: All 13 existing gwrk `####`+prose-bullet plans still parse without regression (`pnpm run test:ci` green for `plan-to-tasks.test.ts`).
- **SC-005**: The `gwrk-plan` generator prompt documents the canonical format; new plans it produces pass FR-006 self-validation by construction.

---

## 9. Verification Requirements

- **VR-001**: `pnpm run build` is clean (no TypeScript errors) after the parser, generator-prompt, and `define plan` changes.
- **VR-002**: `pnpm vitest run src/engine/plan-to-tasks.test.ts` and `pnpm vitest run src/commands/define-plan.test.ts` exit 0.
- **VR-003**: `grep -rn 'echo "Phase' src/engine/plan-to-tasks.ts` shows the last-resort echo stub is only reachable for a non-source-bearing phase (documented), and FR-006 validation rejects it for source-bearing phases.
- **VR-004**: On the SEAM fixture (TR-007), `jq -r '.phases[].tasks[].gateScript' <fixture>/.gwrk/tasks.json | grep -q 'make test:db'` exits 0 and `... | grep -q '^echo "Phase'` exits 1.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001 | FR-001 | US-001 | TR-001, TR-007 |
| US-002 | FR-002 | FR-002 | US-002 | TR-002, TR-007 |
| US-003 | FR-003 | FR-003 | US-003 | TR-003 |
| US-004 | FR-004 | FR-004 | US-004 | TR-004, TR-008 |
| US-005 | FR-005 | FR-005 | US-005 | TR-006 |
| US-006 | FR-006 | FR-006 | US-006 | TR-005, TR-007 |

All FRs map to ≥1 US and ≥1 TR. All TRs trace to an FR. No orphans.

---

## 11. Cross-References

- **021-polyglot-toolchain** — FR-005 (declared-target discovery reads `phase.testTargets`, which FR-003 here populates) and FR-009 (Done-When integration commands compile to an executional gate under liveness in `TEST_GATE`). This feature is **upstream** of both: it ensures the parser *extracts* the executable Done-When and the test targets in the first place. No contract conflict — 023 feeds 021.
- **ADR-003** (state contract) — operates within existing `TaskState`/`PhaseSchema`; no schema change.
- **ADR-005 §10 / gate-quality** — reuses `isHollowGate`/`unauthoredGate` (`src/utils/gate-quality.ts`) as the FR-006 predicate; no new gate-quality semantics introduced.

---

## 12. Agent-Native Compliance

No new CLI commands. One existing command gains a failure mode:

| Command | Type | New behavior | Exit codes | Error-as-navigation | `--format json` |
|---|---|---|---|---|---|
| `gwrk define plan <feature>` | generator / mutator | FR-006 self-validation of generated `plan.md` | `0` valid; `1` stub-gate detected (or unparseable) | stderr names the offending `phase-NN` and points to the canonical-format grounding brief | independent of validation; validation failures surface on stderr and via the standard `[exit:N \| Xs]` signal wrapper |

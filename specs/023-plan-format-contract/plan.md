# Implementation Plan: 023 Plan Format Contract

**Branch**: `023-plan-format-contract` (feature branch created at `/implement`) | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

## Summary

gwrk's plan→tasks parser (`src/engine/plan-to-tasks.ts`) and the format plans are actually authored in have drifted apart. When the parser cannot extract a phase's real gate it falls through to a hollow `echo "Phase N: …"` stub that always exits 0, so the ship loop's mechanical `TEST_GATE` passes on the stub while the real behavioral gate never runs — a false-green (motivating case: data-dashboard `002-metric-model` phase-03, where `make test:db` fails 0/2 yet `gwrk gate` reports 3/3 PASS).

This feature establishes the **canonical plan format** as a contract and makes three coordinated, committed changes:

- **A. Parser** — reads the canonical format: a fenced bash `#### Done When` block compiles verbatim into the phase's executable `gateScript`; em-dash file lines `` - `path` — **action** — description `` (action ∈ {create, amend, delete}) are extracted; `#### Test Strategy` rows parse whether the `Type` token is bare or `[bracketed]`. Existing `####`+prose-bullet plans and paren-form file lines keep parsing unchanged (backward compatible).
- **B. Generator** — `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` instructs the generator to emit the canonical format going forward, so new plans yield executable gates by construction.
- **C. `define` self-validation** — after generating `plan.md`, `gwrk define plan` runs the parser over it and, for every source-bearing phase, verifies the resolved gate is not a hollow stub (reusing `isHollowGate`); if any source-bearing phase resolves to a stub, `define plan` exits 1 with a corrective, phase-named message. This closed loop is the durable prevention.

The parser stays LLM-free and deterministic (TC-005); no database schema changes (spec §5, ADR-003) — this operates on fields already present on `Phase` (`doneWhen`, `testTargets`). This plan.md is itself authored in the canonical format (em-dash file lines + fenced bash Done-When blocks) so it passes the FR-006 self-validation this feature introduces.

---

## Phases and File Structure

### Phase 1: Parser grammar alignment (canonical format + backward compatibility)

Align the deterministic parser `src/engine/plan-to-tasks.ts` to the canonical plan format while keeping every existing `####`+prose-bullet plan parsing identically. Three additive grammar constructs plus a gate-resolution change:

1. **Fenced-bash Done-When → executable gate (FR-001).** Recognize a `#### Done When` body authored as a fenced bash block, capture the block contents, and use them verbatim as the phase gate's `gateScript` (surfaced on the phase's gate task in `tasks.json`) instead of discarding it and falling back to the `echo "Phase N: …"` stub. Prose-bullet Done-When bodies remain parsed as today.
2. **Em-dash file lines (FR-002).** Extract `` - `path` — **action** — description `` with `action ∈ {create, amend, delete}`, capturing the backticked path and bold action. Normalize task-title/SP derivation so `create` maps to a new-file task (parity with today's `NEW` branch: title `Create …`, sp 2), and `amend`/`delete` map to modify/delete (sp 1). A phase authored entirely in em-dash form MUST produce per-file tasks, not collapse to the phase-title last-resort stub.
3. **Type-flexible Test Strategy rows (FR-003).** Parse `#### Test Strategy` rows whose `Type` token is bare (`integration`) or `[bracketed]` (`[integration]`) and whose `Target` is a backticked test file or command, appending the target to `phase.testTargets`.
4. **Backward compatibility (FR-004, TC-004).** Keep parsing `####`+prose-bullet Done-When bodies and paren-form file lines `` - `path` (ACTION: desc) `` with zero regression across all existing `specs/*/plan.md`. New grammar is additive, not a replacement.

Error states (FR-002): no `### Phase N` heading found → `No phases found in <path>. Expected '### Phase N: Title' headings.` (exit 1, unchanged). A file line matching neither em-dash nor paren form → non-fatal, line ignored (phase falls back to file-list/last-resort task). The `echo "Phase N"` last-resort stub remains reachable ONLY for a non-source-bearing phase (VR-003) and is rejected for source-bearing phases by Phase 3.

**Files (4):**
- `src/engine/plan-to-tasks.ts` — **amend** — add fenced-bash Done-When capture → verbatim `gateScript`; em-dash file-line regex + create/amend/delete action normalization; Type-flexible (`\w+` or `[bracketed]`) Test Strategy row regex; preserve paren-form + prose-bullet grammar
- `src/engine/plan-to-tasks.test.ts` — **amend** — TR-001, TR-002, TR-003, TR-004 (snapshot), TR-007 (SEAM), TR-008 (all existing plans)
- `specs/_fixtures/plan-format/plan.md` — **create** — SEAM fixture mirroring 002-metric-model phase-03: em-dash Files block + fenced bash Done-When (`make dev:up && make db:migrate && make test:db`); Phase 3 is the source-bearing phase asserted by TR-007/VR-004
- `specs/_fixtures/plan-format/plan-legacy.md` — **create** — golden `####`+prose-bullet plan with a paren-form file line, for the TR-004 no-regression snapshot

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-004, US-001, US-002, US-003, US-004, TC-004, TC-005

**Dependencies:** None (foundation phase).

**Contract Mapping:**
- `contracts/plan-gate-validator.md` → `parsePlanMarkdown` grammar contract (canonical constructs 1–4) → `src/engine/plan-to-tasks.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-005 §10 (gate-quality) | Parser MUST NOT emit a hollow gate for a source-bearing phase; fenced-bash Done-When becomes the real `gateScript` |
| ADR-003 (state contract) | No schema change; populate existing `Phase.doneWhen` and `Phase.testTargets` only |
| TC-005 (deterministic parser) | All new recognition is regex/string-based, LLM-free, reproducible |
| Committed test fixtures | Fixtures under `specs/_fixtures/plan-format/` are deterministic and network-free (TC-001) |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | integration | `src/engine/plan-to-tasks.test.ts` | A phase whose `#### Done When` is a fenced bash block yields a phase `gateScript` equal to that block verbatim and NOT matching `^echo "Phase` |
| TR-002 | unit | `src/engine/plan-to-tasks.test.ts` | `` - `src/lib/db/client.js` — **create** — desc `` parses to `{ path: 'src/lib/db/client.js', action: 'create' }`; an em-dash-only phase produces per-file tasks (no phase-title stub); `create` maps to a new-file task |
| TR-003 | unit | `src/engine/plan-to-tasks.test.ts` | Row `\| TR-004 \| [integration] \| \`tests/db/definitions.test.js\` \| … \|` puts `tests/db/definitions.test.js` in `phase.testTargets`; bare `integration`/`unit`/`gate` also parse |
| TR-004 | integration | `src/engine/plan-to-tasks.test.ts` | Golden `####`+prose-bullet fixture (`plan-legacy.md`) with a paren-form file line snapshots identical to the pre-change baseline: same phase count, task titles, and gate scripts |
| TR-007 | integration | `src/engine/plan-to-tasks.test.ts` | SEAM fixture (`plan-format/plan.md`) parses so the source-bearing phase gate is `make test:db` (the exact case that would have caught the original false-green) |
| TR-008 | integration | `src/engine/plan-to-tasks.test.ts` | Parsing every existing `specs/*/plan.md` yields no phase newly regressing to zero phases or to a hollow phase-title stub |

#### Done When
```bash
pnpm run build
pnpm vitest run src/engine/plan-to-tasks.test.ts
jq -r '.phases[2].tasks[].gateScript' specs/_fixtures/plan-format/.gwrk/tasks.json | grep -q 'make test:db'
! jq -r '.phases[].tasks[].gateScript' specs/_fixtures/plan-format/.gwrk/tasks.json | grep -q '^echo "Phase'
```

### Phase 2: Generator emits the canonical format

Update the `gwrk-plan` generator prompt so newly generated plans use the canonical format by construction: `####` section headings, fenced bash `#### Done When` blocks, em-dash file lines with `action ∈ {create, amend, delete}`, and a Type-flexible `#### Test Strategy` table. Add a deterministic doc-contract test that asserts the prompt documents these constructs (grep-based), so drift between the generator and the parser (Phase 1) is caught in CI.

**Files (2):**
- `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` — **amend** — document the canonical output shape: `####` headings, fenced bash Done-When blocks (the only executable form), em-dash file lines with the three actions, Type-flexible Test Strategy table
- `src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts` — **create** — TR-006 doc-contract: grep-assert the prompt contains a fenced bash marker and the em-dash action form with `create`/`amend`/`delete`

**Requirements Addressed:** FR-005, US-005, SC-005 (documentation arm)

**Dependencies:** Phase 1 (the parser must recognize the format the generator is told to emit).

**Contract Mapping:**
- `contracts/plan-gate-validator.md` → canonical-format output contract (generator side) → `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| FR-005 doc-contract | `PROMPT.md` is the generator's output contract; the test locks the documented format to the parser grammar |
| ADR-004 (agent-native output) | Generated plans must yield executable gates that downstream agent-native commands can run |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-006 | gate | `src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts` | The prompt documents a fenced bash Done-When block (`grep -q` for the bash fence marker) AND the em-dash file-line form with `action ∈ {create, amend, delete}` (`grep -Eq`); both greps exit 0 |

#### Done When
```bash
pnpm run build
pnpm vitest run src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts
```

### Phase 3: `define plan` self-validation (fail loudly on stub gates)

Add a deterministic plan-gate validator and wire it into `gwrk define plan`. After the orchestrator produces `plan.md` (and before the clean commit), run the parser over the generated plan and, for every **source-bearing phase** (a phase that declares ≥1 file line and/or a `#### Done When` section), verify the resolved gate is not a hollow stub per `isHollowGate` (a gate whose only meaningful lines are bare `echo`/file-existence checks and which exits 0). If any source-bearing phase resolves to a hollow stub, `define plan` sets `process.exitCode = 1` and prints a corrective message naming the offending `phase-NN`. An honest failing gate (`unauthoredGate`, `exit 1`) is NOT a stub and MUST NOT fail validation. An unparseable plan (no phases) surfaces the existing `No phases found…` error.

Error state (FR-006): source-bearing phase → hollow/echo stub emits on stderr `define plan: phase-NN "<title>" resolves to a stub gate (no executable Done-When). Author a fenced bash Done-When block. See docs/grounding/023-plan-format-contract.md.` and exit 1. NOTE — the spec's FR-006 table renders this path as `docs/grounding/022-plan-format-contract.md`; that is a stale pre-renumber reference. The implementation MUST emit the current brief path `docs/grounding/023-plan-format-contract.md`.

This is a query/verifier behavior added to an existing generator/mutator command (`gwrk define plan`), preserving the `[exit:N | Xs]` signal wrapper (ADR-004): exit 0 valid, exit 1 stub-gate detected or unparseable; error-as-navigation names the phase and points to the canonical-format brief.

**Files (4):**
- `src/engine/plan-gate-validator.ts` — **create** — `validatePlanGates(featureDir, featureId, opts?)`: parse `plan.md`, classify each phase source-bearing vs not, apply `isHollowGate` to each source-bearing phase's resolved gate, return a `PlanGateReport { ok, violations }`
- `src/commands/define-plan.ts` — **amend** — after `orchestrator.runLoop` succeeds and before `commitAllClean`, call `validatePlanGates`; on `ok === false` throw a `CommandError` (exit 1) whose message names each offending `phase-NN` and points to `docs/grounding/023-plan-format-contract.md`
- `src/commands/define-plan.test.ts` — **create** — TR-005 and the FR-006/TR-007 negative arm
- `specs/_fixtures/plan-format/plan-stub.md` — **create** — a source-bearing phase whose `#### Done When` is prose-only (no fenced bash block) — the FR-006 negative fixture

**Requirements Addressed:** FR-006, US-006, TC-001, TC-002, SC-002, VR-003 (validation arm), Agent-Native compliance (§12)

**Dependencies:** Phase 1 (validator consumes `parsePlanMarkdown` + resolved gate); Phase 2 (generator emits format that passes validation by construction).

**Contract Mapping:**
- `contracts/plan-gate-validator.md` → `validatePlanGates(featureDir, featureId, opts?) → PlanGateReport` → `src/engine/plan-gate-validator.ts`
- `contracts/plan-gate-validator.md` → `define plan` post-generation validation hook (exit 1 on violation) → `src/commands/define-plan.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 (agent-native output) | `gwrk define plan` gains an exit-1 failure mode with error-as-navigation on stderr; `[exit:N | Xs]` wrapper preserved |
| ADR-005 §10 (gate-quality) | Reuse `isHollowGate`/`unauthoredGate` as the FR-006 predicate; introduce NO new gate-quality semantics |
| `.gwrk/rules/workspace.md` | Fail-fast config (TC-002): validation is a fail-fast gate, no `.default()` softening |
| TC-001 (air-gapped) | Self-validation runs the deterministic parser locally; no network |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | integration | `src/commands/define-plan.test.ts` | `validatePlanGates` returns non-zero/`ok:false` and names the phase when a source-bearing phase resolves to a hollow stub (`plan-stub.md`); returns `ok:true` when every source-bearing phase has a fenced-bash gate (`plan-format/plan.md`); a phase whose gate is `unauthoredGate` (`exit 1`) does NOT fail validation |
| TR-007 (negative arm) | integration | `src/commands/define-plan.test.ts` | The prose-only Done-When variant of the SEAM case is caught by FR-006 validation — validator exit 1 naming the phase |

#### Done When
```bash
pnpm run build
pnpm vitest run src/commands/define-plan.test.ts
```

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `ParsedPhase` (extended: fenced-bash gate, em-dash actions, flexible test-strategy targets) | `src/engine/plan-to-tasks.ts` | `generateTaskState` (same file), `validatePlanGates` (`src/engine/plan-gate-validator.ts`) |
| `Phase.doneWhen`, `Phase.testTargets` (existing fields; no schema change) | `src/utils/state.ts` (ADR-003) | 021-polyglot-toolchain FR-005 declared-target discovery + FR-009 Done-When gate compilation |
| `isHollowGate`, `unauthoredGate` | `src/utils/gate-quality.ts` (ADR-005 §10) | `validatePlanGates` (FR-006 predicate) |
| `PlanGateReport { ok: boolean; violations: { phaseId: string; title: string; gateScript: string }[] }` (new) | `src/engine/plan-gate-validator.ts` | `src/commands/define-plan.ts`, `src/commands/define-plan.test.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._ It is a deterministic parser/generator/validator change with no UI surface.

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| Out-of-scope | Author real executable gates for gwrk's own existing specs | Content work, not a parser fix (spec §1 Out of scope) | Future per-spec definitional work |
| Out-of-scope | Throwaway plan-normalization migration script | Temporary, uncommitted — not a deliverable (spec §1 Out of scope) | N/A (not committed) |
| Out-of-scope | Gate execution semantics under liveness (`TEST_GATE` refuses `testsRun == 0`) | Owned by 021 FR-009; this feature only guarantees the executable gate is extracted, not how it executes | specs/021-polyglot-toolchain (Phase 08) |
| 🟡 AMBER | FR-006 error string cites `docs/grounding/022-plan-format-contract.md` | Stale pre-renumber reference in the spec; brief is now `023-…`. Implementation emits the `023` path (documented in Phase 3); spec text is the user's call to correct | spec.md §4 FR-006 Error States |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | Phase 1 | Planned |
| US-002 | Phase 1 | Planned |
| US-003 | Phase 1 | Planned |
| US-004 | Phase 1 | Planned |
| US-005 | Phase 2 | Planned |
| US-006 | Phase 3 | Planned |
| FR-001 | Phase 1 | Planned |
| FR-002 | Phase 1 | Planned |
| FR-003 | Phase 1 | Planned |
| FR-004 | Phase 1 | Planned |
| FR-005 | Phase 2 | Planned |
| FR-006 | Phase 3 | Planned |
| FR-002 Error States | Phase 1 | Planned |
| FR-006 Error States | Phase 3 | Planned |
| DM-000 (no new entities / no schema change) | Phases 1–3 | Leveraged (no data-model.md) |
| TC-001 (air-gapped) | Phase 3 | Planned |
| TC-002 (fail-fast config) | Phase 3 | Planned |
| TC-003 (TypeScript only) | Phases 1–3 | Planned |
| TC-004 (backward compatibility) | Phase 1 | Planned |
| TC-005 (deterministic parser) | Phase 1 | Planned |
| TR-001 | Phase 1 | Planned |
| TR-002 | Phase 1 | Planned |
| TR-003 | Phase 1 | Planned |
| TR-004 | Phase 1 | Planned |
| TR-005 | Phase 3 | Planned |
| TR-006 | Phase 2 | Planned |
| TR-007 | Phase 1 (positive) + Phase 3 (negative arm) | Planned |
| TR-008 | Phase 1 | Planned |
| SC-001 | Phase 1 | Planned |
| SC-002 | Phase 3 | Planned |
| SC-003 | Phase 1 (gate is the real command; execution owned by 021 FR-009) | Planned |
| SC-004 | Phase 1 | Planned |
| SC-005 | Phase 2 + Phase 3 | Planned |
| VR-001 (build clean) | Phases 1–3 (Done When: `pnpm run build`) | Planned |
| VR-002 (vitest green) | Phase 1 + Phase 3 | Planned |
| VR-003 (echo stub only for non-source-bearing) | Phase 1 (documented) + Phase 3 (rejected for source-bearing) | Planned |
| VR-004 (SEAM jq assertions) | Phase 1 | Planned |

All US/FR/TR/TC/SC/VR items are assigned to a phase. DM items: none (DM-000 leveraged, no schema change). No unaccounted items.

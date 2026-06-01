# Daily Driver Gap Audit — 2026-06-01

> **Test**: `gwrk init` on fresh project `~/Code/EnergyWork`. Result: silent success, no wizard, no Slack, no profile detection, dead `.specify/` directory created. **FAIL.**
>
> **Conclusion**: gwrk cannot be used as a daily driver on non-gwrk projects. The init wizard, prompt decontamination, stale code removal, and **project-scoped DB isolation** must ship before the "daily driver" label is honest.

---

## Gap Categories

### A. Specs That Need Updates

| Feature | File | What's wrong | Action |
|---|---|---|---|
| **F001** | `specs/001-cli-core/spec.md` | R3 rewrite (2026-05-30) is complete. No further spec changes needed. | ✅ Spec is current |
| **F004** | `specs/004-ship-loop/spec.md` | Coverage matrix shows 🔲/⚠️ for 26 of 38 items despite code existing. Spec doesn't reflect what DispatchOrchestrator actually delivers. | **Update spec**: Reconcile coverage matrix with reality. Mark shipped items. Identify true gaps vs stale tracking. |
| **F011** | `specs/011-harvest/spec.md` | Coverage matrix all "Planned" despite Phases 3-4 being shipped (PR #65). Spec still describes inbound webhook trigger. | **Update spec**: Mark P3/P4 as SHIPPED. Add architectural note: trigger mechanism changed from inbound webhook to server-initiated/Slack relay. |
| **F002** | `specs/002-build-server/spec.md` | Coverage matrix all "Planned" despite Phase 1 shipped (PR #66). | **Update spec**: Mark P1 as SHIPPED. |
| **F003** | `specs/003-slack/spec.md` | Coverage matrix all "PLANNED" despite Slack being fully operational (Socket Mode, slash commands, app home, PR merge from Slack). | **Update spec**: Mark shipped items. |
| **F014** | `specs/014-plugin-system/spec.md` | All phases shipped (PR #64). Coverage matrix may be stale. | **Verify**: All items should be ✅. |

### B. Plans That Must Be Regenerated or Fixed

| Feature | File | Problem | Action |
|---|---|---|---|
| **F001** | `specs/001-cli-core/plan.md` | Phase 10/12/13 are correctly documented but **not shipped**. Status line on L16 accurately shows them as open. Plan is correct. | **No plan changes** — ship the code. |
| **F004** | `specs/004-ship-loop/plan.md` | Phase 5 (DispatchOrchestrator) is the current ship loop but the plan's coverage matrix (L298-L367) shows most items as 🔲/⚠️. Either: (a) the code exists but tests don't, or (b) tracking is stale. | **Regenerate**: `gwrk define plan 004 --force` or manually reconcile Phase 5 with actual `ship-orchestrator.ts` implementation. |
| **F011** | `specs/011-harvest/plan.md` | Coverage matrix (L212+) all "Planned". Phases 3-4 shipped. Plan describes inbound webhook architecture that was rejected. | **Regenerate**: Update coverage matrix. Add Phase 6: Server-initiated harvest (outbound polling or Slack relay). |
| **F002** | `specs/002-build-server/plan.md` | Coverage matrix (L184+) all "Planned". Phase 1 shipped. | **Update**: Mark P1 items as Done. |
| **F003** | `specs/003-slack/plan.md` | Coverage matrix all "PLANNED". Slack is operational. | **Update**: Mark shipped items. |
| **ROADMAP.md** | `ROADMAP.md` | "Daily-Driver" section (L41-L56) lists items that are either done or wrong. "Shareable" section lists init wizard as Phase 3 but it's actually the daily driver gate. Test counts stale (646 → 744). | **Rewrite**: Align with this audit. |

### C. Defined But Not Implemented

These have specs and plans but the code doesn't exist or doesn't work:

| Gap | Feature | Spec Reference | Plan Reference | What's Missing |
|---|---|---|---|---|
| **Init Wizard** | F001 P10 | US-001 (R3), FR-001 (R3), FR-030, FR-031, FR-032 | [plan.md P10](specs/001-cli-core/plan.md#L265) | Interactive profile wizard, project type detection (`profile-detector.ts`), setup absorption, `--non-interactive`, git repo check. Current `init.ts` L105 creates dead `.specify/templates` directory. |
| **Prompt Decontamination** | F001 P13 | US-028, FR-033, FR-034, FR-035 | [plan.md P13](specs/001-cli-core/plan.md#L371) | `prompt-conditioner.ts`, `project info` command, 13 PROMPT.md files refactored. 84 gwrk-native refs cause wrong output on non-gwrk projects. [Contamination audit](specs/001-cli-core/refs/prompt-contamination-audit.md) documents all 84 refs. |
| **Define Output Parity** | F001 P12 | US-026, FR-028, FR-029 | [plan.md P12](specs/001-cli-core/plan.md#L339) | `quiet: true` not passed in `tests-generate.ts`, `specify.ts`, `define-plan.ts`. Agent narration dumps to stdout. Tolerant JSON mode partially implemented but not wired to all define commands. |
| **State Contracts** | F001 P9 | US-019, US-020, FR-019, FR-020, FR-021 | [plan.md P9](specs/001-cli-core/plan.md#L241) | `manifest.ts` write after ship/define, `tasks verify` subcommand, `.gitattributes` merge protection. Lower priority — deferred per plan execution order. |
| **Ship Loop Hardening** | F004 | FM-4 (stale dist), FM-5 (UAT stall), FM-6 (stale branches) | [ship-failure-diagnosis.md](specs/004-ship-loop/refs/ship-failure-diagnosis.md) | Timeout fallback in `dispatchAgent()`, `--force-with-lease` in branch setup, dist freshness check. No spec changes needed — these are implementation fixes. |
| **LaunchAgent** | F002 P1 | FR-012, FR-013, FR-014, FR-015 | [plan.md P1](specs/002-build-server/plan.md#L13) | `installServer()` exists but LaunchAgent not installed on workstation. `gwrk server install` works in tests but hasn't been run e2e. |
| **Harvest Trigger** | F011 | FR-H01, FR-H09, FR-H10 | [plan.md P1](specs/011-harvest/plan.md#L13) | `github.ts` is dead code (inbound webhook). Server-initiated harvest via outbound polling or Slack relay is not specced as a phase. Harvest engine itself works (P3/P4 shipped). |

### D. Not Well Defined (No Spec or Incomplete Spec)

| Gap | Current State | What's Needed |
|---|---|---|
| **Obsidian Integration** | Zero code. Not specced. No feature number. Discussed in [conversation 41fe3db1](https://github.com/gforge-esc/gwrk/issues) as backlog. | Feature number assignment (e.g., F020). `gwrk define spec 020 "Obsidian Integration"`. Scope: vault = project root, `.obsidian/` git strategy, canvas for build-plan, definitional surfaces only. |
| **Server-Initiated Harvest** | `github.ts` handler exists but trigger mechanism (inbound webhook) was rejected. No spec for outbound alternative. | Amend F011 spec: Add Phase 6 for server-initiated harvest. Options: (a) GitHub API polling on interval, (b) Slack relay (GitHub → Slack notification → Socket Mode → gwrk), (c) `gh` CLI poll in heartbeat loop. |
| **Dead `.specify/` Code** | `init.ts:105` creates `.specify/templates`. `scaffold-feature.ts:216` references `.specify`. Both are from legacy pipeline. | Remove: Delete `.specify` references from `init.ts` and `scaffold-feature.ts`. No spec change needed — this is dead code cleanup. |
| **`gwrk setup` Absorption** | `setup.ts` (8974 bytes) and `setup-slack.ts` (10013 bytes) exist as standalone commands. Spec says absorb into `init`. | Deliver as part of F001 P10. `setup.ts` → absorbed into `init.ts` interactive flow. `setup-slack.ts` → callable from `init` but not standalone on CLI surface. |
| **`agy` Agent Adapter** | `src/plugins/builtins/agents/agy/adapter.ts` — all 3 methods throw "Not implemented". | Either implement or delete. This is dead scaffolding. No spec references it. |
| **F005 Parallel Dispatch** | Spec and plan exist (`specs/005-parallel-dispatch/`). Not implemented. `--parallel` flag on ship exists but doesn't do parallel dispatch. | Spec exists, plan exists. Not blocking daily driver. Defer. |
| **F012 Knowledge Work** | Directory exists (`specs/012-knowledge-work/`). No spec.md, no plan.md. | Not blocking daily driver. Defer. |
| **F013 Agent-Native Interface** | Spec and plan exist. Partially delivered via ADR-004. | Audit overlap with shipped ADR-004 compliance. May be fully delivered. |

### E. Build Plan Integrity (`gwrk plan status` lies)

The SQLite `plan_features` table (source of truth for `gwrk plan status`) is **completely wrong**:

#### Duplicate Feature Entries

Two parallel tracking systems exist and disagree:

| Spec-based ID | Status (DB) | Legacy F-ID | Status (DB) | Reality |
|---|---|---|---|---|
| `001-cli-core` | DEFINED | `F001` | SHIPPED | **Partially shipped** — P1-8,11 done; P9,10,12,13 open |
| `002-build-server` | DEFINED | `F002` | SHIPPED | **P1 shipped** (PR #66); P2-4 open |
| `003-slack` | DEFINED | `F003` | SHIPPED | **Operational** — Socket Mode, slash, app home |
| `004-ship-loop` | SHIPPED | `F004` | DONE | **Partially shipped** — orchestrator works, 26/38 spec items untested |
| `006-pulse` | SHIPPED | `F006` | PLANNED | **Shipped** (PR #34) — DB contradicts itself |
| `008-agent-router` | DEFINED | — | — | **P1-4 shipped** (PR #35) |
| `011-harvest` | DEFINED | `F011` | PLANNED | **P3-4 shipped** (PR #65); P1-2,5 open |
| `014-plugin-system` | DEFINED | `F014` | DONE | **All phases shipped** (PR #64) |
| `018-build-plan-orchestrator` | DEFINED | `F018` | SPECIFIED | **Operational** — this command runs it! |

#### Foreign Project Entries

These features leaked from `skills-connection` into the gwrk global DB:

| ID | Name | Action |
|---|---|---|
| `047-ontology-integration` | "integrate the constructed ontology into the RFI app replacing the typology" | **DELETE** — wrong project |
| `049-companion-guidance` | "Word-based manual pilot with Jane and Adam" | **DELETE** — wrong project |

#### Phantom Features

| ID | Status | Reality |
|---|---|---|
| `F009 Agent-DUT` | PLANNED | No spec, no code. Ghost entry. |
| `F010 GForge Integration` | PLANNED | No spec, no code. Ghost entry. |
| `F014-R WorkflowRuntime Rework` | DONE | Absorbed into F014. Redundant. |
| `F015 Event Bus` | PLANNED | No spec. Aspirational. |
| `F016 Domain Packs` | PLANNED | No spec. Aspirational. |
| `F017 Channel Abstraction` | PLANNED | No spec. Aspirational. |
| `F999-missing` | PLANNED | Placeholder. Delete. |

#### Required Fix

1. **Delete foreign entries** (047, 049)
2. **Delete phantom entries** (F009, F010, F014-R, F015-F017, F999)
3. **Consolidate duplicates** — decide on ONE ID scheme (spec-based `001-cli-core` or legacy `F001`). Recommend spec-based.
4. **Update statuses** to match reality per the table above
5. **Update `plan_phases` table** for all features with shipped phases

This is a P0 daily driver item. `gwrk plan status` is the product's self-awareness. If it lies, the tool is broken.

### F. Global DB Has No Project Scoping (Root Cause of E.2)

The foreign project leak (Section E, "047-ontology-integration") wasn't a one-time data accident — it's a **structural architectural gap**. The global SQLite database at `~/.gwrk/gwrk.db` stores data from all projects in one unscoped bucket. The `projects` table exists and `gwrk init` registers projects into it, but **no downstream query filters by `project_id`**.

#### Unscoped Tables

| Table | Has `project_id`? | Impact |
|---|---|---|
| `plan_features` | ❌ **No** | `gwrk plan status` shows features from ALL projects. Root cause of 047/049 leak. |
| `plan_phases` | ❌ **No** | Phase data from different projects collides. |
| `plan_edges` | ❌ **No** | Dependency edges cross-pollinate across projects. |
| `plan_proposals` | ❌ **No** | Agent proposals leak across projects. |
| `gate_results` | ❌ **No** | Gate evidence from one project shows up in another. |
| `compression` | ❌ **No** | Compression metrics are unscoped. |
| `issues` | ❌ **No** | Issue tracking is unscoped. |
| `routing_history` | ❌ **No** | Agent routing decisions are unscoped. |
| `runs` | ⚠️ Optional | Column exists but is **nullable and rarely populated**. `listRuns()` queries by `feature_id` only — no project filter. |
| `history` | ⚠️ Optional | Column exists but queries don't filter by it. |
| `projects` | ✅ (it IS the registry) | Registration exists but nothing uses it for scoping. |

#### Unscoped Queries (TypeScript)

| File | Function | Problem |
|---|---|---|
| `src/db/plan.ts` | `listFeatures()` | `SELECT * FROM plan_features` — returns global soup |
| `src/db/plan.ts` | `isPlanEmpty()` | Counts ALL features, not current project |
| `src/db/plan.ts` | `listAllEdges()` | Returns edges from all projects |
| `src/db/plan.ts` | `listProposals()` | Returns proposals from all projects |
| `src/db/runs.ts` | `listRuns()` | Filters by `feature_id` only, no `project_id` |
| `src/db/runs.ts` | `getStats()` | Aggregates ALL runs globally |
| `src/db/gates.ts` | `getGateResults()` | Unscoped |
| `src/db/compression.ts` | `listCompressionRecords()` | Unscoped |
| `src/db/issues.ts` | `listIssues()` | Unscoped |
| `src/db/plugins.ts` | `getRoutingHistory()` | Unscoped |

#### Unscoped Engine/Commands

| File | Problem |
|---|---|
| `src/engine/plan-store.ts` | `PlanStore` class has no concept of "current project". Every method calls `db.listFeatures()` globally. |
| `src/engine/drift-detector.ts` | Reads global plan state for drift checks. |
| `src/commands/plan.ts` | All 12 subcommands instantiate `PlanStore()` without project context. |
| `src/commands/stats.ts` | `getStats()` shows all runs globally. |
| `src/commands/runs.ts` | `listRuns(feature)` — no project filter. |

#### Required Fix

1. **New migration** (`009-project-scoping.sql`): Add `project_id TEXT` to all 8 unscoped tables, create indexes
2. **`resolveProjectId(cwd)` utility**: Canonical MD5(projectRoot) derivation matching `init.ts` registration
3. **DB access layer**: All query functions accept and filter by `projectId`
4. **Engine layer**: `PlanStore` constructor accepts `projectId`
5. **Command layer**: All commands derive `projectId` from `process.cwd()` and pass it through
6. **Backfill**: Existing rows get `project_id` populated from `gwrk init` context on next run

This is a P0 daily driver item. Without project scoping, running `gwrk init` on EnergyWork will pollute gwrk's own `plan status`, and gwrk's features will show up in EnergyWork's dashboard. The 047/049 leak will repeat every time gwrk is used on a second project.

---

## Stale Code Inventory

| File | Problem | Action |
|---|---|---|
| `src/commands/init.ts:105` | Creates `.specify/templates` — dead pipeline | Remove `.specify` from dirs array |
| `src/utils/scaffold-feature.ts:216` | References `.specify` for template discovery | Remove or replace with `specs/` |
| `src/utils/scaffold-feature.ts:6,180` | Comments reference `.specify/scripts/bash/create-new-feature.sh` | Update comments |
| `src/plugins/builtins/agents/agy/adapter.ts` | All methods throw "Not implemented" | Delete or implement |
| `src/server/github.ts` | Inbound webhook handler — architecture rejected | Keep handler logic, change trigger to outbound |

---

## ADR Cross-Reference

| ADR | File | Relevance to Daily Driver |
|---|---|---|
| [ADR-001](docs/decisions/ADR-001-task-tracking.md) | Task tracking | ✅ Implemented. Tasks work. |
| [ADR-002](docs/decisions/ADR-002-sqlite-execution-ledger.md) | SQLite ledger | ✅ Implemented. Runs recorded. |
| [ADR-003](docs/decisions/ADR-003-state-contract.md) | State contract | ⚠️ Partially implemented. Manifests write but `tasks verify` missing (F001 P9). |
| [ADR-004](docs/decisions/ADR-004-agent-native-output.md) | Agent-native output | ⚠️ Protocol exists but hardcoded in PROMPT.md files for gwrk-only. F001 P13 fixes this. |
| [ADR-005](docs/decisions/ADR-005-tdd-gate-architecture.md) | TDD gate architecture | ✅ Implemented. Deterministic vitest gates from gap-matrix. |
| [ADR-006](docs/decisions/ADR-006-plugin-agent-backends.md) | Plugin agent backends | ✅ Implemented. WorkflowRuntime, PluginLoader, manifest validation. |
| [ADR-007](docs/decisions/ADR-007-single-dispatch-path.md) | Single dispatch path | ✅ Implemented. All agent dispatch through `dispatchToAgent()`. |

---

## Runbook

> **Branch**: `feature/p0-daily-driver`
> **Baseline**: 744 tests passing, `pnpm build` clean
> **Last updated**: 2026-06-01T17:00

### Step 1: Dead code cleanup ✅ DONE
```bash
# Removed .specify/ refs from init.ts, scaffold-feature.ts
# Deleted src/plugins/builtins/agents/agy/adapter.ts
```

### Step 2: Build plan DB reconciliation ✅ DONE
```bash
# Deleted foreign entries (047, 049), phantom entries (F009-F017, F999)
# Consolidated to spec-based IDs, updated statuses
```

### Step 3: Coverage matrix reconciliation ✅ DONE
```bash
# Updated 5 plan files: F004, F011, F002, F003, F014
```

### Step 4: Fix define-tests prompt ✅ DONE
```bash
# Removed Section 6 (stub mandate) from gwrk-define-tests/PROMPT.md
# Prompt told agent to write src/ stubs; guardrail reverted them. Conflict resolved.
```

### Step 5: Define P10 — Init Wizard ✅ DONE
```bash
gwrk define tests 001 --phase 10 --force  # run #6821
gwrk define tasks 001 --phase 10           # run #6822
```

### Step 6: Ship P10 — Init Wizard ⏳ NEXT
```bash
gwrk ship 001 10
```
**What ships**: Interactive `gwrk init` wizard, `profile-detector.ts`, `setup.ts` absorbed into `init`, `--non-interactive` flag, project type auto-detection.

**Files**:
- `src/commands/init.ts` — REWRITE (interactive wizard)
- `src/commands/setup.ts` — DELETE (absorbed)
- `src/engine/profile-detector.ts` — NEW
- `src/utils/config.ts` — MODIFY (project profile schema)

**Done when**:
- `gwrk init` runs interactive profile wizard on a fresh project
- `gwrk init --non-interactive` auto-detects and writes config silently
- `gwrk setup` removed from CLI surface
- `pnpm build` clean, `pnpm test` ≥ 744 passing

---

### Step 7: Define P13 — Prompt Decontamination
```bash
gwrk define tests 001 --phase 13
gwrk define tasks 001 --phase 13
```

### Step 8: Ship P13 — Prompt Decontamination
```bash
gwrk ship 001 13
```
**What ships**: `prompt-conditioner.ts`, `project-info.ts`, 13 PROMPT.md files refactored (84 gwrk-native refs removed), `gwrk project info` command.

**Depends on**: Step 6 (init creates project profiles that prompt conditioner reads).

**Done when**:
- `gwrk define plan` on `~/Code/EnergyWork` → no Commander.js, no `src/commands/`, no ADR-004
- `grep -r "Commander.js\|better-sqlite3\|ADR-004" src/plugins/builtins/workflows/*/PROMPT.md` → ZERO ungated matches
- `pnpm build` clean, `pnpm test` passing

---

### Step 9: Add Phase 14 to F001 spec and plan
```bash
# Add US/FR for project-scoped DB isolation to specs/001-cli-core/spec.md
# Add Phase 14 section to specs/001-cli-core/plan.md
# Scaffolding already committed:
#   src/utils/project-id.ts
#   src/db/migrations/009-project-scoping.sql
#   src/db/index.ts safeAddColumn additions
```

### Step 10: Define P14 — Project-Scoped DB
```bash
gwrk define tests 001 --phase 14
gwrk define tasks 001 --phase 14
```

### Step 11: Ship P14 — Project-Scoped DB
```bash
gwrk ship 001 14
```
**What ships**: `project_id` column on 8 tables, all queries scoped, `PlanStore` accepts `projectId`, commands derive project from `cwd`.

**Depends on**: Step 6 (init registers projects). Independent of Step 8 (P13).

**Done when**:
- `gwrk init` on `~/Code/EnergyWork` → project registered in DB
- `gwrk plan status` on EnergyWork → ONLY EnergyWork features
- `gwrk plan status` on gwrk → ONLY gwrk features
- No cross-project pollution in `runs`, `stats`, `gates`, `compression`
- `pnpm build` clean, `pnpm test` passing

---

### Step 12: Verify daily driver
```bash
cd ~/Code/EnergyWork
gwrk init                    # interactive wizard works
gwrk define plan EnergyWork  # EnergyWork-appropriate output
gwrk plan status             # ONLY EnergyWork features
cd ~/Code/gwrk
gwrk plan status             # ONLY gwrk features
```

**All pass → DAILY DRIVER ✅**

---

## After Daily Driver (P1)

| Item | What | Work |
|---|---|---|
| P12 | Define output parity | `gwrk ship 001 12` — wire `quiet: true` in define commands |
| Lifecycle status | `gwrk plan status 001 --phases` | New command: spec→plan→tests→tasks→ship readiness per phase |
| Doc rewrite | `architecture.md`, `WHAT_IS_GWRK.md`, `README.md`, `ROADMAP.md` | Remove gwrk-specific refs. Present gwrk as project-agnostic. |
| CLI cleanup | Remove `setup` from help | Absorbed by P10 — verify or manual cleanup |

---

## Test Baseline

```
Test Files:  147 passed | 3 skipped (150)
Tests:       744 passed | 1 skipped | 8 todo (753)
Duration:    14.24s
Build:       pnpm build — clean (tsc, no errors)
Branch:      develop (up to date with origin)
```

This baseline MUST NOT regress.

---

## Revision Log

| Date | Change |
|---|---|
| 2026-06-01 | Initial audit |
| 2026-06-01 | Added Section F (project-scoped DB isolation). Elevated to P0. |
| 2026-06-01 | Fixed define-tests prompt/guardrail contradiction. |
| 2026-06-01 | Rewrote execution section as operational runbook. |


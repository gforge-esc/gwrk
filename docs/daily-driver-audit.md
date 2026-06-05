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
| **`agy` Agent Adapter** | ✅ **SHIPPED** (F019, PR #71, 2026-06-02). `AgyAdapter` implements `AgentBackend`. Router updated. | Merged to develop. |
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
| `runs` | ✅ **Backfilled** | Migration 010 backfilled all 7,089 rows. `startRun()` auto-resolves `project_id` from `process.cwd()`. `listRuns()` filters by `project_id`. |
| `history` | ⚠️ Optional | Column exists but queries don't filter by it. |
| `projects` | ✅ (it IS the registry) | Registration exists but nothing uses it for scoping. |

#### Unscoped Queries (TypeScript)

| File | Function | Problem |
|---|---|---|
| `src/db/plan.ts` | `listFeatures()` | `SELECT * FROM plan_features` — returns global soup |
| `src/db/plan.ts` | `isPlanEmpty()` | Counts ALL features, not current project |
| `src/db/plan.ts` | `listAllEdges()` | Returns edges from all projects |
| `src/db/plan.ts` | `listProposals()` | Returns proposals from all projects |
| `src/db/runs.ts` | `listRuns()` | ✅ **FIXED** (F019). Filters by `feature_id` AND `project_id`. |
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
| `src/plugins/builtins/agents/agy/adapter.ts` | ✅ **SHIPPED** (F019). Full `AgentBackend` implementation. | N/A — delivered |
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

> **Branch**: `feat/001-cli-core`
> **Baseline**: 744 tests passing, `pnpm build` clean
> **Last updated**: 2026-06-01T19:51

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

### Step 6: Ship P10 — Init Wizard  ✅ DONE
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

### Step 7: Ship P12 — Output Parity ✅ DONE
```bash
gwrk ship 001 12
```
Shipped: tolerant flag handling in `WorkflowRuntime`, quiet-mode support across CLI subcommands.

### Step 8: Ship P13 — Prompt Decontamination ✅ DONE
```bash
gwrk ship 001 13
```
Shipped: `prompt-conditioner.ts`, `project-info.ts`, `[type: gwrk-native]` guards on all 15 PROMPT.md files, `gwrk project info` command.

**Post-ship fix** (manual, 2026-06-01): Guard resolver was broken — `conditionPrompt()` never matched `gwrk-native` against `pnpm-monorepo` profile type. Fixed in `4f741e8`: `_isGwrk` flag + `generic` always-include. All 5 contaminated files verified CLEAN after conditioning.

### Step 9: Ship P14 — Project-Scoped DB ✅ DONE
```bash
gwrk ship 001 14
```
Shipped: `project_id` column on 8 tables, all queries scoped, `PlanStore` accepts `projectId`, commands derive project from `cwd`.

**Also fixed** (manual, 2026-06-01):
- `workflow-runtime.ts`: RUN_COMMAND redirect guard changed from throw to warn-and-filter (was breaking `define tasks` 100% of the time)
- `profile-detector.ts`: imports `ProjectProfile` from `prompt-conditioner.ts`, detects gwrk by package name `@gwrk/cli`

---

### Step 10: Write agy adapter ✅ DONE
```bash
gwrk define spec 019
gwrk define plan 019
gwrk define tasks 019   # deterministic plan.md parser (no LLM)
gwrk ship 019           # shipped both phases, PR #71
gh pr merge 71 --squash  # merged to develop 2026-06-02
```

**What shipped** (F019, PR #71 — `019-agy-agent-migration`):
- `src/plugins/builtins/agents/agy/adapter.ts` — full `AgentBackend`: `isAvailable`, `dispatch`, `syncGovernance`
- `src/plugins/builtins/agents/agy/adapter.test.ts` — unit tests
- `src/plugins/builtins/agents/agy/manifest.yaml` — plugin manifest
- `src/plugins/builtins/agents/index.ts` — `agy` registered in `BUILTIN_AGENTS`
- `src/engine/router.ts` — fallback order updated to `["agy", "gemini", "claude"]`
- `src/engine/router.test.ts` — router tests for agy prioritization

**Also shipped during 019 (infrastructure fixes discovered en route)**:
- `src/engine/plan-to-tasks.ts` — **[NEW]** deterministic `plan.md` → `tasks.json` parser. 60ms vs 53s LLM dispatch. Zero schema violations.
- `src/engine/define-orchestrator.ts` — auto-commit after each define stage (clean working tree)
- `src/commands/tasks-generate.ts` — auto-commit on success
- `src/engine/harvest.ts` — `finalizeLogs` commit uses `--no-verify` (log files don't need build checks); failure no longer kills DB update/gate reconciliation/compression
- `src/utils/git.ts` — `commitFiles` accepts `{ skipHooks: true }`
- `src/db/runs.ts` — `startRun` auto-resolves `project_id` from `process.cwd()`; `listRuns` filters by `project_id`
- `src/db/migrations/010-backfill-project-id.sql` — backfilled 7,089 NULL `project_id` rows; purged 410 test project entries

---

### Step 11: Verify daily driver ← **YOU ARE HERE**
```bash
cd ~/Code/EnergyWork
gwrk init                    # interactive wizard works
gwrk define plan EnergyWork  # EnergyWork-appropriate output (agy backend)
gwrk plan status             # ONLY EnergyWork features
cd ~/Code/gwrk
gwrk plan status             # ONLY gwrk features
```

**All pass → DAILY DRIVER ✅**

---

## After Daily Driver (P1)

| Item | What | Work |
|---|---|---|
| Lifecycle status | `gwrk plan status 001 --phases` | New command: spec→plan→tests→tasks→ship readiness per phase |
| Doc rewrite | `architecture.md`, `WHAT_IS_GWRK.md`, `README.md`, `ROADMAP.md` | Remove gwrk-specific refs. Present gwrk as project-agnostic. |
| CLI cleanup | Remove `setup` from help | Absorbed by P10 — verify or manual cleanup |
| Gate authoring | `define tests` → gate scripts | Currently generates tasks.json but NOT gate .sh files. Ship auto-approves missing gates. |

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
| 2026-06-01 | Restored full analysis sections below runbook. Audit accumulates; it doesn't delete. |
| 2026-06-01 | Added Section G: gemini→agy migration. Hard deadline June 18. P0. |
| 2026-06-01 | Shipped P10, P12, P13, P14. Fixed prompt-conditioner guard resolver, workflow-runtime RUN_COMMAND guard. Updated runbook — agy adapter is sole remaining daily driver blocker. |
| 2026-06-02 | **Shipped F019** (PR #71, merged). `AgyAdapter` delivered. Deterministic `plan-to-tasks` parser replaced LLM dispatch. Harvest bug fixed (finalizeLogs throw killed DB update). DB backfill: 7,089 NULL `project_id` rows filled, `startRun` auto-resolves. Auto-commit after all define stages. Daily driver verification is the sole remaining step. |
| 2026-06-02 | **Backlog expansion**: Added Sections H–W. Full research pass on every backlog item: test regression (17 failures from F019), feature lifecycle status command, plan_features DB reconciliation, gate authoring reliability, ROADMAP rewrite, doc decontamination, ship loop hardening (FM-4/5/6), LaunchAgent e2e, server-initiated harvest, state contracts (P9), F013 overlap audit, F005 defer, F007 dependency analysis, F012 ghost, Obsidian/Stitch integration. DB hygiene SQL documented. |
| 2026-06-02 | **Section H resolved** (`90f5fb4`). 17 test failures → 0. Root cause: FK constraint from auto-resolved `project_id`. Fix: `INSERT OR IGNORE INTO projects` before runs INSERT. Also fixed 6 pre-existing failures (tasks-generate, define-orchestrator, harvest, scaffold-feature). Ship harvest `prNumber` plumbing fixed (was hardcoded 0). **756 passing, 0 failing.** |

---

## Analysis: Priority Breakdown

### Execution Order

| Priority | What | Feature | Ship Command | Blocks Daily Driver? |
|---|---|---|---|---|
| **P0** | Remove dead `.specify/` code + `agy` adapter | F001 cleanup | Manual commit | YES (init creates garbage) |
| **P0** | Fix `plan_features` DB — delete foreign/phantom entries, consolidate duplicates, update statuses | F018 | SQL + `gwrk plan seed --force` | **YES** (tool can't self-report) |
| **P0** | Reconcile coverage matrices in all spec/plan files | F001-F014 | Manual plan edits | **YES** (specs lie about what's done) |
| **P0** | Init wizard + setup absorption + profile detection | F001 Phase 10 | `gwrk ship 001 10` | **YES** |
| **P0** | Prompt decontamination (84 refs in 13 PROMPT.md) | F001 Phase 13 | `gwrk ship 001 13` | **YES** |
| **P0** | Project-scoped DB isolation (8 tables, 10+ queries) | F001 (new phase) | `gwrk ship 001 <TBD>` | **YES** (cross-project pollution) |
| **P1** | Define output parity (quiet mode) | F001 Phase 12 | `gwrk ship 001 12` | No — quality |
| **P1** | Feature lifecycle status command (`gwrk plan status 001 --phases`) | New feature | TBD | No — but daily driver wants it |
| **P1** | Project-agnostic doc rewrite (`architecture.md`, `README.md`, `WHAT_IS_GWRK.md`, CLI help) | Docs | Manual | No — blocks "shareable" |
| **P2** | Ship loop hardening (FM-4/5/6) | F004 | Manual | No — quality-of-life |
| **P2** | LaunchAgent e2e verification | F002 | `gwrk server install` | No — server optional |
| **P3** | Obsidian integration spec | F020 (new) | `gwrk define spec 020` | No — backlog |
| **P3** | Server-initiated harvest | F011 P6 (new) | Spec amendment first | No — architectural |
| **P3** | State contracts | F001 Phase 9 | `gwrk ship 001 9` | No — deferred |

### Define-Tests Prompt/Guardrail Contradiction (Resolved 2026-06-01)

> [!WARNING]
> **The `gwrk define tests` → `gwrk ship` pipeline was broken for Phase 10.**
> Three consecutive runs failed (runs #6818, #6819, #6820). Root cause: a **prompt/guardrail contradiction**.
>
> - `gwrk-define-tests/PROMPT.md` Section 6 (L110-118) told the agent: *"MANDATORY FOR TYPESCRIPT: You MUST also generate minimal source file stubs"*
> - `tests-generate.ts` L250-279 reverts ANY `src/*.ts` modification that isn't `*.test.ts`
>
> The agent followed the prompt, wrote stubs in `src/`, and the guardrail correctly reverted all changes. Failed 100% of the time.

**Resolution**: Option B chosen — removed Section 6 (stub mandate) from PROMPT.md. The guardrail was correct; the prompt was wrong. RED tests importing non-existent modules IS the intended red state. Committed in `4b89f0b`.

**Options considered:**

| Option | Change | Risk |
|---|---|---|
| A. Relax guardrail | `tests-generate.ts`: Allow new `src/` files but block modifications to existing ones. | Agent could create garbage stubs that conflict with real implementation |
| B. Remove stub mandate from prompt ✅ | `gwrk-define-tests/PROMPT.md` L110-118: Delete Section 6 entirely. | Tests won't compile until implementation starts. Acceptable — that IS the red state. |

### Define-Tasks RUN_COMMAND Violation (Observed 2026-06-01)

`gwrk define tasks 001 --phase 13` (run #6859) failed with:
```
⚠ Blocked WRITE_FILE intent targeting tasks.json — agent already applied changes natively.
Stage PLAN_TO_TASKS failed: Workflow execution violation: Use WRITE_FILE JSON intent only.
```

**Root cause**: Agent returned JSON with a `RUN_COMMAND` intent containing a shell redirect (`>` or `tee`). Guard at `workflow-runtime.ts` L288-296 catches this. Meanwhile, the agent had already written `tasks.json` natively — the file on disk was correct.

**Workaround**: Commit the natively-written tasks.json directly. The agent's work landed; the runtime threw a false positive.

**Proper fix**: This is P12/T067 — "Tolerant JSON extraction in workflow-runtime.ts". When an agent does native work AND returns intents, the runtime should prefer the native result and drop redundant intents instead of throwing.

### Dependency Analysis

> [!IMPORTANT]
> **The sequential dependency is real**: P10 (init wizard) MUST ship before P13 (prompt decontamination) because `prompt-conditioner.ts` depends on project profile data that `init` creates. P14 (DB scoping) depends on P10 because scoping needs `projects` table registration from `init`. P13 and P14 are independent of each other and could ship in parallel after P10.

### Fallback: If `gwrk define` stays broken

The define pipeline dispatches to Gemini CLI which has been hitting 429s and guardrail violations. If it doesn't stabilize:

1. **Write tests manually** for P10/P13/P14 — the spec has all the TR-### requirements mapped
2. **Ship with `gwrk ship 001 10 --skip-define`** or implement directly on branch
3. This is pragmatic, not ideal. The pipeline is the product — but the product needs to work on other projects before the pipeline can be perfected

---

## Analysis: P0 Items Detail

### 1. Dead Code Cleanup ✅
- ~~Remove `.specify/templates` from `init.ts:105`~~
- ~~Remove `.specify` refs from `scaffold-feature.ts`~~
- ~~Delete `src/plugins/builtins/agents/agy/adapter.ts`~~

### 2. Build Plan DB Reconciliation ✅
- ~~Delete foreign entries (047, 049)~~
- ~~Delete phantom entries (F009, F010, F014-R, F015-F017, F999-missing)~~
- ~~Consolidate to spec-based IDs~~
- ~~Update statuses to match reality~~

### 3. Coverage Matrix Reconciliation ✅
- ~~F004, F011, F002, F003, F014 coverage matrices updated~~

### 4. F001 Phase 10: Init Wizard ([plan.md L265](specs/001-cli-core/plan.md))
- `profile-detector.ts` NEW — project type auto-detection
- `init.ts` REWRITE — interactive wizard, absorb `setup.ts`
- `config.ts` MODIFY — extend schema with project profile
- `setup.ts` DELETE
- Spec: US-001 (R3), FR-001 (R3), FR-030–032

### 5. F001 Phase 13: Prompt Decontamination ([plan.md L371](specs/001-cli-core/plan.md))
- `prompt-conditioner.ts` NEW
- 13 PROMPT.md files refactored (84 gwrk-native refs)
- `project-info.ts` NEW
- Spec: US-028, FR-033–035
- Depends on Phase 10

### 6. F001 Phase 14 (NEW): Project-Scoped DB Isolation

**Root cause**: The `047-ontology-integration` leak wasn't a data accident — it's a structural gap. The global DB has no project scoping. See [Section F](#f-global-db-has-no-project-scoping-root-cause-of-e2) for full evidence.

**Deliverables**:
- `src/utils/project-id.ts` NEW — `resolveProjectId(cwd)` canonical utility
- `src/db/migrations/009-project-scoping.sql` NEW — add `project_id TEXT` + indexes to 8 tables
- `src/db/index.ts` MODIFY — `safeAddColumn` safety net for all 8 tables
- `src/db/plan.ts` MODIFY — all query functions accept and filter by `projectId`
- `src/db/runs.ts` MODIFY — `listRuns()`, `getStats()` filter by project
- `src/db/gates.ts` MODIFY — scope gate results to project
- `src/db/compression.ts` MODIFY — scope compression metrics
- `src/db/issues.ts` MODIFY — scope issues
- `src/db/plugins.ts` MODIFY — scope routing history
- `src/engine/plan-store.ts` MODIFY — `PlanStore` constructor accepts `projectId`
- `src/engine/drift-detector.ts` MODIFY — project-scoped drift checks
- `src/commands/plan.ts` MODIFY — all subcommands derive and pass `projectId`
- `src/commands/stats.ts` MODIFY — project-scoped stats
- `src/commands/runs.ts` MODIFY — project-scoped run history
- Spec: needs US/FR additions to `specs/001-cli-core/spec.md`
- Depends on Phase 10 (init must register projects before scoping works)

---

## Analysis: P1 — Quality & Shareability

- **F001 Phase 12**: Define output parity (quiet mode)

- **Feature Lifecycle Status**: No single command answers "where is 001 P10?" The artifact lifecycle (spec → plan → tests → tasks → ship) is invisible. `gwrk plan status` shows the DAG but not whether spec predates plan, whether tests exist, or whether tasks.json is populated. Desired output:
  ```
  001-cli-core / Phase 10: Unified Init
    spec.md    updated 2026-05-30   ✅
    plan.md    updated 2026-05-30   ✅ (after spec)
    tests      defined 2026-06-01   ✅ (gap-matrix.md exists)
    tasks      defined 2026-06-01   ✅ (tasks.json exists)
    shipped    —                    ⏳ ready to ship
  ```

- **Project-Agnostic Doc Rewrite**: Same contamination as the PROMPTs but in human-facing docs. These files reference gwrk-specific tooling (vitest, Commander.js, SQLite, `src/` layout) that screams "this tool only works on itself":
  - `docs/architecture.md` — hardcodes gwrk's stack as THE architecture
  - `docs/WHAT_IS_GWRK.md` — presents gwrk as self-referential
  - `docs/README.md` — setup instructions assume gwrk's own toolchain
  - CLI help text — `setup` still listed as standalone command (absorbed by P10)
  - `ROADMAP.md` — stale (test counts wrong, daily driver section lies)

## G. Agent Backend Migration: gemini → agy ✅ SHIPPED (F019, PR #71, 2026-06-02)

> **Gemini CLI is discontinued June 18, 2026.** Replaced by `agy` (Antigravity CLI). Migration completed 16 days ahead of deadline.

### What Shipped

| File | Change | Status |
|---|---|---|
| `src/plugins/builtins/agents/agy/adapter.ts` | `AgyAdapter` implementing `AgentBackend`. YOLO → `--dangerously-skip-permissions`. No `--model` (server-side). | ✅ |
| `src/plugins/builtins/agents/agy/adapter.test.ts` | Unit tests: command generation, YOLO mapping, governance sync | ✅ |
| `src/plugins/builtins/agents/agy/manifest.yaml` | Plugin manifest | ✅ |
| `src/plugins/builtins/agents/index.ts` | `agy` registered in `BUILTIN_AGENTS` | ✅ |
| `src/engine/router.ts` | Fallback: `["agy", "gemini", "claude"]` | ✅ |
| `src/engine/router.test.ts` | Router prioritization tests | ✅ |

### CLI Surface Comparison (researched 2026-06-01)

| Capability | `gemini` | `agy` | Migration Impact |
|---|---|---|---|
| Non-interactive (headless) | `-p "prompt"` | `-p "prompt"` / `--print` | ✅ Same flag |
| YOLO mode | `--approval-mode yolo` | `--dangerously-skip-permissions` | ✅ Mapped in adapter |
| Sandbox control | `--sandbox false` | `--sandbox` (flag-on) | ✅ Omitting = no sandbox |
| Model selection | `--model gemini-3-flash-preview` | ❌ No `--model` flag | ✅ Server-side. Adapter ignores. |
| Governance file | `GEMINI.md` | `AGENTS.md` | ✅ `syncGovernance` targets `AGENTS.md` |
| Exit codes | 53=turn_limit, 42=usage | Observed: 0=success | ⚠️ Turn limit codes still untested |

### Open Questions (Post-Ship)

> [!NOTE]
> 1. **Exit codes**: Turn limit / usage error codes still untested under `agy`. Monitor in production.
> 2. **Rate limits**: 019 ship run hit one 429 during CODE_REVIEW (P2). `agy` still shares Gemini quota. G1 credit fallback not yet confirmed.
> 3. **Quota prober**: `src/server/quota-prober.ts` not yet updated to probe `agy`. Low priority — router already handles fallback.

---

## Analysis: P1 — Post-Daily-Driver (Quality & Completeness)

### H. ~~Test Regression from F019 Merge (17 failures — FIX FIRST)~~ ✅ RESOLVED

> [!NOTE]
> **Resolved** (commit `90f5fb4`). Root cause was `FOREIGN KEY constraint failed` — `startRun()` auto-resolved `project_id` from `process.cwd()` but didn't register the project in the `projects` table. Fix: `INSERT OR IGNORE INTO projects` before the `runs` INSERT. Also fixed 6 pre-existing test failures (not from F019): tasks-generate tests rewritten for deterministic parser, define-orchestrator lifecycle test updated, harvest test assertion updated for `skipHooks`, scaffold-feature template path corrected.

**Result**: 756 passing, 0 failing, 8 skipped, 8 todo (772 total).

**Ship orchestrator harvest fix** (bonus): `prNumber` was hardcoded `0` in the harvest call — now wired from actual PR creation via `this.state.prNumber`.


---

### I. ~~Feature Lifecycle Status Command~~ ✅ PHASE DATA POPULATED (lifecycle ladder TODO)

> [!NOTE]
> **Phase data populated** (commit `6642aae`). `plan_phases` now has 60 phases across 12 features, with 48 marked SHIPPED from runs DB enrichment. `gwrk plan status` now shows per-phase lifecycle detail. `gwrk plan init` parses `### Phase N: Title` headings from each feature's `plan.md`, inserts feature-scoped phase IDs (`{featureId}/phase-{seq}`), and enriches status from ship runs. Idempotent, additive, with 11 new tests (unit + integration).

**Result**: `SELECT COUNT(*) FROM plan_phases; -- 60 rows (was 0)`

**Remaining**: The per-feature lifecycle ladder command (`gwrk plan status 001 --phases` with artifact timestamps and PR linkage) is still TODO — but the data foundation is now in place.

**Test coverage**: 
- `readiness-scanner.test.ts`: 3 new tests (phase parsing)
- `plan-store.test.ts`: 4 new tests (insert, enrichment, additive, no-clobber)
- `plan-store-init.test.ts`: 5 new integration tests (real SQLite + filesystem)

---

### J. ~~`plan_features` Status Reconciliation~~ ✅ RESOLVED

> [!NOTE]
> **Fully reconciled** across two commits (`6642aae`, `ec016ad`) + manual SQL backfill.
>
> **Code fixes** (permanent):
> - `plan init` now prunes ghost features (DB entries with no `specs/` dir) — deleted `099-drift-test`, `F000`, `F000-TDD`
> - `plan init` reconciles feature status from phase data (all-shipped → SHIPPED, some-shipped → IN_PROGRESS)
> - `plan init` reconciles wrong feature names (fixed 019's name from "Read and make section G a spec" → `019-agy-agent-migration`)
> - `db/plan.ts`: new `updateFeatureStatus()` / `updateFeatureName()` — avoids `INSERT OR REPLACE` which triggers `ON DELETE CASCADE` destroying child phases
>
> **Manual backfill** (one-time SQL):
> - `001-cli-core` P1–P6: PLANNED → SHIPPED (pre-ship-loop work, code exists with ✅ markers)
> - `004-ship-loop` P2–P4: PLANNED → SHIPPED (superseded by F004-R rewrite in P5)
> - `007-effort-compression` P1–P3: PLANNED → SHIPPED (code + 12 tests exist, `gwrk measure effort/compression` operational)
> - Feature statuses: `001-cli-core` → SHIPPED, `007-effort-compression` → SHIPPED
>
> **Final state**: 14 features (13 SHIPPED, 1 PLANNED), 63 phases (63/63 SHIPPED), 0 ghosts.
>
> **013 Agent-Native Interface audit** (2026-06-02):
> The plan.md uses `## Phase N —` headings (not `### Phase N:`) so the scanner couldn't parse it — 0 phases in DB despite being substantially shipped. Manual FR-by-FR verification:
>
> | FR | Status | Evidence |
> |---|---|---|
> | FR-001 `withSignal` | ✅ SHIPPED | `signal.ts` exists (2017B), 25/25 command files wrap with `withSignal`, live `[exit:0 \| 63ms]` confirmed |
> | FR-002 `--format json` | ✅ SHIPPED | `output.ts` (2048B), global `--format` flag in `cli.ts:34`, 10+ commands support JSON |
> | FR-003 `--agent` Layer 2 | ✅ SHIPPED | `agent-layer.ts` (89 lines), 12 test cases passing, `stripAnsi`/`guardBinary`/`truncateOverflow` all implemented |
> | FR-004 `project discover` | ✅ SHIPPED | `discover.ts` engine (212 lines) + `project-discover.ts` CLI wired. `gwrk project discover [--format json]` returns full `ProjectDiscovery` (DM-001). Existing test passing. |
> | FR-005 `project specs/gates` | ✅ SHIPPED | `project-specs-gates.ts` — `gwrk project specs` lists all specs with status table, `gwrk project gates` shows gate summary. Both support `--format json`. Tests un-skipped + passing. |
> | FR-006 `gate-check` | ✅ SHIPPED | Implemented as `gwrk gate` (494 lines), `GateCheckResult` DM-002 schema exact match |
> | FR-007 Error-as-navigation | ✅ SHIPPED | 27 `Run '...'` guidance instances across commands |
> | FR-008 Help enrichment | ✅ SHIPPED | Exit codes (5 cmds), Type declarations (7 cmds), Examples (23 cmds) |
> | FR-009 Exit codes | ✅ SHIPPED | `exit(127)` for unknown commands, `exit(2)` for usage errors, standardized across CLI |
>
> **Verdict**: 9/9 FRs fully shipped. Feature status → SHIPPED. FR-004/FR-005 CLI wiring completed 2026-06-02.

---

### K. ~~Gate Authoring Reliability (Ship Loop Quality)~~ ✅ RESOLVED

> **Spec reference**: [ship-failure-diagnosis.md](specs/004-ship-loop/refs/ship-failure-diagnosis.md)
> **ADR dependency**: [ADR-005](docs/decisions/ADR-005-tdd-gate-architecture.md) (TDD Gate Architecture)
> **Code**: [gate-gen.ts](src/utils/gate-gen.ts) (722 lines)
> **Prompt audit**: [prompt_audit.md](file:///Users/gonzo/.gemini/antigravity-ide/brain/b3189032-f68e-48f9-8b07-59cc9f0e6e9c/prompt_audit.md) — full audit of all 15 workflow prompts

> [!NOTE]
> **All 3 TO-BE items resolved 2026-06-02:**
>
> 1. ✅ **LLM gate path eliminated.** `gwrk-author-gates` workflow exists on disk but is never invoked. Runtime falls through to `generateVitestGates()` (gap-matrix path) or `generateFilesystemGates()` (filesystem convention). Confirmed by `tasks-generate-phase12.test.ts` assertion: `expect(source).not.toContain("gwrk-author-gates")`.
>
> 2. ✅ **SIGPIPE immunity.** Deterministic gates use `pnpm vitest run ... || { echo "FAIL" >&2; exit 1; }` — no `grep -q` pipes. Prompt SIGPIPE patterns also fixed (`gwrk-define-tests`, `gwrk-specify`).
>
> 3. ✅ **Filename validation at generation time.** `generateFilesystemGates()` now checks `fs.existsSync(primaryFile)` before emitting gate scripts. Files extracted from task descriptions that don't exist on disk are skipped, not gated.
>
> **Prompt hardening (P2-P6):** User input wrapped in `<user_input>` XML tags in `workflow-runtime.ts`. Hedge words removed from `gwrk-plan`. No credential leaks found across any prompt.

---

### L. ~~ROADMAP.md Rewrite~~ ✅ RESOLVED

> [!NOTE]
> **Deleted.** `ROADMAP.md` was 163 lines of stale prose (wrong test counts, wrong feature statuses, wrong "What NOT to Build" recommendations). Replaced by `gwrk plan`, which produces live, DB-backed output:
>
> - `gwrk plan status` — per-feature, per-phase status
> - `gwrk plan render --stdout` — full 306-line build plan with Mermaid dependency graph, critical path Gantt, wave strategy, effort estimates
> - `gwrk plan waves` / `gwrk plan critical` / `gwrk plan next` — computed from DAG, not handwritten
>
> Static roadmaps lie. `gwrk plan` is the roadmap.

---

### M. ~~Doc Decontamination~~ → Doc & Workflow Architecture Restructure ✅ RESTRUCTURED

> **Root cause**: `docs/` had 6 overlapping directories with 38 of 48 files orphaned. 15 builtin workflows existed but only 8 were invoked by any CLI command or engine. The `gwrk-effort` workflow was archived but its CLI command (`gwrk measure effort`) still exists as a vestige.
> **Audit**: [docs_architecture_audit.md](file:///Users/gonzo/.gemini/antigravity-ide/brain/b3189032-f68e-48f9-8b07-59cc9f0e6e9c/docs_architecture_audit.md)

#### Completed (2026-06-02)

**Docs restructure** — 6 overlapping dirs → coherent hierarchy:

| Directory | Role | Status |
|-----------|------|--------|
| `decisions/` | ADRs (gwrk's architectural decisions) | ✅ 6 of 7 referenced by prompts |
| `grounding/` | Agent context (architecture, CLI grammar, ontology) | ✅ Referenced by 7 prompts |
| `research/` | Initiative lifecycle (brief → draft → cascade) | ⚠️ Output dir for `gwrk-research` (no CLI wired yet) |
| `assessments/` | Effort estimates | ⚠️ Output dir for archived `gwrk-effort` workflow |
| `product/` | Human-facing docs (PRD, README, Foxtrot Charlie) | — |
| `branding/` | Visual assets | — |
| `archive/` | 38 orphaned docs + 6 dead workflows | — |

**Principle**: gwrk keeps self-documenting docs. The `[type: gwrk-native]` / `[type: generic]` prompt conditioner handles isolation for non-gwrk projects.

**Workflow audit** — 15 builtins → 9 remaining (8 active + 1 future):

| Workflow | Status | Invoked by |
|----------|--------|-----------|
| `gwrk-specify` | ✅ | `define-orchestrator.ts` |
| `gwrk-plan` | ✅ | `define-orchestrator.ts` |
| `gwrk-analyze` | ✅ | `define-orchestrator.ts` |
| `gwrk-define-tests` | ✅ | `tests-generate.ts` |
| `gwrk-plan-to-tasks` | ✅ | `tasks-generate.ts` |
| `gwrk-implement` | ✅ | `ship-orchestrator.ts` |
| `gwrk-review-code` | ✅ | `ship-orchestrator.ts` → `review-plugin.ts` |
| `gwrk-review-uat` | ✅ | `ship-orchestrator.ts` → `review-plugin.ts` |
| `gwrk-research` | ⏳ Future | No CLI command — see next steps |

6 archived: `gwrk-author-gates`, `gwrk-build-plan`, `gwrk-cascade-sync`, `gwrk-checklist`, `gwrk-constitution`, `gwrk-effort`.

#### Next Steps

| # | Item | Status |
|---|------|--------|
| 1 | ~~**Remove `gwrk measure effort` CLI command.**~~ Deleted `effort.ts`, `effort.test.ts`, `report-writer.ts`. Removed from `measure.ts`, CLI grammar, UX test, consistency test, E2E test. Engine function `computeEffort()` stays — compression calls it internally. `gwrk measure` is now `{pulse, compression}`. | ✅ Done |
| 2 | **Wire `gwrk define research`.** Needs research first — the research workflow should be pluginable (JTBD, market landscape, building a case are different for every user). This is a plugin system concern, not a CLI wiring task. | Roadmap (F014) |
| 3 | **Project perspective mechanism (F014 enforcement skills).** The primary use case for project overrides. For non-gwrk projects, agents need project-scoped standards (code-smell, linting, architecture grounding). F014 defines this via enforcement skills and `.gwrk/plugins.yaml`. | Roadmap (F014) |
| 4 | **Rewrite `docs/product/WHAT_IS_GWRK.md`.** Should describe gwrk as a tool for any project — the PE's operating system thesis, not a self-bootstrapping narrative. | Roadmap |
| 5 | ~~**Archive `docs/assessments/`.**~~ Moved to `docs/archive/assessments/`. Wrong approach; compression subsumes effort. | ✅ Done |

---

## Analysis: P2 — Infrastructure Hardening

### N. Ship Loop Hardening (FM-4/5/6)

> **Spec reference**: [ship-failure-diagnosis.md](specs/004-ship-loop/refs/ship-failure-diagnosis.md)
> **Code**: [ship-orchestrator.ts](src/engine/ship-orchestrator.ts)

#### FM-4: Stale dist Detection → ~~gwrk-specific~~ → R007

**Disposition**: Not a ship loop concern — this is a project-perspective problem. A TypeScript project needs `dist/` freshness checks; Python doesn't have `dist/`; Go builds differently. This belongs in the project-scoped pre-flight system designed in R007 (enforcement skills).

**Status**: Deferred to R007.

---

#### FM-5: ~~UAT Stall / Timeout~~ → Hung Sub-Commands

**Corrected diagnosis**: The agent itself rarely hangs. What actually happens is the agent runs a bash command that hangs — interactive prompts waiting for stdin, merge conflict editors, `pnpm dev` servers, lock contention, commands that don't exit. The agent doesn't know how to recover. It just waits.

**The real problem**: The implement prompt (`gwrk-implement/PROMPT.md`) contains bash blocks with no timeout or anti-hang guidance:
- `pnpm build` (line 52) — can hang on stdin prompts
- `git merge develop --no-edit` (line 80) — can hang on merge conflicts
- `pkill -f 'pnpm.*dev'` (line 49) — can hang if matching processes are in uninterruptible states
- No `timeout` wrapper on any command
- No "if this command produces no output for 60s, kill it" pattern
- No guidance telling the agent to use `--non-interactive` flags

**TO-BE**: Add `<command_safety>` block to implement prompt:
1. All build/test commands should be wrapped in `timeout` or have `--non-interactive` equivalents
2. Agent guidance: "If a command produces no output for 60 seconds, kill it and retry without interactive flags"
3. Explicit blacklist: never run `pnpm dev`, `npm start`, or any long-running server process
4. Merge conflicts: detect `CONFLICT` in git merge output and abort rather than wait for editor

**Effort**: ~1 hour. Prompt engineering + enforcement skill for command safety.

---

#### FM-6: ~~Stale Branch Cleanup~~ → Low Priority

**Reassessed**: `git push -u origin` (L917) works. `--force-with-lease` adds complexity for a problem that hasn't occurred in practice. Branch cleanup after merge is nice-to-have hygiene, not a failure mode.

**Status**: Parking lot. Not blocking daily-driver use.

---

### O. LaunchAgent E2E Verification (F002)

> **Spec reference**: [F002 spec](specs/002-build-server/spec.md) (FR-012–015)
> **Code**: [server-install.ts](src/commands/server-install.ts), [pid.ts](src/server/pid.ts)

#### Current State

- `installServer()` exists in `server-install.ts` — generates a plist and calls `launchctl load`
- `uninstallServer()` exists — calls `launchctl unload` and deletes the plist
- `gwrk server install` CLI command wired up in `server.ts`
- `pid.ts` checks `launchctl list com.gwrk.server` for PID authority
- **Never been run e2e on the workstation** — no plist exists at `~/Library/LaunchAgents/com.gwrk.*`
- The server itself (`gwrk server start`) works — it's the persistent service installation that's untested

#### TO-BE

```bash
gwrk server install    # writes plist, loads LaunchAgent
gwrk server status     # shows PID from launchctl
# reboot
gwrk server status     # still running (LaunchAgent auto-start)
gwrk server uninstall  # unloads, deletes plist
```

**Risks**:
1. `server-install.ts` L47-74 generates a plist with `process.execPath` (Node binary) + `dist/server/index.js`. If `dist/` path is wrong or Node location differs from what's hardcoded, launchd silently fails.
2. PID file vs launchctl authority conflict (`pid.ts` L19-30) — untested under real launchctl conditions.

**Effort**: 30 minutes manual test + fix any path issues.

---

### P. Server-Initiated Harvest (F011 Amendment)

> **Spec reference**: [F011 spec](specs/011-harvest/spec.md) — US-H01 assumes inbound GitHub webhook
> **Code**: [github.ts](src/server/github.ts) (177 lines) — webhook handler, fully implemented but trigger architecture rejected
> **ADR**: [ADR-003](docs/decisions/ADR-003-state-contract.md) — harvest is Tier 2 (build-server-side SQLite)

#### Current State

The harvest engine ([harvest.ts](src/engine/harvest.ts)) works — F019 just proved it. The problem is the **trigger**: 

- `github.ts` is a Fastify route handler that expects an inbound `POST /webhook/github` from GitHub. This requires a public URL, which the build server doesn't have (runs on localhost:18790 behind NAT).
- Current trigger: **manual** — `gwrk ship` → merge PR in GitHub/Slack → nothing happens → user manually triggers harvest or it was called inside `ship-orchestrator`.

#### Three Options (from audit)

| Option | Mechanism | Complexity | Reliability |
|---|---|---|---|
| A. GitHub API polling | `gh pr list --state merged` on interval (heartbeat loop) | Low | High — no network dependency, no webhook config |
| B. Slack relay | GitHub → Slack webhook notification → Socket Mode → gwrk | Medium | Medium — depends on Slack uptime + GitHub→Slack integration |
| C. `gh` CLI in heartbeat | Heartbeat already runs on interval. Add `gh api` call to check merged PRs. | Low | High |

**Recommendation**: Option C. The [heartbeat.ts](src/server/heartbeat.ts) already runs periodic checks (drift, staleness). Add a `checkMergedPRs()` step that calls `gh pr list --repo <repo> --state merged --json number,mergedAt --limit 5` and cross-references with `runs` table for unfinished ship runs.

#### TO-BE

```
Heartbeat loop (every 5 min):
  1. Check plan staleness ✅ (exists)
  2. Check drift           ✅ (exists)
  3. NEW: Check merged PRs → trigger harvest for any unfinished ship runs
```

**Effort**: ~2 hours. Add to heartbeat loop + `gh` CLI integration.

---

### Q. F001 P9: State Contracts (Execution Manifests + Tasks Verify)

> **Spec reference**: [spec.md US-019, US-020](specs/001-cli-core/spec.md), [ADR-003](docs/decisions/ADR-003-state-contract.md)
> **Code that exists**:
>   - `tasks verify` command: [tasks.ts L225](src/commands/tasks.ts) — wired up and functional
>   - `tasks-verify.test.ts` — 4 test cases (schema validation, orphan detection, regression check)
>   - Manifest writer: `tasks.ts L167` — writes execution manifest to `.gwrk/runs/`
>   - `.gitattributes` merge protection: NOT implemented

#### Current State

`tasks verify` exists and runs but has issues:
- Skips `index.json` files with "invalid manifest" error (schema expects `runId` but `index.json` is a different format — it's a log index, not a manifest)
- Manifest writer works — F019 produced valid manifests in `specs/019-agy-agent-migration/.gwrk/runs/`
- `.gitattributes` merge protection for `tasks.json` NOT implemented

**What's actually missing for P9 completion**:

| Item | Status | Work |
|---|---|---|
| Manifest writer | ✅ Ships | In `tasks.ts` L167 |
| `tasks verify` command | ⚠️ Mostly works | Fix `index.json` skip, verify schema |
| `.gitattributes` protection | ❌ Missing | Add `specs/**/.gwrk/tasks.json merge=ours` |
| `history.jsonl` deprecation (FR-021) | ⏳ Deferred | Reads supported; writes go to DB + manifest |

**Effort**: ~1 hour. Fix the `index.json` filter in tasks-verify, add `.gitattributes` template to `gwrk init`.

---

## Analysis: P3 — Backlog (Not Blocking)

### R. F013: Agent-Native Interface (Overlap Audit with ADR-004)

> **Spec**: [013-agent-native-interface/spec.md](specs/013-agent-native-interface/spec.md) — dated 2026-03-13, revision 1
> **ADR**: [ADR-004](docs/decisions/ADR-004-agent-native-output.md) — decided 2026-03-13 (same day)
> **Status**: Spec says "Draft". ADR says "Decided".

#### Overlap Analysis

F013 describes the **ideal** agent-native CLI surface. ADR-004 made the **decision** and partially implemented it. The overlap:

| F013 Deliverable | ADR-004 Status | Implementation |
|---|---|---|
| Operational signal envelope (`[exit:N | Xms]`) | ✅ Decided | Implemented in `withSignal()` utility |
| Command cost classification (probe/mutator) | ✅ Decided | `--help` output includes cost hints |
| Structured error output | ⚠️ Partial | Stack traces still leak in some paths |
| Binary guard (prevent destructive commands without confirmation) | ❌ Not implemented | Spec describes it, ADR defers |
| Overflow mode (large output truncation) | ❌ Not implemented | Spec describes it, ADR defers |
| Project state query surface (`gwrk project info`) | ✅ Shipped | P13 delivered `project-info.ts` |

**Verdict**: F013 is ~60% delivered via ADR-004 + P13. Remaining items (binary guard, overflow mode) are nice-to-have. Recommend closing F013 as "delivered via ADR-004" and tracking binary guard/overflow as future items if needed.

---

### S. F005: Parallel Dispatch

> **Spec**: [005-parallel-dispatch/spec.md](specs/005-parallel-dispatch/spec.md) — "Settled"
> **Code**: Zero implementation. `--parallel` flag on `gwrk ship` exists but does nothing.

#### Current State

The spec describes concurrent worktree sandboxes where independent tasks within a phase dispatch to separate agents simultaneously. This would require:
- `git worktree add` for each sandbox
- Per-backend concurrency limits (Codex: 2, Gemini: 3, Claude: 1)
- Merge via PR from each worktree back to feature branch
- Conflict resolution strategy

**Verdict**: This is premature optimization. The user is not bottlenecked on sequential dispatch. Current ship runs complete in 5-15 minutes per phase. Parallel dispatch adds significant complexity (worktree management, merge conflicts, error handling) for marginal time savings.

**Recommendation**: Defer indefinitely. Remove `--parallel` flag from CLI to avoid false promises.

---

### T. F007: Effort Compression

> **Spec**: [007-effort-compression/spec.md](specs/007-effort-compression/spec.md) — 3 phases
> **Code**: `compression` table exists in DB. `recordCompression()` in harvest.ts. Zero SP data populated.

#### Current State

The spec describes a full SP estimation and compression measurement system:
- Phase 1: Effort engine — parse spec stories for SP estimates
- Phase 2: Compression engine — calculate actual vs estimated delivery ratios
- Phase 3: CLI commands (`gwrk measure effort`, `gwrk measure compression`)

The `compression` table and `recordCompression()` exist from F011 harvest, but no SP data is populated because:
1. No spec stories have SP values assigned
2. `plan.md` phases don't have SP estimates
3. The effort extraction engine doesn't exist

**Verdict**: This is the "make gwrk's value legible" feature — it quantifies how much faster AI-assisted delivery is. Important for the product thesis but not blocking daily use.

**Dependency**: Needs SP values in specs and plans first. Could seed from plan.md phase structure.

---

### U. F012: Knowledge Work (Empty)

> **Spec**: Empty directory at `specs/012-knowledge-work/`. No spec, no plan, no tasks.
> **DB status**: PLANNED

**Verdict**: Ghost feature. Keep the number reserved. Assign when the discovery pillar needs a formal spec.

---

### V. Obsidian Integration (F020 — Unspecced)

> **Reference**: [new-features.md §Obsidian Integration](docs/reference/new-features.md) — comprehensive design doc (96 lines)
> **Code**: Zero.

#### Current State

The design doc in `new-features.md` is thorough. Key decisions already made:
- Vault root = project root (no file movement)
- `.obsidian/` is config-only (specs stay in `specs/`)
- Git split: commit `app.json` + `core-plugins.json`, ignore `workspace.json` + `plugins/`
- Canvas is one-way projection (`plan.md` → `build-plan.canvas`)
- CLI requires running Obsidian app (never a core dependency)

#### Open Questions (from the design doc)

1. **Wikilinks vs standard Markdown** — recommend standard links (GitHub + Obsidian both support)
2. **Canvas authoring model** — recommend one-way (plan.md → canvas on `gwrk define plan`)
3. **Obsidian Sync overlap** — recommend "detect and warn" only
4. **Agent consumption** — agents read `plan.md`, not `.canvas` (canvas is human visualization)

**Verdict**: Well-designed, not urgent. When needed, `gwrk define spec 020 "Obsidian Integration"` and the design doc becomes the spec input.

---

### W. Google Stitch Integration (Unspecced)

> **Reference**: [new-features.md §Google Stitch](docs/reference/new-features.md) — brief note (L120-129)

#### Current State

Brief note in new-features.md: "define UI and UX artifacts as part of the feature spec... leverage gwrk's existing definitional infrastructure... focus on written definitions but work within a visual development environment."

MCP server available (`StitchMCP`) with tools: `create_project`, `generate_screen_from_text`, `edit_screens`, `generate_variants`, `create_design_system`.

**Verdict**: Exploratory. No blocking dependency. Could integrate into `gwrk define` as a visual artifact generator for UI specs.

---

## Backlog DB Hygiene

> [!WARNING]
> The following DB entries need cleanup before `gwrk plan status` is trustworthy:

```sql
-- Fix F019 name and status
UPDATE plan_features SET name = 'Agent Backend Migration (gemini→agy)', status = 'SHIPPED'
  WHERE id = '019-agy-agent-migration';

-- Delete test fixture
DELETE FROM plan_features WHERE id = '099-drift-test';

-- Audit: should these legacy IDs stay?
-- F000 (Extraction) — DONE — historical
-- F000-TDD (TDD Infrastructure) — DONE — historical
-- Decision: keep for historical record, they're not hurting anything
```

---

## Prioritized Action Queue (Updated 2026-06-02)

> [!IMPORTANT]
> Execute top-down. Each item has been triaged for impact, effort, and dependency order. Items marked ✅ were resolved during this audit session.

### Tier 1: Fix Before Next Ship Run

| # | Section | Item | Effort | Notes |
|---|---------|------|--------|-------|
| ~~1~~ | ~~H~~ | ~~17 test failures from F019 merge~~ | ~~—~~ | ✅ Resolved. 152 pass, 0 fail. |
| ~~2~~ | ~~DB~~ | ~~**DB hygiene: fix F019 name/status, delete 099-drift-test.**~~ Fixed F019 name → "Agent Backend Migration (gemini→agy)". Fixed all feature names (were just IDs). 099-drift-test already absent. | ~~5 min~~ | ✅ Done |
| ~~3~~ | ~~Q~~ | ~~**Fix `tasks verify` index.json skip.**~~ `loadManifests()` now filters `index.json` before Zod parsing. Test added. | ~~30 min~~ | ✅ Done |

### Tier 2: Unblock Daily-Driver Quality

| # | Section | Item | Effort | Notes |
|---|---------|------|--------|-------|
| ~~4~~ | ~~N/FM-5~~ | ~~**Command safety posture ([ADR-008](docs/decisions/ADR-008-command-safety-posture.md)).**~~ Layers 1+2 implemented: `COMMAND_SAFETY_BLOCK` injected into every dispatch, `SAFE_AGENT_ENV` hardened in spawned process. 5 tests added. | ~~30 min~~ | ✅ Done |
| 5 | O | **LaunchAgent E2E verification.** `gwrk server install` has never been run on the workstation. Paths may be wrong. | 30 min manual | Risk: silent launchd failures if `process.execPath` or `dist/` path is wrong. |
| ~~6~~ | ~~Q~~ | ~~**Add `.gitattributes` merge protection for `tasks.json`.**~~ `gwrk init` now seeds `.gitattributes` with `merge=ours` for tasks.json, `merge=binary` for manifests, `merge=union` for history. Idempotent — skips if file exists. 2 tests added. | ~~15 min~~ | ✅ Done |

### Tier 3: Strategic (Spec/Research Required)

| # | Section | Item | Effort | Notes |
|---|---------|------|--------|-------|
| 7 | P | **Server-initiated harvest (heartbeat polling).** Add `checkMergedPRs()` to heartbeat loop. Option C from audit: `gh pr list --state merged` in existing heartbeat. | ~2 hrs | Needs spec amendment to F011. Harvest engine works; trigger is the gap. |
| ~~8~~ | ~~M.2~~ | ~~**Wire `gwrk define research`.**~~ R006 draft complete. Research methodologies are workflow plugins. CLI: `gwrk define research R00X --methodology jtbd`. Domain ontology first-class. | ~~Research~~ | ✅ Draft complete — awaiting review |
| ~~9~~ | ~~M.3~~ | ~~**Project perspective mechanism.**~~ R007 draft complete. Three layers: enforcement skills (how we build), domain ontology (what we're building), architecture grounding (system shape). Profile → enforcement routing algorithm designed. **F014 P13 shipped ADR-009 injection.** | ~~Research~~ | ✅ Research complete. Ontology injection shipped. Routing → next feature cycle. |
| ~~10~~ | ~~T~~ | ~~**Compression needs SP data.**~~ LOC-derived SP fallback wired (PR #76 + manual wiring fix). `gwrk measure compression --all` now produces real data for all 13 features. | ~~2 hrs~~ | ✅ Done. 1376 total SP, avg 144.68x point compression. |
| 11 | M.4 | **Rewrite `docs/product/WHAT_IS_GWRK.md`.** Currently self-referential. Should be the PE's operating system thesis. | ~1 hr | |

### Tier 4: Backlog (Not Blocking)

| # | Section | Item | Effort | Notes |
|---|---------|------|--------|-------|
| 12 | R | **Close F013 as "delivered via ADR-004."** 60% shipped (signal envelope, cost classification, project info). Binary guard and overflow mode are deferred. | 5 min | Update DB status. |
| 13 | S | **Remove `--parallel` flag from `gwrk ship`.** False promise — no implementation. Parallel dispatch (F005) is deferred indefinitely. | 15 min | Delete flag + related code in `ship.ts`. |
| 14 | N/FM-6 | **Branch cleanup after merge.** Nice-to-have hygiene. `--force-with-lease` adds complexity for a non-problem. | — | Parking lot. |
| 15 | V | **Obsidian Integration (F020).** Well-designed, not urgent. Design doc is ready to become spec input when needed. | — | `gwrk define spec 020` when ready. |
| 16 | W | **Google Stitch Integration.** Exploratory. No blocking dependency. | — | Could integrate into `gwrk define` as visual artifact generator. |
| 17 | U | **F012: Knowledge Work.** Ghost feature — empty spec directory. Number reserved. | — | Assign when discovery pillar needs a formal spec. |

### Resolved This Session

| Item | What happened |
|------|--------------|
| Section H: 17 test failures | ✅ All fixed. 152 pass, 0 fail. |
| Section K: Prompt hardening | ✅ XML wrapping, SIGPIPE, hedge words, filename validation at gate-gen. |
| Section L: ROADMAP vs audit | ✅ Assessed — this audit is the authoritative source. |
| Section M: Doc restructure | ✅ 6 overlapping dirs → coherent hierarchy. 6 dead workflows archived. `gwrk measure effort` removed. R006/R007 research briefs created. |
| DB hygiene | ✅ All feature names fixed (were just IDs). F019 → "Agent Backend Migration (gemini→agy)". |
| Tasks verify: index.json | ✅ `loadManifests()` now skips `index.json` before Zod parsing. Test added. |
| Open Q #1: Phase 14 scope | ✅ Shipped as P14. |
| Open Q #4: Test regression | ✅ Resolved — 0 failures. |

### Resolved 2026-06-03

| Item | What happened |
|------|--------------|
| F014 P11-P13 ship | ✅ PR #72 merged. Research CLI (P11), Methodology Dispatch (P12), Grounding Injection (P13) all shipped. 807 tests, 0 failures. |
| Ship/harvest DB chain | ✅ Root cause: `require('node:crypto')` in ESM → `project_id=NULL` → harvest `listRuns` query matched 0 rows. Fixed `runs.ts` to use ESM `import`. |
| Ship `finishRun` write-back | ✅ `ship.ts` now writes `pr_number`, `pr_url`, `status` via `orchestrator.getResult()` accessor. |
| ADR-009 hardening | ✅ Grounding injection in `agent.ts` wrapped in per-file try/catch. Refactored from 3 copy-paste blocks to data-driven loop. |
| Ship e2e test | ✅ `ship-orchestrator.e2e.test.ts` — 9 tests with real in-memory SQLite (no DB mocking). Catches: ESM crypto bug, PR data bug, project_id filtering, stale run accumulation. |
| DB remediation | ✅ 17 orphaned runs backfilled with `project_id`. P11/P12/P13 runs marked `shipped`. Stale P11 runs marked `abandoned`. |


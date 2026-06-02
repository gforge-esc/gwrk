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

### Step 10: Write agy adapter ← **YOU ARE HERE**

> [!CAUTION]
> **HARD DEADLINE: June 18, 2026.** `gemini` CLI discontinued. See Section G for full analysis.

```bash
# 1. Write adapter
# src/plugins/builtins/agents/agy/adapter.ts — implement AgentBackend

# 2. Register in index.ts
# Add agy to BUILTIN_AGENTS

# 3. Update defaults
# src/utils/agent.ts L425: "gemini" → "agy"
# src/engine/router.ts L97: ["agy", "gemini", "claude"]

# 4. Test dispatch
agy -p "echo hello" --dangerously-skip-permissions  # verify exit code 0
```

**What ships**: `AgyAdapter` backend, default fallback switch, `AGENTS.md` governance sync.

**Key differences from gemini adapter**:
- YOLO: `--dangerously-skip-permissions` (not `--approval-mode yolo`)
- Sandbox: omit flag = no sandbox (not `--sandbox false`)
- Model: **no `--model` flag** — server-side selection. `task.model` already optional on `TaskDispatch`. Adapter ignores it.
- Governance: writes `AGENTS.md` (not `GEMINI.md`)
- Exit codes: unknown — must test

**Done when**:
- `agy -p "echo hello" --dangerously-skip-permissions` → exit 0
- `gwrk define plan 001 --phase 10` dispatches to `agy` (visible in router log: `Router selected backend: agy`)
- `which gemini || true` — gwrk still works without gemini on PATH
- `pnpm build` clean, `pnpm test` passing

---

### Step 11: Verify daily driver
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

## G. Agent Backend Migration: gemini → agy (HARD DEADLINE: 2026-06-18)

> [!CAUTION]
> **Gemini CLI is discontinued June 18, 2026.** It is replaced by `agy` (Antigravity CLI v1.0.3+). Every `gwrk ship`, `gwrk define`, and review dispatch currently shells out to `gemini`. When it stops working, all agentic workflows break. **17-day countdown from audit date.**

### CLI Surface Comparison (researched 2026-06-01)

| Capability | `gemini` | `agy` | Migration Impact |
|---|---|---|---|
| Non-interactive (headless) | `-p "prompt"` | `-p "prompt"` / `--print` | ✅ Same flag |
| YOLO mode | `--approval-mode yolo` | `--dangerously-skip-permissions` | 🔶 Flag rename |
| Sandbox control | `--sandbox false` | `--sandbox` (flag-on) | ✅ Omitting = no sandbox (gwrk default for write workflows). Only add `--sandbox` for read-only workflows. |
| Model selection | `--model gemini-3-flash-preview` | ❌ No `--model` flag | ✅ **Server-side only.** `task.model` is already `optional` on `TaskDispatch` (L315). Adapter simply ignores it. Router model tier becomes advisory. |
| Slash commands | `-p "/plan specs/001"` | `-p "/plan specs/001"` | ✅ Same pattern |
| Output format | `--output-format json` | ❌ Not exposed | ⚠️ gwrk doesn't use this — N/A |
| Governance file | `GEMINI.md` | `AGENTS.md` | 🔶 `syncGovernance` targets `AGENTS.md`. Both files exist in gwrk already. |
| Session resume | `--resume latest` | `--continue` / `--conversation ID` | 🔶 gwrk doesn't use resume — N/A |
| Exit codes | 53=turn_limit, 42=usage | Unknown — must test | 🔴 Test required |
| Print timeout | N/A | `--print-timeout 5m0s` (default) | ✅ Useful — extend for long ship runs |
| Workspace dirs | `--include-directories` | `--add-dir` | 🔶 Flag rename |

### Key Research Findings

1. **`agy` is a Go binary** (Mach-O arm64). Not a Node wrapper like gemini CLI.
2. **Config paths**:
   - Settings: `~/.gemini/antigravity-cli/settings.json` (color scheme, permissions, trusted workspaces)
   - Shared config: `~/.gemini/config/config.json` (userSettings, browserJsExecutionPolicy, `useAiCredits`)
   - MCP: `~/.gemini/config/mcp_config.json`
   - Plugins: `~/.gemini/config/plugins/`
   - Projects cache: `~/.gemini/antigravity-cli/cache/projects.json`
3. **Governance**: `agy` reads `AGENTS.md` (already exists in gwrk with `<!-- gwrk:begin -->` markers).
4. **Model selection**: Server-side. No CLI flag needed. This simplifies the adapter — drop the `--model` arg entirely.
5. **G1 Credits**: `useAiCredits: true` in shared config enables fallback to paid credits when quota runs out.
6. **Agent discovery**: Binary references `{workspace}/.agents/agents/{agent_name}/agent.json` — potential for richer agent config in future.
7. **Known env vars**: `AGY_CLI_DISABLE_LATEX`, `AGY_CLI_HIDE_ACCOUNT_INFO`

### Files to Change

| File | Change |
|---|---|
| `src/plugins/builtins/agents/agy/adapter.ts` | **[NEW]** `AgyAdapter` implementing `AgentBackend`. ~80 lines — simpler than gemini adapter (no model flag, no sandbox false). |
| `src/plugins/builtins/agents/index.ts` | Register `agy`. Keep `gemini` for backward compat. |
| `src/engine/router.ts` L97 | Change fallback: `["agy", "gemini", "claude"]` → then `["agy", "claude"]` after June 16. |
| `src/utils/agent.ts` L425 | Default backend: `"gemini"` → `"agy"`. |
| `GeminiAdapter.syncGovernance` | Keep writing `GEMINI.md` — gemini CLI reads it. |
| `AgyAdapter.syncGovernance` | Write `AGENTS.md` — agy reads it. Same `<!-- gwrk:begin -->` markers. |
| `src/server/quota-prober.ts` | Probe `agy` availability. Rate limit pattern may differ (429s vs G1 credit fallback). |

### Remaining Open Questions

> [!IMPORTANT]
> 1. **Exit codes**: What does `agy` return on turn limit? Usage error? Need a test dispatch that exercises these paths.
> 2. **Rate limits**: Does `agy` share gemini's 429 pattern, or does G1 credit fallback eliminate 429s entirely?
> 3. **Sandbox default**: Confirmed omitting `--sandbox` = no sandbox. But does `--dangerously-skip-permissions` also disable sandbox, or are they orthogonal?

### Feature Assignment

Standalone **F021-agent-backend-migration** (not F001 — this is cross-cutting, not CLI-core):
- Phase 1: Write adapter, register, test locally (1-2 days — simpler than gemini adapter)
- Phase 2: Cutover — change defaults, update fallback chain (June 16, 2-day buffer)

---

## Analysis: P2/P3 — Backlog

- Ship loop hardening (FM-4/5/6)
- LaunchAgent e2e
- Obsidian integration (needs spec — F020)
- Server-initiated harvest (needs F011 spec amendment)
- State contracts (F001 P9)

---

## Open Questions

> [!IMPORTANT]
> 1. **Phase 14 scope**: Should project scoping ship before or after prompt decontamination (Phase 13)? Recommend after — init wizard (P10) must register projects first, but prompt decontamination doesn't depend on DB scoping.
> 2. **ROADMAP.md**: Should the audit rewrite this or is it a separate PR?



# Daily Driver Gap Audit — 2026-06-01

> **Test**: `gwrk init` on fresh project `~/Code/EnergyWork`. Result: silent success, no wizard, no Slack, no profile detection, dead `.specify/` directory created. **FAIL.**
>
> **Conclusion**: gwrk cannot be used as a daily driver on non-gwrk projects. The init wizard, prompt decontamination, and stale code removal must ship before the "daily driver" label is honest.

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

## Execution Order for Real Daily Driver

| Priority | What | Feature | Ship Command | Blocks Daily Driver? |
|---|---|---|---|---|
| **P0** | Remove dead `.specify/` code + `agy` adapter | F001 cleanup | Manual commit | YES (init creates garbage) |
| **P0** | Fix `plan_features` DB — delete foreign/phantom entries, consolidate duplicates, update statuses | F018 | SQL + `gwrk plan seed --force` | **YES** (tool can't self-report) |
| **P0** | Reconcile coverage matrices in all spec/plan files | F001-F014 | Manual plan edits | **YES** (specs lie about what's done) |
| **P0** | Init wizard + setup absorption + profile detection | F001 Phase 10 | `gwrk ship 001 10` | **YES** |
| **P0** | Prompt decontamination (84 refs in 13 PROMPT.md) | F001 Phase 13 | `gwrk ship 001 13` | **YES** |
| **P1** | Define output parity (quiet mode) | F001 Phase 12 | `gwrk ship 001 12` | No — quality |
| **P1** | ROADMAP.md rewrite | Docs | Manual | No — documentation |
| **P2** | Ship loop hardening (FM-4/5/6) | F004 | Manual | No — quality-of-life |
| **P2** | LaunchAgent e2e verification | F002 | `gwrk server install` | No — server optional |
| **P3** | Obsidian integration spec | F020 (new) | `gwrk define spec 020` | No — backlog |
| **P3** | Server-initiated harvest | F011 P6 (new) | Spec amendment first | No — architectural |
| **P3** | State contracts | F001 Phase 9 | `gwrk ship 001 9` | No — deferred |

### Critical Path

```
P0-a: Remove .specify + agy dead code (manual, 10 min)
  ↓
P0-b: gwrk define tests 001 --phase 10
  ↓
P0-c: gwrk define tasks 001 --phase 10
  ↓
P0-d: gwrk ship 001 10  ← INIT WIZARD
  ↓
P0-e: gwrk define tests 001 --phase 13
  ↓
P0-f: gwrk define tasks 001 --phase 13
  ↓
P0-g: gwrk ship 001 13  ← PROMPT DECONTAMINATION
  ↓
VERIFY: gwrk init on ~/Code/EnergyWork → interactive wizard works
VERIFY: gwrk define plan on EnergyWork → plan references EnergyWork's stack, not gwrk's
  ↓
DAILY DRIVER ✅
```

---

## Test Baseline

```
Test Files:  147 passed | 3 skipped (150)
Tests:       744 passed | 1 skipped | 8 todo (753)
Duration:    14.24s
Build:       pnpm build — clean (tsc, no errors)
Branch:      develop (up to date with origin)
```

This baseline MUST NOT regress during daily driver work.

# From KI Title: Implementation Plan of 6/1/2026:

The audit and understanding above was supported by this ki:

# Daily Driver Implementation Plan

> **Source of truth**: [docs/daily-driver-audit.md](file:///Users/gonzo/Code/gwrk/docs/daily-driver-audit.md) (saved to repo)
> **Date**: 2026-06-01
> **Status**: Awaiting approval

---

## Summary

Full gap audit saved to repo. This plan is the execution sequence.

**`gwrk plan status` currently lies.** The build plan DB has duplicate entries, foreign project leaks (skills-connection features in gwrk DB), phantom features with no code, and wrong statuses for every shipped feature. Every spec/plan coverage matrix is stale. The tool can't tell you where it stands — which means it can't be shared.

## P0 — Blocks Daily Driver (5 items)

### 1. Dead Code Cleanup (manual, ~10 min)
- Remove `.specify/templates` from `init.ts:105`
- Remove `.specify` refs from `scaffold-feature.ts`
- Delete `src/plugins/builtins/agents/agy/adapter.ts`

### 2. Build Plan DB Reconciliation
`gwrk plan status` source: `~/.gwrk/gwrk.db` → `plan_features` / `plan_phases`

**Delete** (12 entries):
- Foreign: `047-ontology-integration`, `049-companion-guidance`
- Phantom: `F009`, `F010`, `F014-R`, `F015`, `F016`, `F017`, `F999-missing`
- Consolidate legacy F-IDs into spec-based IDs (or vice versa — user decides)

**Update statuses** (9 entries wrong):
- `014-plugin-system` → SHIPPED (all phases, PR #64)
- `011-harvest` → SHIPPED (P3-4, PR #65) 
- `002-build-server` → SHIPPED (P1, PR #66)
- `008-agent-router` → SHIPPED (P1-4, PR #35)
- `018-build-plan-orchestrator` → SHIPPED (operational)
- `006-pulse` / `F006` → both should be SHIPPED
- `001-cli-core` → partial (P1-8,11 done; P9,10,12,13 open)

### 3. Coverage Matrix Reconciliation
Every spec/plan coverage matrix is lying:
- **F004**: 26/38 items marked 🔲/⚠️ despite code existing
- **F011**: All "Planned" despite P3/P4 shipped
- **F002**: All "Planned" despite P1 shipped
- **F003**: All "PLANNED" despite fully operational
- **F014**: Verify all ✅

### 4. F001 Phase 10: Init Wizard ([plan.md L265](file:///Users/gonzo/Code/gwrk/specs/001-cli-core/plan.md))
- `profile-detector.ts` NEW — project type auto-detection
- `init.ts` REWRITE — interactive wizard, absorb `setup.ts`
- `config.ts` MODIFY — extend schema with project profile
- `setup.ts` DELETE
- Spec: US-001 (R3), FR-001 (R3), FR-030–032

### 5. F001 Phase 13: Prompt Decontamination ([plan.md L371](file:///Users/gonzo/Code/gwrk/specs/001-cli-core/plan.md))
- `prompt-conditioner.ts` NEW
- 13 PROMPT.md files refactored (84 gwrk-native refs)
- `project-info.ts` NEW
- Spec: US-028, FR-033–035
- Depends on Phase 10

## P1 — Quality

- **F001 Phase 12**: Define output parity (quiet mode)
- **ROADMAP.md**: Rewrite to match reality

## P2/P3 — Backlog

- Ship loop hardening (FM-4/5/6)
- LaunchAgent e2e
- Obsidian integration (needs spec — F020)
- Server-initiated harvest (needs F011 spec amendment)
- State contracts (F001 P9)

## Critical Path

```
1. Dead code cleanup       → manual commit
2. DB reconciliation       → SQL fixes + verify gwrk plan status
3. Coverage matrices       → manual spec/plan edits
4. gwrk ship 001 10        → init wizard
5. gwrk ship 001 13        → prompt decontamination
VERIFY: gwrk init + gwrk define plan on ~/Code/EnergyWork
VERIFY: gwrk plan status shows accurate reality
```

## Open Questions

> [!IMPORTANT]
> 1. **Feature ID scheme**: Consolidate to spec-based (`001-cli-core`) or legacy (`F001`)? Recommend spec-based since that's what `gwrk ship` uses.
> 2. **Coverage matrix strategy**: Manual reconciliation or `gwrk define plan --force` to regenerate? Regenerating risks losing institutional knowledge in the plans.
> 3. **agy adapter**: Delete entirely? No spec references it.
> 4. **ROADMAP.md**: Should I propose a rewrite or do you want to drive that?

## KI Title Implementation Plan 6/1/26

This audit was generated during a previous session and was supported by the following KI.

# Daily Driver Implementation Plan

> **Source of truth**: [docs/daily-driver-audit.md](file:///Users/gonzo/Code/gwrk/docs/daily-driver-audit.md) (saved to repo)
> **Date**: 2026-06-01
> **Status**: Awaiting approval

---

## Summary

Full gap audit saved to repo. This plan is the execution sequence.

**`gwrk plan status` currently lies.** The build plan DB has duplicate entries, foreign project leaks (skills-connection features in gwrk DB), phantom features with no code, and wrong statuses for every shipped feature. Every spec/plan coverage matrix is stale. The tool can't tell you where it stands — which means it can't be shared.

## P0 — Blocks Daily Driver (5 items)

### 1. Dead Code Cleanup (manual, ~10 min)
- Remove `.specify/templates` from `init.ts:105`
- Remove `.specify` refs from `scaffold-feature.ts`
- Delete `src/plugins/builtins/agents/agy/adapter.ts`

### 2. Build Plan DB Reconciliation
`gwrk plan status` source: `~/.gwrk/gwrk.db` → `plan_features` / `plan_phases`

**Delete** (12 entries):
- Foreign: `047-ontology-integration`, `049-companion-guidance`
- Phantom: `F009`, `F010`, `F014-R`, `F015`, `F016`, `F017`, `F999-missing`
- Consolidate legacy F-IDs into spec-based IDs (or vice versa — user decides)

**Update statuses** (9 entries wrong):
- `014-plugin-system` → SHIPPED (all phases, PR #64)
- `011-harvest` → SHIPPED (P3-4, PR #65) 
- `002-build-server` → SHIPPED (P1, PR #66)
- `008-agent-router` → SHIPPED (P1-4, PR #35)
- `018-build-plan-orchestrator` → SHIPPED (operational)
- `006-pulse` / `F006` → both should be SHIPPED
- `001-cli-core` → partial (P1-8,11 done; P9,10,12,13 open)

### 3. Coverage Matrix Reconciliation
Every spec/plan coverage matrix is lying:
- **F004**: 26/38 items marked 🔲/⚠️ despite code existing
- **F011**: All "Planned" despite P3/P4 shipped
- **F002**: All "Planned" despite P1 shipped
- **F003**: All "PLANNED" despite fully operational
- **F014**: Verify all ✅

### 4. F001 Phase 10: Init Wizard ([plan.md L265](file:///Users/gonzo/Code/gwrk/specs/001-cli-core/plan.md))
- `profile-detector.ts` NEW — project type auto-detection
- `init.ts` REWRITE — interactive wizard, absorb `setup.ts`
- `config.ts` MODIFY — extend schema with project profile
- `setup.ts` DELETE
- Spec: US-001 (R3), FR-001 (R3), FR-030–032

### 5. F001 Phase 13: Prompt Decontamination ([plan.md L371](file:///Users/gonzo/Code/gwrk/specs/001-cli-core/plan.md))
- `prompt-conditioner.ts` NEW
- 13 PROMPT.md files refactored (84 gwrk-native refs)
- `project-info.ts` NEW
- Spec: US-028, FR-033–035
- Depends on Phase 10

## P1 — Quality

- **F001 Phase 12**: Define output parity (quiet mode)
- **ROADMAP.md**: Rewrite to match reality

## P2/P3 — Backlog

- Ship loop hardening (FM-4/5/6)
- LaunchAgent e2e
- Obsidian integration (needs spec — F020)
- Server-initiated harvest (needs F011 spec amendment)
- State contracts (F001 P9)

## Critical Path

```
1. Dead code cleanup       → manual commit
2. DB reconciliation       → SQL fixes + verify gwrk plan status
3. Coverage matrices       → manual spec/plan edits
4. gwrk ship 001 10        → init wizard
5. gwrk ship 001 13        → prompt decontamination
VERIFY: gwrk init + gwrk define plan on ~/Code/EnergyWork
VERIFY: gwrk plan status shows accurate reality
```

## Open Questions

> [!IMPORTANT]
> 1. **Feature ID scheme**: Consolidate to spec-based (`001-cli-core`) or legacy (`F001`)? Recommend spec-based since that's what `gwrk ship` uses.
> 2. **Coverage matrix strategy**: Manual reconciliation or `gwrk define plan --force` to regenerate? Regenerating risks losing institutional knowledge in the plans.
> 3. **agy adapter**: Delete entirely? No spec references it.
> 4. **ROADMAP.md**: Should I propose a rewrite or do you want to drive that?

---
type: implementation_plan
feature: 001-cli-core
last_modified: "2026-05-30T00:22:00Z"
revision: 3
---

# Implementation Plan: 001 CLI Core

**Branch**: `develop` | **Revised**: 2026-05-30 | **Spec**: [spec.md](./spec.md)

## Summary

The gwrk CLI — the Principal Engineer's Operating System. Delivers the Foxtrot Charlie pillar hierarchy (`define`, `ship`, `measure`), comprehensive interactive onboarding (`init`), project-aware prompt conditioning, agent dispatch, SQLite execution ledger, task engine with Hard Gate enforcement, provenance tracking, and standardized output formatting.

> **Status**: Phases 1–8, 11 are **implemented and tested**. Phase 9 (state contracts), Phase 10 (unified init — R3 rewrite), Phase 12 (define output parity), and Phase 13 (project awareness — R3 new) are open.

---

## R3 Revision History (2026-05-30)

**Trigger**: `gwrk define plan/spec` in external projects (`skills-connection`) produced gwrk-native artifacts — Commander.js references, `src/commands/` paths, ADR-004 protocol in projects that have none of these. Root cause: hardcoded gwrk assumptions in all 15 PROMPT.md files, zero project awareness in `init`, fragmented onboarding (`init` + `setup` as separate commands).

**Spec changes** (spec.md R3):
- US-001 rewritten: comprehensive interactive wizard (12 acceptance criteria)
- US-021 absorbed into US-001: `gwrk setup` removed, workstation steps folded into `init`
- US-027 added: project profile auto-detection (7 Given/When/Then criteria)
- US-028 added: project-aware prompt conditioning (5 criteria)
- US-029 added: `gwrk project info` diagnostic
- FR-001 rewritten, FR-022 absorbed, FR-030–035 added
- DM-003 extended: `project.type/stack/layout/architecture/conventions` schema
- TC-009–011, TR-027–034, SC-011–014, VR-006–010 added
- Error states updated for init absorption

**Plan changes** (this file):
- Phase 10 rewritten: unified init replaces init + setup split
- Phase 13 added: prompt conditioning, PROMPT.md refactoring, `gwrk project info`
- Phase Execution Order table added with specific `gwrk ship` commands
- Coverage matrix updated with R3 items

**Reference**: [prompt-contamination-audit.md](./refs/prompt-contamination-audit.md)

### Define Pipeline (per-phase)

Each open phase must run the define pipeline independently:

```bash
# Phase 10: Unified Init
gwrk define tests 001 --phase 10
gwrk define tasks 001 --phase 10
gwrk ship 001 10

# Phase 12: Define Output Parity
gwrk define tests 001 --phase 12
gwrk define tasks 001 --phase 12
gwrk ship 001 12

# Phase 13: Project Awareness
gwrk define tests 001 --phase 13
gwrk define tasks 001 --phase 13
gwrk ship 001 13
```



## Phases and File Structure

### Phase 1: Project Bootstrap & Config ✅

Bootstrap the TypeScript project infrastructure. Deliver `gwrk init` and Zod-validated configuration.

**Files (6):**
- `package.json` ✅ — Project manifest (commander, zod, vitest, biome, tsx)
- `tsconfig.json` ✅ — ES2022, ESM, strict, NodeNext
- `src/cli.ts` ✅ — Custom help with flamingo branding, pillar-based command routing
- `src/commands/init.ts` ✅ — Scaffold directories, detect CLIs, provision context
- `src/utils/config.ts` ✅ — Zod schema for `.gwrkrc.json`, fail-fast loader
- `src/utils/format.ts` ✅ — Unified output: banners, success/fail boxes, color exports

**Requirements Addressed:** FR-001, FR-008, US-001, US-008, TC-003

**Tests:**
- `src/commands/init.test.ts` ✅ — TR-001
- `src/utils/config.test.ts` ✅ — TR-008
- `src/cli.test.ts` ✅ — Registration, pillar hierarchy
- `src/cli.e2e.test.ts` ✅ — E2E surface verification

---

### Phase 2: SQLite Execution Ledger ✅

Global SQLite at `~/.gwrk/gwrk.db` for run recording and analytics.

**Files (4):**
- `src/db/index.ts` ✅ — Connection, migration runner
- `src/db/migrations/001-initial.sql` ✅ — Schema: projects, runs, compression, history
- `src/db/runs.ts` ✅ — startRun/finishRun
- `src/commands/db.ts` ✅ — `gwrk db runs`, `gwrk db stats`

**Requirements Addressed:** FR-014, FR-015, US-014, US-015, DM-001, DM-002, DM-003

**Tests:**
- `src/db/db.test.ts` ✅
- `src/commands/runs.test.ts` ✅
- `src/commands/stats.test.ts` ✅

---

### Phase 3: Clarity Pillar — Define ✅

Agent dispatch wrappers under `gwrk define` for spec, plan, tasks, and bare definition loop.

**Files (8):**
- `src/commands/define.ts` ✅ — Parent: bare=definition loop, subcommands: spec, plan, tasks
- `src/commands/specify.ts` ✅ — `gwrk define spec <feature> [--refs]`
- `src/commands/plan.ts` ✅ — `gwrk define plan <feature> [--refs]`
- `src/commands/analyze.ts` ✅ — Internal definition stage (not user-facing)
- `src/commands/tasks-generate.ts` ✅ — `gwrk define tasks` with `--force` and `--reconcile`
- `src/utils/agent.ts` ✅ — Agent dispatch: backend resolution, log streaming, logPath return
- `src/utils/parser.ts` ✅ — Parse plan.md → phases and tasks
- `src/utils/exec.ts` ✅ — Shell command execution wrapper

**Requirements Addressed:** FR-002, FR-003, FR-004, FR-011, US-002, US-003, US-004, US-011, TC-002

**Tests:**
- `src/commands/specify.test.ts` ✅ — TR-002
- `src/commands/plan.test.ts` ✅ — TR-003
- `src/commands/analyze.test.ts` ✅ — TR-009
- `src/commands/define.test.ts` ✅
- `src/commands/tasks-generate.test.ts` ✅ — TR-004
- `src/commands/tasks-reconcile.test.ts` ✅ — 4 reconcile scenarios
- `src/utils/agent.test.ts` ✅
- `src/engine/spec-parser.test.ts` ✅

---

### Phase 4: Throughput Pillar — Ship ✅

`gwrk ship <feature> <phase>` for the autonomous implement→review→PR loop.

**Files (2):**
- `src/commands/ship.ts` ✅ — Ship
- `src/commands/implement.ts` ✅ — Internal isolated delegate (no WUD loop)

**Requirements Addressed:** FR-012, FR-013, US-012, US-013

---

### Phase 5: Task Engine — State, Gates & History ✅

Task tracking engine: state management, gate-enforced transitions, provenance.

**Files (5):**
- `src/commands/tasks.ts` ✅ — Subcommands: list, next, done + drift detection
- `src/utils/state.ts` ✅ — TaskState schema (with `generatedFrom`, `cancelled`), contentHash()
- `src/utils/gate-gen.ts` ✅ — Generate gate scripts
- `src/utils/history.ts` ✅ — JSONL history append

**Requirements Addressed:** FR-005, FR-006, FR-007, US-005, US-006, US-007, TC-001, TC-004, TC-007

**Tests:**
- `src/commands/tasks-done.test.ts` ✅ — TR-006
- `src/commands/tasks-query.test.ts` ✅ — TR-005
- `src/utils/state.test.ts` ✅ — TR-007

---

### Phase 6: Value Pillar — Measure ✅

`gwrk measure pulse`, `gwrk measure effort`, `gwrk measure compression`.

**Files (7):**
- `src/commands/measure.ts` ✅ — Parent: pulse, effort, compression subcommands
- `src/commands/pulse.ts` ✅ — Git activity dashboard
- `src/commands/effort.ts` ✅ — SP-driven estimation
- `src/commands/compression.ts` ✅ — Effort vs actual ratio
- `src/engine/pulse.ts` ✅ — Pulse engine
- `src/engine/effort.ts` ✅ — Effort engine
- `src/engine/compression.ts` ✅ — Compression engine

**Requirements Addressed:** FR-010, FR-016, FR-017, US-010, US-016, US-017

**Tests:**
- `src/commands/pulse.test.ts` ✅
- `src/commands/effort.test.ts` ✅ — TR-010
- `src/commands/compression.test.ts` ✅
- `src/engine/pulse.test.ts` ✅
- `src/engine/pulse-integration.test.ts` ✅ — TR-007/VR-004
- `src/engine/effort.test.ts` ✅
- `src/engine/compression.test.ts` ✅

---

### Phase 7: Init Hardening ✅

`gwrk init` currently scaffolds directories but needs: multi-CLI provisioning (detect gemini/claude/codex), SQLite project registration, Slack channel creation (optional), and GitHub repo visibility (private by default).

**Files (2):**
- `src/commands/init.ts` ✅ (MODIFY: Add CLI detection, SQLite registration, Slack optional)
- `src/commands/new.ts` ✅ (NEW: `gwrk new <name>` — mkdir, git init, gh repo create, then delegates to init)

**Requirements Addressed:** FR-001 (full acceptance), US-001 (acceptance 2-3), TC-005, TC-006

**Tests:**
- Expand `src/commands/init.test.ts` ✅ — CLI detection, idempotency, SQLite registration, GH repo creation
- New `src/commands/new.test.ts` ✅ — Greenfield flow

#### Done When
- `gwrk init` detects available CLIs and provisions GEMINI.md/CLAUDE.md/AGENTS.md ✅
- `gwrk init` registers project in `~/.gwrk/gwrk.db` ✅
- `gwrk new test-project` creates dir, initializes git, runs init ✅
- Running `gwrk init` twice is idempotent ✅

---

### Phase 8: E2E Surface Hardening ✅

Final verification that the CLI surface matches US-018 exactly. Clean up dead command files.

**Files (3):**
- `src/commands/run.ts` ✅ (DELETE: Dead `run` group — commands moved to `define`)
- `src/commands/metrics.ts` ✅ (DELETE: Dead `metrics` group — moved to `measure`)
- `src/cli.e2e.test.ts` ✅ (MODIFY: Update E2E assertions to match US-018 exactly)

**Verification:**
- `gwrk --help` shows exactly: `define`, `ship`, `measure`, `init`, `tasks`, `db` ✅
- `gwrk define --help` shows: `spec`, `plan`, `tasks` ✅
- `gwrk ship --help` shows: `done` ✅
- `gwrk measure --help` shows: `pulse`, `effort`, `compression` ✅
- No other top-level commands exist ✅

**Requirements Addressed:** FR-018, US-018

#### Done When
- All dead files removed ✅
- `pnpm test` — all passing (verified CLI core tests) ✅
- `gwrk --help` output matches spec US-018 acceptance criteria exactly ✅

---

### Phase 9: State Contract — Execution Manifests & Merge Safety

Implement the two-tier state architecture ([ADR-003](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md)): git-native execution manifests for distributed agents, `.gitattributes` merge protection, and `tasks verify` post-merge guard.

**Files (4):**
- `src/utils/manifest.ts` (NEW) — Write `ExecutionManifest` JSON to `specs/<feature>/.gwrk/runs/`
- `src/commands/tasks.ts` (MODIFY) — Add `verify <feature>` subcommand
- `src/commands/ship.ts` (MODIFY) — Call manifest writer after run completion
- `src/commands/define.ts` (MODIFY) — Call manifest writer after run completion

**Requirements Addressed:** FR-019, FR-020, FR-021, US-019, US-020, SC-007, SC-008

**Tests:**
- `src/utils/manifest.test.ts` (NEW) — Manifest schema, file naming, idempotency
- `src/commands/tasks-verify.test.ts` (NEW) — Schema validation, orphan detection, regression check

#### Done When
- Every `ship`/`define` run writes a manifest to `.gwrk/runs/`
- `gwrk tasks verify <feature>` validates schema + manifest coverage
- `history.jsonl` writes are replaced with manifest + `gwrk.db history`
- All tests pass

---

### Phase 10: Unified Init — Project Onboarding ⭐ **REWRITE (R3)**

Merge current `init.ts` + `setup.ts` into a single comprehensive interactive wizard. `gwrk init` becomes the ONE command that provisions everything: project profile (auto-detected), workstation config (TCC, SSH, gh), agent detection, Slack channel, and directory scaffolding.

> **Cross-Feature Note:** `profile-detector.ts` already exists (shipped R007/014). Config schema extension for `workspaces` is owned by 020-polyglot-monorepo. This phase focuses on the init wizard UX and setup absorption — not schema design.

**Files (3):**
- `src/commands/init.ts` (MODIFY: Add interactive profile wizard, absorb setup.ts workstation steps, add `--non-interactive` flag)
- `src/commands/setup.ts` (DELETE: Absorbed into init)
- `src/commands/setup-slack.ts` (MODIFY: Refactor to be callable from init flow, not standalone)

**Already Shipped (R007/014):**
- `src/engine/profile-detector.ts` — ✅ Root-level detection for pnpm-monorepo, rust, python, go, nodejs, polyglot-monorepo
- `src/utils/config.ts` — ✅ `stack.languages` array, basic profile fields

**Deferred to 020:**
- `src/utils/config.ts` `workspaces` schema — FR-032 (workspace-level profiles owned by 020-P1)

**Requirements Addressed:** FR-001 (R3 rewrite), FR-022 (absorbed), US-001 (R3), US-021 (absorbed), TC-011

**Tests:**
- `src/commands/init.test.ts` (MODIFY: Add interactive wizard tests, workstation provisioning, `--non-interactive`, profile auto-detection) — TR-001, TR-021
- `src/commands/setup.test.ts` (DELETE or refactor into init.test.ts)

**gwrk command to implement:**
```
gwrk ship 001 10
```

#### Done When
- `gwrk init` runs interactive profile wizard: detects project type, confirms with user, walks through stack/layout/architecture/conventions
- `gwrk init` runs workstation provisioning (TCC, SSH, gh) — former `gwrk setup` behavior
- `gwrk init` detects agent CLIs and configures agents block
- `gwrk init` provisions Slack channel if tokens available
- `gwrk init --non-interactive` uses pure auto-detection, writes `.gwrkrc.json` silently
- `gwrk setup` is removed from CLI surface
- `pnpm build` compiles clean, `pnpm test` all passing
- Schema backward compat: existing `.gwrkrc.json` files parse without error

---

### Phase 11: CLI UX Polish ✅

Consolidate CLI usability fixes: help text examples, resolveFeature aliasing, define tests contract fix, CLI grammar governance doc.

**Files (12):**
- `src/commands/ship.ts` (MODIFY — Add Examples to help text)
- `src/commands/define.ts` (MODIFY — Add Examples to help text)
- `src/commands/tasks.ts` (MODIFY — Add Examples to help text)
- `src/commands/measure.ts` (MODIFY — Add Examples to help text)
- `src/commands/db.ts` (MODIFY — Add Examples to help text)
- `src/commands/test.ts` (MODIFY — Add Examples to help text)
- `src/commands/define-plan.ts` (MODIFY — Add resolveFeature for prefix aliasing)
- `src/commands/tests-generate.ts` (MODIFY — Add resolveFeature + relax output contract)
- `src/commands/runs.ts` (MODIFY — Add resolveFeature for prefix aliasing)
- `src/commands/harvest.ts` (MODIFY — Add resolveFeature for prefix aliasing)
- `src/commands/gate.ts` (✅ Already done — Examples added 2026-05-07)
- `docs/governance/cli-grammar.md` (NEW — Canonical CLI grammar standard)

**Requirements Addressed:** FR-023, FR-024, FR-025, FR-026, FR-027, US-022, US-023, US-024, US-025

**Tests:**
- `src/cli.ux.test.ts` — TR-022: Assert Examples in help output
- `src/cli.consistency.test.ts` — TR-023: Feature-arg position + resolveFeature check
- `tests/governance.test.ts` — TR-025: Grammar doc existence and content check
- `src/commands/tests-generate-contract.test.ts` — TR-027: Accept test file output

#### Done When
- `gwrk <any-command-with-args> --help` shows an `Examples:` section
- `gwrk define plan 001` resolves to `001-cli-core` (prefix aliasing works)
- `gwrk define tests 001` resolves to `001-cli-core` (prefix aliasing works)
- `gwrk db runs 001` resolves to `001-cli-core` (prefix aliasing works)
- `gwrk define tests` no longer fails when agent produces test files instead of gap-matrix.md
- `docs/governance/cli-grammar.md` exists with canonical grammar, rules, and command inventory
- `project gates` remains removed (✅ verified)
- `pnpm build` compiles clean, `pnpm test` all passing

---

### Phase 12: Define Pillar Output Parity

Bring all `define` subcommands (`define`, `define spec`, `define plan`, `define tasks`, `define tests`) into alignment with `ship`'s quiet/logged output pattern. Currently, `define tests` (and other workflow-dispatched commands) dump raw agent narration to stdout and fail with a JSON schema error even when the agent succeeds.

**Root Cause:**
1. `tests-generate.ts` calls `WorkflowRuntime.executeWorkflow()` without `quiet: true`, so agent narration streams to the terminal instead of logging to `.runs/`.
2. `WorkflowRuntime.extractJsonFromOutput()` expects the agent to return a JSON intent payload, but modern agents (Gemini CLI) do work natively (commit directly) and return prose. The parser throws "Expected JSON object in agent output" even though the agent succeeded.
3. `define.ts`, `specify.ts`, and `define-plan.ts` use `dispatchAgent()` directly but don't pass `quiet: true` either.

**Files (5):**
- `src/commands/tests-generate.ts` (MODIFY: Pass `quiet: true` to `runtime.executeWorkflow()`. Detect agent-native success by checking for committed test files even when JSON parsing fails.)
- `src/commands/specify.ts` (MODIFY: Pass `quiet: true` to `runtime.executeWorkflow()`.)
- `src/commands/define-plan.ts` (MODIFY: Pass `quiet: true` to `runtime.executeWorkflow()`.)
- `src/commands/tasks-generate.ts` (MODIFY: Pass `quiet: true` to `runtime.executeWorkflow()` for gate authoring dispatch.)
- `src/plugins/workflow-runtime.ts` (MODIFY: Make `extractJsonFromOutput()` failure non-fatal when the agent committed artifacts. Add `tolerant` mode that returns a synthetic success result when the agent did native work.)

**Requirements Addressed:** TC-008 (updated), US-026, FR-028, FR-029

**Tests:**
- `src/plugins/workflow-runtime.test.ts` (MODIFY: Add test for tolerant JSON extraction — prose-only output with committed artifacts returns success)
- `src/commands/tests-generate-contract.test.ts` (MODIFY: Add test for quiet mode, add test for prose-only output + committed test files = success)

#### Done When
- `gwrk define tests 003 --force` runs with quiet spinner output (no agent narration in terminal)
- Agent that commits tests natively but returns prose → exit 0 (not exit 1)
- Full agent output in `.runs/` log file for debugging
- `gwrk define spec 001` runs with quiet spinner output
- `gwrk define plan 001` runs with quiet spinner output
- `pnpm build` compiles clean, `pnpm test` all passing

---

### Phase 13: Project Awareness — Prompt Conditioning & PROMPT.md Refactoring ⭐ **NEW (R3)**

Inject the resolved project profile into every workflow prompt. Refactor all 15 PROMPT.md files to use conditional profile sections. Add `gwrk project info` diagnostic command. This phase depends on Phase 10 (profile must exist in config schema before it can be injected into prompts).

**Ref:** [prompt-contamination-audit.md](./refs/prompt-contamination-audit.md)

**Files (19):**
- `src/engine/prompt-conditioner.ts` (NEW: Generate `<project_profile>` XML from resolved profile, serialize for prompt injection)
- `src/plugins/workflow-runtime.ts` (MODIFY: Call prompt-conditioner before dispatching, inject XML block into prompt)
- `src/server/ship-orchestrator.ts` (MODIFY: Inject profile into review dispatch)
- `src/commands/project-info.ts` (NEW: `gwrk project info` with `--format json`)
- `src/commands/project.ts` (NEW: `gwrk project` parent command)
- `src/cli.ts` (MODIFY: Register `project` command group)
- **PROMPT.md refactoring (13 files):**
  - `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` (MODIFY: 🔴 Critical — gate architecture_reference, source layout, ADR-004, agent-native)
  - `src/plugins/builtins/workflows/gwrk-review-uat/PROMPT.md` (MODIFY: 🔴 Critical — gate project description, CLI taxonomy, build command)
  - `src/plugins/builtins/workflows/gwrk-author-gates/PROMPT.md` (MODIFY: 🔴 Critical — gate projectType, assertion patterns per test framework)
  - `src/plugins/builtins/workflows/gwrk-review-code/PROMPT.md` (MODIFY: 🟡 Medium — gate gwrk-specific review patterns)
  - `src/plugins/builtins/workflows/gwrk-implement/PROMPT.md` (MODIFY: 🟡 Medium — gate pnpm build assumption)
  - `src/plugins/builtins/workflows/gwrk-define-tests/PROMPT.md` (MODIFY: 🟡 Medium — gate test framework assumptions)
  - `src/plugins/builtins/workflows/gwrk-plan-to-tasks/PROMPT.md` (MODIFY: 🟡 Medium — gate task structure assumptions)
  - `src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md` (MODIFY: 🟢 Low)
  - `src/plugins/builtins/workflows/gwrk-cascade-sync/PROMPT.md` (MODIFY: 🟢 Low)
  - `src/plugins/builtins/workflows/gwrk-build-plan/PROMPT.md` (MODIFY: 🟢 Low)
  - `src/plugins/builtins/workflows/gwrk-checklist/PROMPT.md` (MODIFY: 🟢 Low)
  - `src/plugins/builtins/workflows/gwrk-effort/PROMPT.md` (MODIFY: 🟢 Low)
  - `src/plugins/builtins/workflows/gwrk-research/PROMPT.md` (MODIFY: 🟢 Low)
  - (`gwrk-specify/PROMPT.md` already has conditional guards — verify only)

**Requirements Addressed:** FR-033, FR-034, FR-035, US-028, US-029, TC-009, TC-010, SC-011, SC-012, SC-013, SC-014

**Tests:**
- `src/engine/prompt-conditioner.test.ts` (NEW: XML generation, gwrk-native preservation, generic profile omission) — TR-031
- `src/commands/project-info.test.ts` (NEW: JSON output, profile rendering) — TR-032
- `src/engine/profile-detector.test.ts` (MODIFY: Add regression snapshot for gwrk-native) — TR-034

**gwrk command to implement:**
```
gwrk ship 001 13
```

#### Done When
- `<project_profile>` XML block injected into every workflow prompt at runtime
- All 15 PROMPT.md files refactored with conditional `gwrk-native` guards
- `gwrk project info --format json` returns resolved profile
- `grep -r "src/commands\|src/engine\|ADR-004\|Commander.js\|better-sqlite3" src/plugins/builtins/workflows/*/PROMPT.md` returns ZERO ungated matches
- gwrk-native prompt assembly is byte-identical to pre-R3 (regression snapshot passes)
- `pnpm build` compiles clean, `pnpm test` all passing

---

### Phase 14: Project-Scoped DB Isolation ⭐ **NEW (2026-06-01)**

Implement structural project scoping across the global SQLite database to prevent cross-project data pollution. Every plan feature, run, and statistic must be isolated by `projectId`.

**Files (14):**
- `src/utils/project-id.ts` (✅ Already done) — Canonical `resolveProjectId` utility
- `src/db/migrations/009-project-scoping.sql` (✅ Already done) — Add `project_id` to 8 tables
- `src/db/index.ts` (MODIFY: Add `project_id` to `safeAddColumn` for the 8 target tables)
- `src/db/plan.ts` (MODIFY: Scope all query functions by `projectId`)
- `src/db/runs.ts` (MODIFY: Scope `listRuns` and `getStats` by `projectId`)
- `src/db/gates.ts` (MODIFY: Scope `getGateResults` and `recordGateResult`)
- `src/db/compression.ts` (MODIFY: Scope `listCompressionRecords`)
- `src/db/issues.ts` (MODIFY: Scope `listIssues` and `upsertIssue`)
- `src/db/plugins.ts` (MODIFY: Scope `getRoutingHistory`)
- `src/engine/plan-store.ts` (MODIFY: Constructor accepts `projectId`, pass to DB layer)
- `src/engine/drift-detector.ts` (MODIFY: Scope drift checks by `projectId`)
- `src/commands/plan.ts` (MODIFY: Derive `projectId` and pass to `PlanStore`)
- `src/commands/stats.ts` (MODIFY: Derive `projectId` and pass to DB layer)
- `src/commands/runs.ts` (MODIFY: Derive `projectId` and pass to DB layer)

**Requirements Addressed**: US-030, FR-036, FR-037, FR-038, FR-039, FR-040

**Tests:**
- `src/db/scoping.test.ts` (NEW: Verify column existence and query filtering)
- `src/engine/plan-store-scoping.test.ts` (NEW: Verify PlanStore isolation)
- `src/commands/project-scoped.test.ts` (NEW: E2E verify cross-project isolation)

#### Done When
- `gwrk plan status` on Project A only shows Project A features.
- `gwrk db runs` only shows runs for the current project.
- No cross-project pollution in stats, gates, or compression.
- `pnpm build` compiles clean, `pnpm test` all passing.

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1, 7, 10 | ⭐ R3 rewrite in Phase 10 |
| US-002 | 3 | ✅ Done |
| US-003 | 3 | ✅ Done |
| US-004 | 3 | ✅ Done |
| US-005 | 5 | ✅ Done |
| US-006 | 5 | ✅ Done |
| US-007 | 5 | ✅ Done |
| US-008 | 1 | ✅ Done |
| US-010 | 6 | ✅ Done |
| US-011 | 3 | ✅ Done |
| US-012 | 4 | ✅ Done |
| US-013 | 4 | ✅ Done |
| US-014 | 2 | ✅ Done |
| US-015 | 2 | ✅ Done |
| US-016 | 6 | ✅ Done |
| US-017 | 6 | ✅ Done |
| US-018 | 8 | ✅ Done |
| US-019 | 9 | ☐ Open |
| US-020 | 9 | ☐ Open |
| US-021 | 10 (absorbed into US-001) | ☐ Open |
| US-022 | 11 | ✅ Done |
| US-023 | 11 | ✅ Done |
| US-024 | 11 | ✅ Done |
| US-025 | 11 | ✅ Done |
| US-026 | 12 | ☐ Open |
| US-027 | 10 | ☐ Open (R3) |
| US-028 | 13 | ☐ Open (R3) |
| US-029 | 13 | ☐ Open (R3) |
| US-030 | 14 | ☐ Open |
| FR-001 | 1, 7, 10 | ⭐ R3 rewrite in Phase 10 |
| FR-002 | 3 | ✅ Done |
| FR-003 | 3 | ✅ Done |
| FR-004 | 3 | ✅ Done |
| FR-005 | 5 | ✅ Done |
| FR-006 | 5 | ✅ Done |
| FR-007 | 5 | ✅ Done |
| FR-008 | 1 | ✅ Done |
| FR-010 | 6 | ✅ Done |
| FR-011 | 3 | ✅ Done |
| FR-012 | 4 | ✅ Done |
| FR-013 | 4 | ✅ Done |
| FR-014 | 2 | ✅ Done |
| FR-015 | 2 | ✅ Done |
| FR-016 | 6 | ✅ Done |
| FR-017 | 6 | ✅ Done |
| FR-018 | 8 | ✅ Done |
| FR-019 | 9 | ☐ Open |
| FR-020 | 9 | ☐ Open |
| FR-021 | 9 | ☐ Open |
| FR-022 | 10 (absorbed into FR-001) | ☐ Open |
| FR-023 | 11 | ✅ Done |
| FR-024 | 11 | ✅ Done |
| FR-025 | 11 | ✅ Done |
| FR-026 | 11 | ✅ Done |
| FR-027 | 11 | ✅ Done |
| FR-028 | 12 | ☐ Open |
| FR-029 | 12 | ☐ Open |
| FR-030 | 10 | ☐ Open (R3) |
| FR-031 | 10 | ☐ Open (R3) |
| FR-032 | 10 | ☐ Open (R3) |
| FR-033 | 13 | ☐ Open (R3) |
| FR-034 | 13 | ☐ Open (R3) |
| FR-035 | 13 | ☐ Open (R3) |
| FR-036 | 14 | ☐ Open |
| FR-037 | 14 | ☐ Open |
| FR-038 | 14 | ☐ Open |
| FR-039 | 14 | ☐ Open |
| FR-040 | 14 | ☐ Open |

## Phase Execution Order

> **Daily driver = viable.** Viable means gwrk proves its value, not just runs commands. Compression (007) is the viability proof.

| Priority | Feature/Phase | Scope | gwrk command | Notes |
|----------|--------------|-------|-------------|-------|
| **1** | **020-P1** | Config schema + workspace detection | `gwrk ship 020 1` | **Absorbs FR-032.** Unblocks EnergyWork. |
| **2** | **020-P2** | Init workspace support + `--workspace` flag | `gwrk ship 020 2` | Completes polyglot monorepo support. |
| **3** | Phase 13 | Prompt conditioning + PROMPT.md refactoring | `gwrk ship 001 13` | Stops gwrk-native leakage in non-gwrk projects. |
| **4** | **007-P1** | Effort engine | `gwrk ship 007 1` | **Viability proof — critical path.** |
| **5** | **007-P2** | Compression engine | `gwrk ship 007 2` | Core compression calculation. |
| **6** | **007-P3** | CLI commands + integration | `gwrk ship 007 3` | `gwrk measure compression` end-to-end. |
| 7 | Phase 10 | Unified init wizard + setup absorption | `gwrk ship 001 10` | Polish — functional without it. |
| 8 | Phase 12 | Define pillar output parity | `gwrk ship 001 12` | Polish — quiet output. |
| 9 | Phase 14 | Project-scoped DB isolation | `gwrk ship 001 14` | Partially shipped. |
| 10 | Phase 9 | State contracts + execution manifests | `gwrk ship 001 9` | Deferred. |

> Phase 13 depends on 020-P1 (profile schema must exist before prompt injection works for non-gwrk projects). 007 phases are sequential (P1 → P2 → P3).

## Deferred Items

- US-009 / FR-009: Cross-artifact analysis — now internal definition stage, no standalone command.
- `history.jsonl` removal: Deferred until `gwrk harvest` is operational (Phase 2 Build Server).
- FR-030, FR-031 (auto-detection): Delivered by R007. Tests in `profile-detector.test.ts`.
- FR-032 (config schema extension): Absorbed by 020-polyglot-monorepo P1.


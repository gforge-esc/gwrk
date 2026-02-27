# CodeRed Agent Workflow System — Comprehensive Manifest

**Date**: 2026-02-26 | **Purpose**: Exhaustive inventory of every file comprising the agent workflow system, organized for future extraction into a standalone CLI.

**Grand Total**: 78 files · ~7,450 lines of workflow infrastructure

---

## 1. Entry Point: Makefile

The Makefile is the user-facing CLI. All agent invocations go through `make agent-*` targets.

| Target | Purpose | Delegates To |
|---|---|---|
| `agent-wud` | Work-Until-Done: autonomous implement→review→PR→CI lifecycle | [scripts/dev/work-until-done.sh](file:///Users/gonzo/Code/code-red/scripts/dev/work-until-done.sh) |
| `agent-dus` | Define-Until-Solid: plan-to-beads→analyze→tests→import | [scripts/dev/define-until-solid.sh](file:///Users/gonzo/Code/code-red/scripts/dev/define-until-solid.sh) |
| `agent-specify` | Specification from natural language | `scripts/dev/agent-run.sh specify` |
| `agent-plan` | Technical implementation plan | `scripts/dev/agent-run.sh plan` |
| `agent-plan-to-beads` | Generate beads import scripts | `scripts/dev/agent-run.sh plan-to-beads` |
| `agent-analyze` | Read-only cross-artifact consistency analysis | `scripts/dev/agent-run.sh analyze` |
| `agent-review-code` | Technical code review | `scripts/dev/agent-run.sh review-code` |
| `agent-review-uat` | User acceptance testing | `scripts/dev/agent-run.sh review-uat` |
| `agent-kill` | Kill orphaned dev processes (I-007 cleanup) | Inline `pkill` |

#### [Makefile](file:///Users/gonzo/Code/code-red/Makefile) — 180 lines
The root Makefile. Lines 112–180 define the Agent Workflows section. All targets validate required args (`SPEC`, `PHASE`) and delegate to `AGENT_RUNNER` ([scripts/dev/agent-run.sh](file:///Users/gonzo/Code/code-red/scripts/dev/agent-run.sh)). The two orchestrator targets (`agent-wud`, `agent-dus`) bypass [agent-run.sh](file:///Users/gonzo/Code/code-red/scripts/dev/agent-run.sh) and delegate to dedicated shell scripts.

---

## 2. Shell Infrastructure — `scripts/dev/`

These scripts form the runtime layer between `make agent-*` and the Gemini CLI. They handle branching, logging, CI polling, and lifecycle orchestration.

**Total**: 9 files · 1,717 lines

### Dispatch & Logging

#### [agent-run.sh](file:///Users/gonzo/Code/code-red/scripts/dev/agent-run.sh) — 352 lines
**The central CLI dispatcher.** Maps workflow names to slash commands (`/implement`, `/specify`, etc.), sets approval modes (`yolo` vs `auto`), performs pre-flight checks (zombie process detection, Docker stack validation), creates structured log files, and invokes `gemini -p` with ANSI-formatted terminal output. Includes 429 rate-limit squelching and line truncation.

### Work-Until-Done (WUD) Orchestrator

#### [work-until-done.sh](file:///Users/gonzo/Code/code-red/scripts/dev/work-until-done.sh) — 466 lines
**The autonomous execution loop.** Orchestrates the full phase lifecycle: branch setup → implement → review-code → verdict check → PR creation → CI wait → review-uat (if applicable). Calls `agent-run.sh` for each sub-step. Contains retry logic, escalation handling, and Go/No-Go decision gates.

#### [wud-branch.sh](file:///Users/gonzo/Code/code-red/scripts/dev/wud-branch.sh) — 54 lines
Branch creation and management for WUD. Creates `feat/*` branches from `develop`, handles merge-forward from `develop` into existing feature branches.

#### [wud-ci-wait.sh](file:///Users/gonzo/Code/code-red/scripts/dev/wud-ci-wait.sh) — 65 lines
Polls GitHub Actions CI status after PR creation. Waits for checks to complete, reports pass/fail. Used by WUD to gate merge readiness.

#### [wud-verdict.sh](file:///Users/gonzo/Code/code-red/scripts/dev/wud-verdict.sh) — 63 lines
Parses review output (from `/review-code` and `/review-uat`) to determine GO/NO-GO verdict. Controls whether WUD loops back for remediation or proceeds to PR.

### Define-Until-Solid (DUS) Orchestrator

#### [define-until-solid.sh](file:///Users/gonzo/Code/code-red/scripts/dev/define-until-solid.sh) — 465 lines
**The autonomous definition loop.** Orchestrates: plan-to-beads → analyze → define-tests → beads import. Ensures all definition artifacts are solid before implementation begins.

### Shared Utilities

#### [review-reopen.sh](file:///Users/gonzo/Code/code-red/scripts/dev/review-reopen.sh) — 98 lines
Reopens failed beads tasks after a NO-GO review verdict. Parses review notes, extracts task IDs, runs `bd update` to reopen them.

#### [verify-dev-stack.sh](file:///Users/gonzo/Code/code-red/scripts/dev/verify-dev-stack.sh) — 77 lines
Validates the Docker dev stack is running. Checks container health, port availability, and API responsiveness. Called as pre-flight by implement, review-code, and review-uat.

#### [bootstrap.sh](file:///Users/gonzo/Code/code-red/scripts/dev/bootstrap.sh) — 77 lines
Initial workspace setup. Installs tooling, syncs env files, prepares the development environment.

---

## 3. Workflows — `.agent/workflows/`

The workflow definitions. These are markdown files that agents read and execute as slash commands (`/specify`, `/plan`, etc.). Each workflow defines: persona, scope constraints, algorithm steps, quality gates, and anti-patterns.

**Total**: 12 files · 2,333 lines

### Definition Pipeline (Spec → Plan → Beads)

| File | Lines | Slash Cmd | Persona | Purpose |
|---|---|---|---|---|
| [specify.md](file:///Users/gonzo/Code/code-red/.agent/workflows/specify.md) | 151 | `/specify` | Product Manager | Create spec.md from feature description |
| [plan.md](file:///Users/gonzo/Code/code-red/.agent/workflows/plan.md) | 189 | `/plan` | Senior Architect | Create plan.md from spec |
| [plan-to-beads.md](file:///Users/gonzo/Code/code-red/.agent/workflows/plan-to-beads.md) | 325 | `/plan-to-beads` | Senior Architect + Auditor | Generate beads import scripts from spec + plan + code audit |
| [define-tests.md](file:///Users/gonzo/Code/code-red/.agent/workflows/define-tests.md) | 183 | `/define-tests` | QA Architect | Generate RED test files before implementation |

### Execution Pipeline (Implement → Review → Ship)

| File | Lines | Slash Cmd | Persona | Purpose |
|---|---|---|---|---|
| [implement.md](file:///Users/gonzo/Code/code-red/.agent/workflows/implement.md) | 267 | `/implement` | Senior Developer | Execute all tasks in a phase via beads ready queue |
| [review-code.md](file:///Users/gonzo/Code/code-red/.agent/workflows/review-code.md) | 254 | `/review-code` | Principal Engineer | Technical code review against spec/plan |
| [review-uat.md](file:///Users/gonzo/Code/code-red/.agent/workflows/review-uat.md) | 196 | `/review-uat` | Product Manager | User acceptance testing against spec |

### Quality & Governance

| File | Lines | Slash Cmd | Persona | Purpose |
|---|---|---|---|---|
| [analyze.md](file:///Users/gonzo/Code/code-red/.agent/workflows/analyze.md) | 194 | `/analyze` | Principal Engineer | Read-only cross-artifact consistency analysis |
| [checklist.md](file:///Users/gonzo/Code/code-red/.agent/workflows/checklist.md) | 115 | `/checklist` | Principal Engineer | Generate domain-specific quality checklists |
| [build-plan.md](file:///Users/gonzo/Code/code-red/.agent/workflows/build-plan.md) | 167 | `/build-plan` | Senior Architect | Manage master build plan (add/modify/reorder/cluster-check) |

### Supporting

| File | Lines | Slash Cmd | Persona | Purpose |
|---|---|---|---|---|
| [effort.md](file:///Users/gonzo/Code/code-red/.agent/workflows/effort.md) | 173 | `/effort` | — | Story Point–driven effort estimation |
| [constitution.md](file:///Users/gonzo/Code/code-red/.agent/workflows/constitution.md) | 119 | `/constitution` | — | Create/update project governance principles |

---

## 4. Governance Rules — `.agent/rules/`

Binding policy documents referenced by workflows at runtime. The `<scope_constraints>` in implement.md, plan.md, etc. instruct the agent to read these files for applicable governance.

**Total**: 7 files · 533 lines

| File | Lines | Referenced By |
|---|---|---|
| [operating-model.md](file:///Users/gonzo/Code/code-red/.agent/rules/operating-model.md) | 43 | All workflows (Foxtrot Charlie principles, RAGB definitions) |
| [workspace.md](file:///Users/gonzo/Code/code-red/.agent/rules/workspace.md) | 70 | plan.md (UI components, config hygiene), checklist.md |
| [seeding-governance.md](file:///Users/gonzo/Code/code-red/.agent/rules/seeding-governance.md) | 58 | plan.md (fixture/seed changes), plan-to-beads.md |
| [coding-style.md](file:///Users/gonzo/Code/code-red/.agent/rules/coding-style.md) | 54 | implement.md (compile-gate skill) |
| [api-architecture.md](file:///Users/gonzo/Code/code-red/.agent/rules/api-architecture.md) | 170 | plan.md (hexagonal registry, API design) |
| [observability-governance.md](file:///Users/gonzo/Code/code-red/.agent/rules/observability-governance.md) | 62 | checklist.md (observability dimension) |
| [route-reference.md](file:///Users/gonzo/Code/code-red/.agent/rules/route-reference.md) | 76 | review-code.md (route contract validation) |

---

## 5. Agent Personas — `.agent/prompts/`

Role definitions that shape agent behavior when executing specific workflow personas.

**Total**: 4 files · 232 lines

| File | Lines | Used By Persona |
|---|---|---|
| [README.md](file:///Users/gonzo/Code/code-red/.agent/prompts/README.md) | 36 | Index file for persona selection |
| [senior-dev.md](file:///Users/gonzo/Code/code-red/.agent/prompts/personas/senior-dev.md) | 74 | `/implement` (Senior Developer) |
| [product-manager.md](file:///Users/gonzo/Code/code-red/.agent/prompts/personas/product-manager.md) | 74 | `/specify`, `/review-uat` (Product Manager) |
| [principal-engineer.md](file:///Users/gonzo/Code/code-red/.agent/prompts/personas/principal-engineer.md) | 48 | `/review-code`, `/analyze`, `/checklist` (Principal Engineer) |

---

## 6. Agent Templates — `.agent/templates/`

Templates injected into agent context at workflow runtime. These provide the agent with monorepo structure, test patterns, and gate scripts.

**Total**: 3 files · 328 lines

| File | Lines | Used By |
|---|---|---|
| [monorepo-context.md](file:///Users/gonzo/Code/code-red/.agent/templates/monorepo-context.md) | 71 | plan.md Step 2 (required reading for file path generation) |
| [e2e-patterns.md](file:///Users/gonzo/Code/code-red/.agent/templates/e2e-patterns.md) | 167 | define-tests.md (Playwright test patterns) |
| [verification-gate.md](file:///Users/gonzo/Code/code-red/.agent/templates/verification-gate.md) | 90 | plan-to-beads.md Step 7a (gate script format) |

---

## 7. Specify Templates — `.specify/templates/`

Output templates that workflows fill with `{{PLACEHOLDER}}` tokens. These ensure consistent artifact format across all specs and plans.

**Total**: 10 files · 591 lines

| File | Lines | Filled By Workflow |
|---|---|---|
| [spec-template.md](file:///Users/gonzo/Code/code-red/.specify/templates/spec-template.md) | 95 | `/specify` Step 6 |
| [plan-template.md](file:///Users/gonzo/Code/code-red/.specify/templates/plan-template.md) | 80 | `/plan` Step 4 |
| [task-description-template.md](file:///Users/gonzo/Code/code-red/.specify/templates/task-description-template.md) | 36 | `/plan-to-beads` Step 7 |
| [gap-analysis-template.md](file:///Users/gonzo/Code/code-red/.specify/templates/gap-analysis-template.md) | 22 | `/plan-to-beads` Step 4a |
| [checklist-template.md](file:///Users/gonzo/Code/code-red/.specify/templates/checklist-template.md) | 18 | `/checklist` Step 3 |
| [test-unit-template.md](file:///Users/gonzo/Code/code-red/.specify/templates/test-unit-template.md) | 28 | `/define-tests` Step 3 |
| [review-code-comment-template.md](file:///Users/gonzo/Code/code-red/.specify/templates/review-code-comment-template.md) | 18 | `/review-code` Step 9 |
| [review-uat-comment-template.md](file:///Users/gonzo/Code/code-red/.specify/templates/review-uat-comment-template.md) | 15 | `/review-uat` Step 7 |
| [tasks-template.md](file:///Users/gonzo/Code/code-red/.specify/templates/tasks-template.md) | 251 | Legacy (deprecated, but still referenced) |
| [agent-file-template.md](file:///Users/gonzo/Code/code-red/.specify/templates/agent-file-template.md) | 28 | Agent context file generation |

---

## 8. Specify Scripts — `.specify/scripts/bash/`

Shell scripts that workflows invoke for scaffold creation and prerequisite checking.

**Total**: 5 files · 1,492 lines

| File | Lines | Called By |
|---|---|---|
| [create-new-feature.sh](file:///Users/gonzo/Code/code-red/.specify/scripts/bash/create-new-feature.sh) | 310 | `/specify` Step 4 (creates feature directory scaffold) |
| [check-prerequisites.sh](file:///Users/gonzo/Code/code-red/.specify/scripts/bash/check-prerequisites.sh) | 166 | `/plan` Step 1 (verifies spec.md exists) |
| [setup-plan.sh](file:///Users/gonzo/Code/code-red/.specify/scripts/bash/setup-plan.sh) | 61 | `/plan` (optional plan scaffold) |
| [update-agent-context.sh](file:///Users/gonzo/Code/code-red/.specify/scripts/bash/update-agent-context.sh) | 799 | Post-definition context refresh |
| [common.sh](file:///Users/gonzo/Code/code-red/.specify/scripts/bash/common.sh) | 156 | Shared utilities (sourced by other scripts) |

---

## 9. Specify Memory — `.specify/memory/`

Persistent governance state that workflows reference for cross-cutting principles.

**Total**: 1 file · 50 lines

| File | Lines | Purpose |
|---|---|---|
| [constitution.md](file:///Users/gonzo/Code/code-red/.specify/memory/constitution.md) | 50 | Project constitution (MUST/SHOULD rules) — maintained by `/constitution` |

---

## 10. Parser Scripts — `.agent/scripts/parser/`

Domain-specific utility scripts for parser feature development.

**Total**: 2 files (line counts vary)

| File | Purpose |
|---|---|
| [parser-scaffold.sh](file:///Users/gonzo/Code/code-red/.agent/scripts/parser/parser-scaffold.sh) | Scaffold parser-related feature structure |
| [parser-validate.sh](file:///Users/gonzo/Code/code-red/.agent/scripts/parser/parser-validate.sh) | Validate parser output format |

---

## 11. Upstream References (Read-Only Context)

These files are not part of the workflow system itself but are **mandatory reading** for specific workflows. They provide the domain context that workflows operate within.

| File | Lines | Read By |
|---|---|---|
| [docs/architecture.md](file:///Users/gonzo/Code/code-red/docs/architecture.md) | ~300 | `/specify`, `/plan` (tech stack, project structure, guardrails) |
| [specs/000-build-plan.md](file:///Users/gonzo/Code/code-red/specs/000-build-plan.md) | ~550 | `/specify`, `/plan`, `/build-plan` (dependency graph, waves, clusters) |
| [docs/references/gpt-5-2-prompting-guide.md](file:///Users/gonzo/Code/code-red/docs/references/gpt-5-2-prompting-guide.md) | ~540 | `/build-plan` (XML structuring best practices) |
| [docs/CODERED-PRD-PRFAQ.md](file:///Users/gonzo/Code/code-red/docs/CODERED-PRD-PRFAQ.md) | — | `/specify` (product requirements, FR-### source) |

---

## 12. Legacy (Deprecated)

#### `.gemini/commands/` — 9 TOML files
Pre-Antigravity Gemini CLI slash command definitions. **Deprecated as of 2026-01-07** in favor of `.agent/workflows/`. Kept for reference only.

| File | Original Command |
|---|---|
| `speckit.specify.toml` | `/specify` |
| `speckit.plan.toml` | `/plan` |
| `speckit.implement.toml` | `/implement` |
| `speckit.checklist.toml` | `/checklist` |
| `speckit.analyze.toml` | `/analyze` |
| `speckit.constitution.toml` | `/constitution` |
| `speckit.clarify.toml` | `/clarify` |
| `speckit.tasks.toml` | `/tasks` |
| `speckit.taskstoissues.toml` | `/taskstoissues` |

#### `.gemini/DEPRECATED.md` — Deprecation notice

---

## Summary by Category

| Category | Directory | Files | Lines |
|---|---|---|---|
| Workflows | `.agent/workflows/` | 12 | 2,333 |
| Governance Rules | `.agent/rules/` | 7 | 533 |
| Agent Personas | `.agent/prompts/` | 4 | 232 |
| Agent Templates | `.agent/templates/` | 3 | 328 |
| Parser Scripts | `.agent/scripts/parser/` | 2 | — |
| Specify Templates | `.specify/templates/` | 10 | 591 |
| Specify Scripts | `.specify/scripts/bash/` | 5 | 1,492 |
| Specify Memory | `.specify/memory/` | 1 | 50 |
| Dev Infrastructure | `scripts/dev/` | 9 | 1,717 |
| Makefile | `Makefile` | 1 | 180 |
| Legacy Commands | `.gemini/commands/` | 10 | — |
| **Total** | | **64+** | **~7,456** |

> [!NOTE]
> Upstream references (`docs/architecture.md`, `specs/000-build-plan.md`, etc.) are NOT included in the count — they are consumers of the workflow system, not part of it. The workflow system reads them for context but does not own them.

---

## Dependency Graph

```mermaid
graph TD
    subgraph "User Interface"
        M[Makefile targets]
    end

    subgraph "Shell Infrastructure"
        AR[agent-run.sh]
        WUD[work-until-done.sh]
        DUS[define-until-solid.sh]
        VDS[verify-dev-stack.sh]
        WB[wud-branch.sh]
        WCI[wud-ci-wait.sh]
        WV[wud-verdict.sh]
        RR[review-reopen.sh]
    end

    subgraph "Workflow Definitions"
        SP[/specify]
        PL[/plan]
        PTB[/plan-to-beads]
        DT[/define-tests]
        IM[/implement]
        RC[/review-code]
        RU[/review-uat]
        AN[/analyze]
        CK[/checklist]
        BP[/build-plan]
    end

    subgraph "Supporting Assets"
        R[rules/]
        P[prompts/]
        AT[.agent/templates/]
        ST[.specify/templates/]
        SS[.specify/scripts/]
        SM[.specify/memory/]
    end

    M --> AR
    M --> WUD
    M --> DUS

    AR --> SP & PL & PTB & AN & RC & RU & CK & DT
    WUD --> AR
    WUD --> WB & WCI & WV & RR
    DUS --> AR

    SP --> ST & SS & R
    PL --> ST & AT & R
    PTB --> ST & AT & R
    DT --> AT & ST
    IM --> R & P
    RC --> ST & R
    RU --> ST & R
    AN --> R
    CK --> ST & R

    IM --> VDS
    RC --> VDS
    RU --> VDS
end
```

---

## Extraction Notes (for future standalone CLI)

When extracting this system into a standalone package:

1. **Core bundle** (must ship): `.agent/workflows/`, `.agent/rules/`, `.agent/templates/`, `.agent/prompts/`, `.specify/templates/`, `.specify/scripts/bash/common.sh`
2. **Runtime bundle** (must ship): `scripts/dev/agent-run.sh`, `scripts/dev/work-until-done.sh`, `scripts/dev/define-until-solid.sh`, `scripts/dev/wud-*.sh`, `scripts/dev/review-reopen.sh`, `scripts/dev/verify-dev-stack.sh`
3. **Project-specific** (stays in repo): `Makefile` targets, `.specify/memory/constitution.md`, upstream references
4. **Deprecated** (do not ship): `.gemini/commands/`
5. **Config surface**: The `AGENT_RUNNER` variable in Makefile and the `SPEC_DIR` / feature directory convention are the main integration points between the CLI and the host project

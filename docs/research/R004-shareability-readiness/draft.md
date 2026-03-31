# R004 — Shareability Readiness Assessment

> **Status:** Draft — Awaiting Review
> **Initiative:** [R004 brief](file:///Users/gonzo/Code/gwrk/docs/research/R004-shareability-readiness/brief.md)
> **Consumer:** README.md rewrite, DEVELOPMENT.md creation, F014 rework scope

## Executive Summary

gwrk cannot be shared in its current state. The core problem is not documentation — it's that **gwrk's workflow engine is a facade over Gonzo's personal `.agents/` directory**. Every `gwrk specify`, `gwrk plan`, `gwrk define`, and `gwrk ship` command hardcodes paths to `.agents/workflows/gwrk-*.md` files and passes them to LLM agents as raw markdown. These workflow files are Gonzo's personal Foxtrot Charlie methodology — they do not ship with gwrk and `gwrk init` creates empty placeholders that say "Placeholder content for specify.md."

F014 (Plugin System) was intended to solve this. The spec explicitly calls out shareability as a goal (§1 Problem Statement: "Shareability — no install/publish mechanism for friends or collaborators"). **But F014 as implemented only solved half the problem:** it built excellent plugin infrastructure (loader, manifest schema, skill runtime, agent backend adapters) but did NOT internalize gwrk's own workflows as built-in plugins. There are no built-in workflows. The WorkflowRuntime (Layer 2.5) that was supposed to replace raw `.agents/` file passing with structured JSON intent execution — specified as FR-L25-001 through FR-L25-003 — was never implemented.

**The result:** Joe, Lance, and Bert install gwrk, run `gwrk init`, get empty workflow placeholders, run `gwrk specify`, and it dispatches an LLM with a path to a file that contains "Placeholder content for specify.md." gwrk is unusable without cloning Gonzo's `.agents/` directory.

---

## Q1: What Remains in F000–F003 That Needs Rework?

### Drift Inventory

| # | Item | Location | Severity | Detail |
|---|------|----------|----------|--------|
| 1 | README stale since F001 | [README.md](file:///Users/gonzo/Code/gwrk/README.md) L63 | 🔴 High | Missing: plugin system, agent-native protocol, ship loop, gate architecture. References Docker and bash scripts as core. |
| 2 | WHAT_IS_GWRK.md: Docker refs | [WHAT_IS_GWRK.md](file:///Users/gonzo/Code/gwrk/docs/WHAT_IS_GWRK.md) L248 | 🟡 Medium | Tech stack says "Docker" for sandboxes — now worktrees per R001. Quick Start references `gwrk dispatch` (not a real command). |
| 3 | `docker.ts` module + `dockerode` dep | [docker.ts](file:///Users/gonzo/Code/gwrk/src/server/docker.ts), [package.json](file:///Users/gonzo/Code/gwrk/package.json) L21 | 🟡 Medium | Dead Docker lifecycle code. Runtime dep on `dockerode`. Superseded by worktree model. |
| 4 | Makefile Docker Compose targets | [Makefile](file:///Users/gonzo/Code/gwrk/Makefile) L31-48 | 🟡 Medium | `up`, `down`, `ps`, `logs` targets reference `docker compose`. No docker-compose.yml exists. |
| 5 | PRD Docker throughout | [GWRK-PRD-PRFAQ.md](file:///Users/gonzo/Code/gwrk/docs/GWRK-PRD-PRFAQ.md) | 🟡 Medium | 50+ Docker references. Internal doc but misleading. |
| 6 | Pronunciation inconsistency | PRD L43 vs WHAT_IS_GWRK.md L28 | 🟢 Low | "gee-work" vs "gwerk". |

### Recommendation

Items 1-4 are pre-share blockers. Items 5-6 are deferred.

---

## Q2: F014 Implementation Audit — What Shipped vs. What's Missing

This is the critical finding. F014 was marked ✅ Complete in the build plan. **It is not complete for shareability purposes.**

### What F014 Actually Shipped ✅

| Component | Files | Status | Evidence |
|-----------|-------|--------|----------|
| **Plugin Loader + Registry** | `src/plugins/loader.ts`, `manifest.ts` | ✅ Working | Scans `~/.gwrk/plugins/`, validates manifests via Zod, resolution order (global → local → builtins) |
| **Manifest Schema** | `src/plugins/manifest.ts` | ✅ Working | Zod schemas for skills (atomic/compound), agents, workflows. All DM-001 through DM-007 types defined. |
| **Skill Runtime** | `src/plugins/skill-runtime.ts` | ✅ Working | `executeSkill()` resolves skills, assembles prompts, dispatches to agent backends. Pipe-composable. |
| **Agent Backend Adapters** | `src/plugins/builtins/agents/{claude,codex,gemini}/` | ✅ Working | Built-in adapters with manifest.yaml + adapter.ts. `AgentBackendRegistry` with resolution order. |
| **Agent Backend Registry** | `src/plugins/agent-registry.ts` | ✅ Working | `getAgentBackend()`, `syncAllBackends()`, governance sync with SHA256 dedup. |
| **Migration Tool** | `src/plugins/migrate.ts` | ✅ Working | Migrates `.agents/skills/` → `~/.gwrk/plugins/skills/` with auto-generated manifests. |
| **Plugin CLI Commands** | `src/commands/plugin.ts`, `skill.ts` | ✅ Working | `gwrk plugin install/remove/list/check/sync-context`, `gwrk skill <name>` |
| **One Built-in Skill** | `src/plugins/builtins/skills/narrative/` | ✅ Exists | Single example atomic skill. |

### What F014 Did NOT Ship ❌

| Component | Spec Reference | Status | Impact |
|-----------|---------------|--------|--------|
| **Built-in Workflows** | FR-L25-001 | ❌ **Not implemented** | No `builtins/workflows/` directory exists. gwrk ships ZERO workflows. |
| **WorkflowRuntime (Layer 2.5)** | FR-L25-001, FR-L25-002, FR-L25-003 | ❌ **Not implemented** | The engine that executes workflow JSON intents natively — never built. |
| **Workflow integration into CLI commands** | FR-L25-003 | ❌ **Not implemented** | `specify.ts`, `plan.ts`, `define.ts` etc. still hardcode `.agents/workflows/` paths |
| **`gwrk plugin seed`** | FR-012 | ❌ **Not implemented** | No `seed.ts` file exists. The ~40 reasoning modes from taxonomy are not auto-generated. |
| **`gwrk plugin create agent`** | FR-L1-009 | ❌ **Unknown** | Need to verify — likely not implemented. |
| **`gwrk plugin update`** | FR-L1-013 | ❌ **Unknown** | Re-clone from `.gwrk-source.json` — likely not implemented. |
| **`gwrk init` workflow provisioning** | FR-L1-008 | ⚠️ **Partial** | Detects CLIs and syncs governance, but scaffolds empty placeholder workflows (L182-188). |

### The Coupling That Must Be Broken

Six CLI commands directly hardcode `.agents/workflows/` paths and pass them as raw markdown to LLM agents:

| Command | Hardcoded Path | Source |
|---------|---------------|--------|
| `gwrk specify` (aka `define spec`) | `.agents/workflows/gwrk-specify.md` | [specify.ts:37](file:///Users/gonzo/Code/gwrk/src/commands/specify.ts#L37) |
| `gwrk plan` (aka `define plan`) | `.agents/workflows/gwrk-plan.md` | [plan.ts:78](file:///Users/gonzo/Code/gwrk/src/commands/plan.ts#L78) |
| `gwrk define tests` | `.agents/workflows/gwrk-define-tests.md` | [tests-generate.ts:73](file:///Users/gonzo/Code/gwrk/src/commands/tests-generate.ts#L73) |
| `gwrk define tasks` (gate authoring) | `.agents/workflows/gwrk-author-gates.md` | [tasks-generate.ts:337](file:///Users/gonzo/Code/gwrk/src/commands/tasks-generate.ts#L337) |
| `gwrk ship` / `gwrk implement` | `.agents/workflows/gwrk-implement.md` | [agent.ts:264](file:///Users/gonzo/Code/gwrk/src/utils/agent.ts#L264), [invocation-strategy.ts:24](file:///Users/gonzo/Code/gwrk/src/server/backends/invocation-strategy.ts#L24) |

Additionally:
- [init.ts:91-96](file:///Users/gonzo/Code/gwrk/src/commands/init.ts#L91): Creates empty `.agents/workflows/` and `.agents/rules/`
- [init.ts:182-188](file:///Users/gonzo/Code/gwrk/src/commands/init.ts#L182): Writes **placeholder** workflow files: `"# Workflow: specify.md\n\nPlaceholder content for specify.md."`
- [context.ts:13,28](file:///Users/gonzo/Code/gwrk/src/server/context.ts#L13): Server loads governance from `.agents/rules/` and `.agents/prompts/personas/`

### What Needs to Happen

There are two viable paths to make gwrk standalone:

#### Path A: Ship Workflows as Built-in Plugins (Recommended)

Package gwrk's core workflows as built-in plugins in `src/plugins/builtins/workflows/`, analogous to how agent backends are already built-in:

1. **Create `src/plugins/builtins/workflows/`** with manifest.yaml + workflow .md for each core workflow:
   - `specify/` — the gwrk-specify workflow
   - `plan/` — the gwrk-plan workflow
   - `implement/` — the gwrk-implement workflow
   - `define-tests/` — the gwrk-define-tests workflow
   - `author-gates/` — the gwrk-author-gates workflow
   
2. **Update CLI commands** to resolve workflows through the plugin loader (built-in → user-override) instead of hardcoding `.agents/workflows/` paths.

3. **Update `gwrk init`** to scaffold from built-in workflow content, not empty placeholders.

4. **Update governance loading** (`context.ts`) to source rules from built-in defaults, not from a `.agents/` directory that doesn't exist in a fresh project.

**What this does NOT require:** WorkflowRuntime (Layer 2.5) / JSON intent execution. That's an optimization for later. The immediate fix is just shipping the workflow content as built-in files that gwrk resolves through its plugin system.

#### Path B: Full WorkflowRuntime (Layer 2.5) — Deferred

The spec's FR-L25-001/002/003 envision workflows producing JSON intents that gwrk executes natively, eliminating LLM filesystem mutation entirely. This is architecturally superior but is a large effort and should not block shareability. Path A is sufficient.

### Standalone Readiness Verdict

**NO — gwrk is not standalone today.** Required for standalone:

| Requirement | Status | Blocks Share? |
|-------------|--------|--------------|
| Built-in workflows shipped with gwrk | ❌ Not done | **YES** |
| CLI commands resolve workflows via plugin system | ❌ Not done | **YES** |
| `gwrk init` provisions real content | ❌ Placeholder only | **YES** |
| F004-R (DispatchOrchestrator) | 🟡 In progress | **YES** — `ship.ts` spawns bash scripts |
| README rewrite | ❌ Stale | **YES** — first impression |
| DEVELOPMENT.md | ❌ Missing | **YES** — can't contribute |
| WorkflowRuntime (Layer 2.5) | ❌ Not done | No — deferred optimization |
| F005 (Parallel Dispatch) | ❌ Not done | No — power feature |
| Docker code cleanup | 🟡 Dead code | No — cosmetic |

---

## Q3: Onboarding Documentation Gap

| Document | Status | Priority | Blocker? |
|----------|--------|----------|----------|
| README.md | ❌ Stale | P0 | Yes |
| DEVELOPMENT.md | ❌ Missing | P0 | Yes |
| CONTRIBUTING.md | ❌ Missing | P1 | No (verbal at first) |
| WHAT_IS_GWRK.md tech fixes | 🟡 Stale | P2 | No |
| Makefile cleanup | 🟡 Dead targets | P2 | No |

---

## Spec Alignment Notes

**F014 needs a rework addendum — not a full rewrite.** The spec already contains the right FRs (FR-L25-001/002/003 for WorkflowRuntime, FR-012 for seeding). What's needed is:

1. **New phase or rework track** to ship built-in workflows (Path A above). This is ~5-8 SP of work:
   - Package 5 core workflow .md files as built-in plugins with manifests
   - Update 6 CLI commands to resolve through plugin loader
   - Update `gwrk init` to provision from builtins  
   - Update `context.ts` governance loading

2. **FR-L25-001/002/003 remain as a future phase** — WorkflowRuntime is still the right long-term architecture, but shouldn't block shareability.

3. **`gwrk plugin seed` (FR-012) can be deferred** — nice-to-have, not a shareability blocker.

## Architecture Amendments

- Architecture.md §7 should note that core workflows ship as built-ins in `src/plugins/builtins/workflows/`
- Architecture.md §4 project structure should show `src/plugins/builtins/workflows/` alongside existing `src/plugins/builtins/agents/`
- `.agents/` should be documented as an **optional user-override directory**, not a required structural dependency

## Open Items

| # | Item | Requires Decision |
|---|------|------------------|
| 1 | Should this work be tracked as an F014 rework addendum (like F004-R) or as a new feature? | PM decision |
| 2 | Which workflows are "core" and ship as builtins vs. which are Gonzo-specific and stay in `.agents/`? The 15 workflows in `.agents/workflows/` include domain-specific ones like `gwrk-constitution.md`, `gwrk-effort.md`, `gwrk-cascade-sync.md`. Likely core: specify, plan, implement, define-tests, author-gates, plan-to-tasks, review-code, review-uat. Likely user-specific: constitution, cascade-sync, build-plan, effort, research, checklist, analyze. | PM decision |
| 3 | Should `.agents/skills/` content (9 compound skills like signal-cut, truth-extract, decision-forge) ship as builtin plugins? Or are these Gonzo-specific? | PM decision — some are generic (decision-forge), some are personal (audience-model for Nexus) |
| 4 | Should `gwrk init` also scaffold `.agents/rules/` with default governance rules, or should governance be built into gwrk's defaults? | PM decision — affects how opinionated the product is |
| 5 | F004-R completion date — it's the other hard blocker alongside this work. | Coordination |
| 6 | Should `scripts/dev/` bash scripts be deleted post-F004-R or archived? | PM decision |

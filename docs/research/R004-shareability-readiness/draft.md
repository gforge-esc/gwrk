# R004 — Shareability Readiness Assessment (Final)

> **Status:** Complete — PM Decisions Locked
> **Initiative:** [R004 brief](file:///Users/gonzo/Code/gwrk/docs/research/R004-shareability-readiness/brief.md)
> **Consumer:** F014-R rework spec, DEVELOPMENT.md, README rewrite
> **Architecture Reference:** [ADR-006](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md)

---

## Executive Summary

gwrk cannot be shared. Every `gwrk specify`, `gwrk plan`, `gwrk define`, and `gwrk ship` command hardcodes paths to `.agents/workflows/gwrk-*.md` — files that exist only in Gonzo's personal repository and are never part of gwrk's distribution. `gwrk init` creates placeholder files (`"Placeholder content for specify.md"`). F014 built excellent plugin infrastructure (loader, manifests, skill runtime, agent backends) but never implemented the WorkflowRuntime (Layer 2.5) that would internalize workflows into the product.

**Decision: Full WorkflowRuntime (Path B)** — no half-measures. Ship the JSON intent execution engine. Debt on the critical path compounds forever.

---

## PM Decisions (Locked)

| # | Decision | Detail |
|---|----------|--------|
| 1 | **F014 rework addendum** | Proper spec, plan, tests, tasks. Not a new feature. |
| 2 | **Core workflows** | 8 mandatory + 2 shipped: research (beta), build-plan (alpha). Checklist and analyze fold into their parent workflows (specify, plan). Effort not ready. Cascade-sync, constitution are personal. |
| 3 | **Skills** | Ship separately — not as builtins. New feature required. |
| 4 | **DefineOrchestrator** | Mirrors ShipOrchestrator pattern (TypeScript state machine). |
| 5 | **Directory model** | `~/.gwrk/` = global home (all plugins, skills, workflows). `.gwrk/` = project-local overrides only. `.agents/` = never part of gwrk, ever. Per [ADR-006](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md). |
| 6 | **`scripts/dev/`** | Gitignore and `git rm --cached`. Don't delete. |

---

## F014 Implementation Audit

### What Shipped ✅

| Component | Evidence |
|-----------|----------|
| Plugin Loader + Manifest Schema | `loader.ts`, `manifest.ts` — Zod validation, resolution order |
| Skill Runtime | `skill-runtime.ts` — `executeSkill()`, prompt assembly, pipe-composable |
| Agent Backend Adapters | `builtins/agents/{claude,codex,gemini}/` with manifests |
| Agent Backend Registry | `agent-registry.ts` — governance sync, SHA256 dedup |
| Migration Tool | `migrate.ts` — `.agents/skills/` → `~/.gwrk/plugins/skills/` |
| Plugin CLI | `gwrk plugin install/remove/list/check/sync-context`, `gwrk skill` |

### What Did NOT Ship ❌

| Component | Spec FR | Impact |
|-----------|---------|--------|
| **WorkflowRuntime (Layer 2.5)** | FR-L25-001/002/003 | JSON intent execution — never built |
| **Built-in workflows** | — | No `builtins/workflows/` directory exists |
| **CLI workflow resolution** | FR-L25-003 | 6 commands hardcode `.agents/workflows/` paths |
| **`gwrk init` content provisioning** | FR-L1-008 | Writes placeholder text |
| **`gwrk plugin seed`** | FR-012 | Not implemented |

### The Coupling Map (All Must Be Broken)

| Command | Hardcoded Path | Source |
|---------|---------------|--------|
| `gwrk specify` | `.agents/workflows/gwrk-specify.md` | [specify.ts:37](file:///Users/gonzo/Code/gwrk/src/commands/specify.ts#L37) |
| `gwrk plan` | `.agents/workflows/gwrk-plan.md` | [plan.ts:78](file:///Users/gonzo/Code/gwrk/src/commands/plan.ts#L78) |
| `gwrk define tests` | `.agents/workflows/gwrk-define-tests.md` | [tests-generate.ts:73](file:///Users/gonzo/Code/gwrk/src/commands/tests-generate.ts#L73) |
| `gwrk define tasks` | `.agents/workflows/gwrk-author-gates.md` | [tasks-generate.ts:337](file:///Users/gonzo/Code/gwrk/src/commands/tasks-generate.ts#L337) |
| `gwrk ship` / `implement` | `.agents/workflows/gwrk-implement.md` | [agent.ts:264](file:///Users/gonzo/Code/gwrk/src/utils/agent.ts#L264) |
| `gwrk define` (bare) | `scripts/dev/define-until-solid.sh` | [define.ts:55,90](file:///Users/gonzo/Code/gwrk/src/commands/define.ts#L55) |
| `gwrk init` | Empty `.agents/workflows/` | [init.ts:91-96,182-188](file:///Users/gonzo/Code/gwrk/src/commands/init.ts#L91) |
| Server context | `.agents/rules/`, `.agents/prompts/personas/` | [context.ts:13,28](file:///Users/gonzo/Code/gwrk/src/server/context.ts#L13) |

---

## F014-R Rework Scope

### Work Items

| # | Item | SP | Detail |
|---|------|-----|--------|
| 1 | **WorkflowRuntime engine** | 8-13 | JSON intent parser + executor. Actions: `WRITE_FILE`, `CREATE_DIR`, `RUN_COMMAND`. Schema validation via Zod against workflow `outputSchema`. |
| 2 | **Core workflow plugins** | 5-8 | 10 workflows as `builtins/workflows/` with `manifest.yaml` + `outputSchema` + prompt. See classification below. |
| 3 | **CLI command rewiring** | 3-5 | 6 commands resolve workflows via plugin loader → WorkflowRuntime. Kill `.agents/` paths. |
| 4 | **`gwrk init` overhaul** | 2-3 | Provision from builtins. `.gwrk/` for project-local overrides. No `.agents/`. |
| 5 | **DefineOrchestrator** | 5-8 | TypeScript state machine mirroring ShipOrchestrator. Replaces `define-until-solid.sh`. spec → plan → tasks → analyze loop. |
| 6 | **Governance defaults** | 2-3 | Ship default rules as builtin content. `context.ts` loads from `~/.gwrk/`, not `.agents/`. |
| **Total** | | **25-40** | |

### Workflow Classification (Locked)

| Workflow | Disposition | Note |
|----------|------------|------|
| `gwrk-specify` | ✅ Core builtin | |
| `gwrk-plan` | ✅ Core builtin | |
| `gwrk-implement` | ✅ Core builtin | |
| `gwrk-define-tests` | ✅ Core builtin | |
| `gwrk-author-gates` | ✅ Core builtin | |
| `gwrk-plan-to-tasks` | ✅ Core builtin | |
| `gwrk-review-code` | ✅ Core builtin | |
| `gwrk-review-uat` | ✅ Core builtin | |
| `gwrk-research` | ✅ Ship (beta) | |
| `gwrk-build-plan` | ✅ Ship (alpha) | |
| `gwrk-checklist` | 🔀 Fold into specify/plan | Not standalone — subprocess |
| `gwrk-analyze` | 🔀 Fold into specify/plan | Not standalone — subprocess |
| `gwrk-effort` | ❌ Not ready | |
| `gwrk-cascade-sync` | ❌ Personal | |
| `gwrk-constitution` | ❌ Personal | |

### ADR-006 Layer Model (Updated)

```
Layer 1:   Agent Backend Plugins     ← ADR-006 (SHIPPED)
           (Claude, Codex, Gemini adapters)

Layer 2:   Skill Plugins             ← F014 spec (SHIPPED)
           (Atomic reasoning modes, compound compositions)

Layer 2.5: Workflow Runtime          ← F014-R (THIS REWORK)
           (JSON intent execution, builtin workflows)
           Consumers: gwrk define, gwrk specify, gwrk plan, gwrk ship

Layer 3:   Extension Plugins         ← Not yet specified
           (Domain Packs, Channel Adapters)
```

---

## F004-R Progress Note

Phase 5 landed on develop. `ship.ts` defaults to `ShipOrchestrator` (TypeScript) with `--legacy` bash fallback. `gate-runner.ts` provides programmatic gate execution. `define.ts` still spawns `define-until-solid.sh` — the DefineOrchestrator (Item 5 above) is the F014-R counterpart.

---

## Remaining Pre-Share Work (Beyond F014-R)

| Item | Blocker? | Size |
|------|----------|------|
| README.md rewrite | Yes | ~2h |
| DEVELOPMENT.md creation | Yes | ~3h |
| CONTRIBUTING.md creation | No | ~1h |
| Docker cleanup (docker.ts, dockerode, Makefile) | No | ~1h |
| `scripts/dev/` gitignore + git rm --cached | No | ~15m |
| Skills as separate installable feature | No (post-share) | TBD |
| WHAT_IS_GWRK.md / PRD Docker refs | No | ~2h |

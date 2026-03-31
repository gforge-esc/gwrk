# R004 — Shareability Readiness Assessment

> **Status:** Draft — Awaiting Review
> **Initiative:** [R004 brief](file:///Users/gonzo/Code/gwrk/docs/research/R004-shareability-readiness/brief.md)
> **Consumer:** README.md rewrite, DEVELOPMENT.md creation, onboarding documentation

## Executive Summary

gwrk is **not yet standalone**. Despite F014 (Plugin System) being complete, deep structural coupling to `.agents/` workflows and `scripts/dev/` bash orchestrators remains in the runtime hot path. Six CLI commands hardcode `.agents/workflows/` paths. Two commands (`ship`, `define`) spawn bash scripts that are themselves the orchestration engines. The README was last audited at F001, `WHAT_IS_GWRK.md` references Docker sandboxes (now replaced by git worktrees per R001), and the Makefile contains dead Docker Compose targets. No `DEVELOPMENT.md` or `CONTRIBUTING.md` exists.

**The critical finding:** F004-R (DispatchOrchestrator) is the keystone to standalone operation. It replaces the bash scripts that `ship.ts` and `define.ts` spawn. However, even after F004-R, the `.agents/` directory **does not go away** — it transitions from "gwrk's runtime dependency" to "gwrk's generated-and-maintained project scaffolding." The workflows in `.agents/` are consumed by LLM agents (Gemini, Claude, Codex) as reasoning programs, not by gwrk's TypeScript code. F014's `WorkflowRuntime` (Layer 2.5) is designed to replace this indirect coupling with native JSON intent execution, but that Layer 2.5 is not yet implemented.

**Verdict:** gwrk will be shareable **after F004-R completes + documentation remediation**, but with an honest caveat: `.agents/` workflows remain the LLM reasoning programs that power `gwrk specify`, `gwrk plan`, etc. They're not idiosyncratic — they're the product's domain knowledge, and new users will need them. The shareability question is really: "Can Joe, Lance, and Bert install gwrk, run it on their projects, and get value?" The answer is **conditional yes** — pending the items below.

---

## Q1: What Remains in F000–F003 That Needs Rework?

### Findings

The F000–F003 features are marked ✅ in the build plan, but multiple artifacts have drifted from the current architectural state. The drift falls into three categories: **documentation rot**, **dead code**, and **stale dependencies**.

### Drift Inventory

| # | Item | Location | Severity | Category | Detail |
|---|------|----------|----------|----------|--------|
| 1 | README references Docker | [README.md](file:///Users/gonzo/Code/gwrk/README.md) L29, L59 | 🔴 High | Doc rot | "These shell scripts are the actual product orchestrators" (L29, no longer true post-F004-R). `Dockerfile.sandbox` referenced (L59). |
| 2 | README last audited at F001 | [README.md](file:///Users/gonzo/Code/gwrk/README.md) L63 | 🔴 High | Doc rot | Entire README predates F004, F013, F014. Missing: plugin system, agent-native protocol, ship loop, gate architecture. |
| 3 | WHAT_IS_GWRK.md: Docker sandboxes | [WHAT_IS_GWRK.md](file:///Users/gonzo/Code/gwrk/docs/WHAT_IS_GWRK.md) L248, L56 | 🟡 Medium | Doc rot | Tech stack table says "Docker (per-phase isolation)" for Sandboxes. Should be "Git worktrees" per R001. Docker sandbox pattern (L232-L237) references OpenClaw Docker model. |
| 4 | WHAT_IS_GWRK.md: Quick Start stale | [WHAT_IS_GWRK.md](file:///Users/gonzo/Code/gwrk/docs/WHAT_IS_GWRK.md) L192-L215 | 🟡 Medium | Doc rot | References `gwrk dispatch` (not a real command — it's `gwrk ship`). Missing `gwrk skill`, `gwrk plugin`, `gwrk gate`. |
| 5 | PRD: Docker throughout | [GWRK-PRD-PRFAQ.md](file:///Users/gonzo/Code/gwrk/docs/GWRK-PRD-PRFAQ.md) | 🟡 Medium | Doc rot | 50+ Docker references. PR FAQ says "Build server requires Docker" (L66). Sandbox model sections describe Docker containers. Now worktrees per R001. |
| 6 | PRD: pronunciation | [GWRK-PRD-PRFAQ.md](file:///Users/gonzo/Code/gwrk/docs/GWRK-PRD-PRFAQ.md) L43 | 🟢 Low | Doc rot | Says "pronounced 'gee-work'" — `WHAT_IS_GWRK.md` L28 says "pronounced 'gwerk'". Inconsistent. |
| 7 | Makefile: Docker Compose targets | [Makefile](file:///Users/gonzo/Code/gwrk/Makefile) L31-L48 | 🟡 Medium | Dead code | `up`, `down`, `ps`, `logs` targets reference `docker compose`. No `docker-compose.yml` exists. Dead targets. |
| 8 | `docker.ts` module | [src/server/docker.ts](file:///Users/gonzo/Code/gwrk/src/server/docker.ts) | 🟡 Medium | Dead code | Full Docker lifecycle management (install check, daemon start, wait). Consumed by health check and sandbox. Architecture says worktrees replace Docker (R001). |
| 9 | `dockerode` dependency | [package.json](file:///Users/gonzo/Code/gwrk/package.json) L21, L30-31 | 🟡 Medium | Stale dep | Runtime `dockerode` dependency + `@types/dockerode` in devDeps. No longer needed per R001 worktree decision. |
| 10 | `Dockerfile.sandbox` | [Dockerfile.sandbox](file:///Users/gonzo/Code/gwrk/Dockerfile.sandbox) (referenced L59 README) | 🟡 Medium | Dead code | Sandbox container definition. Superseded by worktree model per R001. |
| 11 | F001 gate contamination ⚠️ | [000-build-plan.md](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md) L139 | 🟢 Low | Tech debt | 91% gate contamination noted but "deferred to TDD Hardening" which is marked ✅. Build plan says "cleared through F004 dev" but original gates may still be stubs. |
| 12 | F002 `server clean` missing | [000-build-plan.md](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md) L184 | 🟢 Low | Gap | FR-024 (`server clean`) identified as missing in gap analysis. Status unclear post-TDD hardening. |
| 13 | F003 gap analysis is greenfield | [000-build-plan.md](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md) L217 | 🟢 Low | Tech debt | "Needs rewrite as proper FR-by-FR ✅/⚠️/❌ classification. Deferred to TDD Hardening." |

### Recommendation

Remediation should be split into **pre-share** (required before Joe/Lance/Bert see the repo) and **post-share** (acceptable tech debt):

**Pre-share (blockers):**
- Items 1-2: README rewrite (complete overhaul)
- Item 4: WHAT_IS_GWRK.md Quick Start fix
- Item 7: Remove dead Makefile Docker targets

**Post-share (acceptable debt, disclosed):**
- Items 3, 5: WHAT_IS_GWRK.md and PRD Docker references (these are internal strategic docs, not onboarding)
- Items 8-10: Docker code removal (cleanup task, not blocking)
- Items 11-13: Gate quality debt (deeper work, honesty about it is fine)

---

## Q2: Will F004-R + F005 Make gwrk Standalone?

### Findings

#### The `.agents/` Dependency Map

Every runtime reference from `src/` to `.agents/`, `scripts/dev/`, and `.specify/` was traced. The dependencies fall into three functional categories:

**Category A: Bash Script Spawning (killed by F004-R)**

| Source File | Dependency | What It Does | Post-F004-R Status |
|-------------|-----------|--------------|-------------------|
| [ship.ts](file:///Users/gonzo/Code/gwrk/src/commands/ship.ts) L46, L478 | `scripts/dev/work-until-done.sh` | Ship loop orchestration | ✅ **Replaced** by TypeScript DispatchOrchestrator |
| [define.ts](file:///Users/gonzo/Code/gwrk/src/commands/define.ts) L55 | `scripts/dev/define-until-solid.sh` | Define loop orchestration | ✅ **Replaced** by TypeScript DispatchOrchestrator |
| [implement.ts](file:///Users/gonzo/Code/gwrk/src/commands/implement.ts) L27 | `scripts/dev/agent-run.sh` | Single agent dispatch | ✅ **Replaced** by `dispatchToAgent()` |
| [scripts-e2e.test.ts](file:///Users/gonzo/Code/gwrk/src/scripts-e2e.test.ts) | `scripts/dev/work-until-done.sh` | E2E tests for bash scripts | ✅ **Rewritten** as TypeScript tests |

**Category B: Workflow Path References (NOT killed by F004-R)**

| Source File | Dependency | What It Does | Post-F004-R Status |
|-------------|-----------|--------------|-------------------|
| [specify.ts](file:///Users/gonzo/Code/gwrk/src/commands/specify.ts) L37 | `.agents/workflows/gwrk-specify.md` | Workflow doc passed to LLM | ⚠️ **Remains** — LLM needs the reasoning program |
| [plan.ts](file:///Users/gonzo/Code/gwrk/src/commands/plan.ts) L78 | `.agents/workflows/gwrk-plan.md` | Workflow doc passed to LLM | ⚠️ **Remains** |
| [tests-generate.ts](file:///Users/gonzo/Code/gwrk/src/commands/tests-generate.ts) L73 | `.agents/workflows/gwrk-define-tests.md` | Workflow doc passed to LLM | ⚠️ **Remains** |
| [tasks-generate.ts](file:///Users/gonzo/Code/gwrk/src/commands/tasks-generate.ts) L337 | `.agents/workflows/gwrk-author-gates.md` | Gate authoring workflow passed to LLM | ⚠️ **Remains** |
| [invocation-strategy.ts](file:///Users/gonzo/Code/gwrk/src/server/backends/invocation-strategy.ts) L24 | `.agents/workflows/gwrk-implement.md` | Implementation workflow passed to LLM | ⚠️ **Remains** |
| [agent.ts](file:///Users/gonzo/Code/gwrk/src/utils/agent.ts) L264 | `.agents/workflows/gwrk-implement.md` | Default workflow path for agent dispatch | ⚠️ **Remains** |

**Category C: Governance & Scaffolding (structural, by design)**

| Source File | Dependency | What It Does | Post-F004-R Status |
|-------------|-----------|--------------|-------------------|
| [context.ts](file:///Users/gonzo/Code/gwrk/src/server/context.ts) L13, L28 | `.agents/rules/`, `.agents/prompts/personas/` | Server loads governance rules for agent context | ⚠️ **By design** — governance is the product |
| [init.ts](file:///Users/gonzo/Code/gwrk/src/commands/init.ts) L92-93, L185, L242 | `.agents/workflows`, `.agents/rules` | `gwrk init` scaffolds these dirs for new projects | ⚠️ **Foundational** — this IS the init behavior |
| [skill-runtime.ts](file:///Users/gonzo/Code/gwrk/src/plugins/skill-runtime.ts) L119 | `.agents/skills/` | Symbolic path for skill logging | 🟢 **Cosmetic** — skills already migrated to `~/.gwrk/plugins/skills/` by F014 |

#### The Key Insight: `.agents/` Is Not Going Away

The `.agents/` workflows are **not idiosyncratic implementation baggage** — they are the product's **domain knowledge layer**. When `gwrk specify 003-feature` runs:

1. gwrk determines the agent backend (Gemini, Claude, etc.)
2. gwrk passes `.agents/workflows/gwrk-specify.md` as the reasoning program
3. The LLM reads the workflow and executes the spec-creation steps
4. The LLM produces `specs/003-feature/spec.md`

The workflow file IS the prompt engineering. It's what makes `gwrk specify` produce good specs instead of generic ones. Joe, Lance, and Bert will need these workflows — they're not Gonzo-specific magic. They're the Foxtrot Charlie methodology encoded as LLM instructions.

**What F014 Layer 2.5 (WorkflowRuntime) will eventually do:** Replace the "pass .md file to LLM" pattern with structured JSON intents. The LLM will produce JSON intents → `WorkflowRuntime` executes them natively → LLM never directly mutates the filesystem. But Layer 2.5 is **not implemented yet** and is not on the immediate critical path.

#### What About F005?

F005 (Parallel Dispatch) enables multi-task concurrent execution with worktree sandboxes. It does NOT remove any `.agents/` dependencies. F005 is about execution topology (how many agents, where they run), not about the workflow content they consume.

### Recommendation

**Standalone verdict: Conditional YES.**

After F004-R completes:
- ✅ bash scripts are no longer spawned — gwrk runs natively as TypeScript
- ✅ `scripts/dev/work-until-done.sh` and `define-until-solid.sh` can be archived
- ⚠️ `.agents/workflows/` remain required — but they're **portable project scaffolding**, not local hacks
- ⚠️ `.agents/rules/` remain required — governance rules are the product
- ⚠️ `.agents/skills/` are irrelevant for contributors — skills live in `~/.gwrk/plugins/skills/` per F014

**For Joe/Lance/Bert:** When they run `gwrk init` on their project, gwrk scaffolds `.agents/workflows/` and `.agents/rules/` for them. This is normal — it's like `eslint init` creating `.eslintrc`. The workflows ARE the methodology.

**F005 is not required for shareability.** Parallel dispatch is a power feature. Single-task sequential dispatch (`gwrk ship`) works fine without F005.

---

## Q3: What Onboarding Documentation Is Required?

### Findings

#### Current Documentation Inventory

| Document | Exists | Audience | Onboarding Value | Status |
|----------|--------|----------|-----------------|--------|
| [README.md](file:///Users/gonzo/Code/gwrk/README.md) | ✅ | New visitors | ❌ Stale, internal, not a quick start | Needs complete rewrite |
| [WHAT_IS_GWRK.md](file:///Users/gonzo/Code/gwrk/docs/WHAT_IS_GWRK.md) | ✅ | Stakeholders | 🟡 Good thesis/philosophy, stale tech details | Needs tech stack update |
| [GWRK-PRD-PRFAQ.md](file:///Users/gonzo/Code/gwrk/docs/GWRK-PRD-PRFAQ.md) | ✅ | PM/strategy | 🟡 Comprehensive, deep internal document | Not immediate onboarding |
| [architecture.md](file:///Users/gonzo/Code/gwrk/docs/architecture.md) | ✅ | Engineers | ✅ Current (v5.0, 850 lines) | Authoritative reference |
| DEVELOPMENT.md | ❌ | Contributors | — | **Missing** |
| CONTRIBUTING.md | ❌ | Contributors | — | **Missing** |
| `gwrk --help` | ✅ | Users | 🟡 Exists but may not be complete | Needs audit |
| [foxtrot-charlie.md](file:///Users/gonzo/Code/gwrk/docs/foxtrot-charlie.md) | ✅ | Everyone | 🟡 Philosophy, needed for "why" | Reference |
| ADR-001 through ADR-006 | ✅ | Deep contributors | ✅ Well-maintained | Reference |

#### What's Missing

**1. README.md (complete rewrite needed)**

Current README is a repository audit document, not an onboarding tool. For Joe/Lance/Bert it needs:
- One-paragraph "what is this" (not 267 lines of WHAT_IS_GWRK.md — one paragraph)
- Prerequisites (Node 20+, pnpm, at least one agent CLI installed)
- Install steps (`pnpm install -g @gwrk/cli` or clone + link)
- "Hello world" flow (`gwrk init` → `gwrk specify` → `gwrk plan` → `gwrk ship`)
- Link to DEVELOPMENT.md for contributors
- Link to architecture.md for deep dives

**2. DEVELOPMENT.md (does not exist)**

Principal engineers contributing need:
- Clone + build + test (`git clone`, `pnpm install`, `pnpm build`, `pnpm test`)
- Project structure walkthrough (what's in `src/commands/`, `src/server/`, `src/engine/`, `src/plugins/`)
- How to run the dev server (`gwrk server start`)
- How to run a single feature through the pipeline
- Spec-first contribution model (don't code without spec + plan)
- `.gwrkrc.json` configuration reference
- Agent CLI setup (which CLIs, how to configure)
- Common gotchas (fail-fast config, no graceful defaults, `.agents/` is generated scaffolding)

**3. CONTRIBUTING.md (does not exist)**

For contribution governance:
- Branch naming conventions (from architecture.md §9)
- PR process
- Testing requirements (vitest, gate scripts)
- Code style (Biome, TypeScript only, no `.js`)
- The Foxtrot Charlie model (link to docs)

### Recommendation

**Priority order for onboarding documentation:**

1. **README.md rewrite** — Gate 0. This is the first thing they see.
2. **DEVELOPMENT.md creation** — Gate 1. How to build, run, test, contribute.
3. **CONTRIBUTING.md creation** — Gate 2. Contribution standards.
4. **WHAT_IS_GWRK.md tech stack fix** — Nice-to-have. Update Docker → worktrees.
5. **Makefile cleanup** — Remove dead Docker targets, add useful dev targets.

---

## Output Contract Deliverables

### Deliverable 1: Drift Inventory for F000–F003

See [Q1 Drift Inventory table](#drift-inventory) above. 13 items identified across 4 severity levels.

### Deliverable 2: `.agents/` Dependency Map

See [Q2 Dependency Map tables](#the-agents-dependency-map) above. Three categories:
- **Category A (4 items):** Bash script spawning — killed by F004-R ✅
- **Category B (6 items):** Workflow path references — remain by design ⚠️
- **Category C (3 items):** Governance & scaffolding — structural, foundational ⚠️

### Deliverable 3: Standalone Readiness Verdict

**Conditional YES.** gwrk becomes standalone-useful after:
1. ✅ F004-R completes (DispatchOrchestrator replaces bash scripts)
2. ✅ README.md is rewritten for onboarding
3. ✅ DEVELOPMENT.md is created

**Not required for standalone:**
- F005 (Parallel Dispatch) — power feature, not prerequisite
- F014 Layer 2.5 (WorkflowRuntime) — future optimization of workflow delivery
- Docker code removal — cleanup, not functional blocker
- PRD updates — internal strategic doc, not user-facing

**Honest caveat for Joe/Lance/Bert:** `.agents/` is part of the product, not a hack. `gwrk init` creates it. The workflows are the methodology encoded as LLM instructions. This is how gwrk knows how to produce specs, plans, and implementations. It's analogous to Next.js including `pages/` or Rails including `app/` — it's scaffolding with opinions.

### Deliverable 4: Onboarding Documentation Gap Analysis

| Document | Status | Priority | Effort | Blocker? |
|----------|--------|----------|--------|----------|
| README.md | ❌ Stale | P0 | ~2h | Yes — first impression |
| DEVELOPMENT.md | ❌ Missing | P0 | ~3h | Yes — can't contribute without it |
| CONTRIBUTING.md | ❌ Missing | P1 | ~1h | No — can share conventions verbally initially |
| WHAT_IS_GWRK.md | 🟡 Stale tech | P2 | ~1h | No — philosophy is fine, tech details are secondary |
| Makefile cleanup | 🟡 Dead targets | P2 | ~30m | No — cosmetic |
| Dockerfile.sandbox removal | 🟡 Dead artifact | P3 | ~15m | No — cosmetic |
| `dockerode` removal | 🟡 Dead dep | P3 | ~30m | No — cosmetic |

---

## Spec Alignment Notes

This research does not consume into a spec — it informs documentation work. Specifically:

1. **README.md** should be rewritten as a contributor-first onboarding document, not a repository audit.
2. **DEVELOPMENT.md** should be created covering build, test, project structure, dev server, contribution model.
3. **CONTRIBUTING.md** should codify the Foxtrot Charlie contribution workflow.
4. **Post-F004-R:** `scripts/dev/` section should be removed from README project structure. The "Orchestration & Governance" heading should describe the TypeScript DispatchOrchestrator, not bash scripts.

## Architecture Amendments

None required. Architecture.md v5.0 is current. The drift is in downstream documents (README, WHAT_IS_GWRK, PRD, Makefile), not in the authoritative architecture spec.

## Open Items

| # | Item | Requires Decision |
|---|------|------------------|
| 1 | Should `scripts/dev/` bash scripts be **deleted** after F004-R, or archived in a `scripts/legacy/` directory? | PM decision — deletion is cleaner for new contributors; archive preserves history for lineage documentation |
| 2 | Should `.agents/` be renamed to something less "internal-sounding" for external contributors? (e.g., `.gwrk/workflows/` or just keeping `.agents/`) | PM decision — `.agents/` is established in the codebase and architecture docs |
| 3 | The PRD (1,593 lines) contains extensive Docker references. Full update is significant effort. Should this be deferred entirely or partially updated? | PM decision — internal doc, may not need update for first-share |
| 4 | F004-R is being worked on by another agent. Is there a target completion date that gates the share timeline? | Coordination question |

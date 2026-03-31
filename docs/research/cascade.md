# Cascade Plan — Wave 4 Research → Specification → Implementation

> **Status:** Active — Stages 1–3 complete, R004 decisions locked, F004-R P5 landed
> **Initiatives:** R001 ✅, R002 ✅, R003 ✅, **R004 (Shareability Readiness) ✅**
> **Downstream:** F005 spec ✅, F011 spec ✅, F014 spec ✅, **F014-R rework** 🟡, architecture.md v5.0 ✅

---

## Pipeline

```
R001 brief ──→ /research ──→ R001 draft ──→ PM review ──→ publish to docs/reference/
R002 brief ──→ /research ──→ R002 draft ──→ PM review ──→ publish to docs/reference/
R004 brief ──→ /research ──→ R004 draft ──→ PM review ──→ F014-R rework scope
                                                              │
                          ┌───────────────────────────────────┘
                          ▼
              architecture.md v5.0 (amendments from R001 + R002)
                          │
          ┌───────────────┼───────────────┼───────────────┐
          ▼               ▼               ▼               ▼
     F004 spec       F005 spec       F014 spec       F011 spec
     (rework)        (rewrite)       (L1/L2.5 exp)   (polish)
          │               │               │
          ▼               │           F014-R spec ←── R004 decisions
     F004-R P5 ✅         │          (Layer 2.5 rework)
     ShipOrchestrator     │               │
                          ▼               ▼               ▼
                     define plan     define plan     define plan
                     define tasks    define tasks    define tasks
                     define tests    define tests    define tests
                          │               │               │
                          ▼               ▼               ▼
                     gwrk ship       gwrk ship       gwrk ship
```

---

## Stage 1: Research Execution

| Initiative | Execute | Output | Status |
|---|---|---|---|
| R001 | `/research docs/research/R001-parallel-dispatch` | `R001-parallel-dispatch/draft.md` | ✅ **Complete** (v3, all items resolved) |
| R002 | `/research docs/research/R002-agent-backend-plugin` | `R002-agent-backend-plugin/draft.md` | ✅ **Complete** (all 5 open items resolved) |
| **R004** | `/research docs/research/R004-shareability-readiness` | `R004-shareability-readiness/draft.md` | ✅ **Complete** (2026-03-31, all decisions locked) |

**Parallelizable:** Yes — R001 and R002 have no dependencies on each other. Can be dispatched to separate agents simultaneously.

**Review gate:** PM reviews each draft. Approves, requests revision, or flags "Requires Decision" items. Draft does not publish until approved.

**Publish:** Approved draft moves to:
- R001 → `docs/reference/parallel-dispatch-architecture.md`
- R002 → `docs/reference/agent-backend-plugin-design.md`
- R004 → remains at `docs/research/R004-shareability-readiness/draft.md` (informs F014-R spec directly)

**Additional deliverables:**
- (R001) `docs/reference/codex-cloud-research-report.md` — Comprehensive Codex Cloud reference (separate feature, not F005).
- (R002) 13 FRs for F014 spec expansion (FR-L1-001 through FR-L1-013), 4 sample agent manifests (Claude, Codex local, Codex Cloud, Gemini), plugin packaging decision (hybrid: built-in + git-native), scaffolding command (`gwrk plugin create agent`), compilation model (hybrid: adapter TS compiled, manifest YAML runtime).
- **(R004)** F014 implementation audit, F014-R rework scope (25-40 SP), workflow classification (10 core, 3 excluded), directory model confirmation, DefineOrchestrator requirement.

---

## Stage 2: Architecture Update

**Trigger:** Both R001 and R002 published. ✅ **Complete** (2026-03-19).

**Action:** Updated `docs/architecture.md` to v5.0 with:
- R001 amendments: §1 overview diagram (worktrees replace Docker), §4 project structure (.runs/sandboxes/), §6.1 dispatch boundary (hexagonal `gwrk ship`), §6.2 sandbox model (worktrees), §8 config (parallelism), §10 tech stack
- R001 key decisions: merge = GitHub PR + Harvest (no AsyncMutex), dispatch calls `gwrk ship` (not WUD), Docker to backlog, Codex Cloud = separate feature
- R002 amendments: §7.2 agent manifest schema + compilation model, §7.3 governance sync mechanics + boundary markers, §7.5 resolution order + plugin authoring, §8 config contract updates, §14 provisioning matrix (`.gwrk/agent-context.md`)
- R002 key decisions: built-in adapters in `src/plugins/builtins/agents/` (hybrid compilation), `gwrk plugin create agent <name>` (single namespace), git-native distribution + `.gwrk-source.json`, declarative manifest-driven dispatch as default

**Pre-implementation cleanup:** ✅ `agent.ts` L72–84: fabricated `codex run --cloud` replaced with fail-fast throw.

**Review gate:** ✅ Architecture.md v5.0 applied.

---

## Stage 2.5: Spec Ambiguity Resolution

**Trigger:** Peer-review of specifications revealed critical fractures in system boundaries. ✅ **Complete** (2026-03-19).

**Outputs:**
- [`docs/reference/wave-4-spec-audit.md`](file:///Users/gonzo/Code/gwrk/docs/reference/wave-4-spec-audit.md) (Consolidated diagnostic report + architectural consensus)

**Key Architectural Consensus Enforced:**
1. **F005 Merge Ownership:** Orchestrator scope ends at PR creation. No merge locking/conflict resolution.
2. **F011 Harvest Trigger:** Harvest MUST trigger on a Phase Rollup PR, ignoring individual Sandbox `feat/*` PRs.
3. **F005 Cloud Paradox:** Cloud Agents (`github-integration`) explicitly deferred entirely out of F005 MVP Phase 1.
4. **F014 Config Isolation:** Agent plugins MUST strictly confine config mutation within the sandbox `projectRoot`.
5. **Workflow Execution Paradigm (F014/F004):** Workflows are structurally distinct from Skills. The LLM must NEVER directly mutate the filesystem. Workflows produce structured JSON Intents executed natively by `WorkflowRuntime`.
6. **Orchestrator Eradication (F004/Core):** Bash state machines (`scripts/dev/define-until-solid.sh` and `work-until-done.sh`) must be removed to break IDE sandbox dependency and replaced by a native TypeScript `DispatchOrchestrator`.

---

## Stage 2.6: Shareability Readiness Assessment (R004)

**Trigger:** Pre-share audit of gwrk for principal engineer onboarding. ✅ **Complete** (2026-03-31).

**Outputs:**
- [`docs/research/R004-shareability-readiness/draft.md`](file:///Users/gonzo/Code/gwrk/docs/research/R004-shareability-readiness/draft.md) (Implementation audit + rework scope)

**Critical Finding:** F014 shipped plugin infrastructure (loader, manifest, skill runtime, agent backends) but did NOT internalize workflows. Every CLI command hardcodes `.agents/workflows/` paths pointing to personal files that don't ship with gwrk. `gwrk init` creates placeholder files. WorkflowRuntime (Layer 2.5, FR-L25-001/002/003) was specified but never implemented.

**PM Decisions (Locked):**

1. **F014 rework addendum** — proper spec, plan, tests, tasks. Not a new feature.
2. **Full WorkflowRuntime (Path B)** — no half-measures. JSON intent execution engine, not raw markdown file bundling. Debt on the critical path compounds forever.
3. **Workflow classification:**
   - Core builtins (8): specify, plan, implement, define-tests, author-gates, plan-to-tasks, review-code, review-uat
   - Ship (beta/alpha): research, build-plan
   - Fold into parents (not standalone): checklist → specify/plan, analyze → specify/plan
   - Excluded: effort (not ready), cascade-sync (personal), constitution (personal)
4. **Skills ship separately** — not as builtins. Requires a new feature.
5. **DefineOrchestrator** mirrors ShipOrchestrator (TypeScript state machine). Replaces `define-until-solid.sh`.
6. **Directory model confirmed** per ADR-006: `~/.gwrk/` = global home (plugins, skills, workflows). `.gwrk/` = project-local overrides only. `.agents/` = never part of gwrk.
7. **`scripts/dev/`** — gitignore and `git rm --cached`. Don't delete.

**Impact on Critical Path:**

F014-R is now a hard blocker for shareability. Estimated scope: 25-40 SP across 6 work items:
- WorkflowRuntime engine (8-13 SP)
- Core workflow plugins as builtins (5-8 SP)
- CLI command rewiring off `.agents/` paths (3-5 SP)
- `gwrk init` overhaul (2-3 SP)
- DefineOrchestrator (5-8 SP)
- Governance defaults as builtins (2-3 SP)

---

## Stage 3: Specification Alignment

**Trigger:** Architecture.md v5.0 approved & Ambiguity remediated. ✅ **Ready**.

| Spec | Action | Draws From | Scope |
|---|---|---|---|
| **F004** | Rework | R002 Remediation Plan, plugin-strategy-audit | **P5 LANDED** (ShipOrchestrator). Remaining: DefineOrchestrator (from R004), `--legacy` removal, `scripts/dev/` archival. |
| **F005** | Rewrite | R001, ADR-006, F004 contracts, Ambiguity Remediation | Replace F008 refs, add `TaskDispatch/TaskResult`, new sandbox model, align DM-001 with F004 manifests **+ Delete FR-004/007/US-003 (merge locks) + Defer Cloud Agents to Tier 3.** |
| **F014** | Expand + **Rework** | R002, R004, ADR-006, skills-architecture.md, Ambiguity Remediation | L1 FRs shipped ✅. **F014-R: Implement Layer 2.5 (WorkflowRuntime), ship 10 core workflows as builtins, rewire CLI commands, overhaul `gwrk init`.** |
| **F011** | Polish | Architecture.md v5.0, Ambiguity Remediation | Add optional F015 event hooks. Reference `dispatchToAgent()` results in FR-H03. **+ Update FR-H01 trigger logic to ignore Sandbox PRs and require Phase completion.** |

**Method:** Use `gwrk define spec` or manual rewrite. Each spec goes through PM review before define pipeline.

---

## Stage 4: Define Pipeline

**Trigger:** All specs approved.

For each of F005, F011, F014-R:
```bash
gwrk define plan <feature>       # plan.md + contracts/
gwrk define tests <feature>      # gap-matrix.md + *.test.ts (RED)
gwrk define tasks <feature>      # tasks.json + gates/ (vitest gates reference test files)
```

**Review gate:** PM reviews plan.md for each. Contracts reviewed against spec FRs.

---

## Stage 5: Implementation

**Trigger:** Define pipeline complete, all gates verified RED.

**Order recommendation (updated post-R004):**
1. **F014-R** (WorkflowRuntime + Core Workflows + CLI Rewiring) — **shareability blocker**. Must complete before gwrk can be shared. 25-40 SP.
2. **F004-R remaining** (DefineOrchestrator + `scripts/dev/` archival) — completes bash eradication. Depends on F014-R for workflow delivery.
3. **F011** (Harvest) — small, self-contained, high visibility
4. **F005** (Parallel Dispatch) — highest complexity, benefits from F014-R being in place

**Post-implementation (pre-share):**
- README.md rewrite (~2h)
- DEVELOPMENT.md creation (~3h)
- Docker cleanup: remove `docker.ts`, `dockerode` dep, dead Makefile targets (~1h)
- `scripts/dev/` → `.gitignore` + `git rm --cached` (~15m)

**Method:** `gwrk ship <feature> <phase>` or `/implement` workflow.

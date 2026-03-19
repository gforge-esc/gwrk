# Cascade Plan — Wave 4 Research → Specification → Implementation

> **Status:** Active — Stages 1–3 complete, Stage 4 ready
> **Initiatives:** R001 (Parallel Dispatch Architecture) ✅, R002 (Agent Backend Plugin Design) ✅
> **Downstream:** F005 spec ✅, F011 spec ✅, F014 spec ✅, architecture.md v5.0 ✅

---

## Pipeline

```
R001 brief ──→ /research ──→ R001 draft ──→ PM review ──→ publish to docs/reference/
R002 brief ──→ /research ──→ R002 draft ──→ PM review ──→ publish to docs/reference/
                                                              │
                          ┌───────────────────────────────────┘
                          ▼
              architecture.md v5.0 (amendments from R001 + R002)
                          │
          ┌───────────────┼───────────────┼───────────────┐
          ▼               ▼               ▼               ▼
     F004 spec       F005 spec       F014 spec       F011 spec
     (rework)        (rewrite)       (L1/L2.5 exp)   (polish)
          │               │               │               │
          ▼               ▼               ▼
     define plan     define plan     define plan     define plan
     define tasks    define tasks    define tasks    define tasks
     define tests    define tests    define tests    define tests
          │               │               │
          ▼               ▼               ▼
     gwrk ship       gwrk ship       gwrk ship       gwrk ship
```

---

## Stage 1: Research Execution

| Initiative | Execute | Output | Status |
|---|---|---|---|
| R001 | `/research docs/research/R001-parallel-dispatch` | `R001-parallel-dispatch/draft.md` | ✅ **Complete** (v3, all items resolved) |
| R002 | `/research docs/research/R002-agent-backend-plugin` | `R002-agent-backend-plugin/draft.md` | ✅ **Complete** (all 5 open items resolved) |

**Parallelizable:** Yes — R001 and R002 have no dependencies on each other. Can be dispatched to separate agents simultaneously.

**Review gate:** PM reviews each draft. Approves, requests revision, or flags "Requires Decision" items. Draft does not publish until approved.

**Publish:** Approved draft moves to:
- R001 → `docs/reference/parallel-dispatch-architecture.md`
- R002 → `docs/reference/agent-backend-plugin-design.md`

**Additional deliverables:**
- (R001) `docs/reference/codex-cloud-research-report.md` — Comprehensive Codex Cloud reference (separate feature, not F005).
- (R002) 13 FRs for F014 spec expansion (FR-L1-001 through FR-L1-013), 4 sample agent manifests (Claude, Codex local, Codex Cloud, Gemini), plugin packaging decision (hybrid: built-in + git-native), scaffolding command (`gwrk plugin create agent`), compilation model (hybrid: adapter TS compiled, manifest YAML runtime).

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

## Stage 3: Specification Alignment

**Trigger:** Architecture.md v5.0 approved & Ambiguity remediated. ✅ **Ready**.

| Spec | Action | Draws From | Scope |
|---|---|---|---|
| **F004** | Rework | R002 Remediation Plan, plugin-strategy-audit | **CRITICAL UPDATE**: Refactor `work-until-done.sh` and `define-*` shell scripts into native TypeScript `DispatchOrchestrator`. Prepare architecture to consume `WorkflowRuntime` JSON intent execution. |
| **F005** | Rewrite | R001, ADR-006, F004 contracts, Ambiguity Remediation | Replace F008 refs, add `TaskDispatch/TaskResult`, new sandbox model, align DM-001 with F004 manifests **+ Delete FR-004/007/US-003 (merge locks) + Defer Cloud Agents to Tier 3.** |
| **F014** | Expand | R002, ADR-006, skills-architecture.md, Ambiguity Remediation | Add L1 FRs (Agent manifest, governance sync). **+ Add Layer 2.5 FRs (WorkflowRuntime, JSON Schema Output Contracts). + Add Strict Isolation Rule.** |
| **F011** | Polish | Architecture.md v5.0, Ambiguity Remediation | Add optional F015 event hooks. Reference `dispatchToAgent()` results in FR-H03. **+ Update FR-H01 trigger logic to ignore Sandbox PRs and require Phase completion.** |

**Method:** Use `gwrk define spec` or manual rewrite. Each spec goes through PM review before define pipeline.

---

## Stage 4: Define Pipeline

**Trigger:** All three specs approved.

For each of F005, F011, F014:
```bash
gwrk define plan <feature>       # plan.md + contracts/
gwrk define tasks <feature>      # tasks.json + gates/
gwrk define tests <feature>      # gap-matrix.md + *.test.ts (RED)
```

**Review gate:** PM reviews plan.md for each. Contracts reviewed against spec FRs.

---

## Stage 5: Implementation

**Trigger:** Define pipeline complete, all gates verified RED.

**Order recommendation:**
1. **F014 P1–P2** (Plugin Loader + Skill Runtime) — keystone infrastructure
2. **F011** (Harvest) — small, self-contained, high visibility
3. **F005** (Parallel Dispatch) — highest complexity, benefits from F014 being in place
4. **F014 P3** (Agent Backend Adapters) — needs real dispatch experience from F005

**Method:** `gwrk ship <feature> <phase>` or `/implement` workflow.

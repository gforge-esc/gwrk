# Cascade Plan — Wave 4 Research → Specification → Implementation

> **Status:** Active — R001 complete, R002 in progress
> **Initiatives:** R001 (Parallel Dispatch Architecture) ✅, R002 (Agent Backend Plugin Design)
> **Downstream:** F005 spec, F011 spec, F014 spec, architecture.md v5.0

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
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
     F005 spec       F014 spec       F011 spec
     (rewrite)       (L1 expand)     (polish)
          │               │               │
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
| R002 | `/research docs/research/R002-agent-backend-plugin` | `R002-agent-backend-plugin/draft.md` | 🟡 In progress |

**Parallelizable:** Yes — R001 and R002 have no dependencies on each other. Can be dispatched to separate agents simultaneously.

**Review gate:** PM reviews each draft. Approves, requests revision, or flags "Requires Decision" items. Draft does not publish until approved.

**Publish:** Approved draft moves to:
- R001 → `docs/reference/parallel-dispatch-architecture.md`
- R002 → `docs/reference/agent-backend-plugin-design.md`

**Additional deliverable (from R001):**
- `docs/reference/codex-cloud-research-report.md` — Comprehensive Codex Cloud reference (separate feature, not F005). Covers environments, codex-universal image, pricing, security, gwrk integration architecture.

---

## Stage 2: Architecture Update

**Trigger:** Both R001 and R002 published.

**Action:** Update `docs/architecture.md` to v5.0 with:
- R001 amendments: §1 overview diagram (worktrees replace Docker), §4 project structure (.runs/sandboxes/), §6.1 dispatch boundary (hexagonal `gwrk ship`), §6.2 sandbox model (worktrees), §8 config (parallelism), §10 tech stack
- R001 key decisions: merge = GitHub PR + Harvest (no AsyncMutex), dispatch calls `gwrk ship` (not WUD), Docker to backlog, Codex Cloud = separate feature
- R002 amendments: §7.2 agent manifest schema, §7.3 governance sync mechanics, §8 config contract updates

**Review gate:** PM reviews architecture.md v5.0 diff.

---

## Stage 3: Specification Alignment

**Trigger:** Architecture.md v5.0 approved.

| Spec | Action | Draws From | Scope |
|---|---|---|---|
| **F005** | Rewrite | R001, ADR-006, F004 contracts | Replace F008 refs, add `TaskDispatch/TaskResult`, new sandbox model, align DM-001 with F004 manifests |
| **F014** | Expand | R002, ADR-006, skills-architecture.md | Add L1 FRs (agent install, register, dispatch, config check, sync-context). Fix FR-006 hardcoded CLIs. Add `gwrk plugin check` and `gwrk plugin sync-context` FRs. |
| **F011** | Polish | Architecture.md v5.0 | Add optional F015 event hooks. Reference `dispatchToAgent()` results in FR-H03. Minor. |

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

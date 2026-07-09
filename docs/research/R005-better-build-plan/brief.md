# R005 — Active Build Planning
status: COMPLETED

> **Status:** Brief — Ready for Research Execution
> **Initiated:** 2026-04-02
> **Consumer:** F018 (Build Plan Orchestrator spec), architecture.md amendments, 000-build-plan.md rework

---

## Problem Statement

`specs/000-build-plan.md` is a passive markdown scratchpad. It drifts from reality because nothing actively maintains it. Phase completion doesn't update it. Rework discovery doesn't trigger re-planning. Status markers decay silently. Research outcomes require manual cascade. The build plan is supposed to be Foxtrot Charlie's "Internal Roadmap: The Commitment Spine" (Definition Pillar §2) but it has no spine — no state, no automation, no verification, no feedback from the systems it claims to govern.

### Evidence of Failure

1. **Status decay:** F014-R marked 🔴 "Spec pending. Define pipeline not started." while P4/P6/P7 had already shipped. F004 marked ✅ while `stagePrCi()` is a stub.
2. **Manual cascade:** R004 findings required manual propagation into build plan, cascade.md, architecture.md, and feature specs. Each hop introduces lag and error.
3. **No verification:** No system validates that claimed status matches code reality. The gap analysis took human intervention to discover.
4. **Rework blindness:** When agents discover rework (e.g., P4 taking 4+ iterations), the build plan doesn't learn. Effort estimates remain static.
5. **`.agents/` path:** `validate-staging.sh` actively *blocks* agents from modifying the build plan. The very system that could maintain it is firewalled off.

---

## Questions to Answer

### Q1: What does "active build plan" mean?

What are the concrete operations (create, read, update, verify, cascade) that a build plan needs? What triggers each? What are the inputs and outputs? How does this differ from a project management tool (Jira, Linear)?

### Q2: What is the correct state model for build plan items?

Should features/phases/tasks use a formal FSM? What states exist beyond the current ✅/⚠️/🔴/⚫? How does rework (re-opening a completed phase) map? How does "claimed done but actually not" (the gap analysis pattern) map? What about research initiatives that cascade into plan changes?

### Q3: How should the build plan integrate with existing orchestrators?

- **Ship Loop (F004):** After `gwrk ship` completes a phase, what build plan update should fire? What about when ship fails?
- **Harvest (F011):** After PR merge, should harvest verify build plan accuracy as part of "Done, Done!"?
- **Define Pipeline:** When `gwrk define spec/plan/tasks` runs, should the build plan be consulted for dependency ordering?
- **Research Cascade:** When an R-initiative completes, how does it trigger build plan amendments?

### Q4: What coordination patterns exist in prior art?

- **Claude Code (declawed):** Coordinator mode uses Research→Synthesis→Implementation→Verification with parallel workers. How does the "coordinator synthesizes, workers execute" pattern map to build planning?
- **OpenClaw:** Heartbeat-driven proactive agents, SOUL.md/MEMORY.md persistence. What concepts transfer to build plan health monitoring?
- **Temporal:** Durable execution for long-running workflows. Is this the right substrate for build plan state?
- **Claude Code Plan Mode:** Read-only research → execution transition. Should build plan updates have a "plan mode" where changes are proposed but not applied?

### Q5: Where does the build plan live?

Currently it's `specs/000-build-plan.md` — a flat markdown file. Options:
- SQLite table extension (ADR-002)
- Structured YAML/JSON with markdown rendering
- Hybrid: structured state in SQLite, human-readable rendering as markdown
- Build server endpoint (F002) for programmatic access

### Q6: What should agents be allowed to do to the build plan?

Currently `validate-staging.sh` blocks all agent modifications. But if agents run ship/harvest/define, they know things about build plan state that humans don't. What's the right governance model? Read-only? Propose-and-approve? Automated status updates only?

### Q7: How does this relate to Foxtrot Charlie's four pillars?

The build plan spans all four:
- **Discovery:** Research initiatives change the plan
- **Definition:** Spec/plan/tasks define what's in the plan
- **Shipping:** Ship completions update plan status
- **Delivery:** Harvest confirms done-done

How does an active build plan serve as the connective tissue across all four pillars?

---

## Input Documents

### Governance
- [FOXTROT-CHARLIE.md](file:///Users/gonzo/Code/gwrk/docs/FOXTROT-CHARLIE.md) — "Internal Roadmap: The Commitment Spine"
- [architecture.md](file:///Users/gonzo/Code/gwrk/docs/architecture.md) — System architecture, §6 dispatch, §11 project structure

### Existing Build Plan
- [000-build-plan.md](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md) — Current passive build plan (v13)

### Research Precedent
- [R004 shareability readiness](file:///Users/gonzo/Code/gwrk/docs/research/R004-shareability-readiness/draft.md) — Demonstrates gap between claimed and actual state
- [cascade.md](file:///Users/gonzo/Code/gwrk/docs/research/cascade.md) — Research→Spec→Define→Ship pipeline

### Decisions
- [ADR-002](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-002-sqlite-execution-ledger.md) — SQLite execution ledger
- [ADR-003](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md) — Execution state contract
- [ADR-005](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-005-tdd-gate-architecture.md) — TDD gate architecture

### Prior Art (External)
- Claude Code coordinator mode (`/Users/gonzo/Code/declawed/src/coordinator/coordinatorMode.ts`)
- Claude Code task system (`/Users/gonzo/Code/declawed/src/Task.ts`, `src/tasks/`)
- OpenClaw heartbeat/persistence architecture (web research)
- Temporal durable execution patterns (web research)
- LangGraph FSM-based agent orchestration (web research)

### Codebase
- `src/engine/ship-orchestrator.ts` — ShipOrchestrator state machine (existing pattern)
- `src/commands/ship.ts` — Ship command (triggers orchestrator)
- `src/db/index.ts` — SQLite schema (what tables exist)
- `scripts/dev/validate-staging.sh` — Build plan modification blocker
- `.agents/workflows/gwrk-build-plan.md` — Current build-plan workflow (alpha)

---

## Output Contract

1. **Active Build Plan Architecture** — How the system works: data model, state machine, triggers, integrations
2. **Integration Map** — How build plan connects to ship, harvest, define, research, and build server
3. **Governance Model** — What agents can and cannot do to the build plan
4. **Prior Art Synthesis** — What transfers from Claude Code, OpenClaw, Temporal, and LangGraph
5. **FC Alignment Assessment** — How this serves Foxtrot Charlie's four pillars
6. **Feature Scope Recommendation** — What ships as F018 vs. what's incremental improvement to existing features
7. **Spec Alignment Notes** — Amendments needed for architecture.md, 000-build-plan.md, and affected feature specs

---

## Anti-Patterns

- ❌ Building another project management tool (Jira clone)
- ❌ Over-engineering when a structured file + SQLite hooks would suffice
- ❌ Ignoring that the build plan is fundamentally a PM artifact, not a PE artifact
- ❌ Designing a system that requires more ceremony than the current scratchpad
- ❌ Removing human authority over plan ordering and priority
- ❌ Making the build plan "smart" at the expense of being readable

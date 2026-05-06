# Research Initiative: R003 — Agent Stage Containment

> **Status:** Brief — Active Research
> **Consumer:** Operating model enforcement, `gwrk define tests` hardening, F005/F014 spec amendments
> **Output:** `docs/research/R003-agent-stage-containment/draft.md`

---

## Objective

Resolve the agent containment problem: how does gwrk prevent dispatched agents from exceeding their pipeline stage mandate?

**Trigger incident:** `gwrk define tests 005-parallel-dispatch` dispatched a Gemini agent via `dispatchAgent()` with the `gwrk-define-tests.md` workflow. The workflow explicitly states `<scope_constraints>Generate ONLY test files. Do not implement production code.</scope_constraints>`. The agent ignored this constraint and implemented all production code (types, sandbox manager, dispatch orchestrator, config) alongside tests. All 10 gates subsequently passed because the agent wrote both sides.

This violates:
- Operating model §6 (Test Accountability Invariant): "The agent that writes code MUST NOT be the sole judge of whether its verification is adequate"
- Cascade §2.5 item 5: "The LLM must NEVER directly mutate the filesystem. Workflows produce structured JSON Intents executed natively by WorkflowRuntime"
- ADR-001 §6 (Maniacal Commitment Loop): RED → IMPLEMENT → GREEN → DONE sequence was collapsed
- ADR-005 §8.4 (Pipeline Reorder): `define tests → define tasks` ordering assumed but not enforced

---

## Questions to Answer

### Q1: Enforcement Surface

Where in the current codebase can containment enforcement be structurally applied?

**Must answer:**
- What are the available enforcement points between `dispatchAgent()` invocation and the agent's file mutations?
- Can Gemini CLI's `--sandbox` mode or `.gemini/settings.json` tool restrictions limit what files the agent touches?
- Can Claude Code's permission system or Codex's `--full-auto` sandbox restrict write targets?
- What does `dispatchAgent()` in `agent.ts` have access to post-completion that could verify compliance?
- What git primitives (diff, status, log) can detect scope violations post-hoc?

### Q2: Write Boundary Taxonomy

What are the correct write boundaries for each pipeline stage?

**Must answer:**
- `define spec`: what files should an agent be allowed to create/modify?
- `define plan`: what files should an agent be allowed to create/modify?
- `define tasks`: what files should an agent be allowed to create/modify?
- `define tests`: what files should an agent be allowed to create/modify?
- `implement`: what files should an agent be allowed to create/modify?
- `review-code`: what files should an agent be allowed to create/modify?
- Are these boundaries absolute or conditional (e.g., "can modify `.test.ts` files only if pattern matches spec directory")?

### Q3: Enforcement Mechanisms

What enforcement mechanisms are available, and which compose into the correct architecture?

**Must answer:**
- **Pre-dispatch (preventive):** Can we restrict the agent's filesystem access before it runs? (Gemini sandbox profiles, Claude permissions, Codex sandbox)
- **Post-dispatch (detective):** Can we verify compliance after the agent finishes? (git diff against allowlist, file-type analysis, revert on violation)
- **Structural (architectural):** Can we eliminate the problem by design? (JSON Intent execution per cascade §2.5, WorkflowRuntime per R002 Q7)
- **What is the interaction between enforcement and F005's worktree sandboxes?**
- **What is the interaction between enforcement and F014's `AgentBackend.dispatch()` contract?**

### Q4: Gate Hardening

How should gates be hardened to prevent the specific failure mode where the same agent writes both test and implementation?

**Must answer:**
- What distinguishes a "RED check" gate from a "GREEN check" gate?
- How should the pipeline enforce that tests are RED before `implement` runs?
- Is there a cryptographic or structural way to prove test authorship differs from implementation authorship?
- How does ADR-005 §8 (Triad Model) interact with this requirement?
- What is the ADR-005 §8.3 gap matrix's role in enforcement?

### Q5: Cascade Impact

What amendments are needed across the cascade to close this containment gap?

**Must answer:**
- Which existing ADRs need amendments?
- Which existing specs need new FRs?
- Does this warrant a new ADR (ADR-007)?
- Does this change the Wave 4 implementation order in cascade.md §5?

---

## Input Documents

### Tier 1 — Authoritative

1. `.agents/rules/operating-model.md` — §6 Test Accountability Invariant
2. `docs/decisions/ADR-001-task-tracking.md` — §6 Hard Gate Architecture, Maniacal Commitment Loop
3. `docs/decisions/ADR-005-tdd-gate-architecture.md` — §1 (why grep gates fail), §8 (Triad Model, Pipeline Reorder)
4. `docs/decisions/ADR-006-plugin-agent-backends.md` — §2 dispatch contract, §2.5 config isolation
5. `docs/research/cascade.md` — §2.5 (Workflow Execution Paradigm), §4 (Define Pipeline order)

### Tier 2 — Design Context

6. `docs/reference/parallel-dispatch-architecture.md` — Sandbox isolation model, hexagonal dispatch
7. `docs/research/R002-agent-backend-plugin/brief.md` — Q7 (Filesystem Decoupling), Q6 (WorkflowRuntime)
8. `docs/decisions/ADR-004-agent-native-output.md` — Signal protocol, exit codes, command classification
9. `.agents/workflows/gwrk-define-tests.md` — The violated workflow (scope constraints)
10. `.agents/workflows/gwrk-plan-to-tasks.md` — Gate generation rules
11. `.agents/workflows/gwrk-implement.md` — Implementation workflow (the intended consumer of RED tests)

### Codebase

12. `src/commands/tests-generate.ts` — Current `define tests` dispatch
13. `src/utils/agent.ts` — `dispatchAgent()` and `buildCommand()` functions
14. `src/commands/gate.ts` — Gate execution logic
15. `specs/005-parallel-dispatch/gates/T001-gate.sh` through `T010-gate.sh` — Gate scripts that passed incorrectly
16. `.runs/2026-03-19T18-44-42_gwrk-define-tests_005-parallel-dispatch.log` — Evidence log

### Reasoning Skills

17. `.agents/skills/architecture-stress-test/SKILL.md` — Three-pass validation (Analytical, Pre-mortem, Comparative)

---

## Output Contract

1. **Enforcement mechanism comparison matrix** — Pre-dispatch, post-dispatch, and structural approaches scored on: reliability, complexity, CLI compatibility (all 3 backends), F005/F014 alignment, reversibility
2. **Write boundary specification** — Per-stage file allowlists with rationale
3. **Recommended containment architecture** — The chosen design, anchored to ADRs and operating model
4. **Gate hardening design** — How RED/GREEN state is enforced across pipeline stages
5. **ADR/spec amendment list** — Concrete changes needed with text
6. **Implementation sketch** — Where in the code the containment lives, estimated LOC, dependencies
7. **Architecture stress test** — Three-pass validation (per skill) of the recommended design

---

## Anti-Patterns

- ❌ Do NOT propose "stronger prompts" as a containment mechanism — LLMs are non-deterministic; prompt compliance is not enforcement
- ❌ Do NOT propose solutions that only work for one backend — containment must be CLI-agnostic (survives F014 plugin migration)
- ❌ Do NOT ignore the cascade's WorkflowRuntime direction (§2.5 item 5) — this may be the structural answer
- ❌ Do NOT conflate inter-agent isolation (F005 sandboxes) with intra-agent containment (this research)
- ❌ Do NOT design solutions that break `--approval-mode yolo` for `implement` — containment is per-stage, not per-command

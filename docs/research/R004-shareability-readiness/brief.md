# R004 — Shareability Readiness Assessment

> **Status:** Active
> **Consumer:** README.md rewrite, DEVELOPMENT.md creation, onboarding docs
> **Motivation:** Share gwrk with Joe, Lance, and Bert (principal engineers) after F004-R + F005 complete

---

## Questions to Answer

1. **What remains in F000–F003 that needs rework before gwrk is shareable?** Identify stale documentation, dead code, broken references, and architectural drift from current state.

2. **Will completion of F004-R (DispatchOrchestrator) and F005 (Parallel Dispatch) make gwrk standalone — no longer dependent on `.agents/` workflows and skills?** Trace every runtime dependency on `.agents/`, `scripts/dev/`, and `.specify/` and assess which are eliminated by F004-R/F005/F014.

3. **What onboarding documentation is required for three principal engineers to get started and contribute?** Audit existing docs for contributor-readiness. Identify what's missing.

---

## Input Documents

- `specs/000-build-plan.md`
- `docs/architecture.md`
- `docs/research/cascade.md`
- `README.md`
- `docs/WHAT_IS_GWRK.md`
- `docs/GWRK-PRD-PRFAQ.md`
- `package.json`
- `Makefile`

## Codebase

- `src/commands/ship.ts` — bash script spawning
- `src/commands/define.ts` — bash script spawning
- `src/commands/specify.ts` — workflow path references
- `src/commands/plan.ts` — workflow path references
- `src/commands/implement.ts` — script references
- `src/commands/tests-generate.ts` — workflow path references
- `src/commands/tasks-generate.ts` — workflow path references
- `src/commands/init.ts` — .agents/ scaffolding
- `src/utils/agent.ts` — workflow dispatch
- `src/plugins/skill-runtime.ts` — skills reference
- `src/server/context.ts` — governance loading
- `src/server/docker.ts` — Docker lifecycle
- `src/server/backends/invocation-strategy.ts` — workflow references
- `.agents/workflows/` — all 15 workflows
- `.agents/skills/` — all 9 skills
- `.agents/rules/` — operating model + workspace rules
- `scripts/dev/` — all bash orchestrators

## Output Contract

1. **Drift Inventory for F000–F003** — table of stale/broken items with severity and fix category
2. **`.agents/` Dependency Map** — every runtime dependency with post-F004-R/F005/F014 status
3. **Standalone Readiness Verdict** — binary yes/no with conditions
4. **Onboarding Documentation Gap Analysis** — what exists, what's missing, priority order

## Anti-Patterns

- ❌ Speculate about F004-R implementation details — it's in progress by another agent
- ❌ Design the README or DEVELOPMENT.md — this research informs their creation
- ❌ Make architectural decisions about `.agents/` migration path

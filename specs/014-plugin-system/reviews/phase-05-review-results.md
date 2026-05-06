# Code Review: 014 Plugin System - Phase 05

## Governance Audit: 014 Plugin System

### Traceability Matrix

| Requirement | Spec | Plan | Tasks | Contracts | Gates | Status |
|------------|---------|---------|----------|-------------|----------|--------|
| DefineOrchestrator State Machine | FR-L25-004 | Phase 5 | T028 | contracts/workflow-runtime.md | gates/T028-gate.sh | **PARTIAL** |
| CLI Command Rewiring | FR-L25-003 | Phase 5 | T029 | contracts/workflow-runtime.md | gates/T029-gate.sh | **PASS** |
| TS State Machine transitions | FR-L25-004 | Phase 5 | T030 | - | gates/T030-gate.sh | **PASS** |
| E2E Verification (no .agents/) | VR-013 | Phase 5 | T031 | - | gates/T031-gate.sh | **FAIL** |

### Governance Violations

| # | Rule | Location | Severity | Fix |
|---|------|----------|----------|-----|
| 1 | Spec Match: Full definition loop | src/engine/define-orchestrator.ts | CRITICAL | Implement SPECIFY and PLAN stages in the orchestrator state machine. |
| 2 | Type Safety: No 'any' in critical paths | src/commands/plugin.ts, src/commands/skill.ts | MAJOR | Replace 'any' with Zod-inferred types or explicit interfaces. |
| 3 | Verification Rigor: No mocking of boundaries | src/commands/specify.test.ts | MAJOR | Add integration tests that verify dispatchAgent without mocking WorkflowRuntime. |
| 4 | Dry-Run Mandate | src/engine/define-orchestrator.ts | MINOR | Honor dry-run flag in run() to prevent side-effects. |

### Critical Path to READY

1. **Fix Agent Dispatch**: Resolve the `ENOENT` failure in `src/utils/agent.ts` when handling plugin names (gwrk-specify).
2. **Complete the Loop**: Extend `DefineOrchestrator` to handle `SPECIFY` and `PLAN` stages as defined in the spec.
3. **Harden Verification**: Update tests to use a real (or narrowly-mocked) dispatch boundary to confirm commands work in a clean project.
4. **Type Cleanup**: Eliminate `any` types from the plugin resolution and command handlers.

### Verdict: NOT READY

---

## Task Re-evaluations

### T028: Implement src/engine/define-orchestrator.ts
**STATUS: RE-OPENED**
**Notes**: 
REVIEW FAIL (code): Incomplete implementation — FR-L25-004.
  WHERE: src/engine/define-orchestrator.ts:55-80
  EXPECTED: Orchestrator must manage the full loop: SPEC -> PLAN -> TASKS -> ANALYZE.
  ACTUAL: Implementation starts at PLAN_TO_TASKS, skipping specification and planning.
  FIX: Add stageSpecify and stagePlan methods; update getNextStage and initializeState to start at SPECIFY.
  REF: plan.md Phase 5 > DefineOrchestrator

### T029: Implement src/commands/specify.ts, plan.ts, tasks-generate.ts
**STATUS: RE-OPENED**
**Notes**:
REVIEW FAIL (uat): US-011 - Execute a Built-in Workflow — FR-L25-003.
  WHERE: src/utils/agent.ts:102
  EXPECTED: dispatchAgent resolves built-in workflow names without failing with ENOENT.
  ACTUAL: dispatchAgent attempts to readFileSync plugin names as file paths in the project root.
  FIX: Ensure dispatchAgent skips fs operations if opts.workflowPath is a known plugin name.
  GATE: gates/T029-gate.sh (Assertion #2 — missing)
  REF: plan.md Phase 5 > US-011

### T031: Implement src/commands/specify.test.ts, plan.test.ts
**STATUS: RE-OPENED**
**Notes**:
REVIEW FAIL (tests): Mocking boundary violation — VR-013.
  WHERE: src/commands/specify.test.ts:15-22
  EXPECTED: Integration tests verify the end-to-end path from CLI to Agent Dispatch.
  ACTUAL: WorkflowRuntime is mocked, hiding the ENOENT bug in the underlying utility.
  FIX: Add an integration test that uses the actual WorkflowRuntime and mocks only the child_process.spawn boundary.
  REF: spec.md > VR-013

# Code Review: Phase phase-05 (DefineOrchestrator & CLI Rewiring)

**Status:** 🔴 Needs Revision
**Feature:** 014-plugin-system
**Phase:** phase-05
**Reviewer:** Gemini CLI

## Summary

The implementation of Phase phase-05 is incomplete and significantly diverges from the requirements established in `spec.md` and `plan.md`. While the `WorkflowRuntime` and `IntentEngine` foundations are solid (Phase 4), the orchestration layer (Phase 5) fails to deliver the promised "Full definition loop" and contains several regression risks.

## 🔴 Critical Issues

### 1. Incomplete Orchestration Loop (FR-L25-004)
The `DefineOrchestrator` implementation in `src/engine/define-orchestrator.ts` only handles three stages: `PLAN_TO_TASKS`, `ANALYZE`, and `DEFINE_TESTS`. It explicitly ignores `SPECIFY` and `PLAN` stages:
- The `run()` loop hits a `default` case for these stages and returns `0` (no-op).
- `initializeState()` defaults to `PLAN_TO_TASKS`, making it impossible to run the full `spec -> plan -> tasks` loop as defined in the spec.
- **Impact:** The "Full definition loop" (`gwrk define <feature>`) is a misnomer and fails to deliver the expected automation for new features.

### 2. Missing Resume Logic
The orchestrator implements state persistence via `persistState()` but lacks the corresponding loading logic in the constructor or `run()` method.
- **Impact:** Crash recovery is broken. Every execution of `gwrk define` will restart from the beginning (`PLAN_TO_TASKS`), potentially overwriting previous work or wasting LLM tokens.

### 3. Workflow Prompt Placeholders (SC-006, SC-007)
Several core workflows shipped in `src/plugins/builtins/workflows/` are empty placeholders:
- `gwrk-plan-to-tasks/PROMPT.md`: Contains "(Steps from the original plan-to-tasks workflow)".
- `gwrk-author-gates/PROMPT.md`: Contains "(Steps from the original author-gates workflow)".
- `gwrk-define-tests/PROMPT.md`: Contains "(Steps from the original define-tests workflow)".
- **Impact:** The orchestrator's primary stages are effectively non-functional. The agent will receive an empty/placeholder prompt and fail to produce the required `tasks.json` or test files.

### 4. Broken `ANALYZE` Stage
`DefineOrchestrator.stageAnalyze()` calls `this.runtime.executeWorkflow("gwrk-analyze", ...)`, but no `gwrk-analyze` workflow exists in `builtins/workflows`.
- The code catches the error and logs a warning: `Warning: ANALYZE stage skipped or failed`.
- **Impact:** Consistency checks are silently skipped in the autonomous loop.

## 🟡 Behavioral Inconsistencies

### 1. Divergent Task Generation Logic
There is a major divergence between the standalone command and the orchestrator:
- `gwrk define tasks`: Uses `tasks-generate.ts` (500+ lines of thick TypeScript logic for reconciliation) and calls `gwrk-author-gates` for gates.
- `gwrk define`: Uses `DefineOrchestrator` → `gwrk-plan-to-tasks` (pure LLM workflow).
- **Risk:** These two paths will produce different results for the same feature, leading to instability in `tasks.json`.

### 2. Test Inconsistency (TR-010)
- **Plan:** `TR-010` unit test should verify transitions through `SPEC`, `PLAN`, `TASKS` sequentially.
- **Code:** `src/engine/define-orchestrator.test.ts` verifies transitions through `PLAN_TO_TASKS`, `ANALYZE`, and `DEFINE_TESTS`.
- The test code matches the (incomplete) implementation but fails to meet the plan's requirement.

## 🟢 Strengths
- `WorkflowRuntime` and `IntentEngine` are well-implemented with robust security checks (path containment).
- CLI rewiring for `specify.ts` and `plan.ts` is clean and follows the "thin wrapper" pattern perfectly.
- Unit tests for `IntentEngine` and `WorkflowRuntime` are comprehensive.

## Recommendations

1. **Complete the Loop**: Update `DefineOrchestrator` to include `SPECIFY` and `PLAN` stages. Detect if `spec.md` or `plan.md` are missing and start from the appropriate stage.
2. **Port Prompt Content**: Move the actual prompt instructions from `.agents/workflows/` (or the old bash scripts) into the `PROMPT.md` files for all builtin workflows.
3. **Implement Resume Logic**: Add `load_state()` to `DefineOrchestrator` to restore `this.state` from `.runs/<feature>_define.state` on startup.
4. **Unify Task Logic**: Either move the reconciliation logic from `tasks-generate.ts` into a utility used by both paths, or make `tasks-generate.ts` a thin wrapper around `gwrk-plan-to-tasks`.
5. **Fix Analyze Resolution**: Add the `gwrk-analyze` workflow to builtins or remove the call if analysis is indeed "folded" into other stages (and ensure those stages actually perform the analysis).

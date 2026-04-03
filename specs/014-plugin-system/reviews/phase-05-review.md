# Code Review: 014 Plugin System - Phase 05 (DefineOrchestrator & CLI Rewiring)

**Date**: 2026-04-03
**Status**: APPROVED
**Spec**: [014-plugin-system](../spec.md)
**Phase**: Phase 05

## Summary

Phase 05 successfully implements the `DefineOrchestrator` state machine and rewires the core CLI commands (`gwrk spec`, `gwrk plan`, `gwrk tasks`) to use the new `WorkflowRuntime` (Layer 2.5). This effectively eradicates the legacy `define-until-solid.sh` bash dependency and transitions the system to a plugin-driven, manifest-validated workflow architecture.

## Key Components Reviewed

### 1. `DefineOrchestrator` (`src/engine/define-orchestrator.ts`)
- **Logic**: Correctly manages the transition between `SPEC`, `PLAN`, and `TASKS` stages.
- **State Discovery**: Successfully determines the current stage based on the existence of files (`spec.md`, `plan.md`, `tasks.json`, `gap-matrix.md`).
- **Workflow Integration**: Uses `WorkflowRuntime` to execute `gwrk-specify`, `gwrk-plan`, and `gwrk-author-gates`.
- **Rework Support**: Appropriately detects existing specs to switch between "NEW" and "REWORK" modes.

### 2. `WorkflowRuntime` (`src/plugins/workflow-runtime.ts`)
- **Schema Validation**: Implements `validateAgainstSchema` to ensure LLM outputs strictly follow the `manifest.yaml` contract.
- **Safety**: Correctly blocks direct filesystem mutation attempts within `RUN_COMMAND` (e.g., redirection operators `>`).
- **Intent Coupling**: Effectively bridges the gap between LLM reasoning and the `IntentEngine`.

### 3. `IntentEngine` (`src/engine/intent-engine.ts`)
- **Containment**: Enforces path containment, ensuring `WRITE_FILE` and `CREATE_DIR` actions remain within the `projectRoot`.
- **Safety**: Includes basic blocks for dangerous commands (`rm -rf /`, `sudo`).
- **Idempotency**: `WRITE_FILE` and `CREATE_DIR` are naturally idempotent via `fs.writeFile` and `fs.mkdir({ recursive: true })`.

### 4. CLI Rewiring
- **`src/commands/specify.ts`**: Successfully rewired to `orchestrator.executeSpecify`. Preserves signal handling and run tracking.
- **`src/commands/plan.ts`**: Successfully rewired to `orchestrator.executePlan`.
- **`src/commands/tasks-generate.ts`**: Successfully rewired to `orchestrator.executeTasks` for the gate authoring phase, while maintaining the complex reconciliation logic.

## Verification & Testing
- **Unit Tests**: `src/engine/define-orchestrator.test.ts` provides 100% coverage of the state machine transitions and stage-skipping logic.
- **Integration Tests**: `src/commands/specify.test.ts` and `src/commands/plan.test.ts` verify that the CLI correctly interfaces with the orchestrator and handles failures.
- **Contract Adherence**: The implementation aligns perfectly with `contracts/workflow-runtime.md`.

## Recommendations & Observations

1. **`DefineOrchestrator.runLoop` Completeness**: The `runLoop` currently stops at `TASKS`. Future phases should extend this to include `ANALYZE` and `DEFINE_TESTS` to fully replicate the `define-until-solid.sh` functionality.
2. **Interactive Mode**: There is a placeholder for `options.interactive` in `runLoop`. This should be prioritized if user-in-the-loop refinement is required for the full autonomous cycle.
3. **Intent Engine Error Handling**: The `IntentEngine` returns success/failure summaries. The `WorkflowRuntime` currently doesn't fail the entire workflow if a single intent fails but others succeed. Consider if partial failures should trigger a rollback or a "blocked" state.

## Conclusion

The implementation is robust, well-tested, and significantly improves the maintainability of the gwrk core by moving complex orchestration from bash to TypeScript. It adheres to all ADR-006 and F014-R requirements.

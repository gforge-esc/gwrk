# Gap Analysis: 001-cli-core Phase 12 (Define Pillar Output Parity)

**Feature**: 001-cli-core
**Phase**: 12
**Date**: 2026-06-01

## 1. Context Audit

- **Spec**: `spec.md` R3 defines US-026 (Define Pillar Output Parity) and FR-028/FR-029.
- **Plan**: `plan.md` R3 outlines Phase 12 implementation.
- **Contracts**:
    - `agent.md`: Defines `dispatchAgent` with `quiet` support.
- **Actual Code**:
    - `src/plugins/workflow-runtime.ts`: `extractJsonFromOutput` has tolerant mode (FR-029) but it's hardcoded, not flag-controlled.
    - `src/engine/define-orchestrator.ts`: Hardcodes `quiet: true` in all stages.
    - `src/commands/tests-generate.ts`: Uses `DefineOrchestrator`, but lacks direct `WorkflowRuntime` integration for better success detection.
    - `src/commands/specify.ts`: Same as above.
    - `src/commands/define-plan.ts`: Same as above.
    - `src/commands/tasks-generate.ts`: Same as above.
    - `src/commands/tests-generate-contract.test.ts`: **BROKEN**. Incorrect imports and outdated expectations (expects `tolerant: true` flag).

## 2. Findings

| Item | Status | Finding |
|---|---|---|
| `workflow-runtime.ts` | `partial` | Tolerant mode exists but is not exposed as a flag in `WorkflowOptions`. |
| `define-orchestrator.ts`| `wrong` | Hardcodes `quiet: true` instead of allowing the calling command to control UX. |
| `tests-generate.ts` | `partial` | Success detection exists but relies on `exitCode 0` from orchestrator, which might be too rigid. |
| Contract Tests | `wrong` | `tests-generate-contract.test.ts` is non-functional due to import errors. |

## 3. Gap Details

### G-01: Explicit Tolerant Flag
The `WorkflowRuntime.executeWorkflow` should take an explicit `tolerant?: boolean` flag in `WorkflowOptions`. This ensures that "prose-as-success" is a conscious choice for specific workflows, not a global behavior.

### G-02: Orchestrator Pass-through
`DefineOrchestrator` should accept a `quiet` option in its constructor and pass it to all `executeWorkflow` calls. This allows the CLI commands to stay in control of the UX.

### G-03: Robust Success Detection in Commands
`tests-generate.ts` and others should verify artifact production even if the orchestrator returns a non-zero exit code but the agent successfully committed files (using the tolerant mode result).

### G-04: Test Suite Repair
`tests-generate-contract.test.ts` must be refactored to use the `commander` program parsing approach (like `tests-generate-contract-phase12.test.ts`) and match the actual implementation.

## 4. Recommendations

1. Update `WorkflowRuntime` to support `tolerant: boolean` flag.
2. Update `DefineOrchestrator` to accept and pass `quiet` flag.
3. Update `define` subcommands to pass `quiet: true`.
4. Repair `tests-generate-contract.test.ts` to verify these behaviors.

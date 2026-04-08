# UAT Review: 014 Plugin System - Phase 05

**Verdict**: NO-GO
**Phase**: phase-05
**Reviewer**: Gemini CLI (UAT Workflow)
**Date**: 2026-04-04

## Acceptance Summary

| User Story | Title | Status | Finding |
|------------|-------|--------|---------|
| US-011 | Execute a Built-in Workflow | **FAIL** | Workflow prompts still use legacy bash scripts; gwrk-specify missing PROMPT.md update for JSON intents. |
| US-013 | DefineOrchestrator Loop | **FAIL** | Orchestrator missing SPECIFY and PLAN stages; loop starts at PLAN_TO_TASKS. |
| US-014 | Provision Global Home | **FAIL** | gwrk init (Phase 6) does not provision global home or core workflows. |
| US-015 | Project-Local Override | **PASS** | WorkflowRuntime correctly prioritizes .gwrk/ over built-ins. |

## Critical Failures

### 1. Incomplete Orchestrator (US-013)
`DefineOrchestrator` fails to implement the full `spec -> plan -> tasks` loop. It currently bypasses the specification and planning stages entirely, starting directly at task decomposition. This breaks the "define until solid" promise for new features.

### 2. Legacy Init Behavior (US-014)
`gwrk init` continues to create `.agents/` directories in the project root and fails to provision the global `~/.gwrk/plugins/workflows/` directory. This preserves the bash-dependent architecture F014-R was designed to eradicate.

### 3. Verification Gaps (VR-013)
E2E tests for rewired commands (`specify`, `plan`) are mocking the `WorkflowRuntime` boundary, which masked the fact that underlying workflows are still using legacy prompt logic (calling bash scripts).

## Remediation Tasks

- [ ] **T028**: Extend `DefineOrchestrator` to include `SPECIFY` and `PLAN` stages.
- [ ] **T029**: Update `gwrk-specify` and `gwrk-plan` built-in workflows to use `WRITE_FILE` intents instead of bash scripts.
- [ ] **T031**: Refactor E2E tests to use real `WorkflowRuntime` and mock only `AgentBackend`.
- [ ] **T033 (Phase 06)**: Update `gwrk init` to provision global home and core workflows.

## Evidence
- `DefineOrchestrator` source: Missing `DefineStage.SPECIFY` and `DefineStage.PLAN` in `getNextStage()`.
- `init.ts` source: Still references `.agents/workflows` path for creation.
- `gwrk-specify/PROMPT.md`: Still contains bash script calls in `Steps`.

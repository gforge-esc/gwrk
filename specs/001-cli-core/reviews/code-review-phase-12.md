# Code Review: Phase 12 (Define Pillar Output Parity)
**Verdict**: NO-GO ❌
**Date**: 2026-05-13
**Reviewer**: Gemini CLI (Principal Engineer)

## Summary
Phase 12 is marked as completed in `tasks.json`, but the implementation is missing the core requirements of US-026, FR-028, and FR-029. All define subcommands still dump raw agent narration to stdout, and the workflow runtime is not yet tolerant of prose-only native success.

## Task Status
- **T056**: Implement src/commands/tests-generate.ts (quiet: true) — **FAIL** (missing `quiet: true`)
- **T057**: Implement src/commands/specify.ts (quiet: true) — **FAIL** (missing `quiet: true`)
- **T058**: Implement src/commands/define-plan.ts (quiet: true) — **FAIL** (missing `quiet: true`)
- **T059**: Implement src/commands/tasks-generate.ts (quiet: true) — **FAIL** (missing `quiet: true`)
- **T060**: Implement src/plugins/workflow-runtime.ts (tolerant parsing) — **FAIL** (parsing still fatal)

## Findings

### 1. FR-028: Missing Quiet Mode
All subcommands in the `define` pillar (`spec`, `plan`, `tasks`, `tests`) invoke `WorkflowRuntime.executeWorkflow()` but fail to pass `{ quiet: true }` in the options object. This results in the agent narration streaming to the terminal instead of the intended quiet spinner UX.
- **Affected Files**: `src/commands/tests-generate.ts`, `src/commands/specify.ts`, `src/commands/define-plan.ts`, `src/commands/tasks-generate.ts`.

### 2. FR-029: Fatal JSON Parsing
The `WorkflowRuntime` still enforces a strict JSON output contract. If an agent (like Gemini) performs native work (e.g., committing test files) but returns prose narration instead of a JSON intent payload, the runtime throws an "Expected JSON object in agent output" error.
- **Affected File**: `src/plugins/workflow-runtime.ts`

### 3. Weak Gates
The original gates `T056-T060` only checked for the existence of functions/files, not the actual Phase 12 logic. The new deterministic vitest gates `T071-T076` correctly caught these regressions and are all failing.

## Remediation
All 5 tasks have been re-opened in `tasks.json` with specific remediation notes and pointers to the failing gates.

## Next Steps
Run `/implement specs/001-cli-core 12` to apply the missing functionality.

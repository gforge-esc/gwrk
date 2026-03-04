# UAT Review: Phase 2 - Agent Dispatch Commands

**Feature**: 001-cli-core
**Phase**: 2
**Status**: 🔴 NO-GO
**Date**: 2026-03-04
**Persona**: Product Manager

## 1. Executive Summary

Phase 2 of the `gwrk` CLI core implementation has failed UAT. While the code structure and unit tests pass in isolation, the actual integration with agent backends (`gemini` and `claude`) is broken due to command-line argument conflicts. The CLI construction does not match the actual behavior of the targeted agent binaries in the environment, leading to immediate crashes when attempting to dispatch workflows.

## 2. Acceptance Criteria Verification

### US-002: Agent Specification (`gwrk specify`)
- **Verdict**: 🔴 FAIL
- **Notes**: Running `gwrk specify "test"` results in `Cannot use both a positional prompt and the --prompt (-p) flag together`. The `gemini` CLI treats the workflow path as a prompt string and conflicts with the user-provided prompt.

### US-003: Agent Planning (`gwrk plan`)
- **Verdict**: 🔴 FAIL
- **Notes**: Running `gwrk plan 001-cli-core` results in the same argument conflict error. Additionally, `gemini -p` expects prompt content, not a file path to a workflow.

### US-009 & US-010: Analyze and Effort
- **Verdict**: 🔴 FAIL
- **Notes**: Both commands depend on the same broken `dispatchAgent` abstraction and fail upon execution.

### US-008: Configuration Validation (Phase 1 carry-over)
- **Verdict**: 🟢 PASS
- **Notes**: Verified that missing `.gwrkrc.json` correctly triggers a fail-fast error.

## 3. Technical Requirements Verification

- **TR-002, TR-003, TR-009, TR-010**: 🔴 FAIL (Functional)
- **Notes**: Although unit tests pass, they are verifying a flawed argument construction that does not work in reality. The tests need to be updated to match a working implementation.
- **TC-002 (Air-Gapped)**: 🟢 PASS
- **Notes**: The CLI correctly uses `execFile` for dispatch without direct network calls.

## 4. Evidence (Terminal Output)

```bash
$ node --import tsx src/cli.ts plan 001-cli-core
Cannot use both a positional prompt and the --prompt (-p) flag together
Usage: gemini [options] [command]

$ node --import tsx src/cli.ts specify "test specify"
Cannot use both a positional prompt and the --prompt (-p) flag together
```

## 5. Remediation Instructions

1. **Fix T009**: Refactor `src/utils/agent.ts` to correctly handle `gemini` and `claude` backends. This likely requires reading the workflow file content and passing it as part of the prompt or via stdin to avoid conflicts with positional arguments like the feature directory or user prompt.
2. **Update T013**: Update unit tests to assert the correct, working argument structure.
3. **Re-verify**: Ensure all agent commands execute without argument conflict errors.

## 6. Final Verdict
**VERDICT: NO-GO**

Phase 2 tasks T009 through T013 have been re-opened with structured remediation notes. The phase remains `in_progress` until these issues are resolved.

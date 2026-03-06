---
type: gap_analysis
feature: 004-wud-loop
last_modified: "2026-03-05T21:50:58Z"
---

# Gap Analysis: 004 WUD Loop

**Feature**: 004-wud-loop
**Date**: 2026-03-05
**Method**: Deep audit of current source vs. contracts

---

## Summary

The current implementation is in a broken state. `src/cli.ts` fails to run because `src/commands/implement.ts` does not export `implementCommand`. The existing `wud` command is a shell-shim. Most utility files exist as stubs that throw "Not implemented".

---

## File-by-File Analysis

### Phase 1 — Implement Command

| File | Status | Finding |
|---|---|---|
| `src/utils/branch.ts` | ⚠️ stub | Exists but all methods throw "Not implemented". |
| `src/utils/wud-state.ts` | ⚠️ stub | Exists but all methods throw "Not implemented". |
| `src/utils/log.ts` | ⚠️ stub | Exists but all methods throw "Not implemented". |
| `src/commands/implement.ts` | 🔴 broken | Missing `implementCommand` export. `executePhase` is a stub. |
| `src/commands/implement.test.ts` | ✅ exists | Initial tests exist but need to be updated for the new TS implementation. |

### Phase 2 — WUD State Machine

| File | Status | Finding |
|---|---|---|
| `src/utils/pr.ts` | 🔴 missing | Required for `createPR` and `waitForCI`. |
| `src/utils/verdict.ts` | 🔴 missing | Required for `checkPhaseVerdict`. |
| `src/commands/wud.ts` | ⚠️ shim | Currently a shell-shim. Must be refactored to implement the `runWudLoop` state machine in TS. |
| `src/commands/wud.test.ts` | ✅ exists | Initial tests exist but need to be updated for the new TS state machine. |

### Phase 3 — Integration

| File | Status | Finding |
|---|---|---|
| `src/cli.ts` | 🔴 broken | `implement` and `wud` are registered, but import of `implementCommand` fails. |

---

## Cross-Dependency Audit

- `src/utils/state.ts` (001-cli-core): ✅ Fully implemented and available.
- `src/utils/agent.ts` (001-cli-core): ✅ Fully implemented and available.
- `src/utils/exec.ts` (001-cli-core): ✅ Fully implemented and available.
- `src/utils/config.ts` (001-cli-core): ✅ Fully implemented and available.

---

## Required Tasks (Refined)

1. **Fix CLI Entrypoint**: Restore `implementCommand` to `src/commands/implement.ts` even as a shim to allow CLI to run.
2. **Implement Phase 1 Utils**: Fill out `branch.ts`, `wud-state.ts`, and `log.ts`.
3. **Refactor Implement Command**: Implement `executePhase` and `runPreFlight` in TypeScript.
4. **Implement Phase 2 Utils**: Create `pr.ts` and `verdict.ts`.
5. **Refactor WUD Command**: Implement the state machine in TypeScript.

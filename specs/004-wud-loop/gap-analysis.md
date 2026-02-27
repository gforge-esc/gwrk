# Gap Analysis: 004 WUD Loop

**Feature**: 004-wud-loop
**Date**: 2026-02-27
**Method**: Deep read of plan.md, all contracts, and all target source files

---

## Summary

All 10 new files from this feature's plan are **greenfield** — no prior implementation exists.
Three existing files from `001-cli-core` were audited for compatibility.

---

## File-by-File Analysis

### Phase 1 — Implement Command

| File | Status | Finding |
|---|---|---|
| `src/commands/implement.ts` | 🟢 greenfield | Must create from scratch per `contracts/implement.md` |
| `src/utils/branch.ts` | 🟢 greenfield | Must create per `contracts/branch.md`. Shell equivalent exists: `scripts/dev/wud-branch.sh` — port to TS |
| `src/utils/wud-state.ts` | 🟢 greenfield | Must create per `contracts/wud.md` (state persistence section) |
| `src/utils/log.ts` | 🟢 greenfield | Must create — timestamped WUD run logger |
| `src/commands/implement.test.ts` | 🟢 greenfield | Must create — Vitest unit tests |

**Upstream dependencies (001-cli-core, NOT this feature's responsibility):**

| File | Status | Finding |
|---|---|---|
| `src/utils/state.ts` | ⚠️ greenfield | 001-cli-core deliverable — `loadTaskState()`, `nextTask()`, `markTaskComplete()` not yet implemented. WUD must import these. |
| `src/utils/agent.ts` | ⚠️ greenfield | 001-cli-core deliverable — `dispatchAgent()` not yet implemented. WUD must import this. |
| `src/utils/exec.ts` | ✅ exists | `runGate()` already implemented and matches contract signature exactly. |
| `src/utils/config.ts` | ✅ exists | `loadConfig()` fully implemented with Zod fail-fast. Schema includes `agents.implement`. Compatible. |

### Phase 2 — WUD State Machine

| File | Status | Finding |
|---|---|---|
| `src/commands/wud.ts` | 🟢 greenfield | Must create per `contracts/wud.md`. Shell equivalent: `scripts/dev/work-until-done.sh` — port state machine to TS |
| `src/utils/pr.ts` | 🟢 greenfield | Must create per `contracts/pr.md`. Shell equivalent: `scripts/dev/wud-ci-wait.sh` — port CI wait |
| `src/utils/verdict.ts` | 🟢 greenfield | Must create per `contracts/verdict.md`. Shell equivalent: `scripts/dev/wud-verdict.sh` — port verdict check |
| `src/commands/wud.test.ts` | 🟢 greenfield | Must create — Vitest unit tests |

### Phase 3 — CLI Registration

| File | Status | Finding |
|---|---|---|
| `src/cli.ts` | ✅ exists (MODIFY) | Currently registers only `initCommand`. Must add `implementCommand` and `wudCommand` imports + `program.addCommand()` calls. |

---

## Cross-Dependency Risk

> [!IMPORTANT]
> `src/utils/state.ts` and `src/utils/agent.ts` are **not yet implemented** — they belong to `001-cli-core`.
> WUD tasks should assume these modules exist and import them. If `001-cli-core` hasn't shipped yet,
> WUD Phase 1 tasks will need stub implementations or must be sequenced after `001-cli-core` Phase 1.
>
> **Recommendation**: Tasks should import from the expected paths. Gate scripts should verify the imports compile.

---

## Contract Compliance Audit

| Contract | Method | Implementation | Status |
|---|---|---|---|
| `implement.md` | `executePhase()` | `src/commands/implement.ts` | 🟢 greenfield |
| `implement.md` | `runPreFlight()` | `src/commands/implement.ts` | 🟢 greenfield |
| `branch.md` | `ensureBranch()` | `src/utils/branch.ts` | 🟢 greenfield |
| `branch.md` | `pushBranch()` | `src/utils/branch.ts` | 🟢 greenfield |
| `wud.md` | `runWudLoop()` | `src/commands/wud.ts` | 🟢 greenfield |
| `wud.md` | `saveWudState()` | `src/utils/wud-state.ts` | 🟢 greenfield |
| `wud.md` | `loadWudState()` | `src/utils/wud-state.ts` | 🟢 greenfield |
| `pr.md` | `createPR()` | `src/utils/pr.ts` | 🟢 greenfield |
| `pr.md` | `waitForCI()` | `src/utils/pr.ts` | 🟢 greenfield |
| `verdict.md` | `checkPhaseVerdict()` | `src/utils/verdict.ts` | 🟢 greenfield |

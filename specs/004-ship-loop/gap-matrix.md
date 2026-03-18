# Gap Matrix: 004-ship-loop

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-001 | Ship Single Phase completes lifecycle | e2e | src/scripts-e2e.test.ts | ✅ | T001 |
| US-002 | Pre-flight tasks.json gate checks | functional | src/scripts-e2e.test.ts | ✅ | T003 |
| US-003 | Ship All Phases sequentially | unit | src/commands/ship.test.ts | ✅ | T005 |
| US-004 | Circuit Breaker (MAX_ITERATIONS) | unit | src/commands/ship.test.ts | ✅ | T007 |
| US-005 | Crash Recovery (Resumes from state) | functional | src/commands/ship.test.ts | ❌ | T008 |
| US-006 | PR Creation & CI Gate | functional | src/scripts-e2e.test.ts | ✅ | T006 |
| US-007 | Execution Manifest with Log Digest | unit | src/commands/ship.test.ts | ✅ | T012 |
| US-008 | Agent Backend Config resolution | unit | src/commands/ship.test.ts | ✅ | T009 |
| US-009 | Phase-Skip for Completed Phases | unit | src/commands/ship.test.ts | ✅ | T014 |
| US-010 | Staging Validation (rejects out-of-scope) | functional | src/scripts-e2e.test.ts | ✅ | T016 |
| US-011 | Structured failureContext on CIRCUIT_BREAK | e2e | src/scripts-e2e.test.ts | ✅ | T018 |
| FR-001 | `gwrk ship` delegates to `work-until-done.sh` | unit | src/commands/ship.test.ts | ✅ | T001 |
| FR-002 | Branch creation from develop + dirty tree guard | functional | src/scripts-e2e.test.ts | ✅ | T002 |
| FR-003 | Pre-flight gate passing skips task | functional | src/scripts-e2e.test.ts | ✅ | T003 |
| FR-004 | State machine: IMPLEMENT → REVIEW → DONE | e2e | src/scripts-e2e.test.ts | ✅ | T004 |
| FR-005 | Code/UAT review dispatch + NO-GO loop | e2e | src/scripts-e2e.test.ts | ✅ | T005 |
| FR-006 | gh pr create --base develop + CI wait | functional | src/scripts-e2e.test.ts | ✅ | T006 |
| FR-007 | Circuit breaker at MAX_ITERATIONS | unit | src/commands/ship.test.ts | ✅ | T007 |
| FR-008 | Resumes from last persisted stage | functional | — | ❌ | T008 |
| FR-009 | Hierarchical agent backend resolution | unit | src/commands/ship.test.ts | ✅ | T009 |
| FR-010 | Timestamped machine-local logs in .runs/ | e2e | src/scripts-e2e.test.ts | ✅ | T010 |
| FR-011 | recordRun() logs to SQLite runs table | unit | src/commands/ship.test.ts | ✅ | T011 |
| FR-012 | Manifest writes to specs/<feat>/.gwrk/runs/ | unit | src/commands/ship.test.ts | ✅ | T012 |
| FR-013 | Omitting phase ships all sequentially | unit | src/commands/ship.test.ts | ✅ | T013 |
| FR-014 | Skip phases where all tasks terminal | unit | src/commands/ship.test.ts | ✅ | T014 |
| FR-015 | Agent-Native `[exit:N | Xs]` wrapper | unit | src/commands/ship.test.ts | ✅ | T015 |
| FR-016 | `validate-staging.sh` before push | functional | src/scripts-e2e.test.ts | ✅ | T016 |
| FR-017 | 3-tier logging: raw, digest, SQLite | e2e | src/scripts-e2e.test.ts | ✅ | T017 |
| FR-018 | `failureContext` in state on CIRCUIT_BREAK | functional | src/scripts-e2e.test.ts | ✅ | T018 |
| FR-019 | `dispatchToAgent(TaskDispatch): TaskResult` | unit | — | ❌ | T019 |
| FR-020 | Exit code normalization in dispatch | unit | — | ❌ | T020 |
| FR-021 | Context delivery via stdin piping | unit | — | ❌ | T021 |

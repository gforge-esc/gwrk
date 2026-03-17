| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-001 | Ship Single Phase completes full lifecycle | e2e | `src/scripts-e2e.test.ts` | ✅ | T001 |
| US-002 | Pre-flight gate check skips passing tasks | e2e | `src/scripts-e2e.test.ts` | ❌ | T002 |
| US-003 | Ship All Phases sequentially, stops on failure | unit | `src/commands/ship.test.ts` | ✅ | T001 |
| US-004 | Circuit breaker stops after max iterations | unit | `src/commands/ship.test.ts` | ✅ | T001 |
| US-005 | Crash recovery resumes from persisted stage | unit | `src/commands/ship.test.ts` | ❌ | T008 |
| US-006 | PR created targeting develop, CI awaited | e2e | `src/scripts-e2e.test.ts` | ❌ | T006 |
| US-007 | Manifest with log digest generated | unit | `src/commands/ship.test.ts` | ✅ | T003 |
| US-008 | Agent backend resolved from config/override | unit | `src/commands/ship.test.ts` | ❌ | T009 |
| US-009 | Skip phases where all tasks are completed | unit | `src/commands/ship.test.ts` | ✅ | T003 |
| US-010 | validate-staging.sh rejects out-of-scope | shell | `tests/future-red/validate-staging.test.sh` | ❌ | T011 |
| US-011 | Circuit break produces failureContext | e2e | `src/scripts-e2e.test.ts` | ✅ | T007 |
| FR-002 | Dirty working tree fail-fast | e2e | `src/scripts-e2e.test.ts` | ✅ | T005 |
| FR-003 | Pre-flight PASS skips task implementation | e2e | `src/scripts-e2e.test.ts` | ❌ | T002 |
| FR-004 | State machine transition persistence | e2e | `src/scripts-e2e.test.ts` | ❌ | T001 |
| FR-005 | Review dispatch loops on NO-GO | e2e | `src/scripts-e2e.test.ts` | ❌ | T001 |
| FR-006 | PR creation via gh CLI | e2e | `src/scripts-e2e.test.ts` | ❌ | T006 |
| FR-008 | Resume from stage in state file | unit | `src/commands/ship.test.ts` | ❌ | T008 |
| FR-009 | Agent config hierarchical resolution | unit | `src/commands/ship.test.ts` | ❌ | T009 |
| FR-010 | Log copy to git-tracked runs/ | e2e | `src/scripts-e2e.test.ts` | ✅ | T002 |
| FR-014 | Phase skip including cancelled tasks | unit | `src/commands/ship.test.ts` | ✅ | T003 |
| FR-015 | Agent-Native output [exit:N \| Xs] | unit | `src/commands/ship.test.ts` | ✅ | T008 |
| FR-016 | Staging validator call from WUD | e2e | `src/scripts-e2e.test.ts` | ❌ | T006 |
| FR-017 | 3-tier logging (raw, digest, sqlite) | e2e | `src/scripts-e2e.test.ts` | ✅ | T002 |
| FR-018 | Rip-cord failureContext writing | e2e | `src/scripts-e2e.test.ts` | ✅ | T007 |

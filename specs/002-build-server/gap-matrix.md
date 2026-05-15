| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-005 | Server listens for ShipOrchestrator events | unit | src/server/ship-bridge.test.ts | ✅ | T002-004 |
| FR-006 | Messages must have exactly one primary CTA | unit | src/server/ship-bridge.test.ts | ✅ | T002-005 |
| US-003 | Ship:complete triggers reviewReady Slack message | unit | src/server/ship-bridge.test.ts | ✅ | T002-005 |
| US-003 | Ship:failed triggers phaseFail Slack message | unit | src/server/ship-bridge.test.ts | ✅ | T002-006 |
| FR-007 | merge_pr action merged PR via gh CLI | unit | src/server/slack-actions.test.ts | ✅ | T002-008 |
| FR-007 | retry_phase action re-dispatches ship | unit | src/server/slack-actions.test.ts | ✅ | T002-009 |
| US-004 | Approve Spec button advances pipeline | unit | src/server/slack-actions.test.ts | ✅ | T002-013 |
| US-004 | Approve Plan button advances pipeline | unit | src/server/slack-actions.test.ts | ✅ | T002-013 |
| US-005 | Home tab shows plan DAG status | unit | src/server/slack-home.test.ts | ✅ | T002-010 |
| FR-011 | Agent dispatch recorded in SQLite | unit | src/db/runs.test.ts | ✅ | T007-001 |

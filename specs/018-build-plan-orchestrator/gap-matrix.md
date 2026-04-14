| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | SQLite schema for features, phases, edges | unit | src/db/plan.test.ts | ✅ | |
| FR-005 | Basic status reporting | integration | src/commands/plan.test.ts | ✅ | |
| FR-013 | Seed graph from 000-build-plan.md | integration | src/commands/plan.test.ts | ✅ | |
| FR-017 | Cold start bootstrapping from specs/ | integration | src/commands/plan.test.ts | ✅ | |
| FR-018 | L0-L3 readiness level assignment | unit | src/engine/readiness-scanner.test.ts | ✅ | |
| FR-019 | Empty-graph remediation message | integration | src/commands/plan.test.ts | ✅ | |
| US-003 | View build plan status | integration | src/commands/plan.test.ts | ✅ | |
| US-008 | Add/remove features/phases | unit | src/engine/plan-store.test.ts | ✅ | |
| US-011 | Seed from existing markdown | integration | src/commands/plan.test.ts | ✅ | |
| US-016 | Cold start init from specs | integration | src/commands/plan.test.ts | ✅ | |
| DM-018-001 | plan_features table | unit | src/db/plan.test.ts | ✅ | |
| DM-018-002 | plan_phases table | unit | src/db/plan.test.ts | ✅ | |
| DM-018-003 | plan_edges table | unit | src/db/plan.test.ts | ✅ | |
| DM-018-004 | plan_proposals table | unit | src/db/plan.test.ts | ✅ | |

# Gap Matrix for 001-cli-core Phase 14 (Project-Scoped DB Isolation)

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|----------------------|-----------|-----------|-------------|------|
| US-030 | Project-Scoped DB Isolation | integration | src/commands/project-scoped.test.ts | ✅ | |
| FR-036 | resolveProjectId(cwd) utility | unit | src/utils/project-id.test.ts | ✅ | |
| FR-037 | Scoped DB migrations for 8 tables | integration | src/db/scoping.test.ts | ✅ | |
| FR-038 | Scoped DB queries in src/db/*.ts | integration | src/db/scoping.test.ts | ✅ | |
| FR-039 | PlanStore accepts projectId | unit | src/engine/plan-store-scoping.test.ts | ✅ | |
| FR-040 | CLI commands derive/pass projectId | integration | src/commands/project-scoped.test.ts | ✅ | |
| TR-035 | resolveProjectId consistency | unit | src/utils/project-id.test.ts | ✅ | |
| TR-036 | DB cross-project isolation | integration | src/db/scoping.test.ts | ✅ | |
| TR-037 | PlanStore filtering by project | unit | src/engine/plan-store-scoping.test.ts | ✅ | |
| TR-038 | Command derivation of project_id | integration | src/commands/project-scoped.test.ts | ✅ | |

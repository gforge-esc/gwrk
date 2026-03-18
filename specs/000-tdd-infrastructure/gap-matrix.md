# Gap Matrix: 000-tdd-infrastructure

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Every gate has functional assertion beyond test -f | unit | src/utils/gate-gen.test.ts | ✅ | T001 |
| FR-002 | define tasks reads gap-matrix.md and generates deterministic vitest gates | functional | src/commands/tasks-generate.test.ts | ✅ | T002 |
| FR-002 | define tasks falls back to LLM dispatch for uncovered tasks | functional | src/commands/tasks-generate.test.ts | ✅ | T002 |
| FR-002 | define tasks exits 1 if contracts missing (and not --no-llm) | functional | src/commands/tasks-generate.test.ts | ✅ | T002 |
| FR-003 | define tests produces RED vitest test files | functional | src/commands/tests-generate.test.ts | ✅ | T003 |
| FR-004 | API surfaces have contracts/ files | structural | — | ✅ | T004 |
| FR-005 | 001-cli-core gap-analysis.md exists | structural | — | ❌ | T005 |
| FR-006 | 002-build-server gap-analysis.md exists | structural | — | ❌ | T006 |
| FR-007 | 003-slack failing tests fixed | functional | src/server/routes/notify.test.ts | ✅ | T007 |
| FR-008 | gwrk ship pre-flight blocks if no tests | unit | src/commands/ship.test.ts | ✅ | T008 |
| FR-009 | gwrk test scopes vitest to feature | unit | src/commands/test-cmd.test.ts | ✅ | T009 |
| FR-010 | define tests produces gap-matrix.md | functional | src/commands/tests-generate.test.ts | ✅ | T010 |
| FR-011 | Gap matrix is internally auditable (every FR has ≥1 row) | unit | src/utils/gate-gen.test.ts | ✅ | T011 |
| FR-012 | Gate generation deterministic for test-backed tasks | unit | src/utils/gate-gen.test.ts | ✅ | T012 |
| FR-012 | generateVitestGates() skips structural rows | unit | src/utils/gate-gen.test.ts | ✅ | T012 |
| FR-012 | generateVitestGates() preserves AUTHORED gates | unit | src/utils/gate-gen.test.ts | ✅ | T012 |
| TR-001 | gate-gen.test.ts covers GateBrief generation | unit | src/utils/gate-gen.test.ts | ✅ | T001 |
| TR-002 | tasks-generate.test.ts covers contracts guard and --no-llm | unit | src/commands/tasks-generate.test.ts | ✅ | T002 |
| TR-010 | AUTHORED preservation on --force | unit | src/commands/tasks-generate.test.ts | ✅ | T002 |
| TR-011 | parseGapMatrix parses markdown table | unit | src/utils/gate-gen.test.ts | ✅ | T011 |
| TR-011 | parseGapMatrix handles missing file | unit | src/utils/gate-gen.test.ts | ✅ | T011 |
| TR-011 | parseGapMatrix handles — values as null | unit | src/utils/gate-gen.test.ts | ✅ | T011 |
| TR-012 | Gap matrix consumption generates vitest gates with --no-llm | functional | src/commands/tasks-generate.test.ts | ✅ | T012 |

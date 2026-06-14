| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Parse spec.md and extract US-### with SP and roles | unit | src/engine/spec-parser.test.ts | ✅ | |
| FR-002 | Compute hours with multipliers and 1.25x overhead | unit | src/engine/effort.test.ts | ✅ | |
| FR-003 | Generate markdown report in docs/assessments/ | unit | src/engine/effort.test.ts | ✅ | |
| FR-004 | Fail fast if spec.md missing or no stories | unit | src/engine/effort.test.ts, src/engine/spec-parser.test.ts | ✅ | |
| FR-012 | Role multiplier overrides from config | unit | src/engine/effort.test.ts | ✅ | |
| US-001 | Effort estimation for a single feature | unit | src/engine/effort.test.ts | ✅ | |
| US-002 | Effort report handles missing spec | unit | src/engine/effort.test.ts | ✅ | |
| US-008 | Role multiplier configuration | unit | src/engine/effort.test.ts | ✅ | |
| TC-001 | Determinism | unit | src/engine/effort.test.ts | ✅ | |
| TC-005 | Markdown parser (no LLM) | unit | src/engine/spec-parser.test.ts | ✅ | |
| DM-001 | StoryEstimate type structure | unit | src/engine/spec-parser.test.ts | ✅ | |
| TC-003 | Fail-fast config | unit | src/engine/roles.test.ts | ❌ | |
| TC-004 | Configurable session gap | unit | src/engine/compression.test.ts | ❌ | |

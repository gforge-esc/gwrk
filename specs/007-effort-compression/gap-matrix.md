| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-001 | LOC-derived SP fallback report | integration | src/commands/effort.test.ts | ✅ | |
| US-004 | Configurable resolution chain | unit | src/utils/config.test.ts | ✅ | |
| FR-016 | computeForecastFromLOC function | unit | src/engine/compression.test.ts | ✅ | |
| FR-017 | Three-layer resolution (default/profile/override) | unit | src/utils/config.test.ts | ✅ | |
| FR-019 | Language-specific rate mapping | unit | src/engine/effort-defaults.test.ts | ✅ | |
| DM-001 | Effort profile schema validation | unit | src/utils/config.test.ts | ✅ | |
| TC-001 | Determinism in LOC calculations | unit | src/engine/compression.test.ts | ✅ | |
| TC-003 | Fail-fast on invalid effort config | unit | src/utils/config.test.ts | ✅ | |
| TR-001 | Verify LOC calculation for TS/Rust | unit | src/engine/compression.test.ts | ✅ | |
| TR-003 | Verify language detection logic | unit | src/utils/config.test.ts | ✅ | |
| TR-004 | Verify fallback when SP is missing | unit | src/commands/effort.test.ts | ✅ | |

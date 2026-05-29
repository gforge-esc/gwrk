| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-011 | No .agents/ directory in root by default | E2E | e2e/014-plugin-system-phase-11.spec.ts | ✅ | |
| TC-011 | Zero-Dependency Workflows (no .agents/ reliance) | E2E | e2e/014-plugin-system-phase-11.spec.ts | ✅ | |
| TR-P11-001 | gwrk define spec --help resolves without .agents/ | E2E | e2e/014-plugin-system-phase-11.spec.ts | ✅ | |
| TR-P11-002 | Review dispatch sends full PROMPT.md | E2E | e2e/014-plugin-system-phase-11.spec.ts | ✅ | |
| TR-P11-003 | migrate.ts warns on .agents/ existence | unit | src/plugins/migrate.test.ts | ✅ | |
| TR-P11-004 | drift-detector.ts removes .agents/ checks | unit | src/engine/drift-detector.test.ts | ✅ | |
| TR-P9-001 | resolveEnforcementSkills() returns builtin content | unit | src/plugins/enforcement.p9.red.test.ts | ✅ | |
| TR-P9-002 | Project-local override takes precedence | unit | src/plugins/enforcement.p9.red.test.ts | ✅ | |
| TR-P9-003 | tier: enforcement validates in SkillManifestSchema | unit | src/plugins/enforcement.p9.red.test.ts | ✅ | |
| TR-P9-004 | PluginLoader lists enforcement skills | integration | src/plugins/enforcement.p9.red.test.ts | ✅ | |
| TR-P9-005 | Dispatch context includes enforcement content | integration | src/plugins/enforcement.p9.red.test.ts | ✅ | |
| TR-P9-006 | gwrk-conventions contains valid task statuses | unit | src/plugins/enforcement.p9.red.test.ts | ✅ | |

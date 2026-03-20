# Gap Matrix: 014 Plugin System - Phase 1

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | `plugin install` validates and copies | unit | src/commands/plugin.test.ts | ✅ | |
| FR-002 | Manifest Zod schema validation | unit | src/plugins/manifest.test.ts | ✅ | |
| FR-003 | `plugin list` scans and groups | unit | src/commands/plugin.test.ts | ✅ | |
| FR-004 | `plugin remove` deletes and warns | unit | src/commands/plugin.test.ts | ✅ | |
| FR-005 | `plugin disable/enable` per project | unit | src/commands/plugin.test.ts | ✅ | |
| FR-013 | Manifest supports skill, workflow, agent | unit | src/plugins/manifest.test.ts | ✅ | |
| TC-001 | Air-gapped plugin loading | unit | src/plugins/loader.test.ts | ✅ | |
| TC-002 | Fail-fast config for missing manifest | unit | src/commands/plugin.test.ts | ✅ | |
| TC-004 | Global-only skills/agents | unit | src/plugins/loader.test.ts | ✅ | |
| TC-005 | YAML config (manifest.yaml) | unit | src/plugins/loader.test.ts | ✅ | |
| TC-009 | Resolution order: Global -> Local | unit | src/plugins/loader.test.ts | ✅ | |
| FR-L1-001 | Agent manifest schema | unit | src/plugins/manifest.test.ts | ✅ | |
| FR-L1-012 | User-installed global plugins override built-ins | unit | src/plugins/loader.test.ts | ✅ | |
| FR-L25-001 | Workflow manifest schema | unit | src/plugins/manifest.test.ts | ✅ | |

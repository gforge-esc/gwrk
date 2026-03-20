| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Plugin install (validate then copy) | integration | src/commands/plugin.test.ts | ✅ | T007 |
| FR-002 | Manifest validation (Zod) | unit | src/plugins/manifest.test.ts | ✅ | T005 |
| FR-003 | Plugin list (scan + display) | integration | src/commands/plugin.test.ts | ✅ | T007 |
| FR-004 | Plugin remove (delete + dep check) | integration | src/commands/plugin.test.ts | ✅ | T007 |
| FR-005 | Plugin disable/enable (.gwrk/plugins.yaml) | integration | src/commands/plugin.test.ts | ✅ | T007 |
| FR-013 | Manifest schema (Skill/Workflow/Agent) | unit | src/plugins/manifest.test.ts | ✅ | T005 |
| TC-001 | Air-Gapped (local/git only) | integration | src/commands/plugin.test.ts | ✅ | T007 |
| TC-002 | Fail-Fast Config (Missing manifest) | unit | src/plugins/loader.test.ts | ✅ | T006 |
| TC-004 | Global-Only Skills resolution | unit | src/plugins/loader.test.ts | ✅ | T006 |
| TC-005 | YAML Config (manifest/plugins.yaml) | unit | src/plugins/loader.test.ts | ✅ | T006 |
| TC-009 | Resolution Order (Global -> Local) | unit | src/plugins/loader.test.ts | ✅ | T006 |
| T004 | Plugin path resolution in config | unit | src/utils/config.test.ts | ✅ | T004 |

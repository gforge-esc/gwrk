| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| **Phase 1: Foundation** | | | | | |
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
| **Phase 2: Skill Runtime** | | | | | |
| FR-006 | Skill execution (resolve + invoke) | unit | src/plugins/skill-runtime.test.ts | ✅ | T008 |
| FR-007 | F013 Contract (format, signals, agent mode) | unit | src/plugins/skill-runtime.test.ts | ✅ | T008 |
| FR-008 | Compound Skill (single LLM call assembly) | unit | src/plugins/skill-runtime.test.ts | ✅ | T008 |
| FR-009 | Compound dependencies validation | unit | src/plugins/skill-runtime.test.ts | ✅ | T008 |
| FR-010 | Skill Help enrichment | integration | src/commands/skill.test.ts | ✅ | T009 |
| TC-007 | Single LLM Call (assembly logic) | unit | src/plugins/skill-runtime.test.ts | ✅ | T008 |
| TC-008 | F013 Contract enforcement | unit | src/plugins/skill-runtime.test.ts | ✅ | T008 |
| **Phase 3: Agent Adapters** | | | | | |
| FR-L1-001 | Agent Manifest schema (DM-006) | unit | src/plugins/manifest.test.ts | ✅ | T005 |
| FR-L1-002 | AgentBackend.dispatch() contract | unit | src/plugins/agent-adapter.test.ts | ✅ | |
| FR-L1-003 | Proprietary exit code normalization | unit | src/plugins/agent-adapter.test.ts | ✅ | |
| FR-L1-004 | syncGovernance() (GEMINI.md generation) | integration | src/plugins/agent-adapter.test.ts | ✅ | |
| FR-L1-005 | managedConfig conflict detection | unit | src/plugins/loader.test.ts | ✅ | |
| FR-L1-006 | gwrk plugin sync-context command | integration | src/commands/sync-context.test.ts | ✅ | |
| FR-L1-008 | gwrk init auto-discovery | integration | src/commands/init.test.ts | ✅ | |
| FR-L1-010 | Built-in adapters (Claude/Gemini/Codex) | unit | src/plugins/agent-adapter.test.ts | ✅ | |
| TC-010 | Strict Isolation (managedConfig boundary) | unit | src/plugins/manifest.test.ts | ✅ | T005 |
| ADR-006 | Stdin context delivery | unit | src/plugins/agent-adapter.test.ts | ✅ | |
| **Phase 4: Routing** | | | | | |
| FR-014 | Routing engine selection logic | unit | src/engine/router.test.ts | ✅ | |
| FR-P4-001 | fallbackOrder support | unit | src/engine/router.test.ts | ✅ | |
| FR-P4-002 | Quota/Rate-limit probing (429) | unit | src/engine/router.test.ts | ✅ | |
| **Phase 5: Migration** | | | | | |
| FR-011 | gwrk plugin migrate (.agents/ skills) | unit | src/plugins/migrate.test.ts | ✅ | |
| FR-012 | gwrk plugin seed (taxonomy -> skills) | unit | src/plugins/seed.test.ts | ✅ | |
| **Verification Requirements (E2E)** | | | | | |
| VR-001 | Install + invoke skill | e2e | src/plugins.e2e.test.ts | ✅ | |
| VR-002 | JSON plugin list | e2e | src/plugins.e2e.test.ts | ✅ | |
| VR-004 | Pipe composition | e2e | src/plugins.e2e.test.ts | ✅ | |
| VR-005 | Nonexistent skill exit 1 | e2e | src/plugins.e2e.test.ts | ✅ | |
| VR-008 | Disable plugin per-project | e2e | src/plugins.e2e.test.ts | ✅ | |
| VR-009 | Reject global-only disable | e2e | src/plugins.e2e.test.ts | ✅ | |

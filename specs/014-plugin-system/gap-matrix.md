| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-L25-009 | Scaffold .gwrk/ontology and .gwrk/perspective | unit | src/engine/ontology-scaffold.test.ts | ✅ | TR-014 |
| FR-L25-010 | gwrk-ontology-construct builtin workflow | e2e | e2e/014-plugin-system-phase-18.spec.ts | ✅ | |
| FR-L25-011 | Source material scanner utility | unit | src/engine/source-scanner.test.ts | ✅ | TR-015 |
| FR-L25-012 | Enforce Five Primitives methodology | e2e | e2e/014-plugin-system-phase-18.spec.ts | ✅ | TR-015 |
| US-020 | Scaffolding command check | integration | src/commands/define-ontology.test.ts | ✅ | TR-014 |
| US-021 | Automated construction (--run) | e2e | e2e/014-plugin-system-phase-18.spec.ts | ✅ | |
| US-022 | Source material grounding check | e2e | e2e/014-plugin-system-phase-18.spec.ts | ✅ | |
| FR-015 | Filesystem-based toolchain detection | unit | src/engine/profile-detector.test.ts | ✅ | TR-016 |
| US-023 | Project info returns toolchain | e2e | e2e/014-plugin-system-phase-16.spec.ts | ✅ | |
| FR-L25-013 | Implement workflow reads profile and toolchain | e2e | e2e/014-plugin-system-phase-17.spec.ts | ❌ | |
| US-024 | Implement workflow has context gathering | e2e | e2e/014-plugin-system-phase-17.spec.ts | ❌ | |
| FR-L3-001 | ExtensionManifestSchema supports provides | unit | src/plugins/extension-runtime.test.ts | ✅ | TR-017 |
| FR-L3-002 | ContextProvider interface | unit | src/plugins/extension-runtime.test.ts | ✅ | TR-017 |
| FR-L3-003 | ExtensionRuntime manages adapters | unit | src/plugins/extension-runtime.test.ts | ✅ | TR-017 |
| FR-L3-004 | resolveExtensionContext aggregates context | unit | src/plugins/extension-runtime.test.ts | ✅ | TR-017 |
| FR-L3-005 | per-project extensions config | unit | src/plugins/extension-runtime.test.ts | ✅ | TR-017 |
| FR-L3-006 | dispatchToAgent injects extension context | unit | src/utils/agent.test.ts | ✅ | TR-018 |
| FR-L3-007 | built-in obsidian-vault extension | unit | src/plugins/builtins/extensions/obsidian-vault/adapter.test.ts | ✅ | TR-019 |
| US-025 | Register a Context Provider Extension | unit | src/plugins/extension-runtime.test.ts | ✅ | TR-017 |
| US-026 | Configure Extension per Project | unit | src/plugins/extension-runtime.test.ts | ✅ | TR-017 |
| US-027 | Dynamic Context Injection from Obsidian | unit | src/plugins/builtins/extensions/obsidian-vault/adapter.test.ts | ✅ | TR-019 |
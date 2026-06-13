# Coverage Matrix for 020-polyglot-monorepo

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-001 | Workspace Configuration | unit | src/utils/config.test.ts | ✅ | |
| US-002 | Workspace Detection via CWD | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-003 | Explicit Workspace Flag | unit | src/cli.test.ts | ✅ | |
| US-004 | Workspace Init in subdirectory | unit | src/commands/init.test.ts | ✅ | |
| FR-001 | Extend GwrkConfigSchema | unit | src/utils/config.test.ts | ✅ | |
| FR-002 | Resolve active workspace profile | unit | src/engine/profile-detector.test.ts | ✅ | |
| FR-003 | Accept --workspace option | unit | src/cli.test.ts | ✅ | |
| FR-004 | Init detect existing project | unit | src/commands/init.test.ts | ✅ | |
| TR-001 | GwrkConfigSchema valid/invalid | unit | src/utils/config.test.ts | ✅ | |
| TR-002 | Test cwd resolution to workspace | unit | src/engine/profile-detector.test.ts | ✅ | |
| TR-003 | Test --workspace flag propagation | unit | src/cli.test.ts | ✅ | |
| TR-004 | Test init append behavior | unit | src/commands/init.test.ts | ✅ | |
# Gap Matrix: 014 Plugin System - Phase 1 & 2

## Phase 1: Foundation (Plugin Loader & Registry)

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

## Phase 2: Skill Runtime

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-006 | `gwrk skill <name>` execution | integration | src/commands/skill.test.ts | ✅ | |
| FR-007 | F013 contract (format, signals, --agent) | integration | src/commands/skill.test.ts | ✅ | |
| FR-008 | Compound skill single LLM call | unit | src/plugins/skill-runtime.test.ts | ✅ | |
| FR-009 | Compound skill manifest dependency validation | unit | src/plugins/skill-runtime.test.ts | ✅ | |
| FR-010 | `gwrk skill --help` / `<name> --help` | integration | src/commands/skill.test.ts | ✅ | |
| TC-007 | Single LLM call for compound skills | unit | src/plugins/skill-runtime.test.ts | ✅ | |
| TC-008 | F013 contract inheritance | integration | src/commands/skill.test.ts | ✅ | |
| TR-004 | Skill runtime prompt assembly logic | unit | src/plugins/skill-runtime.test.ts | ✅ | |
| TR-008 | Pipe composition preserves signals | integration | src/commands/skill.test.ts | ✅ | |

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-001 | Auto-detect project type and confirm | unit | src/commands/init.test.ts | ✅ | |
| US-001 | Interactive profile wizard flow | unit | src/commands/init.test.ts | ✅ | |
| US-001 | Detect agent CLIs and config agents | unit | src/commands/init.test.ts | ✅ | |
| US-001 | Workstation provisioning (TCC, SSH, gh) | unit | src/commands/init.test.ts | ✅ | |
| US-001 | Provision Slack channel | unit | src/commands/init.test.ts | ✅ | |
| US-001 | Write .gwrkrc.json | unit | src/commands/init.test.ts | ✅ | |
| US-001 | Scaffold directories and seed plugins | unit | src/commands/init.test.ts | ✅ | |
| US-001 | Idempotency check | unit | src/commands/init.test.ts | ✅ | |
| US-001 | --non-interactive mode | unit | src/commands/init.test.ts | ✅ | |
| US-021 | Workstation provisioning (absorbed) | unit | src/commands/init.test.ts | ✅ | |
| US-027 | Detection rules (pnpm, rust, python, etc) | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027 | gwrk-native detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027 | Unknown project detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027 | Explicit config overrides auto-detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-028 | Prompt conditioning with XML blocks | unit | src/engine/prompt-conditioner.test.ts | ✅ | |
| US-029 | gwrk project info command | unit | src/commands/project-info.test.ts | ✅ | |
| US-031 | Registry cloning | unit | src/engine/registry.test.ts | ✅ | |
| US-032 | Extension discovery | unit | src/engine/extension-detector.test.ts | ✅ | |
| FR-001 | Error: already initialized | unit | src/commands/init.test.ts | ✅ | |
| FR-001 | Error: not a git repo | unit | src/commands/init.test.ts | ✅ | |
| FR-001 | Error: not interactive | unit | src/commands/init.test.ts | ✅ | |
| FR-001 | Error: gh auth failed | unit | src/commands/init.test.ts | ✅ | |
| FR-001 | Error: SSH generation failed | unit | src/commands/init.test.ts | ✅ | |
| FR-032 | GwrkConfigSchema backward compat | unit | src/commands/init.test.ts | ✅ | |
| TR-034 | Prompt snapshot regression | unit | src/engine/profile-detector.test.ts | ✅ | |

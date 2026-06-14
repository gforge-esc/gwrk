| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | `gwrk init` interactive profile wizard | integration | `src/commands/init.test.ts` | ✅ | |
| FR-022 | Workstation provisioning (TCC, SSH, gh) | integration | `src/commands/init.test.ts` | ✅ | |
| FR-030 | Auto-detect project type | unit | `src/engine/profile-detector.test.ts` | ✅ | |
| FR-031 | Extract tech stack details | unit | `src/engine/profile-detector.test.ts` | ✅ | |
| FR-032 | Extend `GwrkConfigSchema` | unit | `src/utils/config.test.ts` | ✅ | |
| FR-044 | Clone plugin registry | unit | `src/engine/registry.test.ts` | ✅ | |
| FR-045 | Extension Discovery | unit | `src/engine/extension-detector.test.ts` | ✅ | |
| US-001 | Interactive profile wizard flow | integration | `src/commands/init.test.ts` | ✅ | |
| US-001 | Agent detection | integration | `src/commands/init.test.ts` | ✅ | |
| US-001 | Slack channel provisioning | integration | `src/commands/init.test.ts` | ✅ | |
| US-001 | Directory scaffolding | integration | `src/commands/init.test.ts` | ✅ | |
| US-001 | Idempotency | integration | `src/commands/init.test.ts` | ✅ | |
| US-001 | `--non-interactive` mode | integration | `src/commands/init.test.ts` | ✅ | |
| US-021 | Workstation provisioning steps | integration | `src/commands/init.test.ts` | ✅ | |
| US-031 | Registry cloning in init | integration | `src/commands/init.test.ts` | ✅ | |
| US-032 | Extension discovery in init | integration | `src/commands/init.test.ts` | ✅ | |

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-001.1 | Auto-detect project type and confirm | integration | src/commands/init.test.ts | ✅ | |
| US-001.2 | Walk through profile sections | integration | src/commands/init.test.ts | ✅ | |
| US-001.3 | Detect agent CLIs | integration | src/commands/init.test.ts | ✅ | |
| US-001.4 | Workstation provisioning (SSH, gh) | integration | src/commands/init.test.ts | ✅ | |
| US-001.5 | Provision Slack channel | integration | src/commands/init.test.ts | ✅ | |
| US-001.7 | Scaffold directories (.gwrk, specs) | integration | src/commands/init.test.ts | ✅ | |
| US-001.9 | Register project in gwrk.db | integration | src/commands/init.test.ts | ✅ | |
| US-001.10 | Idempotency / update offer | integration | src/commands/init.test.ts | ✅ | |
| US-001.11 | --non-interactive mode | integration | src/commands/init.test.ts | ✅ | |
| US-027.1 | pnpm-monorepo detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.2 | rust project detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.3 | python project detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.4 | gwrk-native detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.5 | unknown project detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.6 | explicit config override | unit | src/engine/profile-detector.test.ts | ✅ | |
| FR-001 | gwrk init wizard | integration | src/commands/init.test.ts | ✅ | |
| FR-022 | workstation provisioning | integration | src/commands/init.test.ts | ✅ | |
| FR-030 | Auto-detect project type rules | unit | src/engine/profile-detector.test.ts | ✅ | |
| FR-031 | Extract tech stack details | unit | src/engine/profile-detector.test.ts | ✅ | |
| FR-032 | GwrkConfigSchema extensions | unit | src/utils/config.test.ts | ✅ | |
| TC-011 | Schema backward compatibility | unit | src/utils/config.test.ts | ✅ | |
| TR-001 | Init scaffold + idempotency | integration | src/commands/init.test.ts | ✅ | |
| TR-021 | Init wizard + workstation + setup.json | integration | src/commands/init.test.ts | ✅ | |
| TR-027 | Auto-detection logic | unit | src/engine/profile-detector.test.ts | ✅ | |
| TR-028 | Explicit config override | unit | src/engine/profile-detector.test.ts | ✅ | |
| TR-029 | Gwrk-native detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| TR-030 | Unknown project detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| TR-033 | Config schema backward compat | unit | src/utils/config.test.ts | ✅ | |

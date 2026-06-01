| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-001.1 | Auto-detects project type | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-001.2 | Interactive wizard walkthrough | unit | src/commands/init.test.ts | ✅ | |
| US-001.3 | Detects agent CLIs | unit | src/commands/init.test.ts | ✅ | |
| US-001.4 | Workstation provisioning (TCC/SSH/gh) | unit | src/commands/init.test.ts | ✅ | |
| US-001.5 | Slack channel provisioning | unit | src/commands/init.test.ts | ✅ | |
| US-001.6 | Writes .gwrkrc.json | unit | src/commands/init.test.ts | ✅ | |
| US-001.10 | Idempotency | unit | src/commands/init.test.ts | ✅ | |
| US-001.11 | --non-interactive flag | unit | src/commands/init.test.ts | ✅ | |
| US-027.1 | pnpm-monorepo detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.2 | rust project detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.3 | python project detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.4 | gwrk-native detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.5 | unknown project detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.6 | Config override detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| FR-032 | Schema extension | unit | src/utils/config.test.ts | ✅ | |
| TC-011 | Backward compatibility | unit | src/utils/config.test.ts | ✅ | |

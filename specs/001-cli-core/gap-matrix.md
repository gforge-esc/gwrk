# Gap Matrix - Phase 10: Unified Init

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-001.1 | Auto-detect project type | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-001.2 | Interactive profile wizard sections | unit | src/commands/init.test.ts | ✅ | |
| US-001.4 | Workstation provisioning (SSH, gh) | unit | src/commands/init.test.ts | ✅ | |
| US-001.6 | Writes complete .gwrkrc.json | unit | src/commands/init.test.ts | ✅ | |
| US-001.11 | --non-interactive flag support | unit | src/commands/init.test.ts | ✅ | |
| US-021 | Workstation setup (absorbed) | unit | src/commands/init.test.ts | ✅ | |
| US-027.1 | Detect pnpm-monorepo | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.2 | Detect rust project | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.4 | Detect gwrk-native via docs | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.5 | Handle unknown project gracefully | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-027.6 | Config overrides detection | unit | src/engine/profile-detector.test.ts | ✅ | |
| US-029 | Display resolved project info | unit | src/commands/project-info.test.ts | ✅ | |
| FR-030 | Detect project type signals | unit | src/engine/profile-detector.test.ts | ✅ | |
| FR-031 | Extract tech stack details | unit | src/engine/profile-detector.test.ts | ✅ | |
| FR-032 | GwrkConfigSchema extensions | unit | src/utils/config.test.ts | ✅ | |
| FR-035 | Project info CLI command | unit | src/commands/project-info.test.ts | ✅ | |
| TC-011 | Schema backward compatibility | unit | src/utils/config.test.ts | ✅ | |

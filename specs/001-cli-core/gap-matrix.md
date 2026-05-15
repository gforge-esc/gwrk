# Gap Matrix for Feature 001-cli-core (Phase 9)

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-019 | Execution manifest writer writes to .gwrk/runs/ | unit | src/utils/manifest.test.ts | ✅ | |
| FR-020 | gwrk tasks verify post-merge schema check | integration | src/commands/tasks-verify.test.ts | ✅ | |
| FR-020 | gwrk tasks verify orphan manifest detection | integration | src/commands/tasks-verify.test.ts | ✅ | |
| FR-020 | gwrk tasks verify missing manifest detection | integration | src/commands/tasks-verify.test.ts | ✅ | |
| FR-021 | history.jsonl deprecation (no writes to legacy file) | unit | src/utils/history.test.ts | ✅ | |
| US-019 | Ship/Define runs produce manifests | integration | src/commands/ship.test.ts, src/commands/define.test.ts | ✅ | |
| US-020 | Post-Merge Task Verification reports issues | integration | src/commands/tasks-verify.test.ts | ✅ | |

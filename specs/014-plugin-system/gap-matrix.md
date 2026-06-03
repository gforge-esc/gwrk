| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-014 | Enforcement skills support `framework` manifest field | unit | `src/plugins/manifest.p15.red.test.ts` | ✅ | T013 |
| FR-014 | `resolveEnforcementSkills` filters by `framework` | unit | `src/plugins/skill-runtime.p15.red.test.ts` | ✅ | T013 |
| FR-014 | `resolveEnforcementSkills` filters BUILTIN skills by language | unit | `src/plugins/skill-runtime.p15.red.test.ts` | ✅ | T013 |
| R007 | Project-local enforcement skills ALWAYS load (skip language/framework filtering) | unit | `src/plugins/skill-runtime.p15.red.test.ts` | ✅ | T013 |
| US-016 | Python project doesn't receive TypeScript standards in `plugin list` | e2e | `e2e/014-plugin-system-phase-15.spec.ts` | ✅ | T013 |
| US-016 | `gwrk plugin list --project` correctly applies profile filtering | integration | `src/commands/plugin.p15.red.test.ts` | ✅ | T013 |

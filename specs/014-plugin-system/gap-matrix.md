# Gap Matrix: Phase 10 — .agents/ Decoupling

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-L25-003 | Core workflows independent of `.agents/` | Integration | src/plugins/loader.p10.red.test.ts | ✅ | TR-P10-002 |
| US-011 | Execute workflows without `.agents/` | Integration | src/plugins/loader.p10.red.test.ts | ✅ | TR-P10-002 |
| ADR-007 | No runtime dependency on `.agents/` | Unit | src/plugins/skill-runtime.p10.red.test.ts | ✅ | TR-P10-003 |
| ADR-007 | No `.agents/workflows/` check in Slack | Unit | src/server/slack-agent.p10.red.test.ts | ✅ | TR-P10-004 |
| TC-011 | Rules seeded from builtins during init | Unit | src/commands/init.p10.red.test.ts | ✅ | TR-P10-001 |
| FR-L25-005 | gwrk init provisions global plugin home | Unit | src/commands/init.p10.red.test.ts | ✅ | TR-P10-001 |
| SC-010 | Dead code removal: parser scripts | Unit | src/plugins/loader.p10.red.test.ts | ✅ | TR-P10-001 |
| SC-010 | Dead code removal: legacy workflows | Unit | src/plugins/loader.p10.red.test.ts | ✅ | TR-P10-001 |

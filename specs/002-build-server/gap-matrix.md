| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Start Fastify daemon | unit | src/commands/server.test.ts | ✅ | |
| FR-002 | /health endpoint | unit | src/server/routes/health.test.ts | ✅ | |
| FR-003 | Stop daemon | unit | src/commands/server.test.ts | ✅ | |
| FR-004 | /api/status endpoint | unit | src/server/routes/status.test.ts | ✅ | |
| FR-005 | Convert events to Slack msgs | unit | src/server/slack-notify.test.ts | ✅ | |
| FR-006 | Strict CTA requirement | unit | src/server/slack-notify.test.ts | ✅ | |
| FR-007 | Action triggers CLI | unit | src/server/slack-actions.test.ts | ✅ | |
| FR-008 | Detect sleep via drift | unit | src/server/lifecycle.test.ts | ✅ | |
| FR-009 | Verify net/Slack on wake | unit | src/server/lifecycle.test.ts | ✅ | |
| FR-010 | Network detection | unit | src/server/network.test.ts | ✅ | |
| FR-011 | Execution Ledger | unit | src/db/runs.test.ts | ✅ | |
| FR-012 | Install LaunchAgent | unit | src/commands/server-install.test.ts | ✅ | |
| FR-013 | Uninstall LaunchAgent | unit | src/commands/server-install.test.ts | ✅ | |
| FR-014 | Server logs | unit | src/commands/server-install.test.ts | ✅ | |
| FR-015 | launchctl PID authority | unit | src/server/pid.test.ts | ✅ | |
| US-001 | Start/Stop Build Server | unit | src/commands/server.test.ts | ✅ | |
| US-002 | System Status | unit | src/server/routes/status.test.ts | ✅ | |
| US-003 | Slack Event Bridge | unit | src/server/slack-notify.test.ts | ✅ | |
| US-004 | Slack Bless Actions | unit | src/server/slack-actions.test.ts | ✅ | |
| US-005 | Sleep/Wake Resilience | unit | src/server/lifecycle.test.ts | ✅ | |
| US-006 | Network Awareness | unit | src/server/network.test.ts | ✅ | |
| US-007 | Execution Ledger | unit | src/db/runs.test.ts | ✅ | |
| US-008 | Persistent Service Management | unit | src/commands/server-install.test.ts | ✅ | |
| TR-001 | start/stop, PID management | unit | src/commands/server.test.ts | ✅ | |
| TR-002 | status endpoint shape | unit | src/server/routes/status.test.ts | ✅ | |
| TR-003 | component health reporting | unit | src/server/routes/health.test.ts | ✅ | |
| TR-004 | heartbeat drift, sleep/wake protocol | unit | src/server/lifecycle.test.ts | ✅ | |
| TR-005 | network state detection | unit | src/server/network.test.ts | ✅ | |
| TR-006 | event bridge, message dispatch | unit | src/server/slack-notify.test.ts | ✅ | |
| TR-007 | button handlers, bless actions | unit | src/server/slack-actions.test.ts | ✅ | |
| TR-008 | install/uninstall plist management | unit | src/commands/server-install.test.ts | ✅ | |
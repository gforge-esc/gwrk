| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | gwrk server start/stop PID management | unit | src/commands/server.test.ts | ✅ | TR-001 |
| FR-002 | /health endpoint component reporting | integration | src/server/routes/health.test.ts | ✅ | TR-003 |
| FR-003 | gwrk server stop graceful shutdown | unit | src/commands/server.test.ts | ✅ | TR-001 |
| FR-004 | /api/status returns operational state | integration | src/server/routes/status.test.ts | ✅ | TR-002 |
| FR-005 | ShipOrchestrator events mapped to Slack | unit | src/server/ship-bridge.test.ts | ✅ | TR-006 |
| FR-006 | Slack messages have exactly one primary CTA | unit | src/server/ship-bridge.test.ts | ✅ | TR-006 |
| FR-007 | Button taps trigger pipeline actions | unit | src/server/slack-actions.test.ts | ✅ | TR-007 |
| FR-008 | Sleep detection via heartbeat drift | unit | src/server/lifecycle.test.ts | ✅ | TR-004 |
| FR-009 | Wake verification (network + Slack) | integration | src/server/lifecycle.test.ts | ✅ | TR-004 |
| FR-010 | Network state monitoring | unit | src/server/network.test.ts | ✅ | TR-005 |
| FR-011 | Agent dispatch recorded in SQLite | unit | src/db/runs.test.ts | ✅ | TR-007 |
| US-001 | CLI start/stop lifecycle | unit | src/commands/server.test.ts | ✅ | TR-001 |
| US-002 | gwrk status reflects system resources | integration | src/server/routes/status.test.ts | ✅ | TR-002 |
| US-003 | Ship completion → Review Ready message | unit | src/server/ship-bridge.test.ts | ✅ | TR-006 |
| US-004 | Approve Spec/Plan advances pipeline | unit | src/server/slack-actions.test.ts | ✅ | TR-007 |
| US-005 | Sleep/wake resilience | unit | src/server/lifecycle.test.ts | ✅ | TR-004 |
| US-006 | Network awareness | unit | src/server/network.test.ts | ✅ | TR-005 |
| US-007 | Execution ledger queryable | unit | src/db/runs.test.ts | ✅ | TR-007 |

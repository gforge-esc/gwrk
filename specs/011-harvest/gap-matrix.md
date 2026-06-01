| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-H01 | Merge Triggers Harvest | integration | tests/server-github.test.ts | ✅ | |
| US-H02 | Log Finalization | integration | src/engine/harvest.test.ts | ✅ | |
| US-H03 | DB Record Finalization | unit | src/db/runs.test.ts | ✅ | |
| US-H04 | Compression Calculation | unit | src/engine/compression.test.ts | ✅ | |
| US-H05 | Done, Done! Notification | e2e | tests/harvest-e2e.test.ts | ✅ | |
| US-H06 | Branch Cleanup | e2e | tests/harvest-e2e.test.ts | ✅ | |
| US-H07 | Post-Ship Issue Capture | integration | tests/server-github.test.ts | ✅ | |
| FR-H01 | Webhook on PR merge | integration | tests/server-github.test.ts | ✅ | |
| FR-H02 | Commit raw logs | integration | src/engine/harvest.test.ts | ✅ | |
| FR-H03 | Finalize SQLite run record | unit | src/db/runs.test.ts | ✅ | |
| FR-H04 | Point Compression | unit | src/engine/compression.test.ts | ✅ | |
| FR-H05 | Total Compression | unit | src/engine/compression.test.ts | ✅ | |
| FR-H06 | Compression DB insertion | unit | src/db/compression.test.ts | ✅ | |
| FR-H07 | Slack Done-Done message | e2e | tests/harvest-e2e.test.ts | ✅ | |
| FR-H08 | Delete phase branch | e2e | tests/harvest-e2e.test.ts | ✅ | |
| FR-H09 | Phase completion tracking | integration | src/engine/harvest.test.ts | ✅ | |
| FR-H10 | Harvest idempotency check | integration | src/engine/harvest.test.ts | ✅ | |
| FR-H11 | Prevent double notification | integration | tests/server-github.test.ts | ✅ | |
| FR-H12 | Post-Ship GitHub webhook handler | integration | tests/server-github.test.ts | ✅ | |
| FR-H13 | Issue-to-feature mapping logic | integration | tests/server-github.test.ts | ✅ | |
| FR-H14 | SQLite issues table persistence | unit | src/db/issues.test.ts | ✅ | |
| FR-H15 | Slack notification for issues | integration | tests/server-github.test.ts | ✅ | |
| TR-H01 | Webhook ignores non-trunk targets | integration | tests/server-github.test.ts | ✅ | |
| TR-H02 | Harvest idempotency guard test | integration | src/engine/harvest.test.ts | ✅ | |
| TR-H03 | finishRun updates DB correctly | unit | src/db/runs.test.ts | ✅ | |
| TR-H04 | Logs moved and index generated | integration | src/engine/harvest.test.ts | ✅ | |
| TR-H05 | Verify branch deletion command | e2e | tests/harvest-e2e.test.ts | ✅ | |
| TR-H06 | Point compression math | unit | src/engine/compression.test.ts | ✅ | |
| TR-H07 | Total compression math | unit | src/engine/compression.test.ts | ✅ | |
| TR-H08 | Slack notified exactly once | e2e | tests/harvest-e2e.test.ts | ✅ | |
| TR-H09 | issues.opened maps via label | integration | tests/server-github.test.ts | ✅ | |
| TR-H10 | issues.opened resolves via title | integration | tests/server-github.test.ts | ✅ | |
| TR-H11 | Issue transitions open to closed | unit | src/db/issues.test.ts | ✅ | |

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-H01 | GitHub webhook triggers harvest | integration | src/server/github.test.ts | ✅ | |
| US-H02 | Log finalization & indexing | unit | src/engine/harvest.test.ts | ✅ | |
| US-H03 | DB record finalization | unit | src/db/runs.test.ts | ✅ | |
| US-H04 | Compression calculation | unit | src/engine/harvest.test.ts | ✅ | |
| US-H05 | Done, Done! Slack notification | integration | src/engine/harvest.test.ts | ✅ | |
| US-H06 | Branch cleanup | integration | src/engine/harvest.test.ts | ✅ | |
| FR-H01 | Webhook handler with signature | integration | src/server/github.test.ts | ✅ | |
| FR-H02 | Git-committed logs + index.json | unit | src/engine/harvest.test.ts | ✅ | |
| FR-H03 | finishRun with merge metadata | unit | src/db/runs.test.ts | ✅ | |
| FR-H04 | Point Compression calculation | unit | src/engine/harvest.test.ts | ✅ | |
| FR-H05 | Total Compression calculation | unit | src/engine/harvest.test.ts | ✅ | |
| FR-H06 | recordCompression in SQLite | unit | src/db/compression.test.ts | ✅ | |
| FR-H07 | Slack Done-Done message format | unit | src/engine/harvest.test.ts | ✅ | |
| FR-H08 | Remote branch deletion logic | unit | src/engine/harvest.test.ts | ✅ | |
| FR-H09 | Phase rollup PR discrimination | integration | src/server/github.test.ts | ✅ | |
| TC-H01 | Webhook-triggered (not polling) | integration | src/server/github.test.ts | ✅ | |
| TC-H02 | Idempotent harvest | integration | src/engine/harvest.test.ts | ✅ | |
| TC-H03 | Fail-fast on missing secret | unit | src/utils/config.test.ts | ✅ | |
| TC-H04 | Git timestamps for compression | unit | src/engine/harvest.test.ts | ✅ | |
| SC-H01 | Webhook merge triggers harvest | integration | src/server/github.test.ts | ✅ | |
| SC-H02 | Logs, DB, Compression updated | integration | tests/harvest-e2e.test.ts | ✅ | |
| SC-H03 | Slack "🏆 Done, Done!" posted | integration | src/engine/harvest.test.ts | ✅ | |
| SC-H04 | Idempotent re-run safety | integration | src/engine/harvest.test.ts | ✅ | |
| SC-H05 | CLI gwrk harvest --help | e2e | src/cli.harvest.e2e.test.ts | ✅ | |
| FR-H10 | Idempotency guard (compression table lookup) | unit | src/engine/harvest.test.ts | ❌ | Phase 6 |
| FR-H11 | Single Slack notification (no webhook dedup) | integration | tests/server-github.test.ts | ❌ | Phase 6 |

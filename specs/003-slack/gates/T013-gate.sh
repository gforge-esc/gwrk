#!/bin/bash
set -euo pipefail
# Gate: T013 — Implement test strategy for Phase 7
# Asserts: Derived from task description


# Phase Acceptance Criteria
curl -s -X POST http://localhost:18790/api/notify -H 'Content-Type: application/json' -d '{"type":"phase_start","feature":"test","phase":"phase-01","branch":"feat/test","backend":"gemini"}' | jq -e '.ok == true'
pnpm vitest run src/server/routes/notify.test.ts
grep -q 'notifySlack' src/server/routes/notify.ts
gwrk ship
pnpm build

echo "PASS: T013 — Implement test strategy for Phase 7"

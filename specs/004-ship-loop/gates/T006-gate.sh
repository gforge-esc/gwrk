#!/bin/bash
set -euo pipefail
# Gate: T006 — Implement test strategy for Phase 1
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.


# Phase Acceptance Criteria (Done When)
pnpm vitest run src/commands/ship.test.ts
grep -q 'emit_event' scripts/dev/work-until-done.sh
grep -qE 'cancelled|canceled' src/commands/ship.ts
jq -e '.digest' src/utils/manifest.ts 2>/dev/null || grep -q 'digest' src/utils/manifest.ts

echo "PASS: T006 — Implement test strategy for Phase 1"

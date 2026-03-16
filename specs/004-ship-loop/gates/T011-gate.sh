#!/bin/bash
set -euo pipefail
# Gate: T011 — Implement test strategy for Phase 2
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.


# Phase Acceptance Criteria (Done When)
grep -qE 'failureContext|failure_context' scripts/dev/work-until-done.sh
grep -q 'validate-staging' scripts/dev/work-until-done.sh
grep -qE 'porcelain|Dirty working tree' scripts/dev/wud-branch.sh
pnpm vitest run src/scripts-e2e.test.ts

echo "PASS: T011 — Implement test strategy for Phase 2"

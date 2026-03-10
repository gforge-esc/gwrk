#!/bin/bash
set -euo pipefail
# Gate: T013 — Implement test strategy for Phase 3
# Asserts: Derived from task description


# Phase Acceptance Criteria
gwrk ship 004-ship-loop 1 --dry-run 2>&1 | grep -q 'DRY RUN'
gwrk ship 004-ship-loop --dry-run 2>&1 | grep -c 'DRY RUN'
gwrk ship --help 2>&1 | grep -q '\-\-ci-timeout'
gwrk ship --help 2>&1 | grep -qv 'done'
npx tsc --noEmit
pnpm test -- --reporter=dot 2>&1 | grep -q 'Tests.*passed'

echo "PASS: T013 — Implement test strategy for Phase 3"

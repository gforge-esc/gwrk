#!/bin/bash
set -euo pipefail
# Gate: T009 — Implement test strategy for Phase 2
# Asserts: Derived from task description


# Phase Acceptance Criteria
grep -c 'review-code\|review-uat' scripts/dev/work-until-done.sh
>= 2
grep -c 'wud-verdict' scripts/dev/work-until-done.sh
>= 1
pnpm test -- --reporter=dot 2>&1 | grep -q 'Tests.*passed'

echo "PASS: T009 — Implement test strategy for Phase 2"

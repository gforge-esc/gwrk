#!/bin/bash
set -euo pipefail
# Gate: T011 — Implement test strategy for Phase 2
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.


# Phase Acceptance Criteria (Done When)
grep -cE "✅|⚠️|❌" specs/001-cli-core/gap-analysis.md | xargs test 0 -lt
grep -cE "✅|⚠️|❌" specs/002-build-server/gap-analysis.md | xargs test 0 -lt

echo "PASS: T011 — Implement test strategy for Phase 2"

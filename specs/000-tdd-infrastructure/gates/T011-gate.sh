#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T011 — Implement test strategy for Phase 2
grep -cE "✅|⚠️|❌" specs/001-cli-core/gap-analysis.md | xargs test 0 -lt
grep -cE "✅|⚠️|❌" specs/002-build-server/gap-analysis.md | xargs test 0 -lt
echo "PASS: T011 — Implement test strategy for Phase 2"

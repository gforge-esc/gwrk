#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T009 — Implement specs/001-cli-core/gap-analysis.md
test -f specs/001-cli-core/gap-analysis.md
grep -cE "✅|⚠️|❌" specs/001-cli-core/gap-analysis.md | xargs test 0 -lt
echo "PASS: T009 — Implement specs/001-cli-core/gap-analysis.md"

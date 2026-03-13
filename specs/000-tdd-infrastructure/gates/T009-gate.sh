#!/bin/bash
set -euo pipefail
# Gate: T009 — Implement specs/001-cli-core/gap-analysis.md
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Done When (from plan)
grep -cE "✅|⚠️|❌" specs/001-cli-core/gap-analysis.md | xargs test 0 -lt
grep -cE "✅|⚠️|❌" specs/002-build-server/gap-analysis.md | xargs test 0 -lt

echo "PASS: T009 — Implement specs/001-cli-core/gap-analysis.md"

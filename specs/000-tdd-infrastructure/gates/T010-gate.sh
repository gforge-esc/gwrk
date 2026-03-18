#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T010 — Implement specs/002-build-server/gap-analysis.md
test -f specs/002-build-server/gap-analysis.md
grep -q "✅" specs/002-build-server/gap-analysis.md
grep -q "⚠️" specs/002-build-server/gap-analysis.md
grep -q "❌" specs/002-build-server/gap-analysis.md
echo "PASS: T010 — Implement specs/002-build-server/gap-analysis.md"

#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
test -f specs/004-ship-loop/gap-analysis.md || { echo "FAIL: gap-analysis.md missing"; exit 1; }
grep -qE 'FR-017|FR-018|FR-016|FR-014' specs/004-ship-loop/gap-analysis.md || { echo "FAIL: gap-analysis stale"; exit 1; }
echo "PASS: T011 — gap-analysis.md current"

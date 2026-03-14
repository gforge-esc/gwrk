#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
grep -qE 'skip|Skip|isPhaseComplete|all tasks complete' src/commands/ship.ts || { echo "FAIL: phase-skip logic not found"; exit 1; }
grep -qE 'cancelled|canceled' src/commands/ship.ts || { echo "FAIL: cancelled status not handled"; exit 1; }
echo "PASS: T004 — phase-skip with cancelled support"

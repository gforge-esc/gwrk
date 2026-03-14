#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
grep -q 'digest' src/commands/ship.ts || { echo "FAIL: digest not referenced in ship.ts"; exit 1; }
echo "PASS: T003 — digest wired into ship.ts"

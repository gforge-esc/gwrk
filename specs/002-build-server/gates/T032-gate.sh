#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/monitor.ts || { echo "FAIL: T032 — file not found: src/server/monitor.ts" >&2; exit 1; }
grep -q 'export class SystemMonitor' src/server/monitor.ts || { echo "FAIL: T032 — src/server/monitor.ts missing 'SystemMonitor'" >&2; exit 1; }
echo "PASS: T032 — Implement src/server/monitor.ts"

#!/bin/bash
set -euo pipefail
# Gate: T009 — Implement src/server/monitor.ts
# Asserts: Derived from task description

test -f src/server/monitor.ts
# Required identifiers
grep -q 'SystemMonitor' src/server/monitor.ts

echo "PASS: T009 — Implement src/server/monitor.ts"

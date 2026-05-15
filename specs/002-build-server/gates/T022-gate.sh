#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/lifecycle.ts || { echo "FAIL: T022 — file not found: src/server/lifecycle.ts" >&2; exit 1; }
grep -q 'export class LifecycleMonitor' src/server/lifecycle.ts || { echo "FAIL: T022 — src/server/lifecycle.ts missing 'LifecycleMonitor'" >&2; exit 1; }
grep -q 'server:sleep' src/server/lifecycle.ts || { echo "FAIL: T022 — src/server/lifecycle.ts missing 'server:sleep' event" >&2; exit 1; }
echo "PASS: T022 — Implement src/server/lifecycle.ts"

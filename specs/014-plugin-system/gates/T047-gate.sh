#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/status.ts || { echo "FAIL: T047 — file not found: src/commands/status.ts" >&2; exit 1; }
grep -q 'import { quotaProbe }' src/commands/status.ts || { echo "FAIL: T047 — src/commands/status.ts missing 'import { quotaProbe }'" >&2; exit 1; }

echo "PASS: T047 — Implement src/commands/status.ts"

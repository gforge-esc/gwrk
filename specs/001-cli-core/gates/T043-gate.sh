#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/utils/setup-state.ts || { echo "FAIL: T043 — file not found: src/utils/setup-state.ts" >&2; exit 1; }
grep -q 'SetupState' src/utils/setup-state.ts || { echo "FAIL: T043 — src/utils/setup-state.ts missing 'SetupState'" >&2; exit 1; }
grep -q 'loadSetupState' src/utils/setup-state.ts || { echo "FAIL: T043 — src/utils/setup-state.ts missing 'loadSetupState'" >&2; exit 1; }
grep -q 'saveSetupState' src/utils/setup-state.ts || { echo "FAIL: T043 — src/utils/setup-state.ts missing 'saveSetupState'" >&2; exit 1; }

echo "PASS: T043 — Implement src/utils/setup-state.ts"

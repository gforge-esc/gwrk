#!/bin/bash
# AUTHORED
set -euo pipefail

# TR-P9-001: resolveEnforcementSkills() returns builtin SKILL.md content
test -f src/plugins/enforcement.p9.red.test.ts \
  || { echo "FAIL: TR-P9-001 — test file not found: src/plugins/enforcement.p9.red.test.ts" >&2; exit 1; }

pnpm vitest run src/plugins/enforcement.p9.red.test.ts -t "TR-P9-001" --reporter=verbose \
  || { echo "FAIL: TR-P9-001 — vitest failed for TR-P9-001" >&2; exit 1; }

echo "PASS: TR-P9-001 — resolveEnforcementSkills() returns builtin content"

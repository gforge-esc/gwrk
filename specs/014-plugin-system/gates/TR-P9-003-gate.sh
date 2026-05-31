#!/bin/bash
# AUTHORED
set -euo pipefail

# TR-P9-003: tier: enforcement validates in SkillManifestSchema
test -f src/plugins/enforcement.p9.red.test.ts \
  || { echo "FAIL: TR-P9-003 — test file not found: src/plugins/enforcement.p9.red.test.ts" >&2; exit 1; }

pnpm vitest run src/plugins/enforcement.p9.red.test.ts -t "TR-P9-003" --reporter=verbose \
  || { echo "FAIL: TR-P9-003 — vitest failed for TR-P9-003" >&2; exit 1; }

echo "PASS: TR-P9-003 — tier: enforcement validates in SkillManifestSchema"

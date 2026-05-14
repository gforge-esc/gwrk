#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T056 — Implement src/commands/tests-generate.ts (quiet: true)

test -f src/commands/tests-generate.ts \
  || { echo "FAIL: T056 — file not found: src/commands/tests-generate.ts" >&2; exit 1; }

grep -q 'runtime.executeWorkflow' src/commands/tests-generate.ts \
  || { echo "FAIL: T056 — src/commands/tests-generate.ts missing 'runtime.executeWorkflow'" >&2; exit 1; }

grep -q 'resolveFeature' src/commands/tests-generate.ts \
  || { echo "FAIL: T056 — src/commands/tests-generate.ts missing 'resolveFeature'" >&2; exit 1; }

echo "PASS: T056 — Implement src/commands/tests-generate.ts"

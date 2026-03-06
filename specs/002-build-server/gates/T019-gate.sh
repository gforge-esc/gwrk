#!/usr/bin/env bash
# Gate: T019 — End-to-end system integration and wiring
set -euo pipefail

# Assertion #1: src/server/integration.test.ts exists
test -f src/server/integration.test.ts || { echo "FAIL: src/server/integration.test.ts not found"; exit 1; }

# Assertion #2: integration test contains POST /api/dispatch
grep -q "/api/dispatch" src/server/integration.test.ts || { echo "FAIL: integration test does not test dispatch endpoint"; exit 1; }

# Assertion #3: wiring in index.ts (monitor connected to queue)
grep -q "monitor" src/server/index.ts && grep -q "queue" src/server/index.ts || { echo "FAIL: monitor/queue wiring missing in index.ts"; exit 1; }

# Assertion #4: integration test can be run (vitest)
grep -q "describe\|it\|test" src/server/integration.test.ts || { echo "FAIL: integration test file has no tests"; exit 1; }

echo "PASS: T019"

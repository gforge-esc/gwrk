#!/bin/bash
set -euo pipefail
# Gate: T023 — Implement src/server/model-selector.test.ts
# Asserts: TR-008 model selection by tier, TR-010 command template injection

test -f src/server/model-selector.test.ts

# Verify key test requirements exist
grep -q 'thinking' src/server/model-selector.test.ts
grep -q 'fast' src/server/model-selector.test.ts
grep -q 'renderCommand\|{{model}}' src/server/model-selector.test.ts

echo "PASS: T023 — Implement src/server/model-selector.test.ts"

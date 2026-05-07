#!/bin/bash
set -euo pipefail
# Gate: T022 — Implement src/server/model-selector.ts
# Asserts: ModelSelector with selectModel() and renderCommand()

test -f src/server/model-selector.ts

# Verify core functions exist
grep -q 'selectModel' src/server/model-selector.ts
grep -q 'renderCommand' src/server/model-selector.ts
grep -q '{{model}}' src/server/model-selector.ts

# Run model selector tests
pnpm vitest run src/server/model-selector.test.ts

echo "PASS: T022 — Implement src/server/model-selector.ts"

#!/bin/bash
set -euo pipefail
# Gate: T016 — Create task classification engine
# Source: plan Phase 3.3
# AUTHORED

# Assertion #1: classify.ts exists
test -f src/engine/classify.ts

# Assertion #2: classifyTask or classify function exported
grep -qE 'export.*classifyTask|export.*classify' src/engine/classify.ts

# Assertion #3: All four classification types present
grep -q 'greenfield' src/engine/classify.ts
grep -q 'change' src/engine/classify.ts
grep -q 'refactor' src/engine/classify.ts
grep -q 'noop' src/engine/classify.ts

# Assertion #4: File existence check logic (for greenfield detection)
grep -qE 'existsSync|access' src/engine/classify.ts

# Assertion #5: Classification stored in tasks.json when generated
grep -q 'classification' src/commands/tasks-generate.ts || grep -q 'classification' src/utils/state.ts

echo "PASS: T016 — Create task classification engine"

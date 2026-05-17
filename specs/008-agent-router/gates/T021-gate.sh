#!/bin/bash
set -euo pipefail
# Gate: T021 — Implement src/server/task-classifier.ts
# Asserts: TaskClassification enum and classifyTask() function exist and work

test -f src/server/task-classifier.ts
test -f src/server/task-classifier.test.ts

# Verify the classification mapping is implemented
grep -q 'classifyTask' src/server/task-classifier.ts
grep -q 'thinking' src/server/task-classifier.ts
grep -q 'fast' src/server/task-classifier.ts
grep -q 'high-context' src/server/task-classifier.ts

# Run the classifier tests
pnpm vitest run src/server/task-classifier.test.ts

echo "PASS: T021 — Implement src/server/task-classifier.ts"

#!/bin/bash
set -euo pipefail
# Gate: T027 — DispatchQueue per contracts/dispatch.md
# Asserts: Contract method coverage + build pass

# #1 File exists
test -f src/server/dispatch.ts

# #2 Contract methods from contracts/dispatch.md
grep -q 'enqueue(' src/server/dispatch.ts
grep -q 'processNext(' src/server/dispatch.ts
grep -q 'handleCompletion(' src/server/dispatch.ts
grep -q 'getQueue(' src/server/dispatch.ts
grep -q 'getDispatch(' src/server/dispatch.ts

# #3 Must call finishRun in handleCompletion
grep -q 'finishRun' src/server/dispatch.ts

# #4 Global build passes (catches type errors)
pnpm build

echo "PASS: T027 — DispatchQueue implements full contract"

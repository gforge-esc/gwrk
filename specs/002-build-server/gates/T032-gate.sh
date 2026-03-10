#!/bin/bash
set -euo pipefail
# Gate: T032 — Server wires DispatchQueue to routes
# Asserts: Integration points + build pass

# #1 File exists
test -f src/server/index.ts

# #2 Imports and wires dispatch
grep -q 'DispatchQueue' src/server/index.ts
grep -q 'statusRoutes' src/server/index.ts
grep -q 'dispatchRoutes' src/server/index.ts

# #3 Global build passes (catches broken imports and missing methods)
pnpm build

echo "PASS: T032 — Server integration compiles"

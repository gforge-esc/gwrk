#!/bin/bash
set -euo pipefail
# Gate: T008 — Create project discovery engine
# Source: contracts/discover.md, DM-001, TC-004
# AUTHORED

# Assertion #1: discover.ts exists
test -f src/engine/discover.ts

# Assertion #2: discoverProject function exported
grep -qE 'export.*discoverProject|export.*function discoverProject' src/engine/discover.ts

# Assertion #3: ProjectDiscovery schema fields present
grep -q 'project' src/engine/discover.ts
grep -q 'specs' src/engine/discover.ts
grep -q 'gates' src/engine/discover.ts
grep -q 'config' src/engine/discover.ts

# Assertion #4: Uses git commands for state (not sqlite)
grep -q 'git' src/engine/discover.ts && grep -qE 'status|branch|log' src/engine/discover.ts

# Assertion #5: Does NOT import from db/ (TC-004 violation)
DB_IMPORT=$(grep -c 'from.*db/' src/engine/discover.ts 2>/dev/null || true)
[ "$DB_IMPORT" -eq 0 ] || { echo "FAIL: discover.ts imports from db/ — violates TC-004"; exit 1; }

# Assertion #6: Does NOT call localhost:18790 (TC-004 violation)
SERVER_CALL=$(grep -cE 'localhost:18790|127\.0\.0\.1:18790' src/engine/discover.ts 2>/dev/null || true)
[ "$SERVER_CALL" -eq 0 ] || { echo "FAIL: discover.ts calls server — violates TC-004"; exit 1; }

# Assertion #7: Test file exists and passes
test -f src/engine/discover.test.ts
pnpm vitest run src/engine/discover.test.ts > /dev/null 2>&1 || { echo "FAIL: discover.test.ts tests failed"; exit 1; }

echo "PASS: T008 — Create project discovery engine"

#!/usr/bin/env bash
# Gate: T009 — Define shared domain types
set -euo pipefail

# Assertion #1: src/server/types.ts exists
test -f src/server/types.ts || { echo "FAIL: src/server/types.ts not found"; exit 1; }

# Assertion #2: DispatchRecord type/schema exported
grep -q "export.*DispatchRecord" src/server/types.ts || { echo "FAIL: DispatchRecord not exported"; exit 1; }

# Assertion #3: DispatchStatus type/schema exported
grep -q "export.*DispatchStatus" src/server/types.ts || { echo "FAIL: DispatchStatus not exported"; exit 1; }

# Assertion #4: SystemStatus type/schema exported
grep -q "export.*SystemStatus" src/server/types.ts || { echo "FAIL: SystemStatus not exported"; exit 1; }

# Assertion #5: SandboxInfo type/schema exported
grep -q "export.*SandboxInfo" src/server/types.ts || { echo "FAIL: SandboxInfo not exported"; exit 1; }

echo "PASS: T009"

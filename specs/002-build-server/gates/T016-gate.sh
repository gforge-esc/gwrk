#!/usr/bin/env bash
# Gate: T016 — Implement core Dispatch Queue engine
set -euo pipefail

# Assertion #1: src/server/dispatch.ts exists
test -f src/server/dispatch.ts || { echo "FAIL: src/server/dispatch.ts not found"; exit 1; }

# Assertion #2: DispatchQueue class exported
grep -q "export.*class DispatchQueue" src/server/dispatch.ts || { echo "FAIL: DispatchQueue class not exported"; exit 1; }

# Assertion #3: enqueue method exported/exists
grep -q "enqueue" src/server/dispatch.ts || { echo "FAIL: enqueue method missing"; exit 1; }

# Assertion #4: processNext method exported/exists
grep -q "processNext" src/server/dispatch.ts || { echo "FAIL: processNext method missing"; exit 1; }

# Assertion #5: maxClones check in processNext
grep -q "maxClones" src/server/dispatch.ts || { echo "FAIL: maxClones throttle check missing in processNext"; exit 1; }

# Assertion #6: isThrottled check in processNext
grep -q "isThrottled" src/server/dispatch.ts || { echo "FAIL: isThrottled check missing in processNext"; exit 1; }

echo "PASS: T016"

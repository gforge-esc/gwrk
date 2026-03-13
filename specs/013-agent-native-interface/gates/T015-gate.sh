#!/bin/bash
set -euo pipefail
# Gate: T015 — Add stdin acceptance to define plan
# Source: plan Phase 3.2
# AUTHORED

# Assertion #1: stdin.isTTY check in define.ts or plan.ts
grep -q 'isTTY\|stdin' src/commands/define.ts || grep -q 'isTTY\|stdin' src/commands/plan.ts || { echo "FAIL: no stdin detection in define/plan"; exit 1; }

# Assertion #2: Writes context to /tmp
grep -q '/tmp/gwrk-discovery' src/commands/define.ts || grep -q '/tmp/gwrk-discovery' src/commands/plan.ts || { echo "FAIL: no /tmp context file path"; exit 1; }

# Assertion #3: readStdin utility exists
grep -rq 'readStdin' src/utils/ src/commands/ || { echo "FAIL: readStdin not found"; exit 1; }

echo "PASS: T015 — Add stdin acceptance to define plan"

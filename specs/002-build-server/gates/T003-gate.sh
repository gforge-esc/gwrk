#!/bin/bash
set -euo pipefail
# Gate: T003 — Implement src/server/pid.ts
# Asserts: Derived from task description

test -f src/server/pid.ts
# Required identifiers
grep -q 'writePid' src/server/pid.ts
grep -q 'readPid' src/server/pid.ts
grep -q 'removePid' src/server/pid.ts

echo "PASS: T003 — Implement src/server/pid.ts"

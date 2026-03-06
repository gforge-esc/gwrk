#!/usr/bin/env bash
# Gate: T003 — Implement PID management utility
set -euo pipefail

# Assertion #1: src/server/pid.ts exists
test -f src/server/pid.ts || { echo "FAIL: src/server/pid.ts not found"; exit 1; }

# Assertion #2: writePid function exists and exports
grep -q "export.*writePid" src/server/pid.ts || { echo "FAIL: writePid function not exported"; exit 1; }

# Assertion #3: readPid function exists and exports
grep -q "export.*readPid" src/server/pid.ts || { echo "FAIL: readPid function not exported"; exit 1; }

# Assertion #4: removePid function exists and exports
grep -q "export.*removePid" src/server/pid.ts || { echo "FAIL: removePid function not exported"; exit 1; }

# Assertion #5: readPid performs process check (kill pid, 0)
grep -q "kill(.*0)" src/server/pid.ts || { echo "FAIL: readPid does not check process liveness"; exit 1; }

echo "PASS: T003"

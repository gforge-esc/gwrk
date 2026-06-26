#!/bin/bash
set -euo pipefail
# AUTHORED — updated: 'new' command was never created as a standalone;
# project initialization lives in init.ts

test -f src/commands/init.ts \
  || { echo "FAIL: T033 — file not found: src/commands/init.ts" >&2; exit 1; }
grep -q 'initCommand' src/commands/init.ts \
  || { echo "FAIL: T033 — src/commands/init.ts missing 'initCommand'" >&2; exit 1; }

echo "PASS: T033 — Init command (was planned as 'new')"

#!/bin/bash
set -euo pipefail
# Gate: T035 — Delete src/commands/run.ts (dead run group)
# Asserts: Derived from task description

! test -f src/commands/run.ts

echo "PASS: T035 — Delete src/commands/run.ts"

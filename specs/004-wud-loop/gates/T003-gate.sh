#!/usr/bin/env bash
# Gate: T003 — Create WUD run logger
# Contract: plan.md Phase 1 (DM-002)
set -euo pipefail

FILE="src/utils/log.ts"

# #1 File must exist
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist" >&2; exit 1; }

# #2 Must export a logger class or factory function
grep -qE 'export.*(class|function).*[Ll]og' "$FILE" || \
  { echo "FAIL #2: Logger not exported from $FILE" >&2; exit 1; }

# #3 Must support INFO log level
grep -q 'INFO' "$FILE" || \
  { echo "FAIL #3: Must define INFO log level" >&2; exit 1; }

# #4 Must support ERROR log level
grep -q 'ERROR' "$FILE" || \
  { echo "FAIL #4: Must define ERROR log level" >&2; exit 1; }

# #5 Must support STAGE log level
grep -q 'STAGE' "$FILE" || \
  { echo "FAIL #5: Must define STAGE log level" >&2; exit 1; }

# #6 Must write to .runs/ directory
grep -q '\.runs' "$FILE" || \
  { echo "FAIL #6: Must reference .runs/ directory for log output" >&2; exit 1; }

echo "PASS: T003 — log.ts exports logger with INFO/ERROR/STAGE levels"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T001 — Implement scripts/dev/work-until-done.sh

FILE="scripts/dev/work-until-done.sh"

# Assertion 1: File exists and is executable
test -f "$FILE"
test -x "$FILE"

# Assertion 2: emit_event function exists and writes to EVENTS_FILE
grep -q "emit_event()" "$FILE"
grep -q "echo \".*\" >> \"\$EVENTS_FILE\"" "$FILE"

# Assertion 3: Pre-flight gate check exists
grep -q "Pre-flight gate check" "$FILE"
grep -q "jq -r .* '.phases\[\] | select(.id == \$p) | .tasks\[\] | select(.status == \"open\") | .gateScript // empty'" "$FILE"

# Assertion 4: log function exists and writes to WUD_LOG
grep -q "log()" "$FILE"
grep -q "tee -a \"\$WUD_LOG\"" "$FILE"

echo "PASS: T001 — scripts/dev/work-until-done.sh implementation verified"

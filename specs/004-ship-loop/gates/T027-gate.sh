#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T027 — Implement scripts/dev/work-until-done.sh: replace direct CLI invocation with gwrk dispatch

FILE="scripts/dev/work-until-done.sh"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: work-until-done.sh calls gwrk dispatch
grep -q "gwrk dispatch" "$FILE"

echo "PASS: T027 — scripts/dev/work-until-done.sh implementation verified"

#!/usr/bin/env bash
# Gate: T008 — Extend GwrkConfigSchema with parallelism config
set -euo pipefail

FILE="src/utils/config.ts"

# Assertion #1
grep -q 'parallelism' "$FILE" || { echo "FAIL: 'parallelism' block missing from schema"; exit 1; }
# Assertion #2
grep -q 'maxClones' "$FILE" || { echo "FAIL: 'maxClones' missing from parallelism config"; exit 1; }
# Assertion #3
grep -q 'maxCpu' "$FILE" || { echo "FAIL: 'maxCpu' missing from parallelism config"; exit 1; }
# Assertion #4
grep -q 'maxMem' "$FILE" || { echo "FAIL: 'maxMem' missing from parallelism config"; exit 1; }
# Assertion #5
grep -q 'minDiskGb' "$FILE" || { echo "FAIL: 'minDiskGb' missing from parallelism config"; exit 1; }
# Assertion #6
grep -q 'maxConcurrent' "$FILE" || { echo "FAIL: 'maxConcurrent' missing from cloud config"; exit 1; }

# Verify no .default() calls on parallelism fields
# Assertion #7
! grep -E 'parallelism.*\.default\(|maxClones.*\.default\(|maxCpu.*\.default\(' "$FILE" || { echo "FAIL: .default() found on parallelism fields"; exit 1; }

echo "PASS: T008"

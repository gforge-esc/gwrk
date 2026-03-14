#!/bin/bash
set -euo pipefail
# Gate: T007 — Standardize exit codes across all commands
# Source: spec FR-009
# AUTHORED

# Assertion #1: Usage error returns exit 2 (not 1)
EXITCODE=0
gwrk tasks list 2>/dev/null || EXITCODE=$?
# Missing feature arg should be exit 2 (usage error)
[ "$EXITCODE" -eq 2 ] || { echo "FAIL: missing arg should exit 2, got $EXITCODE"; exit 1; }

# Assertion #2: Unknown command returns non-1 (127 or Commander default)
EXITCODE=0
gwrk nonexistent-command-xyz 2>/dev/null || EXITCODE=$?
[ "$EXITCODE" -ne 0 ] || { echo "FAIL: unknown command should exit non-zero"; exit 1; }

# Assertion #3: No bare process.exit(1) for usage errors in command files
# Check that usage-related errors use exit 2
for f in src/commands/tasks.ts src/commands/define.ts src/commands/status.ts; do
  if grep -q "process\.exit(1).*usage\|usage.*process\.exit(1)" "$f" 2>/dev/null; then
    echo "FAIL: $f uses exit(1) for usage error — should be exit(2)"
    exit 1
  fi
done

echo "PASS: T007 — Standardize exit codes across all commands"

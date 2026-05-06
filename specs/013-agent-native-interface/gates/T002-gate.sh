#!/bin/bash
set -euo pipefail
# Gate: T002 — Wrap all command actions with withSignal()
# Source: contracts/signal.md — every command action must be wrapped
# AUTHORED

# Assertion #1: withSignal imported in all command files
for f in \
  src/commands/define.ts \
  src/commands/specify.ts \
  src/commands/plan.ts \
  src/commands/implement.ts \
  src/commands/tasks-generate.ts \
  src/commands/ship.ts \
  src/commands/test.ts \
  src/commands/effort.ts \
  src/commands/compression.ts \
  src/commands/pulse.ts \
  src/commands/tasks.ts \
  src/commands/runs.ts \
  src/commands/stats.ts \
  src/commands/db.ts \
  src/commands/server.ts \
  src/commands/status.ts \
  src/commands/init.ts \
  src/commands/setup-slack.ts; do
  grep -q "withSignal" "$f" || { echo "FAIL: $f missing withSignal import/usage"; exit 1; }
done

# Assertion #2: No direct process.exit() calls in action bodies (withSignal handles exit)
# Allow process.exit in non-action contexts (e.g., config loader preAction hook)
for f in src/commands/define.ts src/commands/ship.ts src/commands/tasks.ts src/commands/status.ts; do
  COUNT=$(grep -c 'process\.exit(' "$f" || true)
  if [ "$COUNT" -gt 1 ]; then
    echo "FAIL: $f has $COUNT process.exit() calls — should be handled by withSignal"
    exit 1
  fi
done

# Assertion #3: E2E — a command actually emits signal on stderr
OUTPUT=$(gwrk status 2>&1 >/dev/null || true)
echo "$OUTPUT" | grep -q '\[exit:' || { echo "FAIL: gwrk status does not emit signal"; exit 1; }

echo "PASS: T002 — Wrap all command actions with withSignal()"

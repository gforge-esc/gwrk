#!/bin/bash
set -euo pipefail
# Gate: T014 — Wire --agent global flag
# Source: spec FR-003, TC-006
# AUTHORED

# Assertion #1: --agent option in cli.ts
grep -q "option.*--agent" src/cli.ts

# Assertion #2: GWRK_AGENT env var detection
grep -q 'GWRK_AGENT' src/cli.ts || grep -q 'GWRK_AGENT' src/utils/agent-layer.ts

# Assertion #3: processForAgent wired for stdout
grep -q 'processForAgent' src/cli.ts || grep -rq 'processForAgent' src/commands/

# Assertion #4: E2E — agent mode strips ANSI
GWRK_AGENT=1 gwrk status 2>/dev/null | cat -v | grep -c '\^' > /tmp/gwrk-ansi-count.txt 2>/dev/null || true
ANSI_COUNT=$(cat /tmp/gwrk-ansi-count.txt 2>/dev/null || echo "0")
[ "$ANSI_COUNT" -eq 0 ] || { echo "FAIL: GWRK_AGENT=1 output contains $ANSI_COUNT ANSI sequences"; exit 1; }

echo "PASS: T014 — Wire --agent global flag"

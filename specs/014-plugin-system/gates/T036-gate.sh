#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/init.test.ts \
  || { echo "FAIL: T036 — file not found: src/commands/init.test.ts" >&2; exit 1; }
grep -q 'should provision GEMINI.md, CLAUDE.md, and .gwrk/agent-context.md if CLIs are detected (FR-L1-008)' src/commands/init.test.ts \
  || { echo "FAIL: T036 — src/commands/init.test.ts missing FR-L1-008 test case" >&2; exit 1; }

echo "PASS: T036 — Implement src/commands/init.test.ts"

#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/builtins/agents/claude/adapter.ts
grep -q 'ClaudeAdapter' src/plugins/builtins/agents/claude/adapter.ts

echo "PASS: T016 — Implement src/plugins/builtins/agents/claude/adapter.ts"

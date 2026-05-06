#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/builtins/agents/codex/adapter.ts
grep -q 'CodexAdapter' src/plugins/builtins/agents/codex/adapter.ts

echo "PASS: T018 — Implement src/plugins/builtins/agents/codex/adapter.ts"

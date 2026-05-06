#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/builtins/agents/index.ts
grep -q 'builtInAgents' src/plugins/builtins/agents/index.ts

echo "PASS: T015 — Implement src/plugins/builtins/agents/index.ts"

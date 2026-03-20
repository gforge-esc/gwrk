#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/builtins/agents/gemini/adapter.ts
grep -q 'GeminiAdapter' src/plugins/builtins/agents/gemini/adapter.ts

echo "PASS: T017 — Implement src/plugins/builtins/agents/gemini/adapter.ts"

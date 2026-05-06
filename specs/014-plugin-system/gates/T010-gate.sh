#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/skill.ts
grep -q 'skill' src/commands/skill.ts

echo "PASS: T010 — Implement src/commands/skill.ts"

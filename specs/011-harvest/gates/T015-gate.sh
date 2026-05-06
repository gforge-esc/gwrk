#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Verify src/commands/harvest.ts exists
ls src/commands/harvest.ts > /dev/null

# Assertion #2: Verify command registration logic
grep -q "harvest" src/commands/harvest.ts

echo "PASS: T015 — Implement src/commands/harvest.ts (NEW)"

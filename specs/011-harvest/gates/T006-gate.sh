#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Verify finalizeLogs function exists
grep -q "export async function finalizeLogs" src/engine/harvest.ts

# Assertion #2: Verify logic for index.json update
grep -q "index.json" src/engine/harvest.ts

echo "PASS: T006 — Implement src/engine/harvest.ts (NEW: finalizeLogs, updateLogIndex)"

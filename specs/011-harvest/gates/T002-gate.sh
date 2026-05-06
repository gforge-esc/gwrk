#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Check for status field in runs logic
grep -q "status" src/db/runs.ts

# Assertion #2: Check for merge_commit_sha field in runs logic
grep -q "merge_commit_sha" src/db/runs.ts

echo "PASS: T002 — Implement src/db/runs.ts (MODIFY)"

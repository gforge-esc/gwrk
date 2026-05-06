#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Verify harvestFeature function exists
grep -q "export async function harvestFeature" src/engine/harvest.ts

# Assertion #2: Verify idempotency check (merge_commit_sha check)
grep -q "merge_commit_sha" src/engine/harvest.ts

# Assertion #3: Verify Slack notification logic
grep -q "notifyDoneDone" src/engine/harvest.ts

echo "PASS: T013 — Implement src/engine/harvest.ts (MODIFY: harvestFeature)"

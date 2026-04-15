#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Ensure notifySlack is NOT called directly after harvestFeature in github.ts
# We check the 10 lines following the harvestFeature call
if grep -A 10 "harvestFeature(projectRoot, record)" src/server/github.ts | grep -q "notifySlack"; then
  echo "FAIL: notifySlack still present after harvestFeature in github.ts (duplicate)" >&2
  exit 1
fi

echo "PASS: T019 — Implement src/server/github.ts remove duplicate Slack notification"

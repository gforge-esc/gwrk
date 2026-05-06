#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Verify GITHUB_WEBHOOK_SECRET config
grep -q "GITHUB_WEBHOOK_SECRET" src/utils/config.ts

echo "PASS: T011 — Implement src/utils/config.ts (MODIFY: GITHUB_WEBHOOK_SECRET)"

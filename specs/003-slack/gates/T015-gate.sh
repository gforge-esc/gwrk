#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement src/server/slack-actions.ts
# AUTHORED — do not overwrite
# Assertion #1: Verify Slack actions
pnpm vitest run src/server/slack-actions.test.ts --reporter=verbose
echo "PASS: T015"

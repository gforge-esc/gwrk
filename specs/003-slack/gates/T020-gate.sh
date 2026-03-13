#!/bin/bash
set -euo pipefail
# Gate: T020 — Implement test strategy for Phase 8
# AUTHORED — do not overwrite
# Assertion #1: Verify Phase 8
pnpm vitest run src/server/slack-actions.test.ts src/server/slack-commands.test.ts --reporter=verbose
echo "PASS: T020"

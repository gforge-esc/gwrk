#!/bin/bash
set -euo pipefail
# Gate: T018 — Implement src/server/slack-commands.ts
# AUTHORED — do not overwrite
# Assertion #1: Verify Slack commands
pnpm vitest run src/server/slack-commands.test.ts --reporter=verbose
echo "PASS: T018"

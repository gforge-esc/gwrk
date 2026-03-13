#!/bin/bash
set -euo pipefail
# Gate: T022 — Implement src/server/slack-notify.ts
# AUTHORED — do not overwrite
# Assertion #1: Verify Slack notify
pnpm vitest run src/server/routes/notify.test.ts --reporter=verbose
echo "PASS: T022"

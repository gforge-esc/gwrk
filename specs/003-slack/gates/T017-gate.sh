#!/bin/bash
set -euo pipefail
# Gate: T017 — Implement src/server/slack.ts
# AUTHORED — do not overwrite
# Assertion #1: Verify Slack init
pnpm vitest run src/server/slack.test.ts --reporter=verbose
echo "PASS: T017"

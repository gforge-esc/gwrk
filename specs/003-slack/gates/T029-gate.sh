#!/bin/bash
set -euo pipefail
# Gate: T038 — Implement src/server/routes/status.ts
# Asserts: Derived from task description

test -f src/server/routes/status.ts

# Phase Acceptance Criteria
gwrk init --slack-ops gwrk-ops
cat .gwrkrc.json | jq -e '.project.slack.opsChannelId'
gwrk status
pnpm build

echo "PASS: T038 — Implement src/server/routes/status.ts"

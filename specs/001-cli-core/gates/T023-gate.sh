#!/bin/bash
set -euo pipefail
# Gate: T023 — Implement test strategy for Phase 4
# Asserts: Derived from task description


# Phase Acceptance Criteria
node --import tsx src/cli.ts tasks list 001-cli-core --json | jq '.tasks | length'
node --import tsx src/cli.ts tasks next 001-cli-core 1 --json | jq -r '.id'
pnpm test
pnpm test

echo "PASS: T023 — Implement test strategy for Phase 4"

#!/bin/bash
set -euo pipefail
# Gate: T021 — Implement test strategy for Phase 3
# Asserts: Derived from task description


# Phase Acceptance Criteria
node --import tsx src/cli.ts tasks generate 001-cli-core
jq '.phases | length' specs/001-cli-core/.gwrk/tasks.json
ls specs/001-cli-core/gates/T*-gate.sh | wc -l
test -x specs/001-cli-core/gates/T001-gate.sh
node --import tsx src/cli.ts tasks done 001-cli-core T001
node --import tsx src/cli.ts tasks done 001-cli-core T001
tail -1 .gwrk/history.jsonl | jq -r '.taskId'
pnpm test

echo "PASS: T021 — Implement test strategy for Phase 3"

#!/bin/bash
set -euo pipefail
# Gate: T037 — Implement src/cli.e2e.test.ts
# Asserts: Derived from task description

test -f src/cli.e2e.test.ts

# Phase Acceptance Criteria
pnpm test
gwrk --help

echo "PASS: T037 — Implement src/cli.e2e.test.ts"

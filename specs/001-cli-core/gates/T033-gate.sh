#!/bin/bash
set -euo pipefail
# Gate: T033 — Implement src/commands/new.ts
# Asserts: Derived from task description

test -f src/commands/new.ts

# Phase Acceptance Criteria
gwrk init
gwrk init
gwrk new test-project
gwrk init

echo "PASS: T033 — Implement src/commands/new.ts"

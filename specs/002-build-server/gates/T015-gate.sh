#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement test strategy for Phase 3
# Asserts: Derived from task description


# Phase Acceptance Criteria
vitest src/server/git-manager.test.ts src/server/context.test.ts

echo "PASS: T015 — Implement test strategy for Phase 3"

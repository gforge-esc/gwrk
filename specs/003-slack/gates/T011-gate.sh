#!/bin/bash
set -euo pipefail
# Gate: T011 — Implement src/db/migrations/003_pr_tracking.sql
# AUTHORED — do not overwrite
# Assertion #1: Verify DB schema
pnpm vitest run src/db/db.test.ts --reporter=verbose
echo "PASS: T011"

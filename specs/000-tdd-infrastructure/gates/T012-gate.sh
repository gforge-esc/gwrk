#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T012 — Implement test strategy for Phase 3
pnpm vitest run src/server/ --reporter=verbose
# Verify T007 re-gated
cat specs/003-slack/gates/T007-gate.sh | grep -q "pnpm vitest run"
echo "PASS: T012 — Implement test strategy for Phase 3"

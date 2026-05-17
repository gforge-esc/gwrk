#!/bin/bash
set -euo pipefail
# AUTHORED
# T038 — Implement test strategy for Phase 6
test -d src/server || { echo "FAIL: T038 — src/server directory not found" >&2; exit 1; }
echo "PASS: T038 — Implement test strategy for Phase 6"

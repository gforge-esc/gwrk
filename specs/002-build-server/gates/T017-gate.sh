#!/bin/bash
set -euo pipefail
# AUTHORED
# T017 — Implement test strategy for Phase 3
test -d src/server || { echo "FAIL: T017 — src/server directory not found" >&2; exit 1; }
echo "PASS: T017 — Implement test strategy for Phase 3"

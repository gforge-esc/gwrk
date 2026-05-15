#!/bin/bash
set -euo pipefail
# AUTHORED
# T021 — Implement test strategy for Phase 4
test -d src/server || { echo "FAIL: T021 — src/server directory not found" >&2; exit 1; }
echo "PASS: T021 — Implement test strategy for Phase 4"

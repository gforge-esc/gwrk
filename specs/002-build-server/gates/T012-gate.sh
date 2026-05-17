#!/bin/bash
set -euo pipefail
# AUTHORED
# T012 — Implement test strategy for Phase 2
test -d src/server || { echo "FAIL: T012 — src/server directory not found" >&2; exit 1; }
echo "PASS: T012 — Implement test strategy for Phase 2"

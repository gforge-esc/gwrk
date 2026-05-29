#!/bin/bash
# AUTHORED
set -euo pipefail

# T058: Test strategy for Enforcement Skills (Phase 9/10)
# This gate verifies that all TR-P9-* gates pass.
for gate in specs/014-plugin-system/gates/TR-P9-*-gate.sh; do
  bash "$gate" \
    || { echo "FAIL: T058 — $gate failed" >&2; exit 1; }
done

echo "PASS: T058 — Implement test strategy for Enforcement Skills"

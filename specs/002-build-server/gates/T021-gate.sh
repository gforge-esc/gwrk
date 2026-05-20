#!/bin/bash
# AUTHORED
set -euo pipefail
# Cannot gate a test strategy without an explicit file
echo "FAIL: T021 — cannot gate: no primary file to verify test strategy" >&2
exit 1

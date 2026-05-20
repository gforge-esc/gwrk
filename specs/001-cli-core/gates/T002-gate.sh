#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "tsconfig.json" || { echo "FAIL: T002 — file not found: tsconfig.json" >&2; exit 1; }
jq . "tsconfig.json" > /dev/null || { echo "FAIL: T002 — invalid JSON in tsconfig.json" >&2; exit 1; }

echo "PASS: T002 — Implement tsconfig.json"

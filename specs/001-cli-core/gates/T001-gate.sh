#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "package.json" || { echo "FAIL: T001 — file not found: package.json" >&2; exit 1; }
jq . "package.json" > /dev/null || { echo "FAIL: T001 — invalid JSON in package.json" >&2; exit 1; }

echo "PASS: T001 — Implement package.json"

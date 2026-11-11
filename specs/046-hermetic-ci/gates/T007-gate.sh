#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007 — Modify package.json
# Generated from filesystem convention (no test file found)

test -f package.json || { echo "FAIL: T007 — file not found: package.json" >&2; exit 1; }

echo "PASS: T007 — Modify package.json"

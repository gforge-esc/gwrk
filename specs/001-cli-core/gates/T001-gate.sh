#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T001 — Implement package.json

test -f package.json \
  || { echo "FAIL: T001 — file not found: package.json" >&2; exit 1; }

grep -q '"name": "@gwrk/cli"' package.json \
  || { echo "FAIL: T001 — package.json missing name '@gwrk/cli'" >&2; exit 1; }

grep -q '"type": "module"' package.json \
  || { echo "FAIL: T001 — package.json missing type 'module'" >&2; exit 1; }

jq . package.json > /dev/null \
  || { echo "FAIL: T001 — invalid JSON in package.json" >&2; exit 1; }

echo "PASS: T001 — Implement package.json"

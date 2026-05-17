#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Implement tsconfig.json

test -f tsconfig.json \
  || { echo "FAIL: T002 — file not found: tsconfig.json" >&2; exit 1; }

grep -q '"target": "ES2022"' tsconfig.json \
  || { echo "FAIL: T002 — tsconfig.json missing target 'ES2022'" >&2; exit 1; }

jq . tsconfig.json > /dev/null \
  || { echo "FAIL: T002 — invalid JSON in tsconfig.json" >&2; exit 1; }

echo "PASS: T002 — Implement tsconfig.json"

#!/bin/bash
set -euo pipefail
# Gate: T002 — tsconfig.json with ES2022 + ESM + strict

test -f tsconfig.json
grep -q '"ES2022"' tsconfig.json
grep -q '"NodeNext"' tsconfig.json
grep -q '"strict": true' tsconfig.json
grep -q '"outDir"' tsconfig.json
grep -q '"rootDir"' tsconfig.json

echo "PASS: T002 — tsconfig.json has ES2022, NodeNext, strict"

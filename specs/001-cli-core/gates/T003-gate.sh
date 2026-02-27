#!/bin/bash
set -euo pipefail
# Gate: T003 — biome.json lint + format configuration

test -f biome.json
grep -q '"formatter"' biome.json
grep -q '"linter"' biome.json
grep -q '"organizeImports"' biome.json

echo "PASS: T003 — biome.json has formatter, linter, organizeImports"

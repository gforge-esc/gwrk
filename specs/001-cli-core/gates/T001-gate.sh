#!/bin/bash
set -euo pipefail
# Gate: T001 — package.json with project manifest and dependencies
# Asserts: package.json exists with required dependencies and config

test -f package.json
grep -q '"commander"' package.json
grep -q '"zod"' package.json
grep -q '"vitest"' package.json
grep -q '"typescript"' package.json
grep -q '"@biomejs/biome"' package.json
grep -q '"tsx"' package.json
grep -q '"type": "module"' package.json
grep -q '"build"' package.json
grep -q '"test"' package.json

echo "PASS: T001 — package.json has all required dependencies and scripts"

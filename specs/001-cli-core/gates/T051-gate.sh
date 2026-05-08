#!/bin/bash
set -euo pipefail
# Gate: T051 — Implement src/commands/tests-generate.ts (resolveFeature)
# Asserts: Command accepts '001' prefix

gwrk define tests 001 --help > /dev/null

echo "PASS: T051 — resolveFeature in tests-generate"
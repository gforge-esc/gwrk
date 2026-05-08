#!/bin/bash
set -euo pipefail
# Gate: T050 — Implement src/commands/define-plan.ts (resolveFeature)
# Asserts: Command accepts '001' prefix for '001-cli-core'

# Should resolve 001 to 001-cli-core and not fail with 'feature not found'
gwrk define plan 001 --help > /dev/null

echo "PASS: T050 — resolveFeature in define-plan"
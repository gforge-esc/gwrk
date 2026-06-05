#!/bin/bash
set -euo pipefail
# Gate: T025 — Implement Leading Indicators
# Asserts: Convergence, Density, and Spec Quality indicators are present in output

# 1. Implementation check
grep -q "computeLeadingIndicators" src/engine/compression.ts
grep -q "indicators" src/commands/compression.ts

# 2. Functionality check (JSON)
node dist/cli.js measure compression 001-cli-core --json | grep -q "indicators"
node dist/cli.js measure compression 001-cli-core --json | grep -q "convergence"
node dist/cli.js measure compression 001-cli-core --json | grep -q "density"
node dist/cli.js measure compression 001-cli-core --json | grep -q "specQuality"

# 3. Unit tests
pnpm vitest run src/engine/indicators.test.ts

echo "PASS: T025 — Implement Leading Indicators"

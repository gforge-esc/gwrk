#!/bin/bash
# AUTHORED
set -euo pipefail

# T029: Verify src/engine/ship-types.ts exists with required types
test -f src/engine/ship-types.ts || { echo "FAIL: src/engine/ship-types.ts missing" >&2; exit 1; }
grep -q 'ShipStage' src/engine/ship-types.ts || { echo "FAIL: ShipStage type missing" >&2; exit 1; }
grep -q 'ShipState' src/engine/ship-types.ts || { echo "FAIL: ShipState type missing" >&2; exit 1; }
grep -q 'ShipRunConfig' src/engine/ship-types.ts || { echo "FAIL: ShipRunConfig type missing" >&2; exit 1; }

echo "PASS: T029 — src/engine/ship-types.ts exists with ShipStage, ShipState, ShipRunConfig"

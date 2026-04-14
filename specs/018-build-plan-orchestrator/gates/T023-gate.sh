#!/bin/bash
set -euo pipefail
# Gate: T023 — Implement src/server/plan-viz.ts

test -f src/server/plan-viz.ts
grep -q "sigma" src/server/plan-viz.ts

echo "PASS: T023 — Visualization generator implemented"

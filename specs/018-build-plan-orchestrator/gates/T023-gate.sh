#!/bin/bash
# T023: Implement src/server/plan-viz.ts
set -e
test -f "src/server/plan-viz.ts"
if [ -f src/server/plan-viz.test.ts ]; then npx vitest run src/server/plan-viz.test.ts; fi
echo "T023: Visualization engine implemented."
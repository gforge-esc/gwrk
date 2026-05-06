#!/bin/bash
# T020: Implement src/engine/plan-renderer.ts
set -e
test -f "src/engine/plan-renderer.ts"
# Renderer test expected in Phase 4
if [ -f src/engine/plan-renderer.test.ts ]; then npx vitest run src/engine/plan-renderer.test.ts; fi
echo "T020: Plan renderer implemented."
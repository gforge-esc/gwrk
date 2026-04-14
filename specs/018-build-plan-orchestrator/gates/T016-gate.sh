#!/bin/bash
# T016: Implement src/engine/plan-store.ts (mutation)
set -e
FILE="src/engine/plan-store.ts"
grep -q "addFeature" "$FILE"
grep -q "addPhase" "$FILE"
grep -q "addEdge" "$FILE"
echo "T016: Plan store mutations implemented."
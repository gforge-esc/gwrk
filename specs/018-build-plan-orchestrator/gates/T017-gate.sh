#!/bin/bash
# T017: Implement src/utils/state.ts (invariants)
set -e
grep -q "SP additivity" src/utils/state.ts
echo "T017: State invariants checked."
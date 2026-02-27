#!/bin/bash
set -e
test -f src/utils/state.ts
grep -q 'export const getTaskState' src/utils/state.ts
grep -q 'export const saveTaskState' src/utils/state.ts

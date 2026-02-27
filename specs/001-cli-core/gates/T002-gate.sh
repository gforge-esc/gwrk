#!/bin/bash
set -e
test -f src/utils/exec.ts
grep -q 'export const runAgent' src/utils/exec.ts
grep -q 'export const runGate' src/utils/exec.ts

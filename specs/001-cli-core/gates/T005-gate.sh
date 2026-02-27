#!/bin/bash
set -e
test -f src/commands/plan.ts
grep -q 'plan' src/commands/plan.ts

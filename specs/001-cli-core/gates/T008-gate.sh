#!/bin/bash
set -e
test -f src/commands/plan-to-tasks.ts
grep -q 'plan-to-tasks' src/commands/plan-to-tasks.ts

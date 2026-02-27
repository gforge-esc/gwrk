#!/bin/bash
set -e
test -f src/commands/tasks.ts
grep -q 'done' src/commands/tasks.ts

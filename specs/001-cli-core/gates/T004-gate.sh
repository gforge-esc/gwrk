#!/bin/bash
set -e
test -f src/commands/specify.ts
grep -q 'specify' src/commands/specify.ts

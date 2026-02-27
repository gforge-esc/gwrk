#!/bin/bash
set -e
test -f src/cli.ts
grep -q 'new Command()' src/cli.ts
grep -q '.parse()' src/cli.ts

#!/bin/bash
set -euo pipefail
# Gate: T006 — CLI entry point in src/cli.ts with Commander

test -f src/cli.ts
grep -q 'commander\|Command' src/cli.ts
grep -q 'gwrk' src/cli.ts
grep -q 'parse\|parseAsync' src/cli.ts
grep -q 'init' src/cli.ts

echo "PASS: T006 — cli.ts has Commander program with init command"

#!/bin/bash
set -euo pipefail
# Gate: T004 — GwrkConfigSchema and loadConfig in src/utils/config.ts
# Asserts: Zod schema with no .default() calls, loadConfig function, fail-fast

test -f src/utils/config.ts
grep -q 'GwrkConfigSchema' src/utils/config.ts
grep -q 'loadConfig' src/utils/config.ts
grep -q "z\.object" src/utils/config.ts
grep -q "process\.exit(1)" src/utils/config.ts
grep -q "safeParse" src/utils/config.ts
# Must NOT have .default() calls
! grep -q '\.default(' src/utils/config.ts

echo "PASS: T004 — config.ts has Zod schema, loadConfig, fail-fast, no defaults"

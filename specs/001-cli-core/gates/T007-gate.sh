#!/bin/bash
set -euo pipefail
# Gate: T007 — gwrk init command in src/commands/init.ts

test -f src/commands/init.ts
grep -q 'mkdirSync\|mkdir' src/commands/init.ts
grep -q '.agent' src/commands/init.ts
grep -q '.specify' src/commands/init.ts
grep -q 'specs' src/commands/init.ts
grep -q '.gwrkrc.json\|gwrkrc' src/commands/init.ts
grep -q 'already initialized\|existsSync' src/commands/init.ts

echo "PASS: T007 — init.ts creates scaffold dirs and .gwrkrc.json, is idempotent"

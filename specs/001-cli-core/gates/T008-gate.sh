#!/bin/bash
set -euo pipefail
# Gate: T008 — Unit tests for init and config (TR-001, TR-008)

test -f src/commands/init.test.ts
test -f src/utils/config.test.ts
grep -q 'describe\|test\|it(' src/commands/init.test.ts
grep -q 'describe\|test\|it(' src/utils/config.test.ts
grep -q 'idempoten\|already' src/commands/init.test.ts
grep -q 'exit\|process.exit\|toThrow\|rejects' src/utils/config.test.ts
# Tests must actually pass
pnpm test --run src/commands/init.test.ts src/utils/config.test.ts

echo "PASS: T008 — init and config tests exist and pass"

#!/bin/bash
set -euo pipefail
# Gate: T015 — Plan parser in src/utils/parser.ts

test -f src/utils/parser.ts
grep -q 'parsePlan' src/utils/parser.ts
grep -q 'phases\|Phase' src/utils/parser.ts
grep -q 'readFileSync\|readFile' src/utils/parser.ts

echo "PASS: T015 — parser.ts has parsePlan that extracts phases"

#!/bin/bash
set -euo pipefail
# Gate: T009 — Implement src/cli.pulse.e2e.test.ts
# Asserts: Derived from task description

test -f src/cli.pulse.e2e.test.ts

# Check if it contains VR-002 and VR-003 tests
grep -q "VR-002" src/cli.pulse.e2e.test.ts
grep -q "VR-003" src/cli.pulse.e2e.test.ts

echo "PASS: T009 — Implement src/cli.pulse.e2e.test.ts"

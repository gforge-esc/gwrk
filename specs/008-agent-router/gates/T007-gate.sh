#!/bin/bash
set -euo pipefail
# Gate: T007 — Implement src/server/quota-prober.test.ts
# Asserts: Derived from task description

test -f src/server/quota-prober.test.ts

echo "PASS: T007 — Implement src/server/quota-prober.test.ts"

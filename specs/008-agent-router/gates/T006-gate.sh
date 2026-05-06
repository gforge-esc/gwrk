#!/bin/bash
set -euo pipefail
# Gate: T006 — Implement src/server/quota-prober.ts
# Asserts: Derived from task description

test -f src/server/quota-prober.ts
grep -q 'probeQuota' src/server/quota-prober.ts

echo "PASS: T006 — Implement src/server/quota-prober.ts"

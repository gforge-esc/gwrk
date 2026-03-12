#!/bin/bash
set -euo pipefail
# Gate: T021 — Implement src/utils/config.ts
# Asserts: Derived from task description

test -f src/utils/config.ts
# Required identifiers
grep -q 'opsChannelId' src/utils/config.ts
grep -q 'opsChannelName' src/utils/config.ts
grep -q 'SlackProjectConfig' src/utils/config.ts

echo "PASS: T021 — Implement src/utils/config.ts"

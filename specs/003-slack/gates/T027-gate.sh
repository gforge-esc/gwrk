#!/bin/bash
set -euo pipefail
# Gate: T037 — Implement src/server/slack-home.ts
# Asserts: Derived from task description

test -f src/server/slack-home.ts
test -f docker-compose.yml
# Required identifiers
grep -q 'app_home_opened' src/server/slack-home.ts

echo "PASS: T037 — Implement src/server/slack-home.ts"

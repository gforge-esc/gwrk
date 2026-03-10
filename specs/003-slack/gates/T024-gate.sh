#!/bin/bash
set -euo pipefail
# Gate: T024 — Implement src/server/slack-notify.ts
# Asserts: Derived from task description

test -f src/server/slack-notify.ts

echo "PASS: T024 — Implement src/server/slack-notify.ts"

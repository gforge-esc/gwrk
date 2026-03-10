#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement src/server/slack-notify.ts
# Asserts: Derived from task description

test -f src/server/slack-notify.ts

echo "PASS: T014 — Implement src/server/slack-notify.ts"

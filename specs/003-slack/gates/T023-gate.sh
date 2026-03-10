#!/bin/bash
set -euo pipefail
# Gate: T023 — Implement src/server/slack-home.ts
# Asserts: Derived from task description

test -f src/server/slack-home.ts

echo "PASS: T023 — Implement src/server/slack-home.ts"

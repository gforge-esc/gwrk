#!/bin/bash
set -euo pipefail
# Gate: T009 — Implement scripts/dev/agent-run.sh
# Asserts: Derived from task description

test -f scripts/dev/agent-run.sh
# Required identifiers
grep -q 'gwrk_notify' scripts/dev/agent-run.sh

echo "PASS: T009 — Implement scripts/dev/agent-run.sh"

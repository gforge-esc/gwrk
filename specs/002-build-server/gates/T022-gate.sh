#!/bin/bash
set -euo pipefail
# Gate: T022 — Implement Dockerfile.sandbox
# Asserts: Derived from task description

test -f Node.js

echo "PASS: T022 — Implement Dockerfile.sandbox"

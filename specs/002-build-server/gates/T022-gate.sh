#!/bin/bash
set -euo pipefail
# Gate: T022 — Implement Dockerfile.sandbox
# Asserts: Derived from task description

test -f Dockerfile.sandbox

echo "PASS: T022 — Implement Dockerfile.sandbox"

#!/bin/bash
set -euo pipefail
# Gate: T004 — Implement package.json
# Asserts: Derived from task description

test -f package.json

echo "PASS: T004 — Implement package.json"

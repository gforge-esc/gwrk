#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T005 — Create compose.test.yaml
# Generated from filesystem convention (no test file found)

test -f tests/hosted-auth-proof/compose.test.yaml || { echo "FAIL: T005 — file not found: tests/hosted-auth-proof/compose.test.yaml" >&2; exit 1; }

echo "PASS: T005 — Create compose.test.yaml"

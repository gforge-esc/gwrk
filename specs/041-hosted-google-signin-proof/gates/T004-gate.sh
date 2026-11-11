#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T004 — Create gateway-proof.mjs
# Generated from filesystem convention (no test file found)

test -f tests/hosted-auth-proof/gateway-proof.mjs || { echo "FAIL: T004 — file not found: tests/hosted-auth-proof/gateway-proof.mjs" >&2; exit 1; }

echo "PASS: T004 — Create gateway-proof.mjs"

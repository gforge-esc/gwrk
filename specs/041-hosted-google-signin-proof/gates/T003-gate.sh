#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T003 — Create oidc-issuer.mjs
# Generated from filesystem convention (no test file found)

test -f tests/hosted-auth-proof/oidc-issuer.mjs || { echo "FAIL: T003 — file not found: tests/hosted-auth-proof/oidc-issuer.mjs" >&2; exit 1; }

echo "PASS: T003 — Create oidc-issuer.mjs"

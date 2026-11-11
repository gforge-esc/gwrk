#!/usr/bin/env bash
# AUTHORED
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
node tests/hosted-auth-proof/gateway-proof.mjs

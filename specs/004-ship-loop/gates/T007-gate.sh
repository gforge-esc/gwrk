#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
grep -q 'validate-staging' scripts/dev/work-until-done.sh || { echo "FAIL: validate-staging not called from WUD"; exit 1; }
echo "PASS: T007 — staging validator integrated in WUD"

#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
grep -qE 'porcelain|dirty|Dirty working tree' scripts/dev/wud-branch.sh || { echo "FAIL: dirty-tree check not in wud-branch.sh"; exit 1; }
echo "PASS: T008 — dirty-tree fail-fast"

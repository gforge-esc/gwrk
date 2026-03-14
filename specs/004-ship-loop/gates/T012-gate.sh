#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm build 2>&1 | tail -2
pnpm test 2>&1 | grep -qE 'Tests.*pass' || { echo "FAIL: test suite failures"; exit 1; }
echo "PASS: T012 — full suite and build clean"

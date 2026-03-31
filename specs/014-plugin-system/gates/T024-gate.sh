#!/bin/bash
# AUTHORED
set -euo pipefail

test -d src/plugins/builtins/workflows \
  || { echo "FAIL: T024 — directory not found: src/plugins/builtins/workflows/" >&2; exit 1; }

WORKDIR_COUNT=$(find src/plugins/builtins/workflows -name '*.md' | wc -l | tr -d ' ')
if [ "$WORKDIR_COUNT" -lt 5 ]; then
  echo "FAIL: T024 — expected at least 5 markdown workflow files" >&2
  exit 1
fi

echo "PASS: T024 — Implement src/plugins/builtins/workflows/"

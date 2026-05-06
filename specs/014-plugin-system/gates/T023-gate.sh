#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/engine/intent-engine.ts \
  || { echo "FAIL: T023 — file not found: src/engine/intent-engine.ts" >&2; exit 1; }

grep -q 'IntentEngine' src/engine/intent-engine.ts \
  || { echo "FAIL: T023 — intent-engine.ts missing IntentEngine class (FR-L25-002)" >&2; exit 1; }

grep -q 'executeIntents' src/engine/intent-engine.ts \
  || { echo "FAIL: T023 — intent-engine.ts missing executeIntents method" >&2; exit 1; }

grep -q 'WRITE_FILE\|CREATE_DIR\|RUN_COMMAND' src/engine/intent-engine.ts \
  || { echo "FAIL: T023 — intent-engine.ts missing JSON intent action types" >&2; exit 1; }

echo "PASS: T023 — Implement src/engine/intent-engine.ts"

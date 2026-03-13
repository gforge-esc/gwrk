#!/bin/bash
set -euo pipefail
# Gate: T004 — Add --format global flag to CLI
# Source: spec FR-002, contracts/output.md
# AUTHORED

# Assertion #1: --format option registered in cli.ts
grep -q "option.*--format" src/cli.ts

# Assertion #2: Validates format value (human|json)
grep -q "'human'\|'json'" src/cli.ts || grep -q "human.*json" src/cli.ts

# Assertion #3: E2E — --format flag appears in help
gwrk --help 2>/dev/null | grep -q '\-\-format' || { echo "FAIL: --format not in gwrk --help"; exit 1; }

# Assertion #4: E2E — invalid format exits 2
gwrk status --format xml 2>/dev/null; EXITCODE=$?
[ "$EXITCODE" -eq 2 ] || { echo "FAIL: --format xml should exit 2, got $EXITCODE"; exit 1; }

echo "PASS: T004 — Add --format global flag to CLI"

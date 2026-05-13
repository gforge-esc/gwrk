#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T055 — Implement docs/governance/cli-grammar.md

test -f docs/governance/cli-grammar.md \
  || { echo "FAIL: T055 — file not found: docs/governance/cli-grammar.md" >&2; exit 1; }

grep -q 'gwrk' docs/governance/cli-grammar.md \
  || { echo "FAIL: T055 — docs/governance/cli-grammar.md missing 'gwrk'" >&2; exit 1; }

echo "PASS: T055 — Implement docs/governance/cli-grammar.md"

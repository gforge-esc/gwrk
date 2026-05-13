#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T051 — Implement docs/governance/cli-grammar.md

test -f docs/governance/cli-grammar.md \
  || { echo "FAIL: T051 — file not found: docs/governance/cli-grammar.md" >&2; exit 1; }

grep -q 'gwrk define' docs/governance/cli-grammar.md \
  || { echo "FAIL: T051 — docs/governance/cli-grammar.md missing 'gwrk define'" >&2; exit 1; }

echo "PASS: T051 — Implement docs/governance/cli-grammar.md"

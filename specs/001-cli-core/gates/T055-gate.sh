#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "docs/governance/cli-grammar.md" || { echo "FAIL: T055 — file not found: docs/governance/cli-grammar.md" >&2; exit 1; }
grep -q "#" "docs/governance/cli-grammar.md" || { echo "FAIL: T055 — docs/governance/cli-grammar.md missing header" >&2; exit 1; }

echo "PASS: T055 — Implement docs/governance/cli-grammar.md"

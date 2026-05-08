#!/bin/bash
set -euo pipefail
# Gate: T055 — Implement docs/governance/cli-grammar.md
# Asserts: Doc exists and contains grammar rules

test -f docs/governance/cli-grammar.md
grep -q "Grammar" docs/governance/cli-grammar.md

echo "PASS: T055 — CLI Grammar doc exists"
#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T003 — Modify ADR-002-sqlite-execution-ledger.md
# TR-014 corpus assertions (plan.md Phase 1 > Done When). The corpus is markdown,
# not a vitest suite: `vitest run <file>.md` matches nothing under vitest's
# include glob (**/*.{test,spec}.?(c|m)[jt]s?(x)) and exits 1 with "No test files
# found", so this gate asserts the corpus properties directly instead.

test -f docs/decisions/ADR-002-sqlite-execution-ledger.md || { echo "FAIL: T003 — file not found: docs/decisions/ADR-002-sqlite-execution-ledger.md" >&2; exit 1; }

# FR/TR-014: H1 is the addressable `# ADR-002: <title>` form.
awk 'NR==1{exit !/^# ADR-002: /}' docs/decisions/ADR-002-sqlite-execution-ledger.md \
  || { echo "FAIL: T003 — line 1 of ADR-002-sqlite-execution-ledger.md is not '# ADR-002: <title>'" >&2; exit 1; }

# FR/TR-014: no dead absolute `file:///Users/gonzo/...` links anywhere in the
# corpus — cross-record links are relative. Negative form per the plan's
# Gate-Form Correction (`! grep -q` is a set -e no-op).
if grep -rq 'file:///Users/gonzo' docs/decisions/; then
  echo "FAIL: T003 — dead 'file:///Users/gonzo' link still present under docs/decisions/" >&2
  exit 1
fi

echo "PASS: T003 — Modify ADR-002-sqlite-execution-ledger.md"

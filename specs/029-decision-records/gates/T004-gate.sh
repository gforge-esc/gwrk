#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T004 — Modify ADR-006-plugin-agent-backends.md
# TR-014 corpus assertion (plan.md Phase 1 > Done When). The corpus is markdown,
# not a vitest suite: `vitest run <file>.md` matches nothing under vitest's
# include glob (**/*.{test,spec}.?(c|m)[jt]s?(x)) and exits 1 with "No test files
# found", so this gate asserts the corpus property directly instead.

test -f docs/decisions/ADR-006-plugin-agent-backends.md || { echo "FAIL: T004 — file not found: docs/decisions/ADR-006-plugin-agent-backends.md" >&2; exit 1; }

# FR/TR-014: the record is no longer `Proposed`. Negative form per the plan's
# Gate-Form Correction (`! grep -q` is a set -e no-op).
if grep -q 'Status:\*\* Proposed' docs/decisions/ADR-006-plugin-agent-backends.md; then
  echo "FAIL: T004 — ADR-006-plugin-agent-backends.md still carries 'Status: Proposed'" >&2
  exit 1
fi

# The positive half: a deleted Status line must not read as a pass.
grep -q 'Status:\*\* Decided' docs/decisions/ADR-006-plugin-agent-backends.md \
  || { echo "FAIL: T004 — ADR-006-plugin-agent-backends.md has no 'Status: Decided' line" >&2; exit 1; }

echo "PASS: T004 — Modify ADR-006-plugin-agent-backends.md"
